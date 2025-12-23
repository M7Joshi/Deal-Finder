// Test the web scraper to get REAL listings from Redfin
import { scrapeRedfinListings } from './vendors/redfin/webScraper.js';

async function testWebScraper() {
  console.log('🔍 Testing Redfin Web Scraper');
  console.log('This will scrape REAL active listings from Redfin\n');

  try {
    console.log('Testing NJ (New Jersey)...\n');
    const properties = await scrapeRedfinListings('NJ', 'New Jersey', 5);

    console.log(`\n✅ Successfully scraped ${properties.length} REAL properties:\n`);

    properties.forEach((prop, i) => {
      console.log(`${i + 1}. ${prop.fullAddress}`);
      console.log(`   State: ${prop.state}`);
      console.log(`   Price: ${prop.priceText || 'N/A'}`);
      console.log(`   ${prop.bedsText || 'N/A'}, ${prop.bathsText || 'N/A'}, ${prop.sqftText || 'N/A'}`);
      console.log(`   Status: ${prop.status}`);
      console.log(`   URL: ${prop.url || 'N/A'}`);
      console.log('');
    });

    console.log('✅ These are REAL active listings from Redfin!');
    console.log('You can verify by visiting the URLs above.\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testWebScraper();
