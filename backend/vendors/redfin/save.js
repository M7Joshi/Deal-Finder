// numeric helper that never returns 0 by default; returns null when absent
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// In ESM, default-importing a CommonJS model maps to its module.exports
import Property from '../../models/Property.js';
import RawProperty from '../../models/rawProperty.js';
import ScrapedDeal from '../../models/ScrapedDeal.js';

// Import batch limit checker
import { incrementAddressCount, shouldPauseScraping } from '../runAutomation.js';

export async function upsertRaw({ address, city, state, zip, price, beds, baths, sqft, raw, agentName, agentEmail }) {
  {
    const fullAddress = address || '';
    const fullAddress_ci = fullAddress.trim().toLowerCase();

    // Prefer the explicit `price` then common raw aliases
    const cand = price ?? raw?.listingPrice ?? raw?.listPrice ?? raw?.asking_price ?? raw?.lp;
    const priceNum = num(cand);

    // Build $set dynamically so we don't overwrite a good value with null
    const setDoc = {
      fullAddress,
      fullAddress_ci,
      address: fullAddress,
      city: city || '',
      state: (state || '').toUpperCase(),
      zip: zip || '',
      details: { beds, baths, sqft, _raw: raw || {} },
      agent_name: agentName ?? null,
      agent_email: agentEmail ?? null,
      status: 'scraped',
    };

    // Only set price fields when we actually have one
    if (priceNum != null) {
      setDoc.price = priceNum;
      setDoc.listingPrice = priceNum;
    }

    await RawProperty.updateOne(
      { fullAddress: fullAddress },
      { $set: setDoc },
      { upsert: true }
    );

    // Also save to ScrapedDeal for Deals page (auto-calculates isDeal when AMV is added)
    try {
      await ScrapedDeal.updateOne(
        { fullAddress_ci },
        {
          $set: {
            address: fullAddress.split(',')[0]?.trim() || fullAddress,
            fullAddress,
            fullAddress_ci,
            city: city || null,
            state: (state || '').toUpperCase() || null,
            zip: zip || null,
            listingPrice: priceNum || null,
            beds: num(beds) || null,
            baths: num(baths) || null,
            sqft: num(sqft) || null,
            // Save agent details from Redfin
            agentName: agentName || null,
            agentEmail: agentEmail || null,
            source: 'redfin',
            scrapedAt: new Date(),
          },
          $setOnInsert: {
            amv: null,
            isDeal: false,
          }
        },
        { upsert: true }
      );
      // Increment batch counter for Redfin addresses
      incrementAddressCount();
    } catch (e) {
      // Silent fail - don't break the main flow
    }
  }
}

// Export for runner to check batch limit
export { shouldPauseScraping };

export async function upsertProperty({ prop_id, address, city, state, zip, price, beds, baths, sqft, built, raw, agentName, agentEmail, agentPhone, brokerage }) {
  {
    const fullAddress = address || '';
    const fullAddress_ci = fullAddress.trim().toLowerCase();

    // compute price from candidate fields
    const cand = price ?? raw?.listingPrice ?? raw?.listPrice ?? raw?.asking_price ?? raw?.lp;
    const priceNum = num(cand);

    // Always use fullAddress_ci as primary filter to avoid duplicate key errors
    // (fullAddress_ci has a unique index, so we must match on it)
    const filter = { fullAddress_ci };

    // Build $set without clobbering existing numeric fields with null
    const setDoc = {
      prop_id: prop_id ?? null,
      fullAddress,
      fullAddress_ci,
      address: fullAddress,
      city: city || '',
      state: (state || '').toUpperCase(),
      zip: zip || '',
      details: {
        ...(beds != null ? { beds } : {}),
        ...(baths != null ? { baths } : {}),
        ...(sqft != null ? { sqft } : {}),
        ...(built != null ? { built } : {}),
        _raw: raw || {}
      },
      agentName: agentName ?? null,
      agentEmail: agentEmail ?? null,
      agentPhone: agentPhone ?? null,
      brokerage: brokerage ?? null,
      // flag downstream pipelines to (re)pull vendor valuations if needed
      needs_vendor_valuations: true
    };

    // Only include price fields if we actually have a value; never write null/0 by default
    if (priceNum != null) {
      setDoc.listingPrice = priceNum; // keep a dedicated listing price
      setDoc.price = priceNum;        // and mirror into legacy `price`
    }

    await Property.updateOne(
      filter,
      { $set: setDoc },
      { upsert: true }
    );

    // Also save to ScrapedDeal for Deals page (auto-calculates isDeal when AMV is added)
    try {
      await ScrapedDeal.updateOne(
        { fullAddress_ci },
        {
          $set: {
            address: fullAddress.split(',')[0]?.trim() || fullAddress,
            fullAddress,
            fullAddress_ci,
            city: city || null,
            state: (state || '').toUpperCase() || null,
            zip: zip || null,
            listingPrice: priceNum || null,
            beds: num(beds) || null,
            baths: num(baths) || null,
            sqft: num(sqft) || null,
            // Save agent details from Redfin (deep scraped via Puppeteer)
            agentName: agentName || null,
            agentEmail: agentEmail || null,
            agentPhone: agentPhone || null,
            brokerage: brokerage || null,
            source: 'redfin',
            scrapedAt: new Date(),
          },
          $setOnInsert: {
            amv: null,
            isDeal: false,
          }
        },
        { upsert: true }
      );
    } catch (e) {
      // Silent fail - don't break the main flow
    }
  }
}