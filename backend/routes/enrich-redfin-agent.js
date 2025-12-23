// Endpoint to enrich Redfin property data with complete agent details via deep scraping
import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import { extractAgentDetails } from '../vendors/redfin/agentExtractor.js';

const router = express.Router();
const L = log.child('enrich-agent');

/**
 * POST /api/enrich-redfin-agent
 * Enrich a single property with complete agent details via deep scraping
 *
 * Body: { url: string }
 * Returns: { agentName, agentPhone, agentEmail, brokerage, agentLicense }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: 'URL is required'
      });
    }

    // Validate URL is a Redfin property page
    if (!url.includes('redfin.com')) {
      return res.status(400).json({
        ok: false,
        error: 'URL must be a Redfin property page'
      });
    }

    L.info(`Enriching agent details for: ${url}`);

    // Deep scrape the property page for agent details
    const agentDetails = await extractAgentDetails(url);

    L.info(`Agent enrichment complete`, { agentName: agentDetails.agentName });

    return res.json({
      ok: true,
      agent: agentDetails,
      enrichedAt: new Date().toISOString()
    });

  } catch (error) {
    L.error(`Agent enrichment failed: ${error.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to enrich agent details',
      message: error.message
    });
  }
});

/**
 * POST /api/enrich-redfin-agent/batch
 * Enrich multiple properties with agent details
 *
 * Body: { urls: string[] }
 * Returns: { results: AgentDetails[] }
 */
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'URLs array is required'
      });
    }

    L.info(`Batch enriching ${urls.length} properties`);

    // Process in batches to avoid overwhelming the system
    const results = [];
    const BATCH_SIZE = 3;
    const DELAY = 2000;

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (url) => {
        try {
          if (!url || !url.includes('redfin.com')) {
            return { url, error: 'Invalid URL', agent: null };
          }

          const agentDetails = await extractAgentDetails(url);
          return {
            url,
            agent: agentDetails,
            success: true
          };
        } catch (error) {
          L.warn(`Failed to enrich ${url}: ${error.message}`);
          return {
            url,
            error: error.message,
            agent: null,
            success: false
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < urls.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY));
      }
    }

    const successful = results.filter(r => r.success).length;
    L.info(`Batch enrichment complete: ${successful}/${urls.length} successful`);

    return res.json({
      ok: true,
      results,
      total: urls.length,
      successful,
      failed: urls.length - successful,
      enrichedAt: new Date().toISOString()
    });

  } catch (error) {
    L.error(`Batch agent enrichment failed: ${error.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to batch enrich agent details',
      message: error.message
    });
  }
});

export default router;
