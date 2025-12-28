import { loginToPrivy } from './auth/loginService.js';
import { session } from './auth/sessionService.js';
import scrapePropertiesV1 from './scrapers/v1.js';
import { logPrivy } from '../../utils/logger.js';
import { isNetworkOrProxyError } from '../../services/proxyManager.js';
import { safeGoto, initSharedBrowser, getSharedPage, ensureVendorPageSetup } from '../../utils/browser.js';
import { getChromeProxyForPaid } from '../../services/proxyManager.js';
import { getVendorProxyPool, toProxyArg } from '../../utils/proxyBuilder.js';
import * as sessionStore from './auth/sessionStore.js'; // ensure file exists

// Exponential backoff with jitter (same as Redfin fetcher)
const backoff = (n) => 500 * (2 ** n) + Math.floor(Math.random() * 250);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const L = logPrivy.child('privy');

// Check if a page is still healthy (not detached/closed)
async function isPageHealthy(page) {
  if (!page) return false;
  try {
    // Try to evaluate something simple - if page is detached this will throw
    await page.evaluate(() => document.readyState);
    return true;
  } catch (e) {
    const msg = e?.message || '';
    if (msg.includes('Detached') || msg.includes('closed') || msg.includes('Target closed') || msg.includes('Session closed')) {
      return false;
    }
    // Other errors might be temporary, consider page still potentially healthy
    return true;
  }
}

const READY_SELECTORS = [
  '.properties-found',
  '[data-testid="properties-found"]',
];

// Ensure the SPA dashboard is hydrated enough to scrape (local helper to avoid circular imports)
async function ensureDashboardReadyLocal(page, { timeout = 90_000, pollMs = 500 } = {}) {
  const READY_SELECTOR = (process.env.PRIVY_READY_SELECTOR || '').trim();

  // Confirm we’re on /dashboard (fast)
  await page.waitForFunction(() => /\/dashboard/.test(location.pathname), { timeout });

  // Multiple OR signals to avoid brittle single-selector waits
  const candidates = [
    READY_SELECTOR || '.properties-found,[data-test="properties-found"],[data-testid="properties-count"]',
    '[data-testid="property-list"],.property-list,.properties-list,.grid-view-container,.view-container',
    '#SearchBlock-Filter-Button',
    '.map-view-container,.mapboxgl-map',
    '#react-app,#ldp-page-app,#app'
  ].join(',');

  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const h = await page.$(candidates);
    if (h) return true;
    await new Promise(r => setTimeout(r, pollMs));
  }
  // Don’t kill the run — just warn and let scrape() handle its own waits
  logPrivy.warn('Dashboard anchors not found in time; continuing to scrape anyway');
  return false;
}



export default class PrivyBot {
  constructor({ proxyInfo } = {}) {
        // Shared browser will use SHARED_CHROME_USER_DATA_DIR (see utils/browser.js)
        this.proxyInfo = proxyInfo || null;

    // Build rotating proxy supplier for Privy
    const __privyVendorList = getVendorProxyPool('privy');
    this.proxySupplier = (() => {
      let i = 0;
      const list = Array.isArray(__privyVendorList) ? __privyVendorList.slice(0, 250) : [];
      return () => {
        if (!list.length) return null;
        const entry = list[i++ % list.length];
        try { return toProxyArg(entry); } catch { return null; }
      };
    })();

    this.page = null;
    this.browser = null;
    this.properties = [];
    this.proxyMode = String(process.env.PRIVY_PROXY_MODE || 'off').toLowerCase(); // 'off' | 'direct' | 'auto' | 'paid'
    this.usingProxy = false;
    this.headless = String(process.env.PRIVY_HEADLESS || 'true').toLowerCase() !== 'false';
  }

