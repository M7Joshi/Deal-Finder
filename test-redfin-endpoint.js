// Test Redfin live scraping endpoint
const BASE_URL = 'http://localhost:53118';

async function testRedfinEndpoint() {
  console.log('Testing Redfin live scraping endpoint...\n');

  // First, login to get auth token
  console.log('1. Logging in...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'mcox@mioym.com',
      password: 'Mioym@2900'
    })
  });

  const loginData = await loginRes.json();
  console.log('Login response:', loginData.ok ? '✓ Success' : '✗ Failed');

  if (!loginData.token) {
    console.error('No token received!');
    return;
  }

  const token = loginData.token;
  console.log('Token received:', token.substring(0, 20) + '...\n');

  // Test Redfin endpoint with CA state
  console.log('2. Testing Redfin endpoint for CA...');
  const redfinRes = await fetch(`${BASE_URL}/api/live-scrape/redfin?state=CA&limit=5`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const responseText = await redfinRes.text();
  let redfinData;
  try {
    redfinData = JSON.parse(responseText);
  } catch (err) {
    console.error('Failed to parse JSON. Response:', responseText.substring(0, 500));
    throw err;
  }
  console.log('Status:', redfinRes.status);
  console.log('Response:', JSON.stringify(redfinData, null, 2));

  if (redfinData.ok && redfinData.addresses) {
    console.log(`\n✓ Success! Got ${redfinData.addresses.length} addresses`);
    console.log('\nFirst address:', redfinData.addresses[0]?.fullAddress);
  } else {
    console.error('\n✗ Failed!');
    console.error('Error:', redfinData.error || redfinData.message);
  }
}

testRedfinEndpoint().catch(console.error);
