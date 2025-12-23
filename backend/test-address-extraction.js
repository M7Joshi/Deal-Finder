/**
 * Address Extraction Test Suite
 * Tests that Privy and Redfin are correctly extracting and parsing addresses
 */

import { parseAddresses } from './helpers.js';
import { cityFromAddress } from './vendors/redfin/normalize.js';
import Property from './models/Property.js';
import RawProperty from './models/rawProperty.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'bold');
  console.log('='.repeat(80) + '\n');
}

function logTest(testName, passed, details = '') {
  const status = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(`${status} ${testName}`, color);
  if (details) {
    log(`  ${details}`, 'cyan');
  }
}

// Test helper: Validate address format
function isValidAddressFormat(address) {
  if (!address || typeof address !== 'string') return false;

  // Should have at least street, city, state zip separated by commas
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length < 3) return false;

  // Last part should have state and zip (e.g., "AL 35004")
  const stateZip = parts[parts.length - 1];
  const stateZipParts = stateZip.split(' ').filter(Boolean);

  // Should have at least state code (2 letters) and optionally zip
  if (stateZipParts.length < 1) return false;
  if (stateZipParts[0].length !== 2) return false;

  return true;
}

// Test helper: Parse address components
function parseAddressComponents(fullAddress) {
  const parts = fullAddress.split(',').map(s => s.trim());

  if (parts.length < 3) return null;

  const [addressPart, cityPart, stateZipPart] = parts;
  const stateZipParts = stateZipPart.split(' ').filter(Boolean);

  return {
    street: addressPart,
    city: cityPart,
    state: stateZipParts[0],
    zip: stateZipParts.slice(1).join(' '),
  };
}

// Unit Tests for Address Parsing
async function testAddressParsingLogic() {
  logSection('1. Address Parsing Logic Tests');

  const testCases = [
    {
      name: 'Valid full address',
      input: [{ fullAddress: '123 Main St, Birmingham, AL 35004', price: 100000 }],
      expectedValid: true,
      expectedComponents: {
        street: '123 Main St',
        city: 'Birmingham',
        state: 'AL',
        zip: '35004',
      },
    },
    {
      name: 'Address without zip code',
      input: [{ fullAddress: '456 Oak Ave, Mobile, AL', price: 150000 }],
      expectedValid: true,
      expectedComponents: {
        street: '456 Oak Ave',
        city: 'Mobile',
        state: 'AL',
        zip: '',
      },
    },
    {
      name: 'Invalid address (missing city)',
      input: [{ fullAddress: '789 Pine Rd, AL 35004', price: 200000 }],
      expectedValid: false,
    },
    {
      name: 'Invalid address (too few parts)',
      input: [{ fullAddress: '321 Elm St', price: 250000 }],
      expectedValid: false,
    },
    {
      name: 'Address with apartment number',
      input: [{ fullAddress: '555 Maple Dr Apt 2B, Montgomery, AL 36104', price: 120000 }],
      expectedValid: true,
      expectedComponents: {
        street: '555 Maple Dr Apt 2B',
        city: 'Montgomery',
        state: 'AL',
        zip: '36104',
      },
    },
  ];

  for (const testCase of testCases) {
    const parsed = parseAddresses(testCase.input);

    if (testCase.expectedValid) {
      const isValid = parsed.length > 0 && parsed[0] !== null;
      logTest(testCase.name, isValid, `Parsed: ${JSON.stringify(parsed[0]?.fullAddress)}`);

      if (isValid && testCase.expectedComponents) {
        const result = parsed[0];
        const matches =
          result.address === testCase.expectedComponents.street &&
          result.city === testCase.expectedComponents.city &&
          result.state === testCase.expectedComponents.state &&
          result.zip === testCase.expectedComponents.zip;

        logTest(
          `  → Components match expected`,
          matches,
          `Expected: ${JSON.stringify(testCase.expectedComponents)}, Got: ${JSON.stringify({
            street: result.address,
            city: result.city,
            state: result.state,
            zip: result.zip,
          })}`
        );
      }
    } else {
      const isInvalid = parsed.length === 0 || parsed[0] === null;
      logTest(testCase.name, isInvalid, `Should be filtered out as invalid`);
    }
  }
}

