// Migration script to recalculate isDeal for all existing ScrapedDeal records
// Requirements: AMV >= 2x LP AND AMV > $200,000

import mongoose from 'mongoose';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const MIN_AMV_FOR_DEAL = 200000;

function calculateIsDeal(amv, listingPrice) {
  if (!amv || !listingPrice || amv <= 0 || listingPrice <= 0) {
    return false;
  }
  return amv >= (listingPrice * 2) && amv > MIN_AMV_FOR_DEAL;
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!');

  const db = mongoose.connection.db;
  const collection = db.collection('scrapeddeals');

  // Get all documents
  const docs = await collection.find({}).toArray();
  console.log(`Found ${docs.length} records to process`);

  let updated = 0;
  let movedToNotDeal = 0;
  let movedToDeal = 0;
  let unchanged = 0;

  for (const doc of docs) {
    const newIsDeal = calculateIsDeal(doc.amv, doc.listingPrice);
    const oldIsDeal = doc.isDeal || false;

    if (newIsDeal !== oldIsDeal) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { isDeal: newIsDeal } }
      );
      updated++;

      if (oldIsDeal && !newIsDeal) {
        movedToNotDeal++;
        console.log(`  → Moved to NOT DEAL: ${doc.fullAddress} (AMV: $${doc.amv?.toLocaleString() || 'N/A'}, LP: $${doc.listingPrice?.toLocaleString() || 'N/A'})`);
      } else if (!oldIsDeal && newIsDeal) {
        movedToDeal++;
        console.log(`  → Moved to DEAL: ${doc.fullAddress} (AMV: $${doc.amv?.toLocaleString() || 'N/A'}, LP: $${doc.listingPrice?.toLocaleString() || 'N/A'})`);
      }
    } else {
      unchanged++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total records: ${docs.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`  - Moved to NOT DEAL (AMV <= $200k): ${movedToNotDeal}`);
  console.log(`  - Moved to DEAL: ${movedToDeal}`);
  console.log(`Unchanged: ${unchanged}`);

  // Show current counts
  const totalDeals = await collection.countDocuments({ isDeal: true });
  const totalNotDeals = await collection.countDocuments({ isDeal: { $ne: true } });
  console.log(`\nCurrent counts:`);
  console.log(`  Deals: ${totalDeals}`);
  console.log(`  Not Deals: ${totalNotDeals}`);

  await mongoose.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
