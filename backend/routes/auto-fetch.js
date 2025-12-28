import express from 'express';
import ScrapedDeal from '../models/ScrapedDeal.js';
import { log } from '../utils/logger.js';

const router = express.Router();
const L = log.child('auto-fetch');

// Helper to get the actual server URL (uses global port which may differ from PORT if port was in use)
function getServerUrl() {
  const port = global.__ACTUAL_PORT__ || process.env.PORT || 3015;
  return `http://localhost:${port}`;
}

// Lock to prevent concurrent auto-fetch operations
let isAutoFetchRunning = false;
let currentFetchStatus = null;
let shouldStopLoop = false; // Flag to stop continuous loop
let loopStats = null; // Track stats across loops

// Progress tracking - persists across restarts within same process
// Each source has its own state index so they can be on different states
let progressTracker = {
  privy: {
    currentStateIndex: 0,  // Start from AL (index 0)
    lastAddress: null,
    fetchedCount: 0,
    pendingAddresses: [],
    totalProcessed: 0  // Total addresses processed across all states
  },
  redfin: {
    currentStateIndex: 0,  // Redfin also starts from beginning
    lastAddress: null,
    fetchedCount: 0,
    pendingAddresses: [],
    totalProcessed: 0
  },
  currentSource: 'privy' // Which source is currently active
};

// Helper: Fetch from Privy API using state-level mode (cluster approach)
// This uses the same approach as test-privy-fetch.js which works reliably
async function fetchFromPrivy(state, limit, token, page = 1) {
  try {
    // Use state-level mode for reliable scraping (same as privy fetcher)
    // Note: page parameter is ignored in state mode since it scrapes by clusters
    const fetchLimit = Math.min(limit * 2, 100); // Fetch more to account for duplicates
    const url = `${getServerUrl()}/api/live-scrape/privy?state=${state}&limit=${fetchLimit}&mode=state`;
    L.info(`Fetching Privy (state mode) for ${state}`, { limit: fetchLimit });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();

    if (data.ok && data.addresses) {
      return data.addresses.map(addr => ({
        fullAddress: addr.fullAddress || '',
        address: addr.fullAddress?.split(',')[0]?.trim() || '',
        price: addr.price ? Number(String(addr.price).replace(/[^0-9.-]/g, '')) : null,
        city: addr.city || null,
        state: addr.state || state,
        source: 'privy',
        stats: addr.quickStats || addr.stats || [],
      }));
    }
    return [];
  } catch (err) {
    L.error('Privy fetch failed', { state, error: err?.message });
    return [];
  }
}

// Helper: Fetch from Redfin API (All Cities) with pagination
async function fetchFromRedfin(state, limit, token, page = 1) {
  try {
    // Fetch more than needed to account for duplicates
    const fetchLimit = Math.min(limit * 3, 50); // Fetch up to 3x to find new ones
    const url = `${getServerUrl()}/api/live-scrape/redfin?state=${state}&city=&limit=${fetchLimit}&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();

    if (data.ok && data.addresses) {
      return data.addresses.map(addr => ({
        fullAddress: addr.fullAddress || addr.address || '',
        address: addr.address || addr.fullAddress?.split(',')[0]?.trim() || '',
        price: addr.price || null,
        city: addr.city || null,
        state: addr.state || state,
        zip: addr.zip || null,
        beds: addr.beds || null,
        baths: addr.baths || null,
        sqft: addr.sqft || null,
        source: 'redfin',
      }));
    }
    return [];
  } catch (err) {
    L.error('Redfin fetch failed', { state, error: err?.message });
    return [];
  }
}

// Helper: Filter out addresses that already exist in database (with AMV)
async function filterNewAddresses(addresses) {
  if (addresses.length === 0) return { newAddresses: [], existingCount: 0 };

  const addressKeys = addresses.map(a => String(a.fullAddress || '').toLowerCase().trim());

  // Find existing addresses that already have AMV
  const existing = await ScrapedDeal.find({
    fullAddress_ci: { $in: addressKeys },
    amv: { $exists: true, $ne: null }
  }).select('fullAddress_ci').lean();

  const existingSet = new Set(existing.map(e => e.fullAddress_ci));

  const newAddresses = addresses.filter(a => {
    const key = String(a.fullAddress || '').toLowerCase().trim();
    return !existingSet.has(key);
  });

  return {
    newAddresses,
    existingCount: addresses.length - newAddresses.length
  };
}

// Helper: Fetch BofA AMV for addresses
async function fetchBofaAmv(addresses, token) {
  if (addresses.length === 0) return [];

  const results = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch(`${getServerUrl()}/api/bofa/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addresses: batch.map(a => a.fullAddress),
          concurrency: 5,
        }),
      });

      const data = await response.json();

      if (data.ok && data.results) {
        data.results.forEach((result, j) => {
          results.push({
            ...batch[j],
            amv: result.amv || null,
            bofaFetchedAt: result.amv ? new Date() : null,
          });
        });
      } else {
        // If batch fails, add addresses without AMV
        batch.forEach(addr => {
          results.push({ ...addr, amv: null, bofaFetchedAt: null });
        });
      }
    } catch (err) {
      L.error('BofA batch failed', { error: err?.message });
      batch.forEach(addr => {
        results.push({ ...addr, amv: null, bofaFetchedAt: null });
      });
    }
  }

  return results;
}

