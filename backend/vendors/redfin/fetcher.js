// backend/vendors/redfin/fetcher.js
// Uses Redfin API directly (same as RedfinFetcher page) - much faster and more reliable
import axios from 'axios';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// No browser needed for API-based fetching
export async function closeSharedBrowser() {
  // No-op - no browser to close
}

// Fetch listings directly from Redfin API (much faster than HTML scraping)
export async function fetchListingsFromApi(cityId, stateCode, options = {}) {
  const { limit = 500, sortOrder = 'redfin-recommended-asc' } = options;
  const market = stateCode.toLowerCase();

  const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${market}&region_id=${cityId}&region_type=6&num_homes=${limit}&status=9&ord=${sortOrder}&v=8`;

  console.log(`[Fetcher] Fetching from Redfin API: cityId=${cityId}, state=${stateCode}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': `https://www.redfin.com/city/${cityId}/${stateCode}/`
      },
      timeout: 30000
    });

    let data = response.data;
    if (typeof data === 'string') {
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    }

    const homes = data.payload?.homes || [];
    console.log(`[Fetcher] API returned ${homes.length} homes`);

    return homes;
  } catch (err) {
    console.error(`[Fetcher] API fetch error: ${err.message}`);
    throw err;
  }
}

// Legacy HTML fetch (kept for backwards compatibility with sitemapEnumerator)
export async function fetchHtml(url, { render = false } = {}) {
  console.log(`[Fetcher] Fetching HTML: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 30000
    });

    console.log(`[Fetcher] Got ${response.data.length} bytes`);
    return response.data;
  } catch (err) {
    console.error(`[Fetcher] HTML fetch error: ${err.message}`);
    throw err;
  }
}
