// Quick test script for Privy login
// Run with: node test-privy-login.js

import 'dotenv/config';
import PrivyBot from './vendors/privy/privyBot.js';

async function testPrivyLogin() {
  console.log('='.repeat(50));
  console.log('PRIVY LOGIN TEST (FRESH - LOGOUT FIRST)');
  console.log('='.repeat(50));

  // Show credentials being used (masked)
  const email = process.env.PRIVY_EMAIL || '';
  const password = process.env.PRIVY_PASSWORD || '';

  console.log('\nCredentials:');
  console.log(`  Email: ${email}`);
  console.log(`  Password: ${'*'.repeat(password.length - 2)}${password.slice(-2)} (${password.length} chars)`);
  console.log(`  Password ends with: "${password.slice(-1)}"`);
  console.log(`  Has @: ${password.includes('@')}`);
  console.log(`  Has #: ${password.includes('#')}`);

  if (!email || !password) {
    console.error('\nERROR: PRIVY_EMAIL or PRIVY_PASSWORD not set in .env');
    process.exit(1);
  }

  console.log('\n' + '-'.repeat(50));
  console.log('Starting Privy login test...');
  console.log('Watch the browser window that opens!');
  console.log('-'.repeat(50) + '\n');

  const bot = new PrivyBot();

  try {
    // Initialize browser
    console.log('[1/5] Initializing browser...');
    await bot.init();
    console.log('     Browser initialized OK');

    // First, try to logout if already logged in
    console.log('[2/5] Logging out (clearing session)...');
    try {
      // Clear cookies to force fresh login
      const client = await bot.page.target().createCDPSession();
      await client.send('Network.clearBrowserCookies');
      await client.send('Network.clearBrowserCache');
      console.log('     Cookies and cache cleared');

      // Also try to hit logout endpoint
      await bot.page.goto('https://app.privy.pro/users/sign_out', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }).catch(() => {});
      console.log('     Logout endpoint hit');

      // Wait a moment
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log('     (Logout step skipped:', e.message, ')');
    }

    // Navigate to login page
    console.log('[3/5] Going to login page...');
    await bot.page.goto('https://app.privy.pro/users/sign_in', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    console.log('     On login page');

    // Now attempt fresh login
    console.log('[4/5] Attempting FRESH login...');
    console.log('     (Watch the browser - email and password will be entered)');
    await bot.login();
    console.log('     Login completed!');

    // Check if we're on dashboard
    console.log('[5/5] Checking if on dashboard...');
    const url = bot.page ? await bot.page.url() : 'unknown';
    console.log(`     Current URL: ${url}`);

    if (url.includes('/dashboard')) {
      console.log('\n' + '='.repeat(50));
      console.log('SUCCESS! Fresh Privy login worked!');
      console.log('Password with special chars (@, #) entered correctly!');
      console.log('='.repeat(50));
    } else {
      console.log('\n' + '='.repeat(50));
      console.log('WARNING: Not on dashboard. Check browser.');
      console.log('='.repeat(50));
    }

    // Keep browser open for inspection
    console.log('\nBrowser will stay open for 60 seconds for inspection...');
    console.log('Press Ctrl+C to close earlier.');
    await new Promise(r => setTimeout(r, 60000));

  } catch (error) {
    console.error('\nERROR during login:', error.message);
    console.error(error.stack);

    // Keep browser open on error too
    console.log('\nBrowser staying open for 60s so you can see what happened...');
    await new Promise(r => setTimeout(r, 60000));
  } finally {
    await bot.close().catch(() => {});
    process.exit(0);
  }
}

testPrivyLogin();