// Helper: Check if a deal qualifies (AMV >= 2x LP)
function isDealQualified(amv, listingPrice) {
  if (!amv || !listingPrice || amv <= 0 || listingPrice <= 0) return false;
  return amv >= (listingPrice * 2);
}

// Helper: Save deals to database
async function saveDealsToDb(deals) {
  const results = { saved: 0, updated: 0, failed: 0, dealsCount: 0 };

  for (const deal of deals) {
    try {
      const fullAddress = String(deal.fullAddress || '').trim();
      if (!fullAddress) {
        results.failed++;
        continue;
      }

      const fullAddress_ci = fullAddress.toLowerCase();
      const isDeal = isDealQualified(deal.amv, deal.price);

      const updateData = {
        address: deal.address || fullAddress.split(',')[0]?.trim() || fullAddress,
        fullAddress,
        fullAddress_ci,
        city: deal.city || null,
        state: deal.state ? String(deal.state).toUpperCase() : null,
        zip: deal.zip || null,
        listingPrice: deal.price || null,
        amv: deal.amv || null,
        source: deal.source || 'unknown',
        beds: deal.beds || null,
        baths: deal.baths || null,
        sqft: deal.sqft || null,
        scrapedAt: new Date(),
        bofaFetchedAt: deal.bofaFetchedAt || null,
        isDeal: isDeal,
      };

      const existing = await ScrapedDeal.findOne({ fullAddress_ci });

      if (existing) {
        await ScrapedDeal.updateOne(
          { fullAddress_ci },
          { $set: { ...updateData, amv: updateData.amv ?? existing.amv } }
        );
        results.updated++;
      } else {
        await ScrapedDeal.create(updateData);
        results.saved++;
      }

      // Count qualified deals
      if (isDeal) {
        results.dealsCount++;
      }
    } catch (err) {
      results.failed++;
    }
  }

  return results;
}

