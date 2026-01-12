import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import connectDB from './db/db.js';
import { log } from './utils/logger.js';
import { ensureMasterAdmin } from './utils/ensureMasterAdmin.js';
import agentOffersRoutes from './routes/agent_offers.js';
import mongoose from 'mongoose';

dotenv.config();

// Disable mongoose buffering globally BEFORE any models are loaded
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 30000);

const L = log.child('server');
// ---- Boot Janitor: free disk space from stale Puppeteer artifacts ----
// Enabled by default in production. Disable with DISK_JANITOR=0.
const JANITOR_ENABLED = process.env.DISK_JANITOR !== '0';
const JANITOR_MAX_AGE_HOURS = Number(process.env.DISK_JANITOR_MAX_AGE_HOURS || 1); // Reduced to 1 hour for aggressive cleanup
const JANITOR_INTERVAL_MIN = Number(process.env.DISK_JANITOR_INTERVAL_MIN || 10); // Run every 10 minutes
const PUPPETEER_DIR = process.env.PUPPETEER_CACHE_DIR || (process.platform === 'linux' ? '/var/data/puppeteer' : path.resolve(process.cwd(), '.puppeteer-cache'));
const VAR_DATA_DIR = '/var/data'; // Persistent storage on Render
const DISK_WARN_THRESHOLD_MB = Number(process.env.DISK_WARN_THRESHOLD_MB || 400); // Warn at 400MB of 512MB

async function safeRm(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
    L.info('Janitor: removed', { path: p });
  } catch (e) {
    L.warn('Janitor: remove failed', { path: p, error: e.message });
  }
}

function isOldStat(stat, maxAgeHours) {
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

// Get directory size in MB
async function getDirSizeMB(dirPath) {
  try {
    let totalSize = 0;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dirPath, ent.name);
      try {
        if (ent.isDirectory()) {
          totalSize += await getDirSizeMB(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      } catch { /* skip inaccessible */ }
    }
    return totalSize / (1024 * 1024); // Convert to MB
  } catch {
    return 0;
  }
}

// Aggressive cleanup when disk is critically full
async function emergencyCleanup() {
  L.warn('Janitor: EMERGENCY CLEANUP - Disk space critical!');

  // 1) Remove ALL puppeteer profiles (except chrome binary)
  try {
    const entries = await fs.readdir(PUPPETEER_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === 'chrome') continue; // Keep browser binary
      await safeRm(path.join(PUPPETEER_DIR, ent.name));
    }
  } catch { /* dir may not exist */ }

  // 2) Clean ALL debug screenshots regardless of age
  const tmpDir = os.tmpdir();
  try {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      if (/^(puppeteer|pptr-|chrome-profile|privy-|bofa_debug|chase_debug|redfin|realtor_|movoto_|zillow_|wellsfargo-)/i.test(name)) {
        await safeRm(path.join(tmpDir, name));
      }
    }
  } catch { /* skip */ }

  // 3) Clean /var/data except essential files
  try {
    const entries = await fs.readdir(VAR_DATA_DIR, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      // Keep only essential: puppeteer/chrome binary, session files
      if (name === 'puppeteer') continue; // Will clean inside separately
      if (name.endsWith('-session.json')) continue; // Keep session files
      if (ent.isDirectory()) {
        // Clean directories older than 30 minutes
        const full = path.join(VAR_DATA_DIR, name);
        try {
          const st = await fs.stat(full);
          if (isOldStat(st, 0.5)) { // 30 minutes
            await safeRm(full);
          }
        } catch {
          await safeRm(full);
        }
      }
    }
  } catch { /* /var/data may not exist */ }

  L.info('Janitor: Emergency cleanup complete');
}

