import mongoose from 'mongoose';

async function checkStatus() {
  await mongoose.connect('mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority');
  const db = mongoose.connection.db;

  const now = new Date();
  console.log('=== CURRENT TIME ===');
  console.log(`Now: ${now.toISOString()}`);

  // Total count
  const total = await db.collection('scrapeddeals').countDocuments();
  console.log(`\n=== TOTAL DEALS: ${total} ===`);

  // Get most recent deal
  const mostRecent = await db.collection('scrapeddeals')
    .find({})
    .sort({ scrapedAt: -1 })
    .limit(1)
    .toArray();

  if (mostRecent.length > 0) {
    const lastTime = new Date(mostRecent[0].scrapedAt);
    const minutesAgo = Math.round((now - lastTime) / 1000 / 60);
    console.log(`\n=== LAST ACTIVITY ===`);
    console.log(`Last deal: ${mostRecent[0].fullAddress?.slice(0, 50)}`);
    console.log(`Time: ${lastTime.toISOString()}`);
    console.log(`Minutes ago: ${minutesAgo}`);
  }

  // Deals in last 5 minutes
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);
  const recentCount = await db.collection('scrapeddeals').countDocuments({
    scrapedAt: { $gte: fiveMinAgo }
  });
  console.log(`\n=== DEALS IN LAST 5 MIN: ${recentCount} ===`);

  // Deals in last hour
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const hourCount = await db.collection('scrapeddeals').countDocuments({
    scrapedAt: { $gte: hourAgo }
  });
  console.log(`=== DEALS IN LAST HOUR: ${hourCount} ===`);

  // AMV status
  const withAMV = await db.collection('scrapeddeals').countDocuments({ amv: { $exists: true, $ne: null } });
  const withoutAMV = total - withAMV;
  console.log(`\n=== AMV STATUS ===`);
  console.log(`With AMV: ${withAMV}`);
  console.log(`Without AMV: ${withoutAMV}`);

  process.exit(0);
}

checkStatus().catch(console.error);
