// backend/vendors/redfin/sitemapEnumerator.js
import * as cheerio from 'cheerio';
import { fetchHtml } from './fetcher.js';

// Enumerate cities by crawling state landing pages (avoids blocked sitemap).
// State strings are URL-ready for Redfin (e.g., New-York, New-Jersey).

// Blocked states - excluded from scraping (match Deals.tsx BLOCKED_STATES)
// SD, AK, ND, WY, HI, UT, NM, OH, MT
const BLOCKED_STATES = [
  'South-Dakota', 'Alaska', 'North-Dakota', 'Wyoming', 'Hawaii',
  'Utah', 'New-Mexico', 'Ohio', 'Montana'
];

// 41 allowed states (50 - 9 blocked)
const US_STATES = [
  'Alabama','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
  'Florida','Georgia','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
  'Missouri','Nebraska','Nevada','New-Hampshire','New-Jersey',
  'New-York','North-Carolina','Oklahoma','Oregon','Pennsylvania',
  'Rhode-Island','South-Carolina','Tennessee','Texas','Vermont',
  'Virginia','Washington','West-Virginia','Wisconsin'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = () => 150 + Math.floor(Math.random() * 250);

// Get states to scrape from env var or use all
// Examples:
//   REDFIN_STATES=Texas,Florida,Georgia - specific states
//   STATE_START=41 - start from 41st state (Vermont)
//   STATE_LIMIT=5 - only scrape 5 states
function getStatesToScrape() {
  const envStates = process.env.REDFIN_STATES || '';
  if (envStates.trim()) {
    // Parse comma-separated list and normalize to URL format
    const requested = envStates.split(',').map(s => s.trim().replace(/\s+/g, '-'));
    // Filter to only valid states
    const valid = requested.filter(s => US_STATES.includes(s));
    if (valid.length > 0) {
      console.log(`[Redfin] Using REDFIN_STATES: ${valid.join(', ')}`);
      return valid;
    }
    console.warn(`[Redfin] Invalid REDFIN_STATES: ${envStates}, using STATE_START/STATE_LIMIT instead`);
  }

  // STATE_START: which state number to start from (1-based, default 1 = Alabama)
  // STATE_LIMIT: how many states to scrape (default all remaining)
  const stateStart = Math.max(1, Number(process.env.STATE_START || '1')) - 1; // Convert to 0-based index
  const stateLimit = Number(process.env.STATE_LIMIT || '0') || (US_STATES.length - stateStart);

  const limited = US_STATES.slice(stateStart, stateStart + stateLimit);
  console.log(`[Redfin] Scraping states ${stateStart + 1} to ${stateStart + limited.length}: ${limited.join(', ')}`);
  return limited;
}

// Extract city name from URL for sorting
// URL format: https://www.redfin.com/city/30869/FL/Orlando -> "Orlando"
function getCityNameFromUrl(url) {
  try {
    const parts = url.split('/');
    // Last part is the city name
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

export async function getCityUrls(limit) {
  const pickStates = getStatesToScrape();
  // Sort states alphabetically
  pickStates.sort((a, b) => a.localeCompare(b));

  const seen = new Set();
  const out = [];

  for (const state of pickStates) {
    const url = `https://www.redfin.com/state/${state}`;
    let html;
    try {
      // HTML only; no render needed here
      html = await fetchHtml(url, { render: false });
    } catch (e) {
      console.warn(`State fetch failed: ${state} -> ${e.message}`);
      continue;
    }

    // Collect cities for this state
    const stateCities = [];
    const $ = cheerio.load(html);
    $('a[href^="/city/"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      // Example: /city/30869/FL/Orlando
      if (!href || !href.startsWith('/city/')) return;
      const full = new URL(href, 'https://www.redfin.com').toString();
      if (!seen.has(full)) {
        seen.add(full);
        stateCities.push({ url: full, lastmod: null, state, cityName: getCityNameFromUrl(full) });
      }
    });

    // Sort cities alphabetically within this state
    stateCities.sort((a, b) => a.cityName.localeCompare(b.cityName));
    out.push(...stateCities);

    console.log(`[Redfin] ${state}: found ${stateCities.length} cities (sorted A-Z)`);

    // Tiny pause between states to be polite
    await sleep(jitter());
  }

  console.log(`[Redfin] Total: ${out.length} cities across ${pickStates.length} states (alphabetical order)`);
  return limit ? out.slice(0, limit) : out;
}