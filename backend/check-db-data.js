// Check what data exists in the local database
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';

async function checkData() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    console.log('📊 DATABASE CONTENTS SUMMARY\n');
    console.log('='.repeat(60));

    const collections = await db.listCollections().toArray();

    for (const collInfo of collections) {
      const collName = collInfo.name;
      const collection = db.collection(collName);
      const count = await collection.countDocuments();

      console.log(`\n📁 ${collName}`);
      console.log(`   Total documents: ${count}`);

      if (count > 0) {
        // Show sample document structure
        const sample = await collection.findOne();
        const fields = Object.keys(sample);
        console.log(`   Fields: ${fields.slice(0, 10).join(', ')}${fields.length > 10 ? '...' : ''}`);

        // Show specific stats for important collections
        if (collName === 'properties') {
          const deals = await collection.countDocuments({ deal: true });
          const withAgent = await collection.countDocuments({
            $or: [
              { agentEmail: { $exists: true, $ne: null, $ne: '' } },
              { agent_email: { $exists: true, $ne: null, $ne: '' } }
            ]
          });
          const states = await collection.distinct('state');
          console.log(`   - Deals: ${deals}`);
          console.log(`   - With agent email: ${withAgent}`);
          console.log(`   - States: ${states.join(', ')}`);
        }

        if (collName === 'users') {
          const admins = await collection.countDocuments({ isAdmin: true });
          console.log(`   - Admin users: ${admins}`);
        }

        if (collName === 'rawproperties') {
          const statuses = await collection.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ]).toArray();
          console.log(`   - By status:`);
          statuses.forEach(s => console.log(`     * ${s._id}: ${s.count}`));
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Database check complete!\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkData();
