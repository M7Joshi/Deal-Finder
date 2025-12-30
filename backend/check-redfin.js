import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkRedfinProgress() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Check scraper progress
  const progress = await db.collection('scraperprogresses').findOne({ scraper: 'redfin' });

  console.log('=== REDFIN SCRAPER PROGRESS ===');
  if (progress) {
    console.log('Current state:', progress.currentState || 'None');
    console.log('State index:', progress.currentStateIndex || 0);
    console.log('Processed cities:', progress.processedCities ? progress.processedCities.length : 0);
    console.log('Total scraped:', progress.totalScraped || 0);
    console.log('Last updated:', progress.updatedAt);
    console.log('Cycle started:', progress.cycleStartedAt);
  } else {
    console.log('No Redfin progress found - scraper may not have run yet');
  }

  // Check recent Redfin addresses
  const recentRedfin = await db.collection('scrapeddeals')
    .find({ source: 'redfin' })
    .sort({ scrapedAt: -1 })
    .limit(5)
    .toArray();

  console.log('');
  console.log('=== 5 MOST RECENT REDFIN ADDRESSES ===');
  if (recentRedfin.length > 0) {
    recentRedfin.forEach(function(d) {
      console.log('  ' + (d.fullAddress || '').substring(0, 50) + '...');
      console.log('    Scraped: ' + d.scrapedAt + ', Price: $' + (d.listingPrice || 0));
    });
  } else {
    console.log('No Redfin addresses found');
  }

  // Check by time ranges
  const now = new Date();
  const oneHourAgo = new Date(now - 60*60*1000);
  const oneDayAgo = new Date(now - 24*60*60*1000);

  const redfinLastHour = await db.collection('scrapeddeals').countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: oneHourAgo }
  });

  const redfinLastDay = await db.collection('scrapeddeals').countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: oneDayAgo }
  });

  console.log('');
  console.log('=== REDFIN ACTIVITY ===');
  console.log('Last hour:', redfinLastHour);
  console.log('Last 24 hours:', redfinLastDay);

  // Check total Redfin vs Privy
  const totalRedfin = await db.collection('scrapeddeals').countDocuments({ source: 'redfin' });
  const totalPrivy = await db.collection('scrapeddeals').countDocuments({ source: 'privy' });

  console.log('');
  console.log('=== TOTALS ===');
  console.log('Redfin total:', totalRedfin);
  console.log('Privy total:', totalPrivy);

  await mongoose.disconnect();
}

checkRedfinProgress().catch(function(e) { console.error(e.message); process.exit(1); });
