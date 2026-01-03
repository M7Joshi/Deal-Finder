const mongoose = require('mongoose');
require('dotenv').config();

async function resetAll() {
  await mongoose.connect(process.env.MONGO_URI);

  // 1. Clear ScrapedDeals (all addresses from Privy + Redfin)
  const ScrapedDeal = mongoose.model('ScrapedDeal', new mongoose.Schema({}, { strict: false }), 'scrapeddeals');
  const deletedDeals = await ScrapedDeal.deleteMany({});
  console.log('ScrapedDeals deleted:', deletedDeals.deletedCount);

  // 2. Reset Privy progress to start from beginning
  const ScraperProgress = mongoose.model('ScraperProgress', new mongoose.Schema({}, { strict: false }));
  await ScraperProgress.updateOne(
    { scraper: 'privy' },
    {
      $set: {
        currentState: null,
        currentCityIndex: 0,
        currentStateIndex: 0,
        processedCities: [],
        totalScraped: 0,
        cycleCount: 0,
        lastState: null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log('Privy progress reset to beginning');

  // 3. Reset Redfin progress to start from beginning
  await ScraperProgress.updateOne(
    { scraper: 'redfin' },
    {
      $set: {
        currentState: null,
        currentCityIndex: 0,
        currentStateIndex: 0,
        processedCities: [],
        totalScraped: 0,
        cycleCount: 0,
        lastState: null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log('Redfin progress reset to beginning');

  // 4. Verify
  const remaining = await ScrapedDeal.countDocuments({});
  const privyProgress = await ScraperProgress.findOne({ scraper: 'privy' }).lean();
  const redfinProgress = await ScraperProgress.findOne({ scraper: 'redfin' }).lean();

  console.log('\n=== RESET COMPLETE ===');
  console.log('Addresses remaining:', remaining);
  console.log('Privy state:', privyProgress?.currentState || 'null (starting fresh)');
  console.log('Redfin state:', redfinProgress?.currentState || 'null (starting fresh)');

  await mongoose.disconnect();
}

resetAll().catch(e => console.error('Error:', e.message));
