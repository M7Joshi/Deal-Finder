import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkAgentData() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Check ScrapedDeals with agent info
  const withAgentName = await db.collection('scrapeddeals').countDocuments({
    agentName: { $exists: true, $ne: null, $ne: '' }
  });

  const withAgentEmail = await db.collection('scrapeddeals').countDocuments({
    agentEmail: { $exists: true, $ne: null, $ne: '' }
  });

  const withAgentPhone = await db.collection('scrapeddeals').countDocuments({
    agentPhone: { $exists: true, $ne: null, $ne: '' }
  });

  const totalDeals = await db.collection('scrapeddeals').countDocuments();

  console.log('=== AGENT DATA IN SCRAPEDDEALS ===');
  console.log('Total records:', totalDeals);
  console.log('With agent name:', withAgentName);
  console.log('With agent email:', withAgentEmail);
  console.log('With agent phone:', withAgentPhone);

  // Check recent records with agent data
  const recentWithAgent = await db.collection('scrapeddeals')
    .find({ agentName: { $exists: true, $ne: null, $ne: '' } })
    .sort({ scrapedAt: -1 })
    .limit(5)
    .toArray();

  console.log('');
  console.log('=== 5 RECENT WITH AGENT DATA ===');
  if (recentWithAgent.length > 0) {
    recentWithAgent.forEach(function(d, i) {
      console.log((i+1) + '. ' + (d.fullAddress || '').substring(0, 40) + '...');
      console.log('   Agent: ' + (d.agentName || 'N/A'));
      console.log('   Email: ' + (d.agentEmail || 'N/A'));
      console.log('   Phone: ' + (d.agentPhone || 'N/A'));
    });
  } else {
    console.log('No records with agent data found');
  }

  // Check by source
  const privyWithAgent = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    agentName: { $exists: true, $ne: null, $ne: '' }
  });

  const redfinWithAgent = await db.collection('scrapeddeals').countDocuments({
    source: 'redfin',
    agentName: { $exists: true, $ne: null, $ne: '' }
  });

  console.log('');
  console.log('=== AGENT DATA BY SOURCE ===');
  console.log('Privy with agent:', privyWithAgent);
  console.log('Redfin with agent:', redfinWithAgent);

  // Check records missing agent data
  const missingAgent = await db.collection('scrapeddeals').countDocuments({
    $or: [
      { agentName: { $exists: false } },
      { agentName: null },
      { agentName: '' }
    ]
  });

  console.log('');
  console.log('=== MISSING AGENT DATA ===');
  console.log('Records without agent name:', missingAgent);

  await mongoose.disconnect();
}

checkAgentData().catch(function(e) { console.error(e.message); process.exit(1); });
