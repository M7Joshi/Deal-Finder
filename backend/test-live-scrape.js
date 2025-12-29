// Test the live-scrape endpoint
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  // Start the server
  const { default: startServer } = await import('./server.js');

  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 5000));

  const port = global.__ACTUAL_PORT__ || process.env.PORT || 3015;
  console.log('Server running on port:', port);

  // Get auth token
  const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mcox@mioym.com', password: 'Mioym@2900#' })
  });
  const loginData = await loginRes.json();

  if (!loginData.token) {
    console.error('Login failed:', loginData);
    process.exit(1);
  }
  console.log('✅ Got auth token');

  // Call live-scrape endpoint for AL with limit 5
  console.log('🔍 Calling live-scrape for AL, limit 5...');
  const scrapeRes = await fetch(`http://localhost:${port}/api/live-scrape/privy?state=AL&limit=5`, {
    headers: { 'Authorization': `Bearer ${loginData.token}` }
  });

  const scrapeData = await scrapeRes.json();
  console.log('Response:', JSON.stringify(scrapeData, null, 2));

  process.exit(0);
}

test().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
