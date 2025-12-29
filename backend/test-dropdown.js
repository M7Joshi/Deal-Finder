// Test script to verify Privy scraper with state-level mode
// Usage: node test-dropdown.js [state] [limit] [mode]
// mode: 'state' (simpler cluster approach) or 'city' (default city-by-city)

const API_BASE = 'http://localhost:3015';

async function test() {
  const stateArg = process.argv[2] || 'NJ';
  const limitArg = process.argv[3] || '5';
  const modeArg = process.argv[4] || 'state'; // Default to state mode now

  console.log(`\n=== Privy API Test ===`);
  console.log(`State: ${stateArg}, Limit: ${limitArg}, Mode: ${modeArg}\n`);

  // Test without auth first (using test endpoint)
  console.log('Testing via /privy-test endpoint (no auth required)...\n');

  const startTime = Date.now();
  const url = `${API_BASE}/api/live-scrape/privy-test?state=${stateArg}&limit=${limitArg}&mode=${modeArg}`;
  console.log(`URL: ${url}\n`);

  const res = await fetch(url);
  const data = await res.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== RESULT (${elapsed}s) ===`);
  console.log('OK:', data.ok);
  console.log('State:', data.state);
  console.log('Mode:', data.mode || 'city');
  console.log('Addresses found:', data.count);

  if (data.citiesScraped) {
    console.log('Cities scraped:', data.citiesScraped);
  }

  if (data.addresses && data.addresses.length > 0) {
    console.log('\nAddresses:');
    data.addresses.slice(0, 10).forEach((addr, i) => {
      console.log(`  ${i + 1}. ${addr.fullAddress}`);
      console.log(`     City: ${addr.city || 'N/A'}, Price: ${addr.price || 'N/A'}`);
    });
    if (data.addresses.length > 10) {
      console.log(`  ... and ${data.addresses.length - 10} more`);
    }
  }

  if (data.error) {
    console.log('\nError:', data.error);
  }

  console.log('\nDone!');
}

test().catch(e => console.error('Error:', e.message));
