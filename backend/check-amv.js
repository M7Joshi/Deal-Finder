import mongoose from 'mongoose';

async function checkAMV() {
  await mongoose.connect('mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority');

  const db = mongoose.connection.db;

  const totalDeals = await db.collection('scrapeddeals').countDocuments();
  const withAMV = await db.collection('scrapeddeals').countDocuments({ amv: { $exists: true, $ne: null } });
  const withoutAMV = totalDeals - withAMV;

  console.log('=== SCRAPED DEALS AMV STATUS ===');
  console.log('Total deals: ' + totalDeals);
  console.log('With AMV: ' + withAMV);
  console.log('Without AMV (need BofA): ' + withoutAMV);

  // Sample without AMV
  const needingAMV = await db.collection('scrapeddeals').find({
    $or: [{ amv: null }, { amv: { $exists: false } }]
  }).limit(5).toArray();

  console.log('\nSample deals needing AMV:');
  needingAMV.forEach(d => {
    console.log('- ' + (d.fullAddress || 'N/A').substring(0, 50) + ' | source: ' + (d.source || 'unknown'));
  });

  await mongoose.disconnect();
}

checkAMV().catch(console.error);
