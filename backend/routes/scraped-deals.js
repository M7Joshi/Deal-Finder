import express from 'express';
import mongoose from 'mongoose';
import ScrapedDeal from '../models/ScrapedDeal.js';
import User from '../models/User.js';
import { log } from '../utils/logger.js';
import { requireAuth, scopeByState } from '../middleware/authMiddleware.js';
import { sendOffer, computeOfferPrice } from '../services/emailService.js';

const router = express.Router();
const L = log.child('scraped-deals');

// Apply auth to all routes - users only see their assigned states
router.use(requireAuth, scopeByState());

// Helper: Calculate if address qualifies as a deal
// Requirements: AMV >= 2x LP AND AMV > $200,000
const MIN_AMV_FOR_DEAL = 200000;

function calculateIsDeal(amv, listingPrice) {
  if (!amv || !listingPrice || amv <= 0 || listingPrice <= 0) {
    return false;
  }
  // Must be AMV >= 2x listing price AND AMV > $200,000
  return amv >= (listingPrice * 2) && amv > MIN_AMV_FOR_DEAL;
}

// Helper: Validate email format
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Helper: Find subadmin assigned to a specific state
// Returns subadmin info including SMTP credentials for sending emails
async function findSubadminByState(stateCode) {
  if (!stateCode) return null;

  const normalizedState = String(stateCode).toUpperCase().trim();

  // Find a subadmin who has this state in their states array
  const subadmin = await User.findOne({
    role: 'subadmin',
    states: normalizedState,
  }).lean();

  if (subadmin) {
    return {
      email: subadmin.email,
      name: subadmin.full_name || subadmin.email,
      // SMTP credentials for sending emails from subadmin's account
      smtp: {
        host: subadmin.smtp_host || null,
        port: subadmin.smtp_port || 587,
        user: subadmin.smtp_user || subadmin.email,
        pass: subadmin.smtp_pass || null,
        secure: subadmin.smtp_secure || false,
      },
    };
  }

  return null;
}

// Helper: Auto-send email to agent when deal qualifies
// Now looks up the subadmin assigned to the deal's state
async function autoSendAgentEmail(deal) {
  try {
    // Skip if no valid agent email
    if (!isValidEmail(deal.agentEmail)) {
      L.debug('Skipping auto-email: no valid agent email', { address: deal.fullAddress });
      return { sent: false, reason: 'no_email' };
    }

    // Skip if email already sent
    if (deal.agentEmailSent) {
      L.debug('Skipping auto-email: already sent', { address: deal.fullAddress });
      return { sent: false, reason: 'already_sent' };
    }

    // Skip if not a deal
    if (!deal.isDeal) {
      L.debug('Skipping auto-email: not a deal', { address: deal.fullAddress });
      return { sent: false, reason: 'not_a_deal' };
    }

    // Skip if no state (can't find subadmin without state)
    if (!deal.state) {
      L.debug('Skipping auto-email: no state on deal', { address: deal.fullAddress });
      return { sent: false, reason: 'no_state' };
    }

    // Find the subadmin assigned to this deal's state
    const subadmin = await findSubadminByState(deal.state);
    if (!subadmin) {
      L.debug('Skipping auto-email: no subadmin assigned to state', { address: deal.fullAddress, state: deal.state });
      return { sent: false, reason: 'no_subadmin_for_state' };
    }

    // Compute offer price
    const offerPrice = computeOfferPrice({
      listPrice: deal.listingPrice,
      amv: deal.amv,
    });

    if (!offerPrice) {
      L.debug('Skipping auto-email: cannot compute offer price', { address: deal.fullAddress });
      return { sent: false, reason: 'no_offer_price' };
    }

    // Build property object for email
    const property = {
      fullAddress: deal.fullAddress,
      listPrice: deal.listingPrice,
      amv: deal.amv,
      agentEmail: deal.agentEmail,
      agentName: deal.agentName || 'Listing Agent',
    };

    // Send the offer email FROM the subadmin assigned to this state
    const result = await sendOffer({ property, subadmin, offerPrice });

    L.info('Auto-sent agent email', {
      address: deal.fullAddress,
      agentEmail: deal.agentEmail,
      state: deal.state,
      fromSubadmin: subadmin.email,
      messageId: result?.messageId,
    });

    return {
      sent: true,
      messageId: result?.messageId || null,
      subadminEmail: subadmin.email,
    };
  } catch (err) {
    L.error('Failed to auto-send agent email', {
      address: deal.fullAddress,
      error: err?.message,
    });
    return { sent: false, reason: 'error', error: err?.message };
  }
}

