// Test script to directly call Redfin API
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testRedfinAPI() {
  try {
    console.log('Testing Redfin Autocomplete API for California...\n');

    // Test autocomplete with full state name
    const autocompleteUrl = 'https://www.redfin.com/stingray/do/location-autocomplete?location=California&v=2';

    const response1 = await axios.get(autocompleteUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 10000
    });

    console.log('Raw response:', response1.data.substring(0, 500));

    let data = response1.data;
    data = data.replace(/^\{\}&&/, '');
    data = JSON.parse(data);

    const sections = data.payload?.sections || [];
    console.log('\nFound', sections.length, 'sections');

    for (const section of sections) {
      const rows = section.rows || [];
      console.log('\nSection with', rows.length, 'rows');

      for (const row of rows) {
        console.log('  - Row:', row.type, row.name, row.id);

        if (row.type === 11) { // Type 11 = State
          console.log('✅ Found STATE region:', {
            id: row.id,
            name: row.name,
            type: row.type,
            url: row.url
          });

          // Extract numeric ID from "11_9"
          const region_id = row.id.split('_')[1];

          // Now test GIS API with this region
          console.log('\n\nTesting GIS API with region_id:', region_id);

          const gisUrl = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${region_id}&region_type=11&num_homes=5&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8`;

          console.log('GIS URL:', gisUrl);

          const response2 = await axios.get(gisUrl, {
            headers: {
              'User-Agent': USER_AGENT,
              'Accept': 'application/json',
              'Referer': 'https://www.redfin.com/'
            },
            timeout: 30000
          });

          console.log('\nGIS Raw response (first 500 chars):', response2.data.substring(0, 500));

          let gisData = response2.data;
          gisData = gisData.replace(/^\{\}&&/, '');
          gisData = JSON.parse(gisData);

          const homes = gisData.payload?.homes || [];
          console.log('\n✅ Found', homes.length, 'homes');

          if (homes.length > 0) {
            console.log('\nFirst home:');
            const first = homes[0];
            console.log({
              address: first.streetLine?.value,
              city: first.city?.value,
              state: first.state?.value,
              price: first.price?.value,
              beds: first.beds?.value,
              baths: first.baths?.value,
              sqft: first.sqFt?.value,
              url: first.url
            });
          }

          return;
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data?.substring(0, 500));
    }
  }
}

testRedfinAPI();
