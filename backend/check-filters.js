import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkFilters() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log('=== FILTER ANALYSIS ===\n');

  // Check for high-priced properties (should be filtered out at $600k max)
  const highPriced = await db.collection('scrapeddeals').find({
    listingPrice: { $gt: 600000 }
  }).limit(20).toArray();

  console.log(`Properties ABOVE $600,000 (should be 0): ${highPriced.length}`);
  if (highPriced.length > 0) {
    console.log('Examples:');
    highPriced.slice(0, 5).forEach(p => {
      console.log(`  - $${p.listingPrice?.toLocaleString()} | ${p.fullAddress} | Source: ${p.source}`);
    });
  }

  // Check for the specific property mentioned
  const riverwood = await db.collection('scrapeddeals').findOne({
    fullAddress: { $regex: /201 Riverwood/i }
  });

  if (riverwood) {
    console.log('\n=== 201 Riverwood Dr Details ===');
    console.log('Full Address:', riverwood.fullAddress);
    console.log('List Price:', riverwood.listingPrice ? `$${riverwood.listingPrice.toLocaleString()}` : 'N/A');
    console.log('AMV:', riverwood.amv ? `$${riverwood.amv.toLocaleString()}` : 'Pending');
    console.log('Source:', riverwood.source);
    console.log('Scraped At:', riverwood.scrapedAt);
    console.log('City:', riverwood.city);
    console.log('State:', riverwood.state);
  } else {
    console.log('\n201 Riverwood Dr NOT found in database');
  }

  // Price distribution
  console.log('\n=== PRICE DISTRIBUTION ===');
  const priceRanges = [
    { min: 0, max: 100000, label: '$0-$100K' },
    { min: 100000, max: 200000, label: '$100K-$200K' },
    { min: 200000, max: 400000, label: '$200K-$400K' },
    { min: 400000, max: 600000, label: '$400K-$600K' },
    { min: 600000, max: 1000000, label: '$600K-$1M (SHOULD BE 0)' },
    { min: 1000000, max: 10000000, label: '$1M+ (SHOULD BE 0)' },
  ];

  for (const range of priceRanges) {
    const count = await db.collection('scrapeddeals').countDocuments({
      listingPrice: { $gte: range.min, $lt: range.max }
    });
    console.log(`${range.label}: ${count}`);
  }

  // Check for properties with no price
  const noPrice = await db.collection('scrapeddeals').countDocuments({
    $or: [
      { listingPrice: null },
      { listingPrice: { $exists: false } },
      { listingPrice: 0 }
    ]
  });
  console.log(`No Price: ${noPrice}`);

  // Source breakdown
  console.log('\n=== SOURCE BREAKDOWN ===');
  const sources = await db.collection('scrapeddeals').aggregate([
    { $group: { _id: '$source', count: { $sum: 1 } } }
  ]).toArray();
  sources.forEach(s => console.log(`${s._id || 'unknown'}: ${s.count}`));

  // Recent high-priced from Privy
  console.log('\n=== RECENT HIGH-PRICED FROM PRIVY ===');
  const recentHighPrivy = await db.collection('scrapeddeals').find({
    source: 'privy',
    listingPrice: { $gt: 600000 }
  }).sort({ scrapedAt: -1 }).limit(10).toArray();

  if (recentHighPrivy.length > 0) {
    recentHighPrivy.forEach(p => {
      const time = p.scrapedAt ? new Date(p.scrapedAt).toLocaleString() : '?';
      console.log(`  [${time}] $${p.listingPrice?.toLocaleString()} | ${p.fullAddress}`);
    });
  } else {
    console.log('  None - filters are working correctly for Privy');
  }

  await mongoose.disconnect();
}

checkFilters().catch(e => { console.error(e.message); process.exit(1); });
