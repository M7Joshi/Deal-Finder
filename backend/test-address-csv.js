/**
 * Address Extraction Test Suite - CSV Version
 * Tests that Privy and Redfin are correctly extracting and parsing addresses
 * Works with CSV data files (no database required)
 */

import { parseAddresses } from './helpers.js';
import { cityFromAddress } from './vendors/redfin/normalize.js';
import fs from 'fs';
import path from 'path';

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

// Parse CSV file
function parseCSV(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) return [];

    // First line is header
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const record = {};
        headers.forEach((header, idx) => {
          record[header] = values[idx];
        });
        records.push(record);
      }
    }

    return records;
  } catch (error) {
    log(`Error reading CSV file: ${error.message}`, 'red');
    return [];
  }
}

// Parse CSV line with proper comma handling (respects quotes)
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim().replace(/^"|"$/g, ''));
  return values;
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

// Test addresses from CSV data
async function testAddressesFromCSV(csvFile, vendor) {
  logSection(`${vendor.toUpperCase()} Addresses from CSV Data`);

  if (!fs.existsSync(csvFile)) {
    log(`⚠ CSV file not found: ${csvFile}`, 'yellow');
    log(`  Please run the ${vendor} scraper to generate data first`, 'yellow');
    return;
  }

  const records = parseCSV(csvFile);

  if (records.length === 0) {
    log(`⚠ No data found in CSV file`, 'yellow');
    return;
  }

  log(`Found ${records.length} records in ${vendor} CSV`, 'cyan');

  let validCount = 0;
  let invalidCount = 0;
  const issues = [];

  // Check first 50 records
  const samplesToCheck = Math.min(50, records.length);

  for (let i = 0; i < samplesToCheck; i++) {
    const record = records[i];
    const fullAddress = record.fullAddress || record.address;

    if (!fullAddress) {
      issues.push({ index: i, issue: 'Missing fullAddress field' });
      invalidCount++;
      continue;
    }

    const isValid = isValidAddressFormat(fullAddress);

    if (isValid) {
      validCount++;
      const components = parseAddressComponents(fullAddress);

      // Check if parsed components match stored fields (if available)
      if (record.address || record.city || record.state) {
        const componentsMatch =
          (!record.address || components.street === record.address) &&
          (!record.city || components.city === record.city) &&
          (!record.state || components.state === record.state);

        if (!componentsMatch) {
          issues.push({
            index: i,
            fullAddress: fullAddress,
            issue: 'Components mismatch',
            expected: components,
            actual: {
              street: record.address,
              city: record.city,
              state: record.state,
              zip: record.zip,
            },
          });
        }
      }
    } else {
      invalidCount++;
      issues.push({
        index: i,
        fullAddress: fullAddress,
        issue: 'Invalid format',
      });
    }
  }

  logTest(
    `Valid address format (checked ${samplesToCheck} records)`,
    validCount === samplesToCheck,
    `${validCount}/${samplesToCheck} valid, ${invalidCount} invalid`
  );

  if (invalidCount > 0) {
    logTest(
      `All addresses follow correct format`,
      false,
      `Found ${invalidCount} invalid addresses`
    );
  } else {
    logTest(
      `All addresses follow correct format`,
      true,
      `All ${samplesToCheck} addresses are valid`
    );
  }

  if (issues.length > 0) {
    log(`\n⚠ Found ${issues.length} issues in ${vendor} data:`, 'yellow');
    issues.slice(0, 5).forEach((issue, idx) => {
      log(`  ${idx + 1}. Record #${issue.index}: ${issue.issue}`, 'yellow');
      if (issue.fullAddress) {
        log(`     Address: ${issue.fullAddress}`, 'yellow');
      }
      if (issue.expected) {
        log(`     Expected: ${JSON.stringify(issue.expected)}`, 'yellow');
        log(`     Actual: ${JSON.stringify(issue.actual)}`, 'yellow');
      }
    });
    if (issues.length > 5) {
      log(`     ... and ${issues.length - 5} more issues`, 'yellow');
    }
  }

  // Show sample addresses
  log(`\nSample ${vendor.toUpperCase()} Addresses:`, 'cyan');
  records.slice(0, 5).forEach((record, idx) => {
    const fullAddress = record.fullAddress || record.address;
    log(`  ${idx + 1}. ${fullAddress}`, 'cyan');
    if (record.price) {
      log(`     Price: $${record.price}`, 'cyan');
    }
  });

  // Statistics
  log(`\nStatistics:`, 'cyan');
  log(`  Total records: ${records.length}`, 'cyan');
  log(`  Sample checked: ${samplesToCheck}`, 'cyan');
  log(`  Valid addresses: ${validCount} (${((validCount / samplesToCheck) * 100).toFixed(1)}%)`, 'cyan');
  log(`  Invalid addresses: ${invalidCount} (${((invalidCount / samplesToCheck) * 100).toFixed(1)}%)`, 'cyan');
}

