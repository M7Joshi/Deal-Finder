/**
 * Wells Fargo Agent Fetcher API Routes
 *
 * Endpoints:
 *   GET  /api/wellsfargo/agent?address=...  - Fetch agent for single address
 *   POST /api/wellsfargo/batch              - Fetch agents for multiple addresses
 */

import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import { getSharedBot, resetBot } from '../vendors/wellsfargo/index.js';

const router = express.Router();
const L = log.child('wellsfargo:route');

// Request queue to prevent concurrent scraping
let scrapingInProgress = false;
let scrapingQueue = [];

async function waitForScrapingSlot() {
  if (!scrapingInProgress) {
    scrapingInProgress = true;
    return true;
  }

  return new Promise((resolve) => {
    L.info('Queuing request, scraping already in progress');
    scrapingQueue.push({ resolve });
  });
}

function releaseScrapingSlot() {
  if (scrapingQueue.length > 0) {
    const next = scrapingQueue.shift();
    L.info('Processing queued request');
    next.resolve(true);
  } else {
    scrapingInProgress = false;
  }
}

/**
 * GET /api/wellsfargo/agent
 *
 * Fetch agent/loan officer information for a single address
 *
 * Query params:
 *   - address (required): Full property address
 */
router.get('/agent', requireAuth, async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({
      ok: false,
      error: 'Address parameter is required',
    });
  }

  L.info('Agent fetch request', { address });

  await waitForScrapingSlot();

  try {
    const bot = await getSharedBot();
    const result = await bot.fetchAgent(address);

    releaseScrapingSlot();

    return res.json(result);
  } catch (err) {
    L.error('Agent fetch failed', { address, error: err.message });

    releaseScrapingSlot();

    // Reset bot on error
    await resetBot();

    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to fetch agent',
      address,
    });
  }
});

/**
 * POST /api/wellsfargo/batch
 *
 * Fetch agent/loan officer information for multiple addresses
 *
 * Body:
 *   - addresses (required): Array of full property addresses
 *   - concurrency (optional): Number of parallel requests (default: 1)
 */
router.post('/batch', requireAuth, async (req, res) => {
  const { addresses, concurrency = 1 } = req.body;

  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'addresses array is required',
    });
  }

  L.info('Batch agent fetch request', { count: addresses.length });

  const results = [];
  let successful = 0;
  let failed = 0;

  // Process sequentially since browser can only handle one at a time
  for (const address of addresses) {
    await waitForScrapingSlot();

    try {
      const bot = await getSharedBot();
      const result = await bot.fetchAgent(address);

      results.push(result);

      if (result.ok) {
        successful++;
      } else {
        failed++;
      }
    } catch (err) {
      L.error('Batch item failed', { address, error: err.message });
      results.push({
        ok: false,
        address,
        error: err.message,
        scrapedAt: new Date().toISOString(),
      });
      failed++;

      // Reset bot on error
      await resetBot();
    } finally {
      releaseScrapingSlot();
    }
  }

  L.info('Batch complete', { total: addresses.length, successful, failed });

  return res.json({
    ok: true,
    results,
    summary: {
      total: addresses.length,
      successful,
      failed,
    },
  });
});

/**
 * POST /api/wellsfargo/reset
 *
 * Reset the bot instance (useful if stuck or errored)
 */
router.post('/reset', requireAuth, async (req, res) => {
  L.info('Bot reset requested');

  try {
    await resetBot();
    return res.json({ ok: true, message: 'Bot reset successfully' });
  } catch (err) {
    L.error('Bot reset failed', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/wellsfargo/status
 *
 * Get current bot status
 */
router.get('/status', requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    scrapingInProgress,
    queueLength: scrapingQueue.length,
  });
});

export default router;
