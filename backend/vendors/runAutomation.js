// --- Centralized JOB alias map (JOBS -> automations) ---
const JOB_ALIAS_MAP = Object.freeze({
  // numeric aliases
  '5': 'agent_offers',
  '6': 'amv_daemon',
  // canonical
  amv_daemon: 'amv_daemon',
  // human-friendly vendor aliases → home_valuations pipeline
  valuations: 'home_valuations',
  valuation: 'home_valuations',
  home_valuations: 'home_valuations',
  bofa: 'bofa',
  bankofamerica: 'bofa',
  boa: 'bofa',
  // ScrapedDeal AMV fetcher (for batch scheduler)
  scraped_deals_amv: 'scraped_deals_amv',
  'scraped-deals-amv': 'scraped_deals_amv',
  scrapeddeals_amv: 'scraped_deals_amv',
  chase: 'chase',
  // NEW agent-offers aliases
  agent_offers: 'agent_offers',
  'agent-offers': 'agent_offers',
  offers: 'agent_offers',
  // privy
  privy: 'privy',
  // redfin
  redfin: 'redfin',
  '4': 'redfin',
  // current_listings
  current_listings: 'current_listings',
  'current-listings': 'current_listings',
  listings: 'current_listings',
  // enrich_agent
  enrich_agent: 'enrich_agent',
  'enrich-agent': 'enrich_agent',
  enrichagent: 'enrich_agent',
  // amv daemon aliases
  amv: 'amv_daemon',
  'amv-recompute': 'amv_daemon',
  'amv_daemon': 'amv_daemon',
});
import runBofaJob from './bofa/bofaJob.js';
import runChaseJob from './chase/chaseJob.js';
// import getChaseValue from './chase/index.js';
// import { ensureChasePageSetup } from './chase/chase_automation.js';
// import searchPropertyByAddress, { CIRCUITS as HOMES_CIRCUITS } from './homes/homesBot.js';
import PrivyBot from './privy/privyBot.js';
import { ensurePrivySession } from './privy/auth/loginService.js';
import connectDB from '../db/db.js';
import { getPropertyByFullAddress, updateProperty, getPropertiesWithNoEmails, upsertPropertyFromFullAddress, parseUSFullAddress } from '../controllers/propertyController.js';
import { getRawProperties, updateRawPropertyStatus, updateRawProperty } from '../controllers/rawPropertyController.js';
import { ensureHealthyPool, precheckPaidProxyForUrl, cooldownPaidForService, isNetworkOrProxyError } from '../services/proxyManager.js';
import { log, logProxy, logPrivy, logCurrentListings } from '../utils/logger.js';
import { onOtpChange, getOtpState, resetOtpState } from '../state/otpState.js';
import { closeSharedBrowser } from '../utils/browser.js';
// import { ensureChasePageSetup as _ensureChaseSetupForPool } from './chase/chase_automation.js';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import ScrapedDeal from '../models/ScrapedDeal.js';
import { getPreferredChromeProxy, SERVICE_PROBE_URL } from '../services/proxyManager.js';
import { getVendorProxyPool, toProxyArg } from '../utils/proxyBuilder.js';
import { computeAMV as computePropertyAMV } from '../models/Property.js';

// import runEnrichAgents from './jobs/enrichAgents.js';
import runAgentOffers from './agent_offers.js';
// import runRedfin from './redfin/run.js';

// Resolve Redfin search queries: env JSON/CSV string -> default
function getRedfinQueries() {
  // Priority 1: JSON array in REDFIN_SEARCH_QUERIES_JSON
  try {
    const raw = process.env.REDFIN_SEARCH_QUERIES_JSON || '';
    if (raw && raw.trim().startsWith('[')) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((s) => String(s).trim()).filter(Boolean);
      }
    }
  } catch { /* ignore and fall through */ }

  // Priority 2: Simple comma/semicolon separated list in REDFIN_SEARCH_QUERIES
  try {
    const rawList = process.env.REDFIN_SEARCH_QUERIES || '';
    if (rawList.trim()) {
      const parts = rawList.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length) return parts;
    }
  } catch { /* ignore and fall through */ }

  // Fallback: single sensible default
  return ['Holtsville, NY'];
}

// ---- One-time setup + hygiene helpers for pooled pages ----
const _setupOnce = Object.create(null);
function setupOnce(name, page, setupFn) {
  try {
    if (!_setupOnce[name]) _setupOnce[name] = new WeakSet();
    const set = _setupOnce[name];
    if (!set.has(page)) {
      set.add(page);
      return setupFn(page);
    }
  } catch {}
  return Promise.resolve();
}
async function sanitizePage(page) {
  try {
    // Important: don't turn interception on here, and don't add any 'request' handler.
    // Vendors (chase/bofa/movoto) will own interception and filtering logic.

    // Drop any stale listeners (prevents stacking when pages are re-leased)
    page.removeAllListeners('request');
    page.removeAllListeners('response');
    page.removeAllListeners('framenavigated');

    // Guard unhandledrejection duplication within the page context
    await page.evaluate(() => {
      if (!window.__dedupeUnhandled) {
        window.__dedupeUnhandled = true;
        window.addEventListener('unhandledrejection', (ev) => {
          try { console.debug('[page] swallowed unhandledrejection', ev.reason); } catch {}
        });
      }
    }).catch(() => {});
  } catch {}
}


// ---- Paid proxy helpers (sticky where it helps) ----
async function getServiceProxy(service, { sticky = false, key = null } = {}) {
  const testUrl = SERVICE_PROBE_URL[String(service || '').toLowerCase()] || undefined;
  const info = await getPreferredChromeProxy({
    service,
    preferPaid: true,
    testUrl,
    sticky,
    key
  });
  if (!info?.arg) throw new Error(`NO_PROXY_FOR_${String(service || 'unknown').toUpperCase()}`);
  return info;
}

// ---- Lightweight vendor cooldown helpers (wrappers used by vendor bots) ----
export function markVendorCooldown(service, ms = 10 * 60 * 1000) {
  try {
    cooldownPaidForService(service, ms);
  } catch {}
}

