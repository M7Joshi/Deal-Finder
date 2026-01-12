// backend/routes/dashboard.js
import express from 'express';
import Property from '../models/Property.js';
import { requireAuth, scopeByState } from '../middleware/authMiddleware.js';

const router = express.Router();

// NOTE: Auth removed - this project doesn't use authentication
// router.use(requireAuth, scopeByState());

/**
 * GET /api/dashboard/summary?months=12
 * Returns stats filtered by user's allowed states:
 *  - totals: { deals, nonDeals, properties }
 *  - dealsPerMonth:    [{ month: '2025-09', count: 42 }, ...]
 *  - nonDealsPerMonth: [{ month: '2025-09', count: 99 }, ...]
 *  - dealsByState:     [{ state: 'TX', count: 10 }, ...]
 *  - nonDealsByState:  [{ state: 'TX', count: 50 }, ...]
 */
router.get('/summary', async (req, res) => {
  try {
    const months = Math.max(1, Math.min(36, parseInt(req.query.months || '12', 10)));
    const since = new Date();
    since.setMonth(since.getMonth() - months + 1); // include current month

    // Get state filter from middleware (empty for admins, filtered for subadmins)
    const stateFilter = req.stateFilter || {};

    // compute a robust date field (createdAt if present, else ObjectId time)
    const dateExpr = { $ifNull: ['$createdAt', { $toDate: '$_id' }] };

    // Totals (filtered by user's states)
    const [totalsAgg] = await Property.aggregate([
      { $match: stateFilter },
      {
        $group: {
          _id: null,
          properties: { $sum: 1 },
          deals: { $sum: { $cond: [{ $eq: ['$deal', true] }, 1, 0] } },
          nonDeals: { $sum: { $cond: [{ $ne: ['$deal', true] }, 1, 0] } }, // includes false + missing
        },
      },
    ]);

    // Helper builders - now include state filter
    const perMonth = (dealMatch) => ([
      { $match: { ...stateFilter, ...dealMatch } },
      { $addFields: { _date: dateExpr } },
      { $match: { _date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$_date' } }, count: { $sum: 1 } } },
      { $project: { _id: 0, month: '$_id', count: 1 } },
      { $sort: { month: 1 } },
    ]);

    const byState = (dealMatch) => ([
      { $match: { ...stateFilter, ...dealMatch } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
      { $project: { _id: 0, state: '$_id', count: 1 } },
      { $sort: { count: -1 } },
    ]);

    // Deals/non-deals (last N months)
    const [dealsPerMonth, nonDealsPerMonth] = await Promise.all([
      Property.aggregate(perMonth({ deal: true })),
      // treat "nonDeals" as (deal !== true) so false or missing show up
      Property.aggregate(perMonth({ $or: [ { deal: { $exists: false } }, { deal: { $ne: true } } ] })),
    ]);

    // Deals/non-deals by state (all-time, but only user's states)
    const [dealsByState, nonDealsByState] = await Promise.all([
      Property.aggregate(byState({ deal: true })),
      Property.aggregate(byState({ $or: [ { deal: { $exists: false } }, { deal: { $ne: true } } ] })),
    ]);

    // Include user's allowed states in response for frontend display
    const userStates = req.isAdmin ? 'all' : (req.user?.states || []);

    res.json({
      ok: true,
      data: {
        totals: {
          properties: totalsAgg?.properties || 0,
          deals: totalsAgg?.deals || 0,
          nonDeals: totalsAgg?.nonDeals || 0,
        },
        dealsPerMonth,
        nonDealsPerMonth,
        dealsByState,
        nonDealsByState,
        window: { since, months },
        userStates, // tells frontend which states user can see
      },
    });
  } catch (err) {
    console.error('dashboard summary error:', err);
    res.status(500).json({ ok: false, error: 'Failed to build dashboard summary' });
  }
});

/**
 * GET /api/dashboard/deals?limit=50&skip=0&sort=-createdAt&deal=true|false|all
 * Users can page through deals / non-deals / all (filtered by their states).
 * - deal=true  -> only deal: true
 * - deal=false -> deal !== true (includes false or missing)
 * - deal=all   -> no deal filter
 */
router.get('/deals', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
    const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
    const sort = String(req.query.sort || '-_id');
    const dealParam = String(req.query.deal || 'true').toLowerCase();

    // Get state filter from middleware (empty for admins, filtered for subadmins)
    const stateFilter = req.stateFilter || {};

    // Normalize sort safely
    const allowed = { createdAt: 1, updatedAt: 1, _id: 1 };
    const sortKey = sort.replace('-', '');
    const sortObj = (sortKey in allowed)
      ? (sort.startsWith('-') ? { [sortKey]: -1 } : { [sortKey]: 1 })
      : { _id: -1 };

    // Build query based on deal flag + state filter
    let match = { ...stateFilter };
    if (dealParam === 'true') {
      match = { ...stateFilter, deal: true };
    } else if (dealParam === 'false') {
      match = { ...stateFilter, $or: [{ deal: { $exists: false } }, { deal: { $ne: true } }] };
    } // 'all' leaves match = stateFilter only

    const rows = await Property.find(match)
      .sort(sortObj)
      .limit(limit)
      .skip(skip)
      .lean();

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('dashboard deals error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch deals' });
  }
});

export default router;