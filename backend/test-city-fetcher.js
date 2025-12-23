// Test the new city-based fetcher to ensure it returns REAL listings
import { fetchPropertiesByState } from './vendors/redfin/cityFetcher.js';

async function testCityFetcher() {
  console.log('🔍 Testing City-Based Redfin Fetcher\n');
  console.log('This should return REAL active listings from Redfin\n');

  const states = ['NJ', 'NC'];

  for (const state of states) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing ${state}`);
    console.log('='.repeat(60));

    try {
      const properties = await fetchPropertiesByState(state, 5);

      console.log(`\n✅ Got ${properties.length} real properties from ${state}\n`);

      if (properties.length > 0) {
        console.log('📍 Properties:');
        properties.forEach((prop, i) => {
          console.log(`\n${i + 1}. ${prop.fullAddress}`);
          console.log(`   State: ${prop.state} ${prop.state === state ? '✅ CORRECT' : '❌ WRONG'}`);
          console.log(`   Price: ${prop.priceText}`);
          console.log(`   ${prop.bedsText}, ${prop.bathsText}, ${prop.sqftText}`);
          console.log(`   Status: ${prop.status}`);
          console.log(`   URL: ${prop.url}`);
        });

        // Verify all properties are from correct state
        const wrongState = properties.filter(p => p.state !== state);
        if (wrongState.length > 0) {
          console.log(`\n⚠️ WARNING: ${wrongState.length} properties from wrong state!`);
        } else {
          console.log(`\n✅ ALL properties are from ${state}!`);
        }
      } else {
        console.log('\n⚠️ No properties returned');
      }

      // Add delay between requests
      if (state !== states[states.length - 1]) {
        console.log('\nWaiting 2 seconds before next request...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`\n❌ Error testing ${state}:`, error.message);
    }
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(60));
  console.log('\nIf properties are shown, they should be:');
  console.log('✅ From the correct state');
  console.log('✅ Real listings (not mock data)');
  console.log('✅ Active/for sale on Redfin');
}

testCityFetcher().catch(console.error);
