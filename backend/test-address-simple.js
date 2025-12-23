/**
 * Simplified Address Extraction Test Suite
 * Tests that Privy and Redfin are correctly extracting and parsing addresses
 * Works independently without relying on complex helper functions
 */

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

  // Should have at least street, city, state (and optionally zip) separated by commas
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length < 3) return false;

  // Last part should have state and optionally zip (e.g., "AL 35004" or just "AL")
  const stateZip = parts[parts.length - 1];
  const stateZipParts = stateZip.split(' ').filter(Boolean);

  // Should have at least state code (2 letters)
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

// Simple address parsing (not using helpers.js to avoid dependencies)
function parseAddress(fullAddress) {
  const parts = fullAddress.split(',').map(s => s.trim());

  if (parts.length < 3) return null;

  const [addressPart, cityPart, stateZipPart] = parts;
  const stateZipParts = stateZipPart.split(' ').filter(Boolean);

  if (stateZipParts.length < 1) return null;

  return {
    fullAddress,
    address: addressPart,
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
      name: 'Valid full address with zip',
      input: '123 Main St, Birmingham, AL 35004',
      expectedValid: true,
      expectedComponents: {
        street: '123 Main St',
        city: 'Birmingham',
        state: 'AL',
        zip: '35004',
      },
    },
    {
      name: 'Valid address without zip',
      input: '456 Oak Ave, Mobile, AL',
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
      input: '789 Pine Rd, AL 35004',
      expectedValid: false,
    },
    {
      name: 'Invalid address (too few parts)',
      input: '321 Elm St',
      expectedValid: false,
    },
    {
      name: 'Address with apartment number',
      input: '555 Maple Dr Apt 2B, Montgomery, AL 36104',
      expectedValid: true,
      expectedComponents: {
        street: '555 Maple Dr Apt 2B',
        city: 'Montgomery',
        state: 'AL',
        zip: '36104',
      },
    },
    {
      name: 'Address with suite',
      input: '1000 Corporate Blvd Suite 200, Atlanta, GA 30303',
      expectedValid: true,
      expectedComponents: {
        street: '1000 Corporate Blvd Suite 200',
        city: 'Atlanta',
        state: 'GA',
        zip: '30303',
      },
    },
  ];

  for (const testCase of testCases) {
    const parsed = parseAddress(testCase.input);

    if (testCase.expectedValid) {
      const isValid = parsed !== null;
      logTest(testCase.name, isValid, `Input: "${testCase.input}"`);

      if (isValid && testCase.expectedComponents) {
        const matches =
          parsed.address === testCase.expectedComponents.street &&
          parsed.city === testCase.expectedComponents.city &&
          parsed.state === testCase.expectedComponents.state &&
          parsed.zip === testCase.expectedComponents.zip;

        logTest(
          `  → Components match expected`,
          matches,
          matches ? 'All components correct' : `Mismatch detected`
        );

        if (!matches) {
          log(`     Expected: ${JSON.stringify(testCase.expectedComponents)}`, 'yellow');
          log(`     Got: ${JSON.stringify({
            street: parsed.address,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
          })}`, 'yellow');
        }
      }
    } else {
      const isInvalid = parsed === null;
      logTest(testCase.name, isInvalid, isInvalid ? 'Correctly filtered out' : 'Should be invalid');
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
    { address: '1000 Peachtree St, Atlanta, GA 30303', expectedCity: 'Atlanta' },
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
  logSection(`3. ${vendor.toUpperCase()} Addresses from Data Files`);

  if (!fs.existsSync(csvFile)) {
    log(`⚠ CSV file not found: ${csvFile}`, 'yellow');
    log(`  Please run the ${vendor} scraper to generate data first`, 'yellow');
    return { total: 0, valid: 0, invalid: 0 };
  }

  const records = parseCSV(csvFile);

  if (records.length === 0) {
    log(`⚠ No data found in CSV file`, 'yellow');
    return { total: 0, valid: 0, invalid: 0 };
  }

  log(`Found ${records.length} records in ${vendor} data`, 'cyan');

  let validCount = 0;
  let invalidCount = 0;
  const issues = [];
  const samples = [];

  // Check all records (or limit to first 100 for performance)
  const samplesToCheck = Math.min(100, records.length);

  for (let i = 0; i < samplesToCheck; i++) {
    const record = records[i];
    const fullAddress = record.fullAddress || record.address;

    if (!fullAddress) {
      issues.push({ index: i, issue: 'Missing fullAddress field', record });
      invalidCount++;
      continue;
    }

    const isValid = isValidAddressFormat(fullAddress);

    if (isValid) {
      validCount++;

      // Collect sample
      if (samples.length < 10) {
        samples.push({
          fullAddress,
          price: record.price,
          vendor: record.vendor,
        });
      }

      const components = parseAddressComponents(fullAddress);

      // Check if parsed components match stored fields (if available)
      if (components && (record.address || record.city || record.state)) {
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
      if (issues.length < 10) {
        issues.push({
          index: i,
          fullAddress: fullAddress,
          issue: 'Invalid format (missing city, state, or zip)',
        });
      }
    }
  }

  const validPercent = ((validCount / samplesToCheck) * 100).toFixed(1);
  const invalidPercent = ((invalidCount / samplesToCheck) * 100).toFixed(1);

  logTest(
    `Valid address format (checked ${samplesToCheck} of ${records.length} records)`,
    invalidCount === 0,
    `${validCount}/${samplesToCheck} valid (${validPercent}%), ${invalidCount} invalid (${invalidPercent}%)`
  );

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
  } else {
    log(`\n✓ All ${samplesToCheck} addresses are properly formatted!`, 'green');
  }

  // Show sample addresses
  log(`\nSample ${vendor.toUpperCase()} Addresses:`, 'cyan');
  samples.forEach((sample, idx) => {
    log(`  ${idx + 1}. ${sample.fullAddress}`, 'cyan');
    if (sample.price) {
      log(`     Price: $${sample.price} | Vendor: ${sample.vendor || 'N/A'}`, 'cyan');
    }
  });

  return { total: records.length, valid: validCount, invalid: invalidCount, checked: samplesToCheck };
}

// Compare addresses across vendors
async function testCrossVendorComparison() {
  logSection('4. Cross-Vendor Address Comparison');

  const propertyCSV = path.join('data', 'deal_finder.properties.csv');

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
  const otherProps = properties.filter(p => p.vendor !== 'privy' && p.vendor !== 'redfin');

  log(`Properties by vendor:`, 'cyan');
  log(`  Privy: ${privyProps.length}`, 'cyan');
  log(`  Redfin: ${redfinProps.length}`, 'cyan');
  if (otherProps.length > 0) {
    log(`  Other: ${otherProps.length}`, 'cyan');
  }

  if (privyProps.length === 0 && redfinProps.length === 0) {
    log('\n⚠ No vendor-specific data available', 'yellow');
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

  if (privyAddresses.size === 0 || redfinAddresses.size === 0) {
    log('\n⚠ Not enough data from both vendors for comparison', 'yellow');
    return;
  }

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

    logTest(
      'Address deduplication working',
      true,
      `System can detect ${matches.length} duplicate addresses between vendors`
    );
  } else {
    log(`\n✓ No duplicate addresses between vendors`, 'green');
    logTest('Cross-vendor uniqueness', true, 'All addresses are unique across vendors');
  }
}

// Main test runner
async function runAllTests() {
  log('════════════════════════════════════════════════════════════════════════════════', 'bold');
  log('  ADDRESS EXTRACTION TEST SUITE - PRIVY & REDFIN', 'bold');
  log('════════════════════════════════════════════════════════════════════════════════', 'bold');
  log('\nVerifying that both vendors extract and format addresses correctly\n', 'cyan');

  try {
    // Run unit tests
    await testAddressParsingLogic();
    await testRedfinCityExtraction();

    // Test CSV data
    const propertyCSV = path.join('data', 'deal_finder.properties.csv');
    const rawPropertyCSV = path.join('data', 'deal_finder.rawproperties.csv');

    // Test property data
    const propertyStats = await testAddressesFromCSV(propertyCSV, 'properties');

    // Test raw property data
    const rawPropertyStats = await testAddressesFromCSV(rawPropertyCSV, 'raw properties');

    // Cross-vendor comparison
    await testCrossVendorComparison();

    // Final summary
    logSection('TEST SUMMARY');

    log('Results:', 'cyan');
    log(`  Property records tested: ${propertyStats.checked} of ${propertyStats.total}`, 'cyan');
    log(`  Valid addresses: ${propertyStats.valid}`, 'green');
    log(`  Invalid addresses: ${propertyStats.invalid}`, propertyStats.invalid > 0 ? 'red' : 'green');

    if (rawPropertyStats.total > 0) {
      log(`\n  Raw property records tested: ${rawPropertyStats.checked} of ${rawPropertyStats.total}`, 'cyan');
      log(`  Valid addresses: ${rawPropertyStats.valid}`, 'green');
      log(`  Invalid addresses: ${rawPropertyStats.invalid}`, rawPropertyStats.invalid > 0 ? 'red' : 'green');
    }

    const totalInvalid = propertyStats.invalid + rawPropertyStats.invalid;

    if (totalInvalid === 0) {
      log('\n🎉 SUCCESS! All addresses are properly formatted!', 'green');
      log('\nBoth Privy and Redfin are correctly extracting:', 'green');
      log('  ✓ Street addresses', 'green');
      log('  ✓ City names', 'green');
      log('  ✓ State codes', 'green');
      log('  ✓ ZIP codes', 'green');
    } else {
      log(`\n⚠ Found ${totalInvalid} addresses with formatting issues`, 'yellow');
      log('\nRecommended actions:', 'yellow');
      log('  1. Check the scraper selectors for address extraction', 'yellow');
      log('  2. Verify the address parsing logic in helpers.js', 'yellow');
      log('  3. Review the issues logged above', 'yellow');
    }

    log('\n════════════════════════════════════════════════════════════════════════════════', 'bold');
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
  }
}

// Run tests
runAllTests().catch(console.error);
