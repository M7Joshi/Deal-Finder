import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkStatus() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Check deals (isDeal = true)
  const deals = await db.collection('scrapeddeals').countDocuments({ isDeal: true });
  const notDeals = await db.collection('scrapeddeals').countDocuments({ isDeal: false });

  // Check sources
  const privyCount = await db.collection('scrapeddeals').countDocuments({ source: 'privy' });
  const redfinCount = await db.collection('scrapeddeals').countDocuments({ source: 'redfin' });

  // Active scrapers check
  const scraperProgress = await db.collection('scraperprogresses').find({}).toArray();

  // Recent activity by hour
  const oneHourAgo = new Date(Date.now() - 60*60*1000);
  const lastHour = await db.collection('scrapeddeals').countDocuments({
    scrapedAt: { $gte: oneHourAgo }
  });

  // Pending AMV breakdown
  const pendingPrivy = await db.collection('scrapeddeals').countDocuments({
    amv: null, source: 'privy'
  });
  const pendingRedfin = await db.collection('scrapeddeals').countDocuments({
    amv: null, source: 'redfin'
  });

  // Price stats
  const priceStats = await db.collection('scrapeddeals').aggregate([
    { $match: { listingPrice: { $gt: 0 } } },
    { $group: {
      _id: null,
      avgPrice: { $avg: '$listingPrice' },
      minPrice: { $min: '$listingPrice' },
      maxPrice: { $max: '$listingPrice' }
    }}
  ]).toArray();

  // Recent 5 deals
  const recentDeals = await db.collection('scrapeddeals')
    .find({ isDeal: true })
    .sort({ scrapedAt: -1 })
    .limit(5)
    .toArray();

  console.log('=== DEAL STATUS ===');
  console.log('Deals (isDeal=true):', deals);
  console.log('Not Deals (isDeal=false):', notDeals);

  console.log('\n=== SOURCE BREAKDOWN ===');
  console.log('Privy:', privyCount);
  console.log('Redfin:', redfinCount);

  console.log('\n=== PENDING AMV ===');
  console.log('Privy pending:', pendingPrivy);
  console.log('Redfin pending:', pendingRedfin);

  console.log('\n=== ACTIVITY ===');
  console.log('New in last hour:', lastHour);

  if (priceStats.length > 0) {
    console.log('\n=== PRICE STATS ===');
    console.log('Avg Price: $' + Math.round(priceStats[0].avgPrice).toLocaleString());
    console.log('Min Price: $' + priceStats[0].minPrice?.toLocaleString());
    console.log('Max Price: $' + priceStats[0].maxPrice?.toLocaleString());
  }

  console.log('\n=== SCRAPER PROGRESS ===');
  scraperProgress.forEach(s => {
    console.log('Scraper:', s.scraperName || s.scraper_name || 'unknown');
    console.log('  State:', s.currentState || s.state || '-');
    console.log('  Cities done:', s.citiesProcessed || s.cities_processed || 0);
    console.log('  Last update:', s.lastUpdated || s.updatedAt || '-');
  });

  if (recentDeals.length > 0) {
    console.log('\n=== 5 MOST RECENT DEALS ===');
    recentDeals.forEach(d => {
      const discount = d.amv && d.listingPrice ? Math.round((1 - d.listingPrice/d.amv) * 100) : 0;
      console.log(`  ${d.fullAddress}`);
      console.log(`    Price: $${d.listingPrice?.toLocaleString()} | AMV: $${d.amv?.toLocaleString()} | Discount: ${discount}%`);
    });
  }

  await mongoose.disconnect();
}

checkStatus().catch(e => { console.error(e.message); process.exit(1); });
