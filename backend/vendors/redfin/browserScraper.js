// Browser-based Redfin scraper using Puppeteer
// This bypasses the broken Stingray API by scraping the actual website

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Helper function to wait (replaces deprecated waitForTimeout)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// State code to name mapping for all 50 states + DC
const STATE_NAMES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
};

// Cache for city lookups to avoid repeated API calls
const cityIdCache = new Map();

/**
 * Dynamically look up city ID using Redfin's autocomplete API
 * This works for ANY city in the US
 */
async function lookupCityId(cityName, stateCode) {
  const cacheKey = `${cityName.toLowerCase()}-${stateCode.toUpperCase()}`;

  // Check cache first
  if (cityIdCache.has(cacheKey)) {
    console.log(`[RedfinBrowser] Using cached city ID for ${cityName}, ${stateCode}`);
    return cityIdCache.get(cacheKey);
  }

  try {
    const url = 'https://www.redfin.com/stingray/do/location-autocomplete';
    const searchTerm = `${cityName}, ${stateCode}`;

    console.log(`[RedfinBrowser] Looking up city ID for: ${searchTerm}`);

    const response = await axios.get(url, {
      params: { location: searchTerm, v: '2' },
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 10000
    });

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const payload = data.payload || data;
    const sections = payload.sections || [];

    // Find city-level region (type 2 = City)
    for (const section of sections) {
      const rows = section.rows || [];
      for (const row of rows) {
        if (row.type == 2 || row.type === '2') {
          const regionId = row.id.split('_')[1];
          const citySlug = row.name.replace(/,.*$/, '').trim().replace(/\s+/g, '-');

          const result = {
            id: regionId,
            name: citySlug,
            display: row.name,
            url: row.url
          };

          console.log(`[RedfinBrowser] Found city: ${row.name} (ID: ${regionId})`);

          // Cache the result
          cityIdCache.set(cacheKey, result);
          return result;
        }
      }
    }

    console.log(`[RedfinBrowser] No city found for ${searchTerm}`);
    return null;
  } catch (error) {
    console.error(`[RedfinBrowser] Error looking up city ${cityName}:`, error.message);
    return null;
  }
}

/**
 * Look up state capital or largest city as fallback
 */
const STATE_DEFAULT_CITIES = {
  'AL': 'Birmingham', 'AK': 'Anchorage', 'AZ': 'Phoenix', 'AR': 'Little Rock',
  'CA': 'Los Angeles', 'CO': 'Denver', 'CT': 'Hartford', 'DE': 'Wilmington',
  'FL': 'Miami', 'GA': 'Atlanta', 'HI': 'Honolulu', 'ID': 'Boise',
  'IL': 'Chicago', 'IN': 'Indianapolis', 'IA': 'Des Moines', 'KS': 'Wichita',
  'KY': 'Louisville', 'LA': 'New Orleans', 'ME': 'Portland', 'MD': 'Baltimore',
  'MA': 'Boston', 'MI': 'Detroit', 'MN': 'Minneapolis', 'MS': 'Jackson',
  'MO': 'Kansas City', 'MT': 'Billings', 'NE': 'Omaha', 'NV': 'Las Vegas',
  'NH': 'Manchester', 'NJ': 'Newark', 'NM': 'Albuquerque', 'NY': 'New York',
  'NC': 'Charlotte', 'ND': 'Fargo', 'OH': 'Columbus', 'OK': 'Oklahoma City',
  'OR': 'Portland', 'PA': 'Philadelphia', 'RI': 'Providence', 'SC': 'Charleston',
  'SD': 'Sioux Falls', 'TN': 'Nashville', 'TX': 'Houston', 'UT': 'Salt Lake City',
  'VT': 'Burlington', 'VA': 'Virginia Beach', 'WA': 'Seattle', 'WV': 'Charleston',
  'WI': 'Milwaukee', 'WY': 'Cheyenne', 'DC': 'Washington'
};

/**
 * Build Redfin search URL with filters - DYNAMIC for any city
 */
async function buildRedfinUrl(stateCode, city = '') {
  const state = stateCode.toUpperCase();
  const filters = 'filter/property-type=house,min-price=50k,max-price=500k,min-beds=3,min-sqft=1k-sqft,hoa=0';

  // If city is provided, look it up dynamically
  if (city && city.trim()) {
    const cityInfo = await lookupCityId(city.trim(), state);
    if (cityInfo) {
      return `https://www.redfin.com/city/${cityInfo.id}/${state}/${cityInfo.name}/${filters}`;
    }
  }

  // If no city provided or lookup failed, use state's default city
  const defaultCity = STATE_DEFAULT_CITIES[state];
  if (defaultCity) {
    const cityInfo = await lookupCityId(defaultCity, state);
    if (cityInfo) {
      console.log(`[RedfinBrowser] Using default city for ${state}: ${defaultCity}`);
      return `https://www.redfin.com/city/${cityInfo.id}/${state}/${cityInfo.name}/${filters}`;
    }
  }

  // Last fallback: state-level search (may have issues but try anyway)
  const stateName = STATE_NAMES[state];
  if (stateName) {
    const stateSlug = stateName.replace(/\s+/g, '-');
    console.log(`[RedfinBrowser] Falling back to state-level search for ${stateName}`);
    return `https://www.redfin.com/state/${stateSlug}/${filters}`;
  }

  throw new Error(`Invalid state code: ${stateCode}`);
}

