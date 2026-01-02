import 'dotenv/config';
import axios from 'axios';
import { fetchListingsFromApi, closeSharedBrowser as closeFetcherBrowser } from './fetcher.js';
import { upsertRaw, upsertProperty, shouldPauseScraping } from './save.js';
import { extractAgentDetails, closeSharedBrowser as closeAgentBrowser } from './agentExtractor.js';
import ScraperProgress from '../../models/ScraperProgress.js';

// Import control object for abort checking
import { control } from '../runAutomation.js';

// Close all shared browsers
async function closeSharedBrowser() {
  await Promise.all([
    closeFetcherBrowser().catch(() => {}),
    closeAgentBrowser().catch(() => {}),
  ]);
}

// ===== PROGRESS TRACKING =====
async function getProgress() {
  let progress = await ScraperProgress.findOne({ scraper: 'redfin' });
  if (!progress) {
    progress = await ScraperProgress.create({ scraper: 'redfin' });
  }
  return progress;
}

async function updateProgress(updates) {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    { $set: { ...updates, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function markCityProcessed(cityKey) {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    {
      $addToSet: { processedCities: cityKey },
      $inc: { totalScraped: 1 },
      $set: { updatedAt: new Date() }
    }
  );
}

// Reset progress (for starting fresh cycle)
export async function resetProgress() {
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    {
      $set: {
        currentState: null,
        currentCityIndex: 0,
        currentStateIndex: 0,
        processedCities: [],
        totalScraped: 0,
        cycleStartedAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log('[Redfin] Progress reset - will start fresh');
}

// Whether to use deep scraping for agent details
const USE_AGENT_ENRICHMENT = String(process.env.REDFIN_ENRICH_AGENTS || '0') === '1';

// State -> Cities mapping with Redfin city IDs (same as live-scrape.js)
const STATE_CITIES = {
  'AL': [{ name: 'Birmingham', id: 1823 }, { name: 'Huntsville', id: 8966 }, { name: 'Montgomery', id: 12923 }, { name: 'Mobile', id: 11715 }],
  'AZ': [{ name: 'Phoenix', id: 14240 }, { name: 'Tucson', id: 18805 }, { name: 'Mesa', id: 11350 }, { name: 'Scottsdale', id: 16095 }],
  'AR': [{ name: 'Little Rock', id: 10455 }, { name: 'Fort Smith', id: 7034 }, { name: 'Fayetteville', id: 6708 }],
  'CA': [{ name: 'Los Angeles', id: 11203 }, { name: 'San Diego', id: 16904 }, { name: 'San Jose', id: 17420 }, { name: 'Fresno', id: 7240 }],
  'CO': [{ name: 'Denver', id: 5155 }, { name: 'Colorado Springs', id: 4436 }, { name: 'Aurora', id: 1025 }, { name: 'Fort Collins', id: 7010 }],
  'CT': [{ name: 'Hartford', id: 9406 }, { name: 'New Haven', id: 13172 }, { name: 'Stamford', id: 17822 }],
  'DE': [{ name: 'Wilmington', id: 19583 }, { name: 'Dover', id: 5566 }, { name: 'Newark', id: 13139 }],
  'FL': [{ name: 'Miami', id: 11458 }, { name: 'Orlando', id: 14038 }, { name: 'Tampa', id: 18349 }, { name: 'Jacksonville', id: 9277 }],
  'GA': [{ name: 'Atlanta', id: 30756 }, { name: 'Savannah', id: 16044 }, { name: 'Augusta', id: 1020 }, { name: 'Columbus', id: 4665 }],
  'ID': [{ name: 'Boise', id: 2287 }, { name: 'Meridian', id: 11344 }, { name: 'Nampa', id: 13024 }],
  'IL': [{ name: 'Chicago', id: 29470 }, { name: 'Aurora', id: 1026 }, { name: 'Naperville', id: 13032 }, { name: 'Rockford', id: 15936 }],
  'IN': [{ name: 'Indianapolis', id: 9170 }, { name: 'Fort Wayne', id: 7033 }, { name: 'Evansville', id: 6489 }],
  'IA': [{ name: 'Des Moines', id: 5415 }, { name: 'Cedar Rapids', id: 3294 }, { name: 'Davenport', id: 5038 }],
  'KS': [{ name: 'Wichita', id: 19878 }, { name: 'Overland Park', id: 14080 }, { name: 'Kansas City', id: 9498 }],
  'KY': [{ name: 'Louisville', id: 12262 }, { name: 'Lexington', id: 10351 }, { name: 'Bowling Green', id: 2315 }],
  'LA': [{ name: 'New Orleans', id: 14233 }, { name: 'Baton Rouge', id: 1467 }, { name: 'Shreveport', id: 17324 }],
  'ME': [{ name: 'Portland', id: 15614 }, { name: 'Lewiston', id: 10356 }, { name: 'Bangor', id: 1334 }],
  'MD': [{ name: 'Baltimore', id: 1073 }, { name: 'Columbia', id: 4519 }, { name: 'Silver Spring', id: 17355 }],
  'MA': [{ name: 'Boston', id: 1826 }, { name: 'Worcester', id: 19753 }, { name: 'Springfield', id: 17750 }],
  'MI': [{ name: 'Detroit', id: 5665 }, { name: 'Grand Rapids', id: 7820 }, { name: 'Ann Arbor', id: 798 }],
  'MN': [{ name: 'Minneapolis', id: 10943 }, { name: 'Saint Paul', id: 16814 }, { name: 'Rochester', id: 15906 }],
  'MS': [{ name: 'Jackson', id: 9165 }, { name: 'Gulfport', id: 8193 }, { name: 'Hattiesburg', id: 8581 }],
  'MO': [{ name: 'Kansas City', id: 35751 }, { name: 'Saint Louis', id: 16815 }, { name: 'Springfield', id: 17751 }],
  'NE': [{ name: 'Omaha', id: 9417 }, { name: 'Lincoln', id: 10414 }, { name: 'Bellevue', id: 1587 }],
  'NV': [{ name: 'Las Vegas', id: 10201 }, { name: 'Henderson', id: 8728 }, { name: 'Reno', id: 15740 }],
  'NH': [{ name: 'Manchester', id: 11504 }, { name: 'Nashua', id: 13082 }, { name: 'Concord', id: 4588 }],
  'NJ': [{ name: 'Newark', id: 13136 }, { name: 'Jersey City', id: 9409 }, { name: 'Paterson', id: 14185 }],
  'NY': [{ name: 'New York', id: 30749 }, { name: 'Buffalo', id: 2704 }, { name: 'Rochester', id: 15907 }, { name: 'Syracuse', id: 18277 }],
  'NC': [{ name: 'Charlotte', id: 3105 }, { name: 'Raleigh', id: 15533 }, { name: 'Greensboro', id: 8050 }, { name: 'Durham', id: 5830 }],
  'OK': [{ name: 'Oklahoma City', id: 14237 }, { name: 'Tulsa', id: 35765 }, { name: 'Norman', id: 13561 }],
  'OR': [{ name: 'Portland', id: 30772 }, { name: 'Salem', id: 16843 }, { name: 'Eugene', id: 6460 }],
  'PA': [{ name: 'Philadelphia', id: 15502 }, { name: 'Pittsburgh', id: 14431 }, { name: 'Allentown', id: 556 }],
  'RI': [{ name: 'Providence', id: 15272 }, { name: 'Warwick', id: 19168 }, { name: 'Cranston', id: 4868 }],
  'SC': [{ name: 'Charleston', id: 3478 }, { name: 'Columbia', id: 4521 }, { name: 'Greenville', id: 8064 }],
  'TN': [{ name: 'Nashville', id: 13415 }, { name: 'Memphis', id: 11323 }, { name: 'Knoxville', id: 9766 }, { name: 'Chattanooga', id: 3561 }],
  'TX': [{ name: 'Houston', id: 8903 }, { name: 'San Antonio', id: 16898 }, { name: 'Dallas', id: 4995 }, { name: 'Austin', id: 1028 }, { name: 'Fort Worth', id: 7036 }],
  'VT': [{ name: 'Burlington', id: 2749 }, { name: 'South Burlington', id: 17552 }],
  'VA': [{ name: 'Virginia Beach', id: 20418 }, { name: 'Norfolk', id: 13560 }, { name: 'Richmond', id: 15819 }],
  'WA': [{ name: 'Seattle', id: 16163 }, { name: 'Spokane', id: 17717 }, { name: 'Tacoma', id: 18299 }],
  'WV': [{ name: 'Charleston', id: 3787 }, { name: 'Huntington', id: 8970 }, { name: 'Morgantown', id: 12007 }],
  'WI': [{ name: 'Milwaukee', id: 35759 }, { name: 'Madison', id: 11445 }, { name: 'Green Bay', id: 8039 }],
};

// States to process (excluding blocked states)
const STATES_TO_PROCESS = Object.keys(STATE_CITIES);

// Filter function for homes (same as live-scrape.js)
function filterHome(home, stateCode) {
  const MIN_PRICE = 50000, MAX_PRICE = 500000, MIN_BEDS = 3, MIN_SQFT = 1000;
  const price = home.price?.value || home.price || 0;
  const beds = home.beds || 0;
  const sqft = home.sqFt?.value || home.sqFt || 0;
  const hoa = home.hoa?.value || home.hoa || 0;

  // Filter by state
  const homeState = (home.state || '').toUpperCase();
  if (homeState && homeState !== stateCode) return false;

  if (price < MIN_PRICE || price > MAX_PRICE) return false;
  if (beds < MIN_BEDS) return false;
  if (sqft < MIN_SQFT) return false;

  const hoaValue = typeof hoa === 'object' ? 0 : (hoa || 0);
  if (hoaValue > 0) return false;

  // Exclude 55+ communities
  const remarks = (home.listingRemarks || '').toLowerCase();
  const seniorKeywords = ['55+', '55 +', 'senior', 'age restricted', 'retirement', 'over 55', 'active adult'];
  if (seniorKeywords.some(kw => remarks.includes(kw))) return false;

  return true;
}

// Process a single city using the API
async function runCity(stateCode, city) {
  console.log(`\n[Redfin] === City: ${city.name}, ${stateCode} ===`);

  try {
    const homes = await fetchListingsFromApi(city.id, stateCode, { limit: 500 });
    console.log(`[Redfin] API returned ${homes.length} homes for ${city.name}`);

    let saved = 0;
    let filtered = 0;

    for (const home of homes) {
      if (control.abort) {
        console.log('[Redfin] Abort signal received');
        break;
      }
      // NOTE: We do NOT check batch limit here - we complete ALL cities in the state first

      // Apply filters
      if (!filterHome(home, stateCode)) {
        filtered++;
        continue;
      }

      // Extract data from API response
      const streetLine = home.streetLine?.value || home.streetLine || '';
      const cityName = home.city || city.name;
      const state = home.state || stateCode;
      const zip = home.zip || '';
      const price = home.price?.value || home.price || null;
      const beds = home.beds || null;
      const baths = home.baths || null;
      const sqft = home.sqFt?.value || home.sqFt || null;
      const url = home.url ? `https://www.redfin.com${home.url}` : null;
      const mlsId = home.mlsId?.value || home.mlsId || null;

      const fullAddress = `${streetLine}, ${cityName}, ${state} ${zip}`.trim();

      // Agent info from API (if available)
      let agentName = home.listingAgent?.name || null;
      let agentPhone = null;
      let agentEmail = null;
      let brokerage = home.brokerName || null;

      // Optional: Deep scrape for agent details (slower)
      if (USE_AGENT_ENRICHMENT && url) {
        try {
          const enriched = await extractAgentDetails(url);
          if (enriched) {
            agentName = enriched.agentName || agentName;
            agentPhone = enriched.phone || agentPhone;
            agentEmail = enriched.email || agentEmail;
            brokerage = enriched.brokerage || brokerage;
          }
        } catch (e) {
          // Silent fail
        }
      }

      // Save to database
      await upsertRaw({
        address: fullAddress,
        city: cityName,
        state: state,
        zip: zip,
        price,
        beds,
        baths,
        sqft,
        raw: home,
        agentName,
        agentEmail
      });

      await upsertProperty({
        prop_id: mlsId || `redfin-${home.propertyId || home.listingId || Date.now()}`,
        address: fullAddress,
        city: cityName,
        state: state,
        zip: zip,
        price,
        beds,
        baths,
        sqft,
        built: home.yearBuilt?.value || home.yearBuilt || null,
        raw: home,
        agentName,
        agentEmail,
        agentPhone,
        brokerage,
      });

      saved++;
      if (saved % 20 === 0) {
        console.log(`[Redfin] Progress: ${saved} saved, ${filtered} filtered`);
      }
    }

    console.log(`[Redfin] City ${city.name} done: ${saved} saved, ${filtered} filtered`);
    return saved;
  } catch (err) {
    console.error(`[Redfin] Error processing ${city.name}: ${err.message}`);
    return 0;
  }
}

// Main runner - process all states and cities
export async function runAllCities() {
  console.log(`[Redfin] Starting API-based scraping for ${STATES_TO_PROCESS.length} states`);

  const progress = await getProgress();
  const startStateIndex = progress.currentStateIndex || 0;
  const processedCitiesSet = new Set(progress.processedCities || []);

  console.log(`[Redfin] Resuming from state index ${startStateIndex}`);
  console.log(`[Redfin] Already processed ${processedCitiesSet.size} cities`);

  let totalSaved = 0;

  try {
    for (let stateIdx = startStateIndex; stateIdx < STATES_TO_PROCESS.length; stateIdx++) {
      const stateCode = STATES_TO_PROCESS[stateIdx];
      const cities = STATE_CITIES[stateCode] || [];

      if (control.abort) {
        console.log('[Redfin] Abort signal received, stopping');
        await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });
        break;
      }

      console.log(`\n[Redfin] === State ${stateIdx + 1}/${STATES_TO_PROCESS.length}: ${stateCode} (${cities.length} cities) ===`);
      await updateProgress({ currentStateIndex: stateIdx, currentState: stateCode });

      // Process ALL cities in this state before checking batch limit
      for (const city of cities) {
        const cityKey = `${stateCode}-${city.id}`;

        if (processedCitiesSet.has(cityKey)) {
          continue;
        }

        if (control.abort) {
          break;
        }

        const saved = await runCity(stateCode, city);
        totalSaved += saved;

        await markCityProcessed(cityKey);
        processedCitiesSet.add(cityKey);

        // Small delay between cities
        await new Promise(r => setTimeout(r, 1000));
      }

      // Check batch limit ONLY after completing ALL cities in the state
      if (shouldPauseScraping()) {
        console.log(`[Redfin] Batch limit reached after completing state ${stateCode} - pausing for AMV phase`);
        await updateProgress({ currentStateIndex: stateIdx + 1, currentState: null }); // Move to next state
        break;
      }

      if (control.abort) {
        break;
      }
    }

    // Check if completed all states
    const progress2 = await getProgress();
    if ((progress2.currentStateIndex || 0) >= STATES_TO_PROCESS.length - 1 && !control.abort && !shouldPauseScraping()) {
      console.log('[Redfin] Completed all states! Resetting progress.');
      await resetProgress();
    }
  } finally {
    await closeSharedBrowser();
    console.log(`[Redfin] Finished. Total saved: ${totalSaved}`);
  }
}