// GET /api/scraped-deals/pending-amv - Get deals pending AMV and scraper status
router.get('/pending-amv', async (req, res) => {
  try {
    // Import scraper status
    let scraperStatus = { mode: 'unknown', addressesScrapedThisBatch: 0, batchLimit: 500 };
    try {
      const { getScraperStatus } = await import('../vendors/runAutomation.js');
      scraperStatus = getScraperStatus();
    } catch {}

    // Count deals pending AMV
    const pendingAMV = await ScrapedDeal.countDocuments({
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    });

    // Count deals with AMV
    const withAMV = await ScrapedDeal.countDocuments({
      amv: { $gt: 0 }
    });

    // Get ALL pending deals (for display) - include agent details
    // No limit - show all addresses pending AMV (up to batch limit of 500)
    const recentPending = await ScrapedDeal.find({
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    })
      .sort({ scrapedAt: -1 })
      .select('fullAddress state listingPrice scrapedAt source agentName agentPhone agentEmail')
      .lean();

    // Group pending by state
    const pendingByState = await ScrapedDeal.aggregate([
      { $match: { $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }] } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      ok: true,
      scraperStatus,
      stats: {
        pendingAMV,
        withAMV,
        total: pendingAMV + withAMV
      },
      pendingByState,
      recentPending
    });
  } catch (err) {
    L.error('Failed to get pending AMV status', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message });
  }
});

