// Comprehensive System Test
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Property from './models/Property.js';
import User from './models/User.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder';

console.log('🔬 COMPREHENSIVE SYSTEM TEST\n');
console.log('='.repeat(70));

const tests = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function pass(name) {
  console.log(`✅ ${name}`);
  tests.passed++;
}

function fail(name, error) {
  console.log(`❌ ${name}`);
  if (error) console.log(`   Error: ${error}`);
  tests.failed++;
}

function warn(name, message) {
  console.log(`⚠️  ${name}`);
  if (message) console.log(`   Warning: ${message}`);
  tests.warnings++;
}

async function testSystem() {
  try {
    // ==================== DATABASE TESTS ====================
    console.log('\n📦 DATABASE TESTS');
    console.log('-'.repeat(70));

    // Test 1: MongoDB Connection
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      pass('MongoDB connection successful');
    } catch (error) {
      fail('MongoDB connection failed', error.message);
      process.exit(1);
    }

    const db = mongoose.connection.db;

    // Test 2: Collections exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    const requiredCollections = ['properties', 'users'];
    for (const coll of requiredCollections) {
      if (collectionNames.includes(coll)) {
        pass(`Collection '${coll}' exists`);
      } else {
        fail(`Collection '${coll}' missing`);
      }
    }

    // Test 3: Properties data
    const propertyCount = await Property.countDocuments();
    if (propertyCount > 0) {
      pass(`Properties collection has data (${propertyCount} documents)`);
    } else {
      warn('Properties collection is empty', 'Run Privy scraper to populate');
    }

    // Test 4: Sample property structure
    if (propertyCount > 0) {
      const sampleProp = await Property.findOne().lean();

      const requiredFields = ['fullAddress', 'price', 'state', 'city'];
      let fieldsOk = true;
      for (const field of requiredFields) {
        if (!(field in sampleProp)) {
          fail(`Property missing field: ${field}`);
          fieldsOk = false;
        }
      }
      if (fieldsOk) {
        pass('Property schema has required fields');
      }

      // Check for calculated fields
      if (sampleProp.amv !== undefined) {
        pass('Properties have AMV field');
      } else {
        warn('Properties missing AMV', 'Run valuation jobs (BofA, Redfin)');
      }

      if (sampleProp.deal !== undefined) {
        pass('Properties have deal flag');
      } else {
        warn('Properties missing deal flag', 'AMV calculation needed');
      }
    }

    // Test 5: Deals count
    const dealCount = await Property.countDocuments({ deal: true });
    if (dealCount > 0) {
      pass(`Found ${dealCount} deals in database`);
    } else {
      warn('No deals found', 'Check if AMV calculations are running');
    }

    // Test 6: Properties with agent emails
    const withAgentEmail = await Property.countDocuments({
      $or: [
        { agentEmail: { $exists: true, $ne: null, $ne: '' } },
        { agent_email: { $exists: true, $ne: null, $ne: '' } }
      ]
    });
    if (withAgentEmail > 0) {
      pass(`${withAgentEmail} properties have agent emails`);
    } else {
      warn('No agent emails found', 'Run Homes.com scraper');
    }

    // Test 7: User account
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      pass(`User collection has ${userCount} account(s)`);
    } else {
      fail('No users found', 'Run ensureMasterAdmin.js');
    }

    // Test 8: Admin user exists
    const adminUser = await User.findOne({ isAdmin: true });
    if (adminUser) {
      pass(`Admin user exists: ${adminUser.email}`);
    } else {
      const anyUser = await User.findOne();
      if (anyUser) {
        warn('No admin user found', `Existing user: ${anyUser.email} - promote to admin`);
      } else {
        fail('No admin user exists');
      }
    }

    // ==================== DATA QUALITY TESTS ====================
    console.log('\n🔍 DATA QUALITY TESTS');
    console.log('-'.repeat(70));

    if (propertyCount > 0) {
      // Test 9: Address normalization
      const withNormalizedAddress = await Property.countDocuments({
        fullAddress_ci: { $exists: true, $ne: null }
      });
      if (withNormalizedAddress === propertyCount) {
        pass('All properties have normalized addresses');
      } else {
        warn(`${propertyCount - withNormalizedAddress} properties missing fullAddress_ci`);
      }

      // Test 10: State codes
      const states = await Property.distinct('state');
      if (states.length > 0) {
        pass(`Properties span ${states.length} state(s): ${states.join(', ')}`);
      } else {
        warn('No state data found');
      }

      // Test 11: Price data
      const withPrice = await Property.countDocuments({
        price: { $exists: true, $ne: null, $gt: 0 }
      });
      const pricePercentage = ((withPrice / propertyCount) * 100).toFixed(1);
      if (pricePercentage > 80) {
        pass(`${pricePercentage}% of properties have price data`);
      } else {
        warn(`Only ${pricePercentage}% of properties have price data`);
      }

      // Test 12: Valuations coverage
      const withBofA = await Property.countDocuments({
        bofa_value: { $exists: true, $ne: null, $gt: 0 }
      });
      const withRedfin = await Property.countDocuments({
        redfin_avm_value: { $exists: true, $ne: null, $gt: 0 }
      });

      if (withBofA > 0) {
        pass(`${withBofA} properties have BofA valuations`);
      } else {
        warn('No BofA valuations', 'Run BofA job');
      }

      if (withRedfin > 0) {
        pass(`${withRedfin} properties have Redfin AVM valuations`);
      } else {
        warn('No Redfin AVM valuations', 'Run Redfin AVM job');
      }
    }

    // ==================== ENVIRONMENT TESTS ====================
    console.log('\n⚙️  ENVIRONMENT CONFIGURATION TESTS');
    console.log('-'.repeat(70));

    // Test 13: Critical env vars
    const criticalEnvVars = {
      'MONGO_URI': process.env.MONGO_URI,
      'JWT_SECRET': process.env.JWT_SECRET,
      'PRIVY_EMAIL': process.env.PRIVY_EMAIL,
      'PRIVY_PASSWORD': process.env.PRIVY_PASSWORD ? '***' : undefined
    };

    for (const [key, value] of Object.entries(criticalEnvVars)) {
      if (value) {
        pass(`${key} is configured`);
      } else {
        fail(`${key} is missing in .env`);
      }
    }

    // Test 14: MongoDB connection type
    if (MONGO_URI.includes('localhost') || MONGO_URI.includes('127.0.0.1')) {
      pass('Using local MongoDB database');
    } else if (MONGO_URI.includes('mongodb.net') || MONGO_URI.includes('mongodb+srv')) {
      pass('Using remote MongoDB Atlas');
    } else {
      warn('Unknown MongoDB connection type');
    }

    // Test 15: Optional configurations
    const optionalConfigs = {
      'SMTP_HOST': 'Email service',
      'GOOGLE_MAPS_API_KEY': 'Google Maps',
      'OPENAI_API_KEY': 'OpenAI integration'
    };

    for (const [key, name] of Object.entries(optionalConfigs)) {
      if (process.env[key]) {
        pass(`${name} configured`);
      } else {
        warn(`${name} not configured`, 'Feature may be limited');
      }
    }

    // ==================== SUMMARY ====================
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Passed:   ${tests.passed}`);
    console.log(`❌ Failed:   ${tests.failed}`);
    console.log(`⚠️  Warnings: ${tests.warnings}`);
    console.log('='.repeat(70));

    if (tests.failed === 0) {
      console.log('\n🎉 ALL CRITICAL TESTS PASSED!');
      if (tests.warnings > 0) {
        console.log(`\n💡 You have ${tests.warnings} warning(s) - these are optional improvements.`);
      }
      console.log('\n✅ System is ready to use!\n');
    } else {
      console.log(`\n⚠️  ${tests.failed} critical test(s) failed. Please fix before proceeding.\n`);
    }

    // Cleanup
    await mongoose.connection.close();
    process.exit(tests.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Test suite error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testSystem();
