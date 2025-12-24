/**
 * Comprehensive API Test Suite for Redfin-Addresses.html Page
 *
 * This script tests all the APIs that are connected to the Redfin page:
 * 1. Authentication API (POST /api/auth/login)
 * 2. Redfin Live Scrape API (GET /api/live-scrape/redfin)
 * 3. Test endpoint (GET /api/live-scrape/test)
 */

const API_BASE = 'http://localhost:3015';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Utility functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log(`  ${title}`, colors.bright + colors.cyan);
  console.log('='.repeat(80) + '\n');
}

function success(message) {
  log(`✓ ${message}`, colors.green);
}

function error(message) {
  log(`✗ ${message}`, colors.red);
}

function info(message) {
  log(`ℹ ${message}`, colors.blue);
}

function warning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

// Test results tracking
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  details: []
};

function recordTest(name, passed, message = '', details = null) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    success(`${name}: ${message || 'PASSED'}`);
  } else {
    testResults.failed++;
    error(`${name}: ${message || 'FAILED'}`);
  }

  testResults.details.push({
    name,
    passed,
    message,
    details,
    timestamp: new Date().toISOString()
  });
}

// Global token storage
let authToken = null;

/**
 * Test 1: Authentication API
 */
async function testAuthentication() {
  section('TEST 1: Authentication API (POST /api/auth/login)');

  try {
    info('Testing login with credentials from Redfin page...');

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'mcox@mioym.com',
        password: 'Mioym@2900'
      })
    });

    const data = await response.json();

    // Test 1a: Response status
    recordTest(
      'Auth - Status Code',
      response.status === 200,
      `Expected 200, got ${response.status}`
    );

    // Test 1b: Token present
    const hasToken = data.token && data.token.length > 0;
    recordTest(
      'Auth - Token Generated',
      hasToken,
      hasToken ? `Token length: ${data.token.length} chars` : 'No token received'
    );

    // Test 1c: User data present
    const hasUser = data.user && data.user.email;
    recordTest(
      'Auth - User Data',
      hasUser,
      hasUser ? `User: ${data.user.email}` : 'No user data'
    );

    if (hasToken) {
      authToken = data.token;
      success(`Authentication successful! Token stored.`);
      info(`User: ${data.user?.email || 'Unknown'}`);
      info(`Role: ${data.user?.role || 'Unknown'}`);
    } else {
      error('Authentication failed - no token received');
    }

    return hasToken;
  } catch (err) {
    error(`Authentication test failed: ${err.message}`);
    recordTest('Auth - Connection', false, err.message);
    return false;
  }
}

/**
 * Test 2: Test Endpoint (GET /api/live-scrape/test)
 */
