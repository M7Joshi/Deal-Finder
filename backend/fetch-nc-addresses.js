// Fetch 10 addresses from North Carolina using Privy
import PrivyBot from './vendors/privy/privyBot.js';
import { logPrivy } from './utils/logger.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Simple limit - stop after 10 properties
let addressCount = 0;
const MAX_ADDRESSES = 10;
const foundAddresses = [];

async function fetchNCAddresses() {
  try {
    logPrivy.info('Starting NC address fetch (limit: 10)...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    logPrivy.success('Connected to MongoDB');

    // Create Privy bot instance
    const bot = new PrivyBot();

    logPrivy.info('Initializing Privy bot...');
    await bot.init();

    logPrivy.info('Logging in to Privy...');
    await bot.login();

    // Navigate to a single NC city to get some quick results
    const ncUrl = "https://app.privy.pro/dashboard?search_text=Charlotte%2C+NC&location_type=city&project_type=buy_hold&spread_type=arv&spread=50&list_price_from=75000&list_price_to=750000&beds_from=3&sqft_from=1000&hoa=no&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc";

    logPrivy.info('Navigating to Charlotte, NC properties...');
    await bot.page.goto(ncUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for properties to load
    await bot.page.waitForTimeout(5000);

    // Extract addresses from the page
    logPrivy.info('Extracting addresses from page...');
    const properties = await bot.page.evaluate(() => {
      const results = [];

      // Try multiple selectors to find property cards
      const selectors = [
        '[data-testid="property-card"]',
        '.property-card',
        '.result-card',
        '[class*="property"]',
        '[class*="listing"]'
      ];

      let elements = [];
      for (const selector of selectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) break;
      }

      // If no cards found, try to get any address text
      if (elements.length === 0) {
        // Look for any elements containing address-like patterns
        const allText = document.body.innerText;
        const addressPattern = /\d+\s+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}/g;
        const matches = allText.match(addressPattern);
        if (matches) {
          return matches.slice(0, 10).map(addr => ({ fullAddress: addr.trim() }));
        }
      }

      // Extract from cards
      for (let i = 0; i < Math.min(elements.length, 10); i++) {
        const card = elements[i];
        const text = card.innerText || card.textContent || '';

        // Try to extract address
        const addressMatch = text.match(/(.+?)\s*,\s*([A-Z]{2})\s*(\d{5})/);
        if (addressMatch) {
          results.push({
            fullAddress: addressMatch[0].trim(),
            rawText: text.substring(0, 200)
          });
        }
      }

      return results;
    });

    logPrivy.success(`Found ${properties.length} properties`);

    // Display results
    console.log('\n========================================');
    console.log('🏠 NORTH CAROLINA PROPERTIES (ON SALE)');
    console.log('========================================\n');

    properties.forEach((prop, index) => {
      console.log(`${index + 1}. ${prop.fullAddress}`);
      foundAddresses.push(prop.fullAddress);
    });

    console.log('\n========================================\n');

    // Close bot
    await bot.close();

    // Disconnect from MongoDB
    await mongoose.disconnect();

    logPrivy.success(`Successfully fetched ${properties.length} NC addresses`);

    return foundAddresses;

  } catch (error) {
    logPrivy.error('Error fetching NC addresses', { error: error.message });
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run the script
fetchNCAddresses()
  .then((addresses) => {
    console.log('\n✅ Complete! Fetched addresses:');
    addresses.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
