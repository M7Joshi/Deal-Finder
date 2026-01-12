import express from 'express';
import ScrapedDeal from '../models/ScrapedDeal.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get deals by stage (email_sent, follow_up, deal_status)
router.get('/stage/:stage', authMiddleware, async (req, res) => {
  try {
    const { stage } = req.params;
    const { page = 1, limit = 50, status, sortBy = 'updatedAt', sortOrder = 'desc' } = req.query;

    const validStages = ['email_sent', 'follow_up', 'deal_status'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const query = { dealStage: stage };

    // For deal_status page, optionally filter by status
    if (stage === 'deal_status' && status) {
      query.dealStatus = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [deals, total] = await Promise.all([
      ScrapedDeal.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ScrapedDeal.countDocuments(query)
    ]);

    res.json({
      deals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching deals by stage:', error);
    res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

// Move deal to a different stage
router.put('/move/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { toStage, dealStatus, followUpDate, note } = req.body;

    const validStages = ['new', 'email_sent', 'follow_up', 'deal_status'];
    if (!validStages.includes(toStage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const updateData = { dealStage: toStage };

    // Set timestamp for when moved to each stage
    if (toStage === 'email_sent') {
      updateData.movedToEmailSentAt = new Date();
    } else if (toStage === 'follow_up') {
      updateData.movedToFollowUpAt = new Date();
      if (followUpDate) {
        updateData.followUpDate = new Date(followUpDate);
      }
    } else if (toStage === 'deal_status') {
      updateData.movedToDealStatusAt = new Date();
      if (dealStatus) {
        updateData.dealStatus = dealStatus;
      }
    }

    // Add note if provided
    if (note) {
      const deal = await ScrapedDeal.findById(id);
      if (deal) {
        deal.followUpNotes = deal.followUpNotes || [];
        deal.followUpNotes.push({
          note,
          createdAt: new Date(),
          createdBy: req.user?._id || null
        });
        Object.assign(deal, updateData);
        await deal.save();
        return res.json({ success: true, deal });
      }
    }

    const deal = await ScrapedDeal.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    res.json({ success: true, deal });
  } catch (error) {
    console.error('Error moving deal:', error);
    res.status(500).json({ error: 'Failed to move deal' });
  }
});

// Update deal status (for deal_status page)
router.put('/status/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { dealStatus, offerAmount, note } = req.body;

    const validStatuses = ['pending', 'interested', 'not_interested', 'under_contract', 'closed', 'dead'];
    if (dealStatus && !validStatuses.includes(dealStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData = {};
    if (dealStatus) updateData.dealStatus = dealStatus;
    if (offerAmount !== undefined) updateData.offerAmount = offerAmount;

    // Add note if provided
    if (note) {
      const deal = await ScrapedDeal.findById(id);
      if (deal) {
        deal.followUpNotes = deal.followUpNotes || [];
        deal.followUpNotes.push({
          note,
          createdAt: new Date(),
          createdBy: req.user?._id || null
        });
        Object.assign(deal, updateData);
        await deal.save();
        return res.json({ success: true, deal });
      }
    }

    const deal = await ScrapedDeal.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    res.json({ success: true, deal });
  } catch (error) {
    console.error('Error updating deal status:', error);
    res.status(500).json({ error: 'Failed to update deal' });
  }
});

// Add note to a deal
router.post('/note/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'Note is required' });
    }

    const deal = await ScrapedDeal.findById(id);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    deal.followUpNotes = deal.followUpNotes || [];
    deal.followUpNotes.push({
      note: note.trim(),
      createdAt: new Date(),
      createdBy: req.user?._id || null
    });

    await deal.save();
    res.json({ success: true, deal });
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Update follow-up date
router.put('/followup-date/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpDate } = req.body;

    const deal = await ScrapedDeal.findByIdAndUpdate(
      id,
      { $set: { followUpDate: followUpDate ? new Date(followUpDate) : null } },
      { new: true }
    );

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    res.json({ success: true, deal });
  } catch (error) {
    console.error('Error updating follow-up date:', error);
    res.status(500).json({ error: 'Failed to update follow-up date' });
  }
});

// Get pipeline stats (counts for each stage)
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [emailSent, followUp, dealStatus] = await Promise.all([
      ScrapedDeal.countDocuments({ dealStage: 'email_sent' }),
      ScrapedDeal.countDocuments({ dealStage: 'follow_up' }),
      ScrapedDeal.countDocuments({ dealStage: 'deal_status' })
    ]);

    // Get deal status breakdown
    const statusBreakdown = await ScrapedDeal.aggregate([
      { $match: { dealStage: 'deal_status' } },
      { $group: { _id: '$dealStatus', count: { $sum: 1 } } }
    ]);

    res.json({
      emailSent,
      followUp,
      dealStatus,
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item._id || 'pending'] = item.count;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Error fetching pipeline stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
