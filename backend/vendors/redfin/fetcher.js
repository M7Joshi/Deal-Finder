// backend/vendors/redfin/fetcher.js
import axios from 'axios';
import pkg from 'https-proxy-agent';
 const { HttpsProxyAgent } = pkg;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = n => 500 * (2 ** n) + Math.floor(Math.random() * 250);

function defaultHeaders() {
  return {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
  };
}

function getDecodoAgent() {
  // Provide your Decodo endpoint like: http://user:pass@host:port
  // If Decodo is IP-whitelist only, use http://host:port and skip creds.
  const url = process.env.DECODO_PROXY_URL || process.env.PROXY_URL || '';
  if (!url) throw new Error('DECODO_PROXY_URL (or PROXY_URL) not set');
  return new HttpsProxyAgent(url);
}

// Direct fetch without proxy (fallback when proxy fails)
async function fetchDirect(url) {
  console.log(`[Fetcher] Attempting direct fetch: ${url}`);
  try {
    const res = await axios.get(url, {
      headers: defaultHeaders(),
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log(`[Fetcher] Direct fetch status: ${res.status}`);

    if (res.status >= 200 && res.status < 300) {
      return typeof res.data === 'string' ? res.data : String(res.data);
    }

    throw new Error(`HTTP ${res.status} (direct) for ${url}`);
  } catch (err) {
    console.error(`[Fetcher] Direct fetch error: ${err.message}`);
    throw err;
  }
}

// Public API: `render` is accepted for compatibility; the proxy handles JS as it's configured.
export async function fetchHtml(url, { render = false } = {}) {
  let agent;

  console.log(`[Fetcher] Fetching URL: ${url} (render=${render})`);

  try {
    agent = getDecodoAgent();
    console.log('[Fetcher] Proxy configured, using Decodo');
  } catch (err) {
    console.warn('[Fetcher] Proxy not configured, using direct fetch');
    return await fetchDirect(url);
  }

  let lastErr;
  let proxyFailed = false;

  for (let i = 0; i < 4; i++) {
    try {
      console.log(`[Fetcher] Attempt ${i + 1}/4 via proxy...`);
      const res = await axios.get(url, {
        headers: defaultHeaders(),
        timeout: 60000,
        httpsAgent: agent, // route via Decodo
        proxy: false,      // IMPORTANT when using a custom agent
        validateStatus: () => true,
      });

      console.log(`[Fetcher] Proxy response status: ${res.status}`);

      if (res.status >= 200 && res.status < 300) {
        console.log(`[Fetcher] Success! Got ${typeof res.data === 'string' ? res.data.length : 0} bytes`);
        return typeof res.data === 'string' ? res.data : String(res.data);
      }

      // HTTP 405 means proxy is blocking - switch to direct
      if (res.status === 405) {
        console.warn(`[Fetcher] Proxy blocked with HTTP 405, switching to direct fetch`);
        proxyFailed = true;
        break;
      }

      // Retry on common block statuses
      if ([401, 403, 409, 412, 429, 500, 502, 503, 520].includes(res.status)) {
        lastErr = new Error(`HTTP ${res.status} (decodo) for ${url}`);
        console.warn(`[Fetcher] Got ${res.status}, retrying after backoff...`);
        await sleep(backoff(i));
        continue;
      }

      throw new Error(`HTTP ${res.status} (decodo) for ${url}`);
    } catch (err) {
      console.error(`[Fetcher] Attempt ${i + 1} failed: ${err.message}`);
      lastErr = err;
      await sleep(backoff(i));
    }
  }

  // If proxy failed with 405, try direct fetch
  if (proxyFailed) {
    console.log(`[Fetcher] Proxy failed, attempting direct fetch...`);
    try {
      return await fetchDirect(url);
    } catch (directErr) {
      throw new Error(`Both proxy and direct failed. Proxy: ${lastErr?.message || 'unknown'}, Direct: ${directErr.message}`);
    }
  }

  // Last resort: try direct fetch even if proxy didn't return 405
  console.log(`[Fetcher] All proxy attempts failed, trying direct fetch as last resort...`);
  try {
    return await fetchDirect(url);
  } catch (directErr) {
    throw new Error(`All fetch attempts failed. Last proxy error: ${lastErr?.message || 'unknown'}, Direct error: ${directErr.message}`);
  }
}