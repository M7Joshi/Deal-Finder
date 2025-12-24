// clear-properties.js
// Run this script to clear ALL properties from the database
// Usage: node scripts/clear-properties.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env');
  process.exit(1);
}

async function clearProperties() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Get count before deletion
    const propertiesCollection = db.collection('properties');
    const countBefore = await propertiesCollection.countDocuments();
    console.log(`📊 Found ${countBefore} properties in database`);

    if (countBefore === 0) {
      console.log('ℹ️ No properties to delete');
      await mongoose.disconnect();
      return;
    }

    // Confirm deletion
    console.log('\n⚠️  WARNING: This will permanently delete ALL properties!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Delete all properties
    console.log('🗑️ Deleting all properties...');
    const result = await propertiesCollection.deleteMany({});

    console.log(`\n✅ Successfully deleted ${result.deletedCount} properties`);
    console.log('🔄 Privy and Redfin scrapers will now populate fresh data');

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearProperties();
