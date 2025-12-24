/**
 * Comprehensive API Test Script for Address Page
 * Tests all endpoints that the address page depends on
 */

const BASE_URL = 'http://localhost:3015';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  log(colors.bright + colors.cyan, title);
  console.log('='.repeat(60) + '\n');
}

async function testEndpoint(name, url, options = {}) {
  const startTime = Date.now();
  try {
    log(colors.blue, `Testing: ${name}`);
    log(colors.yellow, `URL: ${url}`);

    const response = await fetch(url, options);
    const duration = Date.now() - startTime;

    log(colors.yellow, `Status: ${response.status} ${response.statusText}`);
    log(colors.yellow, `Duration: ${duration}ms`);

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
      console.log('Response:', JSON.stringify(data, null, 2).substring(0, 500));

      if (data.rows) {
        log(colors.cyan, `  → Found ${data.rows.length} rows`);
      }
      if (data.addresses) {
        log(colors.cyan, `  → Found ${data.addresses.length} addresses`);
      }
    } else {
      const text = await response.text();
      console.log('Response (first 200 chars):', text.substring(0, 200));
    }

    if (response.ok) {
      log(colors.green, `✓ ${name} PASSED`);
      return { success: true, status: response.status, data, duration };
    } else {
      log(colors.red, `✗ ${name} FAILED - HTTP ${response.status}`);
      return { success: false, status: response.status, data, duration };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    log(colors.red, `✗ ${name} ERROR: ${error.message}`);
    console.error(error);
    return { success: false, error: error.message, duration };
  }
}

