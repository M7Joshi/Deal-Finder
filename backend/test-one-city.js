/**
 * Test script to scrape ONE city with VISIBLE browser
 * Run from backend folder: node test-one-city.js
 */

import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import connectDB from './db/db.js';
import ScrapedDeal from './models/ScrapedDeal.js';

dotenv.config({ path: '../.env' });

const PRIVY_EMAIL = process.env.PRIVY_EMAIL;
const PRIVY_PASSWORD = process.env.PRIVY_PASSWORD;

// Test with ONE city - Birmingham, AL
const TEST_CITY = 'Birmingham';
const TEST_STATE = 'AL';

async function main() {
  console.log('🚀 Starting single-city test with VISIBLE browser...');
  console.log(`📍 Testing: ${TEST_CITY}, ${TEST_STATE}`);
  console.log(`📧 Email: ${PRIVY_EMAIL}`);
  console.log(`🔑 Password length: ${PRIVY_PASSWORD?.length || 0}`);

  // Connect to MongoDB
  await connectDB();
  console.log('✅ MongoDB connected');

  // Launch browser in VISIBLE mode (headless: false)
  console.log('🖥️ Launching VISIBLE browser...');
  const browser = await puppeteer.launch({
    headless: false,  // VISIBLE BROWSER
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Step 1: Go to Privy login
    console.log('📱 Navigating to Privy...');
    await page.goto('https://app.privy.pro/login', { waitUntil: 'networkidle2', timeout: 60000 });

    // Check if already logged in
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    if (currentUrl.includes('dashboard')) {
      console.log('✅ Already logged in!');
    } else {
      // Login
      console.log('🔐 Logging in...');
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
      await page.type('input[type="email"], input[name="email"]', PRIVY_EMAIL);
      await page.type('input[type="password"], input[name="password"]', PRIVY_PASSWORD);
      await page.click('button[type="submit"]');

      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
      console.log('✅ Logged in successfully');
    }

    // Step 2: Navigate to search URL for Birmingham, AL
    const searchUrl = `https://app.privy.pro/dashboard?update_history=true&search_text=${encodeURIComponent(TEST_CITY + ', ' + TEST_STATE)}&location_type=city&include_surrounding=true&project_type=buy_hold&spread_type=umv&spread=50&isLTRsearch=false&preferred_only=false&list_price_from=20000&list_price_to=600000&price_per_sqft_from=0&beds_from=3&sqft_from=1000&hoa=no&basement=Any&include_condo=false&include_attached=false&include_detached=true&include_multi_family=false&include_active=true&include_under_contract=false&include_sold=false&include_pending=false&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc`;

    console.log(`🌐 Navigating to ${TEST_CITY}, ${TEST_STATE}...`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for listings to load
    console.log('⏳ Waiting for listings to load...');
    await new Promise(r => setTimeout(r, 5000));

    // Step 3: Extract property cards
    console.log('🔍 Extracting property listings...');

    const properties = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="property-card"], [class*="PropertyCard"], .property-list-item, [data-testid="property-card"]');
      const results = [];

      cards.forEach(card => {
        const addressEl = card.querySelector('[class*="address"], h2, h3, .address');
        const priceEl = card.querySelector('[class*="price"], .price');

        if (addressEl) {
          results.push({
            address: addressEl.textContent?.trim() || '',
            price: priceEl?.textContent?.trim() || '',
          });
        }
      });

      return results;
    });

    console.log(`📋 Found ${properties.length} properties from card selectors`);

    // Also try to find addresses in any text on page
    const allText = await page.evaluate(() => document.body.innerText);
    console.log('\n📄 Page content sample (first 2000 chars):');
    console.log(allText.substring(0, 2000));

    // Try finding property rows differently
    const rows = await page.evaluate(() => {
      // Look for property rows in different ways
      const allDivs = Array.from(document.querySelectorAll('div'));
      const addressPattern = /\d+\s+[A-Za-z]/;  // Pattern like "123 Main"
      const found = [];

      allDivs.forEach(div => {
        const text = div.textContent?.trim() || '';
        if (text.length < 200 && addressPattern.test(text) && text.includes(',')) {
          found.push(text);
        }
      });

      return [...new Set(found)].slice(0, 20);  // Dedupe and limit
    });

    console.log('\n📍 Potential addresses found:');
    rows.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));

    // Step 4: Save to database
    if (properties.length > 0) {
      console.log('\n💾 Saving to database...');
      for (const prop of properties) {
        if (prop.address) {
          const deal = new ScrapedDeal({
            address: prop.address,
            source: 'privy',
            state: TEST_STATE,
            city: TEST_CITY,
            rawData: prop,
            scrapedAt: new Date(),
          });
          await deal.save();
          console.log(`  ✅ Saved: ${prop.address}`);
        }
      }
    } else {
      console.log('⚠️ No properties found from standard selectors.');
      console.log('   Check the browser window to see what selectors to use.');
    }

    // Keep browser open for inspection
    console.log('\n👀 Browser will stay open for 2 minutes for you to inspect...');
    console.log('   Press Ctrl+C to close earlier.');
    await new Promise(r => setTimeout(r, 120000)); // 2 minutes

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n👀 Browser will stay open for inspection...');
    await new Promise(r => setTimeout(r, 120000));
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main().catch(console.error);
