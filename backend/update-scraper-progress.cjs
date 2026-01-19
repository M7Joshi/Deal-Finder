/**
 * UPDATE SCRAPER PROGRESS
 *
 * Use this script to manually change Privy or Redfin scraper progress.
 *
 * USAGE:
 *   node update-scraper-progress.cjs <scraper> <field> <value>
 *
 * EXAMPLES:
 *   # View current progress
 *   node update-scraper-progress.cjs privy
 *   node update-scraper-progress.cjs redfin
 *
 *   # Change Privy to start from California
 *   node update-scraper-progress.cjs privy currentState CA
 *
 *   # Change Redfin to start from Texas
 *   node update-scraper-progress.cjs redfin currentState TX
 *
 *   # Reset city index to start from beginning of state
 *   node update-scraper-progress.cjs privy currentCityIndex 0
 *
 *   # Change filter cycle (0=privy, 1=privy-Tear, 2=privy-flip)
 *   node update-scraper-progress.cjs privy filterCycleIndex 1
 *
 *   # Reset completed states (start fresh cycle)
 *   node update-scraper-progress.cjs privy completedStates []
 *
 *   # Add state to completed list
 *   node update-scraper-progress.cjs privy addCompleted AL
 *
 *   # Remove state from completed list
 *   node update-scraper-progress.cjs privy removeCompleted CA
 */

const mongoose = require('mongoose');
require('dotenv').config();

const FILTER_NAMES = {
  0: 'privy (buy_hold + umv)',
  1: 'privy-flip (flip + arv)',
  2: 'privy-Tear (scrape + arv)'
};

