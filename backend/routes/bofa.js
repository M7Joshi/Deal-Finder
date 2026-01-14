// routes/bofa.js
// Live BofA home value lookup API endpoint

import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import { ensureVendorPageSetup } from '../utils/browser.js';
import { normalizeStreetAddress } from '../utils/normalize.js';
import { getVendorProxyPool, toProxyArg } from '../utils/proxyBuilder.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

puppeteer.use(StealthPlugin());

// Auto-detect Chrome executable path based on platform
function getDefaultChromePath() {
  const platform = os.platform();

  if (platform === 'win32') {
    // Common Windows Chrome paths
    const possiblePaths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    // macOS
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macPath)) return macPath;
  } else {
    // Linux
    const linuxPaths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Fallback - let puppeteer try to find it
  return null;
}

// Get Chrome path (cached)
const CHROME_PATH = getDefaultChromePath();

// Maximum retry attempts for browser launch failures
const BROWSER_LAUNCH_MAX_RETRIES = 3;
const BROWSER_LAUNCH_RETRY_DELAY_MS = 1000;

// Log Chrome path on first use
let chromePathLogged = false;

const router = express.Router();
const L = log.child('bofa-lookup');

// BofA website URL
const BOFA_URL = 'https://homevaluerealestatecenter.bankofamerica.com/';

// Proxy pool and round-robin index
let proxyPool = [];
let proxyIndex = 0;
const deadProxies = new Set(); // Track temporarily dead proxies
const PROXY_COOLDOWN_MS = 120000; // 2 minute cooldown for dead proxies

// Check if direct mode is enabled (bypass proxy)
function isDirectMode() {
  const mode = (process.env.BOFA_PROXY_MODE || '').toLowerCase();
  const usePaid = process.env.BOFA_USE_PAID;
  return mode === 'direct' || mode === 'off' || mode === 'none' || usePaid === '0' || usePaid === 'false';
}

// Initialize proxy pool (lazy load)
function getNextProxy() {
  // Check for direct mode first
  if (isDirectMode()) {
    L.info('Direct mode enabled, skipping proxy');
    return null;
  }

  if (proxyPool.length === 0) {
    try {
      proxyPool = getVendorProxyPool('bofa');
      L.info('Loaded BofA proxy pool', { count: proxyPool.length });
    } catch (err) {
      L.warn('No BofA proxy pool configured, running without proxy', { error: err.message });
      return null;
    }
  }
  if (proxyPool.length === 0) return null;

  // Try to find a healthy proxy (skip dead ones)
  const startIndex = proxyIndex;
  let attempts = 0;
  while (attempts < proxyPool.length) {
    const entry = proxyPool[proxyIndex % proxyPool.length];
    proxyIndex++;
    attempts++;

    const proxyArg = toProxyArg(entry);
    const proxyKey = proxyArg?.host + ':' + proxyArg?.port;

    // Skip if this proxy is marked dead
    if (proxyKey && deadProxies.has(proxyKey)) {
      continue;
    }

    return proxyArg;
  }

  // All proxies are dead, clear the dead list and try anyway
  L.warn('All proxies marked dead, clearing dead list and retrying');
  deadProxies.clear();
  const entry = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  return toProxyArg(entry);
}

// Mark a proxy as temporarily dead
function markProxyDead(proxy) {
  if (!proxy) return;
  const key = proxy.host + ':' + proxy.port;
  deadProxies.add(key);
  L.warn('Marked proxy as dead', { proxy: key });

  // Auto-revive after cooldown
  setTimeout(() => {
    deadProxies.delete(key);
    L.info('Revived proxy after cooldown', { proxy: key });
  }, PROXY_COOLDOWN_MS);
}