  async init() {
    const useProxy = (this.proxyMode === 'paid' || this.proxyMode === 'auto');
    if (useProxy && !this.proxyInfo?.arg) {
      const alt = this.proxySupplier ? this.proxySupplier() : null;
      if (alt?.arg) {
        this.proxyInfo = alt;
      } else if (this.proxyMode === 'auto') {
        logPrivy.warn('Proxy auto mode: no proxy available, falling back to direct');
      } else {
        throw new Error('Paid proxy requested but not configured (privy)');
      }
    }

    // === Use shared singleton browser/profile (+ named shared page) ===
    this.browser = await initSharedBrowser(); // ensures singleton launch w/ persistent profile
    this.page = await getSharedPage('privy', {
      // keep CSS/fonts/images for SPA hydration
      interceptRules: { block: ['media', 'analytics', 'tracking'] },
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      allowlistDomains: ['privy.pro', 'app.privy.pro', 'static.privy.pro', 'cdn.privy.pro'],
    });
    await ensureVendorPageSetup(this.page, {
      randomizeUA: true,
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      jitterViewport: true,
      baseViewport: { width: 1366, height: 900 },
    });
    try { await this.page.setViewport({ width: 1947, height: 1029 }); } catch {}

    // Attempt to load a previously saved session before navigation
    try {
      if (sessionStore.hasFreshPrivySession(1000 * 60 * 60 * 24)) { // 24h window
        const jar = sessionStore.readPrivySession();
        if (jar?.cookies?.length) {
          await this.page.setCookie(...jar.cookies);
        }
      }
    } catch (e) {
      logPrivy.warn('Session restore failed', { error: e?.message });
    }

    // Set a more forgiving default timeout for flaky logins
    if (this.page && typeof this.page.setDefaultTimeout === 'function') {
      this.page.setDefaultTimeout(90000);
      if (this.page && typeof this.page.setDefaultNavigationTimeout === 'function') {
        this.page.setDefaultNavigationTimeout(Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000));
      }
    }


    this.usingProxy = !!(useProxy && this.proxyInfo?.arg);

    // If the proxy requires auth, set it now for the active page
    if (useProxy && this.proxyInfo?.credentials) {
      try { await this.page.authenticate(this.proxyInfo.credentials); } catch {}
    }
  }

  async _relaunchDirect() {
       // With shared browser, just (re)create a page without proxy args.
    try { await this.page?.close?.().catch(()=>{}); } catch {}
    this.page = await getSharedPage('privy', {
      interceptRules: { block: ['media', 'analytics', 'tracking'] },
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      allowlistDomains: ['privy.pro', 'app.privy.pro', 'static.privy.pro', 'cdn.privy.pro'],
    });
    await ensureVendorPageSetup(this.page, {
      randomizeUA: true,
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      jitterViewport: true,
      baseViewport: { width: 1366, height: 900 },
    });
    try { await this.page.setViewport({ width: 1947, height: 1029 }); } catch {}
    this.usingProxy = false; this.proxyMode = 'direct';
  }

  // Recover page if it became detached - creates fresh page and re-logins
  async _ensureHealthyPage() {
    const healthy = await isPageHealthy(this.page);
    if (healthy) return true;

    logPrivy.warn('Page is detached/closed - recovering with fresh page and re-login');

    // Create fresh page
    try { await this.page?.close?.().catch(() => {}); } catch {}
    this.page = await getSharedPage('privy', {
      interceptRules: { block: ['media', 'analytics', 'tracking'] },
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      allowlistDomains: ['privy.pro', 'app.privy.pro', 'static.privy.pro', 'cdn.privy.pro'],
    });
    await ensureVendorPageSetup(this.page, {
      randomizeUA: true,
      timeoutMs: Number(process.env.PRIVY_NAV_TIMEOUT_MS || 180000),
      jitterViewport: true,
      baseViewport: { width: 1366, height: 900 },
    });
    try { await this.page.setViewport({ width: 1947, height: 1029 }); } catch {}

    // Restore session cookies if available
    try {
      if (sessionStore.hasFreshPrivySession(1000 * 60 * 60 * 24)) {
        const jar = sessionStore.readPrivySession();
        if (jar?.cookies?.length) {
          await this.page.setCookie(...jar.cookies);
          logPrivy.info('Restored session cookies after page recovery');
        }
      }
    } catch (e) {
      logPrivy.warn('Failed to restore cookies during recovery', { error: e?.message });
    }

    // Re-login
    await this.login();
    return true;
  }

  async login() {
    if (!this.page) throw new Error('Page is not initialized. Call init() first.');
    try {
      // Check if already on sign-in page - skip navigation if so
      const currentUrl = this.page.url();
      logPrivy.info('PrivyBot.login() - current URL', { url: currentUrl });

      if (!currentUrl.includes('sign_in')) {
        // Navigate to sign-in page only if not already there
        logPrivy.info('Navigating to sign-in page...');
        const navAttempts = 3;
        for (let i = 0; i < navAttempts; i++) {
          try {
            await safeGoto(this.page, 'https://app.privy.pro/users/sign_in', { waitUntil: ['domcontentloaded'], timeout: 60000 });
            break;
          } catch (e) {
            if (isNetworkOrProxyError(e) && i < navAttempts - 1) {
              try { await getChromeProxyForPaid({ service: 'privy', sticky: true, key: 'privy' }); } catch {}
              await sleep(backoff(i));
              continue;
            }
            throw e;
          }
        }
      } else {
        logPrivy.info('Already on sign-in page, skipping navigation');
      }

      await this.page.bringToFront().catch(() => {});
      logPrivy.info('Calling loginToPrivy...');
      await loginToPrivy(this.page);

      // Nudge to dashboard with EXPLICIT filters to avoid saved search loading
      // CRITICAL: Never go to plain /dashboard - it loads "Below Market" saved search with include_sold=true
      const cleanDashboardUrl = 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true&include_pending=false&include_under_contract=false&include_detached=true&include_attached=false&hoa=no&spread=50&spread_type=umv&date_range=all';
      const dashNavAttempts = 3;
      for (let i = 0; i < dashNavAttempts; i++) {
        try {
          await safeGoto(this.page, cleanDashboardUrl, { waitUntil: ['domcontentloaded'], timeout: 60000 });
          break;
        } catch (e) {
          if (isNetworkOrProxyError(e) && i < dashNavAttempts - 1) {
            try { await getChromeProxyForPaid({ service: 'privy', sticky: true, key: 'privy' }); } catch {}
            await sleep(backoff(i));
            continue;
          }
          throw e;
        }
      }

      // SPA hydration wait: accept any ready selectors OR list growth OR skeleton replaced
      const selTimeout = Number(process.env.PRIVY_LIST_SELECTOR_TIMEOUT_MS || 90000);
      await this.page.waitForFunction((sels) => {
        const okSel = sels.some(s => document.querySelector(s));
        if (okSel) return true;
        const list = document.querySelector('[data-testid="property-list"], .property-list, .properties-list');
        if (list && list.children && list.children.length > 0) return true;
        const skeletonGone = !document.querySelector('.skeleton, .loading, [aria-busy="true"]');
        return skeletonGone && !!document.querySelector('#react-app');
      }, { timeout: selTimeout }, READY_SELECTORS).catch(() => {});

      try { await sessionStore.saveSessionCookies(this.page); } catch {}

      // Defensive: if SPA claims “0 found”, do one reload
      const needsReload = await this.page.evaluate(() => {
        const el = document.querySelector('.properties-found, [data-testid="properties-found"]');
        const txt = el ? (el.textContent || '') : '';
        const m = txt.match(/(\d+)/);
        const n = m ? parseInt(m[1], 10) : null;
        return (n !== null && n === 0);
      }).catch(() => false);

      if (needsReload && Number(process.env.PRIVY_RELOAD_ON_TIMEOUT || 1)) {
        await this.page.reload({ waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 90000 }).catch(() => {});
        await this.page.waitForFunction((sels) => sels.some(s => document.querySelector(s)), { timeout: 60000 }, READY_SELECTORS).catch(() => {});
      }
    } catch (e) {
      // Only proxy-fallback on *network/proxy* failures
      if (this.usingProxy && this.proxyMode === 'auto' && isNetworkOrProxyError(e)) {
        // Rotate proxy on failure if supplier available
        if (this.proxySupplier) {
          const next = this.proxySupplier();
          if (next?.arg) this.proxyInfo = next;
        }
        logPrivy.warn('Privy login failed via proxy — switching to direct and retrying once', { error: e?.message });
        await this._relaunchDirect();
        // Robust navigation with retry/fallback
        const navAttempts = 3;
        for (let i = 0; i < navAttempts; i++) {
          try {
            await safeGoto(this.page, 'https://app.privy.pro/users/sign_in', { waitUntil: ['domcontentloaded'], timeout: 120000 });
            break;
          } catch (e) {
            if (isNetworkOrProxyError(e) && i < navAttempts - 1) {
              try { await getChromeProxyForPaid({ service: 'privy', sticky: true, key: 'privy' }); } catch {}
              await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 800)));
              continue;
            }
            throw e;
          }
        }
        await loginToPrivy(this.page);
        // CRITICAL: Never go to plain /dashboard - use clean URL to avoid saved search
        const cleanDashUrl = 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true&include_pending=false&include_under_contract=false&include_detached=true&include_attached=false&hoa=no&spread=50&spread_type=umv&date_range=all';
        for (let i = 0; i < navAttempts; i++) {
          try {
            await safeGoto(this.page, cleanDashUrl, { waitUntil: ['domcontentloaded','networkidle2'], timeout: 120000 });
            break;
          } catch (e) {
            if (isNetworkOrProxyError(e) && i < navAttempts - 1) {
              try { await getChromeProxyForPaid({ service: 'privy', sticky: true, key: 'privy' }); } catch {}
              await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 800)));
              continue;
            }
            throw e;
          }
        }
        await ensureDashboardReadyLocal(this.page, { timeout: 60_000 }).catch(() => {});
      } else {
        throw e;
      }
    }
  }

  async scrape() {
    if (!this.browser || !this.page) throw new Error('Browser or page is not initialized. Call init() first.');
    logPrivy.start('Starting scrape (v1)…');
    try {
      // Check page health before scraping - recover if detached
      await this._ensureHealthyPage();

      await ensureDashboardReadyLocal(this.page, { timeout: 60_000 }).catch(() => {});
      try { await sessionStore.saveSessionCookies(this.page); } catch {}
      const results = await scrapePropertiesV1(this.page);
      logPrivy.success('Scrape (v1) complete', { total: results?.length || 0 });
      return results;
    } catch (e) {
      const msg = e?.message || '';
      // Handle detached frame errors by recovering the page
      if (msg.includes('Detached') || msg.includes('Target closed') || msg.includes('Session closed')) {
        logPrivy.warn('Scrape failed due to detached page - attempting recovery', { error: msg });
        await this._ensureHealthyPage();
        // Retry scrape once after recovery
        const results = await scrapePropertiesV1(this.page);
        logPrivy.success('Scrape (v1) complete (after page recovery)', { total: results?.length || 0 });
        return results;
      }

      if (isNetworkOrProxyError(e) && this.usingProxy && this.proxyMode === 'auto') {
        // Rotate proxy on failure if supplier available
        if (this.proxySupplier) {
          const next = this.proxySupplier();
          if (next?.arg) this.proxyInfo = next;
        }
        logPrivy.warn('Privy scrape encountered proxy/network error — switching to direct and retrying once', { error: e?.message });
        await this._relaunchDirect();
        const results = await scrapePropertiesV1(this.page);
        logPrivy.success('Scrape (v1) complete (after direct fallback)', { total: results?.length || 0 });
        return results;
      }
      throw e;
    }
  }

  async keepSessionAliveLoop() {
    if (!this.browser || !this.page) throw new Error('Browser or page is not initialized. Call init() first.');
    logPrivy.info('Keeping session alive…');
    try {
      await session(this.browser, this.page);
    } catch (e) {
      if (isNetworkOrProxyError(e) && this.usingProxy && this.proxyMode === 'auto') {
        logPrivy.warn('Session keepalive hit proxy/network error — switching to direct and retrying once', { error: e?.message });
        await this._relaunchDirect();
        await session(this.browser, this.page);
      } else {
        throw e;
      }
    }
  }

  async close() {
    try { await this.page?.close?.(); } catch {}
  }
}