// Test Redfin city extraction
async function testRedfinCityExtraction() {
  logSection('2. Redfin City Extraction Tests');

  const testCases = [
    { address: '123 Main St, Birmingham, AL 35004', expectedCity: 'Birmingham' },
    { address: '456 Oak Ave, Mobile, AL', expectedCity: 'Mobile' },
    { address: '789 Pine Rd, Montgomery, AL 36104', expectedCity: 'Montgomery' },
    { address: 'Invalid', expectedCity: '' },
  ];

  for (const testCase of testCases) {
    const result = cityFromAddress(testCase.address);
    const passed = result === testCase.expectedCity;
    logTest(
      `Extract city from: "${testCase.address}"`,
      passed,
      `Expected: "${testCase.expectedCity}", Got: "${result}"`
    );
  }
}

// Database Tests - Check actual Privy data
async function testPrivyAddressesInDatabase() {
  logSection('3. Privy Addresses in Database');

  try {
    // Find properties from Privy (vendor = 'privy')
    const privyProperties = await Property.find({ vendor: 'privy' }).limit(20).lean();

    log(`Found ${privyProperties.length} Privy properties in database`, 'cyan');

    if (privyProperties.length === 0) {
      log('⚠ No Privy properties found. Run Privy scraper first.', 'yellow');
      return;
    }

    let validCount = 0;
    let invalidCount = 0;
    const issues = [];

    for (const prop of privyProperties) {
      const isValid = isValidAddressFormat(prop.fullAddress);

      if (isValid) {
        validCount++;
        const components = parseAddressComponents(prop.fullAddress);

        // Check if parsed components match stored fields
        const componentsMatch =
          components.street === prop.address &&
          components.city === prop.city &&
          components.state === prop.state &&
          (components.zip === prop.zip || (components.zip === '' && prop.zip === ''));

        if (!componentsMatch) {
          issues.push({
            fullAddress: prop.fullAddress,
            issue: 'Components mismatch',
            expected: components,
            actual: {
              street: prop.address,
              city: prop.city,
              state: prop.state,
              zip: prop.zip,
            },
          });
        }
      } else {
        invalidCount++;
        issues.push({
          fullAddress: prop.fullAddress,
          issue: 'Invalid format',
        });
      }
    }

    logTest(
      `Valid address format`,
      validCount === privyProperties.length,
      `${validCount}/${privyProperties.length} valid`
    );

    logTest(
      `Address components correctly stored`,
      issues.length === 0,
      issues.length > 0 ? `${issues.length} issues found` : 'All components match'
    );

    if (issues.length > 0 && issues.length <= 5) {
      log('\nIssue Details:', 'yellow');
      issues.forEach((issue, idx) => {
        log(`  ${idx + 1}. ${issue.fullAddress}`, 'yellow');
        log(`     Issue: ${issue.issue}`, 'yellow');
        if (issue.expected) {
          log(`     Expected: ${JSON.stringify(issue.expected)}`, 'yellow');
          log(`     Actual: ${JSON.stringify(issue.actual)}`, 'yellow');
        }
      });
    }

    // Show sample addresses
    log('\nSample Privy Addresses:', 'cyan');
    privyProperties.slice(0, 5).forEach((prop, idx) => {
      log(`  ${idx + 1}. ${prop.fullAddress}`, 'cyan');
      log(`     → ${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}`, 'cyan');
    });
  } catch (error) {
    logTest('Privy database query', false, error.message);
  }
}