async function janitorOnce() {
  if (!JANITOR_ENABLED) return;

  try {
    // Check disk usage first - if critical, do emergency cleanup
    const varDataSize = await getDirSizeMB(VAR_DATA_DIR);
    const tmpSize = await getDirSizeMB(os.tmpdir());

    L.info('Janitor: Disk check', {
      varDataMB: varDataSize.toFixed(1),
      tmpMB: tmpSize.toFixed(1),
      threshold: DISK_WARN_THRESHOLD_MB
    });

    // Emergency cleanup if /var/data is over threshold
    if (varDataSize > DISK_WARN_THRESHOLD_MB) {
      await emergencyCleanup();
      return; // Emergency cleanup is aggressive, skip normal cleanup
    }

    // 1) Clean Puppeteer workspace: keep browser builds under "chrome/"
    // Remove stale ephemeral profiles like "*-profile-*", "user-data-dir*", "screenshots", "traces", etc.
    try {
      const entries = await fs.readdir(PUPPETEER_DIR, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(PUPPETEER_DIR, ent.name);
        // Keep the browser cache folder named "chrome"
        if (ent.isDirectory() && ent.name === 'chrome') continue;

        // Remove ALL non-chrome items (browser profiles are disposable)
        try {
          const st = await fs.stat(full);
          const oldEnough = isOldStat(st, JANITOR_MAX_AGE_HOURS);
          if (oldEnough) {
            await safeRm(full);
          }
        } catch {
          // If stat fails, try to remove anyway
          await safeRm(full);
        }
      }
    } catch (e) {
      L.debug('Janitor: puppeteer dir scan skipped', { dir: PUPPETEER_DIR, error: e.message });
    }

    // 2) Clean common temp locations (/tmp)
    try {
      const tmpDir = os.tmpdir();
      const tmpEntries = await fs.readdir(tmpDir, { withFileTypes: true });
      for (const ent of tmpEntries) {
        const name = ent.name;
        const full = path.join(tmpDir, name);
        // common puppeteer/chrome tmp prefixes
        const isPptrTmp = /^(puppeteer|puppeteer_dev|pptr-|chrome-profile|core\.)/i.test(name);
        // debug screenshot directories from scrapers
        const isDebugDir = /^(bofa_debug|chase_debug|redfin_value_debug|price_sync_debug)$/i.test(name);
        // debug screenshot files from scrapers (privy-*.png, realtor_*.png, etc.)
        const isDebugFile = /^(privy-|realtor_|movoto_|zillow_|wellsfargo-).*\.(png|html|txt)$/i.test(name);

        if (!isPptrTmp && !isDebugDir && !isDebugFile) continue;

        try {
          const st = await fs.stat(full);
          if (isOldStat(st, JANITOR_MAX_AGE_HOURS)) {
            await safeRm(full);
          }
        } catch {
          await safeRm(full);
        }
      }
    } catch (e) {
      L.debug('Janitor: tmp dir scan skipped', { error: e.message });
    }

    // 3) Clean debug screenshot directories (clean files inside, keep dirs)
    const debugDirs = [
      path.join(os.tmpdir(), 'bofa_debug'),
      path.join(os.tmpdir(), 'chase_debug'),
      path.join(os.tmpdir(), 'redfin_value_debug'),
      path.join(os.tmpdir(), 'price_sync_debug'),
    ];
    for (const dir of debugDirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          const full = path.join(dir, file);
          try {
            const st = await fs.stat(full);
            if (isOldStat(st, JANITOR_MAX_AGE_HOURS)) {
              await safeRm(full);
            }
          } catch {
            await safeRm(full);
          }
        }
      } catch {
        // dir doesn't exist, skip
      }
    }

    // 4) Clean /var/data persistent storage (Render's 512MB disk)
    try {
      const entries = await fs.readdir(VAR_DATA_DIR, { withFileTypes: true });
      for (const ent of entries) {
        const name = ent.name;
        const full = path.join(VAR_DATA_DIR, name);

        // Skip puppeteer dir (handled separately) and session files
        if (name === 'puppeteer') continue;
        if (name.endsWith('-session.json')) continue;

        // Clean old files/directories
        if (ent.isDirectory() || ent.isFile()) {
          try {
            const st = await fs.stat(full);
            if (isOldStat(st, JANITOR_MAX_AGE_HOURS)) {
              await safeRm(full);
            }
          } catch {
            await safeRm(full);
          }
        }
      }
    } catch (e) {
      L.debug('Janitor: /var/data scan skipped', { error: e.message });
    }
  } catch (e) {
    L.warn('Janitor: run failed', { error: e.message });
  }
}

