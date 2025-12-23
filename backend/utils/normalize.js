// backend/utils/normalize.js
export function toNumber(value) {
    if (value === null || value === undefined) return null;
    const n = Number(String(value).replace(/[^\d.-]/g, '')); // strip $ , spaces etc.
    return Number.isFinite(n) ? n : null;
  }

/**
 * Normalize street address to fix common formatting issues from Redfin/other sources
 * Fixes issues like "66th EastAvenue" -> "66th East Avenue"
 */
export function normalizeStreetAddress(address) {
  if (!address || typeof address !== 'string') return address;

  let result = address.trim();

  // Fix concatenated directional + street types (e.g., "EastAvenue" -> "East Avenue")
  // Common patterns: NorthStreet, SouthDrive, EastAvenue, WestBoulevard, etc.
  const directions = ['North', 'South', 'East', 'West', 'Northeast', 'Northwest', 'Southeast', 'Southwest'];
  const streetTypes = [
    'Avenue', 'Ave', 'Street', 'St', 'Drive', 'Dr', 'Road', 'Rd',
    'Boulevard', 'Blvd', 'Lane', 'Ln', 'Court', 'Ct', 'Circle', 'Cir',
    'Place', 'Pl', 'Way', 'Terrace', 'Ter', 'Trail', 'Trl', 'Parkway', 'Pkwy'
  ];

  for (const dir of directions) {
    for (const type of streetTypes) {
      // Match patterns like "EastAvenue" or "NorthStreet" (no space between)
      const pattern = new RegExp(`(${dir})(${type})\\b`, 'gi');
      result = result.replace(pattern, '$1 $2');
    }
  }

  // Fix ordinal + directional concatenation (e.g., "66th EastAvenue" is already handled above)
  // But also fix "66thEast Avenue" -> "66th East Avenue"
  result = result.replace(/(\d+(?:st|nd|rd|th))(North|South|East|West)/gi, '$1 $2');

  // Fix double spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}