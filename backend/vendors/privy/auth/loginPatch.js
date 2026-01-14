// Quick login function - handles Privy's two-step login (email -> continue -> password -> submit)
import { logPrivy } from '../../../utils/logger.js';

const PASSWORD = (() => {
  let pwd = process.env.PRIVY_PASSWORD || '';
  if ((pwd.startsWith('"') && pwd.endsWith('"')) || (pwd.startsWith("'") && pwd.endsWith("'"))) {
    pwd = pwd.slice(1, -1);
  }
  pwd = pwd.replace(/\\#/g, '#');
  return pwd;
})();

const EMAIL_SELECTORS = ['#user_email', 'input[type="email"]', 'input[name="user[email]"]', 'input[id*="email" i]'];
const PASSWORD_SELECTORS = ['#user_password', 'input[type="password"]', 'input[name="user[password]"]', 'input[id*="password" i]'];
const SUBMIT_SELECTORS = ['#login_button', 'button[type="submit"]', 'button[name="commit"]', 'button[data-testid*="login"]'];
const OTP_SELECTORS = ['input[autocomplete="one-time-code"]', 'input[name*="otp" i]', 'input[name*="code" i]', 'input[maxlength="1"]', 'input[maxlength="6"]'];

async function findElement(page, selectors, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const box = await el.boundingBox();
          if (box && box.width > 0 && box.height > 0) return el;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// Find button by text content
async function findButtonByText(page, texts, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const buttons = await page.$$('button, a[role="button"], input[type="submit"]');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent || el.value || '');
        for (const t of texts) {
          if (text.toLowerCase().includes(t.toLowerCase())) {
            const box = await btn.boundingBox();
            if (box && box.width > 0 && box.height > 0) return btn;
          }
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// Returns { success: boolean|'otp_required', page: Page } so caller can update their page reference
export async function quickLogin(page) {
  const L = logPrivy.with({ step: 'quickLogin' });
  const email = process.env.PRIVY_EMAIL;

  if (!email || !PASSWORD) {
    L.error('PRIVY_EMAIL and PRIVY_PASSWORD must be set');
    return { success: false, page };
  }

  L.info('Starting quick login (two-step flow)...', { email: email.substring(0, 3) + '***', pwdLength: PASSWORD.length });

  // STRATEGY: First tab often gets stuck. Wait 5 seconds then create second tab.
  const firstPage = page;
  L.info('Waiting 5 seconds then creating fresh second tab...');
  await new Promise(r => setTimeout(r, 5000));

  // Create second tab - ALWAYS use the second tab since first tab often gets stuck
  let activePage = page;
  try {
    const { initSharedBrowser } = await import('../../../utils/browser.js');
    const browser = await initSharedBrowser();
    const newPage = await browser.newPage();
    newPage.__df_name = 'privy';

    L.info('Navigating second tab to sign-in...');
    await newPage.goto('https://app.privy.pro/users/sign_in', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check if we're already on dashboard (session was remembered)
    const newPageUrl = newPage.url();
    if (newPageUrl.includes('dashboard')) {
      L.info('Already on dashboard - session was remembered! Closing first tab.');
      try { await firstPage.close(); } catch {}
      activePage = newPage;
      return { success: true, page: activePage };
    }

    // Wait for email input on second tab - give it more time (15 seconds)
    L.info('Waiting for email input on second tab...');
    const emailInput2 = await findElement(newPage, EMAIL_SELECTORS, 15000);
    if (emailInput2) {
      L.info('Second tab ready - closing first tab');
      try { await firstPage.close(); } catch {}
      activePage = newPage;
    } else {
      // Check again if we ended up on dashboard after redirect
      const urlAfterWait = newPage.url();
      if (urlAfterWait.includes('dashboard')) {
        L.info('Redirected to dashboard - session valid! Closing first tab.');
        try { await firstPage.close(); } catch {}
        activePage = newPage;
        return { success: true, page: activePage };
      }
      // Even if not ready, still use second tab - first tab is usually stuck
      L.warn('Second tab email not found yet, but using it anyway (first tab usually stuck)');
      try { await firstPage.close(); } catch {}
      activePage = newPage;
    }
  } catch (e) {
    L.warn('Could not create second tab, using first', { error: e?.message });
  }

  // Step 1: Find and fill email (on active page)
  const emailInput = await findElement(activePage, EMAIL_SELECTORS, 15000);
  if (!emailInput) {
    L.error('Email input not found');
    return { success: false, page: activePage };
  }

  L.info('Found email input, entering email...');
  await emailInput.click({ clickCount: 3 });
  await new Promise(r => setTimeout(r, 200));

  // Use direct JS value setting
  await emailInput.evaluate((el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, email);

  await new Promise(r => setTimeout(r, 500));

  // Step 2: Click "Continue" button to proceed to password step
  L.info('Looking for Continue button...');

  // SCREENSHOTS DISABLED
  // try {
  //   await activePage.screenshot({ path: `c:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/privy-before-continue-${Date.now()}.png`, fullPage: true });
  //   L.info('Screenshot saved before Continue click');
  // } catch {}

  let continueBtn = await findButtonByText(activePage, ['Continue', 'Next', 'Submit'], 5000);
  if (!continueBtn) {
    // Fallback to generic submit button
    continueBtn = await findElement(activePage, SUBMIT_SELECTORS, 3000);
  }

  if (continueBtn) {
    // Log button details
    const btnInfo = await continueBtn.evaluate(el => ({
      tagName: el.tagName,
      text: el.textContent,
      type: el.type,
      disabled: el.disabled,
      className: el.className,
      id: el.id
    }));
    L.info('Found Continue button', btnInfo);

    // Scroll into view and use multiple click methods for reliability
    await continueBtn.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await new Promise(r => setTimeout(r, 300));

    // Try regular click first
    try {
      await continueBtn.click({ delay: 100 });
      L.info('Clicked Continue button (regular click)');
    } catch (e) {
      L.warn('Regular click failed, trying JS click', { error: e?.message });
      // Fallback to JS click
      await continueBtn.evaluate(el => el.click());
      L.info('Clicked Continue button (JS click)');
    }
  } else {
    L.info('No Continue button found, pressing Enter');
    await activePage.keyboard.press('Enter');
  }

  // Wait a moment for the click to register
  await new Promise(r => setTimeout(r, 1500));

  // SCREENSHOTS DISABLED - uncomment to re-enable
  // try {
  //   await activePage.screenshot({ path: `c:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/privy-after-continue-${Date.now()}.png`, fullPage: true });
  //   L.info('Screenshot saved after Continue click');
  // } catch {}

  // Step 3: Wait for password field to appear (this is the key - need longer wait)
  L.info('Waiting for password field to appear...');
  await new Promise(r => setTimeout(r, 2000)); // Give page time to transition

  const pwdInput = await findElement(activePage, PASSWORD_SELECTORS, 30000);

  if (!pwdInput) {
    // Check if we're on OTP flow instead (no password, just OTP)
    const otpInput = await findElement(activePage, OTP_SELECTORS, 3000);
    if (otpInput) {
      L.info('OTP flow detected instead of password');
      return { success: 'otp_required', page: activePage };
    }

    // Check if we accidentally got to dashboard (session remembered)
    if (activePage.url().includes('dashboard')) {
      L.info('Already on dashboard - session was remembered');
      return { success: true, page: activePage };
    }

    L.error('Password input not found after 30 seconds');
    // SCREENSHOTS DISABLED - uncomment to re-enable
    // try {
    //   await activePage.screenshot({ path: `c:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/privy-no-pwd-${Date.now()}.png`, fullPage: true });
    //   L.info('Screenshot saved');
    // } catch {}
    return { success: false, page: activePage };
  }

  L.info('Found password input, entering password...', { length: PASSWORD.length });
  await pwdInput.click({ clickCount: 3 });
  await new Promise(r => setTimeout(r, 200));

  // Use direct JS value setting for password
  await pwdInput.evaluate((el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }, PASSWORD);

  // Verify password was set
  const pwdSet = await pwdInput.evaluate((el, expected) => el.value === expected, PASSWORD);
  L.info('Password set verification', { success: pwdSet });

  if (!pwdSet) {
    L.warn('Password verification failed, trying type method...');
    await pwdInput.click({ clickCount: 3 });
    await pwdInput.type(PASSWORD, { delay: 50 });
  }

  await new Promise(r => setTimeout(r, 500));

  // Step 4: Click submit/login button
  L.info('Looking for submit button...');
  let submitBtn = await findButtonByText(activePage, ['Log in', 'Login', 'Sign in', 'Submit', 'Continue'], 5000);
  if (!submitBtn) {
    submitBtn = await findElement(activePage, SUBMIT_SELECTORS, 3000);
  }

  if (submitBtn) {
    await submitBtn.click();
    L.info('Clicked submit button');
  } else {
    L.info('No submit button found, pressing Enter');
    await activePage.keyboard.press('Enter');
  }

  // Step 5: Wait for navigation to dashboard or OTP page
  L.info('Waiting for login to complete...');

  try {
    await Promise.race([
      activePage.waitForFunction(() => location.pathname.includes('/dashboard'), { timeout: 45000 }),
      activePage.waitForFunction(() => /\/sessions\//.test(location.pathname), { timeout: 45000 }),
      activePage.waitForNavigation({ timeout: 45000 }).catch(() => {})
    ]);
  } catch (e) {
    L.warn('Login wait timeout', { error: e?.message });
  }

  const finalUrl = activePage.url();
  L.info('Login result', { finalUrl });

  // Check if we're on dashboard
  if (finalUrl.includes('dashboard')) {
    L.success('Login successful - on dashboard');
    return { success: true, page: activePage };
  }

  // Check if OTP is required
  if (finalUrl.includes('sessions') || finalUrl.includes('two_factor') || finalUrl.includes('otp')) {
    L.info('OTP flow detected - checking for OTP input');
    const otpInput = await findElement(activePage, OTP_SELECTORS, 5000);
    if (otpInput) {
      return { success: 'otp_required', page: activePage };
    }
  }

  // Still on sign_in means credentials were rejected
  if (finalUrl.includes('sign_in')) {
    L.error('Still on sign-in page - credentials may be incorrect');
    // SCREENSHOTS DISABLED - uncomment to re-enable
    // try {
    //   await activePage.screenshot({ path: `c:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/privy-login-failed-${Date.now()}.png`, fullPage: true });
    // } catch {}
    return { success: false, page: activePage };
  }

  return { success: finalUrl.includes('dashboard'), page: activePage };
}