const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const scraper = args[0].toLowerCase();
  if (!['privy', 'redfin'].includes(scraper)) {
    console.error('Error: scraper must be "privy" or "redfin"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const ScraperProgress = mongoose.model('ScraperProgress', new mongoose.Schema({}, { strict: false }), 'scraperprogresses');

  // If only scraper name provided, show current status
  if (args.length === 1) {
    await showStatus(ScraperProgress, scraper);
    await mongoose.disconnect();
    return;
  }

  const field = args[1];
  const value = args[2];

  // Handle special commands
  if (field === 'addCompleted' && value) {
    const state = value.toUpperCase();
    await ScraperProgress.updateOne(
      { scraper },
      { $addToSet: { completedStates: state, processedCities: state } }
    );
    console.log(`Added ${state} to completed states`);
  }
  else if (field === 'removeCompleted' && value) {
    const state = value.toUpperCase();
    await ScraperProgress.updateOne(
      { scraper },
      { $pull: { completedStates: state, processedCities: state } }
    );
    console.log(`Removed ${state} from completed states`);
  }
  else if (field === 'reset') {
    await ScraperProgress.updateOne(
      { scraper },
      {
        $set: {
          currentState: null,
          currentCityIndex: -1,
          currentStateIndex: 0,
          completedStates: [],
          processedCities: [],
          lastState: null,
          totalScraped: 0,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    console.log(`Reset ${scraper} progress to beginning`);
  }
  else if (field && value !== undefined) {
    // Parse value
    let parsedValue = value;

    // Handle arrays
    if (value === '[]') {
      parsedValue = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      parsedValue = JSON.parse(value);
    }
    // Handle numbers
    else if (!isNaN(value)) {
      parsedValue = parseInt(value, 10);
    }
    // Handle state codes (uppercase)
    else if (field === 'currentState' && value) {
      parsedValue = value.toUpperCase();
      if (!ALL_STATES.includes(parsedValue) && parsedValue !== 'NULL') {
        console.warn(`Warning: ${parsedValue} is not a standard US state code`);
      }
      if (parsedValue === 'NULL') parsedValue = null;
    }

    await ScraperProgress.updateOne(
      { scraper },
      { $set: { [field]: parsedValue, updatedAt: new Date() } },
      { upsert: true }
    );
    console.log(`Updated ${scraper}.${field} = ${JSON.stringify(parsedValue)}`);
  }
  else {
    console.error('Error: Invalid arguments');
    showHelp();
    await mongoose.disconnect();
    process.exit(1);
  }

  // Show updated status
  console.log('\n--- Updated Status ---');
  await showStatus(ScraperProgress, scraper);

  await mongoose.disconnect();
}

async function showStatus(ScraperProgress, scraper) {
  const progress = await ScraperProgress.findOne({ scraper }).lean();

  if (!progress) {
    console.log(`No progress found for ${scraper}`);
    return;
  }

  console.log(`\n=== ${scraper.toUpperCase()} PROGRESS ===`);
  console.log('Current State:', progress.currentState || '(none - will start from beginning)');
  console.log('City Index:', progress.currentCityIndex ?? -1);
  console.log('State Index:', progress.currentStateIndex ?? 0);

  if (scraper === 'privy') {
    console.log('Filter Cycle:', FILTER_NAMES[progress.filterCycleIndex || 0]);
    console.log('Filter Index:', progress.filterCycleIndex || 0);
  }

  const completed = progress.completedStates || progress.processedCities || [];
  console.log('Completed States:', completed.length, '/', ALL_STATES.length);
  if (completed.length > 0 && completed.length <= 10) {
    console.log('  ->', completed.join(', '));
  } else if (completed.length > 10) {
    console.log('  ->', completed.slice(0, 10).join(', '), '...');
  }

  const remaining = ALL_STATES.filter(s => !completed.includes(s));
  console.log('Remaining States:', remaining.length);
  if (remaining.length > 0 && remaining.length <= 10) {
    console.log('  ->', remaining.join(', '));
  } else if (remaining.length > 10) {
    console.log('  -> Next:', remaining.slice(0, 5).join(', '), '...');
  }

  console.log('Total Scraped:', progress.totalScraped || 0);
  console.log('Cycle Count:', progress.cycleCount || 0);
  console.log('Last Updated:', progress.updatedAt || 'never');
}

function showHelp() {
  console.log(`
UPDATE SCRAPER PROGRESS
=======================

USAGE:
  node update-scraper-progress.cjs <scraper> [field] [value]

VIEW STATUS:
  node update-scraper-progress.cjs privy      # View Privy progress
  node update-scraper-progress.cjs redfin     # View Redfin progress

CHANGE STATE:
  node update-scraper-progress.cjs privy currentState CA    # Start from California
  node update-scraper-progress.cjs redfin currentState TX   # Start from Texas
  node update-scraper-progress.cjs privy currentState NULL  # Clear (start from AL)

CHANGE CITY INDEX:
  node update-scraper-progress.cjs privy currentCityIndex 0   # Start from first city
  node update-scraper-progress.cjs privy currentCityIndex 50  # Skip to city #50

CHANGE FILTER (Privy only):
  node update-scraper-progress.cjs privy filterCycleIndex 0   # privy (buy_hold)
  node update-scraper-progress.cjs privy filterCycleIndex 1   # privy-Tear (scrape)
  node update-scraper-progress.cjs privy filterCycleIndex 2   # privy-flip (flip)

MANAGE COMPLETED STATES:
  node update-scraper-progress.cjs privy addCompleted AL      # Mark AL as done
  node update-scraper-progress.cjs privy removeCompleted CA   # Unmark CA (will re-scrape)
  node update-scraper-progress.cjs privy completedStates []   # Clear all (start fresh)

FULL RESET:
  node update-scraper-progress.cjs privy reset    # Reset Privy to beginning
  node update-scraper-progress.cjs redfin reset   # Reset Redfin to beginning

STATE CODES:
  AL, AK, AZ, AR, CA, CO, CT, DE, FL, GA, HI, ID, IL, IN, IA,
  KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NH, NJ,
  NM, NY, NC, ND, OH, OK, OR, PA, RI, SC, SD, TN, TX, UT, VT,
  VA, WA, WV, WI, WY, DC
`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
