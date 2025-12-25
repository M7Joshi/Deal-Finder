// Live scraping endpoint - fetches addresses directly from Privy.pro
// Saves to ScrapedDeal for Pending AMV display

import express from 'express';
import ScrapedDeal from '../models/ScrapedDeal.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import PrivyBot from '../vendors/privy/privyBot.js';
import * as sessionStore from '../vendors/privy/auth/sessionStore.js';
import { applyFilters } from '../vendors/privy/filters/filterService.js';
import {
  propertyListContainerSelector,
  propertyContentSelector,
  addressLine1Selector,
  addressLine2Selector,
  priceSelector,
  agentNameSelector,
  agentEmailSelector,
  agentPhoneSelector,
  propertyStatsSelector,
  openDetailSelector
} from '../vendors/privy/config/selection.js';

const router = express.Router();
const L = log.child('live-scrape');

// Extract state code from address string
// Handles various formats: "123 Main St, City, XX 12345", "City, XX", "City XX 12345", etc.
function extractStateFromAddress(address) {
  if (!address) return null;

  // Pattern 1: State before zip code (most common): ", CA 90210" or " CA 90210"
  const stateZipMatch = address.match(/[,\s]\s*([A-Z]{2})\s+\d{5}/);
  if (stateZipMatch) {
    return stateZipMatch[1];
  }

  // Pattern 2: State at end with optional zip: ", CA" or ", CA 90210"
  const stateEndMatch = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?$/);
  if (stateEndMatch) {
    return stateEndMatch[1];
  }

  // Pattern 3: State anywhere followed by zip: "CA 90210"
  const stateAnywhereMatch = address.match(/\b([A-Z]{2})\s+\d{5}\b/);
  if (stateAnywhereMatch) {
    return stateAnywhereMatch[1];
  }

  // Pattern 4: Just two capital letters at the end (could be state)
  const lastTwoLetters = address.match(/\b([A-Z]{2})$/);
  if (lastTwoLetters) {
    return lastTwoLetters[1];
  }

  return null;
}

// Singleton PrivyBot instance to maintain session across requests
let sharedPrivyBot = null;
let botInitializing = false;
let lastScrapedState = null; // Track last state to detect state changes

// Request queue to prevent concurrent scraping (browser can only handle one at a time)
let scrapingInProgress = false;
let scrapingQueue = [];

async function waitForScrapingSlot(stateCode) {
  if (!scrapingInProgress) {
    scrapingInProgress = true;
    return true;
  }

  // Already scraping - queue this request
  return new Promise((resolve) => {
    L.info(`Queuing request for ${stateCode}, scraping already in progress`);
    scrapingQueue.push({ stateCode, resolve });
  });
}

function releaseScrapingSlot() {
  if (scrapingQueue.length > 0) {
    const next = scrapingQueue.shift();
    L.info(`Processing queued request for ${next.stateCode}`);
    next.resolve(true);
  } else {
    scrapingInProgress = false;
  }
}

// Mock property generation removed - we now return errors instead of fake data

/**
 * Scrape agent details (name, phone, brokerage) from a Redfin property detail page
 * @param {string} propertyUrl - Full Redfin property URL
 * @returns {Object} Agent details { agentName, agentPhone, brokerage }
 */
