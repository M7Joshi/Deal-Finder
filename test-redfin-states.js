// Comprehensive test of Redfin API for multiple states
import http from 'http';

async function testRedfinAPI(state) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3015,
      path: `/api/live-scrape/redfin?state=${state}&limit=10`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing State: ${state}`);
    console.log('='.repeat(70));
    console.log(`URL: http://localhost:3015/api/live-scrape/redfin?state=${state}&limit=10`);

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          console.log(`\nResponse Status: ${res.statusCode}`);
          console.log(`API Status: ${result.ok ? '✅ OK' : '❌ ERROR'}`);
          console.log(`Source: ${result.source || 'N/A'}`);
          console.log(`State Requested: ${state}`);
          console.log(`State in Response: ${result.stateCode || 'N/A'}`);
          console.log(`Properties Returned: ${result.count || 0}`);

          if (result.addresses && result.addresses.length > 0) {
            console.log(`\n📍 Properties Found:`);
            result.addresses.slice(0, 5).forEach((addr, i) => {
              const stateFromAddr = addr.state || 'Unknown';
              const isCorrectState = stateFromAddr === state;
              const indicator = isCorrectState ? '✅' : '❌';

              console.log(`\n${i + 1}. ${indicator} ${addr.fullAddress}`);
              console.log(`   State: ${stateFromAddr} ${isCorrectState ? '(CORRECT)' : '(WRONG - Expected ' + state + ')'}`);
              console.log(`   Price: ${addr.priceText || 'N/A'}`);
              console.log(`   ${addr.bedsText || 'N/A'}, ${addr.bathsText || 'N/A'}`);
              if (addr.url) {
                console.log(`   URL: ${addr.url}`);
              }
            });

            // Summary
            const correctState = result.addresses.filter(a => a.state === state).length;
            const wrongState = result.addresses.filter(a => a.state !== state).length;

            console.log(`\n📊 Summary:`);
            console.log(`   ✅ Correct State (${state}): ${correctState}`);
            console.log(`   ❌ Wrong State: ${wrongState}`);

            if (wrongState > 0) {
              const states = {};
              result.addresses.forEach(a => {
                const st = a.state || 'Unknown';
                states[st] = (states[st] || 0) + 1;
              });
              console.log(`   States Found:`, states);
            }
          } else {
            console.log(`\n⚠️  No properties returned`);
            console.log(`   Message: ${result.message || 'N/A'}`);
            if (result.error) {
              console.log(`   Error: ${result.error}`);
            }
          }

          resolve(result);
        } catch (error) {
          console.error('❌ Failed to parse response:', error.message);
          console.error('Raw response:', data.substring(0, 500));
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });

    req.end();
  });
}

async function main() {
  console.log('\n🔍 REDFIN API STATE TESTING');
  console.log('Testing multiple states to verify API behavior\n');

  const states = ['NJ', 'NC', 'CA', 'TX', 'FL', 'NY'];

  for (const state of states) {
    try {
      await testRedfinAPI(state);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between requests
    } catch (error) {
      console.error(`Failed to test ${state}:`, error.message);
    }
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('✅ TESTING COMPLETE');
  console.log('='.repeat(70));
  console.log('\nConclusion:');
  console.log('If all states return 0 properties or only WA properties,');
  console.log('then Redfin\'s state-level GIS API is broken and only returns WA data.');
}

main().catch(console.error);