// Run once at boot (default). Optionally run on an interval if configured.
(async () => {
  await janitorOnce();
  if (JANITOR_INTERVAL_MIN > 0) {
    const ms = JANITOR_INTERVAL_MIN * 60 * 1000;
    setInterval(janitorOnce, ms).unref();
    L.info('Janitor: scheduled', { everyMinutes: JANITOR_INTERVAL_MIN });
  } else {
    L.info('Janitor: ran once at boot', { enabled: JANITOR_ENABLED, maxAgeHours: JANITOR_MAX_AGE_HOURS });
  }
})();
// ---- End Boot Janitor ----
const app = express();
const PORT = Number(process.env.PORT || 3015);

// Global variable to store the actual bound port (may differ from PORT if port is in use)
global.__ACTUAL_PORT__ = PORT;
const IS_WORKER = ['1','true','yes','on'].includes(String(process.env.AUTOMATION_WORKER || '').toLowerCase());

import userRoutes from './routes/users.js';
import automationRoutes from './routes/automation/automation.js';
import automationStatusRoutes from './routes/automation/status.js'
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import emailRoutes from './routes/email.js';
import floodRoute from './routes/flood.js';
import automationServiceRoutes from './routes/automation/automationService.js';
import dashboardRoutes from './routes/dashboard.js';
import liveScrapeRoutes from './routes/live-scrape.js';
import bofaRoutes from './routes/bofa.js';
import scrapedDealsRoutes from './routes/scraped-deals.js';
import autoFetchRoutes from './routes/auto-fetch.js';
import wellsfargoRoutes from './routes/wellsfargo.js';
import enrichRedfinAgentRoutes from './routes/enrich-redfin-agent.js';
import agentLookupRoutes from './routes/agent-lookup.js';

// Global guards: never crash the process; log and continue
process.on('warning', (w) => {
  L.warn('Node warning', { name: w.name, message: w.message, stack: w.stack });
});
process.on('unhandledRejection', (reason) => {
  L.error('Unhandled promise rejection', { reason: (reason && reason.message) || String(reason) });
});
process.on('uncaughtException', (err) => {
  L.error('Uncaught exception', { error: err.message, stack: err.stack });
});

// Graceful stop for background cron

// Graceful shutdown: close HTTP server and Mongo connection
let httpServer = null;
async function shutdown(signal) {
  try {
    L.info('Shutting down on signal', { signal });
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      L.info('HTTP server closed');
    }
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      L.info('MongoDB connection closed');
    }
  } catch (e) {
    L.warn('Shutdown encountered issues', { error: e?.message });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const envOrigins = [
  process.env.CORS_ORIGIN,
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
  process.env.FRONTEND_URL,
  ...(process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',') : []),
]
  .map(v => (v || '').trim())
  .filter(Boolean);

const whitelist = [
  ...envOrigins,                               // env-based (single or comma-separated)
  'https://deal-finder-six-green.vercel.app', // your prod Vercel domain
  /\.vercel\.app$/,                           // allow preview deploys (any *.vercel.app)
  /.onrender\.com$/,                          // render domains (api + previews)
  'http://localhost:3000',                    // local dev
  /^http:\/\/localhost:\d+$/,                 // any localhost port
  /^http:\/\/127\.0\.0\.1:\d+$/,              // loopback variants
];

const corsOptions = {
  origin(origin, cb) {
    // allow non-browser requests (no Origin), and whitelisted origins
    if (!origin || whitelist.some(w => w instanceof RegExp ? w.test(origin) : w === origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'X-Requested-With',
    'Accept',
  ],
  exposedHeaders: ['Content-Length'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight
app.use('/api', cors(corsOptions));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Vary', 'Origin');
  next();
});

// If behind a load balancer / reverse proxy (Railway, Render, Nginx, Cloudflare)
app.set('trust proxy', true);
app.disable('x-powered-by');

// Accept typical payloads comfortably
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Simple health check (no DB dependency to be fast)
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Root health for platforms that probe "/"
app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'deal-finder-api', ts: Date.now() });
});

