// Test Redfin GIS API to see actual response structure
import axios from 'axios';

async function test() {
  const stateUpper = 'NC';
  const cityId = 3105; // Charlotte
  const market = 'nc';

  const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${market}&region_id=${cityId}&region_type=6&num_homes=10&status=9&ord=redfin-recommended-asc&v=8`;

  console.log('Testing Redfin API:', url);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': `https://www.redfin.com/city/${cityId}/${stateUpper}/Charlotte`
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

    // Show first 3 homes with full structure
    for (let i = 0; i < Math.min(3, homes.length); i++) {
      const home = homes[i];
      console.log(`\n=== Home ${i + 1} ===`);
      console.log('streetLine:', JSON.stringify(home.streetLine));
      console.log('city:', home.city);
      console.log('state:', home.state);
      console.log('zip:', home.zip);
      console.log('postalCode:', JSON.stringify(home.postalCode));
      console.log('price:', JSON.stringify(home.price));
      console.log('beds:', home.beds);
      console.log('baths:', home.baths);
      console.log('sqFt:', JSON.stringify(home.sqFt));
      console.log('url:', home.url);
      console.log('listingAgent:', JSON.stringify(home.listingAgent));
      console.log('listingRemarks:', home.listingRemarks?.substring(0, 100) + '...');

      // Build full address
      const address = home.streetLine?.value || home.streetLine || '';
      const cityName = home.city || '';
      const homeState = home.state || '';
      const zipCode = home.zip || home.postalCode?.value || '';
      const fullAddress = [address, cityName, homeState, zipCode].filter(Boolean).join(', ');
      console.log('\n→ Constructed fullAddress:', fullAddress);
    }

  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data?.substring?.(0, 500));
    }
  }
}

test();
