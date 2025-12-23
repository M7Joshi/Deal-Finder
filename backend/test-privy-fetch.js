// Test fetching addresses from Privy - STATE level scraping
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const SESSION_FILE = path.join(process.cwd(), 'var/privy-session.json');

function loadSessionCookies() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    console.log('Loaded session cookies from:', SESSION_FILE);
    return data.cookies || [];
  } catch (e) {
    console.log('No saved session found');
    return [];
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const state = process.argv[2] || 'NJ';

  console.log(`\n=== Privy State Scraper ===`);
  console.log(`State: ${state}\n`);

  // Build state-level URL with filters
  const stateUrl = `https://app.privy.pro/dashboard?location_type=state&state=${state}&project_type=buy_hold&list_price_from=20000&list_price_to=600000&beds_from=3&sqft_from=1000&hoa=no&include_detached=true&include_active=true&date_range=all&sort_by=days-on-market&sort_dir=asc`;

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Load session cookies
  const cookies = loadSessionCookies();
  if (cookies.length > 0) {
    console.log('Setting', cookies.length, 'cookies...');
    await page.setCookie(...cookies);
  }

  // Check login status
  console.log('Checking login status...');
  await page.goto('https://app.privy.pro/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('sign_in')) {
    console.log('\n*** Please login manually. Waiting 120 seconds... ***\n');
    try {
      await page.waitForFunction(() => location.pathname.includes('/dashboard'), { timeout: 120000 });
      const newCookies = await page.cookies();
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies: newCookies, savedAt: new Date().toISOString() }, null, 2));
      console.log('Session saved!');
    } catch {
      console.log('Login timeout');
      await browser.close();
      return;
    }
  } else {
    console.log('Already logged in!');
  }

  // Navigate to state URL
  console.log(`\nNavigating to ${state} state view...`);
  await page.goto(stateUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);

  // Wait for clusters to load
  console.log('Waiting for map clusters...');
  try {
    await page.waitForSelector('.cluster.cluster-deal', { timeout: 15000 });
    console.log('Clusters loaded!');
  } catch {
    console.log('No clusters found');
  }
  await sleep(2000);

  // Click on clusters to zoom in and find addresses
  const allAddresses = [];
  console.log('\nClicking clusters to find addresses...');

  for (let attempt = 0; attempt < 15; attempt++) {
    const clusterInfo = await page.evaluate(() => {
      const clusters = document.querySelectorAll('.cluster.cluster-deal');
      if (clusters.length === 0) return { clicked: false, count: 0 };
      clusters[0].click();
      return { clicked: true, count: clusters.length };
    });

    console.log(`  Click ${attempt + 1}: ${clusterInfo.count} clusters`);

    if (!clusterInfo.clicked) break;
    await sleep(2000);

    // Check for property cards
    const hasProps = await page.evaluate(() => {
      return document.querySelectorAll('.property-module, .view-container').length > 0;
    });

    if (hasProps) {
      console.log('  Property cards found!');
      break;
    }
  }

  await sleep(3000);

  // Scroll to load more
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(500);
  }

  // Extract addresses
  console.log('\nExtracting addresses...');
  const addresses = await page.evaluate(() => {
    const results = [];

    // Find property modules
    const modules = document.querySelectorAll('.property-module .content, .property-card');

    for (const el of modules) {
      const line1 = el.querySelector('.address-line1')?.textContent?.trim() || '';
      const line2 = el.querySelector('.address-line2')?.textContent?.trim() || '';
      const fullAddress = line1 && line2 ? `${line1}, ${line2}` : (line1 || line2);

      if (fullAddress && fullAddress.length > 5) {
        const price = el.querySelector('.price')?.textContent?.trim() || '';
        const stats = Array.from(el.querySelectorAll('.quickstat')).map(s => s.textContent?.trim()).filter(Boolean);
        results.push({ fullAddress, price, stats });
      }
    }

    return results;
  });

  console.log(`Found ${addresses.length} addresses`);

  // Add state info
  for (const addr of addresses) {
    allAddresses.push({
      ...addr,
      state: state.toUpperCase(),
      scrapedAt: new Date().toISOString()
    });
  }

  // Results
  console.log('\n========== RESULTS ==========');
  console.log('Total addresses:', allAddresses.length);

  if (allAddresses.length > 0) {
    console.log('\nAddresses:');
    allAddresses.slice(0, 20).forEach((addr, i) => {
      console.log(`\n${i+1}. ${addr.fullAddress}`);
      if (addr.price) console.log(`   Price: ${addr.price}`);
      if (addr.stats?.length) console.log(`   Stats: ${addr.stats.join(' | ')}`);
    });
  } else {
    await page.screenshot({ path: 'privy-debug.png' });
    console.log('Screenshot saved to privy-debug.png');
  }

  // Save session
  const finalCookies = await page.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies: finalCookies, savedAt: new Date().toISOString() }, null, 2));

  console.log('\nBrowser open for 30s...');
  await sleep(30000);

  await browser.close();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
