import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Mustache from 'mustache';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usage: node check-db.js [test-email | send-email]
const args = process.argv.slice(2);
const testEmailMode = args.includes('test-email');
const sendEmailMode = args.includes('send-email');

async function check() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  if (testEmailMode) {
    await testEmailPreview(db);
    await mongoose.disconnect();
    return;
  }

  if (sendEmailMode) {
    await sendTestEmail(db);
    await mongoose.disconnect();
    return;
  }

  // Last 10 minutes
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

  const total = await db.collection('scrapeddeals').countDocuments();
  const pending = await db.collection('scrapeddeals').countDocuments({ amv: null });
  const withAmv = await db.collection('scrapeddeals').countDocuments({ amv: { $gt: 0 } });
  const notFound = await db.collection('scrapeddeals').countDocuments({ amv: -1 });

  // Last 10 mins stats
  const last10Total = await db.collection('scrapeddeals').countDocuments({ scrapedAt: { $gte: tenMinsAgo } });
  const last10Pending = await db.collection('scrapeddeals').countDocuments({ scrapedAt: { $gte: tenMinsAgo }, amv: null });

  console.log('=== ALL TIME ===');
  console.log('Total:', total, '| With AMV:', withAmv, '| Not Found (-1):', notFound, '| Pending:', pending);

  console.log('\n=== LAST 10 MINUTES ===');
  console.log('New addresses:', last10Total, '| Pending AMV:', last10Pending);

  // Check scraper progress
  const progress = await db.collection('scraperprogresses').findOne({ scraper: 'redfin' });
  if (progress) {
    console.log('\n=== REDFIN PROGRESS ===');
    console.log('Current State:', progress.currentState || 'Not started');
    console.log('State Index:', progress.currentStateIndex || 0, '/ 41');
    console.log('Cities Processed:', (progress.processedCities || []).length);
    console.log('Total Scraped:', progress.totalScraped || 0);
    console.log('Last Updated:', progress.updatedAt ? new Date(progress.updatedAt).toLocaleString() : 'Never');
  } else {
    console.log('\n=== REDFIN PROGRESS ===');
    console.log('No progress record yet (fresh start)');
  }

  // Last 10 records
  const recentRecords = await db.collection('scrapeddeals').find().sort({ scrapedAt: -1 }).limit(10).toArray();
  if (recentRecords.length > 0) {
    console.log('\n=== 10 MOST RECENT ===');
    recentRecords.forEach(d => {
      const amvDisplay = d.amv === -1 ? 'NOT FOUND' : (d.amv > 0 ? '$' + d.amv.toLocaleString() : 'pending');
      const time = d.scrapedAt ? new Date(d.scrapedAt).toLocaleTimeString() : '?';
      console.log(` [${time}] ${(d.fullAddress || '').substring(0,40)} | AMV: ${amvDisplay}`);
    });
  }

  await mongoose.disconnect();
}

async function testEmailPreview(db) {
  console.log('=== EMAIL TEST PREVIEW ===\n');

  // Get the subadmin
  const subadmin = await db.collection('users').findOne({ email: 'mioymopt@gmail.com' });

  if (!subadmin) {
    console.log('ERROR: Subadmin mioymopt@gmail.com not found!');
    return;
  }

  // Test property data
  const listPrice = 135000;
  const amv = 543250;
  const lp80 = Math.round(listPrice * 0.80);
  const amv40 = Math.round(amv * 0.40);
  const offerPrice = Math.min(lp80, amv40);

  console.log('--- SENDER INFO ---');
  console.log('From:', subadmin.full_name || subadmin.name || 'mioymopt');
  console.log('Email:', subadmin.email);
  console.log('Email Enabled:', subadmin.email_enabled !== false ? 'YES' : 'NO');
  console.log('');

  console.log('--- SMTP CONFIG ---');
  console.log('Host:', subadmin.smtp_host || 'NOT CONFIGURED');
  console.log('Port:', subadmin.smtp_port || 587);
  console.log('User:', subadmin.smtp_user || 'NOT SET');
  console.log('Pass:', subadmin.smtp_pass ? '****' + subadmin.smtp_pass.slice(-4) : 'NOT SET');
  console.log('Secure:', subadmin.smtp_secure ? 'YES (port 465)' : 'NO (port 587 TLS)');
  console.log('');

  console.log('--- EMAIL PREVIEW ---');
  console.log('TO: manavjoshi1720@gmail.com');
  console.log('FROM:', (subadmin.full_name || 'mioymopt') + ' <' + subadmin.email + '>');
  console.log('SUBJECT: Offer to Purchase — 210 4th Ave NW');
  console.log('');
  console.log('Date:', new Date().toISOString().slice(0, 10));
  console.log('Agent Name: Manav Joshi');
  console.log('Property Address: 210 4th Ave NW');
  console.log('');
  console.log('List Price: $' + listPrice.toLocaleString());
  console.log('80% of LP: $' + lp80.toLocaleString());
  console.log('AMV: $' + amv.toLocaleString());
  console.log('40% of AMV: $' + amv40.toLocaleString());
  console.log('');
  console.log('>>> OFFER PRICE: $' + offerPrice.toLocaleString() + ' (lower of LP80 and AMV40)');
  console.log('>>> EMD: $5,000');
  console.log('>>> Terms: As-is, cash, 7-10 day close');
  console.log('');

  if (!subadmin.smtp_host || !subadmin.smtp_pass) {
    console.log('WARNING: SMTP not fully configured! Email will not send.');
  } else {
    console.log('READY: SMTP is configured. Run "node check-db.js send-email" to actually send.');
  }
}

