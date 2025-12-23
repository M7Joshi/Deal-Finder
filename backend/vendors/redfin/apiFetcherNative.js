// backend/vendors/redfin/apiFetcherNative.js
// Uses Node's native https module for more reliable requests
import https from 'https';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Make an HTTPS GET request using native Node.js
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout after 15s'));
    }, 15000);

    https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      }
    }, (res) => {
      clearTimeout(timeout);

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Get region ID for a state
 */
export async function getRegionIdForState(stateCode, stateName) {
  try {
    const url = `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(stateName || stateCode)}&v=2`;

    console.log(`[RedfinAPI] Getting region for: ${stateName || stateCode}`);

    const rawData = await httpsGet(url);

    // Parse Redfin's {}&&{...} format
    let data = rawData.replace(/^\{\}&&/, '');
    data = JSON.parse(data);

    const sections = data.payload?.sections || [];

    for (const section of sections) {
      const rows = section.rows || [];
      for (const row of rows) {
        if (row.type === 11) { // State
          console.log(`[RedfinAPI] Found STATE:`, row.name, row.id);
          return {
            region_id: row.id.split('_')[1],
            region_type: row.type,
            name: row.name
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[RedfinAPI] Error getting region:`, error.message);
    return null;
  }
}

/**
 * Fetch properties from Redfin GIS API
 */
export async function fetchRedfinGISData({ region_id, region_type = 11, limit = 20 }) {
  try {
    if (!region_id) {
      throw new Error('region_id required');
    }

    const url = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${region_id}&region_type=${region_type}&num_homes=${Math.min(limit * 2, 350)}&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8`;

    console.log(`[RedfinAPI] Fetching listings for region ${region_id}...`);

    const rawData = await httpsGet(url);

    // Parse response
    let data = rawData.replace(/^\{\}&&/, '');
    data = JSON.parse(data);

    const homes = data.payload?.homes || [];
    console.log(`[RedfinAPI] Got ${homes.length} homes`);

    const properties = homes.slice(0, limit).map((home, i) => {
      // Handle both nested .value and direct property formats
      const address = home.streetLine?.value || home.streetLine || '';
      const city = home.city?.value || home.city || '';
      const state = home.state?.value || home.state || '';
      const zip = home.zip?.value || home.zip || home.postalCode?.value || '';

      return {
        fullAddress: [address, city, state, zip].filter(Boolean).join(', '),
        vendor: 'redfin',
        extractedAt: new Date().toISOString(),
        sourceIndex: i,
        url: home.url ? `https://www.redfin.com${home.url}` : null,
        price: home.price?.value || null,
        priceText: home.price?.value ? `$${home.price.value.toLocaleString()}` : null,
        beds: home.beds || null,
        bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
        baths: home.baths || null,
        bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
        sqft: home.sqFt?.value || null,
        sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
        propertyType: home.propertyType?.value || home.propertyType || null,
        listingId: home.listingId || null,
        mlsId: home.mlsId?.value || null,
        lotSize: home.lotSize?.value || null,
        yearBuilt: home.yearBuilt?.value || null,
        daysOnMarket: home.dom?.value || null,
        hoa: home.hoa?.value || null,
        latitude: home.latLong?.value?.latitude || null,
        longitude: home.latLong?.value?.longitude || null,
        status: home.listingStatus || 'active'
      };
    });

    return properties;
  } catch (error) {
    console.error(`[RedfinAPI] Error fetching data:`, error.message);
    throw error;
  }
}
