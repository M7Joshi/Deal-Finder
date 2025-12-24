import mongoose from 'mongoose';

async function checkRecentAMV() {
  await mongoose.connect('mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority');
  const db = mongoose.connection.db;

  // Get deals with AMV sorted by most recent update
  const recentAMV = await db.collection('scrapeddeals')
    .find({ amv: { $exists: true, $ne: null } })
    .sort({ updatedAt: -1 })
    .limit(10)
    .toArray();

  console.log('=== MOST RECENT DEALS WITH AMV ===');
  for (const d of recentAMV) {
    const updatedAt = d.updatedAt ? new Date(d.updatedAt).toISOString() : 'no date';
    console.log(`- ${d.fullAddress?.substring(0, 45)} | AMV: $${d.amv} | ${updatedAt}`);
  }

  // Check deals needing AMV by state
  const byState = await db.collection('scrapeddeals').aggregate([
    { $match: { $or: [{ amv: null }, { amv: { $exists: false } }] } },
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  console.log('\n=== DEALS NEEDING AMV BY STATE ===');
  for (const s of byState) {
    console.log(`- ${s._id || 'unknown'}: ${s.count}`);
  }

  process.exit(0);
}

checkRecentAMV().catch(console.error);
