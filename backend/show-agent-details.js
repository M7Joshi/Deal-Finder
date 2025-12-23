// Script to open a Redfin listing and show where agent details are located
import puppeteer from 'puppeteer';

async function showAgentDetails() {
  const browser = await puppeteer.launch({
    headless: false, // Show browser so you can see
    args: ['--start-maximized']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to a sample Redfin listing (Charlotte, NC)
    console.log('Opening a sample Redfin listing...');
    await page.goto('https://www.redfin.com/city/3908/NC/Charlotte', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for listings
    await page.waitForSelector('.HomeCardContainer, .bp-Homecard', { timeout: 10000 });

    // Click on the first listing
    const firstListing = await page.$('.HomeCardContainer a, .bp-Homecard a');
    if (firstListing) {
      console.log('Clicking on first listing...');
      await firstListing.click();

      // Wait for detail page to load
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Take a screenshot
      const timestamp = Date.now();
      const screenshotPath = `./redfin-agent-location-${timestamp}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      console.log(`Screenshot saved to: ${screenshotPath}`);

      // Try to extract agent details to show what's available
      const agentDetails = await page.evaluate(() => {
        const details = {
          foundElements: []
        };

        // Look for agent-related elements
        const agentSelectors = [
          '[class*="agent" i]',
          '[class*="Agent"]',
          '[data-rf-test-name*="agent"]',
          '[class*="listing-agent"]',
          '[class*="ListingAgent"]',
          '.agent-name',
          '.agent-info',
          '[class*="broker"]',
          '[class*="Broker"]'
        ];

        agentSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el, idx) => {
            const text = el.textContent?.trim();
            if (text && text.length > 0 && text.length < 500) {
              details.foundElements.push({
                selector: selector,
                className: el.className,
                text: text.substring(0, 200),
                hasPhone: /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text),
                hasEmail: /@/.test(text)
              });
            }
          });
        });

        // Look for phone numbers
        const bodyText = document.body.textContent || '';
        const phoneMatches = bodyText.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g);
        if (phoneMatches) {
          details.phoneNumbers = [...new Set(phoneMatches)].slice(0, 5);
        }

        return details;
      });

      console.log('\nAgent-related elements found:');
      console.log(JSON.stringify(agentDetails, null, 2));

      console.log('\n\nBrowser will stay open for 30 seconds so you can see the page...');
      console.log('Look for agent details - they are typically in the right sidebar or below the photos.');

      await page.waitForTimeout(30000);
    } else {
      console.log('No listings found');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

showAgentDetails();
