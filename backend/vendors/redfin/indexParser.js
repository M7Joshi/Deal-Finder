// backend/vendors/redfin/indexParser.js
import * as cheerio from 'cheerio';

// ✅ allow 8–9 digit prices (up to hundreds of millions)
const PRICE_RE = /\$?\s*([\d,]{2,9})(?:\.\d{2})?/;

// ✅ Comprehensive address regex with all common street suffixes
const ADDRESS_RE = /\d+\s+[A-Za-z0-9\s.'-]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr(?:ive)?|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Pl(?:ace)?|Ter(?:race)?|Pkwy|Parkway|Cir(?:cle)?|Trl|Trail|Hwy|Highway|Loop|Run|Path|Pass|Cove|Cv|Sq(?:uare)?|Crst|Crest|Xing|Crossing|Aly|Alley|Brg|Bridge|Commons|Cmn|Ests|Estates|Gdns|Gardens|Grv|Grove|Hts|Heights|Holw|Hollow|Is|Isle|Jct|Junction|Knl|Knoll|Lk|Lake|Ldg|Lodge|Mdw|Meadow|Mews|Mnr|Manor|Mtn|Mountain|Orch|Orchard|Ovlk|Overlook|Park|Pt|Point|Rdg|Ridge|Row|Shr|Shore|Spg|Spring|Sta|Station|Strm|Stream|Vis|Vista|Walk|Wlk|Woods)[.,]?\s*(?:[A-Za-z\s]+,\s*)?(?:[A-Z]{2}\s*\d{5}(?:-\d{4})?)?/i;

// Simpler fallback regex for basic street addresses
const ADDRESS_SIMPLE_RE = /\d+\s+[A-Za-z0-9\s.'-]{3,50}(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Ter|Pkwy|Cir|Trl|Hwy|Loop|Run|Cove|Sq)[.,\s]/i;

function parsePrice(text) {
  if (!text) return null;
  const m = PRICE_RE.exec(String(text));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Extract address using multiple strategies
function extractAddress(container) {
  const textOrNull = (sel) => {
    const t = container.find(sel).first().text().trim();
    return t || null;
  };

  // Strategy 1: Specific Redfin address selectors (most reliable)
  const addressSelectors = [
    '[data-rf-test-id="homecard-address"]',
    '[data-rf-test-id="abp-homecard-address"]',
    '[data-testid="homecard-address"]',
    '[data-testid="address"]',
    '.homecard-address',
    '.HomeCardAddress',
    '.homecardV2Address',
    // More specific class patterns to avoid false matches
    '[class*="homecard"][class*="address" i]',
    '[class*="HomeCard"][class*="Address"]',
    '[class*="listing"][class*="address" i]',
    '.streetAddress',
    '.street-address',
    '[itemprop="streetAddress"]',
    // Generic but within card context
    '.address:not(nav .address):not(footer .address)',
  ];

  for (const sel of addressSelectors) {
    const addr = textOrNull(sel);
    if (addr && addr.length > 5 && /\d/.test(addr)) {
      // Validate it looks like an address (has numbers)
      return addr;
    }
  }

  // Strategy 2: Look for elements containing address-like text within the card
  const cardText = container.text();

  // Try comprehensive regex first
  const match = cardText.match(ADDRESS_RE);
  if (match) {
    return match[0].trim().replace(/[,.]$/, '');
  }

  // Strategy 3: Simpler regex fallback
  const simpleMatch = cardText.match(ADDRESS_SIMPLE_RE);
  if (simpleMatch) {
    return simpleMatch[0].trim().replace(/[,.\s]$/, '');
  }

  // Strategy 4: Look for any element with class containing "Address" but be strict
  const addressEl = container.find('[class*="Address"]').first();
  if (addressEl.length) {
    const text = addressEl.text().trim();
    // Verify it looks like an address
    if (text && /^\d+\s+[A-Za-z]/.test(text)) {
      return text;
    }
  }

  return null;
}

export function parseIndexHtml(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href*="/home/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!/\/home\/\d+/.test(href)) return;

    const container = $(a).closest('[class*="HomeCard"], [data-testid*="home-card"], [class*="homecard"], [class*="PropertyCard"], [class*="listing"], li, article');

    const textOrNull = (sel) => {
      const t = container.find(sel).first().text().trim();
      return t || null;
    };

    // 🔽 broaden price selectors + keep original text for debugging
    const priceText =
      textOrNull('[class*="Price"]') ||
      textOrNull('[data-rf-test-id="homecard-price"]') ||
      textOrNull('.homecardV2Price') ||
      textOrNull('[data-testid="price"]') ||
      textOrNull('[data-rf-test-id="abp-price"] > span') ||
      // last-ditch: scan the card text for a $123,456 pattern
      (PRICE_RE.test(container.text()) ? container.text().match(PRICE_RE)?.[0] || null : null);

    // ✅ numeric price (Number) for saving to Mongo
    const price = parsePrice(priceText);

    // ✅ Use improved address extraction with multiple fallbacks
    const address = extractAddress(container);

    const statsText = container
      .find('[class*="Stats"], [data-rf-test-id*="homecard"]')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const mBeds  = statsText.match(/(\d+(?:\.\d+)?)\s*Beds?/i);
    const mBaths = statsText.match(/(\d+(?:\.\d+)?)\s*Baths?/i);
    const mSqft  = statsText.match(/([\d,]+)\s*Sq\.?\s*Ft/i);

    results.push({
      url: new URL(href, 'https://www.redfin.com').toString(),
      priceText,         // keep for diagnostics
      price,             // <-- use THIS in your saver: Number | null
      address,
      bedsText:  mBeds  ? mBeds[0]  : null,
      bathsText: mBaths ? mBaths[0] : null,
      sqftText:  mSqft  ? mSqft[0]  : null,
    });
  });

  const seen = new Set();
  return results.filter(r => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}