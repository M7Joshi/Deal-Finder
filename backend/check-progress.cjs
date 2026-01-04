const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const ScrapedDeal = mongoose.model('ScrapedDeal', new mongoose.Schema({}, { strict: false }), 'scrapeddeals');
  const ScraperProgress = mongoose.model('ScraperProgress', new mongoose.Schema({}, { strict: false }), 'scraperprogresses');

  // Check Privy filter cycle progress
  console.log('=== PRIVY FILTER CYCLE ===');
  const privyProgress = await ScraperProgress.findOne({ scraper: 'privy' }).lean();
  if (privyProgress) {
    const filterCycles = ['privy', 'privy-Tear', 'privy-flip'];
    const currentFilter = filterCycles[privyProgress.filterCycleIndex || 0] || 'privy';
    console.log('Current filter:', currentFilter);
    console.log('Current state:', privyProgress.currentState || 'none');
    console.log('States completed:', (privyProgress.processedCities || []).length, '/ 41');
    console.log('Full cycles completed:', privyProgress.cycleCount || 0);
  } else {
    console.log('No progress data found');
  }

  // Check most recent scrapes
  console.log('\n=== MOST RECENT SCRAPES (last 5 mins) ===');
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Check all privy sources
  const privySources = ['privy', 'privy-Tear', 'privy-flip'];
  for (const src of privySources) {
    const recent = await ScrapedDeal.countDocuments({
      source: src,
      scrapedAt: { $gte: fiveMinAgo }
    });
    if (recent > 0) {
      console.log(`${src} (last 5 min):`, recent);
    }
  }
  const recentRedfin = await ScrapedDeal.countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: fiveMinAgo }
  });
  console.log('Redfin (last 5 min):', recentRedfin);

  // Check pending AMV
  console.log('\n=== PENDING AMV ===');
  let totalPrivyPending = 0;
  for (const src of privySources) {
    const pending = await ScrapedDeal.countDocuments({
      source: src,
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    });
    if (pending > 0) {
      console.log(`${src} pending:`, pending);
      totalPrivyPending += pending;
    }
  }
  if (totalPrivyPending > 0) {
    console.log('Total Privy pending:', totalPrivyPending);
  }
  const redfinPending = await ScrapedDeal.countDocuments({
    source: 'redfin',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  console.log('Redfin pending:', redfinPending);

  // Check totals
  console.log('\n=== TOTALS ===');
  let totalAllPrivy = 0;
  for (const src of privySources) {
    const total = await ScrapedDeal.countDocuments({ source: src });
    if (total > 0) {
      console.log(`${src}:`, total);
      totalAllPrivy += total;
    }
  }
  if (totalAllPrivy > 0) {
    console.log('Total all Privy:', totalAllPrivy);
  }
  const totalRedfin = await ScrapedDeal.countDocuments({ source: 'redfin' });
  console.log('Redfin:', totalRedfin);

  // Last scrape times
  console.log('\n=== LAST ACTIVITY ===');
  const lastPrivy = await ScrapedDeal.findOne({ source: { $regex: /^privy/ } }).sort({ scrapedAt: -1 }).lean();
  const lastRedfin = await ScrapedDeal.findOne({ source: 'redfin' }).sort({ scrapedAt: -1 }).lean();

  if (lastPrivy) {
    const ago = Math.round((Date.now() - new Date(lastPrivy.scrapedAt).getTime()) / 60000);
    console.log(`${lastPrivy.source} last:`, ago, 'mins ago -', lastPrivy.state, '-', lastPrivy.fullAddress?.slice(0, 40));
  }
  if (lastRedfin) {
    const ago = Math.round((Date.now() - new Date(lastRedfin.scrapedAt).getTime()) / 60000);
    console.log('Redfin last:', ago, 'mins ago -', lastRedfin.state, '-', lastRedfin.fullAddress?.slice(0, 40));
  }

  // Check recently valued addresses (BofA working?)
  console.log('\n=== RECENT AMV UPDATES (last 30 mins) ===');
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const recentlyValued = await ScrapedDeal.find({
    amv: { $gt: 0 },
    updatedAt: { $gte: thirtyMinAgo }
  }).sort({ updatedAt: -1 }).limit(5).lean();

  console.log('Recently valued:', recentlyValued.length);
  recentlyValued.forEach(r => {
    const ago = Math.round((Date.now() - new Date(r.updatedAt).getTime()) / 60000);
    console.log(' -', ago, 'mins ago:', r.fullAddress?.slice(0, 35), '| AMV:', r.amv, '| Source:', r.source);
  });

  // Check if any addresses were marked as deals recently
  console.log('\n=== DEALS STATUS ===');
  const totalDeals = await ScrapedDeal.countDocuments({ isDeal: true });
  console.log('Total deals found:', totalDeals);

  // Check agent data stats
  console.log('\n=== AGENT DATA STATS ===');
  const privyWithAgent = await ScrapedDeal.countDocuments({
    source: { $regex: /^privy/ },
    agentName: { $ne: null, $exists: true }
  });
  const redfinWithAgent = await ScrapedDeal.countDocuments({
    source: 'redfin',
    agentName: { $ne: null, $exists: true }
  });
  console.log('Privy with agent:', privyWithAgent, '/', totalAllPrivy, totalAllPrivy > 0 ? `(${Math.round(privyWithAgent/totalAllPrivy*100)}%)` : '');
  console.log('Redfin with agent:', redfinWithAgent, '/', totalRedfin, totalRedfin > 0 ? `(${Math.round(redfinWithAgent/totalRedfin*100)}%)` : '');

  await mongoose.disconnect();
}

check().catch(e => console.error('Error:', e.message));
