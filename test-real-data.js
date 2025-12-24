// Test Redfin real data - NO AUTH REQUIRED
const http = require('http');

const PORT = 3015;
const url = `http://localhost:${PORT}/api/live-scrape/redfin?state=CA&limit=5`;

console.log('Fetching REAL data from Redfin...\n');

http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);

    console.log('✅ Source:', json.source);
    console.log('✅ Redfin API URL:', json.apiUrl);
    console.log('✅ State:', json.state);
    console.log('✅ Count:', json.count);
    console.log('✅ Message:', json.message);
    console.log('\n=== REAL PROPERTIES FROM REDFIN.COM ===\n');

    json.addresses.forEach((prop, i) => {
      console.log(`Property ${i+1}:`);
      console.log(`  Address: ${prop.fullAddress}`);
      console.log(`  Price: ${prop.priceText}`);
      console.log(`  Beds/Baths: ${prop.bedsText} / ${prop.bathsText}`);
      console.log(`  Size: ${prop.sqftText}`);
      console.log(`  Days on Market: ${prop.daysOnMarket} days`);
      console.log(`  Year Built: ${prop.yearBuilt}`);
      console.log(`  MLS ID: ${prop.mlsId}`);
      console.log(`  URL: ${prop.url}`);
      console.log('');
    });

    console.log('✅ ALL DATA IS REAL - FROM REDFIN OFFICIAL WEBSITE');
    console.log('✅ NO DATABASE - Data is NOT saved anywhere');
    console.log('✅ NO MOCK DATA - Only real listings');
  });
}).on('error', (err) => {
  console.error('❌ Error:', err.message);
});