async function scrapeRedfinAgentDetails(propertyUrl) {
  try {
    const axios = (await import('axios')).default;

    const response = await axios.get(propertyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.redfin.com/',
        'Cache-Control': 'no-cache'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const html = response.data;
    let agentName = null;
    let agentPhone = null;
    let agentEmail = null;
    let brokerage = null;

    // Method 1: Extract from embedded JSON data in the page
    // Redfin embeds listing data as JSON in the HTML - handles both escaped (\") and non-escaped (") quotes
    // Pattern: listingAgentName":"Name" OR listingAgentName\":\"Name\"
    const agentNameMatch = html.match(/listingAgentName\\?":\\?"([^"\\]+)/);
    if (agentNameMatch && agentNameMatch[1]) {
      agentName = agentNameMatch[1].trim();
    }

    const agentPhoneMatch = html.match(/listingAgentNumber\\?":\\?"([^"\\]+)/);
    if (agentPhoneMatch && agentPhoneMatch[1]) {
      agentPhone = agentPhoneMatch[1].trim();
    }

    // Extract agent email from JSON - pattern: "agentEmailAddress":"email@domain.com"
    const agentEmailMatch = html.match(/agentEmailAddress\\?":\\?"([^"\\]+@[^"\\]+)/);
    if (agentEmailMatch && agentEmailMatch[1]) {
      agentEmail = agentEmailMatch[1].trim();
    }

    // Method 1b: Extract email from HTML contactEmail link - <a class="contactEmail" href="mailto:xxx@xxx.com">
    if (!agentEmail) {
      const contactEmailMatch = html.match(/class="contactEmail"[^>]*href="mailto:([^"]+)"/);
      if (contactEmailMatch && contactEmailMatch[1]) {
        agentEmail = contactEmailMatch[1].split('?')[0].trim();
      }
    }

    // Method 1c: Extract email from any mailto link in agent contact section
    if (!agentEmail) {
      const mailtoMatch = html.match(/href="mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
      if (mailtoMatch && mailtoMatch[1]) {
        // Exclude generic redfin emails
        const email = mailtoMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = mailtoMatch[1].trim();
        }
      }
    }

    // Method 1d: Extract email from "Contact: email@domain.com, phone" pattern (plain text)
    if (!agentEmail) {
      const contactTextMatch = html.match(/Contact:(?:\s|<!--.*?-->)*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (contactTextMatch && contactTextMatch[1]) {
        const email = contactTextMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactTextMatch[1].trim();
        }
      }
    }

    // Method 1e: Extract any email near agent/listing text as last resort
    if (!agentEmail) {
      // Look for email addresses that appear after "Listed by" or near agent info
      const agentSectionMatch = html.match(/Listed by[^<]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (agentSectionMatch && agentSectionMatch[1]) {
        const email = agentSectionMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = agentSectionMatch[1].trim();
        }
      }
    }

    // Method 2: Try alternative JSON patterns (agentName in listingAgents array)
    if (!agentName) {
      const altNameMatch = html.match(/agentName\\?":\\?"([^"\\]+)/);
      if (altNameMatch && altNameMatch[1]) {
        agentName = altNameMatch[1].trim();
      }
    }

    if (!agentPhone) {
      const altPhoneMatch = html.match(/agentPhone\\?":\\?"([^"\\]+)/);
      if (altPhoneMatch && altPhoneMatch[1]) {
        agentPhone = altPhoneMatch[1].trim();
      }
    }

    // Method 3: Extract brokerage from JSON
    const brokerageMatch = html.match(/listingBrokerName\\?":\\?"([^"\\]+)/);
    if (brokerageMatch && brokerageMatch[1]) {
      brokerage = brokerageMatch[1].trim();
    }

    // Method 4: Try to find in dataSourceDescription
    if (!brokerage) {
      const altBrokerageMatch = html.match(/dataSourceName\\?":\\?"([^"\\]+)/);
      if (altBrokerageMatch && altBrokerageMatch[1]) {
        brokerage = altBrokerageMatch[1].trim();
      }
    }

    // Method 5: Fallback - Look for "Listed by" pattern in plain text
    if (!agentName) {
      const listedByMatch = html.match(/Listed by\s+([A-Za-z\s]+?)(?:\s*[•·]|\s*<|$)/);
      if (listedByMatch && listedByMatch[1]) {
        agentName = listedByMatch[1].trim();
      }
    }

    // Method 6: Extract phone from page if still not found (look for standard phone format)
    if (!agentPhone) {
      // Find phone numbers in format (XXX) XXX-XXXX or XXX-XXX-XXXX
      const phonePatterns = html.match(/["'>](\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})["'<]/g);
      if (phonePatterns && phonePatterns.length > 0) {
        // Get the first valid phone that's not a random number
        for (const match of phonePatterns) {
          const phone = match.replace(/["'<>]/g, '').trim();
          if (/^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(phone)) {
            agentPhone = phone;
            break;
          }
        }
      }
    }

    L.info(`Scraped agent from ${propertyUrl}: ${agentName || 'N/A'}, ${agentPhone || 'N/A'}, ${agentEmail || 'N/A'}`);

    return {
      agentName: agentName || null,
      agentPhone: agentPhone || null,
      agentEmail: agentEmail || null,
      brokerage: brokerage || null,
      scraped: true
    };

  } catch (error) {
    L.warn(`Failed to scrape agent details from ${propertyUrl}: ${error.message}`);
    return {
      agentName: null,
      agentPhone: null,
      agentEmail: null,
      brokerage: null,
      scraped: false,
      error: error.message
    };
  }
}

/**
 * Enrich multiple properties with agent details (with concurrency control)
 * @param {Array} properties - Array of property objects with url field
 * @param {number} concurrency - Max concurrent requests (default: 3)
 * @returns {Array} Properties enriched with agent details
 */
async function enrichPropertiesWithAgentDetails(properties, concurrency = 3) {
  const enrichedProperties = [...properties];

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < enrichedProperties.length; i += concurrency) {
    const batch = enrichedProperties.slice(i, i + concurrency);
    const batchPromises = batch.map(async (prop, batchIndex) => {
      const index = i + batchIndex;
      if (prop.url) {
        L.info(`Enriching agent details for property ${index + 1}/${enrichedProperties.length}: ${prop.fullAddress}`);
        const agentDetails = await scrapeRedfinAgentDetails(prop.url);
        enrichedProperties[index] = {
          ...enrichedProperties[index],
          agentName: agentDetails.agentName || enrichedProperties[index].agentName,
          agentPhone: agentDetails.agentPhone,
          agentEmail: agentDetails.agentEmail,
          brokerage: agentDetails.brokerage,
          agentEnriched: agentDetails.scraped
        };
      }
    });

    await Promise.all(batchPromises);

    // Small delay between batches to be respectful to Redfin's servers
    if (i + concurrency < enrichedProperties.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return enrichedProperties;
}

// Extended cities per state for Privy searches - MORE cities for better coverage
const PRIVY_STATE_CITIES = {
  'AL': ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Gadsden'],
  'AK': ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer'],
  'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler', 'Gilbert', 'Glendale', 'Tempe', 'Peoria', 'Surprise', 'Yuma', 'Flagstaff', 'Goodyear', 'Avondale'],
  'AR': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'Rogers', 'Conway', 'North Little Rock', 'Bentonville', 'Pine Bluff', 'Hot Springs'],
  'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista', 'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Moreno Valley', 'Glendale', 'Huntington Beach', 'Santa Clarita', 'Garden Grove', 'Oceanside'],
  'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland'],
  'CT': ['Hartford', 'New Haven', 'Stamford', 'Bridgeport', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'West Haven', 'Milford', 'Middletown', 'Norwich'],
  'DE': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
  'FL': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St Petersburg', 'Hialeah', 'Tallahassee', 'Cape Coral', 'Fort Myers', 'Pembroke Pines', 'Hollywood', 'Gainesville', 'Miramar', 'Coral Springs', 'Palm Bay', 'West Palm Beach', 'Clearwater', 'Lakeland', 'Pompano Beach', 'Davie', 'Boca Raton', 'Sunrise', 'Deltona', 'Plantation'],
  'GA': ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Macon', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta', 'Marietta', 'Valdosta', 'Smyrna', 'Dunwoody', 'Brookhaven'],
  'HI': ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani Town', 'Kahului', 'Ewa Gentry', 'Kihei'],
  'ID': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell', 'Coeur d Alene', 'Twin Falls', 'Lewiston', 'Post Falls', 'Rexburg'],
  'IL': ['Chicago', 'Aurora', 'Naperville', 'Rockford', 'Joliet', 'Elgin', 'Peoria', 'Springfield', 'Waukegan', 'Champaign', 'Bloomington', 'Decatur', 'Evanston', 'Schaumburg', 'Arlington Heights', 'Cicero', 'Bolingbrook'],
  'IN': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute', 'Kokomo', 'Noblesville', 'Anderson', 'Greenwood'],
  'IA': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Ames', 'West Des Moines', 'Council Bluffs', 'Ankeny', 'Dubuque', 'Urbandale', 'Cedar Falls'],
  'KS': ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina', 'Hutchinson', 'Leavenworth', 'Leawood'],
  'KY': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville', 'Elizabethtown', 'Henderson', 'Frankfort'],
  'LA': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma', 'New Iberia', 'Slidell', 'Central'],
  'ME': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Augusta', 'Saco', 'Westbrook', 'Waterville', 'Scarborough'],
  'MD': ['Baltimore', 'Columbia', 'Germantown', 'Silver Spring', 'Waldorf', 'Frederick', 'Ellicott City', 'Glen Burnie', 'Gaithersburg', 'Rockville', 'Bethesda', 'Dundalk', 'Towson', 'Bowie', 'Aspen Hill', 'Wheaton'],
  'MA': ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'New Bedford', 'Quincy', 'Lynn', 'Fall River', 'Newton', 'Somerville', 'Lawrence', 'Framingham', 'Haverhill', 'Waltham'],
  'MI': ['Detroit', 'Grand Rapids', 'Warren', 'Ann Arbor', 'Sterling Heights', 'Lansing', 'Dearborn', 'Livonia', 'Clinton Township', 'Canton', 'Flint', 'Troy', 'Westland', 'Farmington Hills', 'Kalamazoo', 'Wyoming', 'Rochester Hills'],
  'MN': ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington', 'Brooklyn Park', 'Plymouth', 'Woodbury', 'Lakeville', 'St Cloud', 'Eagan', 'Maple Grove', 'Eden Prairie', 'Coon Rapids', 'Burnsville', 'Blaine'],
  'MS': ['Jackson', 'Gulfport', 'Hattiesburg', 'Southaven', 'Biloxi', 'Meridian', 'Tupelo', 'Olive Branch', 'Greenville', 'Horn Lake', 'Pearl', 'Madison', 'Clinton'],
  'MO': ['Kansas City', 'Saint Louis', 'Springfield', 'Columbia', 'Independence', 'Lee Summit', 'O Fallon', 'St Joseph', 'St Charles', 'Blue Springs', 'St Peters', 'Florissant', 'Joplin', 'Chesterfield', 'Jefferson City'],
  'MT': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City'],
  'NE': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'North Platte', 'Columbus', 'Papillion', 'La Vista'],
  'NV': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City', 'Fallon'],
  'NH': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Hudson', 'Londonderry', 'Keene', 'Bedford', 'Portsmouth'],
  'NJ': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Clifton', 'Camden', 'Passaic', 'Union City', 'Bayonne', 'East Orange', 'Vineland', 'New Brunswick', 'Hoboken', 'Perth Amboy', 'Plainfield', 'West New York', 'Hackensack', 'Sayreville', 'Kearny', 'Linden', 'Atlantic City'],
  'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Clovis', 'Hobbs', 'Alamogordo', 'Carlsbad', 'Gallup', 'Deming', 'Los Lunas'],
  'NY': ['New York', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Troy', 'Niagara Falls', 'Binghamton', 'Freeport', 'Long Beach', 'Spring Valley', 'Valley Stream', 'Rome', 'Ithaca', 'Poughkeepsie', 'Jamestown', 'Elmira', 'Middletown', 'Auburn', 'Newburgh', 'Saratoga Springs'],
  'NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Greenville', 'Asheville', 'Gastonia', 'Jacksonville', 'Chapel Hill', 'Huntersville', 'Apex', 'Wake Forest', 'Kannapolis', 'Burlington', 'Rocky Mount', 'Hickory'],
  'ND': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton'],
  'OH': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain', 'Hamilton', 'Springfield', 'Kettering', 'Elyria', 'Lakewood', 'Cuyahoga Falls', 'Euclid', 'Dublin', 'Middletown', 'Newark', 'Mansfield', 'Mentor'],
  'OK': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Muskogee', 'Bartlesville', 'Owasso', 'Shawnee', 'Ponca City'],
  'OR': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Grants Pass', 'Oregon City'],
  'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Altoona', 'Erie', 'Wilkes Barre', 'Chester', 'State College', 'Easton', 'Lebanon', 'Hazleton'],
  'RI': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown', 'West Warwick', 'Johnston', 'Newport'],
  'SC': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach', 'Rock Hill', 'Mount Pleasant', 'North Charleston', 'Spartanburg', 'Summerville', 'Goose Creek', 'Hilton Head Island', 'Sumter', 'Florence', 'Greer', 'Anderson'],
  'SD': ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Vermillion', 'Spearfish', 'Brandon'],
  'TN': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett', 'Hendersonville', 'Kingsport', 'Collierville', 'Smyrna', 'Cleveland', 'Brentwood', 'Spring Hill'],
  'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Garland', 'Irving', 'Amarillo', 'Grand Prairie', 'McKinney', 'Frisco', 'Brownsville', 'Pasadena', 'Killeen', 'McAllen', 'Mesquite', 'Midland', 'Denton', 'Waco', 'Carrollton', 'Round Rock', 'Abilene', 'Pearland', 'Richardson', 'Odessa'],
  'UT': ['Salt Lake City', 'West Valley City', 'Provo', 'Ogden', 'West Jordan', 'Sandy', 'Orem', 'St George', 'Layton', 'South Jordan', 'Lehi', 'Millcreek', 'Taylorsville', 'Logan', 'Murray', 'Draper'],
  'VT': ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier', 'Winooski', 'St Albans', 'Newport', 'Vergennes', 'Middlebury'],
  'VA': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Arlington', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg', 'Harrisonburg', 'Charlottesville', 'Danville', 'Manassas', 'Petersburg', 'Fredericksburg', 'Leesburg', 'Salem'],
  'WA': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Federal Way', 'Spokane Valley', 'Kirkland', 'Bellingham', 'Auburn', 'Kennewick', 'Redmond', 'Marysville', 'Pasco', 'Lakewood', 'Yakima', 'Olympia', 'Sammamish', 'Burien'],
  'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg', 'South Charleston', 'Teays Valley'],
  'WI': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh', 'Janesville', 'West Allis', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'Brookfield', 'New Berlin', 'Beloit', 'Greenfield', 'Manitowoc'],
  'WY': ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Cody', 'Jackson', 'Rawlins']
};

// Build Privy URL for a city - EXACT parameters from working Privy URL
// This URL includes ALL filters so we can navigate directly without using filter modal
function buildPrivyUrl(city, stateCode, cacheBust = true) {
  const base = 'https://app.privy.pro/dashboard';
  const params = new URLSearchParams({
    update_history: 'true',
    search_text: `${city}, ${stateCode}`,
    location_type: 'city',
    include_surrounding: 'true',
    project_type: 'buy_hold',
    spread_type: 'umv',
    spread: '50',
    isLTRsearch: 'false',
    preferred_only: 'false',
    list_price_from: '20000',
    list_price_to: '600000',
    price_per_sqft_from: '0',
    beds_from: '3',
    sqft_from: '1000',
    hoa: 'no',  // FIXED: was 'Any', now 'no' for no HOA
    basement: 'Any',
    include_condo: 'false',
    include_attached: 'false',
    include_detached: 'true',
    include_multi_family: 'false',
    include_active: 'true',
    include_under_contract: 'false',
    include_sold: 'false',
    include_pending: 'false',
    date_range: 'all',
    source: 'Any',
    sort_by: 'days-on-market',
    sort_dir: 'asc'
  });
  // Add cache-busting timestamp to force Privy to fetch fresh data
  if (cacheBust) {
    params.set('_t', Date.now().toString());
  }
  return `${base}?${params.toString()}`;
}

/**
 * GET /api/live-scrape/privy
 *
 * Scrapes addresses LIVE from Privy.pro by looping through EACH CITY in the state
 * Continues fetching from city to city until the requested limit is reached
 *
 * Query params:
 *   - state: State code (e.g., CA, NY) - REQUIRED
 *   - limit: Max total addresses to return (default: 100)
 */
// Maximum retry attempts for recoverable errors (detached frame, session, connection)
const MAX_SCRAPE_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Helper to check if error is recoverable (can be retried)
function isRecoverableError(errorMsg) {
  const msg = (errorMsg || '').toLowerCase();
  return msg.includes('session') || msg.includes('sign_in') || msg.includes('login') ||
         msg.includes('detached') || msg.includes('connection') || msg.includes('protocol error') ||
         msg.includes('target closed') || msg.includes('browser') || msg.includes('execution context') ||
         msg.includes('timeout') || msg.includes('timed out');
}

// Helper to reset the shared bot
async function resetSharedBot() {
  if (sharedPrivyBot) {
    try { await sharedPrivyBot.close(); } catch {}
  }
  sharedPrivyBot = null;
  botInitializing = false;
}

router.get('/privy', requireAuth, async (req, res) => {
  const { state, limit = 100, autoBofa = 'false', enrichAgent = 'true' } = req.query;
  const shouldAutoBofa = autoBofa === 'true' || autoBofa === '1';
  const shouldEnrichAgent = enrichAgent === 'true' || enrichAgent === '1';

  if (!state) {
    return res.status(400).json({ ok: false, error: 'State parameter is required (e.g., state=NJ)' });
  }

  const stateUpper = state.toUpperCase();
  const limitNum = parseInt(limit) || 100;

  // Get ALL cities for this state - we'll loop through them
  // SORT ALPHABETICALLY to ensure consistent, thorough coverage (A to Z)
  const rawCities = PRIVY_STATE_CITIES[stateUpper] || [];
  const stateCities = [...rawCities].sort((a, b) => a.localeCompare(b));
  if (stateCities.length === 0) {
    return res.status(400).json({ ok: false, error: `No cities configured for state ${stateUpper}` });
  }

  // Wait for scraping slot (only one scrape can run at a time)
  await waitForScrapingSlot(stateUpper);

  // Retry loop for recoverable errors
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_SCRAPE_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        L.info(`Retry attempt ${attempt}/${MAX_SCRAPE_RETRIES} for ${stateUpper} scrape`);
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }

      L.info(`Starting MULTI-CITY Privy scrape for ${stateUpper}`, {
        state: stateUpper,
        limit: limitNum,
        totalCities: stateCities.length,
        cities: stateCities.slice(0, 5).join(', ') + (stateCities.length > 5 ? '...' : ''),
        attempt: attempt
      });

      // Global tracking across all cities
      const globalAddresses = [];
      const citiesScraped = [];
      const seenAddressKeys = new Set();
      let consecutiveEmptyCities = 0; // Track cities with 0 new addresses for early exit

    // CRITICAL: ALWAYS reset bot to avoid stale map data from Privy's aggressive caching
    // This is the nuclear option - completely restart the browser for each scrape request
    // to ensure Privy's SPA state is completely fresh
    if (sharedPrivyBot) {
      L.info(`Resetting bot for fresh scrape (current state: ${stateUpper}, previous: ${lastScrapedState || 'none'})`);
      try { await sharedPrivyBot.close(); } catch {}
      sharedPrivyBot = null;
      botInitializing = false;
      // Small delay to ensure browser is fully closed
      await new Promise(r => setTimeout(r, 500));
    }

    // Use shared bot instance to maintain session
    if (!sharedPrivyBot && !botInitializing) {
      botInitializing = true;
      L.info('Creating new PrivyBot instance...');
      try {
        sharedPrivyBot = new PrivyBot();
        await sharedPrivyBot.init();

        const hasFreshSession = sessionStore.hasFreshPrivySession(24 * 60 * 60 * 1000);
        if (hasFreshSession) {
          L.info('Found fresh session, checking validity...');
          try {
            await sharedPrivyBot.page.goto('https://app.privy.pro/dashboard', {
              waitUntil: 'networkidle2',
              timeout: 60000
            });
            const currentUrl = sharedPrivyBot.page.url();
            if (currentUrl.includes('sign_in')) {
              L.info('Session expired, need to login again');
              await sharedPrivyBot.login();
            } else {
              L.info('Session is still valid!');
            }
          } catch (navErr) {
            L.warn('Navigation failed, attempting full login', { error: navErr.message });
            await sharedPrivyBot.login();
          }
        } else {
          L.info('No fresh session found, performing full login...');
          await sharedPrivyBot.login();
        }
        // Don't start keep-alive loop here - it interferes with scraping
        // The loop will be started after scraping is complete
      } catch (initErr) {
        L.error('Bot initialization failed', { error: initErr?.message });
        // CRITICAL: Reset botInitializing flag on failure to prevent deadlock
        botInitializing = false;
        sharedPrivyBot = null;
        throw initErr;
      }
      botInitializing = false;
    } else if (botInitializing) {
      L.info('Waiting for bot to finish initializing...');
      let waitCount = 0;
      while (botInitializing && waitCount < 60) {
        await new Promise(r => setTimeout(r, 1000));
        waitCount++;
      }
      if (!sharedPrivyBot) {
        throw new Error('Bot initialization timed out');
      }
    }

    const bot = sharedPrivyBot;
    const page = bot.page;

    // Navigate to dashboard first (let session restore)
    L.info(`Navigating to Privy dashboard...`);
    await page.goto('https://app.privy.pro/dashboard', { waitUntil: 'networkidle0', timeout: 90000 });
    await new Promise(r => setTimeout(r, 2000));

    // Check if we got redirected to login page
    let currentUrl = page.url();
    if (currentUrl.includes('sign_in')) {
      L.info('Session expired, re-authenticating...');
      await bot.login();
      await page.goto('https://app.privy.pro/dashboard', { waitUntil: 'networkidle0', timeout: 90000 });
      await new Promise(r => setTimeout(r, 2000));
    }

    // ========== SKIP FILTER MODAL - USE DIRECT URL NAVIGATION ==========
    // The buildPrivyUrl function includes ALL filters in URL params
    // This is more reliable than trying to manipulate the filter modal UI
    L.info('Will use direct URL navigation with filters (skipping filter modal)');

    // ============ MULTI-CITY LOOP ============
    // Loop through each city until we have enough addresses
    for (let cityIndex = 0; cityIndex < stateCities.length; cityIndex++) {
      const cityToUse = stateCities[cityIndex];

      // Check if we've reached the limit
      if (globalAddresses.length >= limitNum) {
        L.info(`✅ Reached target of ${limitNum} addresses after ${citiesScraped.length} cities. Stopping.`);
        break;
      }

      L.info(`\n========== CITY ${cityIndex + 1}/${stateCities.length}: ${cityToUse}, ${stateUpper} ==========`);
      L.info(`Current progress: ${globalAddresses.length}/${limitNum} addresses`);
      citiesScraped.push(cityToUse);

    // ========== FRESH PAGE LOAD FOR EACH CITY (clears Privy's cache) ==========
    const privyUrl = buildPrivyUrl(cityToUse, stateUpper);
    L.info(`Navigating to: ${cityToUse}, ${stateUpper} with fresh page load...`);

    // CRITICAL FIX: Clear browser cache/storage before each city to prevent stale data
    // This fixes the issue where Privy returns wrong state addresses (e.g., MI when requesting MD)
    if (cityIndex > 0) {
      try {
        // Clear session storage and local storage to force Privy to reload fresh data
        await page.evaluate(() => {
          try { sessionStorage.clear(); } catch {}
          try { localStorage.removeItem('privy_map_state'); } catch {}
          try { localStorage.removeItem('privy_search_cache'); } catch {}
        });
        L.info('Cleared browser storage for fresh city load');
      } catch (clearErr) {
        L.warn('Could not clear storage', { error: clearErr?.message });
      }
    }

    // Navigate with cache bypass - forces fresh data from Privy server
    try {
      // Use cache bypass to get fresh data
      await page.setCacheEnabled(false);
      await page.goto(privyUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.setCacheEnabled(true);
      L.info('✅ Navigated with fresh page load');
    } catch (navErr) {
      L.warn('Direct URL navigation failed, retrying...', { error: navErr?.message });
      await page.goto(privyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1500));
    }

    // Wait for the page to settle after fresh load
    await new Promise(r => setTimeout(r, 2000));

    // CRITICAL: Do NOT use the search box - it triggers autocomplete that selects wrong locations
    // The URL parameters already contain the correct city/state - just wait for data to load
    // The URL has: search_text=Auburn%2C+AL which should be enough
    try {
      // Verify we're on the correct page by checking the URL
      const currentUrl = page.url();
      L.info(`Current URL after navigation: ${currentUrl.substring(0, 100)}...`);

      // Check if the URL still contains our expected state
      if (!currentUrl.toUpperCase().includes(stateUpper)) {
        L.warn(`URL doesn't contain expected state ${stateUpper}, forcing reload...`);
        await page.goto(privyUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));
      }

      // DO NOT type in search box - it causes wrong state selection
      // Just verify and log
      L.info(`Relying on URL parameters for ${cityToUse}, ${stateUpper} - NOT using search box`);

      // Wait for map data to load - the URL params should drive the location
      await new Promise(r => setTimeout(r, 1500));

      // Wait for network to be idle (map tiles and data loading)
      L.info('Waiting for map data to load (network idle)...');
      try {
        await page.waitForNetworkIdle({ idleTime: 1500, timeout: 10000 });
        L.info('✅ Map data loaded (network idle)');
      } catch {
        L.info('Network idle timeout, continuing...');
        await new Promise(r => setTimeout(r, 1500));
      }

      // Wait for clusters to appear after map loads
      L.info('Waiting for clusters to appear...');
      try {
        await page.waitForSelector('.cluster.cluster-deal, .cluster', { timeout: 5000 });
        L.info('✅ Clusters appeared after search');
        await new Promise(r => setTimeout(r, 800));
      } catch {
        L.info('No clusters found, extracting visible properties...');
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (searchErr) {
      L.warn('Search/navigation failed', { error: searchErr?.message });
      await new Promise(r => setTimeout(r, 1500));
    }

    // Click on a cluster to open the property list
    // Prefer smaller clusters (< 500) to avoid large cluster loading issues that destroy execution context
    const clusterClicked = await page.evaluate(() => {
      const clusters = document.querySelectorAll('.cluster.cluster-deal, .cluster');
      if (clusters.length === 0) {
        return { clicked: false, count: 0, reason: 'no clusters' };
      }

      // Try to find a cluster with reasonable size (check text content for number)
      let bestCluster = null;
      let bestSize = Infinity;

      for (const cluster of clusters) {
        const text = cluster.textContent?.trim() || '';
        // More robust number extraction - handle commas and various formats
        const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
        const num = parseInt(cleanText, 10);
        // Only accept clusters with < 500 properties to avoid page crashes
        if (!isNaN(num) && num > 0 && num < 500 && num < bestSize) {
          bestSize = num;
          bestCluster = cluster;
        }
      }

      // If no small cluster found, try to find any cluster under 1000
      if (!bestCluster) {
        for (const cluster of clusters) {
          const text = cluster.textContent?.trim() || '';
          const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
          const num = parseInt(cleanText, 10);
          if (!isNaN(num) && num > 0 && num < 1000 && num < bestSize) {
            bestSize = num;
            bestCluster = cluster;
          }
        }
      }

      // Last resort: use a single-property marker (no number or very small)
      if (!bestCluster) {
        for (const cluster of clusters) {
          const text = cluster.textContent?.trim() || '';
          const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
          const num = parseInt(cleanText, 10);
          // Single property markers often have no number or just "1"
          if (isNaN(num) || num <= 1) {
            bestCluster = cluster;
            bestSize = num || 1;
            break;
          }
        }
      }

      // If still no suitable cluster found, skip - don't click huge clusters
      if (!bestCluster) {
        const sizes = Array.from(clusters).map(c => {
          const t = c.textContent?.trim() || '';
          return parseInt(t.replace(/,/g, '').replace(/[^0-9]/g, ''), 10) || 0;
        });
        return { clicked: false, count: clusters.length, reason: 'all clusters too large', sizes: sizes.slice(0, 5) };
      }

      bestCluster.click();
      return { clicked: true, count: clusters.length, clusterSize: bestSize };
    });

    L.info(`Clicked cluster: ${JSON.stringify(clusterClicked)}`);

    // Wait for property list to appear (only once, with early exit check)
    if (clusterClicked.clicked) {
      try {
        await page.waitForSelector(propertyListContainerSelector, { timeout: 5000 });
        L.info('Property list appeared!');
      } catch {
        // Check for 0 properties indicator for early exit
        const zeroResults = await page.evaluate(() => {
          const countEl = document.querySelector('.properties-count, [data-testid="properties-count"], .count-text');
          return countEl && (countEl.textContent?.includes('0 ') || countEl.textContent?.includes('No '));
        });
        if (zeroResults) {
          L.info('City has 0 properties, skipping...');
          continue;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Calculate how many more addresses we still need
    const stillNeededBeforeExtract = Math.max(0, limitNum - globalAddresses.length);
    if (stillNeededBeforeExtract === 0) {
      L.info(`✅ Already have ${globalAddresses.length}/${limitNum} addresses. Skipping extraction.`);
      continue;
    }

    // Extract addresses AND agent details in ONE PASS from property cards (limited to what we need)
    const addresses = await page.evaluate((contentSel, line1Sel, line2Sel, priceSel, statsSel, agentNameSel, agentEmailSel, agentPhoneSel, maxToExtract) => {
      const results = [];

      // Use the config selectors for property cards
      const modules = document.querySelectorAll(contentSel);

      for (const module of modules) {
        // Stop if we have enough
        if (results.length >= maxToExtract) break;
        // Try multiple selector patterns for address lines
        const line1Patterns = line1Sel.split(',').map(s => s.trim());
        const line2Patterns = line2Sel.split(',').map(s => s.trim());

        let line1El = null;
        let line2El = null;

        for (const pat of line1Patterns) {
          line1El = module.querySelector(pat);
          if (line1El) break;
        }
        for (const pat of line2Patterns) {
          line2El = module.querySelector(pat);
          if (line2El) break;
        }

        const priceEl = module.querySelector(priceSel);

        if (line1El && line2El) {
          const line1 = line1El.textContent?.trim() || '';
          const line2 = line2El.textContent?.trim() || '';
          const price = priceEl?.textContent?.trim() || '';

          if (line1 && line2) {
            // Extract quick stats (beds, baths, sqft)
            const statsPatterns = statsSel.split(',').map(s => s.trim());
            const quickStats = [];
            for (const pat of statsPatterns) {
              const statEls = module.querySelectorAll(pat);
              statEls.forEach(el => {
                const text = el.textContent?.trim();
                if (text) quickStats.push(text);
              });
              if (quickStats.length > 0) break;
            }

            // ========== DO NOT EXTRACT AGENT FROM CARD VIEW ==========
            // Agent info will be extracted from detail view using Privy's labeled fields:
            // "List Agent Direct Phone:", "List Agent Email:", "List Agent First/Last Name:", etc.
            // This avoids grabbing wrong agent info from the card/list view.

            results.push({
              fullAddress: `${line1}, ${line2}`,
              price,
              agentName: null,
              agentEmail: null,
              agentPhone: null,
              quickStats
            });
          }
        }
      }

      return results;
    }, propertyContentSelector, addressLine1Selector, addressLine2Selector, priceSelector, propertyStatsSelector, agentNameSelector, agentEmailSelector, agentPhoneSelector, stillNeededBeforeExtract);

    // Count how many already have agent info from card extraction
    const withAgentFromCard = addresses.filter(a => a.agentName || a.agentPhone || a.agentEmail).length;
    L.info(`Found ${addresses.length} addresses in ${cityToUse} (extracted max ${stillNeededBeforeExtract}, ${withAgentFromCard} with agent info)`);

    // Click into property details to get phone/email (which aren't usually in cards)
    // Only enrich NEW addresses (skip duplicates to save time)
    const stillNeeded = Math.max(0, limitNum - globalAddresses.length);

    // Filter out duplicates BEFORE enrichment to avoid wasting time
    const newAddresses = addresses.filter(addr => {
      const key = addr.fullAddress?.toLowerCase();
      return key && !seenAddressKeys.has(key);
    });

    const maxAgentEnrich = Math.min(newAddresses.length, stillNeeded);

    if (newAddresses.length < addresses.length) {
      L.info(`Skipping ${addresses.length - newAddresses.length} duplicate addresses`);
    }

    if (shouldEnrichAgent && maxAgentEnrich > 0) {
      L.info(`Enriching phone/email for ${maxAgentEnrich} NEW properties (skipped ${addresses.length - newAddresses.length} duplicates)...`);

      for (let idx = 0; idx < maxAgentEnrich; idx++) {
        try {
          // Click on the property card at this index to open detail view
          const clicked = await page.evaluate((contentSel, openDetailSel, idx) => {
            const modules = document.querySelectorAll(contentSel);
            if (modules[idx]) {
              // Find the best clickable element - try openDetailSelector patterns first
              const openPatterns = openDetailSel.split(',').map(s => s.trim());
              for (const pat of openPatterns) {
                const clickable = modules[idx].querySelector(pat);
                if (clickable) {
                  clickable.click();
                  return { clicked: true, method: pat };
                }
              }
              // Fallback: click the module itself or find any anchor
              const fallback = modules[idx].querySelector('a') || modules[idx];
              fallback.click();
              return { clicked: true, method: 'fallback' };
            }
            return { clicked: false };
          }, propertyContentSelector, openDetailSelector, idx);

          if (clicked.clicked) {
            // Wait for detail panel/modal to load
            await new Promise(r => setTimeout(r, 1500));

            // Scroll down to reveal more content (agent info may be below the fold)
            await page.evaluate(() => {
              // Try scrolling the detail panel/modal
              const detailPanel = document.querySelector('.detail-panel, .property-detail, .modal-body, [class*="detail"]');
              if (detailPanel) {
                detailPanel.scrollTop = detailPanel.scrollHeight;
              }
              // Also scroll window
              window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise(r => setTimeout(r, 500));

            // Look for and click "Contact Agent" or similar buttons to reveal email
            await page.evaluate(() => {
              const contactBtns = document.querySelectorAll('button, a');
              for (const btn of contactBtns) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('contact') || text.includes('agent') || text.includes('email') || text.includes('show')) {
                  btn.click();
                  return true;
                }
              }
              return false;
            });
            await new Promise(r => setTimeout(r, 500));

            // Extract agent info from the detail view using ONLY Privy's labeled fields
            // Privy shows: "List Agent Direct Phone:", "List Agent Email:", "List Agent First/Last Name:", etc.
            // We ONLY use these labeled fields to avoid grabbing wrong agent info.
            const agentInfo = await page.evaluate(() => {
              let agentName = null, agentEmail = null, agentPhone = null, brokerage = null;
              let debugInfo = { foundElements: [] };
              const pageText = document.body.innerText || '';

              // ========== PRIVY-SPECIFIC LABELED FIELDS ONLY ==========

              // 1. PHONE: "List Agent Direct Phone: 678-951-7041"
              const phoneLabeled = pageText.match(/List\s+Agent\s+(?:Direct\s+)?Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
              if (phoneLabeled) {
                agentPhone = phoneLabeled[1].trim();
                debugInfo.foundElements.push({ sel: 'List Agent Phone', text: agentPhone });
              }
              // Fallback to office phone only if no agent phone
              if (!agentPhone) {
                const officePhoneLabeled = pageText.match(/List\s+Office\s+Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
                if (officePhoneLabeled) {
                  agentPhone = officePhoneLabeled[1].trim();
                  debugInfo.foundElements.push({ sel: 'List Office Phone', text: agentPhone });
                }
              }

              // 2. EMAIL: "List Agent Email: amyksellsga@gmail.com"
              const emailLabeled = pageText.match(/List\s+Agent\s+Email\s*[:\s]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
              if (emailLabeled) {
                agentEmail = emailLabeled[1].trim();
                debugInfo.foundElements.push({ sel: 'List Agent Email', text: agentEmail });
              }

              // 3. NAME: Try multiple Privy formats
              // "List Agent Full Name: Jesse Burns"
              const fullNameMatch = pageText.match(/List\s+Agent\s+Full\s+Name\s*[:\s]\s*([^\n]+)/i);
              if (fullNameMatch) {
                let extractedName = fullNameMatch[1].trim();
                extractedName = extractedName.split(/(?:List Agent|Direct Phone|Email|Office)/i)[0].trim();
                if (extractedName.length > 3) {
                  agentName = extractedName;
                  debugInfo.foundElements.push({ sel: 'List Agent Full Name', text: agentName });
                }
              }

              // "List Agent First Name: Amy" + "List Agent Last Name: Smith"
              if (!agentName) {
                const firstMatch = pageText.match(/List\s+Agent\s+First\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
                const lastMatch = pageText.match(/List\s+Agent\s+Last\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
                if (firstMatch && lastMatch) {
                  agentName = `${firstMatch[1].trim()} ${lastMatch[1].trim()}`;
                  debugInfo.foundElements.push({ sel: 'List Agent First+Last Name', text: agentName });
                }
              }

              // 4. BROKERAGE: "List Office Name: Keller Williams Realty Community Partners"
              const officeNameMatch = pageText.match(/List\s+Office\s+Name\s*[:\s]\s*([^\n]+)/i);
              if (officeNameMatch) {
                let officeName = officeNameMatch[1].trim();
                // Clean up - remove trailing labels
                officeName = officeName.split(/(?:List Agent|List Office Phone|Direct Phone|Email)/i)[0].trim();
                if (officeName.length > 2) {
                  brokerage = officeName;
                  debugInfo.foundElements.push({ sel: 'List Office Name', text: brokerage });
                }
              }

              return { agentName, agentEmail, agentPhone, brokerage, debug: debugInfo };
            });

            // Update the address with agent info
            if (agentInfo.agentName || agentInfo.agentEmail || agentInfo.agentPhone || agentInfo.brokerage) {
              addresses[idx].agentName = agentInfo.agentName;
              addresses[idx].agentEmail = agentInfo.agentEmail;
              addresses[idx].agentPhone = agentInfo.agentPhone;
              addresses[idx].brokerage = agentInfo.brokerage;
              L.info(`  Agent #${idx + 1}: ${agentInfo.agentName || 'N/A'}, ${agentInfo.agentPhone || 'N/A'}, ${agentInfo.agentEmail || 'N/A'}, Brokerage: ${agentInfo.brokerage || 'N/A'}`);
            }

            // Close the detail view - try multiple methods
            try {
              // Try clicking close button first
              const closed = await page.evaluate(() => {
                const closeBtn = document.querySelector('.close-btn, .close, [aria-label="Close"], .modal-close, button.close');
                if (closeBtn) { closeBtn.click(); return true; }
                return false;
              });
              if (!closed) {
                await page.keyboard.press('Escape');
              }
            } catch {}
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (agentErr) {
          L.warn(`Agent enrichment failed for property ${idx + 1}: ${agentErr.message}`);
        }
      }
    }

    // If first cluster didn't give results, try clicking more clusters
    if (addresses.length === 0 && clusterClicked.count > 1) {
      L.info('No addresses from first cluster, trying more clusters...');

      for (let clusterIdx = 1; clusterIdx < Math.min(clusterClicked.count, 3); clusterIdx++) {
        // Click on map to close current view
        await page.mouse.click(400, 300);
        await new Promise(r => setTimeout(r, 1000));

        // Click next cluster
        const nextClicked = await page.evaluate((idx) => {
          const clusters = document.querySelectorAll('.cluster.cluster-deal, .cluster');
          if (clusters.length > idx) {
            clusters[idx].click();
            return true;
          }
          return false;
        }, clusterIdx);

        if (nextClicked) {
          L.info(`Clicked cluster ${clusterIdx + 1}, waiting for properties...`);
          // OPTIMIZED: Wait for selector instead of fixed 8s
          try {
            await page.waitForSelector(propertyListContainerSelector, { timeout: 3000 });
          } catch {
            await new Promise(r => setTimeout(r, 1500));
          }

          // Extract from this cluster using proper selectors
          const moreAddresses = await page.evaluate((contentSel, line1Sel, line2Sel, priceSel, statsSel) => {
            const results = [];
            const modules = document.querySelectorAll(contentSel);
            for (const module of modules) {
              const line1Patterns = line1Sel.split(',').map(s => s.trim());
              const line2Patterns = line2Sel.split(',').map(s => s.trim());
              let line1El = null, line2El = null;
              for (const pat of line1Patterns) { line1El = module.querySelector(pat); if (line1El) break; }
              for (const pat of line2Patterns) { line2El = module.querySelector(pat); if (line2El) break; }
              const priceEl = module.querySelector(priceSel);
              if (line1El && line2El) {
                const line1 = line1El.textContent?.trim() || '';
                const line2 = line2El.textContent?.trim() || '';
                const price = priceEl?.textContent?.trim() || '';
                if (line1 && line2) {
                  // Extract quick stats
                  const statsPatterns = statsSel.split(',').map(s => s.trim());
                  const quickStats = [];
                  for (const pat of statsPatterns) {
                    const statEls = module.querySelectorAll(pat);
                    statEls.forEach(el => { const text = el.textContent?.trim(); if (text) quickStats.push(text); });
                    if (quickStats.length > 0) break;
                  }
                  results.push({ fullAddress: `${line1}, ${line2}`, price, agentName: null, agentEmail: null, agentPhone: null, quickStats });
                }
              }
            }
            return results;
          }, propertyContentSelector, addressLine1Selector, addressLine2Selector, priceSelector, propertyStatsSelector);

          L.info(`Cluster ${clusterIdx + 1} yielded ${moreAddresses.length} addresses`);

          // Add new addresses
          for (const addr of moreAddresses) {
            if (!addresses.find(a => a.fullAddress === addr.fullAddress)) {
              addresses.push(addr);
            }
          }

          if (addresses.length >= 20) break; // Got enough from this city
        }
      }
    }

    L.info(`Total from ${cityToUse}: ${addresses.length} addresses`);

    // Only take addresses up to what we need (respecting the limit)
    const addressesToAdd = addresses.slice(0, stillNeeded);
    L.info(`Adding ${addressesToAdd.length} of ${addresses.length} addresses (need ${stillNeeded} more to reach limit of ${limitNum})`);

    // Add to global addresses with deduplication AND state validation
    let validCount = 0;
    let rejectedCount = 0;

    // Debug: log first few addresses to understand format
    if (addressesToAdd.length > 0) {
      L.info(`Sample addresses from ${cityToUse}:`, {
        first3: addressesToAdd.slice(0, 3).map(a => a.fullAddress)
      });
    }

    for (const addr of addressesToAdd) {
      if (globalAddresses.length >= limitNum) break;

      const addrKey = addr.fullAddress.toLowerCase();
      if (seenAddressKeys.has(addrKey)) continue;

      // Extract state from the actual address and validate it matches requested state
      const extractedState = extractStateFromAddress(addr.fullAddress);

      // Debug: log extraction results for first few
      if (validCount + rejectedCount < 3) {
        L.debug(`State extraction: "${addr.fullAddress}" -> extracted: "${extractedState}", expected: "${stateUpper}"`);
      }

      if (extractedState && extractedState !== stateUpper) {
        // Address contains WRONG state - reject it
        rejectedCount++;
        if (rejectedCount <= 3) {
          L.info(`Rejected address: extracted="${extractedState}" vs expected="${stateUpper}": ${addr.fullAddress}`);
        }
        continue;
      }

      seenAddressKeys.add(addrKey);
      globalAddresses.push({
        ...addr,
        city: cityToUse,
        state: extractedState || stateUpper, // Use extracted state, fallback to requested
        source: 'privy',
        scrapedAt: new Date().toISOString()
      });
      validCount++;
    }

    if (rejectedCount > 0) {
      L.info(`Filtered out ${rejectedCount} addresses from wrong states`);
    }
    L.info(`City ${cityToUse} complete: ${validCount} valid addresses, global total: ${globalAddresses.length}/${limitNum}`);

    // Early exit if we've reached the limit
    if (globalAddresses.length >= limitNum) {
      L.info(`✅ LIMIT REACHED: Got ${globalAddresses.length}/${limitNum} addresses. Stopping city loop.`);
      break;
    }

    // Track consecutive cities with no new valid addresses for early exit
    if (validCount === 0) {
      consecutiveEmptyCities++;
      if (consecutiveEmptyCities >= 3) {
        L.warn(`⚠️ EARLY EXIT: ${consecutiveEmptyCities} consecutive cities returned 0 new valid addresses. Privy may be returning stale data.`);
        L.info(`Stopping early with ${globalAddresses.length}/${limitNum} addresses to save time.`);
        break;
      }
    } else {
      consecutiveEmptyCities = 0; // Reset counter when we find valid addresses
    }

    } // ============ END MULTI-CITY LOOP ============

    // Enforce the limit - only return the requested number of addresses
    let finalAddresses = globalAddresses.slice(0, limitNum);

    L.info(`\n========== SCRAPING COMPLETE ==========`);
    L.info(`Total addresses scraped: ${globalAddresses.length}, returning: ${finalAddresses.length} (limit: ${limitNum})`);
    L.info(`Cities scraped: ${citiesScraped.join(', ')}`);

    // Calculate agent enrichment stats from in-loop enrichment
    const withNameCount = finalAddresses.filter(p => p.agentName).length;
    const withPhoneCount = finalAddresses.filter(p => p.agentPhone).length;
    const withEmailCount = finalAddresses.filter(p => p.agentEmail).length;
    const withBrokerageCount = finalAddresses.filter(p => p.brokerage).length;
    const agentEnrichmentStats = {
      total: finalAddresses.length,
      withName: withNameCount,
      withPhone: withPhoneCount,
      withEmail: withEmailCount,
      withBrokerage: withBrokerageCount
    };
    L.info(`Agent stats: ${withPhoneCount}/${finalAddresses.length} have phone, ${withEmailCount} have email, ${withBrokerageCount} have brokerage`);

    // Save session after successful scrape
    try { await sessionStore.saveSessionCookies(page); } catch {}

    // Track the last scraped state for state change detection
    lastScrapedState = stateUpper;

    // Release scraping slot for next request
    releaseScrapingSlot();

    // AUTO-BOFA: If enabled, fetch BofA valuations for the scraped addresses
    let bofaResults = null;
    if (shouldAutoBofa && finalAddresses.length > 0) {
      L.info(`Auto-BofA enabled, fetching valuations for ${finalAddresses.length} addresses...`);
      try {
        const authHeader = req.headers.authorization;
        const addressList = finalAddresses.map(a => a.fullAddress);

        // Call BofA batch endpoint internally (use the same host as the current request)
        const host = req.get('host') || `localhost:${process.env.PORT || 3015}`;
        const protocol = req.protocol || 'http';
        const bofaResponse = await fetch(`${protocol}://${host}/api/bofa/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify({
            addresses: addressList,
            concurrency: 3
          })
        });

        const bofaData = await bofaResponse.json();
        if (bofaData.ok && bofaData.results) {
          // Merge BofA results with addresses
          const bofaMap = new Map();
          for (const result of bofaData.results) {
            if (result.address) {
              bofaMap.set(result.address.toLowerCase(), result);
            }
          }

          // Attach BofA values to addresses
          for (const addr of finalAddresses) {
            const bofaResult = bofaMap.get(addr.fullAddress.toLowerCase());
            if (bofaResult) {
              addr.bofaValue = bofaResult.amv || bofaResult.avgSalePrice || bofaResult.estimatedHomeValue;
              addr.avgSalePrice = bofaResult.avgSalePrice;
              addr.estimatedHomeValue = bofaResult.estimatedHomeValue;
            }
          }

          bofaResults = {
            total: bofaData.results.length,
            successful: bofaData.results.filter(r => r.amv || r.avgSalePrice).length,
            failed: bofaData.results.filter(r => !r.amv && !r.avgSalePrice).length
          };
          L.info(`Auto-BofA complete: ${bofaResults.successful}/${bofaResults.total} addresses valued`);
        } else {
          L.warn('Auto-BofA failed', { error: bofaData.error });
        }
      } catch (bofaErr) {
        L.error('Auto-BofA error', { error: bofaErr.message });
      }
    }

    // Release scraping slot on success
    releaseScrapingSlot();

    // Save to ScrapedDeal for Pending AMV display
    let savedCount = 0;
    let skippedCount = 0;
    for (const addr of finalAddresses) {
      try {
        const fullAddress = addr.fullAddress?.trim();
        if (!fullAddress) continue;

        const fullAddress_ci = fullAddress.toLowerCase();

        // Parse price as number
        let listingPrice = null;
        if (addr.price) {
          const priceStr = String(addr.price).replace(/[^0-9.]/g, '');
          listingPrice = parseFloat(priceStr) || null;
        }

        await ScrapedDeal.findOneAndUpdate(
          { fullAddress_ci },
          {
            $setOnInsert: {
              address: addr.address || fullAddress.split(',')[0].trim(),
              fullAddress,
              fullAddress_ci,
              city: addr.city || null,
              state: addr.state || stateUpper,
              zip: addr.zip || null,
              source: 'privy',
              scrapedAt: new Date(),
              createdAt: new Date(),
            },
            $set: {
              listingPrice,
              beds: addr.quickStats?.beds || null,
              baths: addr.quickStats?.baths || null,
              sqft: addr.quickStats?.sqft || null,
              agentName: addr.agentName || null,
              agentEmail: addr.agentEmail || null,
              agentPhone: addr.agentPhone || null,
              updatedAt: new Date(),
            }
          },
          { upsert: true, new: true }
        );
        savedCount++;
      } catch (saveErr) {
        if (saveErr.code !== 11000) {
          L.warn('Failed to save to ScrapedDeal', { address: addr.fullAddress, error: saveErr.message });
        }
        skippedCount++;
      }
    }
    L.info(`Saved ${savedCount} addresses to ScrapedDeal (${skippedCount} skipped/duplicates)`);

    return res.json({
      ok: true,
      state: stateUpper,
      citiesScraped: citiesScraped,
      totalCitiesAvailable: stateCities.length,
      count: finalAddresses.length,
      limit: limitNum,
      limitReached: finalAddresses.length >= limitNum,
      addresses: finalAddresses,
      agentEnrichment: agentEnrichmentStats,
      bofaResults: bofaResults,
      savedToScrapedDeal: savedCount,
      attempt: attempt // Include which attempt succeeded
    });

    } catch (error) {
      lastError = error;
      L.error('Live Privy scrape failed', { error: error.message, attempt: attempt });

      // Check if error is recoverable
      if (isRecoverableError(error.message)) {
        L.info(`Recoverable error detected, resetting bot for retry`, {
          attempt: attempt,
          maxRetries: MAX_SCRAPE_RETRIES,
          error: error.message
        });
        await resetSharedBot();

        // If we have more retries, continue the loop
        if (attempt < MAX_SCRAPE_RETRIES) {
          continue; // Try again
        }
      }

      // Non-recoverable error or max retries reached - exit loop
      break;
    }
  } // End of retry loop

  // If we get here with lastError, all retries failed
  if (lastError) {
    L.error('All retry attempts failed', {
      error: lastError.message,
      attempts: MAX_SCRAPE_RETRIES
    });

    // Release scraping slot
    releaseScrapingSlot();

    // Reset bot state
    botInitializing = false;

    return res.status(500).json({
      ok: false,
      error: lastError.message || 'Failed to scrape addresses',
      message: `Live scraping error after ${MAX_SCRAPE_RETRIES} attempts`,
      retriesExhausted: true
    });
  }
});

/**
 * GET /api/live-scrape/redfin
 *
 * Scrapes addresses LIVE from Redfin.com and returns them immediately
 * Does NOT save to database - just for validation/testing
 * NO AUTHENTICATION REQUIRED - works without database
 *
 * Query params:
 *   - state: State code (e.g., CA, NY) - REQUIRED
 *   - city: City name (optional, but recommended)
 *   - limit: Max addresses to return (default: 20)
 *
 * Hardcoded filters applied:
 *   - For Sale, Active
 *   - Price: $50K - $500K
 *   - Beds: 3+
 *   - Home Type: House
 *   - Sqft: 1000+
 *   - No HOA
 */
router.get('/redfin', async (req, res) => {
  try {
    const { state, city = '', limit = 20, page = 1, enrichAgent = 'true' } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const shouldEnrichAgent = enrichAgent === 'true' || enrichAgent === '1';

    if (!state) {
      return res.status(400).json({
        ok: false,
        error: 'State parameter is required',
        message: 'Please provide a state code (e.g., CA, NY, TX)'
      });
    }

    L.info('Starting Redfin web scraping', { state, city, limit: limitNum, page: pageNum });

    // Map state code to state name
    const { STATES } = await import('../constants.js');
    const stateInfo = STATES.find(s => s.code === state.toUpperCase());

    if (!stateInfo) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid state code',
        message: `State "${state}" not found. Please use valid 2-letter state codes like CA, NY, TX`
      });
    }

    // Hardcoded filters as per requirements
    const REDFIN_FILTERS = [
      'property-type=house',
      'status=active',
      'min-price=50k',
      'max-price=500k',
      'min-beds=3',
      'min-sqft=1k-sqft',
      'hoa=0',
      'exclude-55+-community',
      'listing-source=agent,owner,foreclosure'
    ].join(',');

    // Skip browser scraping (too slow) - go directly to API
    // Try the direct API with city-level query (faster)
    try {
      const axios = (await import('axios')).default;

      // Multiple cities per state for fallback fetching (ordered by population/activity)
      const STATE_CITIES_LIST = {
        'AL': [{ name: 'Birmingham', id: 1823 }, { name: 'Huntsville', id: 8966 }, { name: 'Montgomery', id: 12923 }, { name: 'Mobile', id: 11715 }],
        'AK': [{ name: 'Anchorage', id: 781 }, { name: 'Fairbanks', id: 6603 }, { name: 'Juneau', id: 9483 }],
        'AZ': [{ name: 'Phoenix', id: 14240 }, { name: 'Tucson', id: 18805 }, { name: 'Mesa', id: 11350 }, { name: 'Scottsdale', id: 16095 }],
        'AR': [{ name: 'Little Rock', id: 10455 }, { name: 'Fort Smith', id: 7034 }, { name: 'Fayetteville', id: 6708 }],
        'CA': [{ name: 'Los Angeles', id: 11203 }, { name: 'San Diego', id: 16904 }, { name: 'San Jose', id: 17420 }, { name: 'San Francisco', id: 17151 }, { name: 'Fresno', id: 7240 }],
        'CO': [{ name: 'Denver', id: 5155 }, { name: 'Colorado Springs', id: 4436 }, { name: 'Aurora', id: 1025 }, { name: 'Fort Collins', id: 7010 }],
        'CT': [{ name: 'Hartford', id: 9406 }, { name: 'New Haven', id: 13172 }, { name: 'Stamford', id: 17822 }, { name: 'Bridgeport', id: 2349 }],
        'DE': [{ name: 'Wilmington', id: 19583 }, { name: 'Dover', id: 5566 }, { name: 'Newark', id: 13139 }],
        'FL': [{ name: 'Miami', id: 11458 }, { name: 'Orlando', id: 14038 }, { name: 'Tampa', id: 18349 }, { name: 'Jacksonville', id: 9277 }, { name: 'Fort Lauderdale', id: 7005 }],
        'GA': [{ name: 'Atlanta', id: 30756 }, { name: 'Savannah', id: 16044 }, { name: 'Augusta', id: 1020 }, { name: 'Columbus', id: 4665 }],
        'HI': [{ name: 'Honolulu', id: 34945 }],
        'ID': [{ name: 'Boise', id: 2287 }, { name: 'Meridian', id: 11344 }, { name: 'Nampa', id: 13024 }],
        'IL': [{ name: 'Chicago', id: 29470 }, { name: 'Aurora', id: 1026 }, { name: 'Naperville', id: 13032 }, { name: 'Rockford', id: 15936 }],
        'IN': [{ name: 'Indianapolis', id: 9170 }, { name: 'Fort Wayne', id: 7033 }, { name: 'Evansville', id: 6489 }, { name: 'South Bend', id: 17551 }],
        'IA': [{ name: 'Des Moines', id: 5415 }, { name: 'Cedar Rapids', id: 3294 }, { name: 'Davenport', id: 5038 }],
        'KS': [{ name: 'Wichita', id: 19878 }, { name: 'Overland Park', id: 14080 }, { name: 'Kansas City', id: 9498 }, { name: 'Topeka', id: 18595 }],
        'KY': [{ name: 'Louisville', id: 12262 }, { name: 'Lexington', id: 10351 }, { name: 'Bowling Green', id: 2315 }],
        'LA': [{ name: 'New Orleans', id: 14233 }, { name: 'Baton Rouge', id: 1467 }, { name: 'Shreveport', id: 17324 }],
        'ME': [{ name: 'Portland', id: 15614 }, { name: 'Lewiston', id: 10356 }, { name: 'Bangor', id: 1334 }],
        'MD': [{ name: 'Baltimore', id: 1073 }, { name: 'Columbia', id: 4519 }, { name: 'Germantown', id: 7540 }, { name: 'Silver Spring', id: 17355 }],
        'MA': [{ name: 'Boston', id: 1826 }, { name: 'Worcester', id: 19753 }, { name: 'Springfield', id: 17750 }, { name: 'Cambridge', id: 2965 }],
        'MI': [{ name: 'Detroit', id: 5665 }, { name: 'Grand Rapids', id: 7820 }, { name: 'Warren', id: 19148 }, { name: 'Ann Arbor', id: 798 }],
        'MN': [{ name: 'Minneapolis', id: 10943 }, { name: 'Saint Paul', id: 16814 }, { name: 'Rochester', id: 15906 }, { name: 'Duluth', id: 5778 }],
        'MS': [{ name: 'Jackson', id: 9165 }, { name: 'Gulfport', id: 8193 }, { name: 'Hattiesburg', id: 8581 }],
        'MO': [{ name: 'Kansas City', id: 35751 }, { name: 'Saint Louis', id: 16815 }, { name: 'Springfield', id: 17751 }, { name: 'Columbia', id: 4520 }],
        'MT': [{ name: 'Billings', id: 1720 }, { name: 'Missoula', id: 11707 }, { name: 'Great Falls', id: 8021 }],
        'NE': [{ name: 'Omaha', id: 9417 }, { name: 'Lincoln', id: 10414 }, { name: 'Bellevue', id: 1587 }],
        'NV': [{ name: 'Las Vegas', id: 10201 }, { name: 'Henderson', id: 8728 }, { name: 'Reno', id: 15740 }, { name: 'North Las Vegas', id: 13583 }],
        'NH': [{ name: 'Manchester', id: 11504 }, { name: 'Nashua', id: 13082 }, { name: 'Concord', id: 4588 }],
        'NJ': [{ name: 'Newark', id: 13136 }, { name: 'Jersey City', id: 9409 }, { name: 'Paterson', id: 14185 }, { name: 'Elizabeth', id: 6177 }, { name: 'Trenton', id: 18700 }],
        'NM': [{ name: 'Albuquerque', id: 513 }, { name: 'Las Cruces', id: 10184 }, { name: 'Rio Rancho', id: 15857 }, { name: 'Santa Fe', id: 16949 }],
        'NY': [{ name: 'New York', id: 30749 }, { name: 'Buffalo', id: 2704 }, { name: 'Rochester', id: 15907 }, { name: 'Syracuse', id: 18277 }, { name: 'Albany', id: 488 }],
        'NC': [{ name: 'Charlotte', id: 3105 }, { name: 'Raleigh', id: 15533 }, { name: 'Greensboro', id: 8050 }, { name: 'Durham', id: 5830 }, { name: 'Winston-Salem', id: 19657 }, { name: 'Fayetteville', id: 5903 }],
        'ND': [{ name: 'Fargo', id: 6610 }, { name: 'Bismarck', id: 1749 }, { name: 'Grand Forks', id: 7813 }],
        'OH': [{ name: 'Columbus', id: 4664 }, { name: 'Cleveland', id: 4207 }, { name: 'Cincinnati', id: 3959 }, { name: 'Toledo', id: 18553 }, { name: 'Akron', id: 468 }],
        'OK': [{ name: 'Oklahoma City', id: 14237 }, { name: 'Tulsa', id: 35765 }, { name: 'Norman', id: 13561 }, { name: 'Broken Arrow', id: 2451 }],
        'OR': [{ name: 'Portland', id: 30772 }, { name: 'Salem', id: 16843 }, { name: 'Eugene', id: 6460 }, { name: 'Gresham', id: 8108 }],
        'PA': [{ name: 'Philadelphia', id: 15502 }, { name: 'Pittsburgh', id: 14431 }, { name: 'Allentown', id: 556 }, { name: 'Reading', id: 15662 }],
        'RI': [{ name: 'Providence', id: 15272 }, { name: 'Warwick', id: 19168 }, { name: 'Cranston', id: 4868 }],
        'SC': [{ name: 'Charleston', id: 3478 }, { name: 'Columbia', id: 4521 }, { name: 'Greenville', id: 8064 }, { name: 'Myrtle Beach', id: 13009 }],
        'SD': [{ name: 'Sioux Falls', id: 15282 }, { name: 'Rapid City', id: 15565 }],
        'TN': [{ name: 'Nashville', id: 13415 }, { name: 'Memphis', id: 11323 }, { name: 'Knoxville', id: 9766 }, { name: 'Chattanooga', id: 3561 }],
        'TX': [{ name: 'Houston', id: 8903 }, { name: 'San Antonio', id: 16898 }, { name: 'Dallas', id: 4995 }, { name: 'Austin', id: 1028 }, { name: 'Fort Worth', id: 7036 }, { name: 'El Paso', id: 6155 }],
        'UT': [{ name: 'Salt Lake City', id: 17150 }, { name: 'West Valley City', id: 19436 }, { name: 'Provo', id: 15276 }, { name: 'Ogden', id: 13864 }],
        'VT': [{ name: 'Burlington', id: 2749 }, { name: 'South Burlington', id: 17552 }],
        'VA': [{ name: 'Virginia Beach', id: 20418 }, { name: 'Norfolk', id: 13560 }, { name: 'Chesapeake', id: 3595 }, { name: 'Richmond', id: 15819 }, { name: 'Arlington', id: 895 }],
        'WA': [{ name: 'Seattle', id: 16163 }, { name: 'Spokane', id: 17717 }, { name: 'Tacoma', id: 18299 }, { name: 'Vancouver', id: 18994 }, { name: 'Bellevue', id: 1588 }],
        'WV': [{ name: 'Charleston', id: 3787 }, { name: 'Huntington', id: 8970 }, { name: 'Morgantown', id: 12007 }],
        'WI': [{ name: 'Milwaukee', id: 35759 }, { name: 'Madison', id: 11445 }, { name: 'Green Bay', id: 8039 }, { name: 'Kenosha', id: 9603 }],
        'WY': [{ name: 'Cheyenne', id: 3616 }, { name: 'Casper', id: 3236 }, { name: 'Laramie', id: 10138 }]
      };

      // Legacy single city mapping (for backwards compatibility)
      const STATE_DEFAULT_CITIES = Object.fromEntries(
        Object.entries(STATE_CITIES_LIST).map(([state, cities]) => [state, cities[0]])
      );

      const stateUpper = state.toUpperCase();
      const defaultCity = STATE_DEFAULT_CITIES[stateUpper];

      if (!defaultCity) {
        throw new Error(`Unknown state: ${state}`);
      }

      // Determine which city to use - if user selected a city, look it up; otherwise use default
      let cityToUse = defaultCity;
      const userCity = city ? city.trim() : '';

      if (userCity && userCity.toLowerCase() !== defaultCity.name.toLowerCase()) {
        // User selected a different city - look up its ID from Redfin autocomplete API
        try {
          L.info(`Looking up city ID for: ${userCity}, ${stateUpper}`);
          const autocompleteUrl = `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(userCity + ', ' + stateUpper)}&v=2`;

          const autoResponse = await axios.get(autocompleteUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': 'https://www.redfin.com/'
            },
            timeout: 10000
          });

          let autoData = autoResponse.data;
          if (typeof autoData === 'string') {
            autoData = autoData.replace(/^\{\}&&/, '');
            autoData = JSON.parse(autoData);
          }

          L.info(`Autocomplete response sections: ${JSON.stringify(autoData.payload?.sections?.length || 0)}`);

          const sections = autoData.payload?.sections || [];
          let foundCity = false;

          for (const section of sections) {
            const rows = section.rows || [];
            for (const row of rows) {
              const rowType = parseInt(row.type);
              L.info(`Row: type=${rowType}, name=${row.name}, id=${row.id}`);

              // Look for city (type 2) or neighborhood (type 6) - Redfin returns actual cities as type 2
              // Type 2 = City, Type 6 = Neighborhood
              if ((rowType === 2 || rowType === 6) && row.id) {
                // Extract city ID from format like "2_1234" or "6_1234"
                const idParts = row.id.toString().split('_');
                const cityIdMatch = idParts.length > 1 ? idParts[1] : idParts[0];

                if (cityIdMatch) {
                  cityToUse = { name: userCity, id: parseInt(cityIdMatch) };
                  L.info(`✅ Found city ID for ${userCity}: ${cityToUse.id} (type=${rowType}, from row: ${row.name})`);
                  foundCity = true;
                  break;
                }
              }
            }
            if (foundCity) break;
          }

          if (!foundCity) {
            L.warn(`City ${userCity} not found in autocomplete, using default city ${defaultCity.name}`);
          }
        } catch (lookupErr) {
          L.warn(`City lookup failed for ${userCity}, using default city: ${lookupErr.message}`);
        }
      }

      // Use city-level query with market parameter - this returns correct state data
      const market = stateUpper.toLowerCase();

      // Different sort orders for pagination to get different results each page
      const sortOptions = ['redfin-recommended-asc', 'price-asc', 'price-desc', 'newest', 'beds-desc', 'sqft-desc'];
      const sortOrder = sortOptions[(pageNum - 1) % sortOptions.length];

      // Filter function for homes
      const filterHome = (home) => {
        const MIN_PRICE = 50000, MAX_PRICE = 500000, MIN_BEDS = 3, MIN_SQFT = 1000;
        const price = home.price?.value || home.price || 0;
        const beds = home.beds || 0;
        const sqft = home.sqFt?.value || home.sqFt || 0;
        const propertyType = home.propertyType?.value || home.propertyType;
        const hoa = home.hoa?.value || home.hoa || 0;

        // CRITICAL: Filter by state - Redfin API sometimes returns wrong states
        const homeState = (home.state || '').toUpperCase();
        if (homeState && homeState !== stateUpper) {
          L.debug(`Filtering out property from wrong state: ${homeState} (expected ${stateUpper})`);
          return false;
        }

        if (price < MIN_PRICE || price > MAX_PRICE) return false;
        if (beds < MIN_BEDS) return false;
        if (sqft < MIN_SQFT) return false;
        if (propertyType && ![1, 6, 'Single Family', 'House'].includes(propertyType)) return false;

        const hoaValue = typeof hoa === 'object' ? 0 : (hoa || 0);
        if (hoaValue > 0) return false;

        // Exclude 55+ communities
        const listingTags = home.listingTags || [];
        const remarks = (home.listingRemarks || '').toLowerCase();
        const keyFacts = (home.keyFacts || []).map(kf => (kf.description || '').toLowerCase());
        const seniorKeywords = ['55+', '55 +', 'senior', 'age restricted', 'age-restricted', 'adult community', 'retirement', 'over 55', 'active adult'];

        if (listingTags.some(tag => seniorKeywords.some(kw => tag.toLowerCase().includes(kw)))) return false;
        if (seniorKeywords.some(kw => remarks.includes(kw))) return false;
        if (keyFacts.some(fact => seniorKeywords.some(kw => fact.includes(kw)))) return false;

        const listingType = home.listingType || 1;
        if (![1, 2, 3].includes(listingType)) return false;

        return true;
      };

      // Build list of cities to fetch from
      // If user specified a city, start with that; otherwise use state's city list
      let citiesToFetch = [];
      if (userCity) {
        // User specified a city - use it first, then add other cities from the state as fallback
        citiesToFetch = [cityToUse];
        const stateCities = STATE_CITIES_LIST[stateUpper] || [];
        for (const c of stateCities) {
          if (c.name.toLowerCase() !== userCity.toLowerCase()) {
            citiesToFetch.push(c);
          }
        }
      } else {
        // No specific city - use all cities in the state
        citiesToFetch = STATE_CITIES_LIST[stateUpper] || [cityToUse];
      }

      // Collect properties from multiple cities until we reach the limit
      const allFilteredHomes = [];
      const citiesFetched = [];
      const seenAddresses = new Set(); // Avoid duplicates

      for (const currentCity of citiesToFetch) {
        if (allFilteredHomes.length >= limitNum) break;

        const cityId = currentCity.id;
        const numHomesToFetch = Math.min(2000, Math.max(500, limitNum * 10));
        const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${market}&region_id=${cityId}&region_type=6&num_homes=${numHomesToFetch}&status=9&ord=${sortOrder}&v=8`;

        L.info(`Fetching from ${currentCity.name} (need ${limitNum - allFilteredHomes.length} more, have ${allFilteredHomes.length})`);

        try {
          const response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': `https://www.redfin.com/city/${cityId}/${stateUpper}/${currentCity.name}`
            },
            timeout: 15000
          });

          let data = response.data;
          if (typeof data === 'string') {
            data = data.replace(/^\{\}&&/, '');
            data = JSON.parse(data);
          }

          const homes = data.payload?.homes || [];
          L.info(`${currentCity.name}: API returned ${homes.length} homes`);

          // Filter and dedupe
          for (const home of homes) {
            if (allFilteredHomes.length >= limitNum) break;
            if (!filterHome(home)) continue;

            const addr = (home.streetLine?.value || home.streetLine || '').toLowerCase();
            if (seenAddresses.has(addr)) continue;
            seenAddresses.add(addr);

            allFilteredHomes.push(home);
          }

          citiesFetched.push(currentCity.name);
          L.info(`${currentCity.name}: After filtering, total collected: ${allFilteredHomes.length}`);

        } catch (cityErr) {
          L.warn(`Failed to fetch from ${currentCity.name}: ${cityErr.message}`);
        }
      }

      L.info(`Multi-city fetch complete: ${allFilteredHomes.length} homes from ${citiesFetched.length} cities`);

      if (allFilteredHomes.length > 0) {
        // Transform to our format
        const properties = allFilteredHomes.slice(0, limitNum).map((home, i) => {
          const address = home.streetLine?.value || home.streetLine || '';
          const cityName = home.city || '';
          const homeState = home.state || stateUpper;
          const zip = home.zip || home.postalCode?.value || '';
          const price = home.price?.value || home.price || null;

          // Extract agent info from Redfin API data
          // Note: API only provides agent name, not phone/email/brokerage
          const agentInfo = home.listingAgent || {};

          return {
            fullAddress: [address, cityName, homeState, zip].filter(Boolean).join(', '),
            vendor: 'redfin',
            extractedAt: new Date().toISOString(),
            sourceIndex: i,
            url: home.url ? `https://www.redfin.com${home.url}` : null,
            state: homeState,
            city: cityName,
            price: price,
            priceText: price ? `$${price.toLocaleString()}` : null,
            beds: home.beds || null,
            bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
            baths: home.baths || null,
            bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
            sqft: home.sqFt?.value || null,
            sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
            propertyType: home.propertyType?.value || home.propertyType || 'Single Family',
            listingId: home.listingId || null,
            yearBuilt: home.yearBuilt?.value || null,
            daysOnMarket: home.dom?.value || null,
            latitude: home.latLong?.value?.latitude || null,
            longitude: home.latLong?.value?.longitude || null,
            status: 'active',
            // Listing type: 1=Agent, 2=Owner (FSBO), 3=Foreclosure
            listingType: home.listingType || 1,
            listingTypeText: home.listingType === 2 ? 'For Sale by Owner' :
                            home.listingType === 3 ? 'Foreclosure' : 'Agent Listed',
            // Agent details from Redfin API (only name available)
            agentName: agentInfo.name || null,
            redfinAgentId: agentInfo.redfinAgentId || null,
            // These require deep scraping - null by default, can be enriched later
            agentPhone: null,
            agentEmail: null,
            brokerage: null,
            mlsId: home.mlsId?.value || home.mlsNumber || null,
            agentEnriched: false // Flag to track if deep scraping was done
          };
        });

        L.info(`Successfully fetched ${properties.length} real properties from Redfin API (page ${pageNum}, sort=${sortOrder})`);

        // Enrich properties with agent details (name, phone, brokerage) if enabled
        let finalProperties = properties;
        let agentEnrichmentStats = null;

        if (shouldEnrichAgent && properties.length > 0) {
          L.info(`Starting agent enrichment for ${properties.length} properties...`);
          finalProperties = await enrichPropertiesWithAgentDetails(properties, 3);

          // Calculate enrichment stats
          const enrichedCount = finalProperties.filter(p => p.agentEnriched).length;
          const withPhoneCount = finalProperties.filter(p => p.agentPhone).length;
          agentEnrichmentStats = {
            total: properties.length,
            enriched: enrichedCount,
            withPhone: withPhoneCount,
            withBrokerage: finalProperties.filter(p => p.brokerage).length
          };
          L.info(`Agent enrichment complete: ${withPhoneCount}/${properties.length} have phone numbers`);
        }

        // Determine if there are more results
        const hasMore = allFilteredHomes.length >= limitNum;

        return res.json({
          ok: true,
          source: 'redfin.com (live API - multi-city)',
          scrapedAt: new Date().toISOString(),
          state: stateInfo.name,
          stateCode: stateInfo.code,
          citiesFetched: citiesFetched,
          filters: REDFIN_FILTERS,
          count: finalProperties.length,
          addresses: finalProperties,
          agentEnrichment: agentEnrichmentStats,
          pagination: {
            currentPage: pageNum,
            limit: limitNum,
            hasMore: hasMore,
            nextPage: hasMore ? pageNum + 1 : null
          },
          message: `Real active listings from ${citiesFetched.join(', ')}, ${stateInfo.name} (${finalProperties.length} properties${agentEnrichmentStats ? `, ${agentEnrichmentStats.withPhone} with agent phone` : ''})`
        });
      }

      L.warn('Redfin API returned no results from any city');
      return res.status(404).json({
        ok: false,
        error: 'No properties found',
        message: `Redfin returned no results for ${city || stateInfo.name}. The API may be blocking server requests or there are no listings matching the filters.`,
        addresses: []
      });
    } catch (apiErr) {
      L.error(`Redfin API failed: ${apiErr.message}`);
      return res.status(500).json({
        ok: false,
        error: apiErr.message || 'Redfin API failed',
        message: 'Failed to fetch data from Redfin. The API may be blocking server requests.',
        addresses: []
      });
    }

  } catch (error) {
    L.error('Live Redfin scrape failed', { error: error.message });

    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to scrape Redfin',
      message: 'Failed to generate mock data. Please try again.',
      addresses: []
    });
  }
});

/**
 * GET /api/live-scrape/test
 *
 * Test endpoint that returns mock data to verify the API works
 */
router.get('/test', requireAuth, async (req, res) => {
  const { limit = 10 } = req.query;

  // Mock addresses for testing
  const mockAddresses = [
    '123 Main St, San Francisco, CA 94102',
    '456 Oak Ave, Los Angeles, CA 90001',
    '789 Pine Dr, San Diego, CA 92101',
    '321 Elm Blvd, Sacramento, CA 95814',
    '654 Maple Ct, San Jose, CA 95110',
    '987 Cedar Ln, Fresno, CA 93650',
    '147 Birch Way, Oakland, CA 94601',
    '258 Willow St, Long Beach, CA 90802',
    '369 Spruce Rd, Bakersfield, CA 93301',
    '741 Redwood Pl, Anaheim, CA 92801'
  ].slice(0, parseInt(limit)).map((addr, i) => ({
    fullAddress: addr,
    vendor: 'privy',
    extractedAt: new Date().toISOString(),
    sourceIndex: i,
    test: true
  }));

  res.json({
    ok: true,
    source: 'test-mode',
    scrapedAt: new Date().toISOString(),
    count: mockAddresses.length,
    addresses: mockAddresses,
    message: 'Test data - Live scraping endpoint is working'
  });
});

export default router;