/**
 * Scrape property listings from Redfin using Puppeteer
 * @param {string} stateCode - State code (e.g., 'NC', 'CA')
 * @param {string} city - Optional city name
 * @param {number} limit - Maximum number of properties to return
 * @param {Object} options - Additional options
 * @param {boolean} options.includeAgent - Whether to extract agent details (slower)
 */
export async function scrapeRedfinListings(stateCode, city = '', limit = 20, options = {}) {
  let browser = null;

  try {
    console.log(`[RedfinBrowser] Starting browser scrape for ${city || stateCode}...`);

    // Launch browser with stealth mode
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
    await page.setUserAgent(USER_AGENT);

    // Build URL with filters (now async for dynamic lookup)
    const url = await buildRedfinUrl(stateCode, city);
    console.log(`[RedfinBrowser] Navigating to: ${url}`);

    // Navigate to the page
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for listings to load
    console.log(`[RedfinBrowser] Waiting for listings to load...`);

    try {
      // Wait for property cards to appear
      await page.waitForSelector('[data-rf-test-id="photo-card"], .HomeCardContainer, .HomeCard, .MapHomeCard', {
        timeout: 15000
      });
    } catch (e) {
      console.log(`[RedfinBrowser] No standard selectors found, trying alternative approach...`);
    }

    // Additional wait for dynamic content
    await sleep(3000);

    // Scroll to load more listings
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });

    await sleep(2000);

    // Extract property data from the page
    const properties = await page.evaluate((stateCode, limit) => {
      const results = [];

      // Use the selectors that work: .HomeCardContainer or .bp-Homecard
      let cards = document.querySelectorAll('.HomeCardContainer');
      if (cards.length === 0) {
        cards = document.querySelectorAll('.bp-Homecard');
      }
      if (cards.length === 0) {
        cards = document.querySelectorAll('.MapHomeCard');
      }

      console.log(`Found ${cards.length} property cards`);

      // Extract data from DOM cards
      cards.forEach((card, index) => {
        if (results.length >= limit) return;

        try {
          // Get all text content for parsing
          const cardText = card.textContent || '';

          // Find the link to get URL and address
          const linkEl = card.querySelector('a[href*="/"]');
          let url = linkEl ? linkEl.href : null;

          // Address - try multiple approaches
          let fullAddress = '';
          const addressEl = card.querySelector('.bp-Homecard__Address, .homeAddressV2, [class*="Address"]');
          if (addressEl) {
            fullAddress = addressEl.textContent.trim();
          }

          // If no address found, try to extract from URL
          if (!fullAddress && url) {
            // URL format: /CA/San-Francisco/123-Main-St-94102/home/12345
            const urlMatch = url.match(/\/([A-Z]{2})\/([^\/]+)\/([^\/]+)\/home/);
            if (urlMatch) {
              const street = urlMatch[3].replace(/-/g, ' ').replace(/\d{5}$/, '').trim();
              const city = urlMatch[2].replace(/-/g, ' ');
              fullAddress = `${street}, ${city}, ${urlMatch[1]}`;
            }
          }

          // Price - look for dollar amounts
          let price = null;
          let priceText = '';
          const priceEl = card.querySelector('.bp-Homecard__Price, [class*="Price"]:not([class*="PriceChange"])');
          if (priceEl) {
            priceText = priceEl.textContent.trim();
            // Extract just the price number
            const priceNumMatch = priceText.match(/\$[\d,]+/);
            if (priceNumMatch) {
              price = parseInt(priceNumMatch[0].replace(/[^0-9]/g, ''));
            }
          }
          // Fallback: try regex on card text (first dollar amount only)
          if (!price) {
            const priceMatch = cardText.match(/\$[\d,]+/);
            if (priceMatch) {
              priceText = priceText || priceMatch[0];
              price = parseInt(priceMatch[0].replace(/[^0-9]/g, ''));
            }
          }

          // Stats - beds, baths, sqft - look for stats element first
          let beds = null, baths = null, sqft = null;

          const statsEl = card.querySelector('.bp-Homecard__Stats, [class*="Stats"]');
          const statsText = statsEl ? statsEl.textContent : cardText;

          // More specific patterns to avoid false matches
          const bedsMatch = statsText.match(/(\d+)\s*(?:bed|Bed|BD)/i);
          const bathsMatch = statsText.match(/(\d+(?:\.\d+)?)\s*(?:bath|Bath|BA)/i);
          const sqftMatch = statsText.match(/([\d,]+)\s*(?:sq\s*ft|Sq\.\s*Ft|sqft|SF)(?!\w)/i);

          beds = bedsMatch ? parseInt(bedsMatch[1]) : null;
          baths = bathsMatch ? parseFloat(bathsMatch[1]) : null;
          sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null;

          // Only add if we have meaningful data
          if (price || fullAddress) {
            results.push({
              fullAddress: fullAddress || 'Address not available',
              vendor: 'redfin',
              extractedAt: new Date().toISOString(),
              sourceIndex: index,
              url: url,
              state: stateCode,
              city: '',
              price: price,
              priceText: priceText || (price ? `$${price.toLocaleString()}` : null),
              beds: beds,
              bedsText: beds ? `${beds} bed${beds !== 1 ? 's' : ''}` : null,
              baths: baths,
              bathsText: baths ? `${baths} bath${baths !== 1 ? 's' : ''}` : null,
              sqft: sqft,
              sqftText: sqft ? `${sqft.toLocaleString()} sqft` : null,
              propertyType: 'Single Family',
              hoa: 'No',
              hoaText: 'No HOA',
              status: 'active'
            });
          }
        } catch (err) {
          console.error('Error extracting card data:', err);
        }
      });

      return results;
    }, stateCode, limit);

    console.log(`[RedfinBrowser] Extracted ${properties.length} properties`);

    // Close browser
    await browser.close();
    browser = null;

    // Extract agent details if requested
    if (options.includeAgent && properties.length > 0) {
      console.log(`[RedfinBrowser] Extracting agent details for ${properties.length} properties...`);
      const { extractAgentDetailsForProperties } = await import('./agentExtractor.js');
      const propertiesWithAgents = await extractAgentDetailsForProperties(properties, {
        maxConcurrent: 2,
        delay: 3000
      });
      return propertiesWithAgents;
    }

    return properties;

  } catch (error) {
    console.error(`[RedfinBrowser] Scraping failed:`, error.message);

    if (browser) {
      try { await browser.close(); } catch {}
    }

    throw error;
  }
}

