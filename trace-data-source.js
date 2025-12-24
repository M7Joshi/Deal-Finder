// Trace where the 53 addresses are coming from
const BASE_URL = 'https://deal-finder-8tyx.onrender.com';

async function traceDataSource() {
  console.log('='.repeat(80));
  console.log('TRACING DATA SOURCE: Where are the 53 addresses coming from?');
  console.log('='.repeat(80));
  console.log();

  try {
    // Step 1: Login
    console.log('STEP 1: Authenticating...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mcox@mioym.com',
        password: 'Mioym@2900'
      })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('✓ Authenticated as:', loginData.user.fullName);
    console.log();

    // Step 2: Fetch from API
    console.log('STEP 2: Fetching data from API endpoint...');
    console.log(`Endpoint: ${BASE_URL}/api/properties/table?onlyDeals=true`);
    const dealsRes = await fetch(`${BASE_URL}/api/properties/table?onlyDeals=true&limit=2000`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const dealsData = await dealsRes.json();
    const apiRows = dealsData.rows || [];
    console.log(`✓ API returned ${apiRows.length} deals`);
    console.log();

    // Step 3: Show sample raw data
    console.log('STEP 3: Sample raw data from API (first property):');
    if (apiRows.length > 0) {
      const sample = apiRows[0];
      console.log(JSON.stringify({
        _id: sample._id,
        prop_id: sample.prop_id,
        fullAddress: sample.fullAddress,
        address: sample.address,
        city: sample.city,
        state: sample.state,
        zip: sample.zip,
        listingPrice: sample.listingPrice,
        amv: sample.amv,
        beds: sample.beds,
        deal: sample.deal
      }, null, 2));
    }
    console.log();

    // Step 4: Apply frontend filters
    console.log('STEP 4: Applying frontend filters...');
    const MIN_BEDS = 3;
    const MIN_AMV = 150000;

    console.log(`Filter 1: LP <= 50% of AMV (deal ratio)`);
    const ratioFiltered = apiRows.filter(r => {
      const amv = Number(r.amv);
      const lp = Number(r.listingPrice || r.price);
      return amv > 0 && lp > 0 && lp <= (amv * 0.5);
    });
    console.log(`  Result: ${apiRows.length} → ${ratioFiltered.length} properties`);

    console.log(`Filter 2: beds >= ${MIN_BEDS}`);
    const bedsFiltered = ratioFiltered.filter(r => Number(r.beds) >= MIN_BEDS);
    console.log(`  Result: ${ratioFiltered.length} → ${bedsFiltered.length} properties`);

    console.log(`Filter 3: AMV >= $${MIN_AMV.toLocaleString()}`);
    const finalFiltered = bedsFiltered.filter(r => Number(r.amv) >= MIN_AMV);
    console.log(`  Result: ${bedsFiltered.length} → ${finalFiltered.length} properties`);
    console.log();

    // Step 5: Show where addresses come from
    console.log('STEP 5: Address field sources in the data:');
    console.log();
    console.log('The addresses come from MongoDB properties collection.');
    console.log('Each property document has these address fields:');
    console.log('  - fullAddress: Complete address string');
    console.log('  - address: Same or shortened version');
    console.log('  - city: City name');
    console.log('  - state: State code (often empty)');
    console.log('  - zip: ZIP code');
    console.log();

    // Step 6: Show the 53 addresses
    console.log(`STEP 6: The ${finalFiltered.length} addresses that pass all filters:`);
    console.log('='.repeat(80));
    finalFiltered.forEach((r, i) => {
      const addr = r.fullAddress || r.address || 'NO ADDRESS';
      const ratio = ((r.listingPrice / r.amv) * 100).toFixed(1);
      console.log(`${String(i + 1).padStart(2, ' ')}. ${addr}`);
      console.log(`    Beds: ${r.beds} | AMV: $${r.amv.toLocaleString()} | LP: $${r.listingPrice.toLocaleString()} | Ratio: ${ratio}%`);
    });
    console.log('='.repeat(80));
    console.log();

    // Step 7: Data source chain
    console.log('STEP 7: Complete data flow chain:');
    console.log();
    console.log('  1. MongoDB Atlas Database');
    console.log('     ↓');
    console.log('     Database: deal_finder');
    console.log('     Collection: properties');
    console.log('     Filter: { deal: true }');
    console.log('     ↓');
    console.log(`  2. Backend API (server.js + properties.js route)`);
    console.log('     ↓');
    console.log(`     Endpoint: GET /api/properties/table?onlyDeals=true`);
    console.log(`     Returns: ${apiRows.length} deals`);
    console.log('     ↓');
    console.log('  3. Frontend filters (Deals.tsx)');
    console.log('     ↓');
    console.log(`     Filter: beds >= 3, AMV >= $150k, LP <= 50% AMV`);
    console.log(`     Final result: ${finalFiltered.length} properties displayed`);
    console.log();

    // Step 8: Connection string
    console.log('STEP 8: Database connection:');
    console.log('  MongoDB URI: mongodb+srv://mioymapp_db_user@cluster0.ldjcoor.mongodb.net/deal_finder');
    console.log('  (from backend/.env file)');
    console.log();

    console.log('✓ SUMMARY:');
    console.log(`  - Total in database (with deal:true): ${apiRows.length}`);
    console.log(`  - After frontend filters: ${finalFiltered.length}`);
    console.log(`  - All addresses exist in MongoDB Atlas`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

traceDataSource();
