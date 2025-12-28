// --- reuse a logged-in Chrome profile to bypass OTP ---
import { log as rootLog } from '../../../utils/logger.js';
const log = rootLog.child('privy:loginService');
import { initSharedBrowser, getSharedPage, ensureVendorPageSetup, safeGoto } from '../../../utils/browser.js';
import * as sessionStore from './sessionStore.js';

// ---- Headless-prod helpers ----
function maskEmail(e){
  if(!e) return 'null';
  const [u, d] = String(e).split('@');
  if(!d) return e;
  const h = u.length<=2 ? u[0]||'' : u[0] + '*'.repeat(Math.max(1,u.length-2)) + u.slice(-1);
  return `${h}@${d}`;
}

async function dismissOverlays(page){
  // Kill cookie banners / HubSpot / Intercom that can block inputs
  const killers = [
    'button#hs-eu-confirmation-button',
    'button[id*="cookie" i]',
    'button[aria-label*="accept" i]',
    'button[aria-label*="close" i]',
    '.hs-cookie-notification button',
    '.intercom-close-button',
    '.intercom-lightweight-app .intercom-1x9ob3l',
    'button[aria-label*="dismiss" i]'
  ];
  try {
    const frames = [page, ...page.frames()];
    for(const f of frames){
      for(const sel of killers){
        try{ const h = await f.$(sel); if(h){ await h.click({delay:30}); } }catch{}
      }
    }
  } catch {}
}

async function safeType(handle, value, { useDirectSet = false } = {}){
  // For passwords with special characters (@, #, etc.), use direct JS setting first
  if (useDirectSet) {
    try {
      await handle.focus();
      await handle.click({clickCount:3, delay:30});
      await handle.evaluate((el,v)=>{
        el.value = v;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }, value);
      // Verify
      const ok = await handle.evaluate((el,v)=> (el.value||'').toString().trim()===v, value);
      if(ok) return true;
    } catch {}
  }

  // Standard typing approach
  try{
    await handle.focus();
    await handle.click({clickCount:3, delay:30});
    await handle.type(value, {delay:40});
    // verify
    const ok = await handle.evaluate((el,v)=> (el.value||'').toString().trim()===v, value);
    if(ok) return true;
  }catch{}

  // Fallback: set via JS directly
  try{
    await handle.evaluate((el,v)=>{ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }, value);
    return true;
  }catch{}
  return false;
}

async function findInAllFrames(page, selectors, {timeout=8000, visible=true}={}){
  const frames = [page, ...page.frames()];
  const t0 = Date.now();
  while(Date.now()-t0 < timeout){
    for(const f of frames){
      for(const sel of selectors){
        try{
          if(sel.startsWith('//')){ const xs = await f.$x(sel); if(xs && xs[0]) return {frame:f, handle:xs[0], selector:sel}; }
          else { const h = await f.$(sel); if(h){ if(!visible) return {frame:f, handle:h, selector:sel}; const bb = await h.boundingBox(); if(bb && bb.width>0 && bb.height>0) return {frame:f, handle:h, selector:sel}; }
          }
        }catch{}
      }
    }
    await new Promise(r=>setTimeout(r,250));
  }
  return null;
}

import { randomWait } from '../../../helpers.js';
import { signInUrl } from '../config/selection.js';
import { logPrivy } from '../../../utils/logger.js';
import {
  requestOtpCodeDB,
  cancelOtpRequestDB,
  submitOtpCodeDB,
  getOtpStateDB,
  consumeOtpCodeDB,

} from '../../../state/otpState.js';
import { fetchOtpFromEmail } from '../../../services/emailOtpFetcher.js';

