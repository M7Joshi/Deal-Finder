const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const scrapedDeals = db.collection('scrapeddeals');

  console.log('=== Last 10 Redfin Entries ===');
  const redfin = await scrapedDeals.find({ source: 'redfin' })
    .sort({ scrapedAt: -1 })
    .limit(10)
    .toArray();

  redfin.forEach((d, i) => {
    const addr = d.fullAddress ? d.fullAddress.substring(0, 40) : 'No address';
    const time = d.scrapedAt ? new Date(d.scrapedAt).toLocaleTimeString() : 'no time';
    console.log((i+1) + '. ' + time + ' | ' + addr + '...');
  });

  const now = new Date();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);
  const oneMinAgo = new Date(now - 1 * 60 * 1000);

  const last5min = await scrapedDeals.countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: fiveMinAgo }
  });
  const last1min = await scrapedDeals.countDocuments({
    source: 'redfin',
    scrapedAt: { $gte: oneMinAgo }
  });

  console.log('');
  console.log('Redfin in last 5 min:', last5min);
  console.log('Redfin in last 1 min:', last1min);
  console.log('Current time:', now.toLocaleTimeString());

  // Check total and pending
  const total = await scrapedDeals.countDocuments({ source: 'redfin' });
  const pending = await scrapedDeals.countDocuments({
    source: 'redfin',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });

  console.log('');
  console.log('Redfin Total:', total);
  console.log('Redfin Pending AMV:', pending);

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
