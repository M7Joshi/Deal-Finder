import dotenv from 'dotenv';
dotenv.config();

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

// Test address
const TEST_ADDRESS = '14315 Gaines Ave, Rockville, MD 20853';

// Convert address to Wells Fargo URL format
// "100 Bonney St, New Bedford, MA 02740" -> "100-Bonney-St-New-Bedford-MA-02740"
function addressToWellsFargoUrl(address) {
  // Remove extra spaces, replace commas and spaces with dashes
  const slug = address
    .trim()
    .replace(/,/g, '')           // Remove commas
    .replace(/\s+/g, '-')        // Replace spaces with dashes
    .replace(/-+/g, '-');        // Remove multiple dashes

  return `https://wellsfargo.comehome.com/property-details/${slug}`;
}

async function testDirectUrl() {
  const propertyUrl = addressToWellsFargoUrl(TEST_ADDRESS);

  console.log('=== WELLS FARGO DIRECT URL TEST ===');
  console.log('Address:', TEST_ADDRESS);
  console.log('Property URL:', propertyUrl);
  console.log('');

  let browser;
  try {
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

    // STEP 1: First go to homepage to establish session / solve CAPTCHA
    console.log('STEP 1: Opening Wells Fargo homepage first...');
    try {
      await page.goto('https://wellsfargo.comehome.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('Homepage navigation error:', e.message);
    }

    console.log('');
    console.log('>>> If you see a CAPTCHA, solve it now!');
    console.log('>>> Waiting 20 seconds...');
    await new Promise(r => setTimeout(r, 20000));

    // STEP 2: Now navigate to the property URL
    console.log('');
    console.log('STEP 2: Navigating to property page...');
    console.log('URL:', propertyUrl);

    try {
      await page.goto(propertyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
      console.log('Property navigation error:', e.message);
    }

    // Check if CAPTCHA appeared
    const pageContent = await page.content();
    if (pageContent.includes('confirm you are human') || pageContent.includes('security check')) {
      console.log('');
      console.log('>>> CAPTCHA DETECTED on property page!');
      console.log('>>> Please solve it now. Waiting 30 seconds...');
      await new Promise(r => setTimeout(r, 30000));
    }

    // Wait for page to fully load after CAPTCHA
    await new Promise(r => setTimeout(r, 3000));

    const finalUrl = page.url();
    console.log('Final URL:', finalUrl);

    // Check if we got redirected to homepage (property not found)
    if (finalUrl.includes('property-details')) {
      console.log('SUCCESS: Property page loaded!');
    } else {
      console.log('FAILED: Redirected away from property page');
    }

    // Take screenshot
    try {
      await page.screenshot({ path: 'wellsfargo-direct-result.png', fullPage: true });
      console.log('Screenshot saved: wellsfargo-direct-result.png');
    } catch (e) {
      console.log('Screenshot error:', e.message);
    }

    // Extract contact info
    let pageText = '';
    try {
      pageText = await page.evaluate(() => document.body.innerText);
    } catch (e) {
      console.log('Could not get page text:', e.message);
    }

    // Look for emails, phones, NMLS
    const emails = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const phones = pageText.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g) || [];
    const nmls = pageText.match(/NMLS\s*#?\s*(\d+)/gi) || [];

    console.log('');
    console.log('=== EXTRACTED DATA ===');
    console.log('Emails:', emails);
    console.log('Phones:', phones);
    console.log('NMLS:', nmls);

    // Try to find mortgage consultant name
    const nameMatch = pageText.match(/Contact\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
    if (nameMatch) {
      console.log('Consultant Name:', nameMatch[1]);
    }

    // Keep browser open for inspection
    console.log('');
    console.log('>>> Browser will stay open for 30 seconds...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    console.log('Done!');
  }
}

testDirectUrl();
