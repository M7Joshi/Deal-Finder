// Agent details extractor for Redfin property pages
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============ SHARED BROWSER FOR SPEED ============
// Reuse a single browser instance instead of launching new one each time
let sharedBrowser = null;
let browserLaunchPromise = null;
let pageCount = 0;
const MAX_PAGES_BEFORE_RESTART = 50; // Restart browser every 50 pages to prevent memory leaks

async function getSharedBrowser() {
  // Check if browser needs restart (memory management)
  if (sharedBrowser && pageCount >= MAX_PAGES_BEFORE_RESTART) {
    console.log('[AgentExtractor] Restarting browser after', pageCount, 'pages');
    try { await sharedBrowser.close(); } catch {}
    sharedBrowser = null;
    pageCount = 0;
  }

  // Return existing browser if connected
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  // Prevent multiple simultaneous browser launches
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  console.log('[AgentExtractor] Launching shared browser...');
  browserLaunchPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run'
    ]
  });

  sharedBrowser = await browserLaunchPromise;
  browserLaunchPromise = null;
  pageCount = 0;

  console.log('[AgentExtractor] Shared browser ready');
  return sharedBrowser;
}

// Close shared browser (call when done with batch)
export async function closeSharedBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
      console.log('[AgentExtractor] Shared browser closed');
    } catch {}
    sharedBrowser = null;
    pageCount = 0;
  }
}

/**
 * Extract agent details from a Redfin property detail page
 * @param {string} propertyUrl - Full URL to the Redfin property page
 * @returns {Object} Agent details including name, phone, email, brokerage
 */
