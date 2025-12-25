// backend/vendors/redfin/detailParser.js
import * as cheerio from 'cheerio';

export function parseDetailHtml(html) {
  const $ = cheerio.load(html);
  const out = { raw: {} };

  // Prefer JSON-LD when present
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const obj = JSON.parse($(el).contents().text());
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        if (['House', 'Residence', 'SingleFamilyResidence'].includes(item['@type'])) {
          out.raw.jsonld = item;
          if (item.price) out.price = Number(item.price);
          if (item.numberOfRooms) out.beds = Number(item.numberOfRooms);
          if (item.numberOfBathroomsTotal) out.baths = Number(item.numberOfBathroomsTotal);
          if (item.floorSize?.value) out.sqft = Number(item.floorSize.value);
          if (item.datePosted) out.listedAt = item.datePosted;
          if (Array.isArray(item.image)) out.images = item.image;
        }
      }
    } catch {}
  });

  const bodyText = $('body').text();

  if (out.price == null) {
    const m = bodyText.match(/\$[\d,]+/);
    if (m) out.price = Number(m[0].replace(/[^\d]/g, ''));
  }
  if (out.beds == null) {
    const m = bodyText.match(/(\d+(?:\.\d+)?)\s*Beds?/i);
    if (m) out.beds = Number(m[1]);
  }
  if (out.baths == null) {
    const m = bodyText.match(/(\d+(?:\.\d+)?)\s*Baths?/i);
    if (m) out.baths = Number(m[1]);
  }
  if (out.sqft == null) {
    const m = bodyText.match(/([\d,]+)\s*(?:Sq\.?\s*Ft|Square Feet)/i);
    if (m) out.sqft = Number(m[1].replace(/[^\d]/g, ''));
  }

  const hoaMatch = bodyText.match(/HOA(?:\s*Fees?)?:?\s*(Yes|No)/i);
  if (hoaMatch) out.hoa = hoaMatch[1];

  // PRIORITY 1: Extract agent from "Listing agent: Name (phone)" pattern (most reliable)
  const listingAgentMatch = bodyText.match(/Listing\s+agent:\s*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i);
  if (listingAgentMatch) {
    out.agentName = listingAgentMatch[1].trim();
    out.agentPhone = listingAgentMatch[2].trim();
  }

  // PRIORITY 2: Try specific agent selectors (avoid nav menus)
  if (!out.agentName) {
    const specificSelectors = [
      '.agent-basic-details--heading span',
      '.listing-agent-name',
      '.agent-info-content .name',
      '[data-testid="listing-agent-name"]'
    ];
    for (const sel of specificSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const text = el.text().trim();
        // Validate it looks like a name (2-4 words, no special chars like ▾)
        if (text && /^[A-Za-z]+(\s+[A-Za-z]+){0,3}$/.test(text) && !text.includes('▾')) {
          out.agentName = text;
          break;
        }
      }
    }
  }

  // Extract phone from various patterns
  if (!out.agentPhone) {
    // Look for phone in contact section
    const phoneMatch = bodyText.match(/(?:Phone|Tel|Call|Contact)[:.]?\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i);
    if (phoneMatch) {
      out.agentPhone = phoneMatch[1].trim();
    }
  }

  // Extract email from mailto links
  $('a[href^="mailto:"]').each((_, el) => {
    if (out.agentEmail) return;
    const href = $(el).attr('href') || '';
    const email = href.replace('mailto:', '').split('?')[0].trim();
    // Skip Redfin emails
    if (email &&
        !email.toLowerCase().includes('redfin.com') &&
        !email.toLowerCase().includes('noreply')) {
      out.agentEmail = email;
    }
  });

  // Try to find brokerage
  const brokerageMatch = bodyText.match(/(?:Listing\s+provided\s+courtesy\s+of|Listed\s+by|Brokerage)[:.]?\s*([^(]+?)(?:\s*\(|$)/i);
  if (brokerageMatch) {
    out.brokerage = brokerageMatch[1].trim();
  }

  return out;
}