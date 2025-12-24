import { DateTime } from 'luxon';
const DISABLE = process.env.REDFIN_DISABLE_FILTERS === '1';

export const FILTERS = {
  priceMin: 50000,      // $50k minimum
  priceMax: 500000,     // $500k maximum
  sqftMin: 1000,        // 1000 sqft minimum
  sqftMax: 50000,
  bedsMin: 3,           // 3+ bedrooms
  hoaNoOnly: false,     // Allow properties with HOA
  dateRange: 'all',     // 'all'|'1d'|'7d'|'14d'|'30d'
  exclude55Plus: true,  // Exclude 55+ senior communities
};

function withinPrice(p, min, max) {
  if (p.price == null) return false;
  return p.price >= min && p.price <= max;
}
function withinSqft(p, min, max) {
  if (p.sqft == null) return false;
  return p.sqft >= min && p.sqft <= max;
}
function hoaNo(p, required) {
  if (!required) return true;
  if (p.hoa == null) return false;
  return String(p.hoa).toLowerCase() === 'no';
}
function withinDateRange(p, range) {
  if (range === 'all') return true;
  if (!p.listedAt) return false;
  const dt = DateTime.fromISO(p.listedAt, { zone: 'utc' });
  if (!dt.isValid) return false;
  const days = range === '1d' ? 1 : range === '7d' ? 7 : range === '14d' ? 14 : 30;
  return dt >= DateTime.utc().minus({ days });
}

function minBeds(p, min) {
  if (!min) return true;
  if (p.beds == null) return false;
  return p.beds >= min;
}

function not55Plus(p, exclude) {
  if (!exclude) return true;
  // Check various fields for 55+ community indicators
  const seniorKeywords = ['55+', '55 +', 'senior', 'age restricted', 'age-restricted',
    'adult community', 'retirement', 'over 55', 'active adult', '55 and older'];

  const textToCheck = [
    p.description || '',
    p.remarks || '',
    p.propertyType || '',
    ...(p.tags || []),
    ...(p.keyFacts || [])
  ].join(' ').toLowerCase();

  return !seniorKeywords.some(kw => textToCheck.includes(kw.toLowerCase()));
}

export function passesAll(p, cfg = FILTERS) {
  if (DISABLE) return true;
  return withinPrice(p, cfg.priceMin, cfg.priceMax)
      && withinSqft(p, cfg.sqftMin, cfg.sqftMax)
      && minBeds(p, cfg.bedsMin)
      && hoaNo(p, cfg.hoaNoOnly)
      && withinDateRange(p, cfg.dateRange)
      && not55Plus(p, cfg.exclude55Plus);
}