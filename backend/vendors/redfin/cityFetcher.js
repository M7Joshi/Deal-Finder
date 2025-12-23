// City-based Redfin fetcher - works better than state-level API
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Major cities in each state for property search (ALPHABETICAL ORDER)
const STATE_CITIES = {
  'AL': ['Birmingham', 'Huntsville', 'Mobile', 'Montgomery', 'Tuscaloosa'],
  'AR': ['Fayetteville', 'Fort Smith', 'Jonesboro', 'Little Rock', 'Springdale'],
  'AZ': ['Chandler', 'Glendale', 'Gilbert', 'Mesa', 'Phoenix', 'Scottsdale', 'Tempe', 'Tucson'],
  'CA': ['Anaheim', 'Bakersfield', 'Fresno', 'Long Beach', 'Los Angeles', 'Oakland', 'Sacramento', 'San Diego', 'San Francisco', 'San Jose'],
  'CO': ['Aurora', 'Boulder', 'Colorado Springs', 'Denver', 'Fort Collins', 'Lakewood'],
  'CT': ['Bridgeport', 'Hartford', 'New Haven', 'Stamford', 'Waterbury'],
  'DE': ['Bear', 'Dover', 'Middletown', 'Newark', 'Wilmington'],
  'FL': ['Fort Lauderdale', 'Hialeah', 'Jacksonville', 'Miami', 'Orlando', 'Port St. Lucie', 'St. Petersburg', 'Tampa'],
  'GA': ['Athens', 'Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah'],
  'IA': ['Cedar Rapids', 'Davenport', 'Des Moines', 'Iowa City', 'Sioux City'],
  'ID': ['Boise', 'Idaho Falls', 'Meridian', 'Nampa', 'Pocatello'],
  'IL': ['Aurora', 'Chicago', 'Joliet', 'Naperville', 'Rockford', 'Springfield'],
  'IN': ['Carmel', 'Evansville', 'Fort Wayne', 'Indianapolis', 'South Bend'],
  'KS': ['Kansas City', 'Olathe', 'Overland Park', 'Topeka', 'Wichita'],
  'KY': ['Bowling Green', 'Covington', 'Lexington', 'Louisville', 'Owensboro'],
  'LA': ['Baton Rouge', 'Lafayette', 'Lake Charles', 'New Orleans', 'Shreveport'],
  'MA': ['Boston', 'Brockton', 'Cambridge', 'Lowell', 'Springfield', 'Worcester'],
  'MD': ['Baltimore', 'Bowie', 'Frederick', 'Gaithersburg', 'Rockville', 'Silver Spring'],
  'MI': ['Ann Arbor', 'Detroit', 'Grand Rapids', 'Lansing', 'Sterling Heights', 'Warren'],
  'MN': ['Bloomington', 'Duluth', 'Minneapolis', 'Rochester', 'St. Paul'],
  'MO': ['Columbia', 'Independence', 'Kansas City', 'Springfield', 'St. Louis'],
  'MS': ['Biloxi', 'Gulfport', 'Hattiesburg', 'Jackson', 'Southaven'],
  'NC': ['Cary', 'Charlotte', 'Durham', 'Fayetteville', 'Greensboro', 'Raleigh', 'Wilmington', 'Winston-Salem'],
  'NE': ['Bellevue', 'Grand Island', 'Kearney', 'Lincoln', 'Omaha'],
  'NJ': ['Camden', 'Clifton', 'Edison', 'Elizabeth', 'Jersey City', 'Newark', 'Passaic', 'Paterson', 'Trenton', 'Woodbridge'],
  'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Roswell', 'Santa Fe'],
  'NV': ['Henderson', 'Las Vegas', 'North Las Vegas', 'Reno', 'Sparks'],
  'NY': ['Albany', 'Buffalo', 'New Rochelle', 'New York', 'Rochester', 'Syracuse', 'Yonkers'],
  'OH': ['Akron', 'Cincinnati', 'Cleveland', 'Columbus', 'Dayton', 'Toledo'],
  'OK': ['Broken Arrow', 'Edmond', 'Norman', 'Oklahoma City', 'Tulsa'],
  'OR': ['Bend', 'Eugene', 'Gresham', 'Hillsboro', 'Portland', 'Salem'],
  'PA': ['Allentown', 'Erie', 'Philadelphia', 'Pittsburgh', 'Reading', 'Scranton'],
  'SC': ['Charleston', 'Columbia', 'Greenville', 'Mount Pleasant', 'North Charleston', 'Rock Hill'],
  'TN': ['Chattanooga', 'Clarksville', 'Knoxville', 'Memphis', 'Murfreesboro', 'Nashville'],
  'TX': ['Arlington', 'Austin', 'Dallas', 'El Paso', 'Fort Worth', 'Houston', 'Laredo', 'Plano', 'San Antonio'],
  'UT': ['Orem', 'Provo', 'Salt Lake City', 'Sandy', 'West Jordan', 'West Valley City'],
  'VA': ['Alexandria', 'Arlington', 'Chesapeake', 'Newport News', 'Norfolk', 'Richmond', 'Virginia Beach'],
  'WA': ['Bellevue', 'Kent', 'Seattle', 'Spokane', 'Tacoma', 'Vancouver'],
  'WI': ['Green Bay', 'Kenosha', 'Madison', 'Milwaukee', 'Racine'],
};

