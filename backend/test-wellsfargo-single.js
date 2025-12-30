import dotenv from 'dotenv';
dotenv.config();

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

// Test address - change this to test different addresses
const TEST_ADDRESS = '14315 Gaines Ave, Rockville, MD 20853';

// Use Privy Chrome profile if available
const PRIVY_PROFILE = process.env.PRIVY_PROFILE_PATH || 'C:\\Users\\91812\\.privy-chrome-profile';

async function testSingleAddress() {
  console.log('=== WELLS FARGO SINGLE ADDRESS TEST ===');
  console.log('Testing address:', TEST_ADDRESS);
  console.log('Using Chrome profile:', PRIVY_PROFILE);
  console.log('');
  console.log('Browser will open. YOU will need to:');
  console.log('1. Type the address in the search box');
  console.log('2. Select the autocomplete suggestion');
  console.log('3. Wait for the property page to load');
  console.log('The script will then extract agent info.');
  console.log('');

  let browser;
  try {
    // Launch fresh browser (no profile to avoid conflicts)
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1400,900',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to ComeHome
    console.log('Navigating to Wells Fargo ComeHome...');
    await page.goto('https://wellsfargo.comehome.com/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Give user time to manually search
    console.log('');
    console.log('>>> MANUAL STEP: Search for the address and click on the result.');
    console.log('>>> Waiting 45 seconds for you to do this...');
    await new Promise(r => setTimeout(r, 45000));

    // After manual search, extract data from whatever page we're on
    console.log('');
    console.log('Extracting data from current page...');

    // Check if page is still open
    try {
      const url = page.url();
      console.log('Current URL:', url);
    } catch (e) {
      console.log('Page was closed! Cannot extract data.');
      return;
    }

    // Take final screenshot
    try {
      await page.screenshot({ path: 'wellsfargo-result.png', fullPage: true });
      console.log('Screenshot saved: wellsfargo-result.png');
    } catch (e) {
      console.log('Could not take screenshot:', e.message);
    }

    // Extract any contact info from page
    const pageText = await page.evaluate(() => document.body.innerText);
    const pageUrl = page.url();

    console.log('');
    console.log('=== RESULT ===');
    console.log('URL:', pageUrl);

    // Look for emails and phones
    const emails = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const phones = pageText.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g) || [];
    const nmls = pageText.match(/NMLS\s*#?\s*(\d+)/gi) || [];

    console.log('Emails found:', emails);
    console.log('Phones found:', phones);
    console.log('NMLS found:', nmls);

    // Keep browser open for inspection
    console.log('');
    console.log('>>> Browser will stay open for 60 seconds for inspection...');
    await new Promise(r => setTimeout(r, 60000));

  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err.stack);
  } finally {
    // Close browser
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    console.log('Done!');
  }
}

testSingleAddress();