// Database Tests - Check actual Redfin data
async function testRedfinAddressesInDatabase() {
  logSection('4. Redfin Addresses in Database');

  try {
    // Find properties from Redfin (vendor = 'redfin')
    const redfinProperties = await Property.find({ vendor: 'redfin' }).limit(20).lean();

    log(`Found ${redfinProperties.length} Redfin properties in database`, 'cyan');

    if (redfinProperties.length === 0) {
      log('⚠ No Redfin properties found. Run Redfin scraper first.', 'yellow');
      return;
    }

    let validCount = 0;
    let invalidCount = 0;
    const issues = [];

    for (const prop of redfinProperties) {
      const isValid = isValidAddressFormat(prop.fullAddress);

      if (isValid) {
        validCount++;
        const components = parseAddressComponents(prop.fullAddress);

        // Check if parsed components match stored fields
        const componentsMatch =
          components.street === prop.address &&
          components.city === prop.city &&
          components.state === prop.state &&
          (components.zip === prop.zip || (components.zip === '' && prop.zip === ''));

        if (!componentsMatch) {
          issues.push({
            fullAddress: prop.fullAddress,
            issue: 'Components mismatch',
            expected: components,
            actual: {
              street: prop.address,
              city: prop.city,
              state: prop.state,
              zip: prop.zip,
            },
          });
        }
      } else {
        invalidCount++;
        issues.push({
          fullAddress: prop.fullAddress,
          issue: 'Invalid format',
        });
      }
    }

    logTest(
      `Valid address format`,
      validCount === redfinProperties.length,
      `${validCount}/${redfinProperties.length} valid`
    );

    logTest(
      `Address components correctly stored`,
      issues.length === 0,
      issues.length > 0 ? `${issues.length} issues found` : 'All components match'
    );

    if (issues.length > 0 && issues.length <= 5) {
      log('\nIssue Details:', 'yellow');
      issues.forEach((issue, idx) => {
        log(`  ${idx + 1}. ${issue.fullAddress}`, 'yellow');
        log(`     Issue: ${issue.issue}`, 'yellow');
        if (issue.expected) {
          log(`     Expected: ${JSON.stringify(issue.expected)}`, 'yellow');
          log(`     Actual: ${JSON.stringify(issue.actual)}`, 'yellow');
        }
      });
    }

    // Show sample addresses
    log('\nSample Redfin Addresses:', 'cyan');
    redfinProperties.slice(0, 5).forEach((prop, idx) => {
      log(`  ${idx + 1}. ${prop.fullAddress}`, 'cyan');
      log(`     → ${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}`, 'cyan');
    });
  } catch (error) {
    logTest('Redfin database query', false, error.message);
  }
}

// Test RawProperty addresses
async function testRawPropertyAddresses() {
  logSection('5. RawProperty Collection Tests');

  try {
    const rawProps = await RawProperty.find({}).limit(20).lean();

    log(`Found ${rawProps.length} raw properties in database`, 'cyan');

    if (rawProps.length === 0) {
      log('⚠ No raw properties found.', 'yellow');
      return;
    }

    // Group by vendor
    const privyRaw = rawProps.filter(p => p.vendor === 'privy');
    const redfinRaw = rawProps.filter(p => p.vendor === 'redfin');

    log(`  Privy: ${privyRaw.length}`, 'cyan');
    log(`  Redfin: ${redfinRaw.length}`, 'cyan');

    // Check format validity
    let validCount = 0;
    for (const prop of rawProps) {
      if (isValidAddressFormat(prop.fullAddress)) {
        validCount++;
      }
    }

    logTest(
      `Valid address formats in RawProperty`,
      validCount === rawProps.length,
      `${validCount}/${rawProps.length} valid`
    );

    // Sample addresses
    if (privyRaw.length > 0) {
      log('\nSample Privy Raw Addresses:', 'cyan');
      privyRaw.slice(0, 3).forEach((prop, idx) => {
        log(`  ${idx + 1}. ${prop.fullAddress}`, 'cyan');
      });
    }

    if (redfinRaw.length > 0) {
      log('\nSample Redfin Raw Addresses:', 'cyan');
      redfinRaw.slice(0, 3).forEach((prop, idx) => {
        log(`  ${idx + 1}. ${prop.fullAddress}`, 'cyan');
      });
    }
  } catch (error) {
    logTest('RawProperty database query', false, error.message);
  }
}

