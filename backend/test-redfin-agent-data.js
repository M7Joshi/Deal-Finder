// Test script to inspect Redfin API response for agent data
import axios from 'axios';

const STATE = 'NC';
const CITY_ID = 35713; // Cary, NC
const MARKET = 'nc';

const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${MARKET}&region_id=${CITY_ID}&region_type=6&num_homes=5&status=9&ord=redfin-recommended-asc&v=8`;

console.log('Fetching from Redfin API...');
console.log('URL:', url);

try {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': `https://www.redfin.com/city/${CITY_ID}/${STATE}/${MARKET}`
    },
    timeout: 15000
  });

  let data = response.data;
  if (typeof data === 'string') {
    data = data.replace(/^\{\}&&/, '');
    data = JSON.parse(data);
  }

  const homes = data.payload?.homes || [];
  console.log(`\nFound ${homes.length} homes\n`);

  // Inspect first home for agent data structure
  if (homes.length > 0) {
    const home = homes[0];

    console.log('=== SAMPLE HOME STRUCTURE ===\n');
    console.log('Property:', home.streetLine?.value || home.streetLine);
    console.log('City:', home.city);
    console.log('Price:', home.price?.value || home.price);

    console.log('\n=== AGENT FIELDS AVAILABLE ===\n');

    // Check all possible agent-related fields
    const agentFields = [
      'listingAgent',
      'agent',
      'agentName',
      'brokerInfo',
      'brokerageName',
      'mlsId',
      'mlsNumber',
      'listingType'
    ];

    agentFields.forEach(field => {
      if (home[field] !== undefined) {
        console.log(`${field}:`, JSON.stringify(home[field], null, 2));
      }
    });

    console.log('\n=== CHECKING NESTED AGENT DATA ===\n');

    if (home.listingAgent) {
      console.log('home.listingAgent:', JSON.stringify(home.listingAgent, null, 2));
    }

    if (home.agent) {
      console.log('home.agent:', JSON.stringify(home.agent, null, 2));
    }

    if (home.brokerInfo) {
      console.log('home.brokerInfo:', JSON.stringify(home.brokerInfo, null, 2));
    }

    console.log('\n=== ALL HOME KEYS ===\n');
    console.log(Object.keys(home).sort().join(', '));

    console.log('\n=== FULL HOME OBJECT (First Property) ===\n');
    console.log(JSON.stringify(home, null, 2));
  }
} catch (error) {
  console.error('Error:', error.message);
}
