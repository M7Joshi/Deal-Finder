// Test the Redfin live scrape endpoint with NJ state
import axios from 'axios';

async function testRedfinScraper() {
  try {
    console.log('Testing Redfin live scrape endpoint with NJ state...\n');

    const response = await axios.get('http://localhost:3015/api/live-scrape/redfin', {
      params: {
        state: 'NJ',
        limit: 5
      }
      // No auth required for /redfin endpoint
    });

    console.log('Response Status:', response.status);
    console.log('Source:', response.data.source);
    console.log('State:', response.data.state);
    console.log('State Code:', response.data.stateCode);
    console.log('Count:', response.data.count);
    console.log('Message:', response.data.message);
    console.log('\nFirst 3 Properties:');

    response.data.addresses.slice(0, 3).forEach((prop, i) => {
      console.log(`\n${i + 1}. ${prop.fullAddress}`);
      console.log(`   State: ${prop.state}`);
      console.log(`   Price: ${prop.priceText || prop.price}`);
      console.log(`   Beds/Baths: ${prop.bedsText || prop.beds}/${prop.bathsText || prop.baths}`);
      console.log(`   Sqft: ${prop.sqftText || prop.sqft}`);
      console.log(`   Status: ${prop.status}`);
      console.log(`   Vendor: ${prop.vendor}`);
      console.log(`   URL: ${prop.url}`);
    });

    // Verify all properties are from NJ
    const wrongState = response.data.addresses.filter(p => p.state !== 'NJ');
    if (wrongState.length > 0) {
      console.log(`\n⚠️  WARNING: Found ${wrongState.length} properties NOT from NJ:`);
      wrongState.forEach(p => console.log(`   - ${p.fullAddress} (${p.state})`));
    } else {
      console.log('\n✅ All properties are from NJ!');
    }

  } catch (error) {
    if (error.response) {
      console.error('Error Response:', error.response.status, error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testRedfinScraper();
