import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';

async function checkDB() {
  await mongoose.connect(dbURI);
  console.log('Connected to MongoDB');

  // Get all collections
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('\nCollections:', collections.map(c => c.name).join(', '));

  // Check each collection
  for (const col of ['scrapeddeals', 'rawproperties', 'properties', 'deals']) {
    const coll = mongoose.connection.db.collection(col);
    const count = await coll.countDocuments();
    console.log(`\n=== ${col} (${count} docs) ===`);

    if (count > 0) {
      const recent = await coll.find().sort({ createdAt: -1 }).limit(5).toArray();
      recent.forEach((d, i) => {
        console.log(i+1 + '.', d.address || d.streetAddress || 'NO ADDR', '|', d.status || 'no-status', '|', d.source || 'no-source');
      });

      // Check for malformed addresses in this collection
      const malformed = await coll.find({
        $or: [
          { address: { $regex: 'DAY|AGO|ABOUT|bedrooms', $options: 'i' } },
          { streetAddress: { $regex: 'DAY|AGO|ABOUT|bedrooms', $options: 'i' } }
        ]
      }).limit(5).toArray();
      if (malformed.length > 0) {
        console.log('  ⚠️ Malformed addresses found:', malformed.length);
        malformed.forEach((d, i) => {
          console.log('    ', d.address || d.streetAddress);
        });
      }
    }
  }

  await mongoose.disconnect();
}

checkDB().catch(e => console.error(e.message));