// Handle password from .env - strip surrounding quotes if present, handle escapes
let PASSWORD = process.env.PRIVY_PASSWORD || '';
// Remove surrounding quotes if present (dotenv usually handles this, but just in case)
if ((PASSWORD.startsWith('"') && PASSWORD.endsWith('"')) ||
    (PASSWORD.startsWith("'") && PASSWORD.endsWith("'"))) {
  PASSWORD = PASSWORD.slice(1, -1);
}
// Handle backslash-escaped # (e.g., \# -> #)
PASSWORD = PASSWORD.replace(/\\#/g, '#');

// Debug: verify password is loaded correctly (including special chars like #)
if (PASSWORD) {
  const lastChar = PASSWORD.slice(-1);
  log.info('Password loaded from env', {
    length: PASSWORD.length,
    endsWithHash: lastChar === '#',
    lastChar: lastChar
  });
}

let __privyLoginInFlight = false;

// ---- Unified OTP helpers (mirror to DB so FE on Vercel can see it) ----
// ---- Unified OTP helpers (DB-first, resolves via global map) ----
async function requestOtpUnified({
  service = 'privy',
  prompt = 'Enter verification code',
  meta = null,
  timeoutMs = Number(process.env.OTP_REQUEST_TIMEOUT_MS || 120000),
} = {}) {
  // 1) Try to create DB OTP record (non-blocking if DB fails)
  let id = `otp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const dbResult = await Promise.race([
      requestOtpCodeDB({ service, prompt, meta, timeoutMs }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 5000))
    ]);
    if (dbResult?.id) id = dbResult.id;
  } catch (dbErr) {
    log.warn('DB OTP request failed, continuing with email auto-fetch only', { error: dbErr.message });
  }

  // 2) Wait for UI submission via global resolver map
  global.__otpResolvers = global.__otpResolvers || new Map();
  const inMemoryWait = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { global.__otpResolvers.delete(id); } catch {}
      reject(new Error('OTP request timed out'));
    }, timeoutMs);
    global.__otpResolvers.set(id, { resolve, reject, timeout });
  });

  // Cross-process path: poll DB for submittedCode for this id (skip if DB unavailable)
  const dbWait = (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        // Prefer a cheap direct consume to avoid double-reads
        const code = await consumeOtpCodeDB(id);
        if (code) return code;
        // Fallback read (in case consume isn't available yet):
        const s = await getOtpStateDB();
        if (s && s.id === id && s.submittedCode) {
          return s.submittedCode;
        }
      } catch (e) {
        // DB error, skip this iteration
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('OTP request timed out');
  })();

  // 3) Auto-fetch OTP from email (if configured) - PRIMARY METHOD
  const emailFetchWait = (async () => {
    try {
      const autoFetchEnabled = process.env.OTP_AUTO_FETCH_ENABLED !== 'false';
      const hasPassword = !!process.env.GMAIL_IMAP_APP_PASSWORD || !!process.env.GMAIL_PASSWORD;

      if (!autoFetchEnabled || !hasPassword) {
        log.debug('Auto OTP fetch disabled or not configured, skipping email fetch');
        // Return a promise that never resolves (will lose the race)
        return new Promise(() => {});
      }

      log.info('Starting automatic OTP fetch from email...');
      const code = await fetchOtpFromEmail({
        timeoutMs: Math.min(timeoutMs, Number(process.env.OTP_EMAIL_TIMEOUT_MS || 90000)),
      });
      log.info('Auto OTP fetch successful', { code: code.slice(0, 2) + '****' });
      return code;
    } catch (err) {
      log.warn('Auto OTP fetch failed, falling back to manual entry', { error: err.message });
      // Return a promise that never resolves (will lose the race to manual entry)
      return new Promise(() => {});
    }
  })();

  // whichever arrives first (same-process resolver OR DB submission OR email auto-fetch)
  const code = await Promise.race([inMemoryWait, dbWait, emailFetchWait]);

  // 4) Best-effort: mark accepted / clear DB banner
  try { await submitOtpCodeDB({ id, code }); } catch {}
  try { await cancelOtpRequestDB('otp accepted'); } catch {}

  return code;
}

async function cancelOtpUnified(reason = 'OTP request cancelled') {
  try { await cancelOtpRequestDB(reason); } catch {}
  // also clear any local resolver if one exists
  try {
    if (global.__otpResolvers) {
      for (const [otpId, entry] of global.__otpResolvers.entries()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error(reason));
        global.__otpResolvers.delete(otpId);
      }
    }
  } catch {}
}


// --- block noisy 3p scripts & heavy assets to make headless navs reliable ---
export async function enableRequestBlocking(page) {
  try { await page.setRequestInterception(true); } catch {}
  const blockedDomains = [
    'googletagmanager.com','google-analytics.com','www.google-analytics.com',
    'snap.licdn.com','connect.facebook.net','bat.bing.com','redditstatic.com',
    'js.hs-banner.com','js.hsadspixel.net','js.hs-analytics.net','js.hubspot.com',
    'js.hscollectedforms.net','widget.intercom.io','privy.pro/_ub/static/ets/t.js'
  ];
  page.on('request', req => {
    const url = req.url().toLowerCase();
    const type = req.resourceType();
    if (
      type === 'image' || type === 'media' || type === 'font' ||
      blockedDomains.some(d => url.includes(d))
    ) {
      return req.abort().catch(()=>{});
    }
    return req.continue().catch(()=>{});
  });
}

// ---- Soft navigation helpers to avoid networkidle hangs on SPAs ----
async function softGoto(page, url, { t1 = 35000, t2 = 25000 } = {}) {
  const wantHost = new URL(url).host;
  const start = Date.now();

  // Attempt 1: DOMContentLoaded
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: t1 }); } catch {}
  try {
    const cur = page.url();
    if (cur && new URL(cur).host === wantHost) return true;
  } catch {}

  // Attempt 2: 'load'
  try { await page.goto(url, { waitUntil: 'load', timeout: t2 }); } catch {}
  try {
    const cur = page.url();
    if (cur && new URL(cur).host === wantHost) return true;
  } catch {}

  // Attempt 3: fire-and-poll URL OR presence of the form
  await page.goto(url).catch(() => {});
  const maxWait = Math.min(t1 + t2, 45000);
  while (Date.now() - start < maxWait) {
    try {
      const cur = page.url();
      if (cur && new URL(cur).host === wantHost) return true;
      const hasForm = await Promise.race([
        page.$('#user_email'),
        page.$('input[type="email"]'),
        page.$('input[name="user[email]"]')
      ]);
      if (hasForm) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  // Non-fatal — let caller proceed with DOM probes
  return false;
}

async function warmOrigin(page) {
  try { await page.goto('https://app.privy.pro/', { waitUntil: 'domcontentloaded', timeout: 12000 }); } catch {}
}


// ------------- selector pools -------------
const EMAIL_SELECTORS = ['#user_email','input[type="email"]','input[name="user[email]"]','input[id*="email" i]','input[autocomplete="email"]'];
const PASSWORD_SELECTORS = ['#user_password','input[type="password"]','input[name="user[password]"]','input[id*="password" i]'];
const SUBMIT_SELECTORS = [
  '#login_button','button[type="submit"]','button[name="commit"]','button[data-testid*="login"]','button[id*="login"]',
  '//button[contains(., "Continue")]','//button[contains(., "Log in")]','//button[contains(., "Sign in")]',
];
const OTP_INPUT_SELECTORS = [
  'input[autocomplete="one-time-code"]','input[name*="two_factor" i]','input[name*="two-factor" i]',
  'input[name*="otp" i]','input[name*="code" i]','input[id*="otp" i]','input[id*="code" i]',
  'input[type="tel"]','input[aria-label*="verification" i]','input[placeholder*="code" i]',
  'input[maxlength="1"]'
];
const OTP_SUBMIT_SELECTORS = [
  'button[type="submit"]','button[id*="verify" i]','button[name*="verify" i]','button[data-testid*="verify" i]',
  'button[data-action*="verify" i]','#two_factor_submit',
  '//button[contains(., "Verify")]','//button[contains(., "Continue")]','//button[contains(., "Submit")]',
];

// ---- utilities (frame-aware) ----
async function waitForAnySelectorInFrame(frame, selectors, { timeout = 15000, visible = true } = {}) {
  for (const sel of selectors) {
    try {
      if (sel.startsWith('//')) {
        const els = await frame.$x(sel);
        if (els && els[0]) return { handle: els[0], selector: sel, frame };
      } else {
        const h = await frame.waitForSelector(sel, { timeout, visible });
        if (h) return { handle: h, selector: sel, frame };
      }
    } catch {}
  }
  return null;
}

async function waitForAnySelector(page, selectors, opts = {}) {
  const frames = [page, ...page.frames()];
  for (const f of frames) {
    const found = await waitForAnySelectorInFrame(f, selectors, opts);
    if (found) return found;
  }
  return null;
}

async function clickAny(page, selectorsOrXPaths) {
  const frames = [page, ...page.frames()];
  for (const f of frames) {
    for (const s of selectorsOrXPaths.filter(x => !x.startsWith('//'))) {
      try { const el = await f.$(s); if (el) { await el.click({ delay: 50 }); return s; } } catch {}
    }
    for (const xp of selectorsOrXPaths.filter(x => x.startsWith('//'))) {
      try { const els = await f.$x(xp); if (els && els[0]) { await els[0].click({ delay: 50 }); return xp; } } catch {}
    }
  }
  return null;
}

// Click any button or anchor whose text contains one of the provided phrases (case-insensitive)
async function clickByText(page, texts = []) {
  const frames = [page, ...page.frames()];
  const lower = texts.map(t => String(t).toLowerCase());
  for (const f of frames) {
    try {
      const els = await f.$$('a,button,[role="button"]');
      for (const el of els) {
        try {
          const txt = (await f.evaluate(n => (n.textContent || '').toLowerCase().trim(), el));
          if (lower.some(t => txt.includes(t))) {
            await el.click({ delay: 40 });
            return true;
          }
        } catch {}
      }
    } catch {}
  }
  return false;
}

async function resolveOtpInputs(page) {
  // detect 6-box style first
  const multi = await page.$$('input[maxlength="1"]');
  const visibleMulti = [];
  for (const h of multi) {
    try { const box = await h.boundingBox(); if (box && box.width > 0 && box.height > 0) visibleMulti.push(h); } catch {}
  }
  if (visibleMulti.length >= 4) return { type: 'multi', handles: visibleMulti };

  for (const selector of OTP_INPUT_SELECTORS) {
    try {
      const handle = await page.$(selector) || await page.waitForSelector(selector, { timeout: 2000 });
      if (handle) return { type: 'single', handle, selector };
    } catch {}
  }
  return null;
}

async function submitOtpForm(page) {
  const clicked = await clickAny(page, OTP_SUBMIT_SELECTORS);
  if (clicked) return true;
  try { await page.keyboard.press('Enter'); return true; } catch {}
  return false;
}

async function trustThisDeviceIfPresent(page) {
  // This is optional - don't block or fail if checkbox not found
  const candidates = [
    'input[type="checkbox"][name*="trust" i]',
    'input[type="checkbox"][id*="trust" i]',
    'input[type="checkbox"][name*="remember" i]',
    'input[type="checkbox"][id*="remember" i]',
    'label[for*="trust" i]',
    'label[for*="remember" i]',
  ];
  try {
    // Very short timeout - don't wait long, just check if it's there
    const found = await waitForAnySelector(page, candidates, { timeout: 500, visible: true });
    if (found) {
      log.info('Found "Trust this device" checkbox, clicking it');
      try {
        await found.handle.click({ delay: 40 });
        log.info('Clicked "Trust this device" checkbox');
      } catch (e) {
        // Non-fatal - just log and continue
        log.debug('Could not click trust checkbox (non-fatal)', { error: e?.message });
      }
    }
  } catch {
    // Checkbox not found - that's fine, continue without it
  }
}

// ---------- auth probes ----------
function looksLikeOtpUrl(u) {
  // Treat any /sessions/* except /dashboard as MFA stage (covers /sessions/complete, /sessions/code.user, /sessions/validate_code.user, etc.)
  const url = (u || '').toLowerCase();
  if (/\/dashboard/.test(url)) return false;
  if (/\/sessions\/validate_code(\.user)?/.test(url)) return true;
  if (/\/sessions\//.test(url)) return true;
  return /two_factor|otp|verify|code/.test(url);
}

export async function isAuthenticated(page) {
  // CRITICAL: Never go to plain /dashboard - use clean URL to avoid saved search "Below Market" with include_sold=true
  const target = 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true';
  await softGoto(page, target, { t1: 20000, t2: 12000 }).catch(() => {});
  const url = page.url();
  log.debug('Auth probe result', { url });
  const needsLogin = /\/users\/sign_in/i.test(url) || looksLikeOtpUrl(url);
  log.info('Auth check', { finalUrl: url, authenticated: !needsLogin });
  return !needsLogin;
}

// Try to push interstitials into the real OTP screen
async function coerceIntoOtp(page) {
  const url = page.url();
  logPrivy.info('coerceIntoOtp: inspecting', { url });

  // 1) If there’s an obvious “Verify”/“Continue” control, click it.
  await clickAny(page, [
    '//a[contains(., "Verify")]', '//a[contains(., "Continue")]', '//a[contains(., "Code")]',
    'a[href*="/sessions/code"]', 'a[href*="/two_factor"]'
  ]);

  // 2) Try directly hitting expected OTP routes (Privy runs Devise-style sessions)
  const guesses = [
    'https://app.privy.pro/sessions/code.user',
    'https://app.privy.pro/sessions/code',
    'https://app.privy.pro/users/two_factor',
  ];
  for (const guess of guesses) {
    try {
      await softGoto(page, guess, { t1: 8000, t2: 8000 });
      if (await resolveOtpInputs(page)) return true;
    } catch {}
  }

  // 3) Poll current page for OTP inputs (SPA may inject lazily)
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await resolveOtpInputs(page)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// -------------- main flow --------------
export async function loginToPrivy(page) {
  const L = logPrivy.with({ step: 'login' });
  try { page.setDefaultTimeout(90_000); } catch {}

  // Prevent overlapping login attempts in the same process
  if (__privyLoginInFlight) {
    L.info('loginToPrivy: another login is in-flight; waiting for it to finish');
    const t0 = Date.now();
    while (__privyLoginInFlight && Date.now() - t0 < 120000) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  __privyLoginInFlight = true;

  if (!process.env.PRIVY_EMAIL || !PASSWORD) {
    L.error('PRIVY_EMAIL and PRIVY_PASSWORD must be set in your .env file.');
    __privyLoginInFlight = false;
    return false;
  }

  try {
    if (await isAuthenticated(page)) {
      L.success('Already authenticated; skipping login');
      __privyLoginInFlight = false;
      return true;
    }
  } catch {}

  try {
        // stable nav env
    try { await page.setBypassCSP(true); } catch {}
    try { await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }); } catch {}
    try {
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    } catch {}
    // Avoid aggressive blocking during auth to prevent hidden inputs
    // await enableRequestBlocking(page);
    await warmOrigin(page);
    const okNav = await softGoto(page, signInUrl, { t1: 35000, t2: 25000 });
    const url0 = await page.url();
    L.http(okNav ? 'Navigated to sign-in' : 'Proceeding despite partial nav', { currentUrl: url0 });

    // env already stabilized above (avoid flipping UA mid-flow)
    logPrivy.info('Credentials present', { step:'login', email: maskEmail(process.env.PRIVY_EMAIL) });
    await dismissOverlays(page);

    if (url0.includes('sign_in') || /app\.privy\.pro/.test(url0)) {
      // SIMPLIFIED STRATEGY: Don't use two-tab approach as it causes "Detached Frame" errors
      // in headless mode. Instead, wait longer for the page to fully load.
      L.info('On sign-in page, waiting for form to load...');

      // Wait for the page to fully load with longer timeout
      try {
        await page.waitForFunction(() => {
          const emailInput = document.querySelector('#user_email, input[type="email"]');
          return emailInput && emailInput.offsetWidth > 0;
        }, { timeout: 30000 });
        L.info('Email input is visible and ready');
      } catch (e) {
        L.warn('Email input not immediately visible, trying to dismiss overlays...', { error: e?.message });
        await dismissOverlays(page);
        // Try one more time after dismissing overlays
        try {
          await page.waitForFunction(() => {
            const emailInput = document.querySelector('#user_email, input[type="email"]');
            return emailInput && emailInput.offsetWidth > 0;
          }, { timeout: 15000 });
        } catch {}
      }

      await new Promise(r => setTimeout(r, 1000)); // Extra safety wait

      // Email (frame-aware & resilient)
      let email = await findInAllFrames(page, EMAIL_SELECTORS, { timeout: 20000, visible: true });
      if (!email) {
        await dismissOverlays(page);
        email = await findInAllFrames(page, EMAIL_SELECTORS, { timeout: 8000, visible: true });
      }
      if (email && email.handle) {
        // Click to focus first
        try {
          await email.handle.click({ clickCount: 3 });
          await new Promise(r => setTimeout(r, 200));
        } catch {}

        const typed = await safeType(email.handle, process.env.PRIVY_EMAIL);
        if (!typed) {
          // Last resort: brute force set in every matching input
          try {
            await email.frame.evaluate((sels, val)=>{
              for(const s of sels){ const el = document.querySelector(s); if(el){ el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }}
            }, EMAIL_SELECTORS, process.env.PRIVY_EMAIL);
          }catch{}
        }

        // Wait before clicking Continue button
        await new Promise(r => setTimeout(r, 500));

        // Click Continue button - try multiple methods
        L.info('Looking for Continue button...');
        let clicked = false;

        // Method 1: Find button with "Continue" text using page.evaluate
        try {
          clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, input[type="submit"]');
            for (const btn of buttons) {
              const text = (btn.textContent || btn.value || '').toLowerCase();
              if (btn.offsetWidth > 0 && (text.includes('continue') || text.includes('next'))) {
                btn.click();
                return true;
              }
            }
            // Fallback: click button with SVG arrow icon
            for (const btn of buttons) {
              if (btn.querySelector('svg') && btn.offsetWidth > 0) {
                btn.click();
                return true;
              }
            }
            return false;
          });
        } catch {}

        // Method 2: Use existing clickAny function
        if (!clicked) {
          await clickAny(page, SUBMIT_SELECTORS).catch(()=>{});
        }

        // Method 3: Try clickByText
        await clickByText(page, [
          'continue',
          'next',
          'use password',
          'sign in with password',
          'log in with password',
          'continue with password',
          'sign in',
          'log in'
        ]).catch(()=>{});

        // Method 4: Press Enter as last resort
        await email.handle.focus().catch(()=>{});
        await page.keyboard.press('Enter');

        await randomWait(300, 700);

        // Wait for page transition after clicking Continue
        L.info('Waiting for page to transition after Continue click...');
        await new Promise(r => setTimeout(r, 2000));

      } else {
        L.warn('Email input not found on sign_in after waiting; capturing screenshot.');
        try{ await page.screenshot({ path: `/tmp/privy-email-missing-${Date.now()}.png`, fullPage:true }); }catch{}
      }

      // Wait for either password or OTP
      const passOrOtp = await Promise.race([
        waitForAnySelector(page, PASSWORD_SELECTORS, { timeout: 30000, visible: true }),
        waitForAnySelector(page, OTP_INPUT_SELECTORS, { timeout: 30000, visible: true }),
      ]);

      if(!passOrOtp){ await dismissOverlays(page); }

      let isPasswordPath = false;
      if (passOrOtp) {
        try {
          const isPwdType = await passOrOtp.handle.evaluate(n => (n.type || '').toLowerCase() === 'password');
          isPasswordPath = PASSWORD_SELECTORS.includes(passOrOtp.selector) || isPwdType;
        } catch {}
      }

      if (isPasswordPath) {
        L.info('Password field found, entering password using direct JS injection...', {
          passwordLength: PASSWORD?.length,
          endsWithHash: PASSWORD?.slice(-1) === '#'
        });

        // Use direct JavaScript injection to set password value
        // This avoids keyboard issues with special characters like @ and #
        let passwordSet = false;

        // Method 1: Direct JS value injection (most reliable for special chars)
        try {
          await passOrOtp.handle.focus();
          await randomWait(100, 200);

          // Set value directly via JavaScript - bypasses keyboard entirely
          await passOrOtp.handle.evaluate((el, pwd) => {
            el.value = pwd;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Also dispatch keyup for React forms that listen to it
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          }, PASSWORD);

          // Verify the value was set correctly
          const setValue = await passOrOtp.handle.evaluate(el => el.value);
          if (setValue === PASSWORD) {
            passwordSet = true;
            L.info('Password set via direct JS injection - verified correct');
          } else {
            L.warn('Password verification failed', { expected: PASSWORD?.length, got: setValue?.length });
          }
        } catch (e) {
          L.warn('Direct JS injection failed', { error: e.message });
        }

        // Method 2: Fallback to safeType helper if JS injection failed
        if (!passwordSet) {
          try {
            L.info('Trying safeType helper as fallback...');
            passwordSet = await safeType(passOrOtp.handle, PASSWORD, { useDirectSet: true });
            if (passwordSet) {
              L.info('Password set via safeType helper');
            }
          } catch (e) {
            L.warn('safeType fallback failed', { error: e.message });
          }
        }

        // Method 3: Last resort - slow character-by-character typing
        if (!passwordSet) {
          try {
            L.info('Last resort: slow character typing...');
            await passOrOtp.handle.click({ clickCount: 3 });
            await randomWait(100, 200);
            // Type very slowly with longer delays
            for (const char of PASSWORD) {
              await page.keyboard.type(char, { delay: 100 });
              await randomWait(50, 100);
            }
            passwordSet = true;
            L.info('Password typed character by character');
          } catch (e) {
            L.warn('Character-by-character typing failed', { error: e.message });
          }
        }

        await randomWait(500, 800);

        // Check for CAPTCHA before attempting to submit
        const captchaDetected = await page.evaluate(() => {
          // Check for reCAPTCHA
          if (document.querySelector('iframe[src*="recaptcha"]')) return 'reCAPTCHA iframe';
          if (document.querySelector('.g-recaptcha')) return 'reCAPTCHA widget';
          if (document.querySelector('[data-sitekey]')) return 'reCAPTCHA sitekey';
          // Check for hCaptcha
          if (document.querySelector('iframe[src*="hcaptcha"]')) return 'hCaptcha iframe';
          if (document.querySelector('.h-captcha')) return 'hCaptcha widget';
          // Check for Cloudflare Turnstile
          if (document.querySelector('iframe[src*="turnstile"]')) return 'Cloudflare Turnstile';
          if (document.querySelector('.cf-turnstile')) return 'Cloudflare Turnstile widget';
          // Check for generic CAPTCHA elements
          if (document.querySelector('[class*="captcha" i]')) return 'Generic CAPTCHA class';
          if (document.querySelector('[id*="captcha" i]')) return 'Generic CAPTCHA id';
          return null;
        });

        if (captchaDetected) {
          L.error('CAPTCHA detected on login page - automated login blocked', { type: captchaDetected });
          try {
            await page.screenshot({ path: `/tmp/privy-captcha-${Date.now()}.png`, fullPage: true });
            L.info('CAPTCHA screenshot saved');
          } catch (ssErr) {
            L.warn('Failed to save CAPTCHA screenshot', { error: ssErr?.message });
          }
        }

        // Submit the form
        const submitted = await clickAny(page, SUBMIT_SELECTORS);
        L.info('Submit button click result', { clicked: !!submitted, usedSelector: submitted || 'none' });
        if (!submitted) {
          L.warn('No submit button found, pressing Enter key as fallback');
          await page.keyboard.press('Enter');
        }
        L.info('Form submitted');

        // Wait a moment and check if URL changed immediately (indicates form worked)
        await randomWait(2000, 3000);
        const urlAfterSubmit = page.url();
        L.info('URL immediately after submit', { url: urlAfterSubmit, stillOnSignIn: /sign_in/i.test(urlAfterSubmit) });
        await randomWait(1000, 2000);

        // Check for login error messages displayed on the page
        const loginError = await page.evaluate(() => {
          const errorSelectors = [
            '.alert-danger', '.alert-error', '.error-message', '.flash-error',
            '.invalid-feedback', '.form-error', '.login-error', '[data-error]',
            '.notice--error', '.field_with_errors', '.error', '.errors',
            '[role="alert"]', '.alert:not(.alert-success):not(.alert-info)'
          ];
          for (const sel of errorSelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
              const text = el.textContent.trim();
              // Filter out non-error content
              if (text.length > 0 && text.length < 500) return text;
            }
          }
          // Also check for common error text patterns
          const bodyText = document.body?.innerText || '';
          const errorPatterns = [
            /invalid (email|password|credentials)/i,
            /incorrect (email|password)/i,
            /wrong (email|password)/i,
            /authentication failed/i,
            /login failed/i,
            /account (locked|disabled|suspended)/i,
            /too many (attempts|tries)/i
          ];
          for (const pattern of errorPatterns) {
            const match = bodyText.match(pattern);
            if (match) return match[0];
          }
          return null;
        });

        if (loginError) {
          L.error('Login error detected on page', { error: loginError });
          try {
            await page.screenshot({ path: `/tmp/privy-login-error-${Date.now()}.png`, fullPage: true });
            L.info('Screenshot saved for login error');
          } catch (ssErr) {
            L.warn('Failed to save login error screenshot', { error: ssErr?.message });
          }
        }
      }

      // Post-submit: wait for dashboard, OTP markers, or sessions/* interstitials
      try {
        await Promise.race([
          page.waitForFunction(() => location.pathname.includes('/dashboard'), { timeout: 60_000 }),
          waitForAnySelector(page, OTP_INPUT_SELECTORS, { timeout: 60_000, visible: true }),
          page.waitForFunction(() => /\/sessions\//.test(location.pathname), { timeout: 60_000 }),
        ]);
      } catch (e) {
        L.warn('Post-submit wait did not resolve to dashboard or OTP in time', { error: e?.message || String(e) });
        // Capture screenshot for debugging when login times out
        const timeoutUrl = page.url();
        if (/\/users\/sign_in/i.test(timeoutUrl)) {
          L.error('Still on sign_in page after 60s timeout - login likely failed', { url: timeoutUrl });
          try {
            await page.screenshot({ path: `/tmp/privy-login-timeout-${Date.now()}.png`, fullPage: true });
            L.info('Timeout screenshot saved for debugging');
          } catch (ssErr) {
            L.warn('Failed to save timeout screenshot', { error: ssErr?.message });
          }
          // Capture page HTML for debugging
          try {
            const pageContent = await page.evaluate(() => document.body?.innerHTML?.substring(0, 5000) || '');
            L.debug('Page content snippet at timeout', { html: pageContent.substring(0, 1000) });
          } catch {}
        }
      }
    }

    const currentUrl = page.url();
    L.info('Current URL after login step', { currentUrl });

    // Short-circuit: if we already hit the dashboard, skip OTP entirely
    if (/\/dashboard/.test(currentUrl)) {
      L.success('Already on dashboard; skipping OTP flow');

      // Ensure the dashboard actually hydrated before declaring success
      try {
        await page.waitForFunction(
          () => document.querySelector('.properties-found') || location.pathname.includes('/dashboard'),
          { timeout: 45000 }
        );
      } catch (e) {
        L.warn('Dashboard hydration wait timed out; proceeding anyway', { error: e?.message || String(e) });
      }

      // Save Privy cookies for reuse (avoid OTP)
      try { await sessionStore.saveSessionCookies(page); } catch (e) { log.warn('Could not persist Privy session cookies', { error: e?.message }); }

      try { cancelOtpUnified('logged in'); } catch {}
      __privyLoginInFlight = false;
      return true;
    }

    // === OTP branch detection ===
    // IMPORTANT: Only trigger OTP flow if we actually SEE an OTP input field.
    // Don't rely on URL patterns alone - Privy may pass through /sessions/ briefly
    // before auto-redirecting to /dashboard when session is trusted.

    // First, give Privy a moment to auto-redirect if session is trusted
    await randomWait(1500, 2500);
    const urlAfterWait = page.url();

    // If we landed on dashboard after waiting, skip OTP entirely
    if (/\/dashboard/.test(urlAfterWait)) {
      L.success('Auto-redirected to dashboard (session trusted); skipping OTP flow');
      try { await sessionStore.saveSessionCookies(page); } catch (e) { log.warn('Could not persist Privy session cookies', { error: e?.message }); }
      try { cancelOtpUnified('auto logged in'); } catch {}
      __privyLoginInFlight = false;
      return true;
    }

    // Only check for OTP if we're actually seeing OTP inputs (not just URL pattern)
    let onOtpScreen = !!(await waitForAnySelector(page, OTP_INPUT_SELECTORS, { timeout: 3000, visible: true }));

    // If no OTP inputs found but stuck on /sessions/*, try to coerce into OTP
    if (!onOtpScreen && /\/sessions\//.test(urlAfterWait) && !/\/dashboard/.test(urlAfterWait)) {
      L.warn('On sessions/* without visible OTP inputs; checking if OTP is needed…');
      // Wait a bit more - Privy SPA might still be loading
      await randomWait(2000, 3000);

      // Check URL again - might have auto-redirected
      const urlAfterExtraWait = page.url();
      if (/\/dashboard/.test(urlAfterExtraWait)) {
        L.success('Auto-redirected to dashboard after extra wait; skipping OTP');
        try { await sessionStore.saveSessionCookies(page); } catch (e) { log.warn('Could not persist Privy session cookies', { error: e?.message }); }
        try { cancelOtpUnified('auto logged in'); } catch {}
        __privyLoginInFlight = false;
        return true;
      }

      // Still not on dashboard - try to find OTP inputs
      onOtpScreen = await coerceIntoOtp(page);
      L.info('coerceIntoOtp result', { ok: onOtpScreen, at: page.url() });
    }

    if (onOtpScreen) {
      L.warn('Privy requested two-factor authentication; awaiting code from Control Panel.');
      let otpCode;
      try {
        otpCode = await requestOtpUnified({
          service: 'privy',
          prompt: 'Enter the Privy two-factor code',
          meta: { stage: 'login' },
        });
      } catch (err) {
        L.error('OTP request failed', { error: err?.message || String(err) });
        throw err;
      }

      const otpTrimmed = String(otpCode || '').trim();
      if (!otpTrimmed) throw new Error('Received empty OTP code');

      const otpInputs = await resolveOtpInputs(page);
      if (!otpInputs) {
        cancelOtpUnified('Failed to locate OTP input');
        throw new Error('Unable to locate OTP input field on Privy two-factor page');
      }

      // If page offers "Trust this device", enable it to reduce future OTPs
      await trustThisDeviceIfPresent(page);

      if (otpInputs.type === 'multi') {
        for (let i = 0; i < otpTrimmed.length && i < otpInputs.handles.length; i += 1) {
          try {
            await otpInputs.handles[i].focus();
            await otpInputs.handles[i].click({ clickCount: 1, delay: 40 });
            await otpInputs.handles[i].type(otpTrimmed[i], { delay: 60 });
          } catch (err) {
            L.warn('Failed typing OTP digit', { error: err?.message || String(err), index: i });
          }
        }
      } else {
        try {
          await otpInputs.handle.focus();
          await otpInputs.handle.click({ clickCount: 3, delay: 60 });
          await otpInputs.handle.type(otpTrimmed, { delay: 60 });
        } catch (err) {
          L.error('Failed entering OTP code', { error: err?.message || String(err), selector: otpInputs.selector });
          throw err;
        }
      }

      L.info('Submitting OTP…');
      await randomWait(400, 900);
      const submitted = await submitOtpForm(page);
      if (!submitted) L.warn('Could not locate explicit OTP submit control; fall back to Enter key.');

      // Check for "Trust this device" after OTP submission (may appear now)
      await randomWait(500, 1000);
      await trustThisDeviceIfPresent(page);

      // After OTP, allow SPA to push us to dashboard; don't use networkidle
      try {
        await Promise.race([
          page.waitForFunction(() => location.pathname.includes('/dashboard'), { timeout: 90_000 }),
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {}),
        ]);
      } catch (err) {
        L.warn('No navigation detected after OTP submission', { error: err?.message || String(err) });
      }

      // --- New: handle stuck on /sessions/validate_code(.user) after OTP ---
      // If Privy leaves us on a sessions validation route, push through to dashboard
      try {
        const postOtpUrl = page.url();
        if (/\/sessions\/validate_code(\.user)?/i.test(postOtpUrl)) {
          L.warn('Stuck on validate_code after OTP — nudging flow forward', { postOtpUrl });

          // Try any obvious "continue/verify" buttons
          await clickAny(page, [
            '//button[contains(., "Continue")]',
            '//button[contains(., "Verify")]',
            '//a[contains(., "Continue")]',
            '//a[contains(., "Verify")]',
            'button[type="submit"]',
            'button[name*="verify" i]',
            'button[id*="verify" i]',
            'a[href*="/dashboard"]'
          ]);

          // Small wait to allow SPA redirect
          await randomWait(400, 900);

          // Hard nudge to dashboard if still not redirected
          // CRITICAL: Use clean URL to avoid saved search with include_sold=true
          if (!/\/dashboard/.test(page.url())) {
            await softGoto(page, 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true', { t1: 15000, t2: 10000 });
          }
        }
      } catch {}

      // Stop OTP flow if we already arrived at dashboard
      try {
        if (page.url().includes('/dashboard')) {
          L.success('Reached dashboard after OTP');
          try { cancelOtpUnified('otp accepted'); } catch {}
          __privyLoginInFlight = false;
        }
      } catch {}
    }

    // Final convergence on dashboard — tolerate SPA lag
    try {
      await Promise.race([
        page.waitForFunction(() => location.pathname.includes('/dashboard'), { timeout: 30_000 }),
        (async () => {
          // If we are still on a sessions/* route, try one last nudge
          const u = page.url();
          if (/\/sessions\//.test(u) && !/\/dashboard/.test(u)) {
            await clickAny(page, [
              '//button[contains(., "Continue")]',
              '//button[contains(., "Verify")]',
              'button[type="submit"]',
              'a[href*="/dashboard"]'
            ]);
            // CRITICAL: Use clean URL to avoid saved search with include_sold=true
            await softGoto(page, 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true', { t1: 12000, t2: 8000 });
          }
        })()
      ]);
    } catch {}

    const finalUrl = page.url();
    L.info('Final URL after login', { finalUrl });

    // If we didn't get an explicit dashboard URL, re-check auth once more
    if (!finalUrl.includes('dashboard')) {
      try {
        if (await isAuthenticated(page)) {
          L.success('Privy session is authenticated (post-OTP), proceeding without explicit dashboard URL');
          try { cancelOtpUnified('login successful (implicit)'); } catch {}
          __privyLoginInFlight = false;
          return true;
        }
      } catch {}
    }

    if (finalUrl.includes('dashboard') && !finalUrl.includes('sign_in')) {
      L.success('Successfully logged in to Privy');

      // Ensure the dashboard actually hydrated before declaring success
      try {
        await page.waitForFunction(
          () => document.querySelector('.properties-found') || location.pathname.includes('/dashboard'),
          { timeout: 45000 }
        );
      } catch (e) {
        L.warn('Dashboard hydration wait timed out; proceeding anyway', { error: e?.message || String(e) });
      }

      // Save Privy cookies for reuse (avoid OTP)
      try { await sessionStore.saveSessionCookies(page); } catch (e) { log.warn('Could not persist Privy session cookies', { error: e?.message }); }

      try { cancelOtpUnified('login successful'); } catch {}
      __privyLoginInFlight = false;
      return true;
    }
  } catch (error) {
    __privyLoginInFlight = false;
    try{ await page.screenshot({ path: `/tmp/privy-login-fail-${Date.now()}.png`, fullPage:true }); }catch{}
    try {
      const html = await page.content();
      logPrivy.debug('Privy login DOM snippet', { head: html.slice(0, 4000) });
    } catch {}
    logPrivy.error('An error occurred during login', { error: error.message, at: new Date().toISOString() });
  }
  __privyLoginInFlight = false;
  return false;
}

export async function ensurePrivySession() {
  const browser = await initSharedBrowser();
  const page = await getSharedPage('privy-login', {
    interceptRules: { block: [] }, // don't block CSS/images on auth
    timeoutMs: 90000,
    viewport: { width: 1280, height: 900 },
    allowlistDomains: ['privy.pro','app.privy.pro','static.privy.pro','cdn.privy.pro'],
  });
  await ensureVendorPageSetup(page, { randomizeUA: true, jitterViewport: true, timeoutMs: 90000 });

  // Try session reuse via saved cookies first
  try {
    const jar = sessionStore.readPrivySession();
    if (jar?.cookies?.length) await page.setCookie(...jar.cookies);
  } catch {}

  if (await isAuthenticated(page)) {
    try { await sessionStore.saveSessionCookies(page); } catch {}
    return { browser, page, authenticated: true };
  }

  const ok = await loginToPrivy(page);
  return { browser, page, authenticated: !!ok };
}