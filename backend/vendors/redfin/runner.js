import 'dotenv/config';
import { fetchHtml } from './fetcher.js';
import { parseIndexHtml } from './indexParser.js';
import { parseDetailHtml } from './detailParser.js';
import { getCityUrls } from './sitemapEnumerator.js';
import { FILTERS, passesAll } from './filters.js';
import { propIdFromUrl, toNumberOrNull, parseBeds, parseBaths, cityFromAddress } from './normalize.js';
import { upsertRaw, upsertProperty, shouldPauseScraping } from './save.js';
import { extractAgentDetails } from './agentExtractor.js';

// Import control object for abort checking
import { control } from '../runAutomation.js';

// Whether to use deep scraping for agent details (slower but more accurate)
// Set REDFIN_ENRICH_AGENTS=1 to enable Puppeteer-based agent extraction
const USE_AGENT_ENRICHMENT = String(process.env.REDFIN_ENRICH_AGENTS || '1') === '1';

function uniqueByUrl(arr) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    if (!it?.url) continue;
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

function applyUrlFilters(url) {
  const seg = process.env.REDFIN_FILTER_SEGMENT;
  if (!seg) return url;
  // if URL already has a filter segment, leave it alone
  if (url.includes('/filter/')) return url;
  // insert `/filter/<segment>` after the city path
  // e.g., https://www.redfin.com/city/1823/AL/Birmingham → .../Birmingham/filter/<seg>
  return url.replace(/\/?$/, '') + '/filter/' + seg;
}

async function enumerateIndexPages(cityUrl) {
  const maxPages = Number(process.env.MAX_INDEX_PAGES_PER_CITY || '1');
  const forceFirstRender = String(process.env.REDFIN_FORCE_RENDER || '1') === '1';

  const all = [];
  let page = 1;
  let lastCount = 0;

  while (page <= maxPages) {
    const url = page === 1 ? cityUrl : `${cityUrl.replace(/\/$/, '')}/page-${page}`;
    let html;
    try {
      // First page: render=true to punch through; subsequent pages usually fine without render
      const render = page === 1 ? forceFirstRender : false;
      html = await fetchHtml(url, { render });
    } catch (e) {
      console.warn(`Index fetch failed: ${url} -> ${e.message}`);
      break;
    }

    const items = parseIndexHtml(html);
    if (!items.length) {
      console.log(`No items on page ${page}; stopping pagination.`);
      break;
    }

    // Append & de-dupe
    const before = all.length;
    all.push(...items);
    const deduped = uniqueByUrl(all);
    const gained = deduped.length - before;
    all.length = 0; all.push(...deduped);

    console.log(`Page ${page}: found ${items.length} (new: ${gained})`);

    // Stop if no growth vs. last iteration (safety)
    if (all.length === lastCount) {
      console.log(`No additional unique listings after page ${page}; stopping.`);
      break;
    }
    lastCount = all.length;
    page += 1;
  }

  return all;
}

