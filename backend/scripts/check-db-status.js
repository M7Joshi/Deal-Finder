import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';
  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  console.log('\n=== DATABASE STATUS ===\n');

  // List collections
  const collections = await db.listCollections().toArray();
  console.log('Collections:');
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`  - ${col.name}: ${count}`);
  }

  // Check rawproperties by state
  console.log('\n--- rawproperties by state ---');
  const byState = await db.collection('rawproperties').aggregate([
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log(JSON.stringify(byState, null, 2));

  // Check for malformed addresses
  console.log('\n--- Checking for malformed addresses ---');
  const malformed = await db.collection('rawproperties').find({
    address: { $regex: 'HRS AGO|ABOUT THIS HOME', $options: 'i' }
  }).toArray();
  console.log(`Malformed count: ${malformed.length}`);
  if (malformed.length > 0) {
    console.log('Samples:');
    malformed.slice(0, 3).forEach(m => console.log(`  - ${m.address}`));
  }

  // Most recent 5
  console.log('\n--- Most recent 5 addresses ---');
  const recent = await db.collection('rawproperties').find({}).sort({ createdAt: -1 }).limit(5).toArray();
  recent.forEach(r => {
    console.log(`  - ${r.address} | ${r.city}, ${r.state}`);
  });

  // ScrapedDeals count
  console.log('\n--- ScrapedDeals ---');
  const sdCount = await db.collection('scrapeddeals').countDocuments();
  console.log(`Total: ${sdCount}`);

  if (sdCount > 0) {
    const sdByState = await db.collection('scrapeddeals').aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    console.log('By state:', JSON.stringify(sdByState));
  }

  await mongoose.disconnect();
  console.log('\n=== DONE ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
