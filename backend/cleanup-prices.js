import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function cleanupPrices() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const MIN_PRICE = 20000;
  const MAX_PRICE = 600000;

  console.log('=== PRICE CLEANUP ===\n');
  console.log(`Removing properties outside $${MIN_PRICE.toLocaleString()}-$${MAX_PRICE.toLocaleString()} range...\n`);

  // Count before
  const totalBefore = await db.collection('scrapeddeals').countDocuments();
  const aboveMax = await db.collection('scrapeddeals').countDocuments({ listingPrice: { $gt: MAX_PRICE } });
  const belowMin = await db.collection('scrapeddeals').countDocuments({ listingPrice: { $lt: MIN_PRICE, $gt: 0 } });

  console.log('Before cleanup:');
  console.log(`  Total properties: ${totalBefore}`);
  console.log(`  Above $${MAX_PRICE.toLocaleString()}: ${aboveMax}`);
  console.log(`  Below $${MIN_PRICE.toLocaleString()}: ${belowMin}`);
  console.log('');

  // Delete properties above max price
  const deleteAbove = await db.collection('scrapeddeals').deleteMany({
    listingPrice: { $gt: MAX_PRICE }
  });
  console.log(`Deleted ${deleteAbove.deletedCount} properties above $${MAX_PRICE.toLocaleString()}`);

  // Delete properties below min price (but not null/0)
  const deleteBelow = await db.collection('scrapeddeals').deleteMany({
    listingPrice: { $lt: MIN_PRICE, $gt: 0 }
  });
  console.log(`Deleted ${deleteBelow.deletedCount} properties below $${MIN_PRICE.toLocaleString()}`);

  // Count after
  const totalAfter = await db.collection('scrapeddeals').countDocuments();
  console.log('');
  console.log('After cleanup:');
  console.log(`  Total properties: ${totalAfter}`);
  console.log(`  Removed: ${totalBefore - totalAfter}`);

  await mongoose.disconnect();
}

cleanupPrices().catch(e => { console.error(e.message); process.exit(1); });
