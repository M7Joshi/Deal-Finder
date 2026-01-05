require('dotenv').config();
const mongoose = require('mongoose');

async function setup() {
  await mongoose.connect(process.env.MONGO_URI);

  const ScrapedDeal = mongoose.model('ScrapedDeal', new mongoose.Schema({}, { strict: false }));
  const ScraperProgress = mongoose.model('ScraperProgress', new mongoose.Schema({}, { strict: false }));

  // 1. Clear all pending Privy AMV (set amv to -1 so they're skipped)
  const pendingCount = await ScrapedDeal.countDocuments({
    source: { $regex: /^privy/ },
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  console.log('Pending Privy AMV to clear:', pendingCount);

  const clearResult = await ScrapedDeal.updateMany(
    {
      source: { $regex: /^privy/ },
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    },
    { $set: { amv: -1, skippedForTest: true } }
  );
  console.log('Cleared pending AMV:', clearResult.modifiedCount);

  // 2. Set Privy to start with privy-flip (filterCycleIndex = 2)
  const privyUpdate = await ScraperProgress.updateOne(
    { scraper: 'privy' },
    {
      $set: {
        filterCycleIndex: 2,  // 0=privy, 1=privy-Tear, 2=privy-flip
        completedStates: [],  // Reset state progress for fresh test
        processedCities: [],  // Also reset MongoDB field name
        currentState: null,   // Reset current state
        updatedAt: new Date()
      }
    }
  );
  console.log('Set Privy to privy-flip (filterCycleIndex=2), reset states to start from AL');

  // 3. Mark Redfin as complete so it stops
  const redfinUpdate = await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    { $set: { cycleComplete: true, stoppedForPrivyTest: true, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log('Marked Redfin as complete (stopped)');

  // Verify
  const privyProgress = await ScraperProgress.findOne({ scraper: 'privy' });
  console.log('\nPrivy progress now:', {
    filterCycleIndex: privyProgress?.filterCycleIndex,
    completedStates: privyProgress?.completedStates?.length || 0
  });

  const newPending = await ScrapedDeal.countDocuments({
    source: { $regex: /^privy/ },
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  console.log('New pending Privy AMV:', newPending);

  await mongoose.disconnect();
  console.log('\nDone! Privy will now start with privy-flip filter.');
}
setup();
