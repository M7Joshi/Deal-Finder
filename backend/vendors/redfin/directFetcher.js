// Direct Redfin fetcher using hardcoded region IDs
// This bypasses the autocomplete API which may be blocked
import https from 'https';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Hardcoded region IDs for US states (from Redfin's internal data)
const STATE_REGIONS = {
  'AL': { id: 1, name: 'Alabama' },
  'AK': { id: 2, name: 'Alaska' },
  'AZ': { id: 3, name: 'Arizona' },
  'AR': { id: 4, name: 'Arkansas' },
  'CA': { id: 9, name: 'California' },
  'CO': { id: 10, name: 'Colorado' },
  'CT': { id: 11, name: 'Connecticut' },
  'DE': { id: 12, name: 'Delaware' },
  'FL': { id: 13, name: 'Florida' },
  'GA': { id: 14, name: 'Georgia' },
  'HI': { id: 15, name: 'Hawaii' },
  'ID': { id: 16, name: 'Idaho' },
  'IL': { id: 17, name: 'Illinois' },
  'IN': { id: 18, name: 'Indiana' },
  'IA': { id: 19, name: 'Iowa' },
  'KS': { id: 20, name: 'Kansas' },
  'KY': { id: 21, name: 'Kentucky' },
  'LA': { id: 22, name: 'Louisiana' },
  'ME': { id: 23, name: 'Maine' },
  'MD': { id: 24, name: 'Maryland' },
  'MA': { id: 25, name: 'Massachusetts' },
  'MI': { id: 26, name: 'Michigan' },
  'MN': { id: 27, name: 'Minnesota' },
  'MS': { id: 28, name: 'Mississippi' },
  'MO': { id: 29, name: 'Missouri' },
  'MT': { id: 30, name: 'Montana' },
  'NE': { id: 31, name: 'Nebraska' },
  'NV': { id: 32, name: 'Nevada' },
  'NH': { id: 33, name: 'New Hampshire' },
  'NJ': { id: 34, name: 'New Jersey' },
  'NM': { id: 35, name: 'New Mexico' },
  'NY': { id: 36, name: 'New York' },
  'NC': { id: 37, name: 'North Carolina' },
  'ND': { id: 38, name: 'North Dakota' },
  'OH': { id: 39, name: 'Ohio' },
  'OK': { id: 40, name: 'Oklahoma' },
  'OR': { id: 41, name: 'Oregon' },
  'PA': { id: 42, name: 'Pennsylvania' },
  'RI': { id: 44, name: 'Rhode Island' },
  'SC': { id: 45, name: 'South Carolina' },
  'SD': { id: 46, name: 'South Dakota' },
  'TN': { id: 47, name: 'Tennessee' },
  'TX': { id: 48, name: 'Texas' },
  'UT': { id: 49, name: 'Utah' },
  'VT': { id: 50, name: 'Vermont' },
  'VA': { id: 51, name: 'Virginia' },
  'WA': { id: 53, name: 'Washington' },
  'WV': { id: 54, name: 'West Virginia' },
  'WI': { id: 55, name: 'Wisconsin' },
  'WY': { id: 56, name: 'Wyoming' }
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 20000);

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

export async function getRegionIdForState(stateCode) {
  const region = STATE_REGIONS[stateCode.toUpperCase()];
  if (!region) {
    console.error(`[RedfinAPI] Unknown state: ${stateCode}`);
    return null;
  }

  console.log(`[RedfinAPI] Using hardcoded region for ${region.name}: ID ${region.id}`);
  return {
    region_id: region.id,
    region_type: 11,
    name: region.name
  };
}

export async function fetchRedfinGISData({ region_id, region_type = 11, limit = 20 }) {
  try {
    const url = `https://www.redfin.com/stingray/api/gis?al=1&region_id=${region_id}&region_type=${region_type}&num_homes=${Math.min(limit * 2, 350)}&page_number=1&status=9&sf=1,2,3,5,6,7&uipt=1,2,3,4,5,6&ord=redfin-recommended-asc&v=8`;

    console.log(`[RedfinAPI] Fetching from Redfin for region ${region_id}...`);
    console.log(`[RedfinAPI] API URL: ${url}`);

    const rawData = await httpsGet(url);
    let data = rawData.replace(/^\{\}&&/, '');
    data = JSON.parse(data);

    const homes = data.payload?.homes || [];
    console.log(`[RedfinAPI] ✅ Got ${homes.length} real listings from Redfin!`);

    // Filter and transform homes - ONLY include properties with complete data
    const validHomes = homes
      .filter(home => {
        // Must have address, city, state, price, and URL
        // Handle both nested .value and direct property formats
        const hasAddress = home.streetLine?.value || home.streetLine;
        const hasCity = home.city?.value || home.city;
        const hasState = home.state?.value || home.state;
        const hasPrice = home.price?.value || home.price;
        const hasUrl = home.url;

        if (!hasAddress || !hasCity || !hasState || !hasPrice || !hasUrl) {
          console.log('[RedfinAPI] Skipping incomplete listing');
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((home, i) => {
        // Handle both nested .value and direct property formats
        const address = home.streetLine?.value || home.streetLine || '';
        const city = home.city?.value || home.city || '';
        const state = home.state?.value || home.state || '';
        const zip = home.zip?.value || home.zip || home.postalCode?.value || '';

        const price = home.price?.value || home.price || null;
        return {
          fullAddress: [address, city, state, zip].filter(Boolean).join(', '),
          vendor: 'redfin',
          extractedAt: new Date().toISOString(),
          sourceIndex: i,
          url: `https://www.redfin.com${home.url}`,
          price: price,
          priceText: price ? `$${price.toLocaleString()}` : null,
          beds: home.beds || null,
          bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
          baths: home.baths || null,
          bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
          sqft: home.sqFt?.value || null,
          sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
          propertyType: home.propertyType?.value || home.propertyType || null,
          listingId: home.listingId || null,
          mlsId: home.mlsId?.value || null,
          yearBuilt: home.yearBuilt?.value || null,
          daysOnMarket: home.dom?.value || null,
          latitude: home.latLong?.value?.latitude || null,
          longitude: home.latLong?.value?.longitude || null,
          status: 'active' // Only active listings from status=9 query
        };
      });

    console.log(`[RedfinAPI] Returning ${validHomes.length} validated properties`);
    return validHomes;
  } catch (error) {
    console.error(`[RedfinAPI] Error:`, error.message);
    throw error;
  }
}
