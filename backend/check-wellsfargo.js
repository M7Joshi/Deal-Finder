import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkWellsFargo() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Check ScrapedDeals with loanOfficer data (from Wells Fargo)
  const withLoanOfficer = await db.collection('scrapeddeals').countDocuments({
    loanOfficer: { $exists: true, $ne: null }
  });

  const withLoanOfficerEmail = await db.collection('scrapeddeals').countDocuments({
    'loanOfficer.email': { $exists: true, $ne: null, $ne: '' }
  });

  const withLoanOfficerPhone = await db.collection('scrapeddeals').countDocuments({
    'loanOfficer.phone': { $exists: true, $ne: null, $ne: '' }
  });

  const totalDeals = await db.collection('scrapeddeals').countDocuments();

  console.log('=== WELLS FARGO LOAN OFFICER DATA ===');
  console.log('Total records:', totalDeals);
  console.log('With loanOfficer field:', withLoanOfficer);
  console.log('With loanOfficer email:', withLoanOfficerEmail);
  console.log('With loanOfficer phone:', withLoanOfficerPhone);

  // Check for wellsfargo-specific fields
  const withWfData = await db.collection('scrapeddeals').countDocuments({
    $or: [
      { 'loanOfficer.nmls': { $exists: true, $ne: null } },
      { wellsFargoFetched: true },
      { wfFetchedAt: { $exists: true } }
    ]
  });

  console.log('');
  console.log('With Wells Fargo specific data:', withWfData);

  // Get sample record with loan officer
  const sample = await db.collection('scrapeddeals')
    .find({ loanOfficer: { $exists: true, $ne: null } })
    .sort({ scrapedAt: -1 })
    .limit(3)
    .toArray();

  console.log('');
  console.log('=== SAMPLE RECORDS WITH LOAN OFFICER ===');
  if (sample.length > 0) {
    sample.forEach(function(d, i) {
      console.log((i+1) + '. ' + (d.fullAddress || '').substring(0, 40) + '...');
      console.log('   Loan Officer:', JSON.stringify(d.loanOfficer));
    });
  } else {
    console.log('No records with loan officer data found');
  }

  // Check if there's a wellsfargo progress collection
  const wfProgress = await db.collection('scraperprogresses').findOne({
    $or: [
      { scraper: 'wellsfargo' },
      { scraper: 'wells-fargo' },
      { scraperName: 'wellsfargo' }
    ]
  });

  console.log('');
  console.log('=== WELLS FARGO SCRAPER PROGRESS ===');
  if (wfProgress) {
    console.log('Progress found:', JSON.stringify(wfProgress, null, 2));
  } else {
    console.log('No Wells Fargo progress record found');
  }

  // Check how many addresses are pending Wells Fargo fetch
  // (addresses that have AMV but no loan officer data)
  const pendingWf = await db.collection('scrapeddeals').countDocuments({
    amv: { $gt: 0 },
    $or: [
      { loanOfficer: { $exists: false } },
      { loanOfficer: null }
    ]
  });

  console.log('');
  console.log('=== PENDING WELLS FARGO FETCH ===');
  console.log('Addresses with AMV but no loan officer:', pendingWf);

  await mongoose.disconnect();
}

checkWellsFargo().catch(function(e) { console.error(e.message); process.exit(1); });
