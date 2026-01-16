// backend/routes/redfin-amv-lookup.js
// API endpoint for testing Redfin AMV lookup via Property ID
// Includes loop mode to scrape from states like the automation (uses Stingray GIS API)
// Results are persisted to database and can resume from where left off

import express from 'express';
import axios from 'axios';
import RedfinAMVResult from '../models/RedfinAMVResult.js';
import ScraperProgress from '../models/ScraperProgress.js';

const router = express.Router();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Track active streams so we can stop them
const activeStreams = new Map();

// States and cities with Redfin city IDs (same as the real automation)
const STATE_CITIES = {
  'AL': [{ name: 'Birmingham', id: 1823 }, { name: 'Huntsville', id: 9408 }, { name: 'Montgomery', id: 13134 }, { name: 'Mobile', id: 12836 }],
  'AZ': [{ name: 'Phoenix', id: 14240 }, { name: 'Tucson', id: 19459 }, { name: 'Mesa', id: 11736 }, { name: 'Scottsdale', id: 16660 }],
  'AR': [{ name: 'Little Rock', id: 10455 }, { name: 'Fort Smith', id: 6318 }, { name: 'Fayetteville', id: 6011 }],
  'CA': [{ name: 'Los Angeles', id: 11203 }, { name: 'San Diego', id: 16904 }, { name: 'San Jose', id: 17420 }, { name: 'Sacramento', id: 16409 }],
  'CO': [{ name: 'Denver', id: 5155 }, { name: 'Colorado Springs', id: 4147 }, { name: 'Aurora', id: 30839 }],
  'CT': [{ name: 'Hartford', id: 9406 }, { name: 'New Haven', id: 13410 }, { name: 'Stamford', id: 18605 }],
  'FL': [{ name: 'Miami', id: 11458 }, { name: 'Orlando', id: 13655 }, { name: 'Tampa', id: 18142 }, { name: 'Jacksonville', id: 8907 }],
  'GA': [{ name: 'Atlanta', id: 30756 }, { name: 'Savannah', id: 17651 }, { name: 'Columbus', id: 4901 }],
  'ID': [{ name: 'Boise', id: 2287 }, { name: 'Meridian', id: 13444 }, { name: 'Nampa', id: 14562 }],
  'IL': [{ name: 'Chicago', id: 29470 }, { name: 'Aurora', id: 29459 }, { name: 'Naperville', id: 29501 }],
  'IN': [{ name: 'Indianapolis', id: 9170 }, { name: 'Fort Wayne', id: 6438 }, { name: 'Evansville', id: 5667 }],
  'IA': [{ name: 'Des Moines', id: 5415 }, { name: 'Cedar Rapids', id: 3103 }, { name: 'Davenport', id: 4908 }],
  'KS': [{ name: 'Wichita', id: 19878 }, { name: 'Overland Park', id: 13896 }, { name: 'Kansas City', id: 35751 }],
  'KY': [{ name: 'Louisville', id: 12262 }, { name: 'Lexington', id: 11746 }, { name: 'Bowling Green', id: 2307 }],
  'LA': [{ name: 'New Orleans', id: 14233 }, { name: 'Baton Rouge', id: 1336 }, { name: 'Shreveport', id: 17884 }],
  'ME': [{ name: 'Portland', id: 15614 }, { name: 'Lewiston', id: 9823 }, { name: 'Bangor', id: 735 }],
  'MD': [{ name: 'Baltimore', id: 1073 }, { name: 'Frederick', id: 7735 }, { name: 'Rockville', id: 17332 }],
  'MA': [{ name: 'Boston', id: 1826 }, { name: 'Worcester', id: 20420 }, { name: 'Springfield', id: 17155 }],
  'MI': [{ name: 'Detroit', id: 5665 }, { name: 'Grand Rapids', id: 8694 }, { name: 'Ann Arbor', id: 782 }],
  'MN': [{ name: 'Minneapolis', id: 10943 }, { name: 'Saint Paul', id: 15027 }, { name: 'Rochester', id: 14201 }],
  'MS': [{ name: 'Jackson', id: 9165 }, { name: 'Gulfport', id: 7572 }, { name: 'Hattiesburg', id: 7932 }],
  'MO': [{ name: 'Kansas City', id: 35751 }, { name: 'Saint Louis', id: 16661 }, { name: 'Springfield', id: 17886 }],
  'NE': [{ name: 'Omaha', id: 9417 }, { name: 'Lincoln', id: 7163 }],
  'NV': [{ name: 'Las Vegas', id: 10201 }, { name: 'Henderson', id: 8147 }, { name: 'Reno', id: 15627 }],
  'NH': [{ name: 'Manchester', id: 11504 }, { name: 'Nashua', id: 12918 }, { name: 'Concord', id: 3697 }],
  'NJ': [{ name: 'Newark', id: 13136 }, { name: 'Jersey City', id: 9168 }, { name: 'Paterson', id: 14759 }],
  'NY': [{ name: 'New York', id: 30749 }, { name: 'Buffalo', id: 2832 }, { name: 'Rochester', id: 16162 }],
  'NC': [{ name: 'Charlotte', id: 3105 }, { name: 'Raleigh', id: 35711 }, { name: 'Greensboro', id: 7161 }],
  'OK': [{ name: 'Oklahoma City', id: 14237 }, { name: 'Tulsa', id: 35765 }, { name: 'Norman', id: 13526 }],
  'OR': [{ name: 'Portland', id: 30772 }, { name: 'Salem', id: 30778 }, { name: 'Eugene', id: 6142 }],
  'PA': [{ name: 'Philadelphia', id: 15502 }, { name: 'Pittsburgh', id: 15702 }, { name: 'Allentown', id: 514 }],
  'RI': [{ name: 'Providence', id: 15272 }, { name: 'Warwick', id: 18869 }, { name: 'Cranston', id: 4953 }],
  'SC': [{ name: 'Charleston', id: 3478 }, { name: 'Columbia', id: 4149 }, { name: 'Greenville', id: 7891 }],
  'TN': [{ name: 'Nashville', id: 13415 }, { name: 'Memphis', id: 12260 }, { name: 'Knoxville', id: 10200 }],
  'TX': [{ name: 'Houston', id: 8903 }, { name: 'San Antonio', id: 16657 }, { name: 'Dallas', id: 30794 }, { name: 'Austin', id: 30818 }],
  'VT': [{ name: 'Burlington', id: 2749 }, { name: 'South Burlington', id: 16951 }],
  'VA': [{ name: 'Virginia Beach', id: 20418 }, { name: 'Norfolk', id: 14757 }, { name: 'Richmond', id: 17149 }],
  'WA': [{ name: 'Seattle', id: 16163 }, { name: 'Spokane', id: 17154 }, { name: 'Tacoma', id: 17887 }],
  'WV': [{ name: 'Charleston', id: 3787 }, { name: 'Huntington', id: 10028 }, { name: 'Morgantown', id: 14431 }],
  'WI': [{ name: 'Milwaukee', id: 35759 }, { name: 'Madison', id: 12257 }, { name: 'Green Bay', id: 7928 }],
};