export async function extractAgentDetails(propertyUrl) {
  let page = null;

  try {
    console.log(`[AgentExtractor] Extracting agent details from: ${propertyUrl}`);

    const browser = await getSharedBrowser();
    page = await browser.newPage();
    pageCount++;

    await page.setUserAgent(USER_AGENT);

    // Navigate to property page (reduced timeout for speed)
    await page.goto(propertyUrl, {
      waitUntil: 'domcontentloaded', // Faster than networkidle2
      timeout: 30000
    });

    // Reduced initial wait (agent info loads quickly)
    await sleep(1500);

    // Quick scroll to bottom to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 800; // Larger jumps for speed
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 50); // Faster interval
      });
    });

    // Reduced wait for lazy-loaded content
    await sleep(1000);

    // Extract agent information
    const agentInfo = await page.evaluate(() => {
      const result = {
        agentName: null,
        brokerage: null,
        phone: null,
        email: null,
        agentLicense: null,
        _debug: {} // Debug info to help troubleshoot
      };

      // Helper: Check if a string looks like a real US phone number (has dashes, dots, or spaces)
      const isValidPhoneFormat = (phone) => {
        if (!phone) return false;
        // Valid phone should have separators (dashes, dots, spaces, or parentheses)
        // e.g., "470-685-1179", "(404) 550-5560", "770.692.0888"
        // Invalid: "0903005004", "2600013606" (no separators = likely MLS ID)
        return /\d{3}[-.\s()]+\d{3}[-.\s]+\d{4}/.test(phone) ||
               /\(\d{3}\)\s*\d{3}[-.\s]\d{4}/.test(phone);
      };

      // Get full page text, normalized
      const bodyText = document.body.textContent || '';
      const normalizedText = bodyText.replace(/\s+/g, ' ');

      // PRIORITY 1: Look for "Listing agent: Name (phone)" format at the bottom of the page
      // This is the MOST RELIABLE source - the actual listing agent's phone
      // Format: "Listing agent: Britni Wade (470-685-1179)"

      // Debug: Check if "Listing agent" text exists at all
      const hasListingAgent = normalizedText.includes('Listing agent');
      result._debug.hasListingAgentText = hasListingAgent;

      // Try to extract the raw text around "Listing agent" for debugging
      if (hasListingAgent) {
        const idx = normalizedText.indexOf('Listing agent');
        result._debug.listingAgentContext = normalizedText.substring(idx, idx + 100);
      }

      const listingAgentPattern = /Listing\s+agent:\s*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i;
      const listingAgentMatch = normalizedText.match(listingAgentPattern);

      if (listingAgentMatch) {
        result._debug.foundListingAgent = listingAgentMatch[0];
        const phone = listingAgentMatch[2].trim();
        const name = listingAgentMatch[1].trim();

        // Always use the listing agent info - it's the most accurate
        result.phone = phone;
        result.agentName = name.split(' ').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
      }

      // PRIORITY 2: Look for brokerage from "Listing provided courtesy of: Brokerage (phone)"
      const courtesyPattern = /Listing\s+provided\s+courtesy\s+of:\s*([^(]+)\s*\((\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\)/i;
      const courtesyMatch = normalizedText.match(courtesyPattern);
      if (courtesyMatch) {
        result._debug.foundCourtesy = courtesyMatch[0];
        result.brokerage = courtesyMatch[1].trim();
      }

      // FALLBACK: If we didn't find listing agent, try other selectors
      if (!result.agentName) {
        const agentNameEl = document.querySelector('.agent-basic-details--heading span, .listing-agent-name');
        if (agentNameEl) {
          result.agentName = agentNameEl.textContent.trim();
        }
      }

      // Extract brokerage if not found
      if (!result.brokerage) {
        const brokerageEl = document.querySelector('.agent-basic-details--broker');
        if (brokerageEl) {
          const brokerageText = brokerageEl.textContent.trim();
          result.brokerage = brokerageText.replace(/^[•\s]+/, '').replace(/\s+$/, '').trim();
        }
      }

      // Try to find phone from DOM elements ONLY if we don't have one
      // AND validate it looks like a real phone number
      if (!result.phone) {
        const phoneEl = document.querySelector('.contactPhoneNumber');
        if (phoneEl) {
          const candidatePhone = phoneEl.textContent.trim();
          if (isValidPhoneFormat(candidatePhone)) {
            result.phone = candidatePhone;
            result._debug.phoneSource = 'contactPhoneNumber';
          }
        }
      }

      // Extract email
      const emailEl = document.querySelector('.contactEmail');
      if (emailEl) {
        result.email = emailEl.textContent.trim();
      }

      // Try to find email in mailto links
      if (!result.email) {
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        for (const link of mailtoLinks) {
          const href = link.getAttribute('href');
          const email = href.replace('mailto:', '').split('?')[0].trim();
          if (email &&
              !email.toLowerCase().includes('redfin.com') &&
              !email.toLowerCase().includes('redfin.net') &&
              !email.toLowerCase().includes('noreply') &&
              !email.toLowerCase().includes('fmls.com')) {
            result.email = email;
            break;
          }
        }
      }

      // LAST RESORT for email: Search for email pattern in page text
      if (!result.email) {
        // Match common email patterns, excluding system emails
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const allEmails = normalizedText.match(emailPattern) || [];
        for (const email of allEmails) {
          const lower = email.toLowerCase();
          // Skip system/platform emails
          if (lower.includes('redfin.com') ||
              lower.includes('redfin.net') ||
              lower.includes('noreply') ||
              lower.includes('fmls.com') ||
              lower.includes('mls.com') ||
              lower.includes('example.com') ||
              lower.includes('test.com')) {
            continue;
          }
          result.email = email;
          result._debug.emailSource = 'textPattern';
          break;
        }
      }

      // Extract license
      const licenseEl = document.querySelector('.agent-basic-details--license');
      if (licenseEl) {
        result.agentLicense = licenseEl.textContent.trim();
      }

      // Fallback: Try agent-info-section
      if (!result.agentName) {
        const agentSection = document.querySelector('.agent-info-section, .agent-info-content');
        if (agentSection) {
          const text = agentSection.textContent;
          const nameMatch = text.match(/Listed by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
          if (nameMatch) {
            result.agentName = nameMatch[1].trim();
          }

          if (!result.brokerage) {
            const brokerMatch = text.match(/[•\-]\s*([A-Z][A-Za-z\s&,.]+(?:LLC|Inc|Realty|Real Estate|Group|Properties))/);
            if (brokerMatch) {
              result.brokerage = brokerMatch[1].trim();
            }
          }
        }
      }

      // LAST RESORT: Search for phone pattern in page, but ONLY if it has proper formatting
      if (!result.phone) {
        // Match properly formatted phones like "470-685-1179" or "(404) 550-5560"
        const phonePatterns = [
          /\((\d{3})\)\s*(\d{3})[-.](\d{4})/,  // (404) 550-5560
          /(\d{3})[-.](\d{3})[-.](\d{4})/       // 470-685-1179 or 770.692.0888
        ];

        for (const pattern of phonePatterns) {
          const match = normalizedText.match(pattern);
          if (match) {
            // Reconstruct the phone number
            if (match[0].startsWith('(')) {
              result.phone = `(${match[1]}) ${match[2]}-${match[3]}`;
            } else {
              result.phone = `${match[1]}-${match[2]}-${match[3]}`;
            }
            result._debug.phoneSource = 'fallbackPattern';
            break;
          }
        }
      }

      return result;
    });

    // Log debug info outside of browser context
    if (agentInfo._debug) {
      console.log(`[AgentExtractor] Has "Listing agent" text: ${agentInfo._debug.hasListingAgentText}`);
      if (agentInfo._debug.listingAgentContext) {
        console.log(`[AgentExtractor] Context: "${agentInfo._debug.listingAgentContext}"`);
      }
      if (agentInfo._debug.foundListingAgent) {
        console.log(`[AgentExtractor] Found listing agent pattern: "${agentInfo._debug.foundListingAgent}"`);
      }
      if (agentInfo._debug.foundCourtesy) {
        console.log(`[AgentExtractor] Found courtesy pattern: "${agentInfo._debug.foundCourtesy}"`);
      }
      if (agentInfo._debug.phoneSource) {
        console.log(`[AgentExtractor] Phone source: ${agentInfo._debug.phoneSource}`);
      }
      if (agentInfo._debug.emailSource) {
        console.log(`[AgentExtractor] Email source: ${agentInfo._debug.emailSource}`);
      }
      delete agentInfo._debug;
    }

    // Close just the page, not the browser (reuse browser for next extraction)
    if (page) {
      try { await page.close(); } catch {}
    }

    console.log(`[AgentExtractor] Found agent:`, agentInfo);
    return agentInfo;

  } catch (error) {
    console.error(`[AgentExtractor] Error extracting agent details:`, error.message);
    // Close just the page on error, keep browser alive
    if (page) {
      try { await page.close(); } catch {}
    }
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
  const { maxConcurrent = 3, delay = 2000 } = options;
  const results = [];

  console.log(`[AgentExtractor] Extracting agent details for ${properties.length} properties...`);

  // Process in batches to avoid overwhelming the server
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

    // Delay between batches
    if (i + maxConcurrent < properties.length) {
      await sleep(delay);
    }
  }

  console.log(`[AgentExtractor] Completed extraction for ${results.length} properties`);
  return results;
}

export default { extractAgentDetails, extractAgentDetailsForProperties };