export async function waitForVendorCooldown(service, { timeoutMs = 10 * 60 * 1000, intervalMs = 5000 } = {}) {
  const url = SERVICE_PROBE_URL[String(service || '').toLowerCase()] || undefined;
  if (!url) return;
  const start = Date.now();
  for (;;) {
    const ok = await precheckPaidProxyForUrl(url, { timeout: 2500 }).catch(() => false);
    if (ok) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Re-export transient error classifier for vendor modules that import from runAutomation
export { isNetworkOrProxyError } from '../services/proxyManager.js';

// Also export getServiceProxy so vendor modules can obtain sticky paid proxies
export { getServiceProxy };


// ---- AMV helpers (fresh-in-run only) ----
// const __amvComputedThisRun = new Set();

const num = (x) => (Number.isFinite(x) ? x : null);
function cleanNumber(n) {
  if (typeof n === 'number') return Number.isFinite(n) ? n : null;
  if (typeof n === 'string') {
    const m = n.replace(/[^0-9.\-]/g, '');
    const v = Number(m);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function meanOfAvailable(values = []) {
  const arr = values.map(cleanNumber).filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
// const median = (arr) => {
//   const a = [...arr].sort((x, y) => x - y);
//   const n = a.length;
//   return n % 2 ? a[(n - 1) / 2] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2);
// };


const IS_WORKER = process.env.AUTOMATION_WORKER === '1';

const svc = (process.env.SERVICE_NAME || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || 'default');
const LOCK_PATH = process.env.AUTOMATION_LOCK_FILE || `/tmp/automation.${svc}.lock`;
const STALE_MS = Number(process.env.AUTOMATION_LOCK_STALE_MS || 10 * 60 * 1000); // default 10m


function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      try {
        const st = fs.statSync(LOCK_PATH);
        if (Date.now() - st.mtimeMs > STALE_MS) fs.unlinkSync(LOCK_PATH);
      } catch {}

      if (fs.existsSync(LOCK_PATH)) {
        const txt = fs.readFileSync(LOCK_PATH, 'utf8').trim();
        const pid = Number(txt);
        if (Number.isFinite(pid) && pidAlive(pid)) return null; // live worker
        try { fs.unlinkSync(LOCK_PATH); } catch {}
      }
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
    log.info('Automation lock acquired', { pid: process.pid, path: LOCK_PATH });
    return () => { try { fs.unlinkSync(LOCK_PATH); log.info('Automation lock released', { pid: process.pid, path: LOCK_PATH }); } catch {} };
  } catch {
    return null; // raced by another process
  }
}

let release = null;

// Light standby mode: if another worker holds the lock, idle and auto-promote
const STANDBY_POLL_MS = Number(process.env.AUTOMATION_STANDBY_POLL_MS || 5000);
const STANDBY_JITTER_MS = Number(process.env.AUTOMATION_STANDBY_JITTER_MS || 1500);

function randJitter(max) {
  return Math.floor(Math.random() * Math.max(0, Number(max) || 0));
}

function startStandbyWatcher() {
  log.warn('Another automation worker is already running (lock present). Standing by.', { path: LOCK_PATH, pollMs: STANDBY_POLL_MS });
  const timer = setInterval(() => {
    try {
      // If lock is stale, remove it to allow promotion
      if (fs.existsSync(LOCK_PATH)) {
        try {
          const st = fs.statSync(LOCK_PATH);
          if (Date.now() - st.mtimeMs > STALE_MS) {
            log.warn('Standby: detected stale lock — removing.', { path: LOCK_PATH, ageMs: Date.now() - st.mtimeMs, staleMs: STALE_MS });
            fs.unlinkSync(LOCK_PATH);
          }
        } catch {}
      }

      // Try to acquire the lock
      release = acquireLock();
      if (release) {
        clearInterval(timer);
        log.info('Standby: acquired lock — promoting to primary.', { pid: process.pid });
        // Install release hooks now that we are primary
        process.on('exit', () => { try { release(); } catch {} });
        process.on('SIGINT', () => { try { release(); } catch {}; process.exit(0); });
        process.on('SIGTERM', () => { try { release(); } catch {}; process.exit(0); });
        // Now bootstrap the scheduler
        bootstrapScheduler();
      }
    } catch (e) {
      log.warn('Standby watcher tick error', { error: e?.message || String(e) });
    }
  }, STANDBY_POLL_MS + randJitter(STANDBY_JITTER_MS));
}

// --- Cancellation / stop control ---
export const control = { abort: false };

// --- Global progress tracker ---
// Shared progress tracker object
const progressTrackerStats = {
  privyFound: 0,
  notMeetSpread: 0, 
  homeValuations: {
    totalJobs: 0,
    completedJobs: 0,
    bofaValued: 0,
  },
  privy: { totalJobs: 0, completedJobs: 0 },
  currentListings: { totalJobs: 0, completedJobs: 0 },
  currentListingsFound: 0,
};

export const progressTracker = {
  isRunning: false,
  stats: progressTrackerStats,
  lastRun: null,
  jobs: [],
  status: 'idle', // idle, running, completed, error
  error: null,
};
progressTracker.otp = null;

onOtpChange((otp) => {
  progressTracker.otp = otp;
  if (otp && progressTracker.status === 'running') {
    progressTracker.status = 'waiting_otp';
  } else if (!otp && progressTracker.status === 'waiting_otp') {
    progressTracker.status = progressTracker.isRunning ? 'running' : 'idle';
  }
});

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.floor(n));
}

class LocalQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.active = 0;
    this.queue = [];
  }

  add(task) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.active++;
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        } finally {
          this.active--;
          this._next();
        }
      };

      this.queue.push(run);
      this._next();
    });
  }

  _next() {
    if (this.active >= this.concurrency) return;
    const fn = this.queue.shift();
    if (fn) fn();
  }

  clear() {
    this.queue.length = 0;
  }
}


class ConcurrencyLimiter {
  constructor(limit = 1) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.active = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      const exec = async () => {
        this.active++;
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        } finally {
          this.active--;
          this._next();
        }
      };

      if (this.active < this.limit) {
        exec();
      } else {
        this.queue.push(exec);
      }
    });
  }

  _next() {
    if (this.active >= this.limit) return;
    const next = this.queue.shift();
    if (next) next();
  }

  clear() {
    this.queue.length = 0;
  }
}

// Single-file, shared mutex to serialize Privy logins (reduces OTP prompts)
const privyLoginMutex = new ConcurrencyLimiter(1);

const JOB_CONCURRENCY_ENV_MAP = {
  privy: 'PRIVY_CONCURRENCY',
  home_valuations: 'HOME_VALUATIONS_CONCURRENCY',
  current_listings: 'CURRENT_LISTINGS_CONCURRENCY',
  agent_offers: 'AGENT_OFFERS_CONCURRENCY',
  redfin: 'REDFIN_CONCURRENCY',
};

function resolveJobConcurrency(jobKey, jobs, fallback) {
  const envKey = JOB_CONCURRENCY_ENV_MAP[jobKey];
  if (envKey && Object.prototype.hasOwnProperty.call(process.env, envKey)) {
    const parsed = parsePositiveInt(process.env[envKey], fallback);
    if (parsed) return parsed;
  }
  return fallback;
}

let homeValuationsQueue = null;
let currentListingsQueue = null;
let currentGlobalLimiter = null;
// Resolve the original, user-requested jobs string and its source.
function getRequestedJobsRaw() {
  // Priority: explicit env.JOBS (if set) → CLI (--jobs=) → env.AUTOMATIONS → default
  const args = (process.argv || []);
  const cliArg = (args.find((a) => a.startsWith('--jobs=')) || '').split('=')[1] || '';
  if (Object.prototype.hasOwnProperty.call(process.env, 'JOBS')) {
    // If JOBS is present (even if empty), we *only* honor it per requirements.
    return { source: 'env:JOBS', raw: String(process.env.JOBS || '').trim() };
  }
  if (cliArg) return { source: 'cli:--jobs', raw: cliArg.trim() };
  if (Object.prototype.hasOwnProperty.call(process.env, 'AUTOMATIONS')) {
    return { source: 'env:AUTOMATIONS', raw: String(process.env.AUTOMATIONS || '').trim() };
  }
  return { source: 'default', raw: '' };
}

// --- Job selection (ENV/CLI) ---
const ALL_JOBS = ['privy', 'home_valuations', 'current_listings', 'agent_offers', 'redfin', 'bofa', 'chase', 'amv_daemon', 'scraped_deals_amv'];
const DEFAULT_JOBS = ['privy','home_valuations','amv_daemon'];

// Coerce any input (string/array/set) into a Set of valid job keys
function toJobSet(input) {
  const MAP = JOB_ALIAS_MAP;
  if (!input) return new Set(ALL_JOBS);
  // Convert Set to array and map through aliases
  if (input instanceof Set) {
    const list = Array.from(input)
      .map((s) => String(s).toLowerCase())
      .map((s) => MAP[s] || s) // Use alias if exists, otherwise keep original
      .filter((s) => ALL_JOBS.includes(s)); // Only keep valid jobs
    return new Set(list.length ? list : ALL_JOBS);
  }
  if (Array.isArray(input)) {
    const list = input
      .map((s) => String(s).toLowerCase())
      .map((s) => MAP[s] || null)
      .filter(Boolean);
    return new Set(list.length ? list : ALL_JOBS);
  }
  if (typeof input === 'string') {
    const list = input
      .split(/[\s,]+/)
      .map((s) => s.toLowerCase())
      .map((s) => MAP[s] || null)
      .filter(Boolean);
    return new Set(list.length ? list : ALL_JOBS);
  }
  return new Set(ALL_JOBS);
}

// Parse a raw jobs string into a concrete selection
function parseSelectedJobs(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return new Set(DEFAULT_JOBS);
  const list = raw
    .split(/[\s,]+/)
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean)
    .map((s) => {
      // First check alias map
      if (JOB_ALIAS_MAP[s]) return JOB_ALIAS_MAP[s];
      // Then check if it's a valid job directly
      if (ALL_JOBS.includes(s)) return s;
      // Log unknown job for debugging
      console.log(`[runAutomation] Unknown job alias: "${s}"`);
      return null;
    })
    .filter(Boolean);

  console.log('[runAutomation] parseSelectedJobs:', { raw, list });
  return new Set(list.length ? list : DEFAULT_JOBS);
}

// Resolve once at module init for bootstrap logging; scheduler will re-resolve each tick.
const __REQ = getRequestedJobsRaw();
const SELECTED_JOBS = parseSelectedJobs(__REQ.raw);

// --- Batch-based scheduler: Scrape addresses, then fetch AMV for all ---
// This prevents building up a huge backlog of addresses without AMV
const RUN_INTERVAL_MS = Number(process.env.RUN_INTERVAL_MS || 1 * 60 * 1000); // 1 minute between cycles
const SCRAPE_BATCH_LIMIT = Number(process.env.SCRAPE_BATCH_LIMIT || 500); // Max addresses to scrape before AMV (500 per source)
const DISABLE_SCHEDULER =
  String(process.env.DISABLE_SCHEDULER || '').toLowerCase() === '1' ||
  RUN_INTERVAL_MS <= 0;
let schedulerTimer = null;
let schedulerEnabled = !DISABLE_SCHEDULER;

// Track how many addresses scraped in current batch
let addressesScrapedThisBatch = 0;

// Check which scrapers are enabled based on SELECTED_JOBS
const PRIVY_ENABLED = SELECTED_JOBS.has('privy');
const REDFIN_ENABLED = SELECTED_JOBS.has('redfin') || SELECTED_JOBS.has('scraped_deals_amv');
const AMV_ENABLED = SELECTED_JOBS.has('bofa') || SELECTED_JOBS.has('scraped_deals_amv');