const STATES = Object.keys(STATE_CITIES);
const SCRAPER_NAME = 'redfin-amv-lookup';

/**
 * Get or create progress tracker for this scraper
 */
async function getProgress() {
  let progress = await ScraperProgress.findOne({ scraper: SCRAPER_NAME });
  if (!progress) {
    progress = await ScraperProgress.create({
      scraper: SCRAPER_NAME,
      currentStateIndex: 0,
      currentCityIndex: -1,
      processedCities: [],
      totalScraped: 0,
      cycleCount: 0,
    });
  }
  return progress;
}

/**
 * Update progress tracker
 */
async function updateProgress(stateIndex, cityIndex, cityKey = null) {
  const update = {
    currentStateIndex: stateIndex,
    currentCityIndex: cityIndex,
    currentState: STATES[stateIndex] || null,
    updatedAt: new Date(),
  };

  if (cityKey) {
    await ScraperProgress.updateOne(
      { scraper: SCRAPER_NAME },
      {
        $set: update,
        $addToSet: { processedCities: cityKey }
      }
    );
  } else {
    await ScraperProgress.updateOne(
      { scraper: SCRAPER_NAME },
      { $set: update }
    );
  }
}

/**
 * Reset progress (start fresh)
 */
async function resetProgress() {
  await ScraperProgress.updateOne(
    { scraper: SCRAPER_NAME },
    {
      $set: {
        currentStateIndex: 0,
        currentCityIndex: -1,
        currentState: null,
        lastState: null,
        processedCities: [],
        totalScraped: 0,
        updatedAt: new Date(),
      },
      $inc: { cycleCount: 1 }
    },
    { upsert: true }
  );
}

/**
 * Fetch AMV from Redfin Stingray API
 */
