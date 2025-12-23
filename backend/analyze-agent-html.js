// Analyze Redfin HTML to find agent details
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function analyzeAgentHTML() {
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Go to Charlotte listings
    console.log('Loading Charlotte listings...');
    await page.goto('https://www.redfin.com/city/3908/NC/Charlotte/filter/property-type=house,max-price=500k', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await sleep(3000);

    // Get the first property URL
    const firstPropertyUrl = await page.evaluate(() => {
      const link = document.querySelector('.HomeCardContainer a, .bp-Homecard a[href*="/home/"]');
      return link ? link.href : null;
    });

    if (!firstPropertyUrl) {
      console.log('No property found');
      await browser.close();
      return;
    }

    console.log(`Found property: ${firstPropertyUrl}`);

    // Navigate to the detail page
    console.log('Loading property detail page...');
    await page.goto(firstPropertyUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await sleep(5000);

    // Take screenshot
    const screenshot = `./redfin-property-detail-${Date.now()}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`Screenshot saved: ${screenshot}`);

    // Extract all agent-related information
    const agentInfo = await page.evaluate(() => {
      const result = {
        agentSections: [],
        allPhones: [],
        allEmails: [],
        allNames: []
      };

      // Common agent selectors
      const selectors = [
        '[class*="agent" i]',
        '[class*="Agent"]',
        '[data-rf-test-name*="agent"]',
        '[class*="contact"]',
        '[class*="Contact"]',
        '[class*="listing-agent"]',
        '[class*="ListingAgent"]',
        '[class*="broker"]',
        '[class*="Broker"]'
      ];

      selectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length > 5 && text.length < 1000) {
              result.agentSections.push({
                selector,
                className: el.className,
                id: el.id,
                text: text.substring(0, 300),
                html: el.innerHTML.substring(0, 500)
              });
            }
          });
        } catch (e) {}
      });

      // Extract phone numbers from page
      const bodyText = document.body.textContent || '';
      const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
      let phoneMatch;
      while ((phoneMatch = phoneRegex.exec(bodyText)) !== null) {
        result.allPhones.push(phoneMatch[0]);
      }
      result.allPhones = [...new Set(result.allPhones)];

      // Extract emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let emailMatch;
      while ((emailMatch = emailRegex.exec(bodyText)) !== null) {
        result.allEmails.push(emailMatch[0]);
      }
      result.allEmails = [...new Set(result.allEmails)];

      return result;
    });

    // Save HTML for analysis
    const html = await page.content();
    fs.writeFileSync('./redfin-detail-page.html', html);
    console.log('HTML saved: ./redfin-detail-page.html');

    // Save agent info
    fs.writeFileSync('./agent-info-analysis.json', JSON.stringify(agentInfo, null, 2));
    console.log('Agent info saved: ./agent-info-analysis.json');

    console.log('\n=== AGENT INFORMATION FOUND ===');
    console.log(`\nPhone numbers found: ${agentInfo.allPhones.length}`);
    agentInfo.allPhones.forEach(phone => console.log(`  - ${phone}`));

    console.log(`\nEmails found: ${agentInfo.allEmails.length}`);
    agentInfo.allEmails.forEach(email => console.log(`  - ${email}`));

    console.log(`\nAgent sections found: ${agentInfo.agentSections.length}`);
    agentInfo.agentSections.slice(0, 5).forEach((section, idx) => {
      console.log(`\n--- Section ${idx + 1} ---`);
      console.log(`Class: ${section.className}`);
      console.log(`Text: ${section.text.substring(0, 150)}...`);
    });

    await browser.close();
  } catch (error) {
    console.error('Error:', error);
    if (browser) await browser.close();
  }
}

analyzeAgentHTML();