async function runTests() {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };

  log(colors.bright, '🔬 COMPREHENSIVE ADDRESS PAGE API TESTS');
  log(colors.yellow, `Base URL: ${BASE_URL}`);
  log(colors.yellow, `Time: ${new Date().toISOString()}\n`);

  // ========================================
  // 1. HEALTH CHECK
  // ========================================
  section('1. HEALTH CHECK');

  let test = await testEndpoint(
    'Server Health Check',
    `${BASE_URL}/api/health`,
    { method: 'GET' }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Health Check', ...test });

  // ========================================
  // 2. AUTHENTICATION
  // ========================================
  section('2. AUTHENTICATION');

  // Test login with master admin credentials
  test = await testEndpoint(
    'Login with Admin Credentials',
    `${BASE_URL}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mcox@mioym.com',
        password: 'Mioym@2900'
      })
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Login', ...test });

  const authToken = test.data?.token;

  if (!authToken) {
    log(colors.red, '⚠️  No auth token received! Subsequent tests may fail.');
  } else {
    log(colors.green, `✓ Auth token received: ${authToken.substring(0, 20)}...`);
  }

  const authHeaders = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  };

  // Test verify endpoint
  test = await testEndpoint(
    'Verify Token',
    `${BASE_URL}/api/auth/verify`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Verify Token', ...test });

  // ========================================
  // 3. PROPERTIES TABLE (DATABASE MODE)
  // ========================================
  section('3. PROPERTIES TABLE - DATABASE MODE');

  // Test without filters
  test = await testEndpoint(
    'Get Properties Table (No Filters)',
    `${BASE_URL}/api/properties/table`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Properties Table - No Filters', ...test });

  // Test with limit
  test = await testEndpoint(
    'Get Properties Table (Limit=10)',
    `${BASE_URL}/api/properties/table?limit=10`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Properties Table - With Limit', ...test });

  // Test with state filter
  test = await testEndpoint(
    'Get Properties Table (States=CA,NY)',
    `${BASE_URL}/api/properties/table?states=CA,NY`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Properties Table - State Filter', ...test });

  // Test with onlyDeals filter
  test = await testEndpoint(
    'Get Properties Table (Only Deals)',
    `${BASE_URL}/api/properties/table?onlyDeals=true`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Properties Table - Only Deals', ...test });

  // ========================================
  // 4. LIVE SCRAPING ENDPOINTS
  // ========================================
  section('4. LIVE SCRAPING ENDPOINTS');

  // Test mock/test endpoint (doesn't require Chrome)
  test = await testEndpoint(
    'Live Scrape Test Endpoint (Mock Data)',
    `${BASE_URL}/api/live-scrape/test?limit=5`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Live Scrape - Test/Mock', ...test });

  // Test real Privy scraping (this will test Chrome initialization)
  log(colors.yellow, '\n⚠️  Testing LIVE Privy scraping (this may take 30-90 seconds)...');
  test = await testEndpoint(
    'Live Scrape from Privy.pro (REAL)',
    `${BASE_URL}/api/live-scrape/privy?limit=5`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Live Scrape - Privy Real', ...test });

  // ========================================
  // 5. DASHBOARD ENDPOINTS
  // ========================================
  section('5. DASHBOARD ENDPOINTS');

  test = await testEndpoint(
    'Get Dashboard Summary',
    `${BASE_URL}/api/dashboard/summary`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );
  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Dashboard Summary', ...test });

  // ========================================
  // 6. DATABASE CONNECTION TEST
  // ========================================
  section('6. DATABASE CONNECTION TEST');

  test = await testEndpoint(
    'MongoDB Connection (via properties count)',
    `${BASE_URL}/api/properties/table?limit=1`,
    {
      method: 'GET',
      headers: authHeaders
    }
  );

  if (test.success && test.data?.rows?.length === 0) {
    log(colors.yellow, '⚠️  WARNING: Database is empty or no properties match your user scope!');
    log(colors.yellow, '   This is likely why the address page shows no data.');
  } else if (test.success && test.data?.rows?.length > 0) {
    log(colors.green, `✓ Database has ${test.data.rows.length} properties accessible to this user`);
  }

  results.total++;
  test.success ? results.passed++ : results.failed++;
  results.tests.push({ name: 'Database Connection', ...test });

  // ========================================
  // FINAL SUMMARY
  // ========================================
  section('TEST SUMMARY');

  console.log(`Total Tests: ${results.total}`);
  log(colors.green, `Passed: ${results.passed}`);
  log(colors.red, `Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(2)}%\n`);

  // Detailed failure report
  const failures = results.tests.filter(t => !t.success);
  if (failures.length > 0) {
    section('FAILED TESTS DETAILS');
    failures.forEach((test, idx) => {
      log(colors.red, `${idx + 1}. ${test.name}`);
      if (test.error) {
        console.log(`   Error: ${test.error}`);
      }
      if (test.status) {
        console.log(`   HTTP Status: ${test.status}`);
      }
      if (test.data) {
        console.log(`   Response: ${JSON.stringify(test.data).substring(0, 200)}`);
      }
    });
  }

  // Diagnosis
  section('DIAGNOSIS & RECOMMENDATIONS');

  const healthFailed = !results.tests.find(t => t.name === 'Health Check')?.success;
  const loginFailed = !results.tests.find(t => t.name === 'Login')?.success;
  const propertiesFailed = !results.tests.find(t => t.name === 'Properties Table - No Filters')?.success;
  const dbEmpty = results.tests.find(t => t.name === 'Database Connection')?.data?.rows?.length === 0;
  const liveScrapeFailed = !results.tests.find(t => t.name === 'Live Scrape - Privy Real')?.success;

  if (healthFailed) {
    log(colors.red, '❌ CRITICAL: Backend server is not responding!');
    console.log('   → Make sure backend is running: cd backend && node server.js');
    console.log('   → Check if port 3015 is in use by another process');
  }

  if (loginFailed) {
    log(colors.red, '❌ CRITICAL: Authentication is failing!');
    console.log('   → Check if MongoDB is connected');
    console.log('   → Verify admin credentials in backend/.env');
    console.log('   → Check JWT_SECRET is set correctly');
  }

  if (propertiesFailed && !loginFailed) {
    log(colors.red, '❌ CRITICAL: Properties endpoint is failing!');
    console.log('   → Check MongoDB connection string in backend/.env');
    console.log('   → Verify database permissions');
    console.log('   → Check backend logs for errors');
  }

  if (dbEmpty && !propertiesFailed) {
    log(colors.yellow, '⚠️  WARNING: Database is empty or user has no access!');
    console.log('   → Run scrapers to populate database');
    console.log('   → Check user state scope (subadmins only see their states)');
    console.log('   → Verify MongoDB has data: use deal_finder; db.properties.count()');
  }

  if (liveScrapeFailed) {
    log(colors.yellow, '⚠️  Live scraping is failing!');
    console.log('   → This is the "Timeout waiting for shared Chrome" issue');
    console.log('   → My fix should help, but Chrome may need more time to launch');
    console.log('   → Try setting CHROME_LAUNCH_TIMEOUT_MS=120000 in backend/.env');
  }

  // Root cause identification
  log(colors.bright + colors.cyan, '\n🔍 MOST LIKELY ROOT CAUSE:');
  if (healthFailed) {
    log(colors.red, '   Backend server is not running or not accessible on port 3015');
  } else if (loginFailed) {
    log(colors.red, '   MongoDB connection or authentication issue');
  } else if (dbEmpty) {
    log(colors.yellow, '   Database is empty - need to run scrapers to populate data');
  } else if (propertiesFailed) {
    log(colors.red, '   Backend API or database query error');
  } else {
    log(colors.green, '   All core APIs are working! Address page should display data.');
  }

  console.log('\n');
  return results;
}

// Run the tests
runTests().catch(console.error);