// Helper to determine the starting phase based on enabled jobs
function getStartingPhase() {
  if (PRIVY_ENABLED) return 'privy';
  if (REDFIN_ENABLED) return 'redfin';
  if (AMV_ENABLED) return 'bofa_after_redfin'; // Just run AMV if no scrapers
  return 'idle';
}

// Scheduler phases (moved here so getScraperStatus can reference it)
// Dynamically start with the first enabled phase
let schedulerPhase = getStartingPhase();

log.info('[Scheduler] Phase configuration:', {
  PRIVY_ENABLED,
  REDFIN_ENABLED,
  AMV_ENABLED,
  startingPhase: schedulerPhase,
  selectedJobs: Array.from(SELECTED_JOBS)
});

// Export for tracking
export function getScraperStatus() {
  return {
    phase: schedulerPhase,
    addressesScrapedThisBatch,
    scraperLimit: SCRAPER_LIMIT,
    breakMs: BREAK_MS,
    schedulerEnabled
  };
}

// Increment counter when address is scraped (called from Privy scraper)
export function incrementAddressCount() {
  addressesScrapedThisBatch++;
  // Log every 50 addresses for visibility
  if (addressesScrapedThisBatch % 50 === 0) {
    log.info(`[BatchCounter] Progress: ${addressesScrapedThisBatch}/${SCRAPE_BATCH_LIMIT} addresses scraped`);
  }
  return addressesScrapedThisBatch >= SCRAPE_BATCH_LIMIT;
}

// Check if we've hit the batch limit
export function shouldPauseScraping() {
  return addressesScrapedThisBatch >= SCRAPE_BATCH_LIMIT;
}

// Reset counter and phase after AMV phase completes (exported for clear-all endpoint)
export function resetBatchCounter() {
  addressesScrapedThisBatch = 0;
  schedulerPhase = getStartingPhase(); // Reset to start of cycle based on enabled jobs
}

function scheduleNextRun(delayMs = RUN_INTERVAL_MS) {
  try { if (schedulerTimer) clearTimeout(schedulerTimer); } catch {}
  if (!schedulerEnabled) {
    log.info('Scheduler disabled — next run will not be scheduled.');
    return;
  }
  schedulerTimer = setTimeout(schedulerTick, Math.max(0, delayMs));
}

async function bootstrapScheduler() {
  const immediate = process.env.RUN_IMMEDIATELY === 'true';

  // Log the batch-based scheduler configuration
  log.info('Scheduler bootstrap (BATCH MODE - scrape 100, then AMV)', {
    RUN_INTERVAL_MS,
    SCRAPE_BATCH_LIMIT,
    immediate,
    worker: true,
    startingPhase: schedulerPhase,
    disabled: DISABLE_SCHEDULER
  });

  if (DISABLE_SCHEDULER) {
    schedulerEnabled = false;
    log.info('Scheduler disabled — will not run.');
    return;
  }

  // Check if there are pending AMV addresses - if so, run immediately regardless of RUN_IMMEDIATELY setting
  try {
    await connectDB();
    const pendingAMV = await ScrapedDeal.countDocuments({
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    });
    if (pendingAMV > 0) {
      log.info('Scheduler bootstrap: Found pending AMV addresses, starting immediately', { pendingAMV });
      scheduleNextRun(0); // Start immediately
      return;
    }
  } catch (e) {
    log.warn('Scheduler bootstrap: Could not check pending AMV', { error: e?.message });
  }

  scheduleNextRun(immediate ? 0 : RUN_INTERVAL_MS);
}

// New Sequential Flow with 2-minute breaks:
// Step 1: Privy scrapes addresses → Save to Pending AMV
// Step 2: BofA fetches AMV for Privy addresses
// Step 3: 2 minute break
// Step 4: Redfin scrapes addresses → Save to Pending AMV
// Step 5: BofA fetches AMV for Redfin addresses
// Step 6: 2 minute break
// Step 7: Repeat from Step 1

// Break period between phases (2 minutes = 120000ms)
const BREAK_MS = Number(process.env.BREAK_MS || 120000);
const SCRAPER_LIMIT = Number(process.env.SCRAPER_LIMIT || 500);

async function schedulerTick() {
  if (!schedulerEnabled) return;

  // Ensure database is connected
  try {
    await connectDB();
  } catch (e) {
    log.error('Scheduler: Failed to connect to database', { error: e?.message });
    scheduleNextRun(10000);
    return;
  }

  if (isRunning) {
    log.info('Scheduler: a run is already in progress — will check again shortly.');
    return scheduleNextRun(5000);
  }

  // Check pending AMV count
  let pendingAMV = 0;
  try {
    pendingAMV = await ScrapedDeal.countDocuments({
      $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
    });
  } catch (e) {
    log.warn('Scheduler: Could not count pending AMV', { error: e?.message });
  }

  log.info('Scheduler: SEQUENTIAL FLOW', {
    phase: schedulerPhase,
    pendingAMV,
    breakMs: BREAK_MS,
    scraperLimit: SCRAPER_LIMIT
  });

  // If we have 100+ pending addresses, skip scraping and go straight to BofA
  if (pendingAMV >= SCRAPER_LIMIT && !schedulerPhase.startsWith('break') && !schedulerPhase.startsWith('bofa')) {
    log.info(`Scheduler: ${pendingAMV} pending addresses >= ${SCRAPER_LIMIT} - skipping to BofA phase`);
    schedulerPhase = 'bofa_after_redfin'; // Go to BofA processing (use redfin variant as it resets the cycle)
  }

  switch (schedulerPhase) {
    // ===== PRIVY CYCLE =====
    case 'privy': {
      log.info('Scheduler: Phase 1 - PRIVY scraping (target: 500 addresses)');
      try {
        await runAutomation(new Set(['privy']));
      } catch (e) {
        log.error('Scheduler: Privy threw', { error: e?.message || String(e) });
      }

      schedulerPhase = 'break_before_bofa_privy';
      log.info(`Scheduler: Privy done. Taking ${BREAK_MS / 1000}s break before BofA...`);
      scheduleNextRun(BREAK_MS);
      return;
    }

    case 'break_before_bofa_privy': {
      log.info('Scheduler: Break after Privy complete. Starting BofA for Privy addresses...');
      schedulerPhase = 'bofa_after_privy';
      scheduleNextRun(0);
      return;
    }

    case 'bofa_after_privy': {
      const currentPending = await ScrapedDeal.countDocuments({
        $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
      }).catch(() => 0);

      log.info(`Scheduler: BofA for Privy addresses (${currentPending} pending)`);

      if (currentPending > 0) {
        try {
          const amvJobs = new Set(['bofa', 'scraped_deals_amv']);
          await runAutomation(amvJobs);
        } catch (e) {
          log.error('Scheduler: BofA threw', { error: e?.message || String(e) });
        }
      }

      // Check if still pending - continue BofA if needed
      const stillPending = await ScrapedDeal.countDocuments({
        $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
      }).catch(() => 0);

      if (stillPending > 0) {
        log.info(`Scheduler: Still ${stillPending} pending - continuing BofA`);
        scheduleNextRun(5000);
        return;
      }

      schedulerPhase = 'break_after_privy';
      log.info(`Scheduler: BofA done for Privy. Taking ${BREAK_MS / 1000}s break before Redfin...`);
      scheduleNextRun(BREAK_MS);
      return;
    }

    case 'break_after_privy': {
      log.info('Scheduler: Break after Privy+BofA complete. Starting Redfin...');
      schedulerPhase = 'redfin';
      scheduleNextRun(0);
      return;
    }

    // ===== REDFIN CYCLE =====
    case 'redfin': {
      log.info('Scheduler: Phase 2 - REDFIN scraping (target: 500 addresses)');
      try {
        await runAutomation(new Set(['redfin']));
      } catch (e) {
        log.error('Scheduler: Redfin threw', { error: e?.message || String(e) });
      }

      schedulerPhase = 'break_before_bofa_redfin';
      log.info(`Scheduler: Redfin done. Taking ${BREAK_MS / 1000}s break before BofA...`);
      scheduleNextRun(BREAK_MS);
      return;
    }

    case 'break_before_bofa_redfin': {
      log.info('Scheduler: Break after Redfin complete. Starting BofA for Redfin addresses...');
      schedulerPhase = 'bofa_after_redfin';
      scheduleNextRun(0);
      return;
    }

    case 'bofa_after_redfin': {
      const currentPending = await ScrapedDeal.countDocuments({
        $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
      }).catch(() => 0);

      log.info(`Scheduler: BofA for Redfin addresses (${currentPending} pending)`);

      if (currentPending > 0) {
        try {
          const amvJobs = new Set(['bofa', 'scraped_deals_amv']);
          await runAutomation(amvJobs);
        } catch (e) {
          log.error('Scheduler: BofA threw', { error: e?.message || String(e) });
        }
      }

      // Check if still pending - continue BofA if needed
      const stillPending = await ScrapedDeal.countDocuments({
        $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
      }).catch(() => 0);

      if (stillPending > 0) {
        log.info(`Scheduler: Still ${stillPending} pending - continuing BofA`);
        scheduleNextRun(5000);
        return;
      }

      schedulerPhase = 'break_after_redfin';
      log.info(`Scheduler: BofA done for Redfin. Taking ${BREAK_MS / 1000}s break before next cycle...`);
      resetBatchCounter();
      scheduleNextRun(BREAK_MS);
      return;
    }

    case 'break_after_redfin': {
      const nextPhase = getStartingPhase();
      log.info(`Scheduler: Break after Redfin+BofA complete. Starting new cycle with ${nextPhase}...`);
      schedulerPhase = nextPhase;
      scheduleNextRun(0);
      return;
    }

    default: {
      const startPhase = getStartingPhase();
      log.warn('Scheduler: Unknown phase, resetting', { phase: schedulerPhase, startPhase });
      schedulerPhase = startPhase;
      scheduleNextRun(0);
      return;
    }
  }
}