// Open browser with proxy support (with retry logic and Chrome path detection)
async function openBrowserWithProxy() {
  const proxy = getNextProxy();

  // Log Chrome path once at startup
  if (!chromePathLogged) {
    chromePathLogged = true;
    if (CHROME_PATH) {
      L.info(`Using Chrome at: ${CHROME_PATH}`);
    } else {
      L.info('No Chrome path found, using puppeteer bundled browser');
    }
  }

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--window-size=1366,768',
    '--lang=en-US,en;q=0.9',
  ];

  // Add proxy arg if available
  if (proxy?.arg) {
    args.push(proxy.arg);
    L.info('Launching browser with proxy', { host: proxy.host, port: proxy.port });
  }

  // Retry loop for browser launch failures
  let lastError = null;
  for (let attempt = 1; attempt <= BROWSER_LAUNCH_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        L.info(`Retry attempt ${attempt}/${BROWSER_LAUNCH_MAX_RETRIES} to launch browser...`);
        await new Promise(resolve => setTimeout(resolve, BROWSER_LAUNCH_RETRY_DELAY_MS));
      }

      const browser = await puppeteer.launch({
        // Only set executablePath if we have a valid path, otherwise let puppeteer use its bundled browser
        ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
        headless: 'shell',
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        args,
      });

      return { browser, proxy };
    } catch (error) {
      lastError = error;
      L.error(`Browser launch failed (attempt ${attempt}/${BROWSER_LAUNCH_MAX_RETRIES}):`, error.message);

      // If this is a "Failed to launch browser process" error and we have retries left, try again
      if (error.message?.includes('Failed to launch') && attempt < BROWSER_LAUNCH_MAX_RETRIES) {
        continue;
      }

      // For other errors or if max retries reached, throw
      if (attempt >= BROWSER_LAUNCH_MAX_RETRIES) {
        throw new Error(`Failed to launch browser after ${BROWSER_LAUNCH_MAX_RETRIES} attempts: ${error.message}`);
      }
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Failed to launch browser');
}

// Helper to parse dollar text to number
function parseDollarToNumber(text) {
  if (!text) return null;
  const n = String(text).replace(/[^\d.]/g, '');
  return n ? Math.round(Number(n)) : null;
}

// Helper to average two values
function averageTwo(textA, textB) {
  const a = parseDollarToNumber(textA);
  const b = parseDollarToNumber(textB);
  if (a == null || b == null) return null;
  return Math.round((a + b) / 2);
}

// Accept consent/cookie banners if present
async function acceptConsentIfPresent(page) {
  try {
    const btn = await page.$('#onetrust-accept-btn-handler, #onetrust-accept-all-handler');
    if (btn) await btn.click({ delay: 10 });
  } catch {}
  try {
    const [elt] = await page.$x("//button[contains(., 'Accept') or contains(., 'Agree') or contains(., 'I Accept') or contains(., 'Allow all') or contains(., 'Accept All')]");
    if (elt) await elt.click({ delay: 10 });
  } catch {}
}