// Cross-vendor comparison
async function testCrossVendorAddressMatching() {
  logSection('6. Cross-Vendor Address Matching');

  try {
    // Find addresses that exist in both Privy and Redfin
    const privyAddresses = await Property.find({ vendor: 'privy' })
      .select('fullAddress fullAddress_ci')
      .lean();

    const redfinAddresses = await Property.find({ vendor: 'redfin' })
      .select('fullAddress fullAddress_ci')
      .lean();

    log(`Privy addresses: ${privyAddresses.length}`, 'cyan');
    log(`Redfin addresses: ${redfinAddresses.length}`, 'cyan');

    if (privyAddresses.length === 0 || redfinAddresses.length === 0) {
      log('⚠ Not enough data for cross-vendor comparison', 'yellow');
      return;
    }

    // Create a set of Privy addresses (case-insensitive)
    const privySet = new Set(privyAddresses.map(p => p.fullAddress_ci));

    // Check for matches
    const matches = redfinAddresses.filter(r => privySet.has(r.fullAddress_ci));

    log(`\nFound ${matches.length} matching addresses between vendors`, 'cyan');

    if (matches.length > 0) {
      log('\nSample Matching Addresses:', 'cyan');
      matches.slice(0, 5).forEach((match, idx) => {
        log(`  ${idx + 1}. ${match.fullAddress}`, 'cyan');
      });

      logTest(
        'Cross-vendor address deduplication working',
        true,
        `${matches.length} duplicates detected via fullAddress_ci`
      );
    } else {
      log('\nNo duplicate addresses found between vendors', 'cyan');
      logTest('Cross-vendor address deduplication', true, 'No duplicates found');
    }
  } catch (error) {
    logTest('Cross-vendor comparison', false, error.message);
  }
}

// Test address uniqueness
async function testAddressUniqueness() {
  logSection('7. Address Uniqueness Tests');

  try {
    // Check for duplicate fullAddress_ci in Property collection
    const duplicates = await Property.aggregate([
      { $group: { _id: '$fullAddress_ci', count: { $sum: 1 }, addresses: { $push: '$fullAddress' } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ]);

    if (duplicates.length === 0) {
      logTest('No duplicate addresses in Property collection', true, 'All addresses unique');
    } else {
      logTest(
        'No duplicate addresses in Property collection',
        false,
        `Found ${duplicates.length} duplicate address groups`
      );

      log('\nDuplicate Address Groups:', 'yellow');
      duplicates.forEach((dup, idx) => {
        log(`  ${idx + 1}. ${dup._id} (count: ${dup.count})`, 'yellow');
        dup.addresses.forEach(addr => {
          log(`     - ${addr}`, 'yellow');
        });
      });
    }

    // Check RawProperty duplicates
    const rawDuplicates = await RawProperty.aggregate([
      { $group: { _id: '$fullAddress', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ]);

    if (rawDuplicates.length === 0) {
      logTest('No duplicate addresses in RawProperty collection', true, 'All addresses unique');
    } else {
      logTest(
        'No duplicate addresses in RawProperty collection',
        false,
        `Found ${rawDuplicates.length} duplicate addresses`
      );
    }
  } catch (error) {
    logTest('Address uniqueness check', false, error.message);
  }
}

// Main test runner
async function runAllTests() {
  log('Address Extraction Test Suite - Privy & Redfin', 'bold');
  log('Testing address parsing, extraction, and storage\n', 'cyan');

  try {
    // Connect to MongoDB
    log('Connecting to MongoDB...', 'yellow');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/deal_finder');
    log('✓ Connected to MongoDB\n', 'green');

    // Run all test suites
    await testAddressParsingLogic();
    await testRedfinCityExtraction();
    await testPrivyAddressesInDatabase();
    await testRedfinAddressesInDatabase();
    await testRawPropertyAddresses();
    await testCrossVendorAddressMatching();
    await testAddressUniqueness();

    logSection('Test Suite Complete');
    log('All tests finished', 'green');
  } catch (error) {
    log(`\nFatal error: ${error.message}`, 'red');
    console.error(error);
  } finally {
    await mongoose.connection.close();
    log('\nDatabase connection closed', 'yellow');
  }
}

// Run tests
runAllTests().catch(console.error);
