// routes/bofa-internal.js
// Internal BofA lookup function for use by scheduler/automation
// This exports the same lookup logic used by /api/bofa/batch endpoint
// Direct mode enabled by default - proxy disabled

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { log } from '../utils/logger.js';
import { ensureVendorPageSetup } from '../utils/browser.js';
import { normalizeStreetAddress } from '../utils/normalize.js';
import { getVendorProxyPool, toProxyArg } from '../utils/proxyBuilder.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

puppeteer.use(StealthPlugin());

const L = log.child('bofa-internal');

// BofA website URL
const BOFA_URL = 'https://homevaluerealestatecenter.bankofamerica.com/';

// Auto-detect Chrome executable path based on platform
function getDefaultChromePath() {
  const platform = os.platform();

  if (platform === 'win32') {
    const possiblePaths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macPath)) return macPath;
  } else {
    const linuxPaths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const CHROME_PATH = getDefaultChromePath();

// Proxy pool management
let proxyPool = [];
let proxyIndex = 0;
const deadProxies = new Set();
const PROXY_COOLDOWN_MS = 120000;

function isDirectMode() {
  // Default to direct mode (skip proxy) since proxy is failing with timeouts
  // Set BOFA_PROXY_MODE=paid to re-enable proxy
  const mode = (process.env.BOFA_PROXY_MODE || 'direct').toLowerCase();
  const usePaid = process.env.BOFA_USE_PAID;
  return mode === 'direct' || mode === 'off' || mode === 'none' || usePaid === '0' || usePaid === 'false';
}

function getNextProxy() {
  if (isDirectMode()) return null;

  if (proxyPool.length === 0) {
    try {
      proxyPool = getVendorProxyPool('bofa');
    } catch (err) {
      return null;
    }
  }
  if (proxyPool.length === 0) return null;

  let attempts = 0;
  while (attempts < proxyPool.length) {
    const entry = proxyPool[proxyIndex % proxyPool.length];
    proxyIndex++;
    attempts++;

    const proxyArg = toProxyArg(entry);
    const proxyKey = proxyArg?.host + ':' + proxyArg?.port;

    if (proxyKey && deadProxies.has(proxyKey)) continue;
    return proxyArg;
  }

  deadProxies.clear();
  const entry = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  return toProxyArg(entry);
}

function markProxyDead(proxy) {
  if (!proxy) return;
  const key = proxy.host + ':' + proxy.port;
  deadProxies.add(key);
  setTimeout(() => deadProxies.delete(key), PROXY_COOLDOWN_MS);
}

async function openBrowserWithProxy() {
  const proxy = getNextProxy();

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--window-size=1366,768',
    '--lang=en-US,en;q=0.9',
  ];

  if (proxy?.arg) {
    args.push(proxy.arg);
  }

  const browser = await puppeteer.launch({
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
    headless: 'shell',
    defaultViewport: null,
    ignoreHTTPSErrors: true,
    args,
  });

  return { browser, proxy };
}

function parseDollarToNumber(text) {
  if (!text) return null;
  const n = String(text).replace(/[^\d.]/g, '');
  return n ? Math.round(Number(n)) : null;
}

function averageTwo(textA, textB) {
  const a = parseDollarToNumber(textA);
  const b = parseDollarToNumber(textB);
  if (a == null || b == null) return null;
  return Math.round((a + b) / 2);
}

async function acceptConsentIfPresent(page) {
  try {
    const btn = await page.$('#onetrust-accept-btn-handler, #onetrust-accept-all-handler');
    if (btn) await btn.click({ delay: 10 });
  } catch {}
  try {
    const [elt] = await page.$x("//button[contains(., 'Accept') or contains(., 'Agree')]");
    if (elt) await elt.click({ delay: 10 });
  } catch {}
}

