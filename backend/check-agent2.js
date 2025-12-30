import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkAgentData() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const totalDeals = await db.collection('scrapeddeals').countDocuments();

  // Check for actual non-empty agent values
  const withRealAgentName = await db.collection('scrapeddeals').countDocuments({
    agentName: { $regex: /\S+/ }  // Has non-whitespace characters
  });

  const withRealAgentEmail = await db.collection('scrapeddeals').countDocuments({
    agentEmail: { $regex: /@/ }  // Contains @ symbol
  });

  const withRealAgentPhone = await db.collection('scrapeddeals').countDocuments({
    agentPhone: { $regex: /\d{3}/ }  // Contains at least 3 digits
  });

  console.log('=== AGENT DATA STATUS ===');
  console.log('Total records:', totalDeals);
  console.log('With REAL agent name:', withRealAgentName);
  console.log('With REAL agent email:', withRealAgentEmail);
  console.log('With REAL agent phone:', withRealAgentPhone);

  // Get sample records with actual agent data
  const sampleWithAgent = await db.collection('scrapeddeals')
    .find({ agentEmail: { $regex: /@/ } })
    .sort({ scrapedAt: -1 })
    .limit(5)
    .toArray();

  console.log('');
  console.log('=== 5 RECORDS WITH REAL AGENT EMAIL ===');
  if (sampleWithAgent.length > 0) {
    sampleWithAgent.forEach(function(d, i) {
      console.log((i+1) + '. ' + (d.fullAddress || '').substring(0, 35) + '...');
      console.log('   Source: ' + (d.source || 'N/A'));
      console.log('   Agent: ' + (d.agentName || 'N/A'));
      console.log('   Email: ' + (d.agentEmail || 'N/A'));
      console.log('   Phone: ' + (d.agentPhone || 'N/A'));
    });
  } else {
    console.log('No records with real agent email found');
  }

  // Check by source with real data
  const privyRealAgent = await db.collection('scrapeddeals').countDocuments({
    source: 'privy',
    agentEmail: { $regex: /@/ }
  });

  const redfinRealAgent = await db.collection('scrapeddeals').countDocuments({
    source: 'redfin',
    agentEmail: { $regex: /@/ }
  });

  console.log('');
  console.log('=== REAL AGENT EMAIL BY SOURCE ===');
  console.log('Privy with real agent email:', privyRealAgent);
  console.log('Redfin with real agent email:', redfinRealAgent);

  await mongoose.disconnect();
}

checkAgentData().catch(function(e) { console.error(e.message); process.exit(1); });
