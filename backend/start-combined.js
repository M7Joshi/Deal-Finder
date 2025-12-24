// start-combined.js
// Runs both API server and automation worker in a SINGLE process
// This ensures the stop signal works for both API and automation

import './server.js'; // Start API server (AUTOMATION_WORKER not set = API mode)

// Give API a moment to initialize, then import runAutomation to start the scheduler
setTimeout(async () => {
  console.log('[Combined] Starting automation scheduler in same process...');

  try {
    // Import runAutomation.js and manually start the scheduler
    // Since we're in the same process, control.abort will work!
    const { startSchedulerManually } = await import('./vendors/runAutomation.js');

    // Start the scheduler manually (since AUTOMATION_WORKER isn't set)
    startSchedulerManually();

    console.log('[Combined] Automation scheduler started in same process');
    console.log('[Combined] Stop button will now work for both API and automation!');
  } catch (e) {
    console.error('[Combined] Failed to start automation:', e.message);
  }
}, 3000);

// Handle signals
process.on('SIGTERM', () => {
  console.log('[Combined] SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Combined] SIGINT received, shutting down...');
  process.exit(0);
});
