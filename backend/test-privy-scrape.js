// Quick test script for Privy scraping
import PrivyBot from './vendors/privy/privyBot.js';
import * as sessionStore from './vendors/privy/auth/sessionStore.js';

const PRIVY_STATE_CITIES = {
  'NY': ['New York', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers']
};

function buildPrivyUrl(city, stateCode) {
  const base = 'https://app.privy.pro/dashboard';
  const params = new URLSearchParams({
    search_text: `${city}, ${stateCode}`,
    location_type: 'city',
    project_type: 'buy_hold',
    spread_type: 'arv',
    spread: '50',
    list_price_from: '20000',
    list_price_to: '600000',
    beds_from: '3',
    sqft_from: '1000',
    hoa: 'no',
    include_detached: 'true',
    include_active: 'true',
    date_range: 'all',
    source: 'Any',
    sort_by: 'days-on-market',
    sort_dir: 'asc'
  });
  return `${base}?${params.toString()}`;
}

async function testPrivyScrape() {
  console.log('Starting Privy scrape test...');

  const state = 'NY';
  const limit = 20;
  const cities = PRIVY_STATE_CITIES[state];

  console.log(`Testing with state: ${state}, limit: ${limit}`);
  console.log(`Cities to try: ${cities.join(', ')}`);

  const bot = new PrivyBot();
  await bot.init();

  console.log('Bot initialized, logging in...');
  await bot.login();
  console.log('Logged in successfully!');

  const page = bot.page;
  const globalAddresses = [];

  for (let i = 0; i < cities.length && globalAddresses.length < limit; i++) {
    const city = cities[i];
    console.log(`\n========== City ${i+1}/${cities.length}: ${city}, ${state} ==========`);

    const privyUrl = buildPrivyUrl(city, state);
    console.log(`Navigating to URL...`);

    await page.goto(privyUrl, { waitUntil: 'networkidle0', timeout: 90000 });
    await new Promise(r => setTimeout(r, 3000));

    // Wait for clusters to appear
    try {
      await page.waitForSelector('.cluster.cluster-deal, .cluster', { timeout: 15000 });
      console.log('Clusters found on map!');
    } catch {
      console.log('No clusters found, checking for property cards...');
    }

    // Wait for page to fully stabilize
    console.log('Waiting 10 seconds for page to fully load...');
    await new Promise(r => setTimeout(r, 10000));

    // Click on a cluster to open the property list
    const clusterClicked = await page.evaluate(() => {
      const clusters = document.querySelectorAll('.cluster.cluster-deal, .cluster');
      if (clusters.length > 0) {
        clusters[0].click();
        return { clicked: true, count: clusters.length };
      }
      return { clicked: false, count: 0 };
    });

    console.log(`Clicked cluster: ${JSON.stringify(clusterClicked)}`);

    if (clusterClicked.clicked) {
      // Wait for property list to appear
      console.log('Waiting 8 seconds for property list to load...');
      await new Promise(r => setTimeout(r, 8000));
    }

    // Check if view container appeared
    const hasView = await page.evaluate(() => {
      return document.querySelectorAll('.view-container, .grid-view-container').length > 0;
    });
    console.log(`View container visible: ${hasView}`);

    // Try to extract addresses
    const addresses = await page.evaluate(() => {
      const results = [];

      // Look for property modules in various containers
      const modules = document.querySelectorAll('.property-module, .property-card, .property-item');

      for (const module of modules) {
        const line1El = module.querySelector('.address-line1');
        const line2El = module.querySelector('.address-line2');
        const priceEl = module.querySelector('.price');

        if (line1El && line2El) {
          const line1 = line1El.textContent?.trim() || '';
          const line2 = line2El.textContent?.trim() || '';
          const price = priceEl?.textContent?.trim() || '';

          if (line1 && line2) {
            results.push({
              fullAddress: `${line1}, ${line2}`,
              price
            });
          }
        }
      }

      return results;
    });

    console.log(`Found ${addresses.length} addresses in ${city}`);

    // Add to global
    for (const addr of addresses) {
      if (globalAddresses.length >= limit) break;
      if (!globalAddresses.find(a => a.fullAddress === addr.fullAddress)) {
        globalAddresses.push({
          ...addr,
          city,
          state
        });
      }
    }

    console.log(`Global total: ${globalAddresses.length}/${limit}`);
  }

  console.log('\n========== RESULTS ==========');
  console.log(`Total addresses found: ${globalAddresses.length}`);

  if (globalAddresses.length > 0) {
    console.log('\nSample addresses:');
    globalAddresses.slice(0, 5).forEach((addr, i) => {
      console.log(`${i+1}. ${addr.fullAddress} - ${addr.price}`);
    });
  }

  await bot.close();
  console.log('\nTest complete!');
}

testPrivyScrape().catch(console.error);
