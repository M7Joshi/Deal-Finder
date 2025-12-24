import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';
  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  console.log('\n=== CLEANING UP MALFORMED DATA ===\n');

  // 1. Delete malformed addresses (HRS AGO, ABOUT THIS HOME patterns)
  const malformedResult = await db.collection('rawproperties').deleteMany({
    address: { $regex: 'HRS AGO|ABOUT THIS HOME|WALKTHROUGH', $options: 'i' }
  });
  console.log(`Deleted ${malformedResult.deletedCount} malformed addresses (HRS AGO/ABOUT THIS HOME)`);

  // 2. Delete addresses that don't start with a number (not valid street addresses)
  const invalidResult = await db.collection('rawproperties').deleteMany({
    address: { $not: /^\d+\s+\w/ }
  });
  console.log(`Deleted ${invalidResult.deletedCount} addresses not starting with number`);

  // 3. Delete MT (Montana) addresses - blocked state
  const mtResult = await db.collection('rawproperties').deleteMany({
    state: 'MT'
  });
  console.log(`Deleted ${mtResult.deletedCount} MT (Montana) addresses - blocked state`);

  // Also clean from properties collection
  const propMalformed = await db.collection('properties').deleteMany({
    address: { $regex: 'HRS AGO|ABOUT THIS HOME|WALKTHROUGH', $options: 'i' }
  });
  console.log(`Deleted ${propMalformed.deletedCount} malformed from properties`);

  const propInvalid = await db.collection('properties').deleteMany({
    address: { $not: /^\d+\s+\w/ }
  });
  console.log(`Deleted ${propInvalid.deletedCount} invalid from properties`);

  const propMT = await db.collection('properties').deleteMany({
    state: 'MT'
  });
  console.log(`Deleted ${propMT.deletedCount} MT from properties`);

  // 4. Show current status
  console.log('\n--- Current Status ---');
  const rawCount = await db.collection('rawproperties').countDocuments();
  const propCount = await db.collection('properties').countDocuments();
  console.log(`rawproperties: ${rawCount}`);
  console.log(`properties: ${propCount}`);

  // By state
  const byState = await db.collection('rawproperties').aggregate([
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log('By state:', JSON.stringify(byState));

  await mongoose.disconnect();
  console.log('\n=== CLEANUP COMPLETE ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
