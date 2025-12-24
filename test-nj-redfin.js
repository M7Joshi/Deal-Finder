// Test script to verify NJ region ID and check what data Redfin returns
import https from 'https';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 20000);

    https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      }
    }, (res) => {
      clearTimeout(timeout);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function testRegion(regionId, stateName) {
  console.log(`\n========== Testing ${stateName} (Region ID: ${regionId}) ==========`);

  const url = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${regionId}&region_type=11&num_homes=5&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8`;

  console.log('URL:', url);

  try {
    const rawData = await httpsGet(url);
    let data = rawData.replace(/^\{\}&&/, '');
    data = JSON.parse(data);

    const homes = data.payload?.homes || [];
    console.log(`\n✅ Got ${homes.length} listings`);

    if (homes.length > 0) {
      console.log('\n📍 First 5 properties:');
      homes.slice(0, 5).forEach((home, i) => {
        const address = home.streetLine?.value || 'N/A';
        const city = home.city || 'N/A';
        const state = home.state || 'N/A';
        const price = home.price?.value || 'N/A';
        const status = home.mlsStatus?.value || 'Unknown';

        console.log(`\n${i + 1}. ${address}`);
        console.log(`   City: ${city}, State: ${state}`);
        console.log(`   Price: $${typeof price === 'number' ? price.toLocaleString() : price}`);
        console.log(`   Status: ${status}`);
        console.log(`   URL: https://www.redfin.com${home.url || ''}`);
      });

      // Count states
      const stateCounts = {};
      homes.forEach(home => {
        const st = home.state || 'Unknown';
        stateCounts[st] = (stateCounts[st] || 0) + 1;
      });

      console.log('\n📊 States in results:');
      Object.entries(stateCounts).forEach(([st, count]) => {
        console.log(`   ${st}: ${count} properties`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function main() {
  console.log('🔍 Testing Redfin Region IDs\n');
  console.log('Testing if region_id=34 actually returns NJ properties or WA properties...\n');

  // Test NJ (should be region 34 according to our code)
  await testRegion(34, 'New Jersey (NJ)');

  // Test WA (should be region 53 according to our code)
  await testRegion(53, 'Washington (WA)');

  // Let's also test a few other states to verify the pattern
  await testRegion(37, 'North Carolina (NC)');
  await testRegion(9, 'California (CA)');

  console.log('\n\n✅ Test complete!');
  console.log('\nIf region_id=34 shows WA properties, then the hardcoded IDs are wrong.');
}

main();
