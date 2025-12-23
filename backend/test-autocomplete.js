// Test Redfin autocomplete API
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testAutocomplete(location) {
  try {
    console.log(`\n========== Testing autocomplete for: ${location} ==========`);

    const url = 'https://www.redfin.com/stingray/do/location-autocomplete';
    const params = new URLSearchParams({
      location: location,
      v: '2'
    });

    const fullUrl = `${url}?${params.toString()}`;
    console.log('URL:', fullUrl);

    const response = await axios.get(fullUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 10000
    });

    console.log('Status:', response.status);
    console.log('Response (first 500 chars):', JSON.stringify(response.data).substring(0, 500));

    // Parse the weird Redfin format: {}&&{...}
    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const payload = data.payload || data;
    const sections = payload.sections || [];

    console.log(`\nFound ${sections.length} sections`);

    // Find state-level region (type 11 = State)
    for (const section of sections) {
      const rows = section.rows || [];
      console.log(`\nSection with ${rows.length} rows:`);

      for (const row of rows) {
        console.log(`  - Type: ${row.type}, Name: ${row.name}, ID: ${row.id}`);

        if (row.type === 11) { // Type 11 = State
          console.log(`  ✅ FOUND STATE REGION: ${row.name} (ID: ${row.id})`);
          const region_id = row.id.split('_')[1];
          console.log(`  Extracted region_id: ${region_id}`);
          return {
            region_id: region_id,
            region_type: row.type,
            name: row.name
          };
        }
      }
    }

    console.log('\n❌ No state-level region (type 11) found');
    return null;

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    return null;
  }
}

async function main() {
  console.log('🔍 Testing Redfin Autocomplete API\n');

  await testAutocomplete('New Jersey');
  await testAutocomplete('North Carolina');
  await testAutocomplete('California');
  await testAutocomplete('NJ');

  console.log('\n\n✅ Test complete!');
}

main();