// POST /api/auto-fetch/run - Run auto-fetch for selected states
router.post('/run', async (req, res) => {
  // Check if another fetch is already running
  if (isAutoFetchRunning) {
    return res.status(429).json({
      ok: false,
      error: 'Auto-fetch already in progress. Please wait for it to complete.',
      status: currentFetchStatus
    });
  }

  try {
    const { states, limitPerSource = 10 } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';

    if (!Array.isArray(states) || states.length === 0) {
      return res.status(400).json({ ok: false, error: 'states array is required' });
    }

    // Set lock
    isAutoFetchRunning = true;
    currentFetchStatus = `Starting auto-fetch for ${states.length} states...`;

    L.info('Starting auto-fetch', { states, limitPerSource });

    const allDeals = [];
    const progress = {
      total: states.length * 2, // Privy + Redfin for each state
      completed: 0,
      states: {},
      skippedExisting: 0, // Track how many addresses we skipped
    };

    for (const state of states) {
      progress.states[state] = { privy: 'pending', redfin: 'pending', bofaComplete: false, skipped: 0, newFound: 0 };

      // ========== REDFIN: Fetch with retry for new addresses ==========
      let redfinNewTotal = [];
      let redfinPage = 1;
      const MAX_RETRIES = 3;

      while (redfinNewTotal.length < limitPerSource && redfinPage <= MAX_RETRIES) {
        currentFetchStatus = `Fetching Redfin for ${state} (page ${redfinPage})...`;
        L.info(`Fetching Redfin for ${state} (page ${redfinPage})...`);
        progress.states[state].redfin = `fetching (page ${redfinPage})`;

        const redfinAddresses = await fetchFromRedfin(state, limitPerSource, token, redfinPage);

        if (redfinAddresses.length === 0) {
          L.info(`${state} Redfin: No more addresses available on page ${redfinPage}`);
          break;
        }

        const { newAddresses: newRedfinAddresses, existingCount: redfinExisting } = await filterNewAddresses(redfinAddresses);
        progress.skippedExisting += redfinExisting;

        if (newRedfinAddresses.length > 0) {
          // Take only what we need to reach the limit
          const needed = limitPerSource - redfinNewTotal.length;
          const toProcess = newRedfinAddresses.slice(0, needed);
          redfinNewTotal.push(...toProcess);
          L.info(`${state} Redfin page ${redfinPage}: Found ${newRedfinAddresses.length} new, taking ${toProcess.length}`);
        } else {
          L.info(`${state} Redfin page ${redfinPage}: All ${redfinAddresses.length} addresses already exist, trying next page`);
        }

        redfinPage++;
      }

      progress.states[state].redfin = `done (${redfinNewTotal.length} new)`;
      progress.completed++;

      // Process and save Redfin addresses immediately
      if (redfinNewTotal.length > 0) {
        currentFetchStatus = `Fetching BofA AMV for ${state} Redfin (${redfinNewTotal.length} new)...`;
        const redfinWithAmv = await fetchBofaAmv(redfinNewTotal, token);
        const redfinSaveResults = await saveDealsToDb(redfinWithAmv);
        L.info(`${state} Redfin: Saved ${redfinSaveResults.saved}, Updated ${redfinSaveResults.updated}`);
        allDeals.push(...redfinWithAmv);
        progress.states[state].newFound += redfinNewTotal.length;
      }

      // ========== PRIVY: Fetch with retry for new addresses ==========
      let privyNewTotal = [];
      let privyPage = 1;

      while (privyNewTotal.length < limitPerSource && privyPage <= MAX_RETRIES) {
        currentFetchStatus = `Fetching Privy for ${state} (page ${privyPage})...`;
        L.info(`Fetching Privy for ${state} (page ${privyPage})...`);
        progress.states[state].privy = `fetching (page ${privyPage})`;

        const privyAddresses = await fetchFromPrivy(state, limitPerSource, token, privyPage);

        if (privyAddresses.length === 0) {
          L.info(`${state} Privy: No more addresses available on page ${privyPage}`);
          break;
        }

        const { newAddresses: newPrivyAddresses, existingCount: privyExisting } = await filterNewAddresses(privyAddresses);
        progress.skippedExisting += privyExisting;
        progress.states[state].skipped += privyExisting;

        if (newPrivyAddresses.length > 0) {
          // Take only what we need to reach the limit
          const needed = limitPerSource - privyNewTotal.length;
          const toProcess = newPrivyAddresses.slice(0, needed);
          privyNewTotal.push(...toProcess);
          L.info(`${state} Privy page ${privyPage}: Found ${newPrivyAddresses.length} new, taking ${toProcess.length}`);
        } else {
          L.info(`${state} Privy page ${privyPage}: All ${privyAddresses.length} addresses already exist, trying next page`);
        }

        privyPage++;
      }

      progress.states[state].privy = `done (${privyNewTotal.length} new)`;
      progress.completed++;

      // Process and save Privy addresses
      if (privyNewTotal.length > 0) {
        currentFetchStatus = `Fetching BofA AMV for ${state} Privy (${privyNewTotal.length} new)...`;
        L.info(`Fetching BofA AMV for ${state} Privy (${privyNewTotal.length} new addresses)...`);
        const privyWithAmv = await fetchBofaAmv(privyNewTotal, token);
        const privySaveResults = await saveDealsToDb(privyWithAmv);
        L.info(`${state} Privy: Saved ${privySaveResults.saved}, Updated ${privySaveResults.updated}`);
        allDeals.push(...privyWithAmv);
        progress.states[state].newFound += privyNewTotal.length;
        progress.states[state].bofaComplete = true;
      } else {
        L.info(`${state} Privy: No new addresses found after ${privyPage - 1} pages`);
        progress.states[state].bofaComplete = true;
      }
    }

    // Save all deals to database
    currentFetchStatus = `Saving ${allDeals.length} addresses to database...`;
    L.info(`Saving ${allDeals.length} deals to database...`);
    const saveResults = await saveDealsToDb(allDeals);

    L.info('Auto-fetch complete', {
      totalDeals: allDeals.length,
      ...saveResults
    });

    // Release lock
    isAutoFetchRunning = false;
    currentFetchStatus = null;

    res.json({
      ok: true,
      totalFetched: allDeals.length,
      ...saveResults,
      progress,
    });
  } catch (err) {
    // Release lock on error
    isAutoFetchRunning = false;
    currentFetchStatus = null;

    L.error('Auto-fetch failed', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Auto-fetch failed' });
  }
});

// GET /api/auto-fetch/status - Check if auto-fetch is running
router.get('/status', async (req, res) => {
  res.json({
    ok: true,
    isRunning: isAutoFetchRunning,
    currentStatus: currentFetchStatus,
    loopStats: loopStats,
    progressTracker: progressTracker
  });
});

// GET /api/auto-fetch/progress - Get detailed progress for resume
router.get('/progress', async (req, res) => {
  res.json({
    ok: true,
    progressTracker: progressTracker
  });
});

// POST /api/auto-fetch/reset-progress - Reset progress tracker
router.post('/reset-progress', async (req, res) => {
  const { source, startStateIndex } = req.body; // 'privy', 'redfin', or 'all'; optionally set starting state index

  if (source === 'privy' || source === 'all') {
    progressTracker.privy = {
      currentStateIndex: startStateIndex ?? 0,  // Default to 0 (AL)
      lastAddress: null,
      fetchedCount: 0,
      pendingAddresses: [],
      totalProcessed: 0
    };
  }
  if (source === 'redfin' || source === 'all') {
    progressTracker.redfin = {
      currentStateIndex: startStateIndex ?? 0,
      lastAddress: null,
      fetchedCount: 0,
      pendingAddresses: [],
      totalProcessed: 0
    };
  }
  if (source === 'all') {
    progressTracker.currentSource = 'privy';
  }

  L.info('Progress tracker reset', { source, startStateIndex, progressTracker });
  res.json({ ok: true, message: `Progress reset for ${source}`, progressTracker });
});

// POST /api/auto-fetch/stop - Stop the continuous loop
router.post('/stop', async (req, res) => {
  if (!isAutoFetchRunning) {
    return res.json({ ok: true, message: 'No auto-fetch running' });
  }
  shouldStopLoop = true;
  currentFetchStatus = 'Stopping after current batch...';
  L.info('Stop requested for auto-fetch loop');
  res.json({ ok: true, message: 'Stop signal sent. Will stop after current batch completes.' });
});

// POST /api/auto-fetch/continuous - Run continuous loop until stopped
router.post('/continuous', async (req, res) => {
  if (isAutoFetchRunning) {
    return res.status(429).json({
      ok: false,
      error: 'Auto-fetch already in progress',
      status: currentFetchStatus,
      loopStats: loopStats
    });
  }

  // Default to only Privy for now (Redfin disabled until needed)
  const { states, targetPerSource = 500, batchSize = 20, delayBetweenBatches = 5000, sources = ['privy'] } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '') || '';

  if (!Array.isArray(states) || states.length === 0) {
    return res.status(400).json({ ok: false, error: 'states array is required' });
  }

  // Validate sources
  const validSources = ['redfin', 'privy'];
  const selectedSources = Array.isArray(sources) ? sources.filter(s => validSources.includes(s)) : validSources;
  if (selectedSources.length === 0) {
    return res.status(400).json({ ok: false, error: 'At least one valid source required (redfin, privy)' });
  }

  // Initialize
  isAutoFetchRunning = true;
  shouldStopLoop = false;
  loopStats = {
    startedAt: new Date().toISOString(),
    targetPerSource,
    states,
    sources: selectedSources,
    totalFetched: { privy: 0, redfin: 0 },
    totalSaved: 0,
    totalDeals: 0,
    loopCount: 0,
    currentState: null,
    errors: []
  };

  L.info('Starting continuous auto-fetch', { states, targetPerSource, batchSize, sources: selectedSources });

  // Send immediate response - loop runs in background
  res.json({
    ok: true,
    message: `Started continuous fetch for ${states.length} states. Sources: ${selectedSources.join(', ')}. Target: ${targetPerSource} per source per state.`,
    checkStatus: 'GET /api/auto-fetch/status',
    stopEndpoint: 'POST /api/auto-fetch/stop'
  });

  // Run the continuous loop in background
  runContinuousLoop(states, targetPerSource, batchSize, delayBetweenBatches, token, selectedSources).catch(err => {
    L.error('Continuous loop error', { error: err?.message });
    loopStats.errors.push({ time: new Date().toISOString(), error: err?.message });
    isAutoFetchRunning = false;
    currentFetchStatus = null;
  });
});