async function testTestEndpoint() {
  section('TEST 2: Test Endpoint (GET /api/live-scrape/test)');

  if (!authToken) {
    warning('Skipping test endpoint - no auth token');
    return false;
  }

  try {
    info('Testing mock data endpoint...');

    const response = await fetch(
      `${API_BASE}/api/live-scrape/test?limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    // Test 2a: Status code
    recordTest(
      'Test Endpoint - Status',
      response.status === 200,
      `Status: ${response.status}`
    );

    // Test 2b: Response structure
    const hasCorrectStructure = data.ok && data.addresses && Array.isArray(data.addresses);
    recordTest(
      'Test Endpoint - Structure',
      hasCorrectStructure,
      hasCorrectStructure ? 'Valid response structure' : 'Invalid structure'
    );

    // Test 2c: Address count
    const expectedCount = 10;
    const actualCount = data.addresses?.length || 0;
    recordTest(
      'Test Endpoint - Address Count',
      actualCount === expectedCount,
      `Expected ${expectedCount}, got ${actualCount}`
    );

    // Test 2d: Address format
    if (data.addresses && data.addresses.length > 0) {
      const firstAddr = data.addresses[0];
      const hasRequiredFields = firstAddr.fullAddress && firstAddr.vendor && firstAddr.extractedAt;
      recordTest(
        'Test Endpoint - Address Format',
        hasRequiredFields,
        hasRequiredFields ? 'All required fields present' : 'Missing required fields'
      );

      if (hasRequiredFields) {
        info(`Sample address: ${firstAddr.fullAddress}`);
      }
    }

    success(`Test endpoint returned ${actualCount} addresses`);
    return true;

  } catch (err) {
    error(`Test endpoint failed: ${err.message}`);
    recordTest('Test Endpoint - Connection', false, err.message);
    return false;
  }
}

/**
 * Test 3: Redfin Live Scrape API (Multiple scenarios)
 */
async function testRedfinLiveScrape() {
  section('TEST 3: Redfin Live Scrape API (GET /api/live-scrape/redfin)');

  if (!authToken) {
    warning('Skipping Redfin tests - no auth token');
    return false;
  }

  // Test 3a: Missing state parameter
  try {
    info('Test 3a: Testing without state parameter...');
    const response = await fetch(
      `${API_BASE}/api/live-scrape/redfin`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    recordTest(
      'Redfin - Missing State Validation',
      response.status === 400 && data.error,
      `Correctly returns 400 error for missing state`
    );
  } catch (err) {
    recordTest('Redfin - Missing State Validation', false, err.message);
  }

  // Test 3b: Invalid state code
  try {
    info('Test 3b: Testing with invalid state code...');
    const response = await fetch(
      `${API_BASE}/api/live-scrape/redfin?state=XX&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    recordTest(
      'Redfin - Invalid State Validation',
      response.status === 400 && data.error,
      `Correctly returns 400 error for invalid state`
    );
  } catch (err) {
    recordTest('Redfin - Invalid State Validation', false, err.message);
  }

  // Test 3c: Valid Redfin scrape request (NC - as shown in the HTML page)
  try {
    info('Test 3c: Testing valid Redfin scrape (Charlotte, NC)...');
    info('This may take 10-30 seconds...');

    const response = await fetch(
      `${API_BASE}/api/live-scrape/redfin?city=Charlotte&state=NC&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    // Check if response is successful
    recordTest(
      'Redfin - NC Scrape Status',
      response.status === 200,
      `Status: ${response.status}`
    );

    // Check response structure
    const hasCorrectStructure = data.ok !== undefined && 'addresses' in data;
    recordTest(
      'Redfin - Response Structure',
      hasCorrectStructure,
      hasCorrectStructure ? 'Valid structure' : 'Invalid structure'
    );

    // Check if addresses returned (or mock data)
    if (data.addresses) {
      const addressCount = data.addresses.length;
      recordTest(
        'Redfin - Addresses Returned',
        addressCount > 0,
        `${addressCount} addresses returned`
      );

      if (addressCount > 0) {
        const firstAddr = data.addresses[0];
        info(`Sample address: ${firstAddr.fullAddress || 'N/A'}`);
        info(`Price: ${firstAddr.price || 'N/A'}`);
        info(`Details: ${firstAddr.beds || 'N/A'}, ${firstAddr.baths || 'N/A'}, ${firstAddr.sqft || 'N/A'}`);

        // Check if it's mock data
        if (data.source && data.source.includes('mock')) {
          warning('API returned mock data (proxy may not be configured)');
        } else if (data.warning) {
          warning(`Warning: ${data.warning}`);
        }
      }
    }

    success(`Redfin API responded successfully`);
    return true;

  } catch (err) {
    error(`Redfin scrape failed: ${err.message}`);
    recordTest('Redfin - NC Scrape', false, err.message);
    return false;
  }
}

/**
 * Test 4: Authorization Tests
 */
async function testAuthorization() {
  section('TEST 4: Authorization Tests');

  // Test 4a: Request without token
  try {
    info('Test 4a: Testing request without authorization token...');
    const response = await fetch(`${API_BASE}/api/live-scrape/test`);
    const data = await response.json();

    recordTest(
      'Authorization - No Token',
      response.status === 401 || response.status === 403,
      `Returns ${response.status} (should be 401 or 403)`
    );
  } catch (err) {
    recordTest('Authorization - No Token', false, err.message);
  }

  // Test 4b: Request with invalid token
  try {
    info('Test 4b: Testing request with invalid token...');
    const response = await fetch(
      `${API_BASE}/api/live-scrape/test`,
      {
        headers: {
          'Authorization': 'Bearer invalid-token-12345'
        }
      }
    );

    recordTest(
      'Authorization - Invalid Token',
      response.status === 401 || response.status === 403,
      `Returns ${response.status} (should be 401 or 403)`
    );
  } catch (err) {
    recordTest('Authorization - Invalid Token', false, err.message);
  }
}

/**
 * Test 5: Performance Tests
 */
async function testPerformance() {
  section('TEST 5: Performance Tests');

  if (!authToken) {
    warning('Skipping performance tests - no auth token');
    return;
  }

  try {
    info('Testing API response time (test endpoint)...');
    const startTime = Date.now();

    const response = await fetch(
      `${API_BASE}/api/live-scrape/test?limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await response.json();
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    recordTest(
      'Performance - Response Time',
      responseTime < 5000,
      `Response time: ${responseTime}ms (should be < 5000ms)`
    );

    if (responseTime < 1000) {
      success(`Excellent response time: ${responseTime}ms`);
    } else if (responseTime < 3000) {
      info(`Good response time: ${responseTime}ms`);
    } else {
      warning(`Slow response time: ${responseTime}ms`);
    }

  } catch (err) {
    recordTest('Performance - Response Time', false, err.message);
  }
}

/**
 * Generate final test report
 */
function generateReport() {
  section('TEST SUMMARY REPORT');

  console.log(`Total Tests:   ${testResults.total}`);
  log(`Passed:        ${testResults.passed}`, colors.green);
  log(`Failed:        ${testResults.failed}`, testResults.failed > 0 ? colors.red : colors.green);

  const passRate = testResults.total > 0
    ? ((testResults.passed / testResults.total) * 100).toFixed(1)
    : 0;

  console.log(`\nPass Rate:     ${passRate}%`);

  if (testResults.failed > 0) {
    console.log('\n' + '-'.repeat(80));
    log('Failed Tests:', colors.red);
    testResults.details
      .filter(t => !t.passed)
      .forEach(test => {
        error(`  - ${test.name}: ${test.message}`);
      });
  }

  console.log('\n' + '='.repeat(80));

  if (testResults.failed === 0) {
    success('All tests passed! 🎉');
  } else {
    warning(`${testResults.failed} test(s) failed. Please review above.`);
  }

  console.log('='.repeat(80) + '\n');

  // Save detailed report to file
  const fs = require('fs');
  const reportData = {
    timestamp: new Date().toISOString(),
    summary: {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed,
      passRate: `${passRate}%`
    },
    tests: testResults.details
  };

  fs.writeFileSync(
    'test-results-redfin-apis.json',
    JSON.stringify(reportData, null, 2)
  );

  info('Detailed report saved to: test-results-redfin-apis.json');
}

/**
 * Main test runner
 */
async function runAllTests() {
  log('\n╔════════════════════════════════════════════════════════════════════════════╗', colors.bright + colors.cyan);
  log('║          Redfin Page - Comprehensive API Test Suite                       ║', colors.bright + colors.cyan);
  log('╚════════════════════════════════════════════════════════════════════════════╝\n', colors.bright + colors.cyan);

  info(`API Base URL: ${API_BASE}`);
  info(`Test Started: ${new Date().toISOString()}\n`);

  // Run all tests in sequence
  const authSuccess = await testAuthentication();

  if (authSuccess) {
    await testTestEndpoint();
    await testRedfinLiveScrape();
    await testAuthorization();
    await testPerformance();
  } else {
    error('Authentication failed - skipping remaining tests');
  }

  // Generate final report
  generateReport();
}

// Run tests
runAllTests().catch(err => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
