// Real web scraping for Redfin - gets actual active listings
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

/**
 * Scrape real active listings from Redfin for a given state
 * @param {string} stateCode - Two-letter state code (e.g., "NJ", "CA")
 * @param {string} stateName - Full state name (e.g., "New Jersey")
 * @param {number} limit - Max number of properties to return
 * @returns {Promise<Array>} Array of real property listings
 */
export async function scrapeRedfinListings(stateCode, stateName, limit = 20) {
  let browser = null;

  try {
    console.log(`[RedfinScraper] Starting browser to scrape ${stateName}...`);

    // Launch browser in headless mode
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Use direct search URL - this always works
    const stateLower = stateName.toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `https://www.redfin.com/${stateLower}/home-values`;
    console.log(`[RedfinScraper] Navigating to: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`[RedfinScraper] Page loaded, waiting for content...`);

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take a screenshot for debugging (optional)
    // await page.screenshot({ path: 'redfin-debug.png', fullPage: true });

    console.log(`[RedfinScraper] Page ready, extracting property data...`);

    // First, check what's actually on the page
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        homeLinksCount: document.querySelectorAll('a[href*="/home/"]').length,
        bodyText: document.body ? document.body.textContent.substring(0, 500) : 'No body'
      };
    });

    console.log('[RedfinScraper] Page info:', pageInfo);

    // Extract property data from the page
    const properties = await page.evaluate((maxProperties) => {
      const results = [];

      // Try multiple selector patterns that Redfin might use
      const cardSelectors = [
        'div[class*="MapHomeCardReact"]',  // Newer Redfin structure
        'div[class*="HomeCard"]',
        'div[data-rf-test-id="home-card"]',
        '[data-rf-test-id="property-card"]',
        '.property-card',
        '[class*="home-card"]',
        'div[class*="bottomV2"]'  // Alternative structure
      ];

      let cards = [];
      for (const selector of cardSelectors) {
        cards = document.querySelectorAll(selector);
        if (cards.length > 0) {
          console.log(`Found ${cards.length} properties with selector: ${selector}`);
          break;
        }
      }

      // If no cards found with specific selectors, try finding all links to /home/
      if (cards.length === 0) {
        console.log('No card elements found, trying to find property links...');
        const homeLinks = document.querySelectorAll('a[href*="/home/"]');
        console.log(`Found ${homeLinks.length} property links`);

        if (homeLinks.length > 0) {
          // Group links by unique property (same parent container)
          const uniqueProperties = new Map();
          homeLinks.forEach(link => {
            // Try to find a reasonable container
            let container = link.closest('div[class*="card"], div[data-rf], article, li');
            if (!container) {
              // If no specific container, use a few levels up
              container = link.parentElement?.parentElement || link.parentElement;
            }
            if (container && !uniqueProperties.has(container)) {
              uniqueProperties.set(container, container);
            }
          });
          cards = Array.from(uniqueProperties.values());
          console.log(`Extracted ${cards.length} unique property containers`);
        }
      }

      console.log(`Total cards to process: ${cards.length}`);

      for (let i = 0; i < Math.min(cards.length, maxProperties); i++) {
        const card = cards[i];

        try {
          // Get all text content from the card
          const allText = card.textContent;

          // Extract property URL first (most reliable)
          const linkEl = card.querySelector('a[href*="/home/"]');
          const url = linkEl ? linkEl.href : null;

          // Extract address - try multiple methods
          let address = '';

          // Priority 1: Specific Redfin address selectors (most reliable)
          const addressSelectors = [
            '[data-rf-test-id="homecard-address"]',
            '[data-rf-test-id="abp-homecard-address"]',
            '[data-testid="homecard-address"]',
            '[data-testid="address"]',
            '.homecard-address',
            '.HomeCardAddress',
            '.homecardV2Address',
            '.streetAddress',
            '.street-address',
            '[itemprop="streetAddress"]',
            // Generic selectors last
            '[class*="Address"]:not(nav *):not(footer *)',
            '[class*="address"]:not(nav *):not(footer *)',
            '.address:not(nav *):not(footer *)'
          ];

          for (const selector of addressSelectors) {
            try {
              const el = card.querySelector(selector);
              if (el && el.textContent.trim()) {
                const text = el.textContent.trim();
                // Validate it looks like an address (starts with number)
                if (/^\d+\s+[A-Za-z]/.test(text)) {
                  address = text;
                  break;
                }
              }
            } catch (e) {
              // Skip invalid selectors
            }
          }

          // Priority 2: Comprehensive regex fallback with all street suffixes
          if (!address && allText) {
            // Full regex with all common street suffixes
            const comprehensiveMatch = allText.match(/\d+\s+[A-Za-z0-9\s.'-]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr(?:ive)?|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Pl(?:ace)?|Ter(?:race)?|Pkwy|Parkway|Cir(?:cle)?|Trl|Trail|Hwy|Highway|Loop|Run|Path|Pass|Cove|Cv|Sq(?:uare)?|Crst|Crest|Xing|Crossing|Aly|Alley|Commons|Cmn|Ests|Estates|Gdns|Gardens|Grv|Grove|Hts|Heights|Holw|Hollow|Jct|Junction|Knl|Knoll|Lk|Lake|Ldg|Lodge|Mdw|Meadow|Mews|Mnr|Manor|Mtn|Mountain|Orch|Orchard|Ovlk|Overlook|Park|Pt|Point|Rdg|Ridge|Row|Shr|Shore|Spg|Spring|Sta|Station|Vis|Vista|Walk|Wlk|Woods)[.,]?\s*(?:[A-Za-z\s]+,\s*)?(?:[A-Z]{2}\s*\d{5})?/i);
            if (comprehensiveMatch) {
              address = comprehensiveMatch[0].trim().replace(/[,.]$/, '');
            }
          }

          // Priority 3: Simpler fallback regex
          if (!address && allText) {
            const simpleMatch = allText.match(/\d+\s+[A-Za-z0-9\s.'-]{3,40}(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Ter|Pkwy|Cir|Trl|Hwy|Loop|Run|Cove|Sq)[.,\s]/i);
            if (simpleMatch) {
              address = simpleMatch[0].trim().replace(/[,.\s]$/, '');
            }
          }

          // Extract price from text
          const priceMatch = allText.match(/\$\s*([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

          // Extract beds
          const bedsMatch = allText.match(/(\d+)\s*bed/i);
          const beds = bedsMatch ? parseInt(bedsMatch[1]) : null;

          // Extract baths
          const bathsMatch = allText.match(/([\d.]+)\s*bath/i);
          const baths = bathsMatch ? parseFloat(bathsMatch[1]) : null;

          // Extract square footage
          const sqftMatch = allText.match(/([\d,]+)\s*sq\.?\s*ft/i);
          const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null;

          // Extract property type
          const typeMatch = allText.match(/(House|Condo|Townhouse|Multi-Family|Land|Other)/i);
          const propertyType = typeMatch ? typeMatch[1] : null;

          // Only include if we have at least a URL or address
          if (url || address) {
            results.push({
              fullAddress: address || 'Address not found',
              price: price,
              priceText: price ? `$${price.toLocaleString()}` : null,
              beds: beds,
              bedsText: beds ? `${beds} bed${beds !== 1 ? 's' : ''}` : null,
              baths: baths,
              bathsText: baths ? `${baths} bath${baths !== 1 ? 's' : ''}` : null,
              sqft: sqft,
              sqftText: sqft ? `${sqft.toLocaleString()} sqft` : null,
              url: url,
              propertyType: propertyType,
              status: 'active' // All scraped properties are active for sale
            });
          }
        } catch (err) {
          console.error('Error extracting property data:', err.message);
        }
      }

      return results;
    }, limit);

    console.log(`[RedfinScraper] Successfully extracted ${properties.length} properties`);

    // Add metadata
    const enrichedProperties = properties.map((prop, i) => ({
      ...prop,
      vendor: 'redfin',
      extractedAt: new Date().toISOString(),
      sourceIndex: i,
      state: stateCode,
      // Extract state from address if not present
      city: extractCityFromAddress(prop.fullAddress)
    }));

    await browser.close();
    return enrichedProperties;

  } catch (error) {
    console.error(`[RedfinScraper] Error scraping Redfin:`, error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('[RedfinScraper] Error closing browser:', closeErr.message);
      }
    }
    throw error;
  }
}

/**
 * Extract city name from full address
 * @param {string} address - Full address string
 * @returns {string} City name
 */
function extractCityFromAddress(address) {
  try {
    // Address format: "123 Main St, City Name, STATE ZIP"
    const parts = address.split(',');
    if (parts.length >= 2) {
      return parts[1].trim();
    }
    return '';
  } catch (err) {
    return '';
  }
}

/**
 * Test function to verify scraping works
 */
export async function testScraper() {
  console.log('Testing Redfin web scraper...\n');

  try {
    const properties = await scrapeRedfinListings('NJ', 'New Jersey', 5);
    console.log(`\nSuccessfully scraped ${properties.length} properties:`);
    properties.forEach((prop, i) => {
      console.log(`\n${i + 1}. ${prop.fullAddress}`);
      console.log(`   Price: ${prop.priceText}`);
      console.log(`   ${prop.bedsText}, ${prop.bathsText}, ${prop.sqftText}`);
      console.log(`   URL: ${prop.url}`);
    });
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}