// Wait for any results to appear (broader detection)
async function waitForResultsAny(page, { timeout = 40000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const seen = await page.evaluate(() => {
      const sel = '#section-comparables .hvt-comparables__avg-est, .hvt-estimate__value, [data-testid="estimated-home-value"]';
      if (document.querySelector(sel)) return true;
      // Also look for the labels themselves
      const textHit = !!Array.from(document.querySelectorAll('body *'))
        .slice(0, 5000)
        .find(n => /Average sale price|Estimated home value/i.test(n.textContent || ''));
      return textHit;
    }).catch(() => false);
    if (seen) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// Fallback scraper by label proximity when class names change
async function scrapeByLabelFallback(page) {
  try {
    const res = await page.evaluate(() => {
      const DOLLAR = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\*?/;
      const clean = (s) => (s || '').trim();
      function grab(labelRe) {
        const all = Array.from(document.querySelectorAll('body *')).slice(0, 6000);
        const label = all.find(n => labelRe.test((n.textContent || '').trim()));
        if (!label) return '';
        const container = label.closest('section,div,article,li') || label.parentElement;
        if (!container) return '';
        let node = Array.from(container.querySelectorAll('*')).find(n => DOLLAR.test((n.textContent || '').trim()));
        if (!node) node = document.querySelector('.hvt-estimate__value,[data-testid="estimated-home-value"]');
        return node ? clean(node.textContent) : '';
      }
      return {
        avgSaleText: grab(/Average sale price/i),
        estHomeText: grab(/Estimated home value/i),
      };
    });
    return res || { avgSaleText: '', estHomeText: '' };
  } catch {
    return { avgSaleText: '', estHomeText: '' };
  }
}

// Scrape BofA values from page (with fallback)
async function scrapeBofaValues(page) {
  // Try strict selector first
  const data = await page.evaluate(() => {
    const out = {};
    const root = document.querySelector('#section-comparables .hvt-comparables__avg-est');
    if (!root) return out;
    const items = root.querySelectorAll('dl .hvt-avg-est__item');
    items.forEach((item) => {
      const dt = item.querySelector('dt, .hvt-avg-est__label');
      const dd = item.querySelector('dd.hvt-avg-est__value');
      const label = dt?.textContent?.trim() || '';
      const value = dd?.textContent?.trim() || '';
      if (label) out[label] = value;
    });
    return out;
  });

  let avgSaleText = data['Average sale price'] || data['Average Sale Price'] || null;
  let estHomeText = data['Estimated home value'] || data['Estimated Home Value'] || null;

  // If strict selectors failed, use fallback
  if (!avgSaleText && !estHomeText) {
    const fb = await scrapeByLabelFallback(page);
    avgSaleText = fb.avgSaleText || avgSaleText;
    estHomeText = fb.estHomeText || estHomeText;
  }

  return { avgSaleText, estHomeText };
}

// Max retries for proxy failures
const MAX_PROXY_RETRIES = parseInt(process.env.BOFA_PROXY_RETRIES || '3', 10);

/**
 * Internal function to perform a single BofA lookup attempt
 */
async function performBofaLookup(cleanAddress) {
  let browser = null;
  let page = null;
  let usedProxy = null;

  try {
    // Open browser with proxy
    const { browser: br, proxy } = await openBrowserWithProxy();
    browser = br;
    usedProxy = proxy;
    page = await browser.newPage();

    // Authenticate with proxy if credentials provided
    if (proxy?.credentials) {
      await page.authenticate(proxy.credentials);
    }

    // Setup page with proper UA and settings
    await ensureVendorPageSetup(page, {
      randomizeUA: true,
      timeoutMs: 60000,
      jitterViewport: true
    });

    // Navigate to BofA Home Value page
    L.info('Navigating to BofA Home Value page...');
    await page.goto(BOFA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Accept cookie consent if present
    await acceptConsentIfPresent(page);

    // Wait for the address input to be available
    await page.waitForSelector('#address', { timeout: 30000 });
    L.info('Page loaded, entering address...');

    // Clear any existing input and type the address
    // Use triple-click to select all, then type to replace (more reliable on Windows)
    await page.click('#address', { clickCount: 3 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));

    // Focus the input again to ensure it's active
    await page.focus('#address').catch(() => {});
    await new Promise(r => setTimeout(r, 100));

    // Type the address (this will replace any selected text)
    await page.type('#address', cleanAddress, { delay: 25 });
    L.info('Typed address into input field', { address: cleanAddress });

    // Wait for autocomplete dropdown to appear - Google Places needs time
    L.info('Waiting for autocomplete suggestions...');
    await new Promise(r => setTimeout(r, 1500));

    // Try to click on the first autocomplete suggestion
    try {
      // Wait explicitly for Google Places autocomplete container to appear
      await page.waitForSelector('.pac-container', { timeout: 5000 }).catch(() => {});

      // Additional wait for items to populate
      await new Promise(r => setTimeout(r, 500));

      // Look for autocomplete suggestion items - BofA uses Google Places autocomplete
      const suggestionSelectors = [
        '.pac-container .pac-item:first-child',  // First Google Places item
        '.pac-item',                    // Google Places autocomplete item
        '.pac-container .pac-item',     // Google Places container
        '[class*="suggestion"]',        // Generic suggestion class
        '[class*="autocomplete"] li',   // Generic autocomplete list item
        '.MuiAutocomplete-option',      // MUI autocomplete
        '[role="option"]'               // ARIA role option
      ];

      let clicked = false;
      for (const selector of suggestionSelectors) {
        const items = await page.$$(selector);
        if (items.length > 0) {
          L.info(`Found autocomplete with selector: ${selector}, clicking first item (${items.length} items found)`);
          // Use evaluate to click to avoid detached element issues
          await page.evaluate((sel) => {
            const item = document.querySelector(sel);
            if (item) {
              item.click();
              return true;
            }
            return false;
          }, selector);
          clicked = true;
          // Wait for selection to register
          await new Promise(r => setTimeout(r, 500));
          break;
        }
      }

      if (!clicked) {
        // If no autocomplete found, try using keyboard navigation
        L.info('No autocomplete dropdown found, trying keyboard navigation');
        await page.keyboard.press('ArrowDown');
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.press('Enter');
      }
    } catch (autoErr) {
      L.warn('Autocomplete selection failed, pressing Enter directly', { error: autoErr.message });
      await page.keyboard.press('Enter');
    }

    // Wait a moment for the selection to register
    await new Promise(r => setTimeout(r, 300));

    // Wait for results to load (increased for proxy)
    L.info('Waiting for results...');
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 45000 }).catch(() => {});

    // Use broader result detection (checks multiple selectors and label text)
    const foundResults = await waitForResultsAny(page, { timeout: 45000 });

    if (!foundResults) {
      // SCREENSHOTS DISABLED - re-enable by uncommenting below
      // const errorPath = `./tmp/bofa_error_${Date.now()}.png`;
      // await page.screenshot({ path: errorPath, fullPage: true }).catch(() => {});
      L.warn('Results section not found');

      const pageContent = await page.content();

      // FIRST: Check if BofA shows "no data found" - return success with null/dash values
      // This must be checked BEFORE captcha to avoid false positives from footer text
      if (pageContent.includes('There was no data found for that address') ||
          pageContent.includes('no data found for that address')) {
        L.info('BofA has no data for this address, returning dashes', { address: cleanAddress });

        // Close page and browser
        await page.close().catch(() => {});
        await browser.close().catch(() => {});

        return {
          ok: true,
          address: cleanAddress,
          avgSalePrice: null,
          avgSalePriceText: '—',
          estimatedHomeValue: null,
          estimatedHomeValueText: '—',
          amv: null,
          source: 'bankofamerica.com',
          scrapedAt: new Date().toISOString(),
          noDataFound: true,
          message: 'BofA has no home value data for this address'
        };
      }

      // Check for captcha/blocking - only if not "no data found"
      if (pageContent.includes('verify you are a human') ||
          pageContent.includes('access denied') ||
          pageContent.includes('unusual traffic')) {
        throw new Error('BofA blocked request (captcha/access denied)');
      }

      throw new Error('Results not found after waiting');
    }

    // Scrape the values
    const { avgSaleText, estHomeText } = await scrapeBofaValues(page);

    const avgSalePrice = parseDollarToNumber(avgSaleText);
    const estimatedHomeValue = parseDollarToNumber(estHomeText);
    const amv = averageTwo(avgSaleText, estHomeText);

    L.info('BofA lookup successful', {
      address: cleanAddress,
      avgSalePrice,
      estimatedHomeValue,
      amv
    });

    // Close page and browser
    await page.close().catch(() => {});
    await browser.close().catch(() => {});

    return {
      ok: true,
      address: cleanAddress,
      avgSalePrice,
      avgSalePriceText: avgSaleText,
      estimatedHomeValue,
      estimatedHomeValueText: estHomeText,
      amv,
      source: 'bankofamerica.com',
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    // Clean up
    if (page) try { await page.close(); } catch {}
    if (browser) try { await browser.close(); } catch {}

    // Check if this is a proxy/tunnel error that should trigger retry
    const isProxyError = error.message?.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
                         error.message?.includes('ERR_PROXY_CONNECTION_FAILED') ||
                         error.message?.includes('ERR_TIMED_OUT') ||
                         error.message?.includes('net::ERR_');

    if (isProxyError && usedProxy) {
      markProxyDead(usedProxy);
    }

    throw { error, isProxyError, usedProxy };
  }
}

/**
 * POST /api/bofa/lookup
 *
 * Looks up home values from Bank of America's Home Value Real Estate Center
 *
 * Body:
 *   - address: Full address string (e.g., "123 Main St, Charlotte, NC 28202")
 *
 * Returns:
 *   - avgSalePrice: Average sale price based on comparable sales
 *   - estimatedHomeValue: BofA's estimate of what the home is worth
 *   - amv: Average of the two values (Automated Market Value)
 */
router.post('/lookup', requireAuth, async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Address is required',
        message: 'Please provide a valid address'
      });
    }

    const cleanAddress = normalizeStreetAddress(address.trim());
    L.info('Starting BofA lookup', { address: cleanAddress, original: address.trim() !== cleanAddress ? address.trim() : undefined });

    let lastError = null;

    // Retry loop for proxy failures
    for (let attempt = 1; attempt <= MAX_PROXY_RETRIES; attempt++) {
      try {
        const result = await performBofaLookup(cleanAddress);
        return res.json(result);
      } catch (errObj) {
        lastError = errObj.error || errObj;

        if (errObj.isProxyError && attempt < MAX_PROXY_RETRIES) {
          L.warn(`Proxy error on attempt ${attempt}/${MAX_PROXY_RETRIES}, retrying with different proxy...`, {
            error: lastError.message,
            proxy: errObj.usedProxy?.host
          });
          // Small delay before retry
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        // Non-proxy error or max retries reached, break out
        break;
      }
    }

    // All retries failed
    L.error('BofA lookup failed after retries', { error: lastError?.message });

    // Check for specific error types
    if (lastError?.message?.includes('timeout') || lastError?.message?.includes('Timeout')) {
      return res.status(408).json({
        ok: false,
        error: 'Lookup timed out',
        message: 'The BofA website took too long to respond. The address may not be found or the site may be slow.',
        details: lastError.message
      });
    }

    if (lastError?.message?.includes('waitForSelector')) {
      return res.status(404).json({
        ok: false,
        error: 'Address not found',
        message: 'Could not find home values for this address. Please check the address and try again.',
        details: lastError.message
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'Lookup failed',
      message: 'Failed to retrieve home values from BofA. Please try again.',
      details: lastError?.message
    });
  } catch (unexpectedError) {
    L.error('Unexpected error in BofA lookup', { error: unexpectedError.message });
    return res.status(500).json({
      ok: false,
      error: 'Unexpected error',
      message: 'An unexpected error occurred. Please try again.',
      details: unexpectedError.message
    });
  }
});

