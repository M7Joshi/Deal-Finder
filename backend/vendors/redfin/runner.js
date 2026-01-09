import 'dotenv/config';
import axios from 'axios';
import { fetchListingsFromApi, closeSharedBrowser as closeFetcherBrowser } from './fetcher.js';
import { upsertRaw, upsertProperty, shouldPauseScraping } from './save.js';
import { extractAgentDetails, closeSharedBrowser as closeAgentBrowser } from './agentExtractor.js';
import ScraperProgress from '../../models/ScraperProgress.js';
import ScrapedDeal from '../../models/ScrapedDeal.js';

// Import control object for abort checking
import { control } from '../runAutomation.js';

// Close all shared browsers
async function closeSharedBrowser() {
  await Promise.all([
    closeFetcherBrowser().catch(() => {}),
    closeAgentBrowser().catch(() => {}),
  ]);
}

// ===== PROGRESS TRACKING =====
async function getProgress() {
  let progress = await ScraperProgress.findOne({ scraper: 'redfin' });
  if (!progress) {
    progress = await ScraperProgress.create({ scraper: 'redfin' });
  }
  return progress;
}

async function updateProgress(updates) {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    { $set: { ...updates, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function markCityProcessed(cityKey) {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    {
      $addToSet: { processedCities: cityKey },
      $inc: { totalScraped: 1 },
      $set: { updatedAt: new Date() }
    }
  );
}

// Reset progress (for starting fresh cycle)
export async function resetProgress() {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    {
      $set: {
        currentState: null,
        currentCityIndex: 0,
        currentStateIndex: 0,
        processedCities: [],
        totalScraped: 0,
        cycleStartedAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log('[Redfin] Progress reset - will start fresh');
}

// Whether to use deep scraping for agent details (default ON to get phone/email)
const USE_AGENT_ENRICHMENT = String(process.env.REDFIN_ENRICH_AGENTS || '1') === '1';

// State -> Cities mapping with Redfin city IDs - EXPANDED to match Privy's city list (654 cities!)
const STATE_CITIES = {
  'AL': [{ name: 'Birmingham', id: 1823 }, { name: 'Huntsville', id: 9408 }, { name: 'Montgomery', id: 13134 }, { name: 'Mobile', id: 12836 }, { name: 'Tuscaloosa', id: 19514 }, { name: 'Hoover', id: 35760 }, { name: 'Dothan', id: 5461 }, { name: 'Auburn', id: 814 }, { name: 'Decatur', id: 5183 }, { name: 'Madison', id: 11678 }, { name: 'Florence', id: 6875 }, { name: 'Gadsden', id: 7316 }],
  'AZ': [{ name: 'Phoenix', id: 14240 }, { name: 'Tucson', id: 19459 }, { name: 'Mesa', id: 11736 }, { name: 'Scottsdale', id: 16660 }, { name: 'Chandler', id: 3104 }, { name: 'Gilbert', id: 6998 }, { name: 'Glendale', id: 7102 }, { name: 'Tempe', id: 18607 }, { name: 'Peoria', id: 14000 }, { name: 'Surprise', id: 18267 }, { name: 'Yuma', id: 20893 }, { name: 'Flagstaff', id: 6089 }, { name: 'Goodyear', id: 7245 }, { name: 'Avondale', id: 1249 }],
  'AR': [{ name: 'Little Rock', id: 10455 }, { name: 'Fort Smith', id: 6318 }, { name: 'Fayetteville', id: 6011 }, { name: 'Springdale', id: 16927 }, { name: 'Jonesboro', id: 9092 }, { name: 'Rogers', id: 15587 }, { name: 'Conway', id: 3930 }, { name: 'North Little Rock', id: 12982 }, { name: 'Bentonville', id: 1423 }, { name: 'Pine Bluff', id: 14327 }, { name: 'Hot Springs', id: 8549 }],
  'CA': [{ name: 'Los Angeles', id: 11203 }, { name: 'San Diego', id: 16904 }, { name: 'San Jose', id: 17420 }, { name: 'San Francisco', id: 17151 }, { name: 'Fresno', id: 6904 }, { name: 'Sacramento', id: 16409 }, { name: 'Long Beach', id: 10940 }, { name: 'Oakland', id: 13654 }, { name: 'Bakersfield', id: 953 }, { name: 'Anaheim', id: 517 }, { name: 'Santa Ana', id: 17650 }, { name: 'Riverside', id: 15935 }, { name: 'Stockton', id: 19009 }, { name: 'Irvine', id: 9361 }, { name: 'Chula Vista', id: 3494 }, { name: 'Fremont', id: 6671 }, { name: 'San Bernardino', id: 16659 }, { name: 'Modesto', id: 12359 }, { name: 'Fontana', id: 6354 }, { name: 'Moreno Valley', id: 12621 }, { name: 'Glendale', id: 7646 }, { name: 'Huntington Beach', id: 9164 }, { name: 'Santa Clarita', id: 17676 }, { name: 'Garden Grove', id: 7381 }, { name: 'Oceanside', id: 13753 }],
  'CO': [{ name: 'Denver', id: 5155 }, { name: 'Colorado Springs', id: 4147 }, { name: 'Aurora', id: 30839 }, { name: 'Fort Collins', id: 7006 }, { name: 'Lakewood', id: 10937 }, { name: 'Thornton', id: 30790 }, { name: 'Arvada', id: 30796 }, { name: 'Westminster', id: 30850 }, { name: 'Pueblo', id: 15932 }, { name: 'Centennial', id: 3327 }, { name: 'Boulder', id: 2025 }, { name: 'Greeley', id: 8215 }, { name: 'Longmont', id: 30791 }, { name: 'Loveland', id: 11858 }],
  'CT': [{ name: 'Hartford', id: 9406 }, { name: 'New Haven', id: 13410 }, { name: 'Stamford', id: 18605 }, { name: 'Bridgeport', id: 2070 }, { name: 'Waterbury', id: 20096 }, { name: 'Norwalk', id: 14493 }, { name: 'Danbury', id: 4768 }, { name: 'New Britain', id: 12956 }, { name: 'Bristol', id: 2175 }, { name: 'Meriden', id: 11851 }, { name: 'West Haven', id: 20545 }, { name: 'Milford', id: 12137 }, { name: 'Middletown', id: 12080 }, { name: 'Norwich', id: 14552 }],
  'DE': [{ name: 'Wilmington', id: 19583 }, { name: 'Dover', id: 5464 }, { name: 'Newark', id: 13035 }, { name: 'Middletown', id: 12010 }, { name: 'Smyrna', id: 17236 }, { name: 'Milford', id: 12109 }, { name: 'Seaford', id: 16499 }, { name: 'Georgetown', id: 7411 }, { name: 'Elsmere', id: 6313 }, { name: 'New Castle', id: 13078 }],
  'FL': [{ name: 'Miami', id: 11458 }, { name: 'Orlando', id: 13655 }, { name: 'Tampa', id: 18142 }, { name: 'Jacksonville', id: 8907 }, { name: 'Fort Lauderdale', id: 6173 }, { name: 'St Petersburg', id: 16164 }, { name: 'Hialeah', id: 7649 }, { name: 'Tallahassee', id: 18046 }, { name: 'Cape Coral', id: 2654 }, { name: 'Fort Myers', id: 6208 }, { name: 'Pembroke Pines', id: 14437 }, { name: 'Hollywood', id: 8176 }, { name: 'Gainesville', id: 6487 }, { name: 'Miramar', id: 11720 }, { name: 'Coral Springs', id: 3744 }, { name: 'Palm Bay', id: 13979 }, { name: 'West Palm Beach', id: 19373 }, { name: 'Clearwater', id: 3344 }, { name: 'Lakeland', id: 9711 }, { name: 'Pompano Beach', id: 15042 }, { name: 'Davie', id: 4292 }, { name: 'Boca Raton', id: 1903 }, { name: 'Sunrise', id: 17814 }, { name: 'Deltona', id: 4476 }, { name: 'Plantation', id: 14883 }],
  'GA': [{ name: 'Atlanta', id: 30756 }, { name: 'Savannah', id: 17651 }, { name: 'Columbus', id: 4901 }, { name: 'Macon', id: 36061 }, { name: 'Athens', id: 36057 }, { name: 'Sandy Springs', id: 17553 }, { name: 'Roswell', id: 17232 }, { name: 'Johns Creek', id: 33537 }, { name: 'Albany', id: 269 }, { name: 'Warner Robins', id: 20204 }, { name: 'Alpharetta', id: 438 }, { name: 'Marietta', id: 12766 }, { name: 'Valdosta', id: 19841 }, { name: 'Smyrna', id: 18261 }, { name: 'Dunwoody', id: 22699 }, { name: 'Brookhaven', id: 35852 }],
  'ID': [{ name: 'Boise', id: 2287 }, { name: 'Meridian', id: 13444 }, { name: 'Nampa', id: 14562 }, { name: 'Idaho Falls', id: 10107 }, { name: 'Pocatello', id: 16430 }, { name: 'Caldwell', id: 3170 }, { name: 'Coeur d Alene', id: 4370 }, { name: 'Twin Falls', id: 20548 }, { name: 'Lewiston', id: 11881 }, { name: 'Post Falls', id: 16610 }, { name: 'Rexburg', id: 17256 }],
  'IL': [{ name: 'Chicago', id: 29470 }, { name: 'Aurora', id: 29459 }, { name: 'Naperville', id: 29501 }, { name: 'Rockford', id: 16655 }, { name: 'Joliet', id: 29490 }, { name: 'Elgin', id: 29477 }, { name: 'Peoria', id: 15268 }, { name: 'Springfield', id: 18387 }, { name: 'Waukegan', id: 19944 }, { name: 'Champaign', id: 3210 }, { name: 'Bloomington', id: 1734 }, { name: 'Decatur', id: 4862 }, { name: 'Evanston', id: 6331 }, { name: 'Schaumburg', id: 29511 }, { name: 'Arlington Heights', id: 29458 }, { name: 'Cicero', id: 3735 }, { name: 'Bolingbrook', id: 29465 }],
  'IN': [{ name: 'Indianapolis', id: 9170 }, { name: 'Fort Wayne', id: 6438 }, { name: 'Evansville', id: 5667 }, { name: 'South Bend', id: 18137 }, { name: 'Carmel', id: 2672 }, { name: 'Fishers', id: 6008 }, { name: 'Bloomington', id: 1558 }, { name: 'Hammond', id: 7930 }, { name: 'Gary', id: 6905 }, { name: 'Lafayette', id: 10406 }, { name: 'Muncie', id: 13386 }, { name: 'Terre Haute', id: 19117 }, { name: 'Kokomo', id: 10307 }, { name: 'Noblesville', id: 14039 }, { name: 'Anderson', id: 370 }, { name: 'Greenwood', id: 7613 }],
  'IA': [{ name: 'Des Moines', id: 5415 }, { name: 'Cedar Rapids', id: 3103 }, { name: 'Davenport', id: 4908 }, { name: 'Sioux City', id: 18687 }, { name: 'Iowa City', id: 9788 }, { name: 'Waterloo', id: 20487 }, { name: 'Ames', id: 477 }, { name: 'West Des Moines', id: 20722 }, { name: 'Council Bluffs', id: 4397 }, { name: 'Ankeny', id: 603 }, { name: 'Dubuque', id: 5768 }, { name: 'Urbandale', id: 20085 }, { name: 'Cedar Falls', id: 3049 }],
  'KS': [{ name: 'Wichita', id: 19878 }, { name: 'Overland Park', id: 13896 }, { name: 'Kansas City', id: 35751 }, { name: 'Topeka', id: 18143 }, { name: 'Olathe', id: 13544 }, { name: 'Lawrence', id: 9865 }, { name: 'Shawnee', id: 16542 }, { name: 'Manhattan', id: 11275 }, { name: 'Lenexa', id: 9995 }, { name: 'Salina', id: 16096 }, { name: 'Hutchinson', id: 8605 }, { name: 'Leavenworth', id: 9894 }, { name: 'Leawood', id: 9914 }],
  'KY': [{ name: 'Louisville', id: 12262 }, { name: 'Lexington', id: 11746 }, { name: 'Bowling Green', id: 2307 }, { name: 'Owensboro', id: 15179 }, { name: 'Covington', id: 4618 }, { name: 'Richmond', id: 16725 }, { name: 'Georgetown', id: 7844 }, { name: 'Florence', id: 7150 }, { name: 'Hopkinsville', id: 9625 }, { name: 'Nicholasville', id: 14534 }, { name: 'Elizabethtown', id: 6247 }, { name: 'Henderson', id: 9123 }, { name: 'Frankfort', id: 7360 }],
  'LA': [{ name: 'New Orleans', id: 14233 }, { name: 'Baton Rouge', id: 1336 }, { name: 'Shreveport', id: 17884 }, { name: 'Lafayette', id: 9927 }, { name: 'Lake Charles', id: 10485 }, { name: 'Kenner', id: 10034 }, { name: 'Bossier City', id: 2310 }, { name: 'Monroe', id: 13252 }, { name: 'Alexandria', id: 235 }, { name: 'Houma', id: 9229 }, { name: 'New Iberia', id: 13991 }, { name: 'Slidell', id: 18101 }, { name: 'Central', id: 32073 }],
  'ME': [{ name: 'Portland', id: 15614 }, { name: 'Lewiston', id: 9823 }, { name: 'Bangor', id: 735 }, { name: 'South Portland', id: 18386 }, { name: 'Auburn', id: 531 }, { name: 'Biddeford', id: 1283 }, { name: 'Augusta', id: 543 }, { name: 'Saco', id: 16583 }, { name: 'Westbrook', id: 20435 }, { name: 'Waterville', id: 20239 }, { name: 'Scarborough', id: 25626 }],
  'MD': [{ name: 'Baltimore', id: 1073 }, { name: 'Columbia', id: 22307 }, { name: 'Germantown', id: 23193 }, { name: 'Silver Spring', id: 26038 }, { name: 'Waldorf', id: 26609 }, { name: 'Frederick', id: 7735 }, { name: 'Ellicott City', id: 22783 }, { name: 'Glen Burnie', id: 23232 }, { name: 'Gaithersburg', id: 7974 }, { name: 'Rockville', id: 17332 }, { name: 'Bethesda', id: 21534 }, { name: 'Dundalk', id: 22637 }, { name: 'Towson', id: 26447 }, { name: 'Bowie', id: 2277 }, { name: 'Aspen Hill', id: 21264 }, { name: 'Wheaton', id: 31343 }],
  'MA': [{ name: 'Boston', id: 1826 }, { name: 'Worcester', id: 20420 }, { name: 'Springfield', id: 17155 }, { name: 'Cambridge', id: 2833 }, { name: 'Lowell', id: 9416 }, { name: 'Brockton', id: 2332 }, { name: 'New Bedford', id: 11459 }, { name: 'Quincy', id: 14424 }, { name: 'Lynn', id: 9515 }, { name: 'Fall River', id: 5932 }, { name: 'Newton', id: 11619 }, { name: 'Somerville', id: 16064 }, { name: 'Lawrence', id: 10799 }, { name: 'Framingham', id: 36114 }, { name: 'Haverhill', id: 7494 }, { name: 'Waltham', id: 18529 }],
  'MI': [{ name: 'Detroit', id: 5665 }, { name: 'Grand Rapids', id: 8694 }, { name: 'Warren', id: 20734 }, { name: 'Ann Arbor', id: 782 }, { name: 'Sterling Heights', id: 19341 }, { name: 'Lansing', id: 11731 }, { name: 'Dearborn', id: 5414 }, { name: 'Livonia', id: 12548 }, { name: 'Canton', id: 2872 }, { name: 'Flint', id: 7380 }, { name: 'Troy', id: 20232 }, { name: 'Westland', id: 20931 }, { name: 'Farmington Hills', id: 7011 }, { name: 'Kalamazoo', id: 10728 }, { name: 'Wyoming', id: 21105 }, { name: 'Rochester Hills', id: 17662 }],
  'MN': [{ name: 'Minneapolis', id: 10943 }, { name: 'Saint Paul', id: 15027 }, { name: 'Rochester', id: 14201 }, { name: 'Duluth', id: 4430 }, { name: 'Bloomington', id: 1735 }, { name: 'Brooklyn Park', id: 2058 }, { name: 'Plymouth', id: 13344 }, { name: 'Woodbury', id: 18242 }, { name: 'Lakeville', id: 8946 }, { name: 'St Cloud', id: 35715 }, { name: 'Eagan', id: 4490 }, { name: 'Maple Grove', id: 10239 }, { name: 'Eden Prairie', id: 4692 }, { name: 'Coon Rapids', id: 3419 }, { name: 'Burnsville', id: 2282 }, { name: 'Blaine', id: 1683 }],
  'MS': [{ name: 'Jackson', id: 9165 }, { name: 'Gulfport', id: 7572 }, { name: 'Hattiesburg', id: 7932 }, { name: 'Southaven', id: 17717 }, { name: 'Biloxi', id: 1643 }, { name: 'Meridian', id: 11907 }, { name: 'Tupelo', id: 18974 }, { name: 'Olive Branch', id: 13994 }, { name: 'Greenville', id: 7442 }, { name: 'Horn Lake', id: 8621 }, { name: 'Pearl', id: 14434 }, { name: 'Madison', id: 11354 }, { name: 'Clinton', id: 3746 }],
  'MO': [{ name: 'Kansas City', id: 35751 }, { name: 'Saint Louis', id: 16661 }, { name: 'Springfield', id: 17886 }, { name: 'Columbia', id: 4058 }, { name: 'Independence', id: 8906 }, { name: 'Lee Summit', id: 10535 }, { name: 'O Fallon', id: 14004 }, { name: 'St Joseph', id: 16552 }, { name: 'St Charles', id: 16428 }, { name: 'Blue Springs', id: 1743 }, { name: 'St Peters', id: 16702 }, { name: 'Florissant', id: 6379 }, { name: 'Joplin', id: 9536 }, { name: 'Chesterfield', id: 3544 }, { name: 'Jefferson City', id: 9413 }],
  'NE': [{ name: 'Omaha', id: 9417 }, { name: 'Lincoln', id: 7163 }, { name: 'Bellevue', id: 1057 }, { name: 'Grand Island', id: 30165 }, { name: 'Kearney', id: 6447 }, { name: 'Fremont', id: 4580 }, { name: 'Hastings', id: 5526 }, { name: 'Norfolk', id: 8829 }, { name: 'North Platte', id: 8908 }, { name: 'Columbus', id: 2607 }, { name: 'Papillion', id: 9720 }, { name: 'La Vista', id: 6766 }],
  'NV': [{ name: 'Las Vegas', id: 10201 }, { name: 'Henderson', id: 8147 }, { name: 'Reno', id: 15627 }, { name: 'North Las Vegas', id: 13363 }, { name: 'Sparks', id: 17527 }, { name: 'Carson City', id: 2499 }, { name: 'Fernley', id: 6411 }, { name: 'Elko', id: 5786 }, { name: 'Mesquite', id: 11737 }, { name: 'Boulder City', id: 1712 }, { name: 'Fallon', id: 6203 }],
  'NH': [{ name: 'Manchester', id: 11504 }, { name: 'Nashua', id: 12918 }, { name: 'Concord', id: 3697 }, { name: 'Derry', id: 22219 }, { name: 'Dover', id: 4861 }, { name: 'Rochester', id: 16704 }, { name: 'Salem', id: 35937 }, { name: 'Merrimack', id: 22480 }, { name: 'Hudson', id: 23554 }, { name: 'Londonderry', id: 23989 }, { name: 'Keene', id: 9977 }, { name: 'Portsmouth', id: 16139 }],
  'NJ': [{ name: 'Newark', id: 13136 }, { name: 'Jersey City', id: 9168 }, { name: 'Paterson', id: 14759 }, { name: 'Elizabeth', id: 5417 }, { name: 'Trenton', id: 18807 }, { name: 'Clifton', id: 3564 }, { name: 'Camden', id: 2570 }, { name: 'Passaic', id: 14646 }, { name: 'Union City', id: 18931 }, { name: 'Bayonne', id: 970 }, { name: 'East Orange', id: 5001 }, { name: 'Vineland', id: 19265 }, { name: 'New Brunswick', id: 13201 }, { name: 'Hoboken', id: 8238 }, { name: 'Perth Amboy', id: 15081 }, { name: 'Plainfield', id: 15325 }, { name: 'West New York', id: 20004 }, { name: 'Hackensack', id: 7312 }, { name: 'Sayreville', id: 16859 }, { name: 'Kearny', id: 9295 }, { name: 'Linden', id: 10296 }, { name: 'Atlantic City', id: 538 }],
  'NY': [{ name: 'New York', id: 30749 }, { name: 'Buffalo', id: 2832 }, { name: 'Rochester', id: 16162 }, { name: 'Syracuse', id: 18606 }, { name: 'Albany', id: 245 }, { name: 'Yonkers', id: 20735 }, { name: 'New Rochelle', id: 13026 }, { name: 'Mount Vernon', id: 12584 }, { name: 'Schenectady', id: 16792 }, { name: 'Utica', id: 19360 }, { name: 'White Plains', id: 20373 }, { name: 'Troy', id: 19127 }, { name: 'Niagara Falls', id: 13156 }, { name: 'Binghamton', id: 1730 }, { name: 'Freeport', id: 7020 }, { name: 'Long Beach', id: 11031 }, { name: 'Spring Valley', id: 17996 }, { name: 'Valley Stream', id: 19403 }, { name: 'Rome', id: 16258 }, { name: 'Ithaca', id: 9667 }, { name: 'Poughkeepsie', id: 15434 }, { name: 'Jamestown', id: 9713 }, { name: 'Elmira', id: 6232 }, { name: 'Middletown', id: 12014 }, { name: 'Auburn', id: 815 }, { name: 'Newburgh', id: 12851 }, { name: 'Saratoga Springs', id: 16733 }],
  'NC': [{ name: 'Charlotte', id: 3105 }, { name: 'Raleigh', id: 35711 }, { name: 'Greensboro', id: 7161 }, { name: 'Durham', id: 4909 }, { name: 'Winston Salem', id: 19017 }, { name: 'Fayetteville', id: 5903 }, { name: 'Cary', id: 35713 }, { name: 'Wilmington', id: 18894 }, { name: 'High Point', id: 35795 }, { name: 'Concord', id: 3663 }, { name: 'Greenville', id: 7181 }, { name: 'Asheville', id: 555 }, { name: 'Gastonia', id: 6588 }, { name: 'Jacksonville', id: 8738 }, { name: 'Chapel Hill', id: 3059 }, { name: 'Huntersville', id: 8466 }, { name: 'Apex', id: 387 }, { name: 'Wake Forest', id: 35710 }, { name: 'Kannapolis', id: 8955 }, { name: 'Burlington', id: 2347 }, { name: 'Rocky Mount', id: 14903 }, { name: 'Hickory', id: 7943 }],
  'OK': [{ name: 'Oklahoma City', id: 14237 }, { name: 'Tulsa', id: 35765 }, { name: 'Norman', id: 13526 }, { name: 'Broken Arrow', id: 35693 }, { name: 'Edmond', id: 5984 }, { name: 'Lawton', id: 10655 }, { name: 'Moore', id: 12602 }, { name: 'Midwest City', id: 12358 }, { name: 'Enid', id: 6157 }, { name: 'Stillwater', id: 17962 }, { name: 'Muskogee', id: 12858 }, { name: 'Bartlesville', id: 35766 }, { name: 'Owasso', id: 14669 }, { name: 'Shawnee', id: 17107 }, { name: 'Ponca City', id: 15469 }],
  'OR': [{ name: 'Portland', id: 30772 }, { name: 'Salem', id: 30778 }, { name: 'Eugene', id: 6142 }, { name: 'Gresham', id: 7995 }, { name: 'Hillsboro', id: 8712 }, { name: 'Beaverton', id: 1432 }, { name: 'Bend', id: 1543 }, { name: 'Medford', id: 11999 }, { name: 'Springfield', id: 17793 }, { name: 'Corvallis', id: 4092 }, { name: 'Albany', id: 30779 }, { name: 'Tigard', id: 18733 }, { name: 'Lake Oswego', id: 30777 }, { name: 'Keizer', id: 9771 }, { name: 'Grants Pass', id: 7804 }, { name: 'Oregon City', id: 14302 }],
  'PA': [{ name: 'Philadelphia', id: 15502 }, { name: 'Pittsburgh', id: 15702 }, { name: 'Allentown', id: 514 }, { name: 'Reading', id: 16305 }, { name: 'Scranton', id: 17652 }, { name: 'Bethlehem', id: 1616 }, { name: 'Lancaster', id: 10496 }, { name: 'Harrisburg', id: 8380 }, { name: 'York', id: 21030 }, { name: 'Altoona', id: 569 }, { name: 'Erie', id: 6172 }, { name: 'Wilkes Barre', id: 20852 }, { name: 'Chester', id: 3444 }, { name: 'State College', id: 18769 }, { name: 'Easton', id: 5583 }, { name: 'Lebanon', id: 10731 }, { name: 'Hazleton', id: 8551 }],
  'RI': [{ name: 'Providence', id: 15272 }, { name: 'Warwick', id: 18869 }, { name: 'Cranston', id: 4953 }, { name: 'Pawtucket', id: 14136 }, { name: 'East Providence', id: 5914 }, { name: 'Woonsocket', id: 20244 }, { name: 'Coventry', id: 35742 }, { name: 'Cumberland', id: 35722 }, { name: 'North Providence', id: 35725 }, { name: 'South Kingstown', id: 35724 }, { name: 'West Warwick', id: 35738 }, { name: 'Johnston', id: 35745 }, { name: 'Newport', id: 12826 }],
  'SC': [{ name: 'Charleston', id: 3478 }, { name: 'Columbia', id: 4149 }, { name: 'Greenville', id: 7891 }, { name: 'Myrtle Beach', id: 12572 }, { name: 'Rock Hill', id: 15797 }, { name: 'Mount Pleasant', id: 12411 }, { name: 'North Charleston', id: 13096 }, { name: 'Spartanburg', id: 17499 }, { name: 'Summerville', id: 17959 }, { name: 'Goose Creek', id: 7598 }, { name: 'Hilton Head Island', id: 8702 }, { name: 'Sumter', id: 17991 }, { name: 'Florence', id: 6637 }, { name: 'Greer', id: 7924 }, { name: 'Anderson', id: 344 }],
  'TN': [{ name: 'Nashville', id: 13415 }, { name: 'Memphis', id: 12260 }, { name: 'Knoxville', id: 10200 }, { name: 'Chattanooga', id: 3641 }, { name: 'Clarksville', id: 3918 }, { name: 'Murfreesboro', id: 13284 }, { name: 'Franklin', id: 7080 }, { name: 'Jackson', id: 9553 }, { name: 'Johnson City', id: 9725 }, { name: 'Bartlett', id: 937 }, { name: 'Hendersonville', id: 8509 }, { name: 'Kingsport', id: 10066 }, { name: 'Collierville', id: 4272 }, { name: 'Smyrna', id: 17754 }, { name: 'Cleveland', id: 3988 }, { name: 'Brentwood', id: 2149 }, { name: 'Spring Hill', id: 18036 }],
  'TX': [{ name: 'Houston', id: 8903 }, { name: 'San Antonio', id: 16657 }, { name: 'Dallas', id: 30794 }, { name: 'Austin', id: 30818 }, { name: 'Fort Worth', id: 30827 }, { name: 'El Paso', id: 6171 }, { name: 'Arlington', id: 1067 }, { name: 'Corpus Christi', id: 35781 }, { name: 'Plano', id: 30868 }, { name: 'Laredo', id: 10568 }, { name: 'Lubbock', id: 11455 }, { name: 'Garland', id: 30821 }, { name: 'Irving', id: 9410 }, { name: 'Amarillo', id: 779 }, { name: 'Grand Prairie', id: 30812 }, { name: 'McKinney', id: 11666 }, { name: 'Frisco', id: 30844 }, { name: 'Brownsville', id: 2776 }, { name: 'Pasadena', id: 14499 }, { name: 'Killeen', id: 9939 }, { name: 'McAllen', id: 11570 }, { name: 'Mesquite', id: 30833 }, { name: 'Midland', id: 12281 }, { name: 'Denton', id: 5145 }, { name: 'Waco', id: 19250 }, { name: 'Carrollton', id: 30825 }, { name: 'Round Rock', id: 30823 }, { name: 'Abilene', id: 243 }, { name: 'Pearland', id: 35717 }, { name: 'Richardson', id: 30861 }, { name: 'Odessa', id: 13775 }],
  'VT': [{ name: 'Burlington', id: 2749 }, { name: 'South Burlington', id: 16951 }, { name: 'Rutland', id: 15764 }, { name: 'Barre', id: 845 }, { name: 'Montpelier', id: 11738 }, { name: 'Winooski', id: 20851 }, { name: 'St Albans', id: 15860 }, { name: 'Newport', id: 12508 }, { name: 'Vergennes', id: 18935 }, { name: 'Middlebury', id: 24069 }],
  'VA': [{ name: 'Virginia Beach', id: 20418 }, { name: 'Norfolk', id: 14757 }, { name: 'Chesapeake', id: 4144 }, { name: 'Richmond', id: 17149 }, { name: 'Arlington', id: 21282 }, { name: 'Newport News', id: 14497 }, { name: 'Alexandria', id: 250 }, { name: 'Hampton', id: 8900 }, { name: 'Roanoke', id: 17419 }, { name: 'Portsmouth', id: 16406 }, { name: 'Suffolk', id: 19336 }, { name: 'Lynchburg', id: 12180 }, { name: 'Harrisonburg', id: 9073 }, { name: 'Charlottesville', id: 3867 }, { name: 'Danville', id: 5505 }, { name: 'Manassas', id: 12539 }, { name: 'Petersburg', id: 15890 }, { name: 'Fredericksburg', id: 30875 }, { name: 'Leesburg', id: 11452 }, { name: 'Salem', id: 17881 }],
  'WA': [{ name: 'Seattle', id: 16163 }, { name: 'Spokane', id: 17154 }, { name: 'Tacoma', id: 17887 }, { name: 'Vancouver', id: 18823 }, { name: 'Bellevue', id: 1387 }, { name: 'Kent', id: 9016 }, { name: 'Everett', id: 5832 }, { name: 'Renton', id: 14975 }, { name: 'Federal Way', id: 6064 }, { name: 'Spokane Valley', id: 17190 }, { name: 'Kirkland', id: 9148 }, { name: 'Bellingham', id: 1411 }, { name: 'Auburn', id: 29438 }, { name: 'Kennewick', id: 8974 }, { name: 'Redmond', id: 14913 }, { name: 'Marysville', id: 11194 }, { name: 'Pasco', id: 13835 }, { name: 'Lakewood', id: 9655 }, { name: 'Yakima', id: 20098 }, { name: 'Olympia', id: 13223 }, { name: 'Sammamish', id: 15735 }, { name: 'Burien', id: 2291 }],
  'WV': [{ name: 'Charleston', id: 3787 }, { name: 'Huntington', id: 10028 }, { name: 'Morgantown', id: 14431 }, { name: 'Parkersburg', id: 15972 }, { name: 'Wheeling', id: 20969 }, { name: 'Weirton', id: 20855 }, { name: 'Fairmont', id: 6783 }, { name: 'Martinsburg', id: 13430 }, { name: 'Beckley', id: 1425 }, { name: 'Clarksburg', id: 4048 }, { name: 'South Charleston', id: 19086 }, { name: 'Teays Valley', id: 26518 }],
  'WI': [{ name: 'Milwaukee', id: 35759 }, { name: 'Madison', id: 12257 }, { name: 'Green Bay', id: 7928 }, { name: 'Kenosha', id: 9959 }, { name: 'Racine', id: 16901 }, { name: 'Appleton', id: 35753 }, { name: 'Waukesha', id: 20757 }, { name: 'Eau Claire', id: 5746 }, { name: 'Oshkosh', id: 15603 }, { name: 'Janesville', id: 9601 }, { name: 'West Allis', id: 20870 }, { name: 'La Crosse', id: 10404 }, { name: 'Sheboygan', id: 18599 }, { name: 'Wauwatosa', id: 20803 }, { name: 'Fond du Lac', id: 6733 }, { name: 'Brookfield', id: 2575 }, { name: 'New Berlin', id: 14599 }, { name: 'Beloit', id: 1708 }, { name: 'Greenfield', id: 7975 }, { name: 'Manitowoc', id: 12402 }],
};

// States to process (excluding blocked states)
const STATES_TO_PROCESS = Object.keys(STATE_CITIES);

// Filter function for homes (same as live-scrape.js)
function filterHome(home, stateCode) {
  const MIN_PRICE = 50000, MAX_PRICE = 500000, MIN_BEDS = 3, MIN_SQFT = 1000;
  const price = home.price?.value || home.price || 0;
  const beds = home.beds || 0;
  const sqft = home.sqFt?.value || home.sqFt || 0;
  const hoa = home.hoa?.value || home.hoa || 0;

  // Filter by state
  const homeState = (home.state || '').toUpperCase();
  if (homeState && homeState !== stateCode) return false;

  if (price < MIN_PRICE || price > MAX_PRICE) return false;
  if (beds < MIN_BEDS) return false;
  if (sqft < MIN_SQFT) return false;

  const hoaValue = typeof hoa === 'object' ? 0 : (hoa || 0);
  if (hoaValue > 0) return false;

  // Exclude 55+ communities
  const remarks = (home.listingRemarks || '').toLowerCase();
  const seniorKeywords = ['55+', '55 +', 'senior', 'age restricted', 'retirement', 'over 55', 'active adult'];
  if (seniorKeywords.some(kw => remarks.includes(kw))) return false;

  return true;
}

// Process a single city using the API
async function runCity(stateCode, city) {
  console.log(`\n[Redfin] === City: ${city.name}, ${stateCode} ===`);

  try {
    // Use high limit to get ALL available homes from each city (API supports up to ~5000)
    const homes = await fetchListingsFromApi(city.id, stateCode, { limit: 5000 });
    console.log(`[Redfin] API returned ${homes.length} homes for ${city.name}`);

    let saved = 0;
    let filtered = 0;

    for (const home of homes) {
      if (control.abort) {
        console.log('[Redfin] Abort signal received');
        break;
      }
      // NOTE: We do NOT check batch limit here - we complete ALL cities in the state first

      // Apply filters
      if (!filterHome(home, stateCode)) {
        filtered++;
        continue;
      }

      // Extract data from API response
      const streetLine = home.streetLine?.value || home.streetLine || '';
      const cityName = home.city || city.name;
      const state = home.state || stateCode;
      const zip = home.zip || '';
      const price = home.price?.value || home.price || null;
      const beds = home.beds || null;
      const baths = home.baths || null;
      const sqft = home.sqFt?.value || home.sqFt || null;
      const url = home.url ? `https://www.redfin.com${home.url}` : null;
      const mlsId = home.mlsId?.value || home.mlsId || null;

      const fullAddress = `${streetLine}, ${cityName}, ${state} ${zip}`.trim();

      // Agent info from API (if available)
      let agentName = home.listingAgent?.name || null;
      let agentPhone = null;
      let agentEmail = null;
      let brokerage = home.brokerName || null;

      // Optional: Deep scrape for agent details (slower)
      if (USE_AGENT_ENRICHMENT && url) {
        try {
          const enriched = await extractAgentDetails(url);
          if (enriched) {
            agentName = enriched.agentName || agentName;
            agentPhone = enriched.agentPhone || agentPhone;  // Fixed: was 'phone', should be 'agentPhone'
            agentEmail = enriched.email || agentEmail;
            brokerage = enriched.brokerage || brokerage;
          }
        } catch (e) {
          // Silent fail
        }
      }

      // Save to database
      await upsertRaw({
        address: fullAddress,
        city: cityName,
        state: state,
        zip: zip,
        price,
        beds,
        baths,
        sqft,
        raw: home,
        agentName,
        agentEmail,
        agentPhone,
        brokerage
      });

      await upsertProperty({
        prop_id: mlsId || `redfin-${home.propertyId || home.listingId || Date.now()}`,
        address: fullAddress,
        city: cityName,
        state: state,
        zip: zip,
        price,
        beds,
        baths,
        sqft,
        built: home.yearBuilt?.value || home.yearBuilt || null,
        raw: home,
        agentName,
        agentEmail,
        agentPhone,
        brokerage,
      });

      saved++;
      if (saved % 20 === 0) {
        console.log(`[Redfin] Progress: ${saved} saved, ${filtered} filtered`);
      }
    }

    console.log(`[Redfin] City ${city.name} done: ${saved} saved, ${filtered} filtered`);
    return saved;
  } catch (err) {
    console.error(`[Redfin] Error processing ${city.name}: ${err.message}`);
    return 0;
  }
}

// Main runner - process all states and cities
export async function runAllCities() {
  console.log(`[Redfin] Starting API-based scraping for ${STATES_TO_PROCESS.length} states`);

  // Log cycle info
  const existingProgress = await getProgress();
  console.log(`[Redfin] Current cycle: ${existingProgress.cycleCount || 0}, Last completed: ${existingProgress.lastCycleCompletedAt || 'never'}`);

  // SAFEGUARD: Check pending AMV before scraping - if already have 500+, skip scraping
  // This prevents piling up addresses after crashes/restarts
  const BATCH_THRESHOLD = 500;
  try {
    const pendingAMV = await ScrapedDeal.countDocuments({
      source: 'redfin',
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    });
    if (pendingAMV >= BATCH_THRESHOLD) {
      console.log(`[Redfin] ⏭️ SKIPPING SCRAPE: Already have ${pendingAMV} pending AMV addresses (threshold: ${BATCH_THRESHOLD}). Process AMV first!`);
      return; // Exit - let BofA process pending first
    }
    console.log(`[Redfin] Pending AMV check passed: ${pendingAMV}/${BATCH_THRESHOLD} - proceeding with scrape`);
  } catch (e) {
    console.warn('[Redfin] Could not check pending AMV count:', e?.message);
  }

  const progress = await getProgress();
  const startStateIndex = progress.currentStateIndex || 0;
  const processedCitiesSet = new Set(progress.processedCities || []);

  console.log(`[Redfin] Resuming from state index ${startStateIndex}`);
  console.log(`[Redfin] Already processed ${processedCitiesSet.size} cities`);

  let totalSaved = 0;

  try {
    for (let stateIdx = startStateIndex; stateIdx < STATES_TO_PROCESS.length; stateIdx++) {
      const stateCode = STATES_TO_PROCESS[stateIdx];
      const cities = STATE_CITIES[stateCode] || [];

      if (control.abort) {
        console.log('[Redfin] Abort signal received, stopping');
        await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });
        break;
      }

      console.log(`\n[Redfin] === State ${stateIdx + 1}/${STATES_TO_PROCESS.length}: ${stateCode} (${cities.length} cities) ===`);
      await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });

      // Process ALL cities in this state before checking batch limit
      for (const city of cities) {
        const cityKey = `${stateCode}-${city.id}`;

        if (processedCitiesSet.has(cityKey)) {
          continue;
        }

        if (control.abort) {
          break;
        }

        const saved = await runCity(stateCode, city);
        totalSaved += saved;

        await markCityProcessed(cityKey);
        processedCitiesSet.add(cityKey);

        // Check batch limit after EACH city - if 500+ addresses saved, pause for AMV
        if (shouldPauseScraping()) {
          console.log(`[Redfin] Batch limit reached after city ${city.name}, ${stateCode} - pausing for AMV phase`);
          await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });
          break;
        }

        // ADDITIONAL CHECK: Also check actual database pending count to prevent pileup
        try {
          const currentPending = await ScrapedDeal.countDocuments({
            source: 'redfin',
            $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
          });
          if (currentPending >= BATCH_THRESHOLD) {
            console.log(`[Redfin] ⚠️ Database pending AMV reached ${currentPending}/${BATCH_THRESHOLD} - pausing for AMV phase`);
            await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });
            break;
          }
        } catch (dbErr) {
          console.warn('[Redfin] Could not check pending AMV:', dbErr?.message);
        }

        // Small delay between cities
        await new Promise(r => setTimeout(r, 1000));
      }

      // If batch limit was reached inside city loop, break out of state loop too
      if (shouldPauseScraping()) {
        break;
      }

      // Also check database pending count
      try {
        const currentPending = await ScrapedDeal.countDocuments({
          source: 'redfin',
          $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
        });
        if (currentPending >= BATCH_THRESHOLD) {
          console.log(`[Redfin] ⚠️ Database pending AMV reached ${currentPending}/${BATCH_THRESHOLD} - breaking state loop`);
          break;
        }
      } catch (dbErr) {
        // Non-fatal
      }

      if (control.abort) {
        break;
      }
    }

    // Check if completed all states - reset and start again
    const progress2 = await getProgress();
    if ((progress2.currentStateIndex || 0) >= STATES_TO_PROCESS.length - 1 && !control.abort && !shouldPauseScraping()) {
      console.log('[Redfin] ✅ Completed FULL CYCLE through all states!');
      console.log('[Redfin] 🔄 Resetting progress to start a new cycle...');
      // Increment cycle count and reset progress for next cycle
      await ScraperProgress.updateOne(
        { scraper: 'redfin' },
        {
          $inc: { cycleCount: 1 },
          $set: {
            currentState: null,
            currentCityIndex: 0,
            currentStateIndex: 0,
            processedCities: [],
            cycleStartedAt: new Date(),
            lastCycleCompletedAt: new Date(),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      console.log('[Redfin] ✅ Ready for next cycle!');
    }
  } finally {
    await closeSharedBrowser();
    console.log(`[Redfin] Finished. Total saved: ${totalSaved}`);
  }
}
