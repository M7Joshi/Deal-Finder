const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const scrapedDeals = db.collection('scrapeddeals');

  const total = await scrapedDeals.countDocuments();
  const pendingAMV = await scrapedDeals.countDocuments({
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  const withAMV = await scrapedDeals.countDocuments({ amv: { $gt: 0 } });

  const pendingPrivy = await scrapedDeals.countDocuments({
    source: 'privy',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  const pendingRedfin = await scrapedDeals.countDocuments({
    source: 'redfin',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  const donePrivy = await scrapedDeals.countDocuments({ source: 'privy', amv: { $gt: 0 } });
  const doneRedfin = await scrapedDeals.countDocuments({ source: 'redfin', amv: { $gt: 0 } });

  console.log('=== ScrapedDeals Collection ===');
  console.log('Total:', total);
  console.log('Pending AMV:', pendingAMV);
  console.log('With AMV:', withAMV);
  console.log('');
  console.log('--- By Source ---');
  console.log('Privy Pending:', pendingPrivy);
  console.log('Privy Done:', donePrivy);
  console.log('Redfin Pending:', pendingRedfin);
  console.log('Redfin Done:', doneRedfin);

  console.log('');
  console.log('=== Recent 5 Entries ===');
  const recent = await scrapedDeals.find().sort({ scrapedAt: -1 }).limit(5).toArray();
  recent.forEach((d, i) => {
    const addr = d.fullAddress ? d.fullAddress.substring(0, 50) : 'No address';
    console.log((i+1) + '. [' + d.source + '] ' + addr + '... | AMV: ' + (d.amv || 'null') + ' | Price: ' + d.listingPrice);
  });

  console.log('');
  console.log('=== Source Breakdown ===');
  const sources = await scrapedDeals.aggregate([
    { $group: { _id: '$source', count: { $sum: 1 } } }
  ]).toArray();
  sources.forEach(s => console.log((s._id || 'unknown') + ': ' + s.count));

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
