// One-time migration script: Copy rawproperties to ScrapedDeal collection
// Run with: node scripts/migrate-rawprops-to-scrapeddeals.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const rawPropsCol = db.collection('rawproperties');
    const scrapedDealsCol = db.collection('scrapeddeals');

    // Get recent rawproperties that don't exist in scrapeddeals
    const rawProps = await rawPropsCol
      .find({})
      .sort({ scrapedAt: -1 })
      .limit(500)
      .toArray();

    console.log('Found', rawProps.length, 'rawproperties to migrate');

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const prop of rawProps) {
      try {
        if (!prop.fullAddress) {
          skipped++;
          continue;
        }

        const fullAddress_ci = prop.fullAddress.trim().toLowerCase();

        // Check if already exists
        const exists = await scrapedDealsCol.findOne({ fullAddress_ci });
        if (exists) {
          skipped++;
          continue;
        }

        // Insert new ScrapedDeal
        await scrapedDealsCol.insertOne({
          address: prop.address || prop.fullAddress.split(',')[0].trim(),
          fullAddress: prop.fullAddress,
          fullAddress_ci,
          city: prop.city || null,
          state: prop.state || null,
          zip: prop.zip || null,
          listingPrice: prop.price || prop.listingPrice || null,
          beds: prop.beds || null,
          baths: prop.baths || null,
          sqft: prop.sqft || null,
          agentName: prop.details?.agent_name || prop.agentName || null,
          agentEmail: prop.details?.agent_email || prop.agentEmail || null,
          agentPhone: prop.details?.agent_phone || prop.agentPhone || null,
          source: 'privy',
          amv: null,
          isDeal: false,
          scrapedAt: prop.scrapedAt || prop.createdAt || new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        migrated++;
      } catch (e) {
        if (e.code === 11000) {
          skipped++; // Duplicate key
        } else {
          errors++;
          console.error('Error migrating:', prop.fullAddress, e.message);
        }
      }
    }

    console.log('Migration complete:');
    console.log('  Migrated:', migrated);
    console.log('  Skipped (duplicates):', skipped);
    console.log('  Errors:', errors);

    // Verify
    const count = await scrapedDealsCol.countDocuments();
    console.log('Total ScrapedDeals now:', count);

    await mongoose.disconnect();
  } catch (e) {
    console.error('Migration failed:', e.message);
  }
}

migrate();
