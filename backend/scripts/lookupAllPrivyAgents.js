import 'dotenv/config';
import mongoose from 'mongoose';
import { getPrivyPage, lookupAddressAgent } from '../routes/agent-lookup.js';

const MONGO_URI = process.env.MONGO_URI;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function lookupAllPrivyAgents() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!\n');

  // Get all Privy deals that need agent lookup
  const deals = await mongoose.connection.db.collection('scrapeddeals').find({
    source: { $regex: /^privy/i },
    isDeal: true,
    $or: [
      { agentLookupStatus: null },
      { agentLookupStatus: 'pending' },
      { agentLookupStatus: { $exists: false } }
    ]
  }).toArray();

  console.log(`Found ${deals.length} Privy deals to lookup\n`);

  if (deals.length === 0) {
    console.log('No deals to process.');
    await mongoose.disconnect();
    return;
  }

  // Get Privy page (handles login)
  console.log('Logging into Privy...');
  const page = await getPrivyPage();
  console.log('Logged in!\n');

  let found = 0, notFound = 0, failed = 0;

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    console.log(`[${i + 1}/${deals.length}] Looking up: ${deal.fullAddress}`);

    try {
      const result = await lookupAddressAgent(page, deal.fullAddress);

      if (result.ok && result.hasData) {
        // Agent found
        await mongoose.connection.db.collection('scrapeddeals').updateOne(
          { _id: deal._id },
          {
            $set: {
              agentName: result.agent.name || null,
              agentPhone: result.agent.phone || null,
              agentEmail: result.agent.email || null,
              brokerage: result.agent.brokerage || null,
              agentLookupStatus: 'found',
              agentLookupAt: new Date(),
            }
          }
        );
        console.log(`  ✓ FOUND: ${result.agent.name || 'N/A'} | ${result.agent.phone || 'N/A'} | ${result.agent.brokerage || 'N/A'}`);
        found++;
      } else {
        // No agent found
        await mongoose.connection.db.collection('scrapeddeals').updateOne(
          { _id: deal._id },
          {
            $set: {
              agentLookupStatus: 'not_found',
              agentLookupAt: new Date(),
            }
          }
        );
        console.log(`  ✗ NOT FOUND - No agent data in Privy`);
        notFound++;
      }
    } catch (err) {
      console.log(`  ✗ FAILED: ${err.message}`);
      failed++;
    }

    // Small delay between lookups
    await sleep(1000);
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`Total:     ${deals.length}`);
  console.log(`Found:     ${found}`);
  console.log(`Not Found: ${notFound}`);
  console.log(`Failed:    ${failed}`);
  console.log('=============================\n');

  await mongoose.disconnect();
  console.log('Done!');
  process.exit(0);
}

lookupAllPrivyAgents().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
