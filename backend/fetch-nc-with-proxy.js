// Fetch 10 NC addresses from Privy using paid proxies
import PrivyBot from './vendors/privy/privyBot.js';
import { logPrivy } from './utils/logger.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getChromeProxyForPaid } from './services/proxyManager.js';

dotenv.config();

async function fetchNCWithProxy() {
  try {
    logPrivy.info('🚀 Starting NC address fetch with PAID PROXIES...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    logPrivy.success('✅ Connected to MongoDB');

    // Get a paid proxy for Privy
    logPrivy.info('🔄 Getting paid proxy...');
    const proxyInfo = await getChromeProxyForPaid({ service: 'privy', sticky: true, key: 'privy' });

    if (proxyInfo) {
      logPrivy.success(`✅ Using proxy: ${proxyInfo.arg}`);
    } else {
      logPrivy.warn('⚠️  No proxy available, continuing without proxy');
    }

    // Create Privy bot instance with proxy
    const bot = new PrivyBot({ proxyInfo });

    logPrivy.info('🔧 Initializing Privy bot with proxy...');
    await bot.init();

    logPrivy.info('🔐 Logging in to Privy (this may require OTP)...');
    await bot.login();

    logPrivy.success('✅ Login successful!');

    // Navigate to Charlotte, NC (should have active listings)
    const ncUrl = "https://app.privy.pro/dashboard?search_text=Charlotte%2C+NC&location_type=city&include_active=true&beds_from=3&list_price_from=75000&list_price_to=750000&date_range=all&sort_by=days-on-market&sort_dir=asc";

    logPrivy.info('🌍 Navigating to Charlotte, NC properties...');
    await bot.page.goto(ncUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait for page to load
    logPrivy.info('⏳ Waiting for properties to load...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Try to wait for property list
    try {
      await bot.page.waitForSelector('.property-card, [data-testid="property-card"], .result-card', { timeout: 10000 });
    } catch (e) {
      logPrivy.warn('Property cards not found with expected selectors, trying extraction anyway...');
    }

    // Extract addresses from the page
    logPrivy.info('📍 Extracting addresses from page...');
    const properties = await bot.page.evaluate(() => {
      const results = [];

      // Try multiple selectors to find property cards
      const selectors = [
        '[data-testid="property-card"]',
        '.property-card',
        '.result-card',
        '[class*="PropertyCard"]',
        '[class*="property"]'
      ];

      let elements = [];
      for (const selector of selectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          break;
        }
      }

      // Extract from cards
      for (let i = 0; i < Math.min(elements.length, 10); i++) {
        const card = elements[i];
        const text = card.innerText || card.textContent || '';

        // Try to find address in the text
        // Look for patterns like "123 Main St" followed by "City, ST ZIP"
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        // Find street address (usually has a number)
        const streetLine = lines.find(l => /^\d+\s+[A-Za-z]/.test(l));
        // Find city/state line
        const cityStateLine = lines.find(l => /,\s*[A-Z]{2}\s+\d{5}/.test(l));

        if (streetLine && cityStateLine) {
          results.push({
            fullAddress: `${streetLine}, ${cityStateLine}`,
            street: streetLine,
            cityStateZip: cityStateLine,
            rawText: text.substring(0, 300)
          });
        } else {
          // Fallback: try to match full address pattern
          const addressMatch = text.match(/(\d+\s+[A-Za-z\s#.,-]+),\s*([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5})/);
          if (addressMatch) {
            results.push({
              fullAddress: addressMatch[0].trim(),
              street: addressMatch[1].trim(),
              city: addressMatch[2].trim(),
              state: addressMatch[3],
              zip: addressMatch[4]
            });
          }
        }
      }

      return results;
    });

    logPrivy.success(`✅ Found ${properties.length} properties from Charlotte, NC`);

    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('🏠  NORTH CAROLINA PROPERTIES (LIVE FROM PRIVY.PRO)');
    console.log('='.repeat(60) + '\n');

    if (properties.length === 0) {
      console.log('❌ No properties found. This could mean:');
      console.log('   1. The page selectors have changed');
      console.log('   2. There are no active listings in Charlotte, NC');
      console.log('   3. The page did not load properly\n');
      console.log('💡 Suggestion: Check the Privy dashboard manually to verify listings exist.\n');
    } else {
      properties.forEach((prop, index) => {
        console.log(`${index + 1}. ${prop.fullAddress}`);
        if (prop.street) console.log(`   Street: ${prop.street}`);
        if (prop.city) console.log(`   City: ${prop.city}, ${prop.state} ${prop.zip}`);
        console.log('');
      });
    }

    console.log('='.repeat(60) + '\n');

    // Close bot
    await bot.close();

    // Disconnect from MongoDB
    await mongoose.disconnect();

    logPrivy.success(`✅ Successfully completed! Fetched ${properties.length} NC addresses using paid proxy`);

    return properties;

  } catch (error) {
    logPrivy.error('❌ Error fetching NC addresses', { error: error.message });
    console.error('\n❌ Full error:', error);

    if (error.message && error.message.includes('OTP')) {
      console.log('\n💡 OTP REQUIRED:');
      console.log('   Privy is asking for 2FA code. To handle this:');
      console.log('   1. Start the backend server: npm start');
      console.log('   2. Open the Control Panel at http://localhost:3000');
      console.log('   3. Check your email for Privy 2FA code');
      console.log('   4. Enter the code in the OTP page\n');
    }

    process.exit(1);
  }
}

// Run the script
fetchNCWithProxy()
  .then((addresses) => {
    console.log(`\n✅ Complete! Fetched ${addresses.length} addresses from North Carolina`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  });
