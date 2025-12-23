// start-combined.js
// Runs both API server and automation worker in a single process

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[Combined] Starting API server and Automation worker...');

// Start API server (AUTOMATION_WORKER=0)
const api = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, AUTOMATION_WORKER: '0' },
  stdio: 'inherit'
});

// Give API a moment to start, then start worker
setTimeout(() => {
  console.log('[Combined] Starting automation worker...');

  // Start Worker (AUTOMATION_WORKER=1)
  const worker = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, AUTOMATION_WORKER: '1' },
    stdio: 'inherit'
  });

  worker.on('exit', (code) => {
    console.log(`[Combined] Worker exited with code ${code}`);
  });
}, 5000);

api.on('exit', (code) => {
  console.log(`[Combined] API exited with code ${code}`);
  process.exit(code);
});

// Handle signals
process.on('SIGTERM', () => {
  console.log('[Combined] SIGTERM received, shutting down...');
  api.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('[Combined] SIGINT received, shutting down...');
  api.kill('SIGINT');
});