// GET /api/scraped-deals - Get all scraped deals (filtered by user's states)
router.get('/', async (req, res) => {
  try {
    const { source, state, limit = 100, skip = 0 } = req.query;

    // Start with user's state filter from middleware
    const filter = { ...req.stateFilter };
    if (source) filter.source = source;
    // Allow further state filtering only within user's allowed states
    if (state) filter.state = String(state).toUpperCase();

    const deals = await ScrapedDeal.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    const total = await ScrapedDeal.countDocuments(filter);

    // Include user's allowed states in response
    const userStates = req.isAdmin ? 'all' : (req.user?.states || []);

    res.json({
      ok: true,
      rows: deals,
      total,
      limit: Number(limit),
      skip: Number(skip),
      userStates,
    });
  } catch (err) {
    L.error('Failed to fetch scraped deals', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch scraped deals' });
  }
});

// POST /api/scraped-deals/save - Save deals from fetcher (bulk upsert)
router.post('/save', async (req, res) => {
  try {
    const { deals } = req.body;

    if (!Array.isArray(deals) || deals.length === 0) {
      return res.status(400).json({ ok: false, error: 'deals array is required' });
    }

    const results = {
      saved: 0,
      updated: 0,
      failed: 0,
      emailsSent: 0,
      errors: [],
    };

    for (const deal of deals) {
      try {
        const fullAddress = String(deal.fullAddress || deal.address || '').trim();
        if (!fullAddress) {
          results.failed++;
          results.errors.push({ address: 'unknown', error: 'Missing address' });
          continue;
        }

        const fullAddress_ci = fullAddress.toLowerCase();

        // Parse address components if not provided
        let { city, state, zip } = deal;
        if (!city || !state) {
          // Try to parse from fullAddress: "123 Main St, City, ST 12345"
          const parts = fullAddress.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            city = city || parts[1];
            // Last part might be "ST 12345" or just "12345"
            const lastPart = parts[parts.length - 1];
            const stateZipMatch = lastPart.match(/([A-Z]{2})\s*(\d{5})?/i);
            if (stateZipMatch) {
              state = state || stateZipMatch[1].toUpperCase();
              zip = zip || stateZipMatch[2] || '';
            }
          }
        }

        // Extract agent details (handle various field naming conventions)
        const agentName = deal.agentName || deal.agent_name || deal.agent || null;
        const agentPhone = deal.agentPhone || deal.agent_phone || deal.phone || null;
        const agentEmail = deal.agentEmail || deal.agent_email || deal.email || null;
        const brokerage = deal.brokerage || deal.agent_brokerage || null;

        const updateData = {
          address: deal.address || fullAddress.split(',')[0]?.trim() || fullAddress,
          fullAddress,
          fullAddress_ci,
          city: city || null,
          state: state ? String(state).toUpperCase() : null,
          zip: zip || null,
          listingPrice: deal.listingPrice ?? deal.price ?? null,
          amv: deal.amv ?? null,
          source: deal.source || 'unknown',
          beds: deal.beds ?? null,
          baths: deal.baths ?? null,
          sqft: deal.sqft ?? null,
          agentName: agentName || null,
          agentPhone: agentPhone || null,
          agentEmail: agentEmail || null,
          brokerage: brokerage || null,
          scrapedAt: deal.scrapedAt || new Date(),
          bofaFetchedAt: deal.amv ? new Date() : null,
          createdBy: deal.createdBy || null,
        };

        // Upsert by fullAddress_ci (avoid duplicates)
        const existing = await ScrapedDeal.findOne({ fullAddress_ci });

        if (existing) {
          // Update existing - merge AMV and agent data if we have new values
          const finalAmv = updateData.amv ?? existing.amv;
          const finalLp = updateData.listingPrice ?? existing.listingPrice;
          const isDeal = calculateIsDeal(finalAmv, finalLp);

          // Preserve existing agent data if new data is null
          const finalAgentName = updateData.agentName ?? existing.agentName;
          const finalAgentPhone = updateData.agentPhone ?? existing.agentPhone;
          const finalAgentEmail = updateData.agentEmail ?? existing.agentEmail;
          const finalBrokerage = updateData.brokerage ?? existing.brokerage;

          // Check if we should auto-send email (only if becoming a deal now and not already sent)
          const shouldSendEmail = isDeal && !existing.agentEmailSent && isValidEmail(finalAgentEmail);

          await ScrapedDeal.updateOne(
            { fullAddress_ci },
            {
              $set: {
                ...updateData,
                // Keep existing AMV if new one is null
                amv: finalAmv,
                bofaFetchedAt: updateData.amv ? new Date() : existing.bofaFetchedAt,
                isDeal,
                // Keep existing agent data if new data is null
                agentName: finalAgentName,
                agentPhone: finalAgentPhone,
                agentEmail: finalAgentEmail,
                brokerage: finalBrokerage,
              }
            }
          );
          results.updated++;

          // Auto-send email if this is a new deal with valid agent email
          if (shouldSendEmail) {
            // Get the state from updateData or existing record
            const dealState = updateData.state || existing.state;
            const dealForEmail = {
              fullAddress,
              listingPrice: finalLp,
              amv: finalAmv,
              agentEmail: finalAgentEmail,
              agentName: finalAgentName,
              state: dealState,
              isDeal: true,
              agentEmailSent: false,
            };
            const emailResult = await autoSendAgentEmail(dealForEmail);
            if (emailResult.sent) {
              await ScrapedDeal.updateOne(
                { fullAddress_ci },
                {
                  $set: {
                    agentEmailSent: true,
                    emailSentAt: new Date(),
                    emailMessageId: emailResult.messageId || null,
                  }
                }
              );
              results.emailsSent++;
            }
          }
        } else {
          // Create new - isDeal will be calculated by pre-save hook
          const newDeal = await ScrapedDeal.create(updateData);
          results.saved++;

          // Auto-send email if this is a deal with valid agent email
          if (newDeal.isDeal && isValidEmail(newDeal.agentEmail)) {
            const emailResult = await autoSendAgentEmail(newDeal);
            if (emailResult.sent) {
              await ScrapedDeal.updateOne(
                { _id: newDeal._id },
                {
                  $set: {
                    agentEmailSent: true,
                    emailSentAt: new Date(),
                    emailMessageId: emailResult.messageId || null,
                  }
                }
              );
              results.emailsSent++;
            }
          }
        }
      } catch (err) {
        results.failed++;
        results.errors.push({
          address: deal.fullAddress || deal.address || 'unknown',
          error: err?.message
        });
      }
    }

    L.info('Saved scraped deals', { saved: results.saved, updated: results.updated, failed: results.failed, emailsSent: results.emailsSent });

    res.json({
      ok: true,
      ...results,
    });
  } catch (err) {
    L.error('Failed to save scraped deals', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to save scraped deals' });
  }
});

// DELETE /api/scraped-deals/:id - Delete a single deal
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ScrapedDeal.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ ok: false, error: 'Deal not found' });
    }

    res.json({ ok: true, deleted: id });
  } catch (err) {
    L.error('Failed to delete scraped deal', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to delete deal' });
  }
});

