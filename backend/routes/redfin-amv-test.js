// backend/routes/redfin-amv-test.js
// API endpoint for testing Redfin AMV via Stingray API
// Provides real-time results for the frontend dashboard

import express from 'express';
import ScrapedDeal from '../models/ScrapedDeal.js';

const router = express.Router();

/**
 * Fetch AMV from Redfin Stingray API
 */
async function fetchRedfinAMV(propertyId) {
  const url = `https://www.redfin.com/stingray/api/home/details/aboveTheFold?propertyId=${propertyId}&accessLevel=1`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/',
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    let text = await response.text();
    if (text.startsWith('{}&&')) {
      text = text.slice(4);
    }

    const json = JSON.parse(text);

    if (json.resultCode !== 0) {
      return { success: false, error: json.errorMessage || 'API error' };
    }

    const avmInfo = json.payload?.addressSectionInfo?.avmInfo;
    const amv = avmInfo?.predictedValue ? Math.round(avmInfo.predictedValue) : null;

    if (!amv) {
      return { success: false, error: 'NO_ESTIMATE' };
    }

    return { success: true, amv };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * GET /api/redfin-amv-test/stats
 * Get statistics about Redfin addresses with propertyId
 */
router.get('/stats', async (req, res) => {
  try {
    const totalRedfin = await ScrapedDeal.countDocuments({ source: 'redfin' });
    const withPropertyId = await ScrapedDeal.countDocuments({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
    });
    const pendingAMV = await ScrapedDeal.countDocuments({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }],
    });
    const withAMV = await ScrapedDeal.countDocuments({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
      amv: { $gt: 0 },
    });

    res.json({
      success: true,
      stats: {
        totalRedfin,
        withPropertyId,
        pendingAMV,
        withAMV,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/redfin-amv-test/sample
 * Get sample properties with propertyId for testing
 */
router.get('/sample', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const samples = await ScrapedDeal.find({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
    })
      .select('fullAddress redfinPropertyId listingPrice amv isDeal')
      .sort({ scrapedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, samples });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/redfin-amv-test/fetch-single
 * Fetch AMV for a single property ID
 */
router.post('/fetch-single', async (req, res) => {
  try {
    const { propertyId } = req.body;

    if (!propertyId) {
      return res.status(400).json({ success: false, error: 'propertyId is required' });
    }

    const startTime = Date.now();
    const result = await fetchRedfinAMV(propertyId);
    const elapsed = Date.now() - startTime;

    res.json({
      success: result.success,
      propertyId,
      amv: result.amv || null,
      error: result.error || null,
      timeMs: elapsed,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/redfin-amv-test/run-batch
 * Run AMV fetch for multiple properties and return results
 */
router.post('/run-batch', async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 10;
    const updateDb = req.body.updateDb !== false; // Default: update DB

    // Get properties with propertyId but no AMV
    const properties = await ScrapedDeal.find({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }],
    })
      .select('_id fullAddress redfinPropertyId listingPrice')
      .sort({ scrapedAt: -1 })
      .limit(limit)
      .lean();

    if (properties.length === 0) {
      return res.json({
        success: true,
        message: 'No properties pending AMV',
        results: [],
        summary: { total: 0, successful: 0, failed: 0, deals: 0 },
      });
    }

    const results = [];
    const totalStart = Date.now();

    for (const prop of properties) {
      const startTime = Date.now();
      const result = await fetchRedfinAMV(prop.redfinPropertyId);
      const elapsed = Date.now() - startTime;

      const item = {
        _id: prop._id,
        fullAddress: prop.fullAddress,
        propertyId: prop.redfinPropertyId,
        listingPrice: prop.listingPrice,
        amv: result.amv || null,
        success: result.success,
        error: result.error || null,
        timeMs: elapsed,
        isDeal: false,
      };

      // Calculate isDeal
      if (result.success && prop.listingPrice) {
        item.isDeal = result.amv >= prop.listingPrice * 2 && result.amv > 200000;
      }

      // Update DB if requested
      if (updateDb && result.success) {
        await ScrapedDeal.updateOne(
          { _id: prop._id },
          {
            $set: {
              amv: result.amv,
              redfinAmvFetchedAt: new Date(),
              isDeal: item.isDeal,
            },
          }
        );
        item.dbUpdated = true;
      }

      results.push(item);

      // Small delay between requests
      await new Promise((r) => setTimeout(r, 100));
    }

    const totalElapsed = Date.now() - totalStart;

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      deals: results.filter((r) => r.isDeal).length,
      totalTimeMs: totalElapsed,
      avgTimeMs: Math.round(totalElapsed / results.length),
    };

    res.json({
      success: true,
      results,
      summary,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/redfin-amv-test/stream-batch (Server-Sent Events)
 * Stream AMV fetch results in real-time
 */
router.get('/stream-batch', async (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const limit = parseInt(req.query.limit) || 10;

    // Get properties with propertyId but no AMV
    const properties = await ScrapedDeal.find({
      source: 'redfin',
      redfinPropertyId: { $ne: null, $exists: true },
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }],
    })
      .select('_id fullAddress redfinPropertyId listingPrice')
      .sort({ scrapedAt: -1 })
      .limit(limit)
      .lean();

    // Send initial info
    res.write(`data: ${JSON.stringify({ type: 'start', total: properties.length })}\n\n`);

    if (properties.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'complete', message: 'No properties pending AMV' })}\n\n`);
      res.end();
      return;
    }

    let successful = 0;
    let failed = 0;
    let deals = 0;
    const totalStart = Date.now();

    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      const startTime = Date.now();
      const result = await fetchRedfinAMV(prop.redfinPropertyId);
      const elapsed = Date.now() - startTime;

      let isDeal = false;
      if (result.success && prop.listingPrice) {
        isDeal = result.amv >= prop.listingPrice * 2 && result.amv > 200000;
      }

      if (result.success) {
        successful++;
        if (isDeal) deals++;

        // Update DB
        await ScrapedDeal.updateOne(
          { _id: prop._id },
          {
            $set: {
              amv: result.amv,
              redfinAmvFetchedAt: new Date(),
              isDeal,
            },
          }
        );
      } else {
        failed++;
      }

      // Send result event
      res.write(`data: ${JSON.stringify({
        type: 'result',
        index: i + 1,
        total: properties.length,
        fullAddress: prop.fullAddress,
        propertyId: prop.redfinPropertyId,
        listingPrice: prop.listingPrice,
        amv: result.amv || null,
        success: result.success,
        error: result.error || null,
        timeMs: elapsed,
        isDeal,
      })}\n\n`);

      // Small delay
      await new Promise((r) => setTimeout(r, 100));
    }

    const totalElapsed = Date.now() - totalStart;

    // Send completion event
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      summary: {
        total: properties.length,
        successful,
        failed,
        deals,
        totalTimeMs: totalElapsed,
        avgTimeMs: Math.round(totalElapsed / properties.length),
      },
    })}\n\n`);

    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