async function waitForResultsAny(page, { timeout = 40000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const seen = await page.evaluate(() => {
      const sel = '#section-comparables .hvt-comparables__avg-est, .hvt-estimate__value';
      if (document.querySelector(sel)) return true;
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

async function scrapeBofaValues(page) {
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

  if (!avgSaleText && !estHomeText) {
    const fb = await scrapeByLabelFallback(page);
    avgSaleText = fb.avgSaleText || avgSaleText;
    estHomeText = fb.estHomeText || estHomeText;
  }

  return { avgSaleText, estHomeText };
}

/**
 * Core lookup implementation - does the actual scraping work
 * @param {string} address - Full address string
 * @param {boolean} useDirect - Force direct connection (no proxy)
 * @returns {Object} Result with ok, amv, avgSalePrice, estimatedHomeValue, etc.
 */
async function doLookup(address, useDirect = false) {
  let browser = null;
  let page = null;

  try {
    const cleanAddress = normalizeStreetAddress(address.trim());

    // If useDirect is true, skip proxy entirely
    let proxy = null;
    if (useDirect) {
      L.info('Using direct connection (no proxy)', { address: cleanAddress });
      browser = await puppeteer.launch({
        ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
        headless: 'shell',
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--window-size=1366,768',
          '--lang=en-US,en;q=0.9',
        ],
      });
    } else {
      const result = await openBrowserWithProxy();
      browser = result.browser;
      proxy = result.proxy;
    }

    page = await browser.newPage();

    if (proxy?.credentials) {
      await page.authenticate(proxy.credentials);
    }

    await ensureVendorPageSetup(page, {
      randomizeUA: true,
      timeoutMs: 60000,
      jitterViewport: true
    });

    await page.goto(BOFA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await acceptConsentIfPresent(page);
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

    // Wait for Google Places autocomplete
    await page.waitForSelector('.pac-container', { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // Click autocomplete suggestion
    const suggestionSelectors = [
      '.pac-container .pac-item:first-child',
      '.pac-item',
      '[class*="suggestion"]',
      '[role="option"]'
    ];

    let clicked = false;
    for (const selector of suggestionSelectors) {
      const items = await page.$$(selector);
      if (items.length > 0) {
        await page.evaluate((sel) => {
          const item = document.querySelector(sel);
          if (item) item.click();
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

    const foundResults = await waitForResultsAny(page, { timeout: 45000 });
    if (!foundResults) {
      const pageContent = await page.content();
      if (pageContent.includes('no data found for that address')) {
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

    const { avgSaleText, estHomeText } = await scrapeBofaValues(page);
    const avgSalePrice = parseDollarToNumber(avgSaleText);
    const estimatedHomeValue = parseDollarToNumber(estHomeText);
    const amv = averageTwo(avgSaleText, estHomeText);

    await page.close().catch(() => {});
    await browser.close().catch(() => {});

    return {
      ok: true,
      address: cleanAddress,
      avgSalePrice,
      estimatedHomeValue,
      amv,
      usedDirect: useDirect
    };

  } catch (error) {
    // Clean up browser resources
    if (page) try { await page.close(); } catch {}
    if (browser) try { await browser.close(); } catch {}

    // Re-throw with context
    const enhancedError = new Error(error.message);
    enhancedError.usedDirect = useDirect;
    throw enhancedError;
  }
}

/**
 * Internal function to lookup a single address (same as /api/bofa/batch uses)
 * Automatically retries with direct connection if proxy fails with selector error
 * @param {string} address - Full address string
 * @param {boolean} forceDirect - Force direct connection (no proxy) - skip retry logic
 * @returns {Object} Result with ok, amv, avgSalePrice, estimatedHomeValue, etc.
 */
export async function lookupSingleAddressInternal(address, forceDirect = false) {
  // If direct mode is already set globally or forced, just use direct
  if (forceDirect || isDirectMode()) {
    try {
      return await doLookup(address, true);
    } catch (error) {
      L.error('Direct lookup failed', { address, error: error.message });
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

  // Try with proxy first
  try {
    const result = await doLookup(address, false);
    return result;
  } catch (proxyError) {
    // Check if error is proxy-related (selector not found = page blocked/didn't load)
    // Also include tunnel/connection errors which indicate proxy failure
    const isProxyBlockError = proxyError.message.includes('#address') ||
                              proxyError.message.includes('selector') ||
                              proxyError.message.includes('timeout') ||
                              proxyError.message.includes('Navigation') ||
                              proxyError.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
                              proxyError.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
                              proxyError.message.includes('ERR_CONNECTION_REFUSED') ||
                              proxyError.message.includes('ECONNREFUSED') ||
                              proxyError.message.includes('net::ERR_');

    if (isProxyBlockError) {
      L.warn('Proxy attempt failed, retrying with direct connection', {
        address,
        proxyError: proxyError.message
      });

      // Retry with direct connection
      try {
        const directResult = await doLookup(address, true);
        L.info('Direct connection succeeded after proxy failure', { address });
        return directResult;
      } catch (directError) {
        L.error('Both proxy and direct attempts failed', {
          address,
          proxyError: proxyError.message,
          directError: directError.message
        });
        return {
          ok: false,
          address: address,
          avgSalePrice: null,
          estimatedHomeValue: null,
          amv: null,
          error: `Proxy: ${proxyError.message} | Direct: ${directError.message}`
        };
      }
    }

    // Non-proxy error, just return failure
    L.error('Lookup failed (non-proxy error)', { address, error: proxyError.message });
    return {
      ok: false,
      address: address,
      avgSalePrice: null,
      estimatedHomeValue: null,
      amv: null,
      error: proxyError.message
    };
  }
}

export default { lookupSingleAddressInternal };
