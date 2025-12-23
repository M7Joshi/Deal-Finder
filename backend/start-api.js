// Start API server only (no automation workers)
process.env.AUTOMATION_WORKER = '0';
process.env.RUN_IMMEDIATELY = 'false';
process.env.DISABLE_SCHEDULER = '1';
process.env.PORT = process.env.PORT || '3015';

console.log('🚀 Starting API Server');
console.log('   - Port:', process.env.PORT);
console.log('   - Worker mode: DISABLED');
console.log('   - MongoDB:', process.env.MONGO_URI || 'mongodb://localhost:27017/deal_finder');
console.log('');

// Import and run the server
await import('./server.js');