// DELETE /api/scraped-deals - Delete all deals (with optional filter)
router.delete('/', async (req, res) => {
  try {
    const { source, state } = req.query;

    const filter = {};
    if (source) filter.source = source;
    if (state) filter.state = String(state).toUpperCase();

    const result = await ScrapedDeal.deleteMany(filter);

    L.info('Deleted scraped deals', { count: result.deletedCount, filter });

    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    L.error('Failed to delete scraped deals', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to delete deals' });
  }
});

// POST /api/scraped-deals/clear-all - Clear all data and reset batch counter
router.post('/clear-all', async (req, res) => {
  try {
    // Import reset function
    let resetBatchCounter;
    try {
      const automation = await import('../vendors/runAutomation.js');
      resetBatchCounter = automation.resetBatchCounter;
    } catch {}

    // Clear ScrapedDeal
    const scrapedResult = await ScrapedDeal.deleteMany({});
    L.info('Cleared ScrapedDeal', { count: scrapedResult.deletedCount });

    // Reset batch counter if available
    if (resetBatchCounter) {
      resetBatchCounter();
      L.info('Reset batch counter to 0');
    }

    res.json({
      ok: true,
      cleared: {
        scrapedDeals: scrapedResult.deletedCount,
      },
      batchCounterReset: !!resetBatchCounter,
      message: 'All data cleared. Ready to start fresh!',
    });
  } catch (err) {
    L.error('Failed to clear all data', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to clear data' });
  }
});

// POST /api/scraped-deals/cleanup-invalid - Remove records with invalid/malformed addresses
router.post('/cleanup-invalid', async (req, res) => {
  try {
    // Find and delete records where fullAddress looks like description text
    // Invalid addresses typically:
    // - Start with numbers followed by words like "from", "Welcome", "Located"
    // - Contain words like "bedroom", "bath", "sqft" without proper street format
    // - Are very long (descriptions) instead of addresses
    // - Don't have a proper state code (2 letters)

    const invalidPatterns = [
      // Addresses that start with description-like text
      { fullAddress: { $regex: /^\d+\s+(from|Welcome|Located|This|Beautiful|Lovely|Spacious|Great|Amazing|Stunning)/i } },
      // Addresses that contain bedroom/bath counts as main text
      { fullAddress: { $regex: /^\d*\s*(Bedroom|Bath|bed|bath|sqft|sq ft)/i } },
      // Addresses longer than 200 chars (likely descriptions)
      { $expr: { $gt: [{ $strLenCP: '$fullAddress' }, 200] } },
      // Addresses that don't contain a comma (no city/state separation)
      { fullAddress: { $not: /,/ } },
      // Addresses that are just fragments like "St" or "Ave"
      { fullAddress: { $regex: /^(St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Cir)\s*,?\s*\d*\s*(Bedroom|Bath)?/i } },
    ];

    // Count before deletion
    const countBefore = await ScrapedDeal.countDocuments({});

    // Delete invalid records
    const result = await ScrapedDeal.deleteMany({ $or: invalidPatterns });

    const countAfter = await ScrapedDeal.countDocuments({});

    L.info('Cleaned up invalid addresses', {
      deleted: result.deletedCount,
      before: countBefore,
      after: countAfter
    });

    res.json({
      ok: true,
      deleted: result.deletedCount,
      before: countBefore,
      after: countAfter,
      message: `Removed ${result.deletedCount} invalid/malformed addresses`
    });
  } catch (err) {
    L.error('Failed to cleanup invalid addresses', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to cleanup' });
  }
});

// GET /api/scraped-deals/stats - Get stats for dashboard (filtered by user's states)
router.get('/stats', async (req, res) => {
  try {
    // Get state filter from middleware
    const stateFilter = req.stateFilter || {};

    const total = await ScrapedDeal.countDocuments(stateFilter);
    const bySource = await ScrapedDeal.aggregate([
      { $match: stateFilter },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    const byState = await ScrapedDeal.aggregate([
      { $match: stateFilter },
      { $group: { _id: '$state', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    const withAmv = await ScrapedDeal.countDocuments({ ...stateFilter, amv: { $ne: null, $gt: 0 } });
    const dealsCount = await ScrapedDeal.countDocuments({ ...stateFilter, isDeal: true });

    // Include user's allowed states in response
    const userStates = req.isAdmin ? 'all' : (req.user?.states || []);

    res.json({
      ok: true,
      stats: {
        total,
        withAmv,
        dealsCount, // Count of addresses where AMV >= 2x LP
        bySource: bySource.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        byState: byState.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
      },
      userStates,
    });
  } catch (err) {
    L.error('Failed to get scraped deals stats', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to get stats' });
  }
});

// GET /api/scraped-deals/deals - Get only addresses that qualify as deals
// Requirements: AMV >= 2x LP AND AMV > $200,000
// Filtered by user's allowed states
router.get('/deals', async (req, res) => {
  try {
    const { source, state, limit = 100, skip = 0 } = req.query;

    // Start with user's state filter + isDeal requirement
    // isDeal already includes the AMV > $200,000 check
    const filter = {
      ...req.stateFilter,
      isDeal: true
    };
    if (source) filter.source = source;
    if (state) filter.state = String(state).toUpperCase();

    const deals = await ScrapedDeal.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    const total = await ScrapedDeal.countDocuments(filter);

    // Include user's allowed states in response
    const userStates = req.isAdmin ? 'all' : (req.user?.states || []);

    res.json({
      ok: true,
      rows: deals,
      total,
      limit: Number(limit),
      skip: Number(skip),
      userStates,
    });
  } catch (err) {
    L.error('Failed to fetch deals', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch deals' });
  }
});

// POST /api/scraped-deals/recalculate - Recalculate isDeal for all existing records
router.post('/recalculate', async (_req, res) => {
  try {
    const all = await ScrapedDeal.find({});
    let updated = 0;
    let dealsFound = 0;

    for (const doc of all) {
      const isDeal = calculateIsDeal(doc.amv, doc.listingPrice);
      if (doc.isDeal !== isDeal) {
        doc.isDeal = isDeal;
        await doc.save();
        updated++;
      }
      if (isDeal) dealsFound++;
    }

    L.info('Recalculated isDeal for all records', { total: all.length, updated, dealsFound });

    res.json({
      ok: true,
      total: all.length,
      updated,
      dealsFound,
    });
  } catch (err) {
    L.error('Failed to recalculate deals', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to recalculate' });
  }
});

// GET /api/scraped-deals/deals-with-agents - Get deals with agent information
// Agent details are now stored directly in ScrapedDeal, with fallback to Property collection
router.get('/deals-with-agents', async (req, res) => {
  try {
    const { source, state, limit = 100, skip = 0 } = req.query;

    // Start with user's state filter + isDeal requirement
    const matchFilter = {
      ...req.stateFilter,
      isDeal: true
    };
    if (source) matchFilter.source = source;
    if (state) matchFilter.state = String(state).toUpperCase();

    // Aggregate to get deals, with fallback lookup to properties collection for legacy data
    const pipeline = [
      { $match: matchFilter },
      { $sort: { createdAt: -1 } },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
      {
        // Fallback lookup for legacy deals without agent data
        $lookup: {
          from: 'properties',
          let: { dealAddress: '$fullAddress_ci' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toLower: '$fullAddress' }, '$$dealAddress']
                }
              }
            },
            {
              $project: {
                agentName: 1,
                agentPhone: 1,
                agentEmail: 1,
                agent: 1,
                agent_phone: 1,
                agent_email: 1,
              }
            }
          ],
          as: 'propertyAgent'
        }
      },
      {
        $addFields: {
          // Flatten agent data from properties (for fallback)
          propAgent: { $arrayElemAt: ['$propertyAgent', 0] },
        }
      },
      {
        $project: {
          _id: 1,
          address: 1,
          fullAddress: 1,
          city: 1,
          state: 1,
          zip: 1,
          listingPrice: 1,
          amv: 1,
          beds: 1,
          baths: 1,
          sqft: 1,
          source: 1,
          isDeal: 1,
          scrapedAt: 1,
          createdAt: 1,
          // Prefer ScrapedDeal agent fields, fallback to Property collection
          agentName: {
            $ifNull: [
              '$agentName',
              { $ifNull: ['$propAgent.agentName', '$propAgent.agent'] }
            ]
          },
          agentPhone: {
            $ifNull: [
              '$agentPhone',
              { $ifNull: ['$propAgent.agentPhone', '$propAgent.agent_phone'] }
            ]
          },
          agentEmail: {
            $ifNull: [
              '$agentEmail',
              { $ifNull: ['$propAgent.agentEmail', '$propAgent.agent_email'] }
            ]
          },
        }
      }
    ];

    const deals = await ScrapedDeal.aggregate(pipeline);
    const total = await ScrapedDeal.countDocuments(matchFilter);

    // Include user's allowed states in response
    const userStates = req.isAdmin ? 'all' : (req.user?.states || []);

    res.json({
      ok: true,
      rows: deals,
      total,
      limit: Number(limit),
      skip: Number(skip),
      userStates,
    });
  } catch (err) {
    L.error('Failed to fetch deals with agents', { error: err?.message });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch deals with agents' });
  }
});

export default router;
