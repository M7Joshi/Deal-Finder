// Quick test script to debug Privy login
import dotenv from 'dotenv';
dotenv.config();

import { loginToPrivy, ensurePrivySession } from './vendors/privy/auth/loginService.js';
import { initSharedBrowser, getSharedPage } from './utils/browser.js';

async function testLogin() {
  console.log('\n=== PRIVY LOGIN DEBUG TEST ===\n');
  console.log('PRIVY_EMAIL:', process.env.PRIVY_EMAIL ? `${process.env.PRIVY_EMAIL.substring(0, 5)}...` : 'NOT SET');
  console.log('PRIVY_PASSWORD:', process.env.PRIVY_PASSWORD ? `[${process.env.PRIVY_PASSWORD.length} chars]` : 'NOT SET');
  console.log('PRIVY_HEADLESS:', process.env.PRIVY_HEADLESS);
  console.log('\n');

  try {
    console.log('1. Initializing browser...');
    const browser = await initSharedBrowser();
    console.log('   Browser initialized');

    console.log('2. Getting shared page...');
    const page = await getSharedPage('privy-test', {
      interceptRules: { block: [] },
      timeoutMs: 90000,
    });
    console.log('   Page created');

    console.log('3. Navigating to Privy sign-in...');
    await page.goto('https://app.privy.pro/users/sign_in', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    console.log('   Navigation complete, URL:', page.url());

    console.log('4. Calling loginToPrivy...');
    const result = await loginToPrivy(page);
    console.log('   Login result:', result);

    console.log('5. Final URL:', page.url());

    if (page.url().includes('dashboard')) {
      console.log('\n✅ SUCCESS! Reached dashboard\n');
    } else if (page.url().includes('sign_in')) {
      console.log('\n❌ FAILED - Still on sign-in page\n');
    } else {
      console.log('\n⚠️ UNKNOWN STATE - URL:', page.url(), '\n');
    }

    // Keep browser open for manual inspection
    console.log('Browser staying open for 60 seconds for inspection...');
    await new Promise(r => setTimeout(r, 60000));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  }

  process.exit(0);
}

testLogin();