// Normalize addresses to a stable key for de-duping/in-flight guards
function normalizeAddressKey(s = '') {
  let str = String(s).toLowerCase();

  str = str.replace(/\s+/g, ' ').trim();
  str = str.replace(/\b(apt|unit|ste|suite|lot|#)\b[^,]*/g, '');
  str = str.replace(/\b(\d{5})(-\d{4})\b/g, '$1');
  str = str.replace(/[^a-z0-9]/g, '');
  return str;
}

// Normalize an address object for vendor portals (USPS-ish light rules)
function normalizeAddressForVendors(property = {}) {
  const safe = (s) => (typeof s === 'string' ? s : '');
  const street = safe(property.street || property.address || '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let city = safe(property.city || '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Common locality synonyms → canonical city (extend as needed)
  const CITY_MAP = Object.freeze({
    'south side': 'pittsburgh',
    'southside': 'pittsburgh',
    'homestead': 'munhall',
    'mt lebanon': 'pittsburgh',
    'mt. lebanon': 'pittsburgh',
  });
  const k = city.toLowerCase();
  if (CITY_MAP[k]) city = CITY_MAP[k];

  // State → 2-letter uppercase
  let state = safe(property.state || '')
    .replace(/[^a-z]/gi, '')
    .slice(0, 2)
    .toUpperCase();

  // ZIP → 5 digit
  let zip = safe(property.zip || property.postal || '')
    .match(/\d{5}/)?.[0] || '';

  // Street suffix normalization (very small set; extend if needed)
  const SUFFIX = Object.freeze({
    ST: 'ST', STREET: 'ST', RD: 'RD', ROAD: 'RD', AVE: 'AVE', AVENUE: 'AVE',
    BLVD: 'BLVD', BOULEVARD: 'BLVD', DR: 'DR', DRIVE: 'DR', LN: 'LN', LANE: 'LN',
    CT: 'CT', COURT: 'CT', HWY: 'HWY', HIGHWAY: 'HWY'
  });
  const streetParts = street.split(' ');
  if (streetParts.length > 1) {
    const last = streetParts[streetParts.length - 1].toUpperCase();
    if (SUFFIX[last]) streetParts[streetParts.length - 1] = SUFFIX[last];
  }
  const normalizedStreet = streetParts.join(' ');

  // Build a normalized full address string vendors like to see
  const normalizedFullAddress = [normalizedStreet, city, state, zip]
    .filter(Boolean)
    .join(', ');

  return {
    ...property,
    street: normalizedStreet,
    city,
    state,
    zip,
    fullAddress: normalizedFullAddress || property.fullAddress || '',
    _normalizedForVendors: true,
  };
}


// Canonicalize a full address string for property lookups and upserts
function canonicalizeFullAddress(s = '') {
  return String(s)
    .replace(/\s*\(.*?\)\s*/g, ' ')   // remove parenthetical like "(rear)"
    .replace(/\s*#.*?(,|$)/g, '$1')     // strip trailing unit markers like "#A"
    .replace(/\s+/g, ' ')
    .trim();
}

// Recompute AMV on-demand using whatever values are currently persisted (BofA only)
async function recomputeAMVIfPossible(key) {
  try {
    if (!key) return;

    let doc = null;
    let canon = null;

    // Support either ObjectId or fullAddress strings
    const isId = mongoose.isValidObjectId(String(key));
    if (isId) {
      try { doc = await Property.findById(String(key)).lean(); } catch {}
      if (!doc) return; // nothing to do
      canon = canonicalizeFullAddress(doc.fullAddress || '');
      if (!canon) return;
    } else {
      canon = canonicalizeFullAddress(String(key));
      if (!canon) return;
      // Try to fetch existing property by address
      doc = await getPropertyByFullAddress(canon);

      // If not found, attempt to upsert a minimal shell document from the parsed address
      if (!doc) {
        const parsed = parseUSFullAddress(canon);
        if (parsed) {
          try {
            await upsertPropertyFromFullAddress(canon, {
              address: parsed.address,
              city: parsed.city,
              state: parsed.state,
              zip: parsed.zip || ''
            });
            doc = await getPropertyByFullAddress(canon);
          } catch {}
        }
        // If still missing, bail without warning spam
        if (!doc) return;
      }
    }

    const bofa_value = Number.isFinite(doc.bofa_value) ? doc.bofa_value : null;
    const redfin_avm_value = Number.isFinite(doc.redfin_avm_value)
      ? doc.redfin_avm_value
      : null;

const amv = computePropertyAMV({ bofa_value, redfin_avm_value });
    if (!Number.isFinite(amv)) return;
          log.info("❌ AMV not computed (insufficient vendor values)", {
        address: canon,
        bofa_value,
        redfin_avm_value
      });



    const priceNum = Number(String(doc.price || '').replace(/[^0-9.\-]/g, ''));
    const deal = Number.isFinite(priceNum) ? (priceNum <= Math.round(0.50 * amv)) : false;

    await updateProperty(doc._id, { amv, deal });
    log.success('✅ AMV recomputed', { 
      address: canon,
      bofa_value,
      redfin_avm_value,
      amv,
      price: Number.isFinite(priceNum) ? priceNum : null,
      deal,
    });
  } catch (e) {
    log.warn('recomputeAMVIfPossible failed', { address: fullAddress, error: e?.message || String(e) });
  }
}

const seenKeysThisRun = new Set();
const inFlightKeysThisRun = new Set();
// Debounce AMV computation per address for this run
const amvComputedKeysThisRun = new Set();

process.on('warning', (w) => {
  log.warn('Node Warning', { name: w.name, message: w.message, stack: w.stack });
});

/**
 * Collapse duplicate unhandled rejections to prevent log storms (e.g., "Request is already handled!")
 * Logs the first occurrence immediately, then emits a compact summary for repeats within a short window.
 */
const _rejWindowMs = 4000;
const _rejCache = new Map(); // reasonStr -> { count, ts }

process.on('unhandledRejection', (reason) => {
  const key =
    (reason && (reason.stack || reason.message))
      ? (reason.stack || reason.message)
      : String(reason);

  const now = Date.now();
  const rec = _rejCache.get(key) || { count: 0, ts: now };
  rec.count += 1;
  rec.ts = now;
  _rejCache.set(key, rec);

  // Log first occurrence immediately
  if (rec.count === 1) {
    log.error('Unhandled promise rejection', { reason: key });
  }

  // Trailing summary for bursts
  setTimeout(() => {
    const cur = _rejCache.get(key);
    if (!cur) return;
    if (now === cur.ts && cur.count > 1) {
      log.warn('Suppressed repeated rejections', { reason: key, repeats: cur.count - 1 });
      _rejCache.delete(key);
    } else if (Date.now() - cur.ts > _rejWindowMs) {
      _rejCache.delete(key);
    }
  }, _rejWindowMs);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
});


async function guard(label, fn) {
  try {
    return await fn();
  } catch (e) {
    log.error(label + ' failed', { error: e?.message || String(e) });
    return null;
  }
}

let isRunning = false;
let maintainPoolHandle = null;

let __healthyPaidIPs = 0;

function recomputeGlobalConcurrency({ jobsCount = 1, needProxies = true } = {}) {
  const envConcurrency = parsePositiveInt(process.env.AUTOMATION_CONCURRENCY, 0); // 0 = unset
  const cap = Number(process.env.AUTOCONCURRENCY_CAP || 40);
  const multiplier = Number(process.env.AUTOCONCURRENCY_MULTIPLIER || 0.4);
  const autoConcurrency = Math.max(4, Math.min(Math.floor(__healthyPaidIPs * multiplier), cap));

  // NEW: global floor decoupled from initial warmup
  const globalFloor = parsePositiveInt(process.env.GLOBAL_CONCURRENCY, 0); // treat as minimum when set

  // If env sets a hard concurrency, use it; otherwise take max(floor, auto)
  const desired = envConcurrency || Math.max(globalFloor || 0, autoConcurrency);
  const effectiveConcurrency = needProxies ? Math.min(desired, cap) : desired;

  const fallbackPerJobConcurrency = Math.max(1, Math.floor(effectiveConcurrency / Math.max(1, jobsCount))) || 1;

  if (!currentGlobalLimiter) {
    currentGlobalLimiter = new ConcurrencyLimiter(effectiveConcurrency);
  } else {
    currentGlobalLimiter.limit = effectiveConcurrency; // live bump
  }

  const healthyPaidCount = (globalThis.proxyPool?.paidHealthy?.length ?? 0);
  log.info('Global concurrency configured', { envConcurrency, healthyPaidIPs: healthyPaidCount, autoConcurrency, effectiveConcurrency });  return { effectiveConcurrency, fallbackPerJobConcurrency };
}

async function runAutomation(jobsInput = SELECTED_JOBS) {
  control.abort = false;
  progressTracker.isRunning = true;
  progressTracker.status = 'running';
  progressTracker.lastRun = new Date().toISOString();
  progressTracker.jobs = Array.from(toJobSet(jobsInput));
  progressTrackerStats.notMeetSpread = 0;
  progressTracker.error = null;
  // Reset per-run counters
  progressTrackerStats.homeValuations.completedJobs = 0;
  progressTrackerStats.homeValuations.bofaValued = 0;
  // progressTrackerStats.homeValuations.movotoValued = 0;
  progressTrackerStats.currentListings.completedJobs = 0;
  progressTrackerStats.currentListingsFound = 0;
  progressTrackerStats.privy.completedJobs = 0;

  const jobs = toJobSet(jobsInput);
  const jobCount = Math.max(1, jobs.size);

  // Debug logging for job selection
  log.info('runAutomation: Jobs selected', {
    inputType: jobsInput instanceof Set ? 'Set' : Array.isArray(jobsInput) ? 'Array' : typeof jobsInput,
    inputRaw: jobsInput instanceof Set ? Array.from(jobsInput) : jobsInput,
    jobsResolved: Array.from(jobs),
    jobCount,
    hasScrapedDealsAmv: jobs.has('scraped_deals_amv'),
    hasBofa: jobs.has('bofa')
  });

  if (isRunning) {
    log.warn('runAutomation is already running. Skipping this execution.');
    return;
  }

  resetOtpState();
  progressTracker.otp = getOtpState();

  connectDB();

  // ---- Strong on-start proxy warmup (only if selected jobs need proxies) ----
  const needProxies = ['privy', 'current_listings', 'redfin', 'bofa'].some((j) => jobs.has(j));
  let count;
  if (needProxies) {
    try {
      logProxy.pool('Warming proxy pool… (preferring paid when configured)');
      const minWarm = parsePositiveInt(process.env.PROXY_WARM_MIN_HEALTHY, 12);
      count = await ensureHealthyPool({
        min: minWarm,
        sample: 800,
        concurrency: 60,
        timeout: 5000,
        preferPaidFirst: true
      });
      __healthyPaidIPs = typeof count === 'number' ? count : 0;
      logProxy.pool('Proxy pool warm', { healthy: count, preferPaidFirst: true });
      recomputeGlobalConcurrency({ jobsCount: 1, needProxies: true });
    } catch (e) {
      logProxy.warn('Proxy warmup failed (continuing anyway)', { error: e.message });
    }
  } else {
    logProxy.info('Skipping proxy warmup: no proxy-using jobs selected');
  }

  // (block removed - concurrency now computed after warmup and after top-up)

  // ---- Background maintenance loop (refresh every ~7 minutes) ----
  if (needProxies) {
    maintainPoolHandle = setInterval(() => {
      ensureHealthyPool({ min: 30, sample: 600, concurrency: 50, timeout: 4000 })
        .then((cnt) => { __healthyPaidIPs = Math.max(__healthyPaidIPs, typeof cnt === 'number' ? cnt : 0); logProxy.pool('Proxy pool maintained', { healthy: cnt }); })
        .catch((err) => logProxy.warn('Proxy maintenance failed', { error: err?.message || String(err) }));
    }, 7 * 60 * 1000);
  }

  isRunning = true; // Set the flag to true when the function starts
  const reqMeta = getRequestedJobsRaw();
  log.start('Starting automations…', {
    requestedJobs: reqMeta.raw,
    requestedSource: reqMeta.source,
    resolvedJobs: Array.from(jobs)
  });

  try {
    const tasks = [];

    // --- Privy in parallel ---
    if (jobs.has('privy')) {
      tasks.push((async () => {
        try {
          if (control.abort) { log.warn('Stop requested — skipping Privy scheduling'); return; }
// Auto-generate 50 states if PRIVY_STATES=ALL or empty
const rawStates = String(process.env.PRIVY_STATES || 'ALL').trim();
const maxStates = Math.max(1, Number(process.env.PRIVY_MAX_PARALLEL_STATES || 5));

const allStates = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
  'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY'
];

const stateList =
  rawStates === 'ALL'
    ? allStates
    : rawStates.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);

const serializeLogin = String(process.env.PRIVY_SERIALIZE_LOGIN || '1') !== '0';
const reuseSessionFlag = String(process.env.PRIVY_REUSE_SESSION || '1') !== '0';

// We process *all* states, in batches of `maxStates` (5 by default)
const selectedStates = stateList; // keep var for logs if needed

          // progress counters
          progressTrackerStats.privy.totalJobs = stateList.length;
          progressTrackerStats.privy.completedJobs = 0;

          // soft limiter (also clamped by your global limiter)
          const privyLimiter = new ConcurrencyLimiter(
            Math.max(1, parsePositiveInt(process.env.PRIVY_CONCURRENCY, Math.min(maxStates, stateList.length)))
          );

          // spread load across vendor pool (PAID_PROXIES_PRIVY → PAID_PROXIES)
          const vendorPool = getVendorProxyPool('privy') || [];
          let rr = 0;
          const nextProxyInfo = async (label) => {
            // prefer sticky getServiceProxy (health-checked) if available
            try {
              return await getServiceProxy('privy', { sticky: true, key: `privy-${label}` });
            } catch {
              // fallback to round-robin raw vendor entry
              if (!vendorPool.length) throw new Error('NO_PRIVY_PROXIES_AVAILABLE');
              const entry = vendorPool[rr++ % vendorPool.length]; // host:port:user:pass
              return toProxyArg(entry); // { arg, creds }
            }
          };

          logPrivy.start(`Running PrivyBot automation across ${stateList.length} state(s)…`, { states: stateList.slice(0, 10), note: 'showing first 10 for brevity' });

          const runOneState = async (stateCode, { mode = 'auto' } = {}) => {
            // Check for abort before processing each state
            if (control.abort) {
              logPrivy.warn(`Stop requested — skipping state ${stateCode}`);
              return;
            }
            const MAX_ATTEMPTS = Number(process.env.PRIVY_MAX_RETRIES || 3); // Increased from 2 to 3
            const RETRY_DELAY_MS = Number(process.env.PRIVY_RETRY_DELAY_MS || 5000); // Wait before retry
            let attempt = 0;
            while (attempt < MAX_ATTEMPTS) {
              if (control.abort) {
                logPrivy.warn(`Stop requested — aborting retries for ${stateCode}`);
                return;
              }
              attempt++;
              const proxyInfo = await nextProxyInfo(stateCode);
              // Use a persistent, per-state profile so device appears stable across runs
              const profileRoot = String(process.env.PRIVY_PROFILE_ROOT || '/var/lib/mioym/puppeteer/profiles');
              const useBrowserProfile = String(process.env.PRIVY_USE_BROWSER_PROFILE || 'true').toLowerCase() === 'true';
              const profileDir  = path.join(profileRoot, `privy-${stateCode}`);

              const privyBot = new PrivyBot({
                proxyInfo,
                stateFilter: stateCode === 'ALL' ? null : stateCode,
                profileDir,
                useBrowserProfile
              });

              // Defensive optional setter for reuseSessionFlag
              if (typeof privyBot.setReuseSession === 'function') {
                try { privyBot.setReuseSession(reuseSessionFlag); } catch {}
              }

            try {
              await privyBot.init();

                // Try to reuse an existing session first (no-op if method not present)
                let hasSession = false;
                if (typeof privyBot.loadPersistedSession === 'function') {
                  try { hasSession = await privyBot.loadPersistedSession(); } catch {}
                }
                if (!hasSession && typeof privyBot.trySession === 'function') {
                  try { hasSession = await privyBot.trySession(); } catch {}
                }

                // Mode handling:
                // - 'ensure': if no session, do a serialized login once and persist cookies.
                // - 'reuse': never trigger a fresh login; rely solely on existing cookies.
                // - 'auto' (default): prior behavior — try session and if missing, one serialized login.
                const mustEnsure = mode === 'ensure';
                const reuseOnly = mode === 'reuse';

                if (!hasSession) {
                  if (reuseOnly) {
                    logPrivy.warn(`PrivyBot(${stateCode}) reuse-only mode but no session present — skipping login.`);
                  } else {
                    const doLoginOnce = async () => {
                      // Double-check inside the critical section in case another bot just logged in
                      let ok = false;
                      if (typeof privyBot.trySession === 'function') {
                        try { ok = await privyBot.trySession(); } catch {}
                      }
                      if (!ok) {
                        await privyBot.login(); // if OTP required, it will happen here only once
                        if (typeof privyBot.persistSession === 'function') {
                          try { await privyBot.persistSession(); } catch {}
                        }
                      }
                    };
                    if (serializeLogin || mustEnsure) {
                      await privyLoginMutex.run(doLoginOnce);
                    } else {
                      await doLoginOnce();
                    }
                  }
                }

              logPrivy.info(`PrivyBot(${stateCode}) starting scrape…`);
              await privyBot.scrape({ state: stateCode, reuseSession: reuseSessionFlag }); // accept options in your bot
              logPrivy.success(`PrivyBot(${stateCode}) scrape finished.`);
              try { await privyBot.close(); } catch {}
              progressTrackerStats.privy.completedJobs += 1;
              progressTrackerStats.privyFound += 1;
              return;
            } catch (e) {
              const msg = e?.message || String(e);
              // Expanded error detection for auto-recovery
              const isRetryableError =
                /ERR_TUNNEL_CONNECTION_FAILED/i.test(msg) ||
                /ERR_CONNECTION_REFUSED/i.test(msg) ||
                /ERR_CONNECTION_RESET/i.test(msg) ||
                /ERR_CONNECTION_CLOSED/i.test(msg) ||
                /ERR_NETWORK_CHANGED/i.test(msg) ||
                /ERR_INTERNET_DISCONNECTED/i.test(msg) ||
                /ECONNREFUSED/i.test(msg) ||
                /ETIMEDOUT/i.test(msg) ||
                /ENOTFOUND/i.test(msg) ||
                /timeout/i.test(msg) ||
                /Navigation timeout/i.test(msg) ||
                /net::ERR_/i.test(msg) ||
                /live.*scrape/i.test(msg) ||
                /scrape.*error/i.test(msg) ||
                /session.*expired/i.test(msg) ||
                /login.*failed/i.test(msg) ||
                /Target closed/i.test(msg) ||
                /Protocol error/i.test(msg) ||
                /Page crashed/i.test(msg) ||
                isNetworkOrProxyError(e);

              logPrivy.warn(`PrivyBot(${stateCode}) attempt ${attempt}/${MAX_ATTEMPTS} failed`, {
                error: msg,
                isRetryable: isRetryableError,
                willRetry: isRetryableError && attempt < MAX_ATTEMPTS
              });

              try { await privyBot?.close?.(); } catch {}

              if (isRetryableError && attempt < MAX_ATTEMPTS) {
                cooldownPaidForService('privy', 10 * 60 * 1000);
                logPrivy.info(`PrivyBot(${stateCode}) waiting ${RETRY_DELAY_MS}ms before retry...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                continue; // retry with a rotated proxy
              }

              // If all retries failed, log but don't throw - continue with next state
              logPrivy.error(`PrivyBot(${stateCode}) all ${MAX_ATTEMPTS} attempts failed - skipping state`, { error: msg });
              progressTrackerStats.privy.completedJobs += 1; // Mark as "processed" even if failed
              return; // Don't throw - continue with other states
            }
            }
          };

          // --- Batch all states in groups of maxStates (5 at a time by default) ---
          for (let i = 0; i < stateList.length; i += maxStates) {
            // Check for abort before starting each batch
            if (control.abort) {
              logPrivy.warn('Stop requested — aborting Privy state batches');
              break;
            }
            // Check if batch limit reached - stop to allow AMV phase
            if (shouldPauseScraping()) {
              logPrivy.info(`Batch limit reached (${addressesScrapedThisBatch}/${SCRAPE_BATCH_LIMIT}) — stopping Privy to run BofA AMV phase`);
              break;
            }
            const chunk = stateList.slice(i, i + maxStates);
            logPrivy.info(`Running Privy batch ${i / maxStates + 1}`, { states: chunk });

            // 1) Ensure a logged-in session (cookies on disk + profile) using the first state in the batch
            const profileRoot = String(process.env.PRIVY_PROFILE_ROOT || '/var/lib/mioym/puppeteer/profiles');
            const ensureProxy = await nextProxyInfo(`batch-${i / maxStates + 1}`);
            try {
              await privyLoginMutex.run(async () => {
                try {
                  const useBrowserProfile = String(process.env.PRIVY_USE_BROWSER_PROFILE || 'true').toLowerCase() === 'true';
                  const seedProfileDir = useBrowserProfile ? path.join(profileRoot, 'privy-seed') : null;
                  await ensurePrivySession({
                    headless: true,
                    proxyInfo: ensureProxy,
                    profileDir: seedProfileDir,
                    reuseSession: true,
                  });
                  logPrivy.info('Privy session ensured for batch (cookies persisted)', { batch: i / maxStates + 1 });
                } catch (e) {
                  logPrivy.warn('ensurePrivySession failed (continuing to reuse attempt in workers)', { error: e?.message || String(e) });
                }
              });
            } catch {}

            // 2) Run the first state in 'ensure' mode (double-safety), then fan out the rest in 'reuse' mode.
            const [first, ...rest] = chunk;

            // Run the first one sequentially to avoid OTP storms and guarantee session for others
            if (first) {
              try {
                await currentGlobalLimiter.run(() => runOneState(first, { mode: 'ensure' }));
              } catch (e) {
                logPrivy.warn(`Privy first state in batch failed to ensure session (${first})`, { error: e?.message || String(e) });
              }
            }

            // FIXED: Run remaining states SEQUENTIALLY to avoid page conflicts
            // Multiple parallel states cause "detached Frame" errors because they share the same page
            for (const st of rest) {
              if (control.abort) {
                logPrivy.warn('Stop requested — skipping remaining states');
                break;
              }
              // Check batch limit after each state
              if (shouldPauseScraping()) {
                logPrivy.info(`Batch limit reached after state ${st} — pausing for AMV phase`);
                break;
              }
              try {
                await currentGlobalLimiter.run(() => runOneState(st, { mode: 'reuse' }));
              } catch (e) {
                logPrivy.warn(`State ${st} failed`, { error: e?.message || String(e) });
              }
            }

            logPrivy.success(`Privy batch ${i / maxStates + 1} complete`, {
              statesTried: chunk.length,
              completed: progressTrackerStats.privy.completedJobs
            });
          }

          logPrivy.success('Privy full 50-state cycle complete.', {
            totalStates: stateList.length,
            completed: progressTrackerStats.privy.completedJobs
          });
        } catch (error) {
          logPrivy.error('Error in Privy multi-state automation', { error: error.message, stack: error.stack });
        }
      })());
    } else {
      logPrivy.info('Privy job skipped (not selected)');
    }

    // Redfin (match Mac behavior: run the all-cities runner)
    if (jobs.has('redfin')) {
      tasks.push((async () => {
        try {
          if (control.abort) { log.warn('Stop requested — skipping Redfin'); return; }
          log.info('Running Redfin automation…');
          // Safe defaults for first runs / to punch through early 403s; override via env if needed
          if (!process.env.REDFIN_FORCE_RENDER) process.env.REDFIN_FORCE_RENDER = '1';
          if (!process.env.MAX_INDEX_PAGES_PER_CITY) process.env.MAX_INDEX_PAGES_PER_CITY = '1';
          if (!process.env.MAX_LISTINGS_PER_CITY) process.env.MAX_LISTINGS_PER_CITY = '10000';

          const { runAllCities } = await import('./redfin/runner.js');
          await runAllCities();
          log.success('Redfin automation finished.');
        } catch (e) {
          log.error('Error in Redfin automation', { error: e?.message || String(e) });
        }
      })());
    } else {
      log.info('Redfin job skipped (not selected)');
    }

    // --- ScrapedDeal AMV Fetcher: Get BofA AMV for ScrapedDeal entries without AMV ---
    // This runs during the AMV phase to enrich deals with valuations from BofA
    log.info('ScrapedDeal AMV: Checking if job should run...', {
      hasScrapedDealsAmv: jobs.has('scraped_deals_amv'),
      hasBofa: jobs.has('bofa'),
      allJobs: Array.from(jobs)
    });
    if (jobs.has('scraped_deals_amv') || jobs.has('bofa')) {
      tasks.push((async () => {
        try {
          log.info('ScrapedDeal AMV: Starting AMV fetching phase...');

          // Use same batch size and concurrency as RedfinFetcher page
          // Default to 10 parallel browsers for faster processing
          const BATCH_SIZE = Math.max(1, Number(process.env.SCRAPED_DEALS_AMV_BATCH || 100));
          const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.SCRAPED_DEALS_AMV_CONCURRENCY || 10)));
          log.info('ScrapedDeal AMV: Fetching AMV for deals without valuation...', { batchSize: BATCH_SIZE, concurrency: CONCURRENCY });

          // Find ScrapedDeal entries that don't have AMV yet
          const dealsNeedingAMV = await ScrapedDeal.find({
            $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
          })
            .sort({ scrapedAt: -1 })
            .limit(BATCH_SIZE)
            .lean();

          if (!dealsNeedingAMV.length) {
            log.info('ScrapedDeal AMV: No deals need AMV - all caught up!');
            return;
          }

          log.info(`ScrapedDeal AMV: Found ${dealsNeedingAMV.length} deals needing AMV`);

          // Import the same BofA lookup function used by /api/bofa/batch
          // This is the proven approach that RedfinFetcher uses
          const { lookupSingleAddressInternal } = await import('../routes/bofa-internal.js');

          let successCount = 0;
          let failCount = 0;
          let noDataCount = 0;

          // Process in chunks with concurrency (same as RedfinFetcher page)
          for (let i = 0; i < dealsNeedingAMV.length; i += CONCURRENCY) {
            if (control.abort) {
              log.warn('ScrapedDeal AMV: Stop requested - aborting');
              break;
            }

            const chunk = dealsNeedingAMV.slice(i, i + CONCURRENCY);
            log.info(`ScrapedDeal AMV: Processing chunk ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(dealsNeedingAMV.length / CONCURRENCY)}`, {
              chunkSize: chunk.length
            });

            // Process chunk in parallel (same as /api/bofa/batch)
            const chunkResults = await Promise.all(
              chunk.map(async (deal) => {
                try {
                  const result = await lookupSingleAddressInternal(deal.fullAddress);
                  return { deal, result };
                } catch (e) {
                  return { deal, result: { ok: false, error: e?.message } };
                }
              })
            );

            // Update database with results
            for (const { deal, result } of chunkResults) {
              if (result?.ok && result.amv && result.amv > 0) {
                // Calculate isDeal: AMV >= 2x LP AND AMV > $200,000
                const lp = deal.listingPrice || 0;
                const isDeal = lp > 0 && result.amv >= (lp * 2) && result.amv > 200000;

                await ScrapedDeal.updateOne(
                  { _id: deal._id },
                  {
                    $set: {
                      amv: result.amv,
                      bofaFetchedAt: new Date(),
                      isDeal: isDeal
                    }
                  }
                );
                successCount++;
                log.info(`ScrapedDeal AMV: ✓ ${deal.fullAddress?.slice(0, 40)}...`, {
                  amv: result.amv,
                  listingPrice: lp,
                  isDeal
                });
              } else if (result?.noDataFound) {
                // BofA has no data for this address - mark as checked
                await ScrapedDeal.updateOne(
                  { _id: deal._id },
                  {
                    $set: {
                      amv: -1, // Mark as "no data" so we don't retry
                      bofaFetchedAt: new Date(),
                      isDeal: false
                    }
                  }
                );
                noDataCount++;
                log.debug(`ScrapedDeal AMV: No BofA data for ${deal.fullAddress?.slice(0, 30)}`);
              } else {
                failCount++;
                log.warn(`ScrapedDeal AMV: ✗ ${deal.fullAddress?.slice(0, 30)}`, { error: result?.error });
              }
            }
          }

          log.success(`ScrapedDeal AMV: Completed. Success: ${successCount}, NoData: ${noDataCount}, Failed: ${failCount}`);
        } catch (e) {
          log.error('ScrapedDeal AMV: Error in automation', { error: e?.message || String(e) });
        }
      })());
    }

    // --- AMV Daemon: small, continuous batches every tick ---
    if (jobs.has('amv_daemon')) {
      tasks.push((async () => {
        try {
          const AMV_BATCH_LIMIT = Math.max(1, Number(process.env.AMV_BATCH_LIMIT || 500));
          const ONLY_MISSING = String(process.env.AMV_ONLY_MISSING || '0') === '1';
          const WATERMARK_FILE = process.env.AMV_WATERMARK_FILE || '/tmp/amv.watermark';

          // Load watermark (_id we processed up to)
          let lastId = null;
          try {
            if (fs.existsSync(WATERMARK_FILE)) {
              const raw = fs.readFileSync(WATERMARK_FILE, 'utf8').trim();
              if (mongoose.isValidObjectId(raw)) lastId = new mongoose.Types.ObjectId(raw);
            }
          } catch {}

          // Build query
          const q = {};
          if (ONLY_MISSING) {
            q.$or = [{ amv: { $exists: false } }, { amv: null }];
          }
          if (lastId) {
            q._id = { $gt: lastId };
          }

          // Fetch a batch in _id ascending order
          const batch = await Property
            .find(q, { _id: 1 })
            .sort({ _id: 1 })
            .limit(AMV_BATCH_LIMIT)
            .lean();

          if (!batch.length) {
            // Reset cycle so we start from the beginning next tick
            try { if (fs.existsSync(WATERMARK_FILE)) fs.unlinkSync(WATERMARK_FILE); } catch {}
            log.info('AMV daemon: reached end — cycle will restart next tick', { onlyMissing: ONLY_MISSING });
            return;
          }

          // Recompute this batch
          for (const doc of batch) {
            try {
              await recomputeAMVIfPossible(String(doc._id));
            } catch (e) {
              log.warn('AMV daemon: recompute failed for id', { id: String(doc._id), error: e?.message || String(e) });
            }
          }

          // Advance watermark to last processed document
          const last = batch[batch.length - 1]?._id;
          if (last) {
            try { fs.writeFileSync(WATERMARK_FILE, String(last), 'utf8'); } catch {}
          }

          log.info('AMV daemon batch done', {
            count: batch.length,
            limit: AMV_BATCH_LIMIT,
            onlyMissing: ONLY_MISSING,
            last: String(last || '')
          });
        } catch (e) {
          log.error('AMV daemon error', { error: e?.message || String(e) });
        }
      })());
    } else {
      log.info('AMV daemon skipped (not selected)');
    }

    // --- Home Valuations (AMV-only, no vendor scraping) ---
if (jobs.has('home_valuations')) {
  tasks.push((async () => {
    try {
      // Pull a broad set of raw properties we might want to re-check
      const statuses = ['scraped', 'pending', 'error', 'not_found'];
      const lists = await Promise.all(
        statuses.map(async (st) => (await guard(`getRawProperties(${st})`, () => getRawProperties(st))) || [])
      );
      const properties = lists.flat();

      // De-dupe by normalized address
      const seen = new Set();
      const unique = [];
      for (const doc of properties) {
        const obj = doc?.toObject?.() ? doc.toObject() : doc;
        const key = normalizeAddressKey(obj.fullAddress || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(obj);
      }

      log.info('Running Home Valuations (AMV-only)', {
        scraped: lists[0]?.length || 0,
        pending: lists[1]?.length || 0,
        error:   lists[2]?.length || 0,
        not_found: lists[3]?.length || 0,
        unique: unique.length,
      });

      progressTrackerStats.homeValuations.totalJobs = unique.length;
      progressTrackerStats.homeValuations.completedJobs = 0;

      // Reasonable parallel fanout without proxy/browsers
      const fanout = Math.max(1, parsePositiveInt(process.env.HOME_VALUATIONS_CONCURRENCY, 16));
      const queue = new LocalQueue({ concurrency: fanout });

      const logProgress = () => {
        const s = progressTrackerStats.homeValuations;
        const total = s.totalJobs || 1;
        log.info('Home Valuations progress (AMV-only)', {
          completed: s.completedJobs,
          total: s.totalJobs,
          percent: ((s.completedJobs / total) * 100).toFixed(1) + '%'
        });
      };

      const jobsAmv = unique.map((p) => queue.add(async () => {
        if (control.abort) return;
        try {
          const key = p?._id ? String(p._id) : canonicalizeFullAddress(p.fullAddress);
          await recomputeAMVIfPossible(key);
        } catch (e) {
          log.warn('AMV recompute failed', { address: p.fullAddress, error: e?.message || String(e) });
        } finally {
          progressTrackerStats.homeValuations.completedJobs += 1;
          logProgress();
        }
      }));

      await Promise.allSettled(jobsAmv);
      log.success('Home Valuations (AMV-only) complete.', {
        completed: progressTrackerStats.homeValuations.completedJobs,
        total: progressTrackerStats.homeValuations.totalJobs
      });
    } catch (error) {
      log.error('Error in Home Valuations (AMV-only)', { error: error.message });
    }
  })());
} else {
  log.info('Home Valuations job skipped (not selected)');
}


    // --- Current Listings in parallel ---
    if (jobs.has('current_listings')) {
      tasks.push((async () => {
        try {
          try {
            const topupHomes = await ensureHealthyPool({ min: 20, sample: 400, concurrency: 30, timeout: 4000 });
            logProxy.pool('Proxy pool top-up before Current Listings (Realtor)', { healthy: topupHomes });
          } catch (e) {
            logProxy.warn('Proxy top-up before Current Listings failed (continuing)', { error: e.message });
          }

          if (control.abort) { log.warn('Stop requested — skipping Current Listings scheduling'); return; }
          logCurrentListings.start('Queuing Realtor.com enrichment for properties with no agent_email…');
          const currentListings = await getPropertiesWithNoEmails(false);
          progressTrackerStats.currentListings.totalJobs = currentListings.length;
          progressTrackerStats.currentListings.completedJobs = 0;

          const { effectiveConcurrency, fallbackPerJobConcurrency } = recomputeGlobalConcurrency({ jobsCount: jobs.size || 1, needProxies: true });
          // Centralize per-automation concurrency for current listings
          const listingsConcurrency = resolveJobConcurrency('current_listings', jobs, fallbackPerJobConcurrency);
          logCurrentListings.info('Current Listings queue configured', {
            perJobConcurrency: listingsConcurrency,
            globalConcurrency: effectiveConcurrency,
          });
          // Run the dedicated Realtor queue for all properties
          const results = await runRealtorQueue(currentListings, { concurrency: listingsConcurrency });

          // Update progress tracker based on results
          progressTrackerStats.currentListings.completedJobs = currentListings.length;
          const foundCount = Array.isArray(results)
            ? results.filter(r => r && (r.agentEmail || r.agentPhone || r.agentName)).length
            : 0;
          progressTrackerStats.currentListingsFound += foundCount;

          logCurrentListings.success('Realtor.com enrichment completed for all fetched properties.', {
            homesFound: progressTrackerStats.currentListingsFound,
            percent: ((progressTrackerStats.currentListings.completedJobs / (progressTrackerStats.currentListings.totalJobs || 1)) * 100).toFixed(1) + '%'
          });
        } catch (e) {
          logCurrentListings.error('Error in Current Listings automation', { error: e.message });
        }
      })());
    } else {
      logCurrentListings.info('Current Listings job skipped (not selected)');
    }

    // --- Agent Offers in parallel ---
    if (jobs.has('agent_offers')) {
      tasks.push((async () => {
        try {
          log.start('Running Agent Offers job…');
          await runAgentOffers();
          log.success('Agent Offers job finished.');
        } catch (e) {
          log.error('Error in Agent Offers job', { error: e?.message || String(e) });
        }
      })());
    } else {
      log.info('Agent Offers job skipped (not selected)');
    }

    // --- Standalone Chase job ---
    if (jobs.has('chase')) {
      tasks.push((async () => {
        try {
          log.start('Running Chase job…');
          await runChaseJob();
          log.success('Chase job finished.');
        } catch (e) {
          log.error('Error in Chase job', { error: e?.message || String(e) });
        }
      })());
    } else {
      log.info('Chase job skipped (not selected)');
    }

    // --- Standalone BofA job (for Property collection - legacy) ---
    // NOTE: For batch scheduler, we use scraped_deals_amv which processes ScrapedDeal collection
    // Only run standalone BofA job when explicitly requested AND scraped_deals_amv is not running
    if (jobs.has('bofa') && !jobs.has('scraped_deals_amv')) {
      tasks.push((async () => {
        try {
          log.start('Running BofA job (legacy Property collection)…');
          await runBofaJob();
          log.success('BofA job finished.');
        } catch (e) {
          log.error('Error in BofA job', { error: e?.message || String(e) });
        }
      })());
    } else if (jobs.has('bofa') && jobs.has('scraped_deals_amv')) {
      log.info('BofA job skipped (scraped_deals_amv handles ScrapedDeal AMV)');
    } else {
      log.info('BofA job skipped (not selected)');
    }

    // Wait for all selected jobs to complete in parallel
    await Promise.allSettled(tasks);
  } catch (error) {
    progressTracker.status = 'error';
    progressTracker.error = error.message;
    log.error('Error initializing automation', { error: error.message });
  } finally {
    // stop maintenance loop
    try { if (maintainPoolHandle) clearInterval(maintainPoolHandle); } catch {}
    isRunning = false;
    progressTracker.isRunning = false;
    homeValuationsQueue = null;
    currentListingsQueue = null;
    currentGlobalLimiter = null;
    progressTracker.otp = getOtpState();
    if (progressTracker.status !== 'error' && progressTracker.status !== 'stopping') {
      progressTracker.status = 'completed';
    }
    // Optional: close shared browser between runs (can be kept alive if you prefer)
    try {
      if (String(process.env.KEEP_BROWSER_ALIVE).toLowerCase() !== 'true') {
        await closeSharedBrowser();
      } else {
        log.info('KEEP_BROWSER_ALIVE=true — keeping shared Chrome session open between runs.');
      }
    } catch {}
    // --- Overall summary ---
    const totalJobs =
      progressTrackerStats.privy.totalJobs +
      progressTrackerStats.homeValuations.totalJobs +
      progressTrackerStats.currentListings.totalJobs;
    const completedJobs =
      progressTrackerStats.privy.completedJobs +
      progressTrackerStats.homeValuations.completedJobs +
      progressTrackerStats.currentListings.completedJobs;
    const percent = totalJobs ? ((completedJobs / totalJobs) * 100).toFixed(1) : '100.0';
    log.info('Overall automation progress', {
      completed: completedJobs,
      total: totalJobs,
      percent: percent + '%',
      privyFound: progressTrackerStats.privyFound,
      bofaValued: progressTrackerStats.homeValuations.bofaValued,
      currentListingsFound: progressTrackerStats.currentListingsFound,
      notMeetSpread: progressTrackerStats.notMeetSpread, 
    });

    log.success('All automations completed.');
  }
}

// Export function to manually start scheduler (for single-process mode)
export function startSchedulerManually() {
  log.info('=== startSchedulerManually called ===');
  log.info('Current state before start', {
    schedulerEnabled,
    DISABLE_SCHEDULER,
    RUN_IMMEDIATELY: process.env.RUN_IMMEDIATELY,
    schedulerPhase
  });

  schedulerEnabled = true;

  // Always call bootstrapScheduler - it handles the actual scheduling
  // The old check was preventing startup when schedulerEnabled was already true
  bootstrapScheduler().catch(e => log.error('bootstrapScheduler error', { error: e?.message }));

  log.info('=== startSchedulerManually complete ===');
}

// Bootstrap the sequential scheduler (only in worker mode is now handled above)
if (!IS_WORKER) {
  log.info('Scheduler bootstrap skipped (API mode)', { worker: false });
}

if (IS_WORKER) {
  release = acquireLock();
  if (!release) {
    startStandbyWatcher();
  } else {
    process.on('exit', () => { try { release(); } catch {} });
    process.on('SIGINT', () => { try { release(); } catch {}; process.exit(0); });
    process.on('SIGTERM', () => { try { release(); } catch {}; process.exit(0); });
    // Primary worker: start scheduler immediately
    bootstrapScheduler().catch(e => log.error('bootstrapScheduler error', { error: e?.message }));
  }
}
// Hidden hook used by routes to request a FORCE stop - kills everything immediately
progressTracker._requestStop = async function requestStop() {
  log.warn('🛑 FORCE STOP requested - killing all automations immediately');

  // Set abort flag immediately - this is checked by all scrapers
  control.abort = true;
  schedulerEnabled = false;
  isRunning = false;

  // Update status immediately so UI shows stopped
  progressTracker.isRunning = false;
  progressTracker.status = 'stopping';

  // Clear all timers and queues
  try { if (schedulerTimer) clearTimeout(schedulerTimer); schedulerTimer = null; } catch {}
  try { if (homeValuationsQueue) homeValuationsQueue.clear(); } catch {}
  try { if (currentListingsQueue) currentListingsQueue.clear(); } catch {}
  try { if (currentGlobalLimiter) currentGlobalLimiter.clear(); } catch {}
  try { if (maintainPoolHandle) clearInterval(maintainPoolHandle); maintainPoolHandle = null; } catch {}

  // Clear the Privy login mutex queue
  try { privyLoginMutex.clear(); } catch {}

  // Reset OTP state
  resetOtpState();

  // Force close all browsers - this kills Puppeteer mid-operation
  try {
    await closeSharedBrowser();
    log.info('Shared browser closed');
  } catch (e) {
    log.warn('Error closing shared browser', { error: e?.message });
  }

  // Also try to close the Redfin agent extractor browser
  try {
    const { closeSharedBrowser: closeRedfinBrowser } = await import('./redfin/agentExtractor.js');
    await closeRedfinBrowser();
    log.info('Redfin agent extractor browser closed');
  } catch {}

  // Reset progress tracker to idle state
  progressTracker.status = 'idle';
  progressTracker.jobs = [];
  progressTracker.error = null;
  progressTracker.otp = null;

  // Reset queues
  homeValuationsQueue = null;
  currentListingsQueue = null;
  currentGlobalLimiter = null;

  // Reset batch counter
  resetBatchCounter();

  log.warn('🛑 FORCE STOP complete - all automations killed, status reset to idle');
};

export default runAutomation;