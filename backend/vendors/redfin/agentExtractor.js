// Agent details extractor for Redfin property pages
// Uses HTTP + JSON parsing (same as Redfin Fetcher) instead of Puppeteer for speed

import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extract agent details from a Redfin property detail page using HTTP + JSON parsing
 * This matches the Redfin Fetcher method for consistency
 * @param {string} propertyUrl - Full URL to the Redfin property page
 * @returns {Object} Agent details including name, phone, email, brokerage
 */
export async function extractAgentDetails(propertyUrl) {
  try {
    console.log(`[AgentExtractor] Extracting agent details from: ${propertyUrl}`);

    // Fetch the page HTML via HTTP (much faster than Puppeteer)
    const response = await axios.get(propertyUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    const html = response.data;
    let agentName = null;
    let agentPhone = null;
    let agentEmail = null;
    let brokerage = null;

    // Method 1: Extract from embedded JSON data in the page
    // Redfin embeds listing data as JSON in the HTML - handles both escaped (\") and non-escaped (") quotes
    // Pattern: listingAgentName":"Name" OR listingAgentName\":\"Name\"
    const agentNameMatch = html.match(/listingAgentName\\?":\\?"([^"\\]+)/);
    if (agentNameMatch && agentNameMatch[1]) {
      agentName = agentNameMatch[1].trim();
    }

    const agentPhoneMatch = html.match(/listingAgentNumber\\?":\\?"([^"\\]+)/);
    if (agentPhoneMatch && agentPhoneMatch[1]) {
      agentPhone = agentPhoneMatch[1].trim();
    }

    // Extract agent email from JSON - pattern: "agentEmailAddress":"email@domain.com"
    const agentEmailMatch = html.match(/agentEmailAddress\\?":\\?"([^"\\]+@[^"\\]+)/);
    if (agentEmailMatch && agentEmailMatch[1]) {
      agentEmail = agentEmailMatch[1].trim();
    }

    // Method 1b: Extract email from HTML contactEmail link - <a class="contactEmail" href="mailto:xxx@xxx.com">
    if (!agentEmail) {
      const contactEmailMatch = html.match(/class="contactEmail"[^>]*href="mailto:([^"]+)"/);
      if (contactEmailMatch && contactEmailMatch[1]) {
        agentEmail = contactEmailMatch[1].split('?')[0].trim();
      }
    }

    // Method 1c: Extract email from any mailto link in agent contact section
    if (!agentEmail) {
      const mailtoMatch = html.match(/href="mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
      if (mailtoMatch && mailtoMatch[1]) {
        // Exclude generic redfin emails
        const email = mailtoMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = mailtoMatch[1].trim();
        }
      }
    }

    // Method 1d: Extract email from "Contact: email@domain.com, phone" pattern (plain text)
    if (!agentEmail) {
      const contactTextMatch = html.match(/Contact:(?:\s|<!--.*?-->)*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (contactTextMatch && contactTextMatch[1]) {
        const email = contactTextMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactTextMatch[1].trim();
        }
      }
    }

    // Method 1e: Extract any email near agent/listing text as last resort
    if (!agentEmail) {
      // Look for email addresses that appear after "Listed by" or near agent info
      const agentSectionMatch = html.match(/Listed by[^<]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (agentSectionMatch && agentSectionMatch[1]) {
        const email = agentSectionMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = agentSectionMatch[1].trim();
        }
      }
    }

    // Method 2: Try alternative JSON patterns (agentName in listingAgents array)
    if (!agentName) {
      const altNameMatch = html.match(/agentName\\?":\\?"([^"\\]+)/);
      if (altNameMatch && altNameMatch[1]) {
        agentName = altNameMatch[1].trim();
      }
    }

    // Method 3: Extract brokerage from JSON
    const brokerMatch = html.match(/brokerName\\?":\\?"([^"\\]+)/);
    if (brokerMatch && brokerMatch[1]) {
      brokerage = brokerMatch[1].trim();
    }

    // Method 3b: Try "Listing provided by" pattern
    if (!brokerage) {
      const providedByMatch = html.match(/Listing provided by[:\s]*([^<]+?)(?:<|$)/i);
      if (providedByMatch && providedByMatch[1]) {
        brokerage = providedByMatch[1].trim();
      }
    }

    // Method 3c: Extract brokerage from "Listed by Name • Brokerage" pattern
    if (!brokerage) {
      const bulletBrokerMatch = html.match(/Listed by[^•·<]*[•·]\s*([^<\n]+?)(?:\s*<|Contact:|$)/i);
      if (bulletBrokerMatch && bulletBrokerMatch[1]) {
        const candidate = bulletBrokerMatch[1].trim();
        // Make sure it's not a phone number
        if (candidate && !/^\(?\d{3}\)?[-.\s]?\d{3}/.test(candidate)) {
          brokerage = candidate;
        }
      }
    }

    // Method 3d: Extract brokerage from officeName in JSON
    if (!brokerage) {
      const officeMatch = html.match(/officeName\\?":\\?"([^"\\]+)/);
      if (officeMatch && officeMatch[1]) {
        brokerage = officeMatch[1].trim();
      }
    }

    // Method 4: Fallback - Look for phone in tel: links
    if (!agentPhone) {
      const telMatch = html.match(/href="tel:([^"]+)"/);
      if (telMatch && telMatch[1]) {
        agentPhone = telMatch[1].replace(/[^\d-]/g, '');
      }
    }

    // Method 4b: Look for "Contact: (xxx) xxx-xxxx" pattern in plain text
    if (!agentPhone) {
      const contactPhoneMatch = html.match(/Contact:(?:\s|&nbsp;|<!--.*?-->)*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i);
      if (contactPhoneMatch) {
        agentPhone = `${contactPhoneMatch[1]}-${contactPhoneMatch[2]}-${contactPhoneMatch[3]}`;
      }
    }

    // Method 4c: Look for phone number after bullet point near agent info
    if (!agentPhone) {
      const bulletPhoneMatch = html.match(/[•·]\s*(?:[^<]*?)\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/);
      if (bulletPhoneMatch) {
        agentPhone = `${bulletPhoneMatch[1]}-${bulletPhoneMatch[2]}-${bulletPhoneMatch[3]}`;
      }
    }

    // Method 5: Fallback - Look for "Listed by" pattern in plain text
    if (!agentName) {
      const listedByMatch = html.match(/Listed by\s+([A-Za-z\s]+?)(?:\s*[•·]|\s*<|$)/);
      if (listedByMatch && listedByMatch[1]) {
        agentName = listedByMatch[1].trim();
      }
    }

    // Method 6: Extract phone from "Listing agent: Name (phone)" pattern
    if (!agentPhone) {
      const listingAgentPattern = /Listing\s+agent:\s*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i;
      const listingAgentMatch = html.match(listingAgentPattern);
      if (listingAgentMatch) {
        if (!agentName) {
          agentName = listingAgentMatch[1].trim();
        }
        agentPhone = listingAgentMatch[2].trim();
      }
    }

    console.log(`[AgentExtractor] Found: ${agentName || 'N/A'}, ${agentPhone || 'N/A'}, ${agentEmail || 'N/A'}, ${brokerage || 'N/A'}`);

    return {
      agentName: agentName || null,
      agentPhone: agentPhone || null,
      email: agentEmail || null,
      brokerage: brokerage || null,
      agentLicense: null
    };

  } catch (error) {
    console.error(`[AgentExtractor] Error extracting agent details:`, error.message);
    return {
      agentName: null,
      brokerage: null,
      phone: null,
      email: null,
      agentLicense: null
    };
  }
}

/**
 * Extract agent details for multiple properties
 * @param {Array} properties - Array of property objects with URLs
 * @param {Object} options - Options for extraction
 * @returns {Array} Properties with agent details added
 */
export async function extractAgentDetailsForProperties(properties, options = {}) {
  const { maxConcurrent = 5, delay = 500 } = options; // Faster now that we use HTTP
  const results = [];

  console.log(`[AgentExtractor] Extracting agent details for ${properties.length} properties (HTTP mode)...`);

  // Process in batches
  for (let i = 0; i < properties.length; i += maxConcurrent) {
    const batch = properties.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (property) => {
      if (!property.url) {
        return { ...property, agent: null };
      }

      try {
        const agentInfo = await extractAgentDetails(property.url);
        return {
          ...property,
          agent: agentInfo
        };
      } catch (error) {
        console.error(`Error extracting agent for ${property.url}:`, error.message);
        return { ...property, agent: null };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Delay between batches (shorter now since we're not using browser)
    if (i + maxConcurrent < properties.length) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`[AgentExtractor] Completed extraction for ${results.length} properties`);
  return results;
}

// No longer need browser cleanup since we're using HTTP
export async function closeSharedBrowser() {
  // No-op for backward compatibility
  console.log('[AgentExtractor] closeSharedBrowser called (no browser to close in HTTP mode)');
}

export default { extractAgentDetails, extractAgentDetailsForProperties, closeSharedBrowser };
