import mongoose from 'mongoose';

const scraperProgressSchema = new mongoose.Schema({
  // Which scraper this is for (e.g., 'redfin', 'privy')
  scraper: { type: String, required: true, unique: true },

  // Current state being scraped (e.g., 'Alabama', 'Texas')
  currentState: { type: String, default: null },

  // Last completed state
  lastState: { type: String, default: null },

  // Current city index within the state (0-based)
  currentCityIndex: { type: Number, default: -1 },

  // Current state index (0-based)
  currentStateIndex: { type: Number, default: 0 },

  // Set of processed city URLs (to skip duplicates) / completed states for Privy
  processedCities: { type: [String], default: [] },

  // Total addresses scraped in current session
  totalScraped: { type: Number, default: 0 },

  // Cycle count (how many full cycles through all states)
  cycleCount: { type: Number, default: 0 },

  // Filter cycle index (0=privy, 1=privy-Tear, 2=privy-flip)
  filterCycleIndex: { type: Number, default: 0 },

  // Completed states for the current filter cycle
  completedStates: { type: [String], default: [] },

  // Last update timestamp
  updatedAt: { type: Date, default: Date.now },

  // When the current cycle started
  cycleStartedAt: { type: Date, default: Date.now },
});

// Index for quick lookup
scraperProgressSchema.index({ scraper: 1 });

const ScraperProgress = mongoose.model('ScraperProgress', scraperProgressSchema);
export default ScraperProgress;
