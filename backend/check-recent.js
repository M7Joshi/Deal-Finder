import mongoose from 'mongoose';

async function checkRecent() {
  await mongoose.connect('mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority');
  const db = mongoose.connection.db;

  // Get most recently scraped
  const recent = await db.collection('scrapeddeals')
    .find({})
    .sort({ scrapedAt: -1 })
    .limit(10)
    .toArray();

  console.log('=== MOST RECENT DEALS ===');
  for (const d of recent) {
    const scrapedAt = d.scrapedAt ? new Date(d.scrapedAt).toISOString() : 'no date';
    console.log(`- ${d.fullAddress} | ${d.source || 'unknown'} | ${scrapedAt}`);
  }

  // Count by source
  const sources = await db.collection('scrapeddeals').aggregate([
    { $group: { _id: '$source', count: { $sum: 1 } } }
  ]).toArray();
  console.log('\n=== DEALS BY SOURCE ===');
  for (const s of sources) {
    console.log(`- ${s._id}: ${s.count}`);
  }

  // Count deals added in last hour
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await db.collection('scrapeddeals').countDocuments({
    scrapedAt: { $gte: hourAgo }
  });
  console.log(`\n=== DEALS ADDED IN LAST HOUR: ${recentCount} ===`);

  process.exit(0);
}

checkRecent();
