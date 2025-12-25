import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';

async function checkDB() {
  await mongoose.connect(dbURI);
  console.log('Connected to MongoDB');

  // Check scrapeddeals for agent details
  const scrapedDeals = mongoose.connection.db.collection('scrapeddeals');
  const total = await scrapedDeals.countDocuments();

  // Count with agent info
  const withAgentName = await scrapedDeals.countDocuments({ agentName: { $ne: null, $exists: true } });
  const withAgentEmail = await scrapedDeals.countDocuments({ agentEmail: { $ne: null, $exists: true } });
  const withAgentPhone = await scrapedDeals.countDocuments({ agentPhone: { $ne: null, $exists: true } });
  const withAnyAgent = await scrapedDeals.countDocuments({
    $or: [
      { agentName: { $ne: null, $exists: true } },
      { agentEmail: { $ne: null, $exists: true } },
      { agentPhone: { $ne: null, $exists: true } }
    ]
  });

  console.log('\n=== Agent Details Summary (scrapeddeals) ===');
  console.log('Total deals:', total);
  console.log('With agent name:', withAgentName);
  console.log('With agent email:', withAgentEmail);
  console.log('With agent phone:', withAgentPhone);
  console.log('With ANY agent info:', withAnyAgent);
  console.log('Coverage:', Math.round(withAnyAgent / total * 100) + '%');

  // Show recent deals with agent info
  console.log('\n=== Recent Deals with Agent Info ===');
  const withAgent = await scrapedDeals.find({
    $or: [
      { agentName: { $ne: null } },
      { agentEmail: { $ne: null } },
      { agentPhone: { $ne: null } }
    ]
  }).sort({ scrapedAt: -1 }).limit(10).toArray();

  withAgent.forEach((d, i) => {
    console.log(`${i+1}. ${d.address || d.fullAddress}`);
    console.log(`   Agent: ${d.agentName || 'N/A'} | Email: ${d.agentEmail || 'N/A'} | Phone: ${d.agentPhone || 'N/A'}`);
    console.log(`   Source: ${d.source} | Price: $${d.listingPrice || 'N/A'}`);
  });

  // Show deals WITHOUT agent info
  console.log('\n=== Recent Deals WITHOUT Agent Info ===');
  const withoutAgent = await scrapedDeals.find({
    agentName: null,
    agentEmail: null,
    agentPhone: null
  }).sort({ scrapedAt: -1 }).limit(5).toArray();

  withoutAgent.forEach((d, i) => {
    console.log(`${i+1}. ${d.address || d.fullAddress} | Source: ${d.source}`);
  });

  await mongoose.disconnect();
}

checkDB().catch(e => console.error(e.message));
