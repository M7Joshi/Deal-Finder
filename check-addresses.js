// Check why addresses might not show up
const BASE_URL = 'https://deal-finder-8tyx.onrender.com';

async function checkAddresses() {
  console.log('Testing address visibility...\n');

  try {
    // Login
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

    // Fetch deals
    const dealsRes = await fetch(`${BASE_URL}/api/properties/table?onlyDeals=true&limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const dealsData = await dealsRes.json();
    const rows = dealsData.rows || [];

    console.log(`Total deals from API: ${rows.length}\n`);

    // Apply the same filters as the frontend
    const MIN_BEDS = 3;
    const MIN_AMV = 150000;

    const filtered = rows.filter(r => {
      const beds = Number(r.beds);
      const amv = Number(r.amv);
      const lp = Number(r.listingPrice || r.price);

      // Frontend filter: LP <= 50% of AMV
      const meetsRatio = amv > 0 && lp > 0 && lp <= (amv * 0.5);
      const meetsBeds = beds >= MIN_BEDS;
      const meetsAmv = amv >= MIN_AMV;

      return meetsRatio && meetsBeds && meetsAmv;
    });

    console.log(`After frontend filters (beds>=3, AMV>=150k, LP<=50% AMV): ${filtered.length}\n`);

    if (filtered.length > 0) {
      console.log('Sample properties that SHOULD show up:');
      filtered.slice(0, 5).forEach((r, i) => {
        console.log(`\n${i + 1}. ${r.fullAddress || r.address || 'NO ADDRESS'}`);
        console.log(`   Beds: ${r.beds}, AMV: $${r.amv}, LP: $${r.listingPrice || r.price}`);
        console.log(`   State: "${r.state || '(empty)'}"`);
        console.log(`   Ratio: ${((r.listingPrice / r.amv) * 100).toFixed(1)}%`);
      });
    } else {
      console.log('❌ NO PROPERTIES pass the frontend filters!');
      console.log('\nLet\'s see why. Checking first 10 deals:');                                                                                                  

      rows.slice(0, 10).forEach((r, i) => {
        const beds = Number(r.beds);
        const amv = Number(r.amv);
        const lp = Number(r.listingPrice || r.price);
        const ratio = lp / amv;

        console.log(`\n${i + 1}. ${r.fullAddress || r.address || 'NO ADDRESS'}`);
        console.log(`   Beds: ${beds} ${beds >= MIN_BEDS ? '✓' : '✗ (needs 3+)'}`);
        console.log(`   AMV: $${amv} ${amv >= MIN_AMV ? '✓' : '✗ (needs 150k+)'}`);
        console.log(`   LP/AMV: ${(ratio * 100).toFixed(1)}% ${ratio <= 0.5 ? '✓' : '✗ (needs ≤50%)'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAddresses();
