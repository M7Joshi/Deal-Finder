// Agent details extractor for Redfin property pages
// Uses Puppeteer to render JavaScript content for agent phone/email extraction
// Falls back to HTTP if Puppeteer fails

import axios from 'axios';
import puppeteer from 'puppeteer';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Shared browser instance for efficiency
let sharedBrowser = null;

async function getSharedBrowser() {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }
  return sharedBrowser;
}

/**
 * Extract agent details using Puppeteer (can see JavaScript-rendered content)
 * This captures the "Listed by Agent • Brokerage • Phone • Email" section
 */
async function extractAgentWithPuppeteer(propertyUrl) {
  let page = null;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate and wait for content to load
    await page.goto(propertyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait a bit for dynamic content
    await new Promise(r => setTimeout(r, 2000));

    // Extract agent info from the rendered page
    const agentInfo = await page.evaluate(() => {
      const result = { agentName: null, agentPhone: null, agentEmail: null, brokerage: null };

      // Get all text on the page
      const bodyText = document.body.innerText || '';

      // Look for "Listed by Agent Name" pattern
      // Format: "Listed by Agent Name • Brokerage • Phone (broker) • email (broker)"
      const listedByMatch = bodyText.match(/Listed by\s+([A-Za-z\s.]+?)(?:\s*[•·]|$)/i);
      if (listedByMatch && listedByMatch[1]) {
        result.agentName = listedByMatch[1].trim();
      }

      // Look for brokerage after first bullet
      const brokerageMatch = bodyText.match(/Listed by[^•·]*[•·]\s*([^•·\n]+?)(?:\s*[•·]|Contact:|$)/i);
      if (brokerageMatch && brokerageMatch[1]) {
        const candidate = brokerageMatch[1].trim();
        // Make sure it's not a phone number
        if (!/^\(?\d{3}\)?[-.\s]?\d{3}/.test(candidate)) {
          result.brokerage = candidate;
        }
      }

      // Look for phone number pattern (xxx) xxx-xxxx or xxx-xxx-xxxx
      const phoneMatch = bodyText.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?:\s*\((?:broker|agent)\))?/i);
      if (phoneMatch) {
        result.agentPhone = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;
      }

      // Look for email pattern
      const emailMatch = bodyText.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\s*\((?:broker|agent)\))?/i);
      if (emailMatch && emailMatch[1]) {
        const email = emailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          result.agentEmail = emailMatch[1].trim();
        }
      }

      // Alternative: Look near "More real estate resources" heading
      const moreResourcesSection = bodyText.split(/More real estate resources/i)[0] || '';
      if (moreResourcesSection) {
        // Look for phone in the section before "More real estate resources"
        if (!result.agentPhone) {
          const sectionPhoneMatch = moreResourcesSection.match(/\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?:\s*\((?:broker|agent)\))?/);
          if (sectionPhoneMatch) {
            result.agentPhone = `${sectionPhoneMatch[1]}-${sectionPhoneMatch[2]}-${sectionPhoneMatch[3]}`;
          }
        }

        // Look for email in the section
        if (!result.agentEmail) {
          const sectionEmailMatch = moreResourcesSection.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\s*\((?:broker|agent)\))?/);
          if (sectionEmailMatch && sectionEmailMatch[1]) {
            const email = sectionEmailMatch[1].toLowerCase();
            if (!email.includes('@redfin.com')) {
              result.agentEmail = sectionEmailMatch[1].trim();
            }
          }
        }
      }

      return result;
    });

    await page.close();
    return agentInfo;

  } catch (error) {
    console.error(`[AgentExtractor] Puppeteer error: ${error.message}`);
    if (page) await page.close().catch(() => {});
    return null;
  }
}

/**
 * Extract agent details from a Redfin property detail page
 * Uses Puppeteer first (to see JS-rendered content), falls back to HTTP
 * @param {string} propertyUrl - Full URL to the Redfin property page
 * @returns {Object} Agent details including name, phone, email, brokerage
 */
export async function extractAgentDetails(propertyUrl) {
  try {
    console.log(`[AgentExtractor] Extracting agent details from: ${propertyUrl}`);

    // Try Puppeteer first (can see JavaScript-rendered agent info)
    const puppeteerResult = await extractAgentWithPuppeteer(propertyUrl);
    if (puppeteerResult && (puppeteerResult.agentPhone || puppeteerResult.agentEmail)) {
      console.log(`[AgentExtractor] Puppeteer found: ${puppeteerResult.agentName || 'N/A'}, ${puppeteerResult.agentPhone || 'N/A'}, ${puppeteerResult.agentEmail || 'N/A'}`);
      return {
        agentName: puppeteerResult.agentName || null,
        agentPhone: puppeteerResult.agentPhone || null,
        email: puppeteerResult.agentEmail || null,
        brokerage: puppeteerResult.brokerage || null,
        agentLicense: null
      };
    }

    // Fall back to HTTP method if Puppeteer didn't find phone/email
    console.log(`[AgentExtractor] Puppeteer didn't find phone/email, trying HTTP fallback...`);

    // Fetch the page HTML via HTTP (faster but can't see JS content)
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

    // Method 1d2: Extract email from "Contact: (phone), email" pattern (email after phone)
    if (!agentEmail) {
      const contactAfterPhoneMatch = html.match(/Contact:[^<]*?\d{3}[-.\s)]+\d{3}[-.\s]+\d{4}[,\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (contactAfterPhoneMatch && contactAfterPhoneMatch[1]) {
        const email = contactAfterPhoneMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactAfterPhoneMatch[1].trim();
        }
      }
    }

    // Method 1d3: Extract email anywhere on the Contact line
    if (!agentEmail) {
      const contactLineMatch = html.match(/Contact:[^<]{0,100}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (contactLineMatch && contactLineMatch[1]) {
        const email = contactLineMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactLineMatch[1].trim();
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

    // Method 1f: Extract broker email pattern "•broker@domain.com (broker)" or email followed by (broker)
    if (!agentEmail) {
      const brokerEmailMatch = html.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\s*\(broker\))?/i);
      if (brokerEmailMatch && brokerEmailMatch[1]) {
        const email = brokerEmailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = brokerEmailMatch[1].trim();
        }
      }
    }

    // Method 1g: Look for email with (broker) label
    if (!agentEmail) {
      const brokerLabelEmailMatch = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\(broker\)/i);
      if (brokerLabelEmailMatch && brokerLabelEmailMatch[1]) {
        const email = brokerLabelEmailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = brokerLabelEmailMatch[1].trim();
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

    // Method 4d: Look for broker phone pattern "•304-262-8700 (broker)" or "• 304-262-8700"
    if (!agentPhone) {
      const brokerPhoneMatch = html.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?:\s*\(broker\))?/i);
      if (brokerPhoneMatch) {
        agentPhone = `${brokerPhoneMatch[1]}-${brokerPhoneMatch[2]}-${brokerPhoneMatch[3]}`;
      }
    }

    // Method 4e: Look for any phone number with (broker) label
    if (!agentPhone) {
      const brokerLabelMatch = html.match(/\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\s*\(broker\)/i);
      if (brokerLabelMatch) {
        agentPhone = `${brokerLabelMatch[1]}-${brokerLabelMatch[2]}-${brokerLabelMatch[3]}`;
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

// Close the shared browser when done
export async function closeSharedBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
      sharedBrowser = null;
      console.log('[AgentExtractor] Shared browser closed');
    } catch (e) {
      console.error('[AgentExtractor] Error closing browser:', e.message);
    }
  }
}

export default { extractAgentDetails, extractAgentDetailsForProperties, closeSharedBrowser };
