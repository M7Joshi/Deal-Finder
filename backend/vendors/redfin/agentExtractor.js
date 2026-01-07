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
      const result = { agentName: null, agentPhone: null, agentEmail: null, brokerage: null, brokerPhone: null, brokerEmail: null };

      // Get all text on the page
      const bodyText = document.body.innerText || '';

      // Pattern 1: "Listed by Agent Name • Brokerage • Phone • email"
      const listedByMatch = bodyText.match(/Listed by\s+([A-Za-z\s.]+?)(?:\s*[•·]|$)/i);
      if (listedByMatch && listedByMatch[1]) {
        result.agentName = listedByMatch[1].trim();
      }

      // Pattern 2: "Listing agent: Jill Colety (603-923-0753)"
      const listingAgentMatch = bodyText.match(/Listing agent:\s*([A-Za-z\s.]+?)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i);
      if (listingAgentMatch) {
        if (!result.agentName) result.agentName = listingAgentMatch[1].trim();
        if (!result.agentPhone) result.agentPhone = listingAgentMatch[2].replace(/[^\d]/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      }

      // Pattern 3: "Listing provided courtesy of: Alex & Associates Realty (603-403-1606)"
      const courtesyMatch = bodyText.match(/Listing provided courtesy of:\s*([^(]+?)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i);
      if (courtesyMatch) {
        if (!result.brokerage) result.brokerage = courtesyMatch[1].trim();
        // This is broker phone (from "Listing provided courtesy of")
        if (!result.brokerPhone) result.brokerPhone = courtesyMatch[2].replace(/[^\d]/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      }

      // Look for brokerage after first bullet (for "Listed by" format)
      if (!result.brokerage) {
        const brokerageMatch = bodyText.match(/Listed by[^•·]*[•·]\s*([^•·\n]+?)(?:\s*[•·]|Contact:|$)/i);
        if (brokerageMatch && brokerageMatch[1]) {
          const candidate = brokerageMatch[1].trim();
          // Make sure it's not a phone number and not property stats like "5.5 ba" or "beds"
          if (!/^\(?\d{3}\)?[-.\s]?\d{3}/.test(candidate) &&
              !/^\d+(\.\d+)?\s*(ba|bed|bath|sq\.?\s*ft)/i.test(candidate) &&
              candidate.length > 3) {
            result.brokerage = candidate;
          }
        }
      }

      // Look for phone number after bullet point (for "Listed by" format)
      // First check for broker phone pattern "• xxx-xxx-xxxx (broker)"
      const brokerPhoneMatch = bodyText.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\s*\(broker\)/i);
      if (brokerPhoneMatch) {
        const phone = `${brokerPhoneMatch[1]}-${brokerPhoneMatch[2]}-${brokerPhoneMatch[3]}`;
        if (!phone.includes('844-759-7732') && !result.brokerPhone) {
          result.brokerPhone = phone;
        }
      }

      // Then look for agent phone (without broker label or with agent label)
      if (!result.agentPhone) {
        // Try agent-specific pattern first
        const agentPhoneMatch = bodyText.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\s*\(agent\)/i);
        if (agentPhoneMatch) {
          const phone = `${agentPhoneMatch[1]}-${agentPhoneMatch[2]}-${agentPhoneMatch[3]}`;
          if (!phone.includes('844-759-7732')) {
            result.agentPhone = phone;
          }
        }
        // Then try generic phone (without any label) - only if no broker label
        if (!result.agentPhone) {
          const phoneMatch = bodyText.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?!\s*\(broker\))/i);
          if (phoneMatch) {
            const phone = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;
            if (!phone.includes('844-759-7732')) {
              result.agentPhone = phone;
            }
          }
        }
      }

      // Look for email pattern - first check for broker email "• email (broker)"
      const brokerEmailMatch = bodyText.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\(broker\)/i);
      if (brokerEmailMatch && brokerEmailMatch[1]) {
        const email = brokerEmailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com') && !result.brokerEmail) {
          result.brokerEmail = brokerEmailMatch[1].trim();
        }
      }

      // Then look for agent email (without broker label)
      const emailAfterBullet = bodyText.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?!\s*\(broker\))/i);
      if (emailAfterBullet && emailAfterBullet[1]) {
        const email = emailAfterBullet[1].toLowerCase();
        if (!email.includes('@redfin.com') && !result.agentEmail) {
          result.agentEmail = emailAfterBullet[1].trim();
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

        // Look for email in the section before "More real estate resources"
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

      // Look for email in "Listed by" section (any format)
      if (!result.agentEmail) {
        const listedBySection = bodyText.match(/Listed by[^]*?(?=More real estate|Property details|$)/i);
        if (listedBySection && listedBySection[0]) {
          const emailInSection = listedBySection[0].match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (emailInSection && emailInSection[1]) {
            const email = emailInSection[1].toLowerCase();
            if (!email.includes('@redfin.com')) {
              result.agentEmail = emailInSection[1].trim();
            }
          }
        }
      }

      // Final fallback: Look for ANY email on the page (excluding redfin.com)
      if (!result.agentEmail) {
        const allEmails = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        for (const email of allEmails) {
          const lower = email.toLowerCase();
          if (!lower.includes('@redfin.com') && !lower.includes('noreply') && !lower.includes('support')) {
            result.agentEmail = email.trim();
            break;
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

    // Always try HTTP fallback to get agent name from JSON if Puppeteer didn't find it
    // HTTP JSON parsing is more reliable for agent name
    console.log(`[AgentExtractor] Puppeteer found: ${puppeteerResult?.agentName || 'N/A'}, ${puppeteerResult?.agentPhone || 'N/A'}, ${puppeteerResult?.agentEmail || 'N/A'}`);

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
    let brokerPhone = null;
    let brokerEmail = null;

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

    // Method 1d: Extract email from "Contact: email@domain.com" pattern (plain text)
    // Uses explicit TLD list to avoid capturing extra characters
    if (!agentEmail) {
      const contactTextMatch = html.match(/Contact:(?:\s|<!--.*?-->)*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|net|org|edu|gov|io|co|info))/i);
      if (contactTextMatch && contactTextMatch[1]) {
        const email = contactTextMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactTextMatch[1].trim();
        }
      }
    }

    // Method 1d2: Extract email from "Contact: (phone), email" pattern (email after phone)
    if (!agentEmail) {
      const contactAfterPhoneMatch = html.match(/Contact:[^<]*?\d{3}[-.\s)]+\d{3}[-.\s]+\d{4}[,\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|net|org|edu|gov|io|co|info))/i);
      if (contactAfterPhoneMatch && contactAfterPhoneMatch[1]) {
        const email = contactAfterPhoneMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          agentEmail = contactAfterPhoneMatch[1].trim();
        }
      }
    }

    // Method 1d3: Extract email anywhere on the Contact line
    if (!agentEmail) {
      const contactLineMatch = html.match(/Contact:[^<]{0,100}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|net|org|edu|gov|io|co|info))/i);
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

    // Method 1f: Extract broker email pattern "• email@domain.com (broker)"
    // Store in brokerEmail field (separate from agentEmail)
    if (!brokerEmail) {
      const brokerEmailMatch = html.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\(broker\)/i);
      if (brokerEmailMatch && brokerEmailMatch[1]) {
        const email = brokerEmailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com')) {
          brokerEmail = brokerEmailMatch[1].trim();
        }
      }
    }

    // Method 1g: Extract any email after bullet (without broker label)
    // Format: "• email@domain.com" - used when no (broker) label present
    if (!agentEmail) {
      const bulletEmailMatch = html.match(/[•·]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (bulletEmailMatch && bulletEmailMatch[1]) {
        const email = bulletEmailMatch[1].toLowerCase();
        if (!email.includes('@redfin.com') && !email.includes('noreply') && !email.includes('support')) {
          agentEmail = bulletEmailMatch[1].trim();
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

    // Method 3: Extract brokerage from JSON (handles unicode escapes like \u0026)
    const brokerMatch = html.match(/brokerName\\?":\\?"([^"]+?)(?:\\"|")/);
    if (brokerMatch && brokerMatch[1]) {
      // Decode unicode escapes (e.g., \u0026 -> &) and clean up escaped characters
      let brokerName = brokerMatch[1].trim();
      brokerName = brokerName.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      brokerName = brokerName.replace(/\\(.)/g, '$1'); // Unescape all escaped characters (\& -> &)
      brokerage = brokerName;
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
        let candidate = bulletBrokerMatch[1].trim();
        // Decode HTML entities (e.g., &amp; -> &)
        candidate = candidate.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
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

    // Method 4c: Look for broker phone pattern "• xxx-xxx-xxxx (broker)"
    // Store in brokerPhone field (separate from agentPhone)
    if (!brokerPhone) {
      const brokerPhoneMatch = html.match(/[•·]\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\s*\(broker\)/i);
      if (brokerPhoneMatch) {
        brokerPhone = `${brokerPhoneMatch[1]}-${brokerPhoneMatch[2]}-${brokerPhoneMatch[3]}`;
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

    // Merge HTTP results with Puppeteer results (Puppeteer may have JS-rendered data)
    // Priority: HTTP JSON > Puppeteer for agent name (more reliable)
    // Priority: Puppeteer > HTTP for phone/email (JS-rendered content)
    const finalAgentName = agentName || puppeteerResult?.agentName || null;
    const finalBrokerage = brokerage || puppeteerResult?.brokerage || null;
    const finalAgentPhone = puppeteerResult?.agentPhone || agentPhone || null;
    const finalAgentEmail = puppeteerResult?.agentEmail || agentEmail || null;
    const finalBrokerPhone = puppeteerResult?.brokerPhone || brokerPhone || null;
    const finalBrokerEmail = puppeteerResult?.brokerEmail || brokerEmail || null;

    // Apply fallback logic: agent > broker for each field independently
    // Name: agent name > broker name
    const displayName = finalAgentName || finalBrokerage || null;
    // Phone: agent phone > broker phone
    const displayPhone = finalAgentPhone || finalBrokerPhone || null;
    // Email: agent email > broker email
    const displayEmail = finalAgentEmail || finalBrokerEmail || null;

    console.log(`[AgentExtractor] Final: ${displayName || 'N/A'}, ${displayPhone || 'N/A'}, ${displayEmail || 'N/A'}, ${finalBrokerage || 'N/A'}`);

    return {
      agentName: displayName,
      agentPhone: displayPhone,
      email: displayEmail,
      brokerage: finalBrokerage,
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
