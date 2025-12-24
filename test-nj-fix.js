// Test script to verify the fix - Test NJ state now returns correct data
import http from 'http';

async function testRedfinEndpoint(state) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:3015/api/live-scrape/redfin?state=${state}&limit=5`;

    console.log(`\n========== Testing ${state} ==========`);
    console.log('URL:', url);

    const options = {
      hostname: 'localhost',
      port: 3015,
      path: `/api/live-scrape/redfin?state=${state}&limit=5`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (result.ok && result.addresses && result.addresses.length > 0) {
            console.log(`\n✅ Got ${result.addresses.length} properties`);
            console.log(`State requested: ${state}`);
            console.log(`State in response: ${result.stateCode}`);

            console.log('\n📍 First 3 properties:');
            result.addresses.slice(0, 3).forEach((addr, i) => {
              // Extract state from fullAddress
              const parts = addr.fullAddress.split(',');
              const stateFromAddr = parts.length >= 3 ? parts[parts.length - 2].trim().split(' ')[0] : 'Unknown';

              console.log(`\n${i + 1}. ${addr.fullAddress}`);
              console.log(`   State in address: ${stateFromAddr}`);
              console.log(`   Price: ${addr.priceText || 'N/A'}`);
              console.log(`   ${addr.bedsText || 'N/A'}, ${addr.bathsText || 'N/A'}`);
            });

            // Verify all addresses are from the correct state
            const wrongStates = result.addresses.filter(addr => {
              const parts = addr.fullAddress.split(',');
              const stateFromAddr = parts.length >= 3 ? parts[parts.length - 2].trim().split(' ')[0] : '';
              return stateFromAddr !== state;
            });

            if (wrongStates.length > 0) {
              console.log(`\n⚠️ WARNING: Found ${wrongStates.length} properties from wrong state!`);
              console.log('First wrong property:', wrongStates[0].fullAddress);
            } else {
              console.log(`\n✅ ALL properties are from ${state}!`);
            }

          } else {
            console.log('\n❌ No properties returned or error:', result.message || result.error);
          }

          resolve();
        } catch (error) {
          console.error('Error parsing response:', error.message);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error.message);
      reject(error);
    });

    req.end();
  });
}

async function main() {
  console.log('🔍 Testing Redfin Endpoint with Fixed Region IDs\n');

  // Test NJ (the one that was broken)
  await testRedfinEndpoint('NJ');

  // Test a few other states to make sure we didn't break anything
  await testRedfinEndpoint('NC');
  await testRedfinEndpoint('CA');

  console.log('\n\n✅ Test complete!');
  console.log('\nIf NJ now shows New Jersey properties instead of Washington, the fix worked!');
}

main().catch(console.error);
