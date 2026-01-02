/**
 * Script to lookup Redfin city IDs for all cities
 * Run with: node scripts/lookup-redfin-cities.cjs
 */

const axios = require('axios');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cities from Privy's list (41 states - excluding AK, HI, MT, NM, ND, OH, SD, UT, WY)
const PRIVY_STATE_CITIES = {
  'AL': ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Gadsden'],
  'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler', 'Gilbert', 'Glendale', 'Tempe', 'Peoria', 'Surprise', 'Yuma', 'Flagstaff', 'Goodyear', 'Avondale'],
  'AR': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'Rogers', 'Conway', 'North Little Rock', 'Bentonville', 'Pine Bluff', 'Hot Springs'],
  'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista', 'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Moreno Valley', 'Glendale', 'Huntington Beach', 'Santa Clarita', 'Garden Grove', 'Oceanside'],
  'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland'],
  'CT': ['Hartford', 'New Haven', 'Stamford', 'Bridgeport', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'West Haven', 'Milford', 'Middletown', 'Norwich'],
  'DE': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
  'FL': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St Petersburg', 'Hialeah', 'Tallahassee', 'Cape Coral', 'Fort Myers', 'Pembroke Pines', 'Hollywood', 'Gainesville', 'Miramar', 'Coral Springs', 'Palm Bay', 'West Palm Beach', 'Clearwater', 'Lakeland', 'Pompano Beach', 'Davie', 'Boca Raton', 'Sunrise', 'Deltona', 'Plantation'],
  'GA': ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Macon', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta', 'Marietta', 'Valdosta', 'Smyrna', 'Dunwoody', 'Brookhaven'],
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
  'NE': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'North Platte', 'Columbus', 'Papillion', 'La Vista'],
  'NV': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City', 'Fallon'],
  'NH': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Hudson', 'Londonderry', 'Keene', 'Bedford', 'Portsmouth'],
  'NJ': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Clifton', 'Camden', 'Passaic', 'Union City', 'Bayonne', 'East Orange', 'Vineland', 'New Brunswick', 'Hoboken', 'Perth Amboy', 'Plainfield', 'West New York', 'Hackensack', 'Sayreville', 'Kearny', 'Linden', 'Atlantic City'],
  'NY': ['New York', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Troy', 'Niagara Falls', 'Binghamton', 'Freeport', 'Long Beach', 'Spring Valley', 'Valley Stream', 'Rome', 'Ithaca', 'Poughkeepsie', 'Jamestown', 'Elmira', 'Middletown', 'Auburn', 'Newburgh', 'Saratoga Springs'],
  'NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Greenville', 'Asheville', 'Gastonia', 'Jacksonville', 'Chapel Hill', 'Huntersville', 'Apex', 'Wake Forest', 'Kannapolis', 'Burlington', 'Rocky Mount', 'Hickory'],
  'OK': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Muskogee', 'Bartlesville', 'Owasso', 'Shawnee', 'Ponca City'],
  'OR': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Grants Pass', 'Oregon City'],
  'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Altoona', 'Erie', 'Wilkes Barre', 'Chester', 'State College', 'Easton', 'Lebanon', 'Hazleton'],
  'RI': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown', 'West Warwick', 'Johnston', 'Newport'],
  'SC': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach', 'Rock Hill', 'Mount Pleasant', 'North Charleston', 'Spartanburg', 'Summerville', 'Goose Creek', 'Hilton Head Island', 'Sumter', 'Florence', 'Greer', 'Anderson'],
  'TN': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett', 'Hendersonville', 'Kingsport', 'Collierville', 'Smyrna', 'Cleveland', 'Brentwood', 'Spring Hill'],
  'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Garland', 'Irving', 'Amarillo', 'Grand Prairie', 'McKinney', 'Frisco', 'Brownsville', 'Pasadena', 'Killeen', 'McAllen', 'Mesquite', 'Midland', 'Denton', 'Waco', 'Carrollton', 'Round Rock', 'Abilene', 'Pearland', 'Richardson', 'Odessa'],
  'VT': ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier', 'Winooski', 'St Albans', 'Newport', 'Vergennes', 'Middlebury'],
  'VA': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Arlington', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg', 'Harrisonburg', 'Charlottesville', 'Danville', 'Manassas', 'Petersburg', 'Fredericksburg', 'Leesburg', 'Salem'],
  'WA': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Federal Way', 'Spokane Valley', 'Kirkland', 'Bellingham', 'Auburn', 'Kennewick', 'Redmond', 'Marysville', 'Pasco', 'Lakewood', 'Yakima', 'Olympia', 'Sammamish', 'Burien'],
  'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg', 'South Charleston', 'Teays Valley'],
  'WI': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh', 'Janesville', 'West Allis', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'Brookfield', 'New Berlin', 'Beloit', 'Greenfield', 'Manitowoc'],
};

async function lookupCityId(cityName, stateCode) {
  const query = encodeURIComponent(`${cityName}, ${stateCode}`);
  const url = `https://www.redfin.com/stingray/do/location-autocomplete?location=${query}&v=2`;

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 10000
    });

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    // Look for city match (type 2 = city)
    const exactMatch = data.payload?.exactMatch;
    if (exactMatch && exactMatch.id) {
      const parts = exactMatch.id.split('_');
      if (parts[0] === '2') { // type 2 = city
        return { name: cityName, id: parseInt(parts[1], 10) };
      }
    }

    // Try sections
    const sections = data.payload?.sections || [];
    for (const section of sections) {
      for (const row of section.rows || []) {
        if (row.id && row.id.startsWith('2_')) {
          const id = parseInt(row.id.split('_')[1], 10);
          return { name: cityName, id };
        }
      }
    }

    return null;
  } catch (err) {
    console.error(`Error looking up ${cityName}, ${stateCode}: ${err.message}`);
    return null;
  }
}

async function main() {
  const results = {};
  let totalCities = 0;
  let foundCities = 0;

  for (const [stateCode, cities] of Object.entries(PRIVY_STATE_CITIES)) {
    console.log(`\nProcessing ${stateCode} (${cities.length} cities)...`);
    results[stateCode] = [];

    for (const cityName of cities) {
      totalCities++;
      const result = await lookupCityId(cityName, stateCode);

      if (result) {
        results[stateCode].push(result);
        foundCities++;
        console.log(`  ✓ ${cityName}: ${result.id}`);
      } else {
        console.log(`  ✗ ${cityName}: NOT FOUND`);
      }

      // Rate limit - 200ms between requests
      await sleep(200);
    }
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Found ${foundCities}/${totalCities} cities\n`);

  // Output as JavaScript object
  console.log('const STATE_CITIES = {');
  for (const [stateCode, cities] of Object.entries(results)) {
    if (cities.length > 0) {
      const cityList = cities.map(c => `{ name: '${c.name}', id: ${c.id} }`).join(', ');
      console.log(`  '${stateCode}': [${cityList}],`);
    }
  }
  console.log('};');
}

main().catch(console.error);
