const mongoose = require('mongoose');
require('dotenv').config();

// Filter cycle to switch to (passed as argument)
// 0 = privy (buy_hold + umv)
// 1 = privy-flip (flip + arv)
// 2 = privy-Tear (scrape + arv)
const targetIndex = parseInt(process.argv[2], 10);

const FILTER_NAMES = {
  0: 'privy (buy_hold + umv)',
  1: 'privy-flip (flip + arv)',
  2: 'privy-Tear (scrape + arv)'
};

if (isNaN(targetIndex) || targetIndex < 0 || targetIndex > 2) {
  console.log('Usage: node switch-privy-filter.cjs <index>');
  console.log('  0 = privy (buy_hold + umv)');
  console.log('  1 = privy-flip (flip + arv)');
  console.log('  2 = privy-Tear (scrape + arv)');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const ScraperProgress = mongoose.model('ScraperProgress', new mongoose.Schema({}, { strict: false }), 'scraperprogresses');

  // Get current progress
  const current = await ScraperProgress.findOne({ scraper: 'privy' }).lean();

  if (current) {
    console.log('=== CURRENT STATE ===');
    console.log('Filter:', FILTER_NAMES[current.filterCycleIndex || 0]);
    console.log('Current state:', current.currentState || 'none');
    console.log('City index:', current.currentCityIndex || 0);
  }

  // Update to target filter
  await ScraperProgress.findOneAndUpdate(
    { scraper: 'privy' },
    {
      $set: {
        filterCycleIndex: targetIndex,
        // Reset state progress for fresh start with new filter
        completedStates: [],
        currentState: null,
        currentCityIndex: -1,
        lastState: null,
        processedCities: [],
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  console.log('\n=== SWITCHED TO ===');
  console.log('Filter:', FILTER_NAMES[targetIndex]);
  console.log('\nProgress reset - will start from first state (AL)');
  console.log('Restart server for changes to take effect.');

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
