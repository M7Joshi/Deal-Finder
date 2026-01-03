const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);

  const ScrapedDeal = mongoose.model('ScrapedDeal', new mongoose.Schema({}, { strict: false }), 'scrapeddeals');

  // Total Privy addresses
  const totalPrivy = await ScrapedDeal.countDocuments({ source: 'privy' });

  // Privy addresses with actual agent info (not null/empty)
  const withAgentName = await ScrapedDeal.countDocuments({
    source: 'privy',
    agentName: { $exists: true, $ne: null, $nin: ['', 'null', 'N/A'] }
  });
  const withAgentEmail = await ScrapedDeal.countDocuments({
    source: 'privy',
    agentEmail: { $exists: true, $ne: null, $nin: ['', 'null', 'N/A'] }
  });
  const withAgentPhone = await ScrapedDeal.countDocuments({
    source: 'privy',
    agentPhone: { $exists: true, $ne: null, $nin: ['', 'null', 'N/A'] }
  });

  console.log('=== PRIVY AGENT DATA STATUS ===');
  console.log('Total Privy addresses:', totalPrivy);
  console.log('With Agent Name:', withAgentName, totalPrivy > 0 ? `(${Math.round(withAgentName/totalPrivy*100)}%)` : '');
  console.log('With Agent Email:', withAgentEmail, totalPrivy > 0 ? `(${Math.round(withAgentEmail/totalPrivy*100)}%)` : '');
  console.log('With Agent Phone:', withAgentPhone, totalPrivy > 0 ? `(${Math.round(withAgentPhone/totalPrivy*100)}%)` : '');

  // Check if any Privy address has ANY agent info at all
  const withAnyAgent = await ScrapedDeal.countDocuments({
    source: 'privy',
    $or: [
      { agentName: { $exists: true, $ne: null, $nin: ['', 'null'] } },
      { agentEmail: { $exists: true, $ne: null, $nin: ['', 'null'] } },
      { agentPhone: { $exists: true, $ne: null, $nin: ['', 'null'] } }
    ]
  });
  console.log('With ANY agent info:', withAnyAgent, totalPrivy > 0 ? `(${Math.round(withAnyAgent/totalPrivy*100)}%)` : '');

  // Sample some recent Privy addresses
  console.log('\n=== SAMPLE PRIVY ADDRESSES (last 10) ===');
  const samples = await ScrapedDeal.find({ source: 'privy' })
    .sort({ scrapedAt: -1 })
    .limit(10)
    .lean();

  samples.forEach(s => {
    console.log('Address:', s.fullAddress || s.address);
    console.log('  Agent:', s.agentName || 'null');
    console.log('  Email:', s.agentEmail || 'null');
    console.log('  Phone:', s.agentPhone || 'null');
    console.log('');
  });

  // Check if ANY Privy record has agent info
  const oneWithAgent = await ScrapedDeal.findOne({
    source: 'privy',
    agentName: { $exists: true, $ne: null, $nin: ['', 'null'] }
  }).lean();

  if (oneWithAgent) {
    console.log('\n=== FOUND ONE WITH AGENT ===');
    console.log('Address:', oneWithAgent.fullAddress);
    console.log('Agent:', oneWithAgent.agentName);
    console.log('Email:', oneWithAgent.agentEmail);
    console.log('Phone:', oneWithAgent.agentPhone);
  } else {
    console.log('\n❌ NO PRIVY ADDRESSES HAVE AGENT DATA');
  }

  await mongoose.disconnect();
}

check().catch(e => console.error('Error:', e.message));
