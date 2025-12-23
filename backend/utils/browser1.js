// utils/browser.js
import puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerExtra from 'puppeteer-extra';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const {
  PUPPETEER_EXECUTABLE_PATH = getDefaultChromePath(),
  PPTR_HEADLESS = 'new',
  PUPPETEER_ARGS = '',
  PUPPETEER_EXTRA_ARGS = '',
  PUPPETEER_PROTOCOL_TIMEOUT_MS = '180000',
  BOFA_BLOCK_MEDIA = '1',
  PUPPETEER_STEALTH = '1',
  CHROME_USER_DATA_DIR = '',
} = process.env;

// enable stealth on top of the stock puppeteer
// enable stealth on top of the stock puppeteer (allow disabling via env)
if (String(PUPPETEER_STEALTH) !== '0') {
  puppeteerExtra.use(StealthPlugin());
}

function makeRunProfile() {
  // If the caller/env pinned a profile, honor it (at your own risk re: SingletonLock)
  if (CHROME_USER_DATA_DIR && CHROME_USER_DATA_DIR.trim()) return CHROME_USER_DATA_DIR.trim();
  const root = process.env.PUPPETEER_TMP_DIR || os.tmpdir();
  const dir = path.join(root, `pptr-profile-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}



// Maximum retry attempts for browser launch failures
const BROWSER_LAUNCH_MAX_RETRIES = 3;
const BROWSER_LAUNCH_RETRY_DELAY_MS = 1000;

// Log Chrome path on first use
let chromePathLogged = false;

export async function launchBrowser(extraArgs = []) {
  // Log Chrome path once at startup
  if (!chromePathLogged) {
    chromePathLogged = true;
    if (PUPPETEER_EXECUTABLE_PATH) {
      console.log(`[browser1] Using Chrome at: ${PUPPETEER_EXECUTABLE_PATH}`);
    } else {
      console.log(`[browser1] No Chrome path found, using puppeteer bundled browser`);
    }
  }

  // Sanitize env-injected args so they don't fight our job-supplied args
  const sanitizedEnvArgs = PUPPETEER_ARGS
    .split(' ')
    .filter(Boolean)
    .filter(a =>
     !a.startsWith('--proxy-server=') &&
      !a.startsWith('--user-data-dir=') &&
      !a.startsWith('--remote-debugging-port=')
    );

  const extraEnvArgs = PUPPETEER_EXTRA_ARGS.split(' ').filter(Boolean);

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1366,800',
    ...sanitizedEnvArgs,
    ...extraEnvArgs,
    // IMPORTANT: job-provided flags (proxy, user-data-dir) come last and win
    ...extraArgs,
    // small safety: keep proxy from bypassing anything local except loopback
    '--proxy-bypass-list=<-loopback>',
        `--user-data-dir=${makeRunProfile()}`,
    '--no-first-run',
    '--no-default-browser-check',
   ];

  // Retry loop for browser launch failures
  let lastError = null;
  for (let attempt = 1; attempt <= BROWSER_LAUNCH_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[browser1] Retry attempt ${attempt}/${BROWSER_LAUNCH_MAX_RETRIES} to launch browser...`);
        await new Promise(resolve => setTimeout(resolve, BROWSER_LAUNCH_RETRY_DELAY_MS));
      }

      const browser = await puppeteerExtra.launch({
        // Only set executablePath if we have a valid path, otherwise let puppeteer use its bundled browser
        ...(PUPPETEER_EXECUTABLE_PATH ? { executablePath: PUPPETEER_EXECUTABLE_PATH } : {}),
        // Normalize to modern headless when env is truthy (your working repro)
        headless:
          (PPTR_HEADLESS === 'false' || PPTR_HEADLESS === false)
            ? false
            : (PPTR_HEADLESS === 'true' || PPTR_HEADLESS === true) ? 'new' : PPTR_HEADLESS,
        args,
        protocolTimeout: Number(PUPPETEER_PROTOCOL_TIMEOUT_MS),
      });

      return browser;
    } catch (error) {
      lastError = error;
      console.error(`[browser1] Browser launch failed (attempt ${attempt}/${BROWSER_LAUNCH_MAX_RETRIES}):`, error.message);

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

export async function newPage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);


  return page;
}

// Call this AFTER the first successful goto() behind the proxy
export async function enableLightInterception(page) {
  if (BOFA_BLOCK_MEDIA !== '1') return;
  try {
    await page.setRequestInterception(true);
    page.removeAllListeners('request');
    page.on('request', req => {
      const t = req.resourceType();
      if (['image', 'media', 'font'].includes(t)) return req.abort();
      req.continue();
    });
  } catch {}
}