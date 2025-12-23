// Test MongoDB local connection
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';

console.log('🔍 Testing MongoDB connection...');
console.log('📍 Connection URI:', MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')); // mask password if present

async function testConnection() {
  try {
    console.log('\n⏳ Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    const db = mongoose.connection.db;
    const dbName = mongoose.connection.name;

    console.log('✅ MongoDB connected successfully!');
    console.log('📦 Database name:', dbName);

    // List existing collections
    const collections = await db.listCollections().toArray();
    console.log('\n📚 Existing collections:');
    if (collections.length === 0) {
      console.log('   (No collections yet - will be created when data is inserted)');
    } else {
      collections.forEach(col => {
        console.log(`   - ${col.name}`);
      });
    }

    // Test database info
    const stats = await db.stats();
    console.log('\n📊 Database stats:');
    console.log(`   - Collections: ${stats.collections}`);
    console.log(`   - Data size: ${(stats.dataSize / 1024).toFixed(2)} KB`);
    console.log(`   - Storage size: ${(stats.storageSize / 1024).toFixed(2)} KB`);

    await mongoose.connection.close();
    console.log('\n✅ Test completed successfully! MongoDB is ready to use.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ MongoDB connection failed!');
    console.error('Error:', error.message);

    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Solution: Make sure MongoDB service is running');
      console.error('   Run: net start MongoDB');
    } else if (error.message.includes('Authentication failed')) {
      console.error('\n💡 Solution: Check your MongoDB credentials in .env file');
    }

    process.exit(1);
  }
}

testConnection();