/**
 * Alternative: Extract data from Redfin's embedded JSON
 * @param {string} stateCode - State code (e.g., 'NC', 'CA')
 * @param {string} city - Optional city name
 * @param {number} limit - Maximum number of properties to return
 * @param {Object} options - Additional options
 * @param {boolean} options.includeAgent - Whether to extract agent details (slower)
 */
export async function scrapeRedfinWithJson(stateCode, city = '', limit = 20, options = {}) {
  let browser = null;

  try {
    console.log(`[RedfinBrowser] Starting JSON extraction for ${city || stateCode}...`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // Intercept network requests to capture API responses
    const apiResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/stingray/api/gis') || url.includes('/api/home')) {
        try {
          const text = await response.text();
          apiResponses.push({ url, text });
        } catch {}
      }
    });

    // Build URL (now async for dynamic lookup)
    const url = await buildRedfinUrl(stateCode, city);
    console.log(`[RedfinBrowser] Navigating to: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000);

    // Try to extract from captured API responses
    for (const resp of apiResponses) {
      try {
        let data = resp.text;
        if (data.startsWith('{}&&')) {
          data = data.substring(4);
        }
        const json = JSON.parse(data);
        const homes = json.payload?.homes || [];

        if (homes.length > 0) {
          console.log(`[RedfinBrowser] Found ${homes.length} homes in API response`);

          const properties = homes.slice(0, limit).map((home, i) => ({
            fullAddress: [
              home.streetLine?.value || home.streetLine || '',
              home.city?.value || home.city || '',
              home.state?.value || home.state || stateCode,
              home.zip?.value || home.zip || home.postalCode?.value || ''
            ].filter(Boolean).join(', '),
            vendor: 'redfin',
            extractedAt: new Date().toISOString(),
            sourceIndex: i,
            url: home.url ? `https://www.redfin.com${home.url}` : null,
            state: home.state?.value || home.state || stateCode,
            city: home.city?.value || home.city || '',
            price: home.price?.value || home.price || null,
            priceText: home.price?.value ? `$${home.price.value.toLocaleString()}` : null,
            beds: home.beds || null,
            bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
            baths: home.baths || null,
            bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
            sqft: home.sqFt?.value || home.sqFt || null,
            sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
            propertyType: home.propertyType || 'Single Family',
            listingId: home.listingId || null,
            mlsId: home.mlsId?.value || null,
            yearBuilt: home.yearBuilt?.value || null,
            daysOnMarket: home.dom?.value || null,
            latitude: home.latLong?.value?.latitude || null,
            longitude: home.latLong?.value?.longitude || null,
            hoa: 'No',
            hoaText: 'No HOA',
            status: 'active'
          }));

          await browser.close();
          return properties;
        }
      } catch {}
    }

    // Fallback to DOM scraping
    console.log(`[RedfinBrowser] No API data captured, falling back to DOM scraping`);
    await browser.close();
    browser = null;

    return scrapeRedfinListings(stateCode, city, limit);

  } catch (error) {
    console.error(`[RedfinBrowser] JSON extraction failed:`, error.message);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    throw error;
  }
}

export default { scrapeRedfinListings, scrapeRedfinWithJson, lookupCityId };
