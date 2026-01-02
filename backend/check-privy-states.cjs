const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Get all states list
  const allStates = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
    'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY'
  ];

  const progress = await db.collection('scraperprogresses').findOne({ scraper: 'privy' });
  const processed = new Set(progress.processedCities || []);

  console.log('=== Privy States Analysis ===');
  console.log('Total states:', allStates.length);
  console.log('Processed states:', processed.size);
  console.log('Current state index:', progress.currentStateIndex);
  console.log('Last state:', progress.lastState);
  console.log('Last updated:', progress.updatedAt);
  console.log('');
  console.log('Missing states:');
  const missing = allStates.filter(s => !processed.has(s));
  missing.forEach(s => console.log('  -', s));
  console.log('');
  console.log('Total missing:', missing.length);

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
