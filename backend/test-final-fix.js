// Final test to verify the complete fix works
import { getRegionIdForState, fetchRedfinGISData } from './vendors/redfin/apiFetcher.js';

async function testStateFetch(stateCode, stateName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${stateName} (${stateCode})`);
  console.log('='.repeat(60));

  // Step 1: Get region ID
  const regionInfo = await getRegionIdForState(stateCode, stateName);
  if (!regionInfo) {
    console.log(`❌ Could not find region for ${stateCode}`);
    return;
  }

  console.log(`✅ Found region: ID=${regionInfo.region_id}, Type=${regionInfo.region_type}`);

  // Step 2: Fetch properties WITH state filtering
  const properties = await fetchRedfinGISData({
    region_id: regionInfo.region_id,
    region_type: regionInfo.region_type,
    limit: 5,
    filterState: stateCode
  });

  console.log(`\n✅ Got ${properties.length} properties after filtering`);

  if (properties.length > 0) {
    console.log('\n📍 First 3 properties:');
    properties.slice(0, 3).forEach((prop, i) => {
      console.log(`\n${i + 1}. ${prop.fullAddress}`);
      console.log(`   State: ${prop.state}`);
      console.log(`   Price: ${prop.priceText}`);
      console.log(`   ${prop.bedsText || 'N/A'}, ${prop.bathsText || 'N/A'}`);
      console.log(`   URL: ${prop.url}`);
    });

    // Verify all properties are from the correct state
    const wrongState = properties.filter(p => p.state !== stateCode);
    if (wrongState.length > 0) {
      console.log(`\n⚠️ WARNING: Found ${wrongState.length} properties from wrong state!`);
    } else {
      console.log(`\n✅ ALL properties are from ${stateCode}! Fix is working!`);
    }
  } else {
    console.log(`\n⚠️ No properties found for ${stateCode}`);
  }
}

async function main() {
  console.log('🔍 Final Test - Verifying Complete Fix');
  console.log('Testing that NJ returns NJ properties, not WA properties\n');

  await testStateFetch('NJ', 'New Jersey');
  await testStateFetch('NC', 'North Carolina');

  console.log('\n\n✅ Testing complete!');
}

main().catch(console.error);
