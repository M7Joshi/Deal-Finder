// Quick test script to verify authentication
const BASE_URL = 'https://deal-finder-8tyx.onrender.com';

async function testAuth() {
  console.log('Testing authentication...\n');

  // Test 1: Login
  console.log('Step 1: Attempting login...');
  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mcox@mioym.com', // From your .env MASTER_ADMIN_EMAIL
        password: 'Mioym@2900'    // From your .env MASTER_ADMIN_PASSWORD
      })
    });

    const loginData = await loginRes.json();
    console.log('Login response:', loginData);

    if (!loginData.token) {
      console.error('❌ Login failed - no token received');
      return;
    }

    console.log('✓ Login successful, token received\n');
    const token = loginData.token;

    // Test 2: Fetch deals with token
    console.log('Step 2: Fetching deals with token...');
    const dealsRes = await fetch(`${BASE_URL}/api/properties/table?onlyDeals=true&limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const dealsData = await dealsRes.json();
    console.log('Deals response:', dealsData);

    if (dealsData.ok === false) {
      console.error('❌ Fetching deals failed:', dealsData.error);
    } else {
      const count = Array.isArray(dealsData.rows) ? dealsData.rows.length :
                    Array.isArray(dealsData) ? dealsData.length : 0;
      console.log(`✓ Successfully fetched ${count} deals`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAuth();
