/**
 * Redfin -> BofA Loop Automation
 *
 * Flow:
 * 1. Fetch 500 addresses from Redfin
 * 2. Run BofA on those addresses
 * 3. Take 2 minute break
 * 4. Repeat
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3015';
const REDFIN_LIMIT = parseInt(process.env.REDFIN_LIMIT || '500', 10);
const BREAK_MS = parseInt(process.env.BREAK_MS || '120000', 10); // 2 minutes
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// States to cycle through (can be overridden via env)
const STATES = (process.env.STATES || 'TX,FL,CA,AZ,GA,NC,OH,PA,IL,MI').split(',').map(s => s.trim());

let currentStateIndex = 0;
let loopCount = 0;

function log(msg, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}

function getNextState() {
  const state = STATES[currentStateIndex];
  currentStateIndex = (currentStateIndex + 1) % STATES.length;
  return state;
}

async function fetchRedfin(state, limit) {
  log(`Fetching ${limit} addresses from Redfin for ${state}...`);

  try {
    const url = `${BASE_URL}/api/live-scrape/redfin?state=${state}&limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5 min timeout
    });

    const data = await response.json();

    if (data.ok) {
      log(`Redfin fetch complete`, {
        state,
        addressCount: data.addresses?.length || data.count || 0,
        citiesScraped: data.citiesScraped?.length || 0,
      });
      return data;
    } else {
      log(`Redfin fetch failed`, { error: data.error || 'Unknown error' });
      return null;
    }
  } catch (err) {
    log(`Redfin fetch error`, { error: err.message });
    return null;
  }
}

async function runBofaJob() {
  log('Starting BofA AMV job...');

  try {
    // Trigger the scraped_deals_amv job
    const url = `${BASE_URL}/api/automation/run/scraped_deals_amv`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
        'Content-Type': 'application/json',
      },
      timeout: 600000, // 10 min timeout
    });

    const data = await response.json();

    if (data.ok || data.success) {
      log(`BofA job complete`, {
        processed: data.processed || data.count || 0,
        success: data.success || 0,
        failed: data.failed || 0,
      });
      return data;
    } else {
      log(`BofA job failed`, { error: data.error || 'Unknown error' });
      return null;
    }
  } catch (err) {
    log(`BofA job error`, { error: err.message });
    return null;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLoop() {
  log('='.repeat(60));
  log(`Starting loop #${++loopCount}`);
  log('='.repeat(60));

  const state = getNextState();

  // Step 1: Fetch from Redfin
  const redfinResult = await fetchRedfin(state, REDFIN_LIMIT);

  if (!redfinResult) {
    log('Redfin failed, skipping BofA and continuing...');
  } else {
    // Step 2: Run BofA on the addresses
    await runBofaJob();
  }

  // Step 3: Take a break
  const breakMins = Math.round(BREAK_MS / 60000);
  log(`Taking ${breakMins} minute break...`);
  await sleep(BREAK_MS);

  // Step 4: Repeat
  runLoop();
}

// Start the loop
log('='.repeat(60));
log('Redfin -> BofA Loop Automation Started');
log('='.repeat(60));
log('Configuration:', {
  baseUrl: BASE_URL,
  redfinLimit: REDFIN_LIMIT,
  breakMinutes: Math.round(BREAK_MS / 60000),
  states: STATES.join(', '),
});
log('');

runLoop().catch(err => {
  log('Fatal error in loop', { error: err.message });
  process.exit(1);
});