const apiRoutes = express.Router();

// Mount sub-routers on apiRoutes FIRST (clear grouping)
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/user', userRoutes);
apiRoutes.use('/automation', automationRoutes);
apiRoutes.use('/automation/status', automationStatusRoutes);
apiRoutes.use('/automation/service', automationServiceRoutes);
apiRoutes.use('/properties', propertyRoutes);
apiRoutes.use('/live-scrape', liveScrapeRoutes);
apiRoutes.use('/bofa', bofaRoutes);
apiRoutes.use('/scraped-deals', scrapedDealsRoutes);
apiRoutes.use('/auto-fetch', autoFetchRoutes);
apiRoutes.use('/wellsfargo', wellsfargoRoutes);
// Non-API namespaces
app.use('/email', emailRoutes);

// Routes that live directly under /api (flood, plus the grouped apiRoutes)
app.use('/api', floodRoute);
app.use('/api', apiRoutes);
app.use('/api/agent-offers', agentOffersRoutes);
app.use('/api/enrich-redfin-agent', enrichRedfinAgentRoutes);
app.use('/api/agent-lookup', agentLookupRoutes);
// Dedicated dashboard prefix
app.use('/api/dashboard', dashboardRoutes);

// Start the server; connect to DB BEFORE starting server to avoid race conditions
if (!IS_WORKER) {
  const start = async (boundPort) => {
    // Connect to MongoDB FIRST before accepting any requests
    try {
      L.start('Connecting to MongoDB before starting server...');
      await connectDB();
      L.success('Database connected successfully');
      await ensureMasterAdmin();
    } catch (err) {
      L.error('Database connection failed', { error: err?.message || String(err) });
      L.warn('Server will start anyway, but authentication will not work');
    }

    // Now start the HTTP server
    httpServer = app
      .listen(boundPort, '0.0.0.0', () => {
        global.__ACTUAL_PORT__ = boundPort;
        L.start('Booting API server', { port: boundPort });
        L.success('Deal Finder API server running', { port: boundPort });
        L.info('API routes mounted', {
          routes: [
            '/healthz',
            '/email/*',
            '/api/auth/*',
            '/api/user/*',
            '/api/automation/*',
            '/api/automation/status/*',
            '/api/automation/service/*',
            '/api/properties/*',
            '/api (flood)',
            '/api/agent-offers/*',
            '/api/dashboard/*',
          ],
        });
        L.info('Base API endpoint', { url: `http://localhost:${boundPort}/api` });

        // Centralized concurrency log (single source via proxyManager)
        try {
          if (typeof getGlobalConcurrencyInfo === 'function') {
            getGlobalConcurrencyInfo().then(info => {
              if (info) {
                L.info('Global concurrency configured', info);
              }
            }).catch(() => {});
          }
        } catch {}
      })
      .on('error', (e) => {
        if (e && e.code === 'EADDRINUSE') {
          // Fall back to an ephemeral port instead of crashing
          const srv = app.listen(0, () => {
            const p = srv.address().port;
            global.__ACTUAL_PORT__ = p;
            L.warn('Port in use; rebound to random port', { requested: boundPort, actual: p });
          });
          httpServer = srv;
        } else {
          L.error('HTTP listen error', { error: e?.message || String(e) });
          throw e;
        }
      });
  };
  start(PORT);
} else {
  L.info('Worker mode detected — HTTP server not started');
  L.info('Importing runAutomation.js to bootstrap the alternating scheduler...');

  // Connect to MongoDB first
  (async () => {
    try {
      await connectDB();
      L.success('Database connected for worker mode');
    } catch (err) {
      L.error('Database connection failed in worker mode', { error: err?.message || String(err) });
    }

    // Import runAutomation.js - this will automatically bootstrap the scheduler
    // because AUTOMATION_WORKER=1 triggers the scheduler initialization at module load
    try {
      await import('./vendors/runAutomation.js');
      L.success('runAutomation.js imported - scheduler should be running');
    } catch (e) {
      L.error('Failed to import runAutomation.js', { error: e?.message || String(e) });
    }
  })();
}