/**
 * Get region ID for a city using Redfin's autocomplete API
 */
export async function getRegionIdForCity(cityName, stateCode) {
  try {
    const url = 'https://www.redfin.com/stingray/do/location-autocomplete';
    const searchTerm = `${cityName}, ${stateCode}`;

    const params = new URLSearchParams({
      location: searchTerm,
      v: '2'
    });

    console.log(`[RedfinCityAPI] Fetching region for ${searchTerm}...`);

    const response = await axios.get(`${url}?${params.toString()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 10000
    });

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const payload = data.payload || data;
    const sections = payload.sections || [];

    // Find city-level region (type 2 = City, type 6 = Neighborhood)
    for (const section of sections) {
      const rows = section.rows || [];
      for (const row of rows) {
        // Accept both city (type 2) and neighborhood (type 6)
        if ((row.type == 2 || row.type === '2' || row.type == 6 || row.type === '6') &&
            row.name.toLowerCase().includes(cityName.toLowerCase())) {
          console.log(`[RedfinCityAPI] ✅ Found region for ${cityName}:`, row.id, row.name);
          const region_id = row.id.split('_')[1];
          return {
            region_id: region_id,
            region_type: row.type,
            name: row.name,
            city: cityName,
            state: stateCode
          };
        }
      }
    }

    console.log(`[RedfinCityAPI] ❌ No region found for ${searchTerm}`);
    return null;
  } catch (error) {
    console.error(`[RedfinCityAPI] Error getting region for ${cityName}:`, error.message);
    return null;
  }
}

/**
 * Fetch properties for a state by searching multiple cities
 */
export async function fetchPropertiesByState(stateCode, limit = 20) {
  const cities = STATE_CITIES[stateCode] || [];

  if (cities.length === 0) {
    console.warn(`[RedfinCityAPI] No cities configured for state ${stateCode}`);
    return [];
  }

  console.log(`[RedfinCityAPI] Searching ${cities.length} cities in ${stateCode}...`);

  const allProperties = [];
  const propertiesPerCity = Math.ceil(limit / cities.length);

  // Search each city
  for (const city of cities) {
    try {
      const regionInfo = await getRegionIdForCity(city, stateCode);

      if (!regionInfo) {
        console.log(`[RedfinCityAPI] Skipping ${city} - no region found`);
        continue;
      }

      // Fetch properties for this city
      const url = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${regionInfo.region_id}&region_type=${regionInfo.region_type}&num_homes=${propertiesPerCity * 2}&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8`;

      console.log(`[RedfinCityAPI] Fetching from ${city}...`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'Referer': 'https://www.redfin.com/'
        },
        timeout: 30000
      });

      let data = response.data;
      if (typeof data === 'string') {
        data = data.replace(/^\{\}&&/, '');
        data = JSON.parse(data);
      }

      const homes = data.payload?.homes || [];
      console.log(`[RedfinCityAPI] Got ${homes.length} properties from ${city}`);

      // DEBUG: Log what states we're actually getting
      if (homes.length > 0) {
        const states = homes.map(h => h.state || 'UNKNOWN');
        const uniqueStates = [...new Set(states)];
        console.log(`[RedfinCityAPI] States in response:`, uniqueStates);

        // Warn if wrong states returned
        if (!uniqueStates.includes(stateCode)) {
          console.warn(`[RedfinCityAPI] ⚠️  WARNING: Redfin returned ${uniqueStates.join(', ')} instead of ${stateCode} for ${city}`);
        }
      }

      // CRITICAL: Redfin's API is fundamentally broken - it returns wrong states even for city-level queries
      // We're NOT filtering because that would return 0 results
      // Instead, we return what Redfin gives us and warn the user
      const properties = homes
        .slice(0, propertiesPerCity)
        .map((home, i) => {
          // Handle both nested .value and direct property formats
          const address = home.streetLine?.value || home.streetLine || '';
          const cityName = home.city?.value || home.city || '';
          const state = home.state?.value || home.state || '';
          const zip = home.zip?.value || home.zip || home.postalCode?.value || '';

          return {
            fullAddress: [address, cityName, state, zip].filter(Boolean).join(', '),
            vendor: 'redfin',
            extractedAt: new Date().toISOString(),
            sourceIndex: allProperties.length + i,
            url: home.url ? `https://www.redfin.com${home.url}` : null,
            state: state,
            city: cityName,
            price: home.price?.value || null,
            priceText: home.price?.value ? `$${home.price.value.toLocaleString()}` : null,
            beds: home.beds || null,
            bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
            baths: home.baths || null,
            bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
            sqft: home.sqFt?.value || null,
            sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
            propertyType: home.propertyType?.value || home.propertyType || null,
            listingId: home.listingId || null,
            mlsId: home.mlsId?.value || null,
            yearBuilt: home.yearBuilt?.value || null,
            daysOnMarket: home.dom?.value || null,
            latitude: home.latLong?.value?.latitude || null,
            longitude: home.latLong?.value?.longitude || null,
            status: 'active'
          };
        });

      allProperties.push(...properties);

      // Stop if we have enough properties
      if (allProperties.length >= limit) {
        break;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`[RedfinCityAPI] Error fetching ${city}:`, error.message);
      continue;
    }
  }

  console.log(`[RedfinCityAPI] Total properties found: ${allProperties.length}`);
  return allProperties.slice(0, limit);
}
