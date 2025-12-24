// scripts/clear-all-data.js
// Run this to clear all scraped data and start fresh
// Usage: node scripts/clear-all-data.js

import 'dotenv/config';
import mongoose from 'mongoose';
import ScrapedDeal from '../models/ScrapedDeal.js';
import Property from '../models/Property.js';
import RawProperty from '../models/rawProperty.js';

async function clearAllData() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('MONGO_URI not set in environment');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected!\n');

    // Get counts before deletion
    const scrapedCount = await ScrapedDeal.countDocuments();
    const propertyCount = await Property.countDocuments();
    const rawPropertyCount = await RawProperty.countDocuments();

    console.log('Current data counts:');
    console.log(`  ScrapedDeal: ${scrapedCount}`);
    console.log(`  Property: ${propertyCount}`);
    console.log(`  RawProperty: ${rawPropertyCount}`);
    console.log('');

    // Delete all data
    console.log('Clearing ScrapedDeal collection...');
    const scrapedResult = await ScrapedDeal.deleteMany({});
    console.log(`  Deleted ${scrapedResult.deletedCount} documents`);

    console.log('Clearing Property collection...');
    const propertyResult = await Property.deleteMany({});
    console.log(`  Deleted ${propertyResult.deletedCount} documents`);

    console.log('Clearing RawProperty collection...');
    const rawResult = await RawProperty.deleteMany({});
    console.log(`  Deleted ${rawResult.deletedCount} documents`);

    console.log('\n✅ All data cleared! Ready to start fresh.');
    console.log('\nThe batch counter will automatically reset to 0 when the worker restarts.');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

clearAllData();
