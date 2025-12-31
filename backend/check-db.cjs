const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const scrapedDeals = db.collection('scrapeddeals');

  console.log('=== Monitoring Privy Activity ===');
  console.log('Time:', new Date().toLocaleString());
  console.log('');

  // Get Privy stats
  const privyTotal = await scrapedDeals.countDocuments({ source: 'privy' });
  const privyPending = await scrapedDeals.countDocuments({
    source: 'privy',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  const privyDone = await scrapedDeals.countDocuments({ source: 'privy', amv: { $gt: 0 } });

  console.log('--- Privy Stats ---');
  console.log('Total Privy addresses:', privyTotal);
  console.log('Pending AMV:', privyPending);
  console.log('Done (with AMV):', privyDone);

  // Get last 10 Privy entries to see recent activity
  console.log('');
  console.log('--- Last 10 Privy Entries (by scrapedAt) ---');
  const recentPrivy = await scrapedDeals.find({ source: 'privy' })
    .sort({ scrapedAt: -1 })
    .limit(10)
    .toArray();

  recentPrivy.forEach((d, i) => {
    const addr = d.fullAddress ? d.fullAddress.substring(0, 40) : 'No address';
    const time = d.scrapedAt ? new Date(d.scrapedAt).toLocaleString() : 'unknown';
    console.log((i+1) + '. ' + addr + '... | ' + time);
  });

  // Check if there are any Privy entries in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await scrapedDeals.countDocuments({
    source: 'privy',
    scrapedAt: { $gte: oneHourAgo }
  });
  console.log('');
  console.log('Privy entries in last 1 hour:', recentCount);

  // Check last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const veryRecentCount = await scrapedDeals.countDocuments({
    source: 'privy',
    scrapedAt: { $gte: fiveMinAgo }
  });
  console.log('Privy entries in last 5 minutes:', veryRecentCount);

  // Compare with Redfin
  console.log('');
  console.log('--- Comparison with Redfin ---');
  const redfinTotal = await scrapedDeals.countDocuments({ source: 'redfin' });
  const redfinRecent = await scrapedDeals.countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: oneHourAgo }
  });
  console.log('Redfin total:', redfinTotal);
  console.log('Redfin entries in last 1 hour:', redfinRecent);

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