async function fetchRedfinAMV(propertyId) {
  const url = `https://www.redfin.com/stingray/api/home/details/aboveTheFold?propertyId=${propertyId}&accessLevel=1`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `https://www.redfin.com/`,
        'Origin': 'https://www.redfin.com',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, timeMs: elapsed };
    }

    let text = await response.text();
    if (text.startsWith('{}&&')) {
      text = text.slice(4);
    }

    const json = JSON.parse(text);

    if (json.resultCode !== 0) {
      return { success: false, error: json.errorMessage || 'API error', timeMs: elapsed };
    }

    const payload = json.payload || {};
    const addressSection = payload.addressSectionInfo || {};
    const avmInfo = addressSection.avmInfo || {};

    const amv = avmInfo.predictedValue ? Math.round(avmInfo.predictedValue) : null;

    if (!amv) {
      return { success: false, error: 'NO_AMV', timeMs: elapsed };
    }

    return { success: true, amv, timeMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return { success: false, error: err.message, timeMs: elapsed };
  }
}

/**
 * Fetch listings from Redfin Stingray GIS API (EXACTLY like the real automation)
 */
async function fetchRedfinListings(stateCode, city, limit = 5) {
  const market = stateCode.toLowerCase();
  const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${market}&region_id=${city.id}&region_type=6&num_homes=${limit}&status=9&ord=redfin-recommended-asc&v=8`;

  console.log(`[Redfin AMV Lookup] Fetching: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': `https://www.redfin.com/city/${city.id}/${stateCode}/`
      },
      timeout: 30000
    });

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const homes = data.payload?.homes || [];
    console.log(`[Redfin AMV Lookup] API returned ${homes.length} homes for ${city.name}`);

    const listings = homes.slice(0, limit).map(home => {
      const streetLine = home.streetLine?.value || home.streetLine || '';
      const cityName = home.city || city.name;
      const state = home.state || stateCode;
      const zip = home.zip || '';
      const price = home.price?.value || home.price || null;
      const beds = home.beds || null;
      const baths = home.baths || null;
      const sqft = home.sqFt?.value || home.sqFt || null;
      const homeUrl = home.url ? `https://www.redfin.com${home.url}` : null;
      const propertyId = home.propertyId || home.listingId;

      return {
        propertyId: String(propertyId),
        url: homeUrl,
        address: streetLine ? `${streetLine}, ${cityName}, ${state} ${zip}`.trim() : `Property in ${cityName}, ${state}`,
        city: cityName,
        state: state,
        price,
        beds,
        baths,
        sqft,
      };
    }).filter(l => l.propertyId && l.propertyId !== 'undefined');

    console.log(`[Redfin AMV Lookup] Processed ${listings.length} listings from ${city.name}`);
    return { success: true, listings };
  } catch (err) {
    console.error(`[Redfin AMV Lookup] Error fetching ${city.name}: ${err.message}`);
    return { success: false, error: err.message, listings: [] };
  }
}

/**
 * Save result to database
 */
async function saveResult(result) {
  try {
    await RedfinAMVResult.updateOne(
      { propertyId: result.propertyId, state: result.state },
      { $set: result },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) {
      console.error(`[Redfin AMV Lookup] Error saving result: ${err.message}`);
    }
  }
}

/**
 * POST /api/redfin-amv-lookup/fetch
 * Fetch AMV for a single Redfin URL or Property ID
 */
