/**
 * Test script to debug Wells Fargo scraper
 */

import dotenv from 'dotenv';
import { log } from './utils/logger.js';
import { getSharedBot } from './vendors/wellsfargo/wellsfargoBot.js';

// Load environment variables
dotenv.config();

const L = log.child('test:wellsfargo');

async function testWellsFargo() {
  const testAddress = '3474 Haines Road N, St Petersburg, FL 33704';

  L.info('Testing Wells Fargo scraper with address', { address: testAddress });

  try {
    const bot = await getSharedBot();
    L.info('Bot initialized successfully');

    const result = await bot.fetchAgent(testAddress);
    L.info('Fetch complete', { result: JSON.stringify(result, null, 2) });

    // Keep process alive to view screenshot
    await new Promise(r => setTimeout(r, 60000));

    await bot.close();
    L.info('Bot closed');

  } catch (error) {
    L.error('Test failed', { error: error.message, stack: error.stack });
  }

  process.exit(0);
}

testWellsFargo();
