import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  console.log('\n=== SCRAPER MONITOR ===\n');

  // Check recent entries with timestamps
  const recent = await db.collection('rawproperties').find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .project({ address: 1, city: 1, state: 1, createdAt: 1 })
    .toArray();

  console.log('Recent 10 addresses:');
  recent.forEach(r => {
    const time = r.createdAt ? new Date(r.createdAt).toLocaleString() : 'no timestamp';
    const addr = (r.address || '').substring(0, 45);
    console.log(`  [${time}] ${addr} | ${r.city || '?'}, ${r.state || '?'}`);
  });

  // Count by createdAt today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = await db.collection('rawproperties').countDocuments({
    createdAt: { $gte: today }
  });
  console.log(`\nAddresses scraped today: ${todayCount}`);

  // Total counts
  const rawTotal = await db.collection('rawproperties').countDocuments();
  const propTotal = await db.collection('properties').countDocuments();
  const dealTotal = await db.collection('scrapeddeals').countDocuments();

  console.log(`\nTotals: rawproperties=${rawTotal}, properties=${propTotal}, scrapeddeals=${dealTotal}`);

  // Check for issues
  console.log('\n--- Potential Issues ---');

  // Empty state count
  const emptyState = await db.collection('rawproperties').countDocuments({
    $or: [{ state: '' }, { state: null }, { state: { $exists: false } }]
  });
  console.log(`Addresses with empty state: ${emptyState}`);

  // Check for concatenated garbage
  const garbagePatterns = await db.collection('rawproperties').countDocuments({
    address: { $regex: 'sq ft|HRS AGO|ABOUT|WALKTHROUGH', $options: 'i' }
  });
  console.log(`Addresses with garbage patterns: ${garbagePatterns}`);

  // Check AL addresses specifically
  const alByCity = await db.collection('rawproperties').aggregate([
    { $match: { city: { $regex: 'Mobile|Hoover|Birmingham|Huntsville|Decatur|Auburn', $options: 'i' } } },
    { $group: { _id: { city: '$city', state: '$state' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log('\nAL cities breakdown:', JSON.stringify(alByCity, null, 2));

  await mongoose.disconnect();
}

main().catch(console.error);