router.post('/fetch', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a Redfin URL or Property ID'
      });
    }

    let propertyId = input.trim();
    if (!/^\d+$/.test(propertyId)) {
      const match = input.match(/\/home\/(\d+)/);
      propertyId = match ? match[1] : null;
    }

    if (!propertyId) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract Property ID'
      });
    }

    const result = await fetchRedfinAMV(propertyId);

    res.json({
      ...result,
      propertyId,
      inputProvided: input,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/redfin-amv-lookup/results
 * Get all stored results (for page reload)
 */
router.get('/results', async (req, res) => {
  try {
    const { limit = 5000, offset = 0 } = req.query;

    const results = await RedfinAMVResult.find()
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();

    const total = await RedfinAMVResult.countDocuments();
    const successCount = await RedfinAMVResult.countDocuments({ success: true });
    const dealsCount = await RedfinAMVResult.countDocuments({ isDeal: true });

    res.json({
      success: true,
      results,
      stats: {
        total,
        success: successCount,
        deals: dealsCount,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/redfin-amv-lookup/progress
 * Get current progress
 */
router.get('/progress', async (req, res) => {
  try {
    const progress = await getProgress();

    const totalStates = STATES.length;
    const totalCities = Object.values(STATE_CITIES).reduce((sum, cities) => sum + cities.length, 0);

    res.json({
      success: true,
      progress: {
        currentStateIndex: progress.currentStateIndex,
        currentCityIndex: progress.currentCityIndex,
        currentState: progress.currentState,
        processedCities: progress.processedCities.length,
        totalScraped: progress.totalScraped,
        cycleCount: progress.cycleCount,
        totalStates,
        totalCities,
        updatedAt: progress.updatedAt,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/redfin-amv-lookup/reset
 * Reset progress and clear results (start fresh)
 */
router.post('/reset', async (req, res) => {
  try {
    await resetProgress();
    await RedfinAMVResult.deleteMany({});

    res.json({
      success: true,
      message: 'Progress and results cleared. Ready to start fresh.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * OPTIONS /api/redfin-amv-lookup/stream-loop
 * Handle CORS preflight for SSE endpoint
 */
router.options('/stream-loop', (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

/**
 * GET /api/redfin-amv-lookup/stream-loop
 * SSE endpoint - loops through states/cities, scrapes listings, fetches AMV
 * Resumes from where it left off
 */
router.get('/stream-loop', async (req, res) => {
  console.log('[Redfin AMV Lookup] Stream-loop started');

  // Set proper CORS headers for SSE - use the requesting origin
  const origin = req.headers.origin || '*';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
  res.flushHeaders();

  const streamId = Date.now().toString();
  activeStreams.set(streamId, { active: true });

  // IMPORTANT: Detect when client disconnects and stop processing
  req.on('close', () => {
    console.log(`[Redfin AMV Lookup] Client disconnected, stopping stream ${streamId}`);
    if (activeStreams.has(streamId)) {
      activeStreams.get(streamId).active = false;
    }
  });

  res.write(`data: ${JSON.stringify({ type: 'started', streamId })}\n\n`);

  const isActive = () => activeStreams.get(streamId)?.active;

  // Keepalive ping every 20 seconds to prevent Render timeout
  const keepaliveInterval = setInterval(() => {
    if (isActive()) {
      res.write(`: keepalive\n\n`);
    } else {
      clearInterval(keepaliveInterval);
    }
  }, 20000);

  try {
    // Get progress to resume from
    const progress = await getProgress();
    let startStateIndex = progress.currentStateIndex || 0;
    let startCityIndex = progress.currentCityIndex >= 0 ? progress.currentCityIndex : -1;

    // Get stats from database for accurate counts
    let totalProcessed = await RedfinAMVResult.countDocuments();
    let totalSuccess = await RedfinAMVResult.countDocuments({ success: true });
    let totalDeals = await RedfinAMVResult.countDocuments({ isDeal: true });

    const startTime = Date.now();

    // Send resume info
    if (startStateIndex > 0 || startCityIndex >= 0) {
      res.write(`data: ${JSON.stringify({
        type: 'status',
        message: `Resuming from ${STATES[startStateIndex]} (state ${startStateIndex + 1}/${STATES.length})...`,
        state: STATES[startStateIndex],
        resuming: true,
        existingResults: totalProcessed,
      })}\n\n`);
    }

    // Loop through states (starting from saved position)
    for (let stateIdx = startStateIndex; stateIdx < STATES.length; stateIdx++) {
      if (!isActive()) break;

      const state = STATES[stateIdx];
      const cities = STATE_CITIES[state] || [];

      // Determine starting city index
      const cityStartIdx = (stateIdx === startStateIndex && startCityIndex >= 0) ? startCityIndex + 1 : 0;

      for (let cityIdx = cityStartIdx; cityIdx < cities.length; cityIdx++) {
        if (!isActive()) break;

        const city = cities[cityIdx];
        const cityKey = `${state}-${city.name}`;

        // Check if already processed this city
        if (progress.processedCities.includes(cityKey)) {
          console.log(`[Redfin AMV Lookup] Skipping already processed: ${cityKey}`);
          continue;
        }

        res.write(`data: ${JSON.stringify({
          type: 'status',
          message: `Fetching listings from ${city.name}, ${state}...`,
          state,
          city: city.name,
          stateIndex: stateIdx,
          cityIndex: cityIdx,
        })}\n\n`);

        const scrapeResult = await fetchRedfinListings(state, city, 350);

        console.log(`[Redfin AMV Lookup] scrapeResult for ${city.name}: success=${scrapeResult.success}, listings=${scrapeResult.listings?.length || 0}, error=${scrapeResult.error || 'none'}`);

        if (!scrapeResult.success || scrapeResult.listings.length === 0) {
          res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `No listings found in ${city.name}, ${state} (${scrapeResult.error || 'empty'})`,
            state,
            city: city.name
          })}\n\n`);

          await updateProgress(stateIdx, cityIdx, cityKey);
          continue;
        }

        console.log(`[Redfin AMV Lookup] Processing ${scrapeResult.listings.length} listings from ${city.name}...`);

        for (const listing of scrapeResult.listings) {
          if (!isActive()) break;

          // Check if we already have this property in the database
          const existing = await RedfinAMVResult.findOne({
            propertyId: listing.propertyId,
            state: listing.state
          });

          if (existing) {
            // Skip already processed
            continue;
          }

          console.log(`[Redfin AMV Lookup] Fetching AMV for ${listing.propertyId} (${listing.address})...`);

          const amvResult = await fetchRedfinAMV(listing.propertyId);
          totalProcessed++;

          const isDeal = amvResult.success && listing.price &&
            amvResult.amv >= listing.price * 2 && amvResult.amv > 200000;

          if (amvResult.success) totalSuccess++;
          if (isDeal) totalDeals++;

          const resultData = {
            propertyId: listing.propertyId,
            address: listing.address,
            city: listing.city,
            state: listing.state,
            listPrice: listing.price,
            beds: listing.beds,
            baths: listing.baths,
            sqft: listing.sqft,
            amv: amvResult.amv || null,
            success: amvResult.success,
            error: amvResult.error || null,
            timeMs: amvResult.timeMs,
            isDeal,
            url: listing.url,
          };

          // Save to database
          await saveResult(resultData);

          console.log(`[Redfin AMV Lookup] Sending result #${totalProcessed}: ${listing.address}, AMV: ${amvResult.amv || 'N/A'}`);

          res.write(`data: ${JSON.stringify({
            type: 'result',
            index: totalProcessed,
            ...resultData,
          })}\n\n`);

          // Delay between AMV requests to avoid rate limiting
          await new Promise(r => setTimeout(r, 500));
        }

        // Update progress after processing city
        await updateProgress(stateIdx, cityIdx, cityKey);

        await ScraperProgress.updateOne(
          { scraper: SCRAPER_NAME },
          { $set: { totalScraped: totalProcessed } }
        );
      }

      // Reset city index when moving to next state
      startCityIndex = -1;
    }

    // Cycle complete - reset progress for next cycle
    console.log(`[Redfin AMV Lookup] Cycle complete! Processed ${totalProcessed} addresses, ${totalDeals} deals found`);
    await resetProgress();

    const totalTime = Date.now() - startTime;
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      summary: {
        total: totalProcessed,
        successful: totalSuccess,
        deals: totalDeals,
        totalTimeMs: totalTime,
        avgTimeMs: totalProcessed > 0 ? Math.round(totalTime / totalProcessed) : 0
      }
    })}\n\n`);

  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  } finally {
    clearInterval(keepaliveInterval);
    activeStreams.delete(streamId);
    res.end();
  }
});

/**
 * POST /api/redfin-amv-lookup/stop
 * Stop an active stream
 */
router.post('/stop', (req, res) => {
  const { streamId } = req.body;

  console.log(`[Redfin AMV Lookup] Stop requested for streamId: ${streamId || 'all'}`);

  if (streamId && activeStreams.has(streamId)) {
    activeStreams.get(streamId).active = false;
    console.log(`[Redfin AMV Lookup] Stream ${streamId} stopped`);
    res.json({ success: true, message: 'Stream stopped' });
  } else {
    // Stop all streams
    let count = 0;
    for (const [id, stream] of activeStreams) {
      stream.active = false;
      count++;
      console.log(`[Redfin AMV Lookup] Stream ${id} stopped`);
    }
    console.log(`[Redfin AMV Lookup] Stopped ${count} streams`);
    res.json({ success: true, message: `All ${count} streams stopped` });
  }
});

/**
 * GET /api/redfin-amv-lookup/test
 */
router.get('/test', (_, res) => {
  res.json({
    success: true,
    message: 'Redfin AMV Lookup API is working',
    states: STATES.length
  });
});

export default router;