/**
 * Single address lookup helper (used by batch endpoint)
 */
async function lookupSingleAddress(address) {
  let browser = null;
  let page = null;

  try {
    const cleanAddress = normalizeStreetAddress(address.trim());

    // Open browser with proxy
    const { browser: br, proxy } = await openBrowserWithProxy();
    browser = br;
    page = await browser.newPage();

    // Authenticate with proxy if credentials provided
    if (proxy?.credentials) {
      await page.authenticate(proxy.credentials);
    }

    // Setup page
    await ensureVendorPageSetup(page, {
      randomizeUA: true,
      timeoutMs: 60000,
      jitterViewport: true
    });

    // Navigate to BofA
    await page.goto(BOFA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Accept cookie consent if present
    await acceptConsentIfPresent(page);

    // Wait for address input
    await page.waitForSelector('#address', { timeout: 30000 });

    // Clear and type address
    await page.click('#address', { delay: 10 }).catch(() => {});
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
    } catch {}

    await page.type('#address', cleanAddress, { delay: 15 });
    await new Promise(r => setTimeout(r, 1500));

    // Wait for Google Places autocomplete container
    await page.waitForSelector('.pac-container', { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // Click autocomplete
    const suggestionSelectors = [
      '.pac-container .pac-item:first-child',
      '.pac-item',
      '.pac-container .pac-item',
      '[class*="suggestion"]',
      '[class*="autocomplete"] li',
      '.MuiAutocomplete-option',
      '[role="option"]'
    ];

    let clicked = false;
    for (const selector of suggestionSelectors) {
      const items = await page.$$(selector);
      if (items.length > 0) {
        // Use evaluate to click to avoid detached element issues
        await page.evaluate((sel) => {
          const item = document.querySelector(sel);
          if (item) {
            item.click();
            return true;
          }
          return false;
        }, selector);
        clicked = true;
        await new Promise(r => setTimeout(r, 500));
        break;
      }
    }

    if (!clicked) {
      await page.keyboard.press('ArrowDown');
      await new Promise(r => setTimeout(r, 300));
      await page.keyboard.press('Enter');
    }

    await new Promise(r => setTimeout(r, 300));
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 45000 }).catch(() => {});

    // Wait for results using broader detection
    const foundResults = await waitForResultsAny(page, { timeout: 45000 });
    if (!foundResults) {
      // Check if BofA shows "no data found" message
      const pageContent = await page.content();
      if (pageContent.includes('There was no data found for that address') ||
          pageContent.includes('no data found for that address')) {
        L.info('BofA has no data for this address', { address: cleanAddress });

        // Cleanup
        await page.close().catch(() => {});
        await browser.close().catch(() => {});

        return {
          ok: true,
          address: cleanAddress,
          avgSalePrice: null,
          estimatedHomeValue: null,
          amv: null,
          noDataFound: true
        };
      }
      throw new Error('Results not found after waiting');
    }

    // Scrape values
    const { avgSaleText, estHomeText } = await scrapeBofaValues(page);
    const avgSalePrice = parseDollarToNumber(avgSaleText);
    const estimatedHomeValue = parseDollarToNumber(estHomeText);
    const amv = averageTwo(avgSaleText, estHomeText);

    // Cleanup
    await page.close().catch(() => {});
    await browser.close().catch(() => {});

    return {
      ok: true,
      address: cleanAddress,
      avgSalePrice,
      estimatedHomeValue,
      amv
    };

  } catch (error) {
    // Log the error for debugging
    L.error('Single address lookup failed', { address, error: error.message });

    // Cleanup on error
    if (page) try { await page.close(); } catch {}
    if (browser) try { await browser.close(); } catch {}

    return {
      ok: false,
      address: address,
      avgSalePrice: null,
      estimatedHomeValue: null,
      amv: null,
      error: error.message
    };
  }
}

