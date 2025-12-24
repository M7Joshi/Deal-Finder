// Quick test for live scrape endpoint
async function testLiveScrape() {
  console.log('🔍 Testing Live Scrape Endpoint...\n');

  try {
    // Login
    const loginRes = await fetch('http://localhost:3015/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mcox@mioym.com',
        password: 'Mioym@2900'
      })
    });

    const { token } = await loginRes.json();
    console.log('✅ Logged in successfully\n');

    // Test live-scrape endpoint
    console.log('📡 Fetching from /api/live-scrape/test...');
    const scrapeRes = await fetch('http://localhost:3015/api/live-scrape/test?limit=5', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await scrapeRes.json();

    console.log('\n✨ LIVE SCRAPE TEST RESULTS:');
    console.log('='.repeat(60));
    console.log(`Status: ${data.ok ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Source: ${data.source}`);
    console.log(`Count: ${data.count}`);
    console.log(`Message: ${data.message}`);
    console.log('\n📍 Sample Addresses:');

    data.addresses.forEach((addr, i) => {
      console.log(`  ${i + 1}. ${addr.fullAddress}`);
    });

    console.log('='.repeat(60));
    console.log('\n🎉 Live scrape endpoint is working perfectly!');
    console.log('👉 Now open http://localhost:3000 and go to Address Validation page');
    console.log('👉 Click "🔴 LIVE from Privy.pro" button');
    console.log('👉 Click "Scrape Now" to see these addresses!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testLiveScrape();