export async function runCity(cityUrl) {
  const maxListings = Number(process.env.MAX_LISTINGS_PER_CITY || '500');

  console.log(`\n=== City: ${cityUrl} ===`);

// Fetch page 1..N and merge
const listings = await enumerateIndexPages(cityUrl);
console.log(`Found ${listings.length} index listings (all pages)`);

  let processed = 0;
  let fetched = 0;
  let passed = 0;
  let saved = 0;
  let filteredOut = 0;
  let detailErrors = 0;

  // allow tuning delay via env to reduce blocks on large crawls
  const BASE_JITTER = Number(process.env.REDFIN_JITTER_MS || '0');
  const jitter = () => (BASE_JITTER || (75 + Math.floor(Math.random() * 125)));

  for (const it of listings) {
    if (processed >= maxListings) break;
    processed++;

    try {
      // small pause between detail requests
      await new Promise(r => setTimeout(r, jitter()));

      const forceDetailRender = process.env.REDFIN_DETAIL_RENDER === '1';
      const detailHtml = await fetchHtml(it.url, { render: forceDetailRender });
      fetched++;
      if (processed % 10 === 0) {
        console.log(`Progress: processed=${processed} fetched=${fetched} saved=${saved} filtered=${filteredOut} errors=${detailErrors}`);
      }

      const d = parseDetailHtml(detailHtml);

      // Merge index + detail values
      const price = d.price ?? toNumberOrNull(it.priceText);
      const sqft  = d.sqft ?? toNumberOrNull(it.sqftText);
      const beds  = d.beds ?? parseBeds(it.bedsText || '');
      const baths = d.baths ?? parseBaths(it.bathsText || '');

      // Apply filters (can be disabled via env; see Patch 2)
      const ok = passesAll({
        price,
        sqft,
        beds,
        hoa: d.hoa ?? null,
        listedAt: d.listedAt ?? null,
        description: d.description ?? '',
        remarks: d.remarks ?? '',
        propertyType: d.propertyType ?? '',
        tags: d.tags ?? [],
        keyFacts: d.keyFacts ?? []
      });

      if (!ok) { filteredOut++; continue; }
      passed++;

      const address = (it.address || '').trim();
      const city    = cityFromAddress(address);
      const prop_id = propIdFromUrl(it.url);

      // Try to get agent details from basic parse first
      let agentName = d.agentName ?? null;
      let agentEmail = d.agentEmail ?? null;
      let agentPhone = d.agentPhone ?? null;
      let brokerage = d.brokerage ?? null;

      // Use Puppeteer deep scraping for agent details if enabled (more accurate)
      if (USE_AGENT_ENRICHMENT && it.url) {
        try {
          console.log(`[Redfin] Deep scraping agent details for: ${it.url}`);
          const enriched = await extractAgentDetails(it.url);
          if (enriched) {
            agentName = enriched.agentName || agentName;
            agentPhone = enriched.phone || agentPhone;
            agentEmail = enriched.email || agentEmail;
            brokerage = enriched.brokerage || brokerage;
            console.log(`[Redfin] Agent enriched: ${agentName} | ${agentPhone} | ${brokerage}`);
          }
        } catch (enrichErr) {
          console.warn(`[Redfin] Agent enrichment failed for ${it.url}: ${enrichErr.message}`);
        }
      }

      await upsertRaw({
        address, city, state: '', zip: '',
        price, beds, baths, sqft,
        raw: d.raw || {},
        agentName,
        agentEmail
      });

      await upsertProperty({
        prop_id,
        address, city, state: '', zip: '',
        price, beds, baths, sqft, built: d.built ?? null,
        raw: d.raw || {},
        agentName,
        agentEmail,
        agentPhone,
        brokerage,
      });

      saved++;
      console.log(`✔ Saved ${prop_id} | ${address || '(no address)'} | $${price ?? 'NA'} | ${beds ?? '?'}bd/${baths ?? '?'}ba | Agent: ${agentName || 'N/A'} | Phone: ${agentPhone || 'N/A'}`);

      // Check if we should stop (batch limit reached or abort requested)
      if (control.abort) {
        console.log('[Redfin] Abort signal received, stopping city scrape');
        break;
      }
      if (shouldPauseScraping()) {
        console.log('[Redfin] Batch limit reached (500 addresses), pausing to process AMV');
        break;
      }
    } catch (e) {
      detailErrors++;
      console.warn(`Detail failed for ${it.url}: ${e.message}`);
    }
  }

  console.log(`City summary -> processed:${processed} fetched:${fetched} passed:${passed} saved:${saved} filtered:${filteredOut} errors:${detailErrors}`);
}

export async function runAllCities() {
  const maxCities = Number(process.env.MAX_CITIES || '0') || undefined;
  const cities = await getCityUrls(maxCities);
  console.log(`Total cities: ${cities.length}`);

  for (const c of cities) {
    // Check abort/batch limit before each city
    if (control.abort) {
      console.log('[Redfin] Abort signal received, stopping all cities');
      break;
    }
    if (shouldPauseScraping()) {
      console.log('[Redfin] Batch limit reached, stopping to process AMV');
      break;
    }

    await runCity(c.url);
  }
}