/**
 * POST /api/bofa/batch
 *
 * Batch lookup - processes multiple addresses in PARALLEL
 *
 * Body:
 *   - addresses: Array of address strings
 *   - concurrency: Number of parallel browsers (default: 3, max: 5)
 */
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { addresses, concurrency = 3 } = req.body;

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Addresses array is required'
      });
    }

    const maxConcurrency = Math.min(Math.max(1, concurrency), 10); // Cap at 10
    L.info('Starting batch BofA lookup', {
      count: addresses.length,
      concurrency: maxConcurrency
    });

    const results = [];

    // Process in chunks based on concurrency
    for (let i = 0; i < addresses.length; i += maxConcurrency) {
      const chunk = addresses.slice(i, i + maxConcurrency);

      L.info(`Processing chunk ${Math.floor(i / maxConcurrency) + 1}`, {
        addresses: chunk.map(a => a.substring(0, 30) + '...')
      });

      // Run chunk in parallel
      const chunkResults = await Promise.all(
        chunk.map(addr => lookupSingleAddress(addr))
      );

      results.push(...chunkResults);
    }

    const successful = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    L.info('Batch lookup complete', { successful, failed, total: results.length });

    return res.json({
      ok: true,
      results,
      summary: {
        total: results.length,
        successful,
        failed
      }
    });

  } catch (error) {
    L.error('Batch lookup failed', { error: error.message });
    return res.status(500).json({
      ok: false,
      error: 'Batch lookup failed',
      details: error.message
    });
  }
});

/**
 * GET /api/bofa/test
 *
 * Test endpoint to verify the BofA API is working
 */
router.get('/test', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    message: 'BofA lookup API is ready',
    endpoints: [
      { method: 'POST', path: '/api/bofa/lookup', body: { address: 'string' } },
      { method: 'POST', path: '/api/bofa/batch', body: { addresses: ['string'], concurrency: 3 } }
    ]
  });
});

export default router;