// Compare addresses across vendors
async function testCrossVendorComparison() {
  logSection('Cross-Vendor Address Comparison');

  const propertyCSV = 'c:\\Users\\91812\\Desktop\\Demo-3 Mioym\\deal-finder-1\\backend\\data\\deal_finder.properties.csv';

  if (!fs.existsSync(propertyCSV)) {
    log('⚠ Property CSV file not found', 'yellow');
    return;
  }

  const properties = parseCSV(propertyCSV);

  if (properties.length === 0) {
    log('⚠ No data in property CSV', 'yellow');
    return;
  }

  // Group by vendor
  const privyProps = properties.filter(p => p.vendor === 'privy');
  const redfinProps = properties.filter(p => p.vendor === 'redfin');

  log(`Properties by vendor:`, 'cyan');
  log(`  Privy: ${privyProps.length}`, 'cyan');
  log(`  Redfin: ${redfinProps.length}`, 'cyan');
  log(`  Other: ${properties.length - privyProps.length - redfinProps.length}`, 'cyan');

  if (privyProps.length === 0 || redfinProps.length === 0) {
    log('\n⚠ Not enough data from both vendors for comparison', 'yellow');
    return;
  }

  // Create address sets (case-insensitive)
  const privyAddresses = new Set(
    privyProps
      .map(p => (p.fullAddress || p.address || '').toLowerCase().trim())
      .filter(Boolean)
  );

  const redfinAddresses = new Set(
    redfinProps
      .map(p => (p.fullAddress || p.address || '').toLowerCase().trim())
      .filter(Boolean)
  );

  // Find matches
  const matches = [...redfinAddresses].filter(addr => privyAddresses.has(addr));

  log(`\nCross-vendor analysis:`, 'cyan');
  log(`  Unique Privy addresses: ${privyAddresses.size}`, 'cyan');
  log(`  Unique Redfin addresses: ${redfinAddresses.size}`, 'cyan');
  log(`  Addresses found in both: ${matches.length}`, 'cyan');

  if (matches.length > 0) {
    log(`\nSample matching addresses:`, 'cyan');
    matches.slice(0, 5).forEach((addr, idx) => {
      log(`  ${idx + 1}. ${addr}`, 'cyan');
    });

    const overlapPercent = ((matches.length / Math.min(privyAddresses.size, redfinAddresses.size)) * 100).toFixed(1);
    log(`\nOverlap rate: ${overlapPercent}%`, 'cyan');
  } else {
    log(`\n✓ No duplicate addresses between vendors`, 'green');
  }
}

// Main test runner
async function runAllTests() {
  log('Address Extraction Test Suite - Privy & Redfin (CSV Version)', 'bold');
  log('Testing address parsing, extraction, and storage using CSV data\n', 'cyan');

  try {
    // Run unit tests
    await testAddressParsingLogic();
    await testRedfinCityExtraction();

    // Test CSV data
    const dataDir = 'c:\\Users\\91812\\Desktop\\Demo-3 Mioym\\deal-finder-1\\backend\\data';

    // Check for CSV files
    const propertyCSV = path.join(dataDir, 'deal_finder.properties.csv');
    const rawPropertyCSV = path.join(dataDir, 'deal_finder.rawproperties.csv');

    // Test property data
    await testAddressesFromCSV(propertyCSV, 'properties');

    // Test raw property data
    await testAddressesFromCSV(rawPropertyCSV, 'raw properties');

    // Cross-vendor comparison
    await testCrossVendorComparison();

    logSection('Test Suite Complete');
    log('All tests finished', 'green');
    log('\nTo get fresh data, run:', 'cyan');
    log('  - Privy scraper: node vendors/privy/run.js', 'cyan');
    log('  - Redfin scraper: node vendors/redfin/run.js', 'cyan');
  } catch (error) {
    log(`\nFatal error: ${error.message}`, 'red');
    console.error(error);
  }
}

// Run tests
runAllTests().catch(console.error);
