// Simpler direct test
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testDirect() {
  try {
    // Direct test with hardcoded California region_id = 9, region_type = 11
    const gisUrl = 'https://www.redfin.com/stingray/api/gis?al=1&region_id=9&region_type=11&num_homes=5&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8';

    console.log('Testing GIS API directly for California (region_id=9, region_type=11)');
    console.log('URL:', gisUrl, '\n');

    const response = await axios.get(gisUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 30000
    });

    console.log('Status:', response.status);
    console.log('Response (first 1000 chars):', response.data.substring(0, 1000), '\n');

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const homes = data.payload?.homes || [];
    console.log('\n✅ Found', homes.length, 'active homes in California!\n');

    if (homes.length > 0) {
      console.log('First 3 listings:');
      homes.slice(0, 3).forEach((home, i) => {
        console.log(`\n${i + 1}. ${home.streetLine?.value || 'No address'}`);
        console.log(`   City: ${home.city?.value}, ${home.state?.value} ${home.zip?.value}`);
        console.log(`   Price: $${(home.price?.value || 0).toLocaleString()}`);
        console.log(`   Beds: ${home.beds?.value}, Baths: ${home.baths?.value}, Sqft: ${home.sqFt?.value}`);
        console.log(`   URL: https://www.redfin.com${home.url}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data?.substring(0, 500));
    }
  }
}

testDirect();
