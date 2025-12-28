import fs from 'fs';
import path from 'node:path';

// Determine session store path:
// 1. Use PRIVY_SESSION_FILE env var if set
// 2. In production: try /var/data (persistent disk), fallback to /tmp (ephemeral but always writable)
// 3. In development: use local var/ directory
function getStorePath() {
  if (process.env.PRIVY_SESSION_FILE) {
    return process.env.PRIVY_SESSION_FILE;
  }

  if (process.env.NODE_ENV === 'production') {
    // Try /var/data first (persistent disk on Render)
    try {
      fs.mkdirSync('/var/data', { recursive: true });
      fs.accessSync('/var/data', fs.constants.W_OK);
      return '/var/data/privy-session.json';
    } catch {
      // Fallback to /tmp which is always writable (but ephemeral)
      return '/tmp/privy-session.json';
    }
  }

  return path.join(process.cwd(), 'var/privy-session.json');
}

const STORE = getStorePath();

export function hasFreshPrivySession(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const st = fs.statSync(STORE);
    return (Date.now() - st.mtimeMs) < maxAgeMs;
  } catch {
    return false;
  }
}

export function readPrivySession() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return null;
  }
}

export async function saveSessionCookies(page) {
  try {
    const cookies = await page.cookies();
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(
      STORE,
      JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2)
    );
    console.log(`[SessionStore] Saved ${cookies.length} cookies to ${STORE}`);
  } catch (e) {
    console.warn(`[SessionStore] Failed to save cookies: ${e.message}`);
  }
}

export function getSessionStorePath() {
  return STORE;
}