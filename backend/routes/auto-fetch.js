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

// Helper: Fetch from Privy API with pagination
async function fetchFromPrivy(state, limit, token, page = 1) {
  try {
    // Fetch more than needed to account for duplicates, use page for pagination
    const fetchLimit = Math.min(limit * 3, 50); // Fetch up to 3x to find new ones
    const url = `${getServerUrl()}/api/live-scrape/privy?state=${state}&limit=${fetchLimit}&page=${page}`;
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
        state: addr.state || state,
        source: 'privy',
        stats: addr.stats || [],
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
    currentStatus: currentFetchStatus
  });
});

export default router;
