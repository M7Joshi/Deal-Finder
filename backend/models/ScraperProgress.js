import mongoose from 'mongoose';

const scraperProgressSchema = new mongoose.Schema({
  // Which scraper this is for (e.g., 'redfin', 'privy')
  scraper: { type: String, required: true, unique: true },

  // Current state being scraped (e.g., 'Alabama', 'Texas')
  currentState: { type: String, default: null },

  // Current city index within the state (0-based)
  currentCityIndex: { type: Number, default: 0 },

  // Current state index (0-based)
  currentStateIndex: { type: Number, default: 0 },

  // Set of processed city URLs (to skip duplicates)
  processedCities: { type: [String], default: [] },

  // Total addresses scraped in current session
  totalScraped: { type: Number, default: 0 },

  // Last update timestamp
  updatedAt: { type: Date, default: Date.now },

  // When the current cycle started
  cycleStartedAt: { type: Date, default: Date.now },
});

// Index for quick lookup
scraperProgressSchema.index({ scraper: 1 });

const ScraperProgress = mongoose.model('ScraperProgress', scraperProgressSchema);
export default ScraperProgress;
