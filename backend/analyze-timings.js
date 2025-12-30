import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function analyzeTimings() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Get addresses grouped by exact timestamp to see batch saves
  const pipeline = [
    { $match: { source: 'privy' } },
    { $sort: { scrapedAt: -1 } },
    { $limit: 500 },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d %H:%M:%S', date: '$scrapedAt' } },
      count: { $sum: 1 },
      cities: { $addToSet: '$city' }
    }},
    { $sort: { _id: -1 } },
    { $limit: 20 }
  ];

  const batches = await db.collection('scrapeddeals').aggregate(pipeline).toArray();

  console.log('=== BATCH SAVES (Last 20) ===');
  console.log('Time                  | Count | Cities');
  console.log('----------------------|-------|--------');

  let prevTime = null;
  batches.forEach(b => {
    const cities = b.cities.slice(0, 2).join(', ');
    let gap = '';
    if (prevTime) {
      const diff = (new Date(prevTime) - new Date(b._id)) / 1000 / 60;
      gap = ' (gap: ' + diff.toFixed(1) + ' min)';
    }
    console.log(b._id + ' | ' + String(b.count).padStart(5) + ' | ' + cities + gap);
    prevTime = b._id;
  });

  // Calculate average gap
  console.log('');
  console.log('=== TIMING ANALYSIS ===');

  let totalGap = 0;
  let gapCount = 0;
  for (let i = 0; i < batches.length - 1; i++) {
    const diff = (new Date(batches[i]._id) - new Date(batches[i+1]._id)) / 1000 / 60;
    totalGap += diff;
    gapCount++;
  }

  if (gapCount > 0) {
    console.log('Average time between batches: ' + (totalGap / gapCount).toFixed(1) + ' minutes');
    console.log('Total batches analyzed: ' + batches.length);
    console.log('Total addresses in these batches: ' + batches.reduce((a, b) => a + b.count, 0));
  }

  await mongoose.disconnect();
}

analyzeTimings().catch(e => console.error(e.message));