// Background continuous loop function
// New flow:
// - Privy goes through ALL states (from its currentStateIndex) → 500 per state → 2min break → BofA → 2min break
// - Then Redfin goes through ALL states (from its currentStateIndex) → 500 per state → 2min break → BofA → 2min break
// - Each source tracks its own state position independently
// - After both complete all states, loop starts over
async function runContinuousLoop(states, targetPerSource, batchSize, delayBetweenBatches, token, sources = ['privy', 'redfin']) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const TWO_MINUTES = 2 * 60 * 1000; // 2 minutes in ms
  const runRedfin = sources.includes('redfin');
  const runPrivy = sources.includes('privy');

  // Helper to process a single state for a source
  async function processStateForSource(sourceName, state, stateIndex) {
    const fetchFn = sourceName === 'privy' ? fetchFromPrivy : fetchFromRedfin;
    let collected = [];

    currentFetchStatus = `${sourceName.toUpperCase()} | State ${stateIndex + 1}/${states.length} (${state}): Collecting (0/${targetPerSource})...`;
    L.info(`${state} ${sourceName.toUpperCase()}: Starting to collect ${targetPerSource} addresses...`);

    // Collect addresses until we have target (or no more available)
    let retryCount = 0;
    const MAX_EMPTY_RETRIES = 5; // Stop if we get 5 consecutive empty results

    while (collected.length < targetPerSource && !shouldStopLoop && retryCount < MAX_EMPTY_RETRIES) {
      currentFetchStatus = `${sourceName.toUpperCase()} | State ${stateIndex + 1}/${states.length} (${state}): Collecting (${collected.length}/${targetPerSource})...`;

      const addresses = await fetchFn(state, batchSize, token, 1);
      if (addresses.length === 0) {
        retryCount++;
        L.info(`${state} ${sourceName.toUpperCase()}: No addresses returned (retry ${retryCount}/${MAX_EMPTY_RETRIES})`);
        await sleep(delayBetweenBatches);
        continue;
      }

      const { newAddresses } = await filterNewAddresses(addresses);
      if (newAddresses.length === 0) {
        retryCount++;
        L.info(`${state} ${sourceName.toUpperCase()}: All addresses already exist (retry ${retryCount}/${MAX_EMPTY_RETRIES})`);
        await sleep(delayBetweenBatches);
        continue;
      }

      // Reset retry count on success
      retryCount = 0;

      // Add to collection
      const needed = targetPerSource - collected.length;
      const toAdd = newAddresses.slice(0, needed);
      collected.push(...toAdd);

      // Track progress
      progressTracker[sourceName].fetchedCount = collected.length;
      progressTracker[sourceName].lastAddress = toAdd[toAdd.length - 1]?.fullAddress || null;

      L.info(`${state} ${sourceName.toUpperCase()}: Collected ${toAdd.length} (total: ${collected.length}/${targetPerSource})`);
      await sleep(delayBetweenBatches);
    }

    return collected;
  }

  try {
    while (!shouldStopLoop) {
      loopStats.loopCount++;
      L.info(`=== Starting loop #${loopStats.loopCount} === Sources: ${sources.join(', ')}`);

      // ========== PRIVY: Process ALL states ==========
      if (runPrivy && !shouldStopLoop) {
        progressTracker.currentSource = 'privy';
        L.info(`PRIVY: Starting from state index ${progressTracker.privy.currentStateIndex}`);

        while (progressTracker.privy.currentStateIndex < states.length && !shouldStopLoop) {
          const stateIndex = progressTracker.privy.currentStateIndex;
          const state = states[stateIndex];

          loopStats.currentState = `PRIVY: ${state}`;
          currentFetchStatus = `Loop #${loopStats.loopCount} | PRIVY: Processing ${state} (${stateIndex + 1}/${states.length})`;
          L.info(`PRIVY: Processing state ${state} (${stateIndex + 1}/${states.length})`);

          const privyCollected = await processStateForSource('privy', state, stateIndex);
          loopStats.totalFetched.privy += privyCollected.length;
          progressTracker.privy.totalProcessed += privyCollected.length;

          if (privyCollected.length > 0 && !shouldStopLoop) {
            // Store pending addresses for BofA
            progressTracker.privy.pendingAddresses = privyCollected;

            // 2 MINUTE BREAK after collecting
            currentFetchStatus = `PRIVY | ${state}: Collected ${privyCollected.length}. Taking 2 min break before BofA...`;
            L.info(`${state} PRIVY: Collected ${privyCollected.length} addresses. Taking 2 min break...`);
            await sleep(TWO_MINUTES);

            if (shouldStopLoop) break;

            // BOFA AMV for Privy addresses
            currentFetchStatus = `PRIVY | ${state}: Getting BofA AMV for ${privyCollected.length} addresses...`;
            L.info(`${state} PRIVY: Fetching BofA AMV for ${privyCollected.length} addresses...`);

            const privyWithAmv = await fetchBofaAmv(privyCollected, token);
            const privySaveResults = await saveDealsToDb(privyWithAmv);

            loopStats.totalSaved += privySaveResults.saved;
            loopStats.totalDeals += privySaveResults.dealsCount;

            // Clear pending
            progressTracker.privy.pendingAddresses = [];
            progressTracker.privy.fetchedCount = 0; // Reset for next state

            L.info(`${state} PRIVY: Saved ${privySaveResults.saved}, Deals found: ${privySaveResults.dealsCount}`);

            // 2 MINUTE BREAK after BofA
            currentFetchStatus = `PRIVY | ${state} complete. Taking 2 min break before next state...`;
            L.info(`${state} PRIVY complete. Taking 2 min break...`);
            await sleep(TWO_MINUTES);
          }

          // Move to next state
          progressTracker.privy.currentStateIndex++;
          L.info(`PRIVY: Moving to state index ${progressTracker.privy.currentStateIndex}`);
        }

        // Reset Privy state index for next full loop
        if (progressTracker.privy.currentStateIndex >= states.length) {
          L.info(`PRIVY: Completed all ${states.length} states. Resetting to 0 for next loop.`);
          progressTracker.privy.currentStateIndex = 0;
        }
      }

      if (shouldStopLoop) break;

      // ========== REDFIN: Process ALL states ==========
      if (runRedfin && !shouldStopLoop) {
        progressTracker.currentSource = 'redfin';
        L.info(`REDFIN: Starting from state index ${progressTracker.redfin.currentStateIndex}`);

        while (progressTracker.redfin.currentStateIndex < states.length && !shouldStopLoop) {
          const stateIndex = progressTracker.redfin.currentStateIndex;
          const state = states[stateIndex];

          loopStats.currentState = `REDFIN: ${state}`;
          currentFetchStatus = `Loop #${loopStats.loopCount} | REDFIN: Processing ${state} (${stateIndex + 1}/${states.length})`;
          L.info(`REDFIN: Processing state ${state} (${stateIndex + 1}/${states.length})`);

          const redfinCollected = await processStateForSource('redfin', state, stateIndex);
          loopStats.totalFetched.redfin += redfinCollected.length;
          progressTracker.redfin.totalProcessed += redfinCollected.length;

          if (redfinCollected.length > 0 && !shouldStopLoop) {
            // Store pending addresses for BofA
            progressTracker.redfin.pendingAddresses = redfinCollected;

            // 2 MINUTE BREAK after collecting
            currentFetchStatus = `REDFIN | ${state}: Collected ${redfinCollected.length}. Taking 2 min break before BofA...`;
            L.info(`${state} REDFIN: Collected ${redfinCollected.length} addresses. Taking 2 min break...`);
            await sleep(TWO_MINUTES);

            if (shouldStopLoop) break;

            // BOFA AMV for Redfin addresses
            currentFetchStatus = `REDFIN | ${state}: Getting BofA AMV for ${redfinCollected.length} addresses...`;
            L.info(`${state} REDFIN: Fetching BofA AMV for ${redfinCollected.length} addresses...`);

            const redfinWithAmv = await fetchBofaAmv(redfinCollected, token);
            const redfinSaveResults = await saveDealsToDb(redfinWithAmv);

            loopStats.totalSaved += redfinSaveResults.saved;
            loopStats.totalDeals += redfinSaveResults.dealsCount;

            // Clear pending
            progressTracker.redfin.pendingAddresses = [];
            progressTracker.redfin.fetchedCount = 0; // Reset for next state

            L.info(`${state} REDFIN: Saved ${redfinSaveResults.saved}, Deals found: ${redfinSaveResults.dealsCount}`);

            // 2 MINUTE BREAK after BofA
            currentFetchStatus = `REDFIN | ${state} complete. Taking 2 min break before next state...`;
            L.info(`${state} REDFIN complete. Taking 2 min break...`);
            await sleep(TWO_MINUTES);
          }

          // Move to next state
          progressTracker.redfin.currentStateIndex++;
          L.info(`REDFIN: Moving to state index ${progressTracker.redfin.currentStateIndex}`);
        }

        // Reset Redfin state index for next full loop
        if (progressTracker.redfin.currentStateIndex >= states.length) {
          L.info(`REDFIN: Completed all ${states.length} states. Resetting to 0 for next loop.`);
          progressTracker.redfin.currentStateIndex = 0;
        }
      }

      if (!shouldStopLoop) {
        currentFetchStatus = `Loop #${loopStats.loopCount} complete. Total: Privy=${loopStats.totalFetched.privy}, Redfin=${loopStats.totalFetched.redfin}. Starting next loop...`;
        L.info(`Loop #${loopStats.loopCount} complete`, loopStats);
      }
    }

    // Loop ended
    loopStats.endedAt = new Date().toISOString();
    currentFetchStatus = `Stopped. Total: Privy=${loopStats.totalFetched.privy}, Redfin=${loopStats.totalFetched.redfin}`;
    L.info('Continuous loop stopped', loopStats);

  } finally {
    isAutoFetchRunning = false;
    shouldStopLoop = false;
  }
}

export default router;
