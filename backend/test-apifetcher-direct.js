// Direct test of apiFetcher functions
import { getRegionIdForState, fetchRedfinGISData } from './vendors/redfin/apiFetcher.js';

async function test() {
  console.log('🔍 Testing apiFetcher.js directly\n');

  // Test getRegionIdForState
  console.log('========== Testing getRegionIdForState ==========\n');

  const njRegion = await getRegionIdForState('NJ', 'New Jersey');
  console.log('NJ Result:', njRegion);

  const ncRegion = await getRegionIdForState('NC', 'North Carolina');
  console.log('NC Result:', ncRegion);

  const caRegion = await getRegionIdForState('CA', 'California');
  console.log('CA Result:', caRegion);

  if (njRegion) {
    console.log('\n========== Testing fetchRedfinGISData for NJ ==========\n');
    const properties = await fetchRedfinGISData({
      region_id: njRegion.region_id,
      region_type: njRegion.region_type,
      limit: 5
    });

    console.log(`\nGot ${properties.length} properties:`);
    properties.slice(0, 3).forEach((prop, i) => {
      console.log(`\n${i + 1}. ${prop.fullAddress}`);
      console.log(`   Price: ${prop.priceText}`);
      console.log(`   ${prop.bedsText}, ${prop.bathsText}`);
    });
  }
}

test().catch(console.error);
