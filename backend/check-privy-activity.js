import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkPrivyActivity() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const now = new Date();
  const oneHourAgo = new Date(now - 60*60*1000);
  const twoHoursAgo = new Date(now - 2*60*60*1000);
  const sixHoursAgo = new Date(now - 6*60*60*1000);

  // Recent Privy activity
  const privyLastHour = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    scrapedAt: { $gte: oneHourAgo }
  });

  const privyLast2Hours = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    scrapedAt: { $gte: twoHoursAgo }
  });

  const privyLast6Hours = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    scrapedAt: { $gte: sixHoursAgo }
  });

  console.log('=== PRIVY ACTIVITY ===');
  console.log('Last 1 hour:', privyLastHour);
  console.log('Last 2 hours:', privyLast2Hours);
  console.log('Last 6 hours:', privyLast6Hours);

  // Get 10 most recent Privy addresses
  const recentPrivy = await db.collection('scrapeddeals')
    .find({ source: 'privy' })
    .sort({ scrapedAt: -1 })
    .limit(10)
    .toArray();

  console.log('');
  console.log('=== 10 MOST RECENT PRIVY ADDRESSES ===');
  if (recentPrivy.length > 0) {
    recentPrivy.forEach(function(d, i) {
      const addr = (d.fullAddress || '').substring(0, 45);
      const time = d.scrapedAt ? new Date(d.scrapedAt).toLocaleString() : 'N/A';
      console.log((i+1) + '. ' + addr + '...');
      console.log('   Scraped: ' + time + ' | Price: $' + (d.listingPrice || 0));
    });
  } else {
    console.log('No Privy addresses found');
  }

  // Check Privy scraper progress
  const privyProgress = await db.collection('scraperprogresses').findOne({ scraper: 'privy' });
  console.log('');
  console.log('=== PRIVY SCRAPER PROGRESS ===');
  if (privyProgress) {
    console.log('Current state:', privyProgress.currentState || 'None');
    console.log('State index:', privyProgress.currentStateIndex || 0);
    console.log('City index:', privyProgress.currentCityIndex || 0);
    console.log('Last updated:', privyProgress.updatedAt);

    // Calculate how long ago
    if (privyProgress.updatedAt) {
      const lastUpdate = new Date(privyProgress.updatedAt);
      const minsAgo = Math.round((Date.now() - lastUpdate.getTime()) / (1000 * 60));
      console.log('Minutes since last update:', minsAgo);
    }
  } else {
    console.log('No Privy progress found');
  }

  // Check if there are addresses from today vs yesterday
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const privyToday = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    scrapedAt: { $gte: today }
  });

  const privyYesterday = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    scrapedAt: { $gte: yesterday, $lt: today }
  });

  console.log('');
  console.log('=== PRIVY BY DAY ===');
  console.log('Today:', privyToday);
  console.log('Yesterday:', privyYesterday);

  await mongoose.disconnect();
}

checkPrivyActivity().catch(function(e) { console.error(e.message); process.exit(1); });
