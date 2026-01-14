/**
 * Agent Lookup API - Single address lookup for agent details from Privy
 * Uses direct browser control with loginToPrivy (handles OTP automatically)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import { initSharedBrowser } from '../utils/browser.js';
import { loginToPrivy } from '../vendors/privy/auth/loginService.js';

const router = Router();
const L = log.child('agent-lookup');

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Shared page for agent lookup
let sharedPage = null;
let isLoggedIn = false;

/**
 * Extract agent details from a Privy property detail page
 */
async function extractAgentDetailsFromPage(page) {
  return await page.evaluate(() => {
    const result = { name: null, email: null, phone: null, brokerage: null };

    // Try to find "Agents and Offices" section first
    let pageText = null;

    // Find section headers
    const sectionHeaders = document.querySelectorAll('h2, h3, h4, .section-title, [class*="section-header"]');
    for (const header of sectionHeaders) {
      const headerText = header.innerText?.toLowerCase() || '';
      if (headerText.includes('agents') || headerText.includes('offices') || headerText.includes('listing agent')) {
        let section = header.parentElement;
        for (let i = 0; i < 3 && section; i++) {
          const sectionContent = section.innerText || '';
          if (sectionContent.includes('List Agent') || sectionContent.includes('List Office')) {
            pageText = sectionContent;
            break;
          }
          section = section.parentElement;
        }
        if (pageText) break;
      }
    }

    // Try detail panels
    if (!pageText) {
      const panelSelectors = [
        '.property-detail-drawer',
        '.property-details',
        '.detail-panel',
        '.drawer-content',
        '.modal-content',
        '[class*="PropertyDetail"]',
        '[class*="detail-drawer"]',
        '[class*="property-detail"]',
        '.right-panel',
        '[data-testid*="detail"]'
      ];

      for (const sel of panelSelectors) {
        const panel = document.querySelector(sel);
        if (panel && panel.innerText && panel.innerText.includes('List Agent')) {
          pageText = panel.innerText;
          break;
        }
      }
    }

    // Fallback to body if contains agent info
    if (!pageText) {
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('List Agent')) {
        pageText = bodyText;
      }
    }

    if (!pageText) {
      return result;
    }

    // Extract agent details using regex patterns

    // Phone - includes Mobile Phone pattern
    const phoneLabeled = pageText.match(/List\s+Agent\s+(?:Direct\s+|Preferred\s+|Mobile\s+)?Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
    if (phoneLabeled) {
      result.phone = phoneLabeled[1].trim();
    }
    if (!result.phone) {
      const officePhoneLabeled = pageText.match(/List\s+Office\s+Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
      if (officePhoneLabeled) {
        result.phone = officePhoneLabeled[1].trim();
      }
    }

    // Email
    const emailLabeled = pageText.match(/List\s+Agent\s+Email\s*[:\s]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailLabeled) {
      result.email = emailLabeled[1].trim();
    }
    if (!result.email) {
      const officeEmailLabeled = pageText.match(/List\s+Office\s+Email\s*[:\s]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (officeEmailLabeled) {
        result.email = officeEmailLabeled[1].trim();
      }
    }

    // Name
    const fullNameMatch = pageText.match(/List\s+Agent\s+Full\s+Name\s*[:\s]\s*([^\n]+)/i);
    if (fullNameMatch) {
      let extractedName = fullNameMatch[1].trim();
      extractedName = extractedName.split(/(?:List Agent|Direct Phone|Email|Office)/i)[0].trim();
      if (extractedName.length > 3) {
        result.name = extractedName;
      }
    }

    if (!result.name) {
      const firstMatch = pageText.match(/List\s+Agent\s+First\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
      const lastMatch = pageText.match(/List\s+Agent\s+Last\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
      if (firstMatch && lastMatch) {
        result.name = `${firstMatch[1].trim()} ${lastMatch[1].trim()}`;
      }
    }

    // Brokerage
    const officeNameMatch = pageText.match(/List\s+Office\s+Name\s*[:\s]\s*([^\n]+)/i);
    if (officeNameMatch) {
      let officeName = officeNameMatch[1].trim();
      officeName = officeName.split(/(?:List Agent|List Office Phone|Direct Phone|Email)/i)[0].trim();
      if (officeName.length > 2) {
        result.brokerage = officeName;
        if (!result.name) {
          result.name = officeName;
        }
      }
    }

    return result;
  });
}

/**
 * Initialize or get shared page for Privy
 */
async function getPrivyPage() {
  // Check if existing page is healthy
  if (sharedPage) {
    try {
      await sharedPage.evaluate(() => document.readyState);
      return sharedPage;
    } catch (e) {
      L.warn('Shared page unhealthy, recreating...');
      sharedPage = null;
      isLoggedIn = false;
    }
  }

  // Initialize shared browser
  L.info('Initializing shared browser...');
  const browser = await initSharedBrowser();

  // Create new page
  L.info('Creating new page...');
  sharedPage = await browser.newPage();
  await sharedPage.setViewport({ width: 1920, height: 1080 });

  // Navigate to Privy sign-in page first (this creates the page context)
  L.info('Navigating to Privy sign-in...');
  await sharedPage.goto('https://app.privy.pro/users/sign_in', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  // Now login (handles OTP automatically via email)
  L.info('Logging in to Privy (with auto OTP)...');
  const loginResult = await loginToPrivy(sharedPage);

  if (!loginResult) {
    throw new Error('Failed to login to Privy');
  }

  isLoggedIn = true;
  L.info('Successfully logged in to Privy');

  // Navigate to clean dashboard URL (no filters)
  L.info('Navigating to clean dashboard...');
  await sharedPage.goto('https://app.privy.pro/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  return sharedPage;
}

/**
 * Search for address and extract agent details
 */
async function lookupAddressAgent(page, address) {
  L.info(`Searching for address: ${address}`);

  // Always navigate to clean dashboard first before each search
  L.info('Navigating to clean dashboard before search...');
  await page.goto('https://app.privy.pro/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  // Find the search input
  const searchSelectors = [
    'input[name="search_text"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="address"]',
    '#search_text',
    '.search-input input',
    '[data-testid="search-input"]'
  ];

  let searchInput = null;
  for (const sel of searchSelectors) {
    searchInput = await page.$(sel);
    if (searchInput) {
      L.info(`Found search input with selector: ${sel}`);
      break;
    }
  }

  if (!searchInput) {
    throw new Error('Could not find search input on Privy dashboard');
  }

  // Clear and type the address
  await searchInput.click({ clickCount: 3 }); // Select all
  await page.keyboard.press('Backspace'); // Clear
  await searchInput.type(address, { delay: 50 });
  L.info('Typed address in search box');

  // Wait a moment for autocomplete dropdown to appear
  await sleep(1500);

  // Press Enter to search
  await page.keyboard.press('Enter');
  L.info('Pressed Enter to search');

  // Wait for results to load - use smart waiting
  L.info('Waiting for search results to load...');

  // Try to wait for property cards to appear
  try {
    await page.waitForFunction(() => {
      const noSkeleton = !document.querySelector('.skeleton, .loading, [aria-busy="true"]');
      const hasCard = document.querySelector(
        'div .property-module .content, .property-card, [data-testid="property-card"], [class*="PropertyListItem"]'
      );
      return noSkeleton && hasCard;
    }, { timeout: 15000 });
    L.info('Property cards detected');
  } catch (e) {
    L.warn('Timeout waiting for property cards, continuing anyway...');
  }

  // Additional wait for any lazy loading
  await sleep(2000);

  // Look for property card matching the address
  const streetNum = address.split(/\s+/)[0];
  const streetNameParts = address.split(',')[0].toLowerCase().replace(/^\d+\s*/, '').trim();

  L.info(`Looking for property with street number: ${streetNum}, street: ${streetNameParts}`);

  // Find and click on the matching property card
  const cardClicked = await page.evaluate((streetNum, streetNameParts) => {
    // Helper to check if text contains the street number at a word boundary
    const containsStreetNum = (text, num) => {
      if (!text || !num) return false;
      const numPattern = new RegExp('(^|\\s)' + num + '\\s', 'i');
      return numPattern.test(text);
    };

    // Use the same selectors as v1.js scraper - order matters!
    const cardSelectors = [
      'div .property-module .content',  // Primary selector from Privy
      '.property-card',
      '[data-testid="property-card"]',
      '[class*="PropertyListItem"]',
      '[class*="property-card"]',
      '[class*="listing-card"]',
      '.result-card',
      '.content a'  // Fallback from openDetailSelector
    ];

    let cards = [];
    let usedSelector = '';
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = found;
        usedSelector = sel;
        console.log('Found cards with selector:', sel, 'count:', found.length);
        break;
      }
    }

    if (cards.length === 0) {
      // Debug: log what elements exist on the page
      const viewContainer = document.querySelector('.view-container, .grid-view-container');
      const anyModule = document.querySelector('.property-module');
      console.log('Debug: viewContainer exists:', !!viewContainer, 'anyModule exists:', !!anyModule);
      console.log('No cards found with any selector');
      return { clicked: false, matched: false, debug: 'no_cards', hasViewContainer: !!viewContainer, hasModule: !!anyModule };
    }

    for (const card of cards) {
      const cardText = card.innerText || card.textContent || '';
      const cardTextLower = cardText.toLowerCase();

      // Check if this card matches our address - use street number with word boundary
      if (containsStreetNum(cardText, streetNum) && cardTextLower.includes(streetNameParts.substring(0, 10))) {
        card.click();
        return { clicked: true, matched: true, usedSelector, cardCount: cards.length };
      }
    }

    // Try clicking the first result if no exact match
    if (cards.length > 0) {
      cards[0].click();
      return { clicked: true, matched: false, cardCount: cards.length, usedSelector };
    }

    return { clicked: false, matched: false, usedSelector };
  }, streetNum, streetNameParts);

  L.info('Card click result:', cardClicked);

  if (!cardClicked.clicked) {
    // SCREENSHOTS DISABLED - uncomment to re-enable
    // try {
    //   const screenshotPath = `C:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/debug-no-cards-${Date.now()}.png`;
    //   await page.screenshot({ path: screenshotPath, fullPage: false });
    //   L.warn(`No property card found for the address. Screenshot saved: ${screenshotPath}`);
    // } catch (e) {
    //   L.warn('No property card found and could not save screenshot');
    // }
    L.warn('No property card found for the address');
    return { ok: false, error: 'Property not found in Privy' };
  }

  L.info(`Property card clicked (exact match: ${cardClicked.matched}), waiting for details...`);
  await sleep(5000);

  // Extract agent details from the detail view
  const agentDetails = await extractAgentDetailsFromPage(page);
  L.info('Agent details extracted', agentDetails);

  return {
    ok: true,
    agent: agentDetails,
    hasData: !!(agentDetails.name || agentDetails.phone || agentDetails.email)
  };
}

/**
 * GET /api/agent-lookup/lookup
 * Look up agent details for a single address (no auth for testing)
 * Query: ?address=123 Main St, City, ST 12345
 */
router.get('/lookup', async (req, res) => {
  const { address } = req.query;

  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ ok: false, error: 'Address query param is required' });
  }

  const cleanAddress = address.trim();
  L.info(`Agent lookup requested for: ${cleanAddress}`);

  try {
    // Get or create Privy page (handles login)
    const page = await getPrivyPage();

    // Search for address and extract agent details
    const result = await lookupAddressAgent(page, cleanAddress);

    if (!result.ok) {
      return res.json({
        ok: false,
        error: result.error,
        address: cleanAddress
      });
    }

    return res.json({
      ok: true,
      address: cleanAddress,
      agent: result.agent,
      hasData: result.hasData
    });

  } catch (error) {
    L.error(`Agent lookup failed: ${error.message}`);

    // Reset shared page on error
    sharedPage = null;
    isLoggedIn = false;

    return res.status(500).json({
      ok: false,
      error: error.message,
      address: cleanAddress
    });
  }
});

/**
 * POST /api/agent-lookup
 * Look up agent details for a single address (requires auth)
 * Body: { address: string }
 */
router.post('/', requireAuth, async (req, res) => {
  const { address } = req.body;

  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ ok: false, error: 'Address is required' });
  }

  const cleanAddress = address.trim();
  L.info(`Agent lookup requested for: ${cleanAddress}`);

  try {
    // Get or create Privy page (handles login)
    const page = await getPrivyPage();

    // Search for address and extract agent details
    const result = await lookupAddressAgent(page, cleanAddress);

    if (!result.ok) {
      return res.json({
        ok: false,
        error: result.error,
        address: cleanAddress
      });
    }

    return res.json({
      ok: true,
      address: cleanAddress,
      agent: result.agent,
      hasData: result.hasData
    });

  } catch (error) {
    L.error(`Agent lookup failed: ${error.message}`);

    // Reset shared page on error
    sharedPage = null;
    isLoggedIn = false;

    return res.status(500).json({
      ok: false,
      error: error.message,
      address: cleanAddress
    });
  }
});

/**
 * GET /api/agent-lookup/test
 * Test endpoint to check if agent lookup is working
 */
router.get('/test', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    message: 'Agent lookup endpoint is ready',
    usage: 'GET /api/agent-lookup/lookup?address=123 Main St, City, ST 12345'
  });
});

// Export functions for use in other modules (e.g., scraped-deals.js)
export { getPrivyPage, lookupAddressAgent };

export default router;
