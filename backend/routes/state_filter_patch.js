const fs = require('fs');
const content = fs.readFileSync('live-scrape.js', 'utf8');

const oldCode = `    // Add to global addresses with deduplication
    for (const addr of addresses) {
      if (globalAddresses.length >= limitNum) break;
      const addrKey = addr.fullAddress.toLowerCase();
      if (!seenAddressKeys.has(addrKey)) {
        seenAddressKeys.add(addrKey);
        globalAddresses.push({
          ...addr,
          city: cityToUse,
          state: stateUpper,
          source: 'privy',
          scrapedAt: new Date().toISOString()
        });
      }
    }`;

const newCode = `    // Add to global addresses with deduplication AND state validation
    // Filter out addresses that don't match the requested state (Privy may show surrounding areas)
    for (const addr of addresses) {
      if (globalAddresses.length >= limitNum) break;

      // Extract state from address to validate it matches the requested state
      // Address format: "123 Main St, City, ST 12345"
      const addrParts = (addr.fullAddress || '').split(',').map(p => p.trim());
      if (addrParts.length >= 3) {
        const stateZipPart = addrParts[addrParts.length - 1]; // Last part: "ST 12345"
        const extractedState = stateZipPart.split(/\s+/)[0]?.toUpperCase();

        // Skip addresses that don't match the requested state
        if (extractedState && extractedState !== stateUpper) {
          L.warn(\`Skipping address from wrong state: \${addr.fullAddress} (expected \${stateUpper}, got \${extractedState})\`);
          continue;
        }
      }

      const addrKey = addr.fullAddress.toLowerCase();
      if (!seenAddressKeys.has(addrKey)) {
        seenAddressKeys.add(addrKey);
        globalAddresses.push({
          ...addr,
          city: cityToUse,
          state: stateUpper,
          source: 'privy',
          scrapedAt: new Date().toISOString()
        });
      }
    }`;

if (content.includes(oldCode)) {
  const updated = content.replace(oldCode, newCode);
  fs.writeFileSync('live-scrape.js', updated, 'utf8');
  console.log('Patched successfully!');
} else {
  console.log('Pattern not found - may already be patched or file changed');
}
