/**
 * Wells Fargo ComeHome Agent Fetcher Bot
 *
 * Scrapes agent/loan officer information from Wells Fargo's ComeHome platform
 * for a given property address.
 *
 * Now with paid proxy support via Decodo for better reliability.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { log } from '../../utils/logger.js';
import {
  getPreferredChromeProxy,
  paidProxyAvailable,
  getChromeProxyForPaid
} from '../../services/proxyManager.js';

puppeteer.use(StealthPlugin());

const L = log.child('wellsfargo:bot');

// ComeHome platform URL
const COMEHOME_URL = 'https://wellsfargo.comehome.com/';

// Timeouts
const NAV_TIMEOUT = Number(process.env.WELLSFARGO_NAV_TIMEOUT_MS || 60000);
const SEARCH_TIMEOUT = Number(process.env.WELLSFARGO_SEARCH_TIMEOUT_MS || 30000);

// Proxy configuration - default to false since Wells Fargo doesn't typically block scrapers
const WELLSFARGO_USE_PAID = String(process.env.WELLSFARGO_USE_PAID || 'false').toLowerCase() !== 'false';

// Singleton instance
let sharedBot = null;
let botInitializing = false;

/**
 * WellsFargoBot - Scrapes agent information from Wells Fargo ComeHome
 */
class WellsFargoBot {
  constructor() {
    this.page = null;
    this.browser = null;
    this.initialized = false;
    this.proxyInfo = null;
  }

  /**
   * Initialize the bot with a browser using paid proxy
   */
  async init() {
    if (this.initialized && this.page) {
      L.info('Bot already initialized');
      return;
    }

    L.info('Initializing WellsFargoBot...');

    try {
      // Build launch args - start with no proxy for direct connection
      const launchArgs = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--window-size=1920,1080',
        '--lang=en-US,en;q=0.9',
      ];

      // Only use proxy if explicitly enabled via WELLSFARGO_USE_PAID=true
      const usePaidProxy = WELLSFARGO_USE_PAID && paidProxyAvailable();

      if (usePaidProxy) {
        L.info('Using paid proxy for Wells Fargo scraping');
        this.proxyInfo = await getChromeProxyForPaid({ service: 'wellsfargo', sticky: true, key: 'wellsfargo-bot' });

        // Add proxy args if available
        if (this.proxyInfo?.args) {
          launchArgs.push(...this.proxyInfo.args);
          L.info('Proxy configured', { type: this.proxyInfo.type, hasArg: !!this.proxyInfo.arg });
        } else if (this.proxyInfo?.arg) {
          launchArgs.push(this.proxyInfo.arg);
          L.info('Proxy configured', { type: this.proxyInfo.type });
        }
      } else {
        L.info('Using direct connection (no proxy) for Wells Fargo scraping');
        this.proxyInfo = { type: 'direct', arg: null, close: async () => {} };
      }

      const headless = process.env.WELLSFARGO_HEADLESS !== 'false' ? 'new' : false;

      this.browser = await puppeteer.launch({
        headless,
        defaultViewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
        args: launchArgs,
        protocolTimeout: 120000,
      });

      this.page = await this.browser.newPage();

      // Set a realistic user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      );

      // Block unnecessary resources to speed up loading
      await this.page.setRequestInterception(true);
      this.page.on('request', (req) => {
        const type = req.resourceType();
        const url = req.url().toLowerCase();

        // Block images, media, fonts, and tracking
        if (type === 'image' || type === 'media' || type === 'font' ||
            url.includes('analytics') || url.includes('tracking') ||
            url.includes('google-analytics') || url.includes('facebook') ||
            url.includes('doubleclick') || url.includes('adsense')) {
          return req.abort();
        }
        return req.continue();
      });

      this.initialized = true;
      L.info('WellsFargoBot initialized successfully', {
        proxy: this.proxyInfo?.type || 'none',
        headless
      });
    } catch (err) {
      L.error('Failed to initialize WellsFargoBot', { error: err.message });
      throw err;
    }
  }

  /**
   * Login to Wells Fargo ComeHome if credentials are provided
   */
  async login() {
    const email = process.env.WELLSFARGO_EMAIL;
    const password = process.env.WELLSFARGO_PASSWORD;

    if (!email || !password) {
      L.info('No Wells Fargo credentials provided, skipping login');
      return false;
    }

    L.info('Attempting to login to Wells Fargo ComeHome...', { email });

    try {
      // Look for login/sign-in button on homepage using page.evaluate for text matching
      let loginButton = null;

      // First try href-based selectors (standard CSS)
      const hrefSelectors = ['a[href*="login"]', '[data-testid*="login"]'];
      for (const selector of hrefSelectors) {
        try {
          loginButton = await this.page.$(selector);
          if (loginButton) {
            L.info('Found login button', { selector });
            await loginButton.click();
            break;
          }
        } catch {
          continue;
        }
      }

      // If not found, search by text content
      if (!loginButton) {
        loginButton = await this.page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.find(btn => {
            const text = btn.textContent.trim().toLowerCase();
            return text === 'log in' || text === 'sign in' || text === 'login' || text === 'signin';
          });
        });

        if (loginButton && loginButton.asElement()) {
          L.info('Found login button by text content');
          await loginButton.click();
        } else {
          loginButton = null;
        }
      }

      if (!loginButton) {
        L.warn('Could not find login button');
        return false;
      }

      // Wait for login page to load
      await new Promise(r => setTimeout(r, 3000));

      // Enter email
      const emailSelectors = [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[name*="username" i]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]',
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        emailInput = await this.page.$(selector);
        if (emailInput) {
          L.info('Found email input', { selector });
          await emailInput.type(email, { delay: 100 });
          break;
        }
      }

      if (!emailInput) {
        L.error('Could not find email input field');
        return false;
      }

      // Enter password
      const passwordSelectors = [
        'input[type="password"]',
        'input[name*="password" i]',
        'input[id*="password" i]',
      ];

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        passwordInput = await this.page.$(selector);
        if (passwordInput) {
          L.info('Found password input', { selector });
          await passwordInput.type(password, { delay: 100 });
          break;
        }
      }

      if (!passwordInput) {
        L.error('Could not find password input field');
        return false;
      }

      // Click submit button
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '[data-testid*="submit"]',
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const submitButton = await this.page.$(selector);
          if (submitButton) {
            L.info('Found submit button, clicking', { selector });
            await submitButton.click();
            submitted = true;
            break;
          }
        } catch {
          continue;
        }
      }

      // If not found by type, search by text
      if (!submitted) {
        const submitButtonByText = await this.page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"]'));
          return buttons.find(btn => {
            const text = (btn.textContent || btn.value || '').trim().toLowerCase();
            return text === 'log in' || text === 'sign in' || text === 'submit' || text === 'login';
          });
        });

        if (submitButtonByText && submitButtonByText.asElement()) {
          L.info('Found submit button by text content');
          await submitButtonByText.click();
          submitted = true;
        }
      }

      if (!submitted) {
        // Try pressing Enter as fallback
        L.info('No submit button found, pressing Enter');
        await this.page.keyboard.press('Enter');
      }

      // Wait for navigation after login
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
        new Promise(r => setTimeout(r, 10000)),
      ]);

      // Check if login was successful by looking for user-specific elements
      await new Promise(r => setTimeout(r, 2000));
      const pageText = await this.page.evaluate(() => document.body.innerText);
      const loginSuccessful = !pageText.includes('Invalid') &&
                             !pageText.includes('incorrect') &&
                             !pageText.includes('error') &&
                             (pageText.includes('dashboard') || pageText.includes('My home') || pageText.includes('Saved'));

      if (loginSuccessful) {
        L.info('Login successful!');
        return true;
      } else {
        L.warn('Login may have failed - checking page content');
        L.info('Page text preview', { text: pageText.substring(0, 300) });
        return false;
      }
    } catch (err) {
      L.error('Login failed', { error: err.message });
      return false;
    }
  }

  /**
   * Navigate to ComeHome and wait for it to load
   */
  async navigateToHome(retryCount = 0) {
    L.info('Navigating to ComeHome platform...', { retry: retryCount });

    try {
      await this.page.goto(COMEHOME_URL, {
        waitUntil: 'networkidle2',
        timeout: NAV_TIMEOUT,
      });

      // Wait a bit for dynamic content to load
      await new Promise(r => setTimeout(r, 2000));

      // Attempt login if credentials are provided
      if (retryCount === 0) {
        const loginResult = await this.login();
        if (loginResult) {
          L.info('Logged in successfully, ready to search');
          // Wait a bit more after login
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // Try multiple selectors for the search input
      const searchSelectors = [
        'input[type="text"]',
        'input[placeholder*="address"]',
        'input[placeholder*="search"]',
        'input[placeholder*="Address"]',
        'input[placeholder*="Search"]',
        'input[name*="search"]',
        'input[name*="address"]',
        'input[data-testid*="search"]',
        'input[aria-label*="search"]',
        'input[aria-label*="address"]',
        '[role="searchbox"]',
        '[role="combobox"]',
      ];

      let found = false;
      for (const selector of searchSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          L.info('Found search input with selector', { selector });
          found = true;
          break;
        } catch {
          // Try next selector
        }
      }

      if (!found) {
        // Log page content for debugging
        const pageContent = await this.page.content();
        const hasInput = pageContent.includes('<input');
        L.warn('No search input found with standard selectors', { hasInputTag: hasInput, pageLength: pageContent.length });

        // Try to reload the page if this is first attempt
        if (retryCount < 2) {
          L.info('Retrying navigation...');
          await this.page.reload({ waitUntil: 'networkidle2' });
          return this.navigateToHome(retryCount + 1);
        }
      }

      L.info('ComeHome platform loaded');
      return true;
    } catch (err) {
      L.error('Failed to navigate to ComeHome', { error: err.message });

      // Retry once on failure
      if (retryCount < 2) {
        L.info('Retrying navigation after error...');
        await new Promise(r => setTimeout(r, 2000));
        return this.navigateToHome(retryCount + 1);
      }
      return false;
    }
  }

  /**
   * Fetch agent information for a given address
   * @param {string} address - Full property address
   * @returns {Object} Agent and loan officer information
   */
  async fetchAgent(address) {
    if (!this.initialized || !this.page) {
      throw new Error('Bot not initialized. Call init() first.');
    }

    L.info('Fetching agent for address', { address });

    try {
      // Check if page is still valid
      try {
        await this.page.evaluate(() => true);
      } catch (err) {
        L.warn('Page was closed or detached, reinitializing...');
        await this.close();
        await this.init();
        await this.navigateToHome();
      }

      // Always navigate back to home before each search to reset state
      try {
        const currentUrl = this.page.url();
        if (!currentUrl || !currentUrl.includes('comehome.com') || currentUrl.includes('#') || currentUrl.includes('?')) {
          L.info('Navigating back to homepage to reset state');
          await this.page.goto(COMEHOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        L.warn('Error navigating to homepage, reinitializing', { error: err.message });
        await this.close();
        await this.init();
        await this.navigateToHome();
      }

      // Find and interact with search input - try multiple selectors
      const searchSelectors = [
        'input[type="text"]',
        'input[placeholder*="address"]',
        'input[placeholder*="search"]',
        'input[placeholder*="Address"]',
        'input[placeholder*="Search"]',
        'input[name*="search"]',
        'input[name*="address"]',
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
        '[role="searchbox"]',
        '[role="combobox"]',
      ];

      let searchInput = null;
      let usedSelector = null;

      for (const selector of searchSelectors) {
        searchInput = await this.page.$(selector);
        if (searchInput) {
          usedSelector = selector;
          L.info('Found search input', { selector });
          break;
        }
      }

      if (!searchInput) {
        // Try to find any visible input
        const inputs = await this.page.$$('input');
        L.info('Found inputs on page', { count: inputs.length });

        if (inputs.length === 0) {
          // Return a "no agent" response instead of throwing
          L.warn('No search input found - page may have changed or be blocking');
          return {
            ok: true,
            address,
            agent: null,
            loanOfficer: null,
            rawData: { error: 'Could not find search input on page' },
            scrapedAt: new Date().toISOString(),
            proxyUsed: this.proxyInfo?.type || 'none',
          };
        }

        // Use the first input found
        searchInput = inputs[0];
        usedSelector = 'input';
      }

      // Use page.evaluate to directly set value and trigger events - more reliable
      const inputSuccess = await this.page.evaluate((addr) => {
        try {
          const inputs = document.querySelectorAll('input[type="text"], input:not([type="hidden"])');
          let targetInput = null;

          // Find the first visible input
          for (const inp of inputs) {
            if (inp.offsetParent !== null) { // visible
              targetInput = inp;
              break;
            }
          }

          if (!targetInput) return false;

          // Focus the input
          targetInput.focus();

          // Clear and set value
          targetInput.value = '';
          targetInput.value = addr;

          // Trigger all necessary events for React/Vue detection
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          targetInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
          targetInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

          return true;
        } catch (e) {
          return false;
        }
      }, address);

      if (!inputSuccess) {
        L.warn('Failed to set input value via evaluate, trying Puppeteer typing');
        // Fallback: use page.type with selector
        const inputSelector = usedSelector || 'input[type="text"]';
        try {
          await this.page.waitForSelector(inputSelector, { visible: true, timeout: 5000 });
          await this.page.focus(inputSelector);
          await this.page.click(inputSelector, { delay: 100 });
          await this.page.type(inputSelector, address, { delay: 50 });
        } catch (err) {
          L.error('All input methods failed', { error: err.message });
          throw new Error('Could not interact with search input');
        }
      }

      L.info('Typed address, waiting for results...');

      // Wait for autocomplete dropdown to appear
      await new Promise(r => setTimeout(r, 2000));

      // Check current URL before navigation
      const urlBeforeSearch = this.page.url();
      L.info('URL before search', { url: urlBeforeSearch });

      // Try multiple strategies to navigate to property page:

      // Strategy 1: Look for autocomplete dropdown and click first result
      const autocompleteSelectors = [
        '[role="listbox"] [role="option"]:first-child',
        '[role="option"]:first-child',
        '[class*="autocomplete"] li:first-child',
        '[class*="suggestion"] li:first-child',
        '[class*="dropdown"] li:first-child',
        '.pac-item:first-child', // Google Places autocomplete
        '[data-testid*="suggestion"]:first-child',
        'ul[role="listbox"] > li:first-child',
        'div[class*="menu"] > div:first-child',
      ];

      let clickedSuggestion = false;
      for (const selector of autocompleteSelectors) {
        try {
          const suggestionExists = await this.page.$(selector);
          if (suggestionExists) {
            L.info('Found autocomplete suggestion, clicking', { selector });
            await this.page.click(selector);
            clickedSuggestion = true;
            // Wait for navigation after clicking suggestion
            await Promise.race([
              this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
              new Promise(r => setTimeout(r, 5000)),
            ]);
            break;
          }
        } catch (err) {
          // Try next selector
          continue;
        }
      }

      // Strategy 2: Look for a search button to click
      if (!clickedSuggestion) {
        const searchButtonSelectors = [
          'button[type="submit"]',
          'button[aria-label*="search"]',
          'button[class*="search"]',
          'input[type="submit"]',
          '[data-testid*="search-button"]',
        ];

        let clickedButton = false;
        for (const selector of searchButtonSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              L.info('Found search button, clicking', { selector });
              await button.click();
              clickedButton = true;
              await Promise.race([
                this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
                new Promise(r => setTimeout(r, 5000)),
              ]);
              break;
            }
          } catch {
            continue;
          }
        }

        // If not found by attributes, search by text
        if (!clickedButton) {
          const searchButtonByText = await this.page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => {
              const text = btn.textContent.trim().toLowerCase();
              return text === 'search' || text.includes('search');
            });
          });

          if (searchButtonByText && searchButtonByText.asElement()) {
            L.info('Found search button by text content');
            await searchButtonByText.click();
            clickedButton = true;
            await Promise.race([
              this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
              new Promise(r => setTimeout(r, 5000)),
            ]);
          }
        }

        // Strategy 3: If no button found, try pressing Enter
        if (!clickedButton) {
          L.info('No search button found, pressing Enter');
          await this.page.keyboard.press('Enter');
          await Promise.race([
            this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
            new Promise(r => setTimeout(r, 5000)),
          ]);
        }
      }

      // Wait additional time for any dynamic content to load
      await new Promise(r => setTimeout(r, 3000));

      // Check if URL changed (indicates we navigated to a property page)
      const urlAfterSearch = this.page.url();
      L.info('URL after search', { url: urlAfterSearch, changed: urlBeforeSearch !== urlAfterSearch });

      // If URL didn't change, we're likely still on the homepage
      if (urlBeforeSearch === urlAfterSearch) {
        L.warn('URL did not change after search - may still be on homepage');
      }

      // Try to wait for property details or agent section
      try {
        await this.page.waitForSelector('[class*="agent"], [class*="loan"], [class*="officer"], [class*="contact"], [data-testid*="agent"], [data-testid*="contact"], [class*="property"]', {
          timeout: 10000,
        });
        L.info('Found property/contact section on page');
      } catch {
        L.info('Agent section not found with specific selectors, trying to extract any contact info...');
      }

      // DEBUG: Take a screenshot and log page content (with error handling)
      let pageHTML = '';
      let pageText = '';

      // SCREENSHOTS DISABLED - uncomment to re-enable
      // try {
      //   const debugScreenshotPath = `wellsfargo-debug-${Date.now()}.png`;
      //   await this.page.screenshot({ path: debugScreenshotPath, fullPage: true });
      //   L.info('Debug screenshot saved', { path: debugScreenshotPath });
      // } catch (err) {
      //   L.warn('Could not take screenshot', { error: err.message });
      // }

      // Get page HTML to debug
      try {
        pageHTML = await this.page.content();
        pageText = await this.page.evaluate(() => document.body.innerText);
        L.info('Page content preview', {
          htmlLength: pageHTML.length,
          textLength: pageText.length,
          textPreview: pageText.substring(0, 500),
        });
      } catch (err) {
        L.warn('Could not get page content', { error: err.message });
        return {
          ok: false,
          address,
          error: 'Page became unavailable during extraction',
          scrapedAt: new Date().toISOString(),
          proxyUsed: this.proxyInfo?.type || 'none',
        };
      }

      // Check if we're still on the homepage by looking for homepage-specific content
      const isHomepage = pageText.includes('Find your dream home') ||
                        pageText.includes('Search in your neighborhood') ||
                        (pageText.includes('Find a home') && pageText.includes('My home value') && pageHTML.length < 100000);

      // Check if login is required
      const requiresLogin = pageText.includes('Join or Log In') ||
                           pageText.includes('Sign in') ||
                           pageText.includes('Create account');

      if (isHomepage && urlBeforeSearch === urlAfterSearch) {
        L.warn('Still on homepage - search did not navigate to property page', { address, requiresLogin });

        let errorMessage = 'Property not found - search did not navigate to property details page';
        if (requiresLogin) {
          errorMessage = 'Wells Fargo ComeHome may require login to search properties. The search feature might not be accessible without authentication.';
        }

        return {
          ok: true,
          address,
          agent: null,
          loanOfficer: null,
          rawData: {
            error: errorMessage,
            homepage: true,
            urlNotChanged: true,
            requiresLogin
          },
          scrapedAt: new Date().toISOString(),
          proxyUsed: this.proxyInfo?.type || 'none',
        };
      }

      // Extract agent/loan officer information from the page
      // Pass the address so we can filter out address components from names
      const agentInfo = await this.page.evaluate((inputAddress) => {
        const result = {
          agent: null,
          loanOfficer: null,
          rawData: {},
        };

        // Extract words from input address to exclude from name matching
        const addressWords = inputAddress.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);

        // Helper function to check if a name is valid (not from address or exclusion list)
        const isValidName = (name) => {
          const nameLower = name.toLowerCase();
          const nameWords = nameLower.split(/\s+/);

          // Extended list of excluded terms
          const excludedTerms = [
            'wells fargo', 'come home', 'comehome', 'home mortgage', 'loan officer',
            'real estate', 'mortgage consultant', 'home lending',
            'united states', 'new york', 'los angeles', 'san francisco', 'san diego',
            'las vegas', 'new jersey', 'new orleans', 'san antonio', 'fort worth',
            'north carolina', 'south carolina', 'north dakota', 'south dakota',
            'west virginia', 'new hampshire', 'new mexico', 'rhode island',
            'privacy policy', 'terms service', 'contact us', 'learn more', 'read more',
            'sign in', 'sign up', 'log in', 'get started', 'find out', 'click here',
            'view more', 'see more', 'show more', 'load more',
            'home value', 'market value', 'sale price', 'down payment', 'monthly payment',
            'interest rate', 'property tax', 'square feet', 'year built', 'single family',
            'multi family', 'property details', 'home details', 'listing price'
          ];

          // Street/address type words to exclude
          const addressTypeWords = [
            'street', 'st', 'avenue', 'ave', 'boulevard', 'blvd', 'drive', 'dr',
            'road', 'rd', 'lane', 'ln', 'court', 'ct', 'place', 'pl', 'circle', 'cir',
            'way', 'terrace', 'ter', 'highway', 'hwy', 'parkway', 'pkwy', 'trail', 'trl',
            'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'
          ];

          // Check if name matches any excluded term
          if (excludedTerms.some(ex => nameLower.includes(ex))) return false;

          // Check if any word in the name is an address type word
          if (nameWords.some(word => addressTypeWords.includes(word.replace(/[.,]/g, '')))) return false;

          // Check if any word in the name appears in the input address
          if (nameWords.some(word => {
            const cleanWord = word.replace(/[.,]/g, '');
            return cleanWord.length > 2 && addressWords.includes(cleanWord);
          })) return false;

          // Must be reasonable length
          if (name.length < 5 || name.length >= 35) return false;

          // Can't start with number
          if (name.match(/^\d/)) return false;

          // Must have 2-4 words
          if (nameWords.length < 2 || nameWords.length > 4) return false;

          // Each word should be reasonable (not too short except middle initial)
          for (let i = 0; i < nameWords.length; i++) {
            const word = nameWords[i];
            if (i === 1 && (word.length === 1 || (word.length === 2 && word.endsWith('.')))) continue;
            if (word.length < 2) return false;
          }

          return true;
        };

        // Helper to extract text content safely
        const getText = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : null;
        };

        // Helper to find text containing patterns
        const findTextContaining = (patterns) => {
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );

          const results = [];
          while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim();
            if (text && patterns.some(p => text.toLowerCase().includes(p.toLowerCase()))) {
              results.push({
                text,
                parent: walker.currentNode.parentElement?.tagName,
                className: walker.currentNode.parentElement?.className,
              });
            }
          }
          return results;
        };

        // Look for agent information
        const agentPatterns = ['agent', 'realtor', 'real estate'];
        const agentMatches = findTextContaining(agentPatterns);

        // Look for loan officer information
        const loanPatterns = ['loan officer', 'mortgage', 'nmls', 'lender'];
        const loanMatches = findTextContaining(loanPatterns);

        // Look for contact information (email, phone)
        const contactPatterns = ['@', 'email', 'phone', 'call', 'contact'];
        const contactMatches = findTextContaining(contactPatterns);

        // Extract phone numbers using regex
        const pageText = document.body.innerText;
        const phoneRegex = /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
        const phones = pageText.match(phoneRegex) || [];

        // Extract emails using regex
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = pageText.match(emailRegex) || [];

        // Extract NMLS numbers
        const nmlsRegex = /NMLS\s*#?\s*(\d+)/gi;
        const nmlsMatches = pageText.match(nmlsRegex) || [];

        result.rawData = {
          agentMatches: agentMatches.slice(0, 5),
          loanMatches: loanMatches.slice(0, 5),
          contactMatches: contactMatches.slice(0, 5),
          phones: [...new Set(phones)].slice(0, 5),
          emails: [...new Set(emails)].slice(0, 5),
          nmls: nmlsMatches.slice(0, 3),
        };

        // Try to structure the data
        if (emails.length > 0 || phones.length > 0) {
          result.loanOfficer = {
            name: null,
            email: emails[0] || null,
            phone: phones[0] || null,
            nmls: nmlsMatches[0] ? nmlsMatches[0].replace(/NMLS\s*#?\s*/i, '') : null,
          };

          // Improved name extraction - look for name near contact info elements
          let foundName = null;

          // Strategy 1: Look for name in elements containing loan officer / mortgage consultant text
          const loanOfficerSections = document.querySelectorAll('[class*="loan"], [class*="officer"], [class*="consultant"], [class*="advisor"], [class*="contact"], [class*="agent"], [data-testid*="loan"], [data-testid*="contact"]');
          for (const section of loanOfficerSections) {
            const sectionText = section.innerText || '';
            // Look for name pattern in this section
            const nameMatch = sectionText.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (nameMatch) {
              const name = nameMatch[1].trim();
              if (isValidName(name)) {
                foundName = name;
                break;
              }
            }
          }

          // Strategy 2: Look for name near email address in the DOM
          if (!foundName && emails[0]) {
            const emailElement = document.evaluate(
              `//*[contains(text(), '${emails[0]}')]`,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            ).singleNodeValue;

            if (emailElement) {
              // Check parent and sibling elements for a name
              const parent = emailElement.parentElement?.parentElement || emailElement.parentElement;
              if (parent) {
                const parentText = parent.innerText || '';
                const lines = parentText.split('\n').map(l => l.trim()).filter(l => l);
                for (const line of lines) {
                  // Skip lines that are clearly not names
                  if (line.includes('@') || line.includes('NMLS') || /^\d/.test(line) || line.includes('(')) continue;
                  // Check if line looks like a name (2-4 words, starts with capital)
                  const nameMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/);
                  if (nameMatch) {
                    const name = nameMatch[1].trim();
                    if (isValidName(name)) {
                      foundName = name;
                      break;
                    }
                  }
                }
              }
            }
          }

          // Strategy 3: Look for name near NMLS number
          if (!foundName && nmlsMatches[0]) {
            const nmlsNum = nmlsMatches[0];
            const nmlsIndex = pageText.indexOf(nmlsNum);
            if (nmlsIndex > 0) {
              // Get text around the NMLS number (200 chars before)
              const surroundingText = pageText.substring(Math.max(0, nmlsIndex - 200), nmlsIndex);
              const lines = surroundingText.split('\n').map(l => l.trim()).filter(l => l);
              // Look backwards for a name
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                if (line.includes('@') || line.includes('NMLS') || /^\d/.test(line)) continue;
                const nameMatch = line.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
                if (nameMatch) {
                  const name = nameMatch[1].trim();
                  if (isValidName(name)) {
                    foundName = name;
                    break;
                  }
                }
              }
            }
          }

          // Strategy 4: Fallback - look for name pattern but with better filtering
          if (!foundName) {
            const namePatterns = /([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
            const possibleNames = pageText.match(namePatterns) || [];
            const filteredNames = possibleNames.filter(isValidName);
            if (filteredNames.length > 0) {
              foundName = filteredNames[0];
            }
          }

          // Store debug info about what was found
          result.rawData.foundNameDebug = foundName;
          result.loanOfficer.name = foundName;
        }

        return result;
      }, address);

      L.info('Extracted agent info', {
        hasLoanOfficer: !!agentInfo.loanOfficer,
        emailsFound: agentInfo.rawData.emails?.length || 0,
        phonesFound: agentInfo.rawData.phones?.length || 0,
        emails: agentInfo.rawData.emails,
        phones: agentInfo.rawData.phones,
        name: agentInfo.loanOfficer?.name,
        nmls: agentInfo.rawData.nmls,
        agentMatchCount: agentInfo.rawData.agentMatches?.length || 0,
        loanMatchCount: agentInfo.rawData.loanMatches?.length || 0,
      });

      return {
        ok: true,
        address,
        agent: agentInfo.agent,
        loanOfficer: agentInfo.loanOfficer,
        rawData: agentInfo.rawData,
        scrapedAt: new Date().toISOString(),
        proxyUsed: this.proxyInfo?.type || 'none',
      };

    } catch (err) {
      L.error('Failed to fetch agent', { address, error: err.message });
      return {
        ok: false,
        address,
        error: err.message,
        scrapedAt: new Date().toISOString(),
        proxyUsed: this.proxyInfo?.type || 'none',
      };
    }
  }

  /**
   * Close the bot and cleanup
   */
  async close() {
    L.info('Closing WellsFargoBot...');

    // Close proxy connection if it exists
    if (this.proxyInfo?.close) {
      try {
        await this.proxyInfo.close();
      } catch (err) {
        L.warn('Error closing proxy', { error: err.message });
      }
    }

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        L.warn('Error closing browser', { error: err.message });
      }
    }

    this.initialized = false;
    this.page = null;
    this.browser = null;
    this.proxyInfo = null;
  }
}

/**
 * Get or create the shared bot instance
 */
export async function getSharedBot() {
  if (sharedBot && sharedBot.initialized) {
    return sharedBot;
  }

  if (botInitializing) {
    // Wait for initialization to complete
    let attempts = 0;
    while (botInitializing && attempts < 60) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    if (sharedBot && sharedBot.initialized) {
      return sharedBot;
    }
  }

  botInitializing = true;
  try {
    sharedBot = new WellsFargoBot();
    await sharedBot.init();
    return sharedBot;
  } finally {
    botInitializing = false;
  }
}

/**
 * Reset the shared bot instance
 */
export async function resetBot() {
  if (sharedBot) {
    await sharedBot.close();
    sharedBot = null;
  }
  botInitializing = false;
}

export default WellsFargoBot;