async function sendTestEmail(db) {
  console.log('=== SENDING TEST EMAIL (Professional Template) ===\n');

  const subadmin = await db.collection('users').findOne({ email: 'mioymopt@gmail.com' });

  if (!subadmin) {
    console.log('ERROR: Subadmin not found!');
    return;
  }

  if (!subadmin.smtp_host || !subadmin.smtp_pass) {
    console.log('ERROR: SMTP not configured!');
    return;
  }

  // Test property data
  const propertyAddress = '210 4th Ave NW';
  const agentName = 'Manav Joshi';
  const listPrice = 135000;
  const amv = 543250;
  const lp80 = Math.round(listPrice * 0.80);
  const amv40 = Math.round(amv * 0.40);
  const offerPrice = Math.min(lp80, amv40);

  const transporter = nodemailer.createTransport({
    host: subadmin.smtp_host,
    port: subadmin.smtp_port || 587,
    secure: subadmin.smtp_secure || false,
    auth: {
      user: subadmin.smtp_user || subadmin.email,
      pass: subadmin.smtp_pass,
    },
  });

  // Load the professional HTML template
  const templatePath = path.join(__dirname, 'templates', 'agent_offer_v1.html');
  let htmlTemplate;
  try {
    htmlTemplate = await fs.readFile(templatePath, 'utf8');
    console.log('Loaded professional template from:', templatePath);
  } catch (err) {
    console.error('ERROR: Could not load template:', err.message);
    return;
  }

  // Render template with Mustache
  const htmlBody = Mustache.render(htmlTemplate, {
    property_address: propertyAddress,
    agent_name: agentName,
    offer_price: '$' + offerPrice.toLocaleString(),
  });

  const fromName = subadmin.full_name || 'Mioym Deal Finder';
  const textBody = `OFFER TO PURCHASE

Property: ${propertyAddress}
Agent: ${agentName}
Offer Price: $${offerPrice.toLocaleString()}
EMD: $1,000 (within 5 days of acceptance)
Financing: Hard Money
Condition: AS IS
Due Diligence: 15 days
Closing: 30 days

Buyer: MIOYM Properties c/o Marc Cox
Phone: 347-247-7293

Attorney: Krisslaw Atlantic - Susan Makin
Phone: 617-431-2011
Email: Susan@KrisslawAtlantic.com`;

  try {
    console.log('Sending to: manavjoshi1720@gmail.com');
    console.log('From:', fromName, '<' + subadmin.email + '>');
    console.log('Using: Professional HTML Template');

    const info = await transporter.sendMail({
      to: 'manavjoshi1720@gmail.com',
      from: `${fromName} <${subadmin.email}>`,
      replyTo: subadmin.email,
      subject: `Offer to Purchase — ${propertyAddress}`,
      html: htmlBody,
      text: textBody,
    });

    console.log('\n*** SUCCESS! Email sent with professional template ***');
    console.log('Message ID:', info.messageId);

    // Disable email after sending
    await db.collection('users').updateOne(
      { email: 'mioymopt@gmail.com' },
      { $set: { email_enabled: false } }
    );
    console.log('\nEmail disabled for mioymopt@gmail.com (as requested)');

  } catch (err) {
    console.error('\n*** FAILED to send email ***');
    console.error('Error:', err.message);
  }
}

check().catch(e => { console.error(e.message); process.exit(1); });
