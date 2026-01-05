const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const ScrapedDeal = mongoose.model('ScrapedDeal', new mongoose.Schema({}, { strict: false }), 'scrapeddeals');

  // Get privy-flip counts by state
  const byState = await ScrapedDeal.aggregate([
    { $match: { source: 'privy-flip' } },
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log('=== PRIVY-FLIP ADDRESSES BY STATE ===\n');
  let total = 0;
  byState.forEach(s => {
    console.log(`${(s._id || 'N/A').padEnd(5)}: ${s.count}`);
    total += s.count;
  });
  console.log(`\nTOTAL: ${total} addresses from ${byState.length} states`);

  // Get pending vs done
  const pending = await ScrapedDeal.countDocuments({
    source: 'privy-flip',
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  const done = await ScrapedDeal.countDocuments({
    source: 'privy-flip',
    amv: { $gt: 0 }
  });

  console.log('\n=== AMV STATUS ===');
  console.log(`Pending AMV: ${pending}`);
  console.log(`With AMV: ${done}`);

  // Get deals found
  const deals = await ScrapedDeal.countDocuments({
    source: 'privy-flip',
    isDeal: true
  });
  console.log(`Deals found: ${deals}`);

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
