// backend/vendors/redfin/apiFetcher.js
// Uses Redfin's internal Stingray GIS API for real-time property data
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Get region ID for a state using Redfin's autocomplete API
 * @param {string} stateCode - Two-letter state code (e.g., "CA", "NY")
 * @param {string} stateName - Full state name (e.g., "California", "New York")
 * @returns {Promise<Object|null>} Region info with region_id and region_type
 */
export async function getRegionIdForState(stateCode, stateName) {
  try {
    const url = 'https://www.redfin.com/stingray/do/location-autocomplete';

    // Use full state name instead of code to avoid matching cities
    const params = new URLSearchParams({
      location: stateName || stateCode,
      v: '2'
    });

    console.log(`[RedfinAPI] Fetching region for ${stateCode} (${stateName})...`);

    const response = await axios.get(`${url}?${params.toString()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': 'https://www.redfin.com/'
      },
      timeout: 10000
    });

    console.log(`[RedfinAPI] Response status: ${response.status}, type: ${typeof response.data}`);

    // Parse the weird Redfin format: {}&&{...}
    let data = response.data;
    if (typeof data === 'string') {
      console.log(`[RedfinAPI] Data is string, parsing...`);
      data = data.replace(/^\{\}&&/, '');
      data = JSON.parse(data);
    } else {
      console.log(`[RedfinAPI] Data is already parsed object`);
    }

    const payload = data.payload || data;
    const sections = payload.sections || [];

    console.log(`[RedfinAPI] Found ${sections.length} sections`);

    // Find state-level region (type 11 = State, type 2 = City)
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const rows = section.rows || [];
      console.log(`[RedfinAPI] Section ${i}: ${rows.length} rows`);

      for (let j = 0; j < rows.length; j++) {
        const row = rows[j];
        console.log(`[RedfinAPI] Row ${j}: type=${row.type} (${typeof row.type}), name=${row.name}`);

        if (row.type == 11 || row.type === '11') { // Type 11 = State (check both number and string)
          console.log(`[RedfinAPI] ✅ Found STATE region for ${stateCode}:`, row.id, row.name);
          const region_id = row.id.split('_')[1];
          return {
            region_id: region_id,
            region_type: row.type,
            name: row.name
          };
        }
      }
    }

    console.log(`[RedfinAPI] ❌ No state-level region found for ${stateCode}`);
    return null;
  } catch (error) {
    console.error(`[RedfinAPI] ❌ Error getting region ID for ${stateCode}:`, error.message);
    if (error.response) {
      console.error(`[RedfinAPI] Response status: ${error.response.status}`);
    }
    return null;
  }
}

/**
 * Fetch properties from Redfin's internal GIS API
 * @param {Object} options
 * @param {number} options.region_id - Redfin region ID (required)
 * @param {number} options.region_type - Region type (2 = state, 6 = city, etc.)
 * @param {number} options.limit - Max number of results (default: 20)
 * @param {string} options.filterState - Optional state code to filter results (e.g., "NJ", "CA")
 * @returns {Promise<Array>} Array of property listings
 */
export async function fetchRedfinGISData({ region_id, region_type = 2, limit = 20, filterState = null }) {
  try {
    if (!region_id) {
      throw new Error('region_id is required for Redfin GIS API');
    }

    // Use the GIS API endpoint (returns JSON, not CSV)
    const baseUrl = 'https://www.redfin.com/stingray/api/gis';

    // Build query params for active listings
    const params = new URLSearchParams({
      al: '1',                    // Access level
      region_id: region_id.toString(),
      region_type: region_type.toString(),
      num_homes: Math.min(limit * 2, 350).toString(), // Get extra to ensure enough results
      page_number: '1',
      status: '9',                // 9 = Active listings (for sale)
      sf: '1,2,3,5,6,7',         // Property types
      uipt: '1,2,3,4,5,6',       // UI property types
      ord: 'redfin-recommended-asc',
      v: '8'                      // API version
    });

    const url = `${baseUrl}?${params.toString()}`;
    console.log(`[RedfinAPI] Fetching from: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.redfin.com/',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`Redfin API returned status ${response.status}`);
    }

    // Redfin returns format: {}&&{"payload":{...}}
    let data = response.data;
    if (typeof data === 'string') {
      // Remove the {}&& prefix that Redfin adds
      data = data.replace(/^\{\}&&/, '');
      try {
        data = JSON.parse(data);
      } catch (err) {
        console.error('[RedfinAPI] Failed to parse response:', data.substring(0, 200));
        throw new Error('Failed to parse Redfin API response');
      }
    }

    const payload = data.payload || data;
    const homes = payload.homes || [];

    console.log(`[RedfinAPI] Received ${homes.length} homes from API`);

    if (homes.length === 0) {
      console.warn('[RedfinAPI] No homes returned. Payload keys:', Object.keys(payload));
      return [];
    }

    // WORKAROUND: Redfin's GIS API returns incorrect states for state-level queries
    // Filter to only include properties from the requested state
    let filteredHomes = homes;
    if (filterState) {
      const upperFilterState = filterState.toUpperCase();
      filteredHomes = homes.filter(home => {
        const homeState = (home.state || '').toUpperCase();
        return homeState === upperFilterState;
      });
      console.log(`[RedfinAPI] Filtered from ${homes.length} to ${filteredHomes.length} homes for state ${filterState}`);

      if (filteredHomes.length === 0) {
        console.warn(`[RedfinAPI] No homes found for state ${filterState} after filtering`);
        return [];
      }
    }

    // Transform to our format (get more than needed since we're filtering)
    const properties = filteredHomes.slice(0, limit).map((home, i) => {
      // Extract address components - Redfin API returns nested .value objects
      // Handle both nested .value and direct property formats for compatibility
      const address = home.streetLine?.value || home.streetLine || '';
      const city = home.city?.value || home.city || '';
      const state = home.state?.value || home.state || '';
      const zip = home.zip?.value || home.zip || home.postalCode?.value || '';

      const fullAddress = [address, city, state, zip]
        .filter(Boolean)
        .join(', ');

      return {
        fullAddress,
        vendor: 'redfin',
        extractedAt: new Date().toISOString(),
        sourceIndex: i,
        url: home.url ? `https://www.redfin.com${home.url}` : null,
        state: state, // Include state in output for verification

        // Price data
        price: home.price?.value || null,
        priceText: home.price?.value ? `$${home.price.value.toLocaleString()}` : null,

        // Property details - beds/baths are direct properties
        beds: home.beds || null,
        bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
        baths: home.baths || null,
        bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
        sqft: home.sqFt?.value || null,
        sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,

        // Additional metadata
        propertyType: home.propertyType?.value || home.propertyType || null,
        listingId: home.listingId || null,
        mlsId: home.mlsId?.value || null,
        lotSize: home.lotSize?.value || null,
        yearBuilt: home.yearBuilt?.value || null,
        daysOnMarket: home.dom?.value || null,
        hoa: home.hoa?.value || null,

        // Location
        latitude: home.latLong?.value?.latitude || null,
        longitude: home.latLong?.value?.longitude || null,

        // Status
        status: home.listingStatus || 'active'
      };
    });

    return properties;
  } catch (error) {
    console.error(`[RedfinAPI] Error fetching GIS data:`, error.message);
    throw error;
  }
}
