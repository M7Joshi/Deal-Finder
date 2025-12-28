// Live scraping endpoint - fetches addresses directly from Privy.pro
// Saves to ScrapedDeal for Pending AMV display

import express from 'express';
import { EventEmitter } from 'events';
import ScrapedDeal from '../models/ScrapedDeal.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';
import PrivyBot from '../vendors/privy/privyBot.js';
import * as sessionStore from '../vendors/privy/auth/sessionStore.js';
import { quickLogin } from '../vendors/privy/auth/loginPatch.js';
import { applyFilters } from '../vendors/privy/filters/filterService.js';
import { resetSharedBrowser } from '../utils/browser.js';
import {
  propertyListContainerSelector,
  propertyContentSelector,
  addressLine1Selector,
  addressLine2Selector,
  priceSelector,
  agentNameSelector,
  agentEmailSelector,
  agentPhoneSelector,
  propertyStatsSelector,
  openDetailSelector
} from '../vendors/privy/config/selection.js';

const router = express.Router();
const L = log.child('live-scrape');

// Event emitter for real-time scrape updates
const scrapeEvents = new EventEmitter();
scrapeEvents.setMaxListeners(50); // Allow multiple SSE clients

// Helper function to close any open modals/popups (agent profiles, filter panels, Property Search Filter, etc.)
async function closeAllModals(page) {
  try {
    const closedCount = await page.evaluate(() => {
      let closed = 0;

      // 1. FIRST: Look for Property Search Filter modal (has "Property Search Filter" header and X button)
      // This is the filter panel that opens when clicking on properties
      const filterModalHeader = document.querySelector('h1, h2, h3, h4, h5, div');
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.textContent && el.textContent.includes('Property Search Filter')) {
          // Found the filter modal - look for X/close button nearby
          const parent = el.closest('div[class*="modal"], div[class*="panel"], div[class*="filter"], div[style*="position"]') || el.parentElement?.parentElement?.parentElement;
          if (parent) {
            // Look for close button (X icon) in the modal header area
            const closeBtn = parent.querySelector('button, [role="button"], svg[class*="close"], svg[class*="x"], [class*="close"]');
            if (closeBtn && closeBtn.offsetWidth > 0) {
              closeBtn.click();
              closed++;
              break;
            }
            // Also try finding any SVG or button that could be the X
            const svgBtns = parent.querySelectorAll('svg, button');
            for (const btn of svgBtns) {
              const rect = btn.getBoundingClientRect();
              // X button is usually in top-right corner, small size
              if (rect.width > 0 && rect.width < 50 && rect.height < 50) {
                btn.click();
                closed++;
                break;
              }
            }
          }
          break;
        }
      }

      // 2. Look for circled X button (common pattern for close buttons)
      const circledX = document.querySelectorAll('svg circle, [class*="circle"], button svg');
      circledX.forEach(el => {
        const parent = el.closest('button, [role="button"]') || el.parentElement;
        if (parent && parent.offsetWidth > 0 && parent.offsetWidth < 60) {
          parent.click();
          closed++;
        }
      });

      // 3. Standard modal close selectors
      const modalSelectors = [
        '[aria-label="Close"]',
        '[aria-label="close"]',
        'button[aria-label*="close" i]',
        'button[aria-label*="dismiss" i]',
        '.close-btn',
        '.modal-close',
        'button.close',
        '[data-dismiss="modal"]',
        '.panel-close',
        '.filter-close',
        '[data-testid="close"]',
        '[data-testid*="close" i]',
        'button svg[data-icon="xmark"]',
        'button svg[data-icon="times"]',
        'button svg[data-icon="close"]',
        '.modal-header button',
        '.dialog-close',
        '.popup-close',
        '.modal button:has(svg)',
        '[role="dialog"] button:has(svg)',
        '[class*="modal"] button[class*="close" i]',
        '[class*="popup"] button[class*="close" i]',
        '[class*="overlay"] button[class*="close" i]',
        '[class*="agent"] button[class*="close" i]',
        '[class*="profile"] button[class*="close" i]',
        '[class*="card"] button[class*="close" i]',
        '[class*="filter"] button',
        '[class*="Filter"] button',
      ];
      for (const sel of modalSelectors) {
        try {
          const buttons = document.querySelectorAll(sel);
          buttons.forEach(btn => {
            if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
              btn.click();
              closed++;
            }
          });
        } catch {}
      }

      // 4. Look for Reset button in filter modal (to reset and close)
      const resetBtns = document.querySelectorAll('button, span, div');
      resetBtns.forEach(el => {
        if (el.textContent && el.textContent.trim().toLowerCase() === 'reset') {
          // Don't click reset - we want to close, not reset
        }
      });

      // 5. Also try clicking outside modals/overlays
      const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-bg"]');
      overlays.forEach(overlay => {
        if (overlay.offsetWidth > 0 && overlay.offsetHeight > 0) {
          overlay.click();
          closed++;
        }
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return closed;
    });

    // Also press Escape at page level multiple times
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));
    await page.keyboard.press('Escape');

    return closedCount;
  } catch {
    return 0;
  }
}

// Extract state code from address string
// Handles various formats: "123 Main St, City, XX 12345", "City, XX", "City XX 12345", etc.
function extractStateFromAddress(address) {
  if (!address) return null;

  // Pattern 1: State before zip code (most common): ", CA 90210" or " CA 90210"
  const stateZipMatch = address.match(/[,\s]\s*([A-Z]{2})\s+\d{5}/);
  if (stateZipMatch) {
    return stateZipMatch[1];
  }

  // Pattern 2: State at end with optional zip: ", CA" or ", CA 90210"
  const stateEndMatch = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?$/);
  if (stateEndMatch) {
    return stateEndMatch[1];
  }

  // Pattern 3: State anywhere followed by zip: "CA 90210"
  const stateAnywhereMatch = address.match(/\b([A-Z]{2})\s+\d{5}\b/);
  if (stateAnywhereMatch) {
    return stateAnywhereMatch[1];
  }

  // Pattern 4: Just two capital letters at the end (could be state)
  const lastTwoLetters = address.match(/\b([A-Z]{2})$/);
  if (lastTwoLetters) {
    return lastTwoLetters[1];
  }

  return null;
}

// Singleton PrivyBot instance to maintain session across requests
let sharedPrivyBot = null;
let botInitializing = false;
let lastScrapedState = null; // Track last state to detect state changes

// Request queue to prevent concurrent scraping (browser can only handle one at a time)
let scrapingInProgress = false;
let scrapingQueue = [];
let lastScrapeEndTime = 0;
const MIN_SCRAPE_GAP_MS = 3000; // Minimum 3 seconds between scrapes

async function waitForScrapingSlot(stateCode) {
  if (!scrapingInProgress) {
    // Check if we need to wait for cooldown after last scrape
    const timeSinceLastScrape = Date.now() - lastScrapeEndTime;
    if (timeSinceLastScrape < MIN_SCRAPE_GAP_MS) {
      const waitTime = MIN_SCRAPE_GAP_MS - timeSinceLastScrape;
      L.info(`Waiting ${waitTime}ms cooldown before starting ${stateCode} scrape`);
      await new Promise(r => setTimeout(r, waitTime));
    }
    scrapingInProgress = true;
    return true;
  }

  // Already scraping - queue this request (but limit queue size to prevent buildup)
  if (scrapingQueue.length >= 2) {
    L.warn(`Queue full, rejecting request for ${stateCode}`);
    return false; // Return false to indicate request was rejected
  }

  return new Promise((resolve) => {
    L.info(`Queuing request for ${stateCode}, scraping already in progress`);
    scrapingQueue.push({ stateCode, resolve });
  });
}

function releaseScrapingSlot() {
  lastScrapeEndTime = Date.now();

  if (scrapingQueue.length > 0) {
    const next = scrapingQueue.shift();
    L.info(`Processing queued request for ${next.stateCode}`);
    // Add delay before starting next scrape to let browser settle
    setTimeout(() => next.resolve(true), MIN_SCRAPE_GAP_MS);
  } else {
    scrapingInProgress = false;
  }
}

// Mock property generation removed - we now return errors instead of fake data

/**
 * Scrape agent details (name, phone, brokerage) from a Redfin property detail page
 * @param {string} propertyUrl - Full Redfin property URL
 * @returns {Object} Agent details { agentName, agentPhone, brokerage }
 */
async function scrapeRedfinAgentDetails(propertyUrl) {
  try {
    const axios = (await import('axios')).default;

    const response = await axios.get(propertyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.redfin.com/',
        'Cache-Control': 'no-cache'
      },
      timeout: 15000,
      maxRedirects: 5
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

    if (!agentPhone) {
      const altPhoneMatch = html.match(/agentPhone\\?":\\?"([^"\\]+)/);
      if (altPhoneMatch && altPhoneMatch[1]) {
        agentPhone = altPhoneMatch[1].trim();
      }
    }

    // Method 3: Extract brokerage from JSON
    const brokerageMatch = html.match(/listingBrokerName\\?":\\?"([^"\\]+)/);
    if (brokerageMatch && brokerageMatch[1]) {
      brokerage = brokerageMatch[1].trim();
    }

    // Method 4: Try to find in dataSourceDescription
    if (!brokerage) {
      const altBrokerageMatch = html.match(/dataSourceName\\?":\\?"([^"\\]+)/);
      if (altBrokerageMatch && altBrokerageMatch[1]) {
        brokerage = altBrokerageMatch[1].trim();
      }
    }

    // Method 5: Fallback - Look for "Listed by" pattern in plain text
    if (!agentName) {
      const listedByMatch = html.match(/Listed by\s+([A-Za-z\s]+?)(?:\s*[•·]|\s*<|$)/);
      if (listedByMatch && listedByMatch[1]) {
        agentName = listedByMatch[1].trim();
      }
    }

    // Method 6: Extract phone from page if still not found (look for standard phone format)
    if (!agentPhone) {
      // Find phone numbers in format (XXX) XXX-XXXX or XXX-XXX-XXXX
      const phonePatterns = html.match(/["'>](\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})["'<]/g);
      if (phonePatterns && phonePatterns.length > 0) {
        // Get the first valid phone that's not a random number
        for (const match of phonePatterns) {
          const phone = match.replace(/["'<>]/g, '').trim();
          if (/^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(phone)) {
            agentPhone = phone;
            break;
          }
        }
      }
    }

    L.info(`Scraped agent from ${propertyUrl}: ${agentName || 'N/A'}, ${agentPhone || 'N/A'}, ${agentEmail || 'N/A'}`);

    return {
      agentName: agentName || null,
      agentPhone: agentPhone || null,
      agentEmail: agentEmail || null,
      brokerage: brokerage || null,
      scraped: true
    };

  } catch (error) {
    L.warn(`Failed to scrape agent details from ${propertyUrl}: ${error.message}`);
    return {
      agentName: null,
      agentPhone: null,
      agentEmail: null,
      brokerage: null,
      scraped: false,
      error: error.message
    };
  }
}

/**
 * Enrich multiple properties with agent details (with concurrency control)
 * @param {Array} properties - Array of property objects with url field
 * @param {number} concurrency - Max concurrent requests (default: 3)
 * @returns {Array} Properties enriched with agent details
 */
async function enrichPropertiesWithAgentDetails(properties, concurrency = 3) {
  const enrichedProperties = [...properties];

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < enrichedProperties.length; i += concurrency) {
    const batch = enrichedProperties.slice(i, i + concurrency);
    const batchPromises = batch.map(async (prop, batchIndex) => {
      const index = i + batchIndex;
      if (prop.url) {
        L.info(`Enriching agent details for property ${index + 1}/${enrichedProperties.length}: ${prop.fullAddress}`);
        const agentDetails = await scrapeRedfinAgentDetails(prop.url);
        enrichedProperties[index] = {
          ...enrichedProperties[index],
          agentName: agentDetails.agentName || enrichedProperties[index].agentName,
          agentPhone: agentDetails.agentPhone,
          agentEmail: agentDetails.agentEmail,
          brokerage: agentDetails.brokerage,
          agentEnriched: agentDetails.scraped
        };
      }
    });

    await Promise.all(batchPromises);

    // Small delay between batches to be respectful to Redfin's servers
    if (i + concurrency < enrichedProperties.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return enrichedProperties;
}

// Extended cities per state for Privy searches - MORE cities for better coverage
const PRIVY_STATE_CITIES = {
  'AL': ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Gadsden'],
  'AK': ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer'],
  'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler', 'Gilbert', 'Glendale', 'Tempe', 'Peoria', 'Surprise', 'Yuma', 'Flagstaff', 'Goodyear', 'Avondale'],
  'AR': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'Rogers', 'Conway', 'North Little Rock', 'Bentonville', 'Pine Bluff', 'Hot Springs'],
  'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista', 'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Moreno Valley', 'Glendale', 'Huntington Beach', 'Santa Clarita', 'Garden Grove', 'Oceanside'],
  'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland'],
  'CT': ['Hartford', 'New Haven', 'Stamford', 'Bridgeport', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'West Haven', 'Milford', 'Middletown', 'Norwich'],
  'DE': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
  'FL': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St Petersburg', 'Hialeah', 'Tallahassee', 'Cape Coral', 'Fort Myers', 'Pembroke Pines', 'Hollywood', 'Gainesville', 'Miramar', 'Coral Springs', 'Palm Bay', 'West Palm Beach', 'Clearwater', 'Lakeland', 'Pompano Beach', 'Davie', 'Boca Raton', 'Sunrise', 'Deltona', 'Plantation'],
  'GA': ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Macon', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta', 'Marietta', 'Valdosta', 'Smyrna', 'Dunwoody', 'Brookhaven'],
  'HI': ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani Town', 'Kahului', 'Ewa Gentry', 'Kihei'],
  'ID': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell', 'Coeur d Alene', 'Twin Falls', 'Lewiston', 'Post Falls', 'Rexburg'],
  'IL': ['Chicago', 'Aurora', 'Naperville', 'Rockford', 'Joliet', 'Elgin', 'Peoria', 'Springfield', 'Waukegan', 'Champaign', 'Bloomington', 'Decatur', 'Evanston', 'Schaumburg', 'Arlington Heights', 'Cicero', 'Bolingbrook'],
  'IN': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute', 'Kokomo', 'Noblesville', 'Anderson', 'Greenwood'],
  'IA': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Ames', 'West Des Moines', 'Council Bluffs', 'Ankeny', 'Dubuque', 'Urbandale', 'Cedar Falls'],
  'KS': ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina', 'Hutchinson', 'Leavenworth', 'Leawood'],
  'KY': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville', 'Elizabethtown', 'Henderson', 'Frankfort'],
  'LA': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma', 'New Iberia', 'Slidell', 'Central'],
  'ME': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Augusta', 'Saco', 'Westbrook', 'Waterville', 'Scarborough'],
  'MD': ['Baltimore', 'Columbia', 'Germantown', 'Silver Spring', 'Waldorf', 'Frederick', 'Ellicott City', 'Glen Burnie', 'Gaithersburg', 'Rockville', 'Bethesda', 'Dundalk', 'Towson', 'Bowie', 'Aspen Hill', 'Wheaton'],
  'MA': ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'New Bedford', 'Quincy', 'Lynn', 'Fall River', 'Newton', 'Somerville', 'Lawrence', 'Framingham', 'Haverhill', 'Waltham'],
  'MI': ['Detroit', 'Grand Rapids', 'Warren', 'Ann Arbor', 'Sterling Heights', 'Lansing', 'Dearborn', 'Livonia', 'Clinton Township', 'Canton', 'Flint', 'Troy', 'Westland', 'Farmington Hills', 'Kalamazoo', 'Wyoming', 'Rochester Hills'],
  'MN': ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington', 'Brooklyn Park', 'Plymouth', 'Woodbury', 'Lakeville', 'St Cloud', 'Eagan', 'Maple Grove', 'Eden Prairie', 'Coon Rapids', 'Burnsville', 'Blaine'],
  'MS': ['Jackson', 'Gulfport', 'Hattiesburg', 'Southaven', 'Biloxi', 'Meridian', 'Tupelo', 'Olive Branch', 'Greenville', 'Horn Lake', 'Pearl', 'Madison', 'Clinton'],
  'MO': ['Kansas City', 'Saint Louis', 'Springfield', 'Columbia', 'Independence', 'Lee Summit', 'O Fallon', 'St Joseph', 'St Charles', 'Blue Springs', 'St Peters', 'Florissant', 'Joplin', 'Chesterfield', 'Jefferson City'],
  'MT': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City'],
  'NE': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'North Platte', 'Columbus', 'Papillion', 'La Vista'],
  'NV': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City', 'Fallon'],
  'NH': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Hudson', 'Londonderry', 'Keene', 'Bedford', 'Portsmouth'],
  'NJ': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Clifton', 'Camden', 'Passaic', 'Union City', 'Bayonne', 'East Orange', 'Vineland', 'New Brunswick', 'Hoboken', 'Perth Amboy', 'Plainfield', 'West New York', 'Hackensack', 'Sayreville', 'Kearny', 'Linden', 'Atlantic City'],
  'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Clovis', 'Hobbs', 'Alamogordo', 'Carlsbad', 'Gallup', 'Deming', 'Los Lunas'],
  'NY': ['New York', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Troy', 'Niagara Falls', 'Binghamton', 'Freeport', 'Long Beach', 'Spring Valley', 'Valley Stream', 'Rome', 'Ithaca', 'Poughkeepsie', 'Jamestown', 'Elmira', 'Middletown', 'Auburn', 'Newburgh', 'Saratoga Springs'],
  'NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Greenville', 'Asheville', 'Gastonia', 'Jacksonville', 'Chapel Hill', 'Huntersville', 'Apex', 'Wake Forest', 'Kannapolis', 'Burlington', 'Rocky Mount', 'Hickory'],
  'ND': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton'],
  'OH': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain', 'Hamilton', 'Springfield', 'Kettering', 'Elyria', 'Lakewood', 'Cuyahoga Falls', 'Euclid', 'Dublin', 'Middletown', 'Newark', 'Mansfield', 'Mentor'],
  'OK': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Muskogee', 'Bartlesville', 'Owasso', 'Shawnee', 'Ponca City'],
  'OR': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Grants Pass', 'Oregon City'],
  'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Altoona', 'Erie', 'Wilkes Barre', 'Chester', 'State College', 'Easton', 'Lebanon', 'Hazleton'],
  'RI': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown', 'West Warwick', 'Johnston', 'Newport'],
  'SC': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach', 'Rock Hill', 'Mount Pleasant', 'North Charleston', 'Spartanburg', 'Summerville', 'Goose Creek', 'Hilton Head Island', 'Sumter', 'Florence', 'Greer', 'Anderson'],
  'SD': ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Vermillion', 'Spearfish', 'Brandon'],
  'TN': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett', 'Hendersonville', 'Kingsport', 'Collierville', 'Smyrna', 'Cleveland', 'Brentwood', 'Spring Hill'],
  'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Garland', 'Irving', 'Amarillo', 'Grand Prairie', 'McKinney', 'Frisco', 'Brownsville', 'Pasadena', 'Killeen', 'McAllen', 'Mesquite', 'Midland', 'Denton', 'Waco', 'Carrollton', 'Round Rock', 'Abilene', 'Pearland', 'Richardson', 'Odessa'],
  'UT': ['Salt Lake City', 'West Valley City', 'Provo', 'Ogden', 'West Jordan', 'Sandy', 'Orem', 'St George', 'Layton', 'South Jordan', 'Lehi', 'Millcreek', 'Taylorsville', 'Logan', 'Murray', 'Draper'],
  'VT': ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier', 'Winooski', 'St Albans', 'Newport', 'Vergennes', 'Middlebury'],
  'VA': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Arlington', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg', 'Harrisonburg', 'Charlottesville', 'Danville', 'Manassas', 'Petersburg', 'Fredericksburg', 'Leesburg', 'Salem'],
  'WA': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Federal Way', 'Spokane Valley', 'Kirkland', 'Bellingham', 'Auburn', 'Kennewick', 'Redmond', 'Marysville', 'Pasco', 'Lakewood', 'Yakima', 'Olympia', 'Sammamish', 'Burien'],
  'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg', 'South Charleston', 'Teays Valley'],
  'WI': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh', 'Janesville', 'West Allis', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'Brookfield', 'New Berlin', 'Beloit', 'Greenfield', 'Manitowoc'],
  'WY': ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Cody', 'Jackson', 'Rawlins']
};

// Filter URL - applies all filters but with nationwide location (no city yet)
// City will be typed in the search box after filters are applied
// IMPORTANT: These filters must match exactly what user wants:
// - Status: Active ONLY (no Sold, Pending, Under Contract)
// - Property Type: Single Family (Detached) only
// - MLS Deals: Below Market (buy_hold project type)
// - UMV: 50%
// - Price: $20,000 - $600,000
// - Beds: 3+
// - Sqft: 1,000+
// - HOA: No
function getFilterUrl() {
  // EXACT filter URL from user - all parameters included
  return 'https://app.privy.pro/dashboard?update_history=true&id=&name=&folder_id=&user_property_status=&batch_id=&saved_search=&search_text=&location_type=nationwide&search_shape=&search_shape_id=&geography_shape=&geography_shape_id=&include_surrounding=true&list_key=&email_frequency=&quick_filter_id=&project_type=buy_hold&spread_type=umv&spread=50&isLTRsearch=false&from_email_sender_id=&from_email_sender_feature_ltr=&from_email_sender_user_type=&preferred_only=false&list_price_from=20000&list_price_to=600000&price_per_sqft_from=0&price_per_sqft_to=&street_number=&street=&city=&zip=&county=&state=&lat=&lng=&radius=&cm=&zoom=5&sw_lat=29.658691955488298&sw_lng=-132.09084384947136&ne_lat=48.842479954833586&ne_lng=-66.78810947447136&size%5Bheight%5D=570&size%5Bwidth%5D=1486&gridViewWidth=&dom_from=&dom_to=&stories_from=&stories_to=&beds_from=3&beds_to=&baths_from=&baths_to=&sqft_from=1000&sqft_to=&year_built_from=&year_built_to=&hoa_fee_from=&hoa_fee_to=&unit_count_from=&unit_count_to=&zoned=&hoa=no&remarks=&basement=Any&basement_sqft_from=&basement_sqft_to=&include_condo=false&include_attached=false&include_detached=true&include_multi_family=false&include_active=true&include_under_contract=false&include_sold=false&include_pending=false&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc&site_id=&city_id=&for_pdf=&fast_match_property_id=';
}

// Build Privy URL for a city - EXACT parameters from working Privy URL
// This URL includes ALL filters so we can navigate directly without using filter modal
// CRITICAL: id=&name=&saved_search= MUST be included to clear any saved search like "Below Market"
function buildPrivyUrl(city, stateCode, cacheBust = true) {
  const base = 'https://app.privy.pro/dashboard';
  const params = new URLSearchParams({
    // CRITICAL: Clear saved search first to prevent "Below Market" from being applied
    id: '',
    name: '',
    saved_search: '',
    update_history: 'true',
    search_text: `${city}, ${stateCode}`,
    location_type: 'city',
    include_surrounding: 'true',
    project_type: 'buy_hold',
    spread_type: 'umv',
    spread: '50',
    isLTRsearch: 'false',
    preferred_only: 'false',
    list_price_from: '20000',
    list_price_to: '600000',
    price_per_sqft_from: '0',
    beds_from: '3',
    sqft_from: '1000',
    hoa: 'no',  // FIXED: was 'Any', now 'no' for no HOA
    basement: 'Any',
    include_condo: 'false',
    include_attached: 'false',
    include_detached: 'true',
    include_multi_family: 'false',
    include_active: 'true',
    include_under_contract: 'false',
    include_sold: 'false',
    include_pending: 'false',
    date_range: 'all',
    source: 'Any',
    sort_by: 'days-on-market',
    sort_dir: 'asc'
  });
  // Add cache-busting timestamp to force Privy to fetch fresh data
  if (cacheBust) {
    params.set('_t', Date.now().toString());
  }
  return `${base}?${params.toString()}`;
}

/**
 * GET /api/live-scrape/privy
 *
 * Scrapes addresses LIVE from Privy.pro by looping through EACH CITY in the state
 * Continues fetching from city to city until the requested limit is reached
 *
 * Query params:
 *   - state: State code (e.g., CA, NY) - REQUIRED
 *   - limit: Max total addresses to return (default: 100)
 */
// Maximum retry attempts for recoverable errors (detached frame, session, connection)
const MAX_SCRAPE_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Helper to check if error is recoverable (can be retried)
function isRecoverableError(errorMsg) {
  const msg = (errorMsg || '').toLowerCase();
  return msg.includes('session') || msg.includes('sign_in') || msg.includes('login') ||
         msg.includes('detached') || msg.includes('connection') || msg.includes('protocol error') ||
         msg.includes('target closed') || msg.includes('browser') || msg.includes('execution context') ||
         msg.includes('timeout') || msg.includes('timed out');
}

// Helper to reset the shared bot AND browser (for recoverable errors like detached frame)
async function resetSharedBot() {
  L.info('Resetting shared bot and browser...');
  if (sharedPrivyBot) {
    try { await sharedPrivyBot.close(); } catch {}
  }
  sharedPrivyBot = null;
  botInitializing = false;

  // Also reset the shared browser to ensure fresh connection on retry
  try {
    await resetSharedBrowser();
  } catch (e) {
    L.warn('Failed to reset shared browser', { error: e?.message });
  }
}

/**
 * STATE-LEVEL PRIVY HANDLER
 * Uses the simpler approach from test-privy-fetch.js:
 * 1. Navigate to state-level URL with filters
 * 2. Click on map clusters to zoom in
 * 3. Extract addresses from property cards
 *
 * This avoids the dropdown selection issue entirely.
 */
async function privyStateHandler(req, res, stateUpper, limitNum, shouldAutoBofa, shouldEnrichAgent) {
  L.info(`Starting STATE-LEVEL Privy scrape for ${stateUpper}`, { limit: limitNum, mode: 'state' });

  // Wait for scraping slot
  const gotSlot = await waitForScrapingSlot(stateUpper);
  if (gotSlot === false) {
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. A scrape is already in progress. Please wait.',
      retryAfter: 30
    });
  }

  try {
    // Reset bot for fresh session
    if (sharedPrivyBot) {
      L.info('Resetting bot for state-level scrape');
      try { await sharedPrivyBot.close(); } catch {}
      sharedPrivyBot = null;
      botInitializing = false;
      await new Promise(r => setTimeout(r, 500));
    }

    // Initialize bot
    if (!sharedPrivyBot && !botInitializing) {
      botInitializing = true;
      L.info('Creating new PrivyBot instance for state-level scrape...');
      try {
        sharedPrivyBot = new PrivyBot();
        await sharedPrivyBot.init();

        const currentUrl = sharedPrivyBot.page.url();
        L.info('Current page after init', { url: currentUrl });

        if (currentUrl.includes('sign_in') || currentUrl === 'about:blank') {
          L.info('On sign-in page, using quick login...');
          const quickResult = await quickLogin(sharedPrivyBot.page);
          if (quickResult && quickResult.page) {
            sharedPrivyBot.page = quickResult.page;
          }
          if (quickResult?.success !== true) {
            await sharedPrivyBot.login();
          }
        }
      } catch (initErr) {
        botInitializing = false;
        sharedPrivyBot = null;
        throw initErr;
      }
      botInitializing = false;
    }

    const page = sharedPrivyBot.page;

    // Maximize viewport
    try {
      const session = await page.target().createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
      await page.setViewport({ width: 1920, height: 1080 });
    } catch {}

    // EXACT SAME APPROACH AS test-privy-fetch.js
    // STEP 1: First navigate to clean dashboard URL to clear any saved search (line 51 of test-privy-fetch.js)
    L.info('Step 1: Navigating to clean dashboard to clear saved search...');
    await page.goto('https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await new Promise(r => setTimeout(r, 2000));

    // STEP 2: Navigate to state URL (line 31 and 72 of test-privy-fetch.js)
    // Using the EXACT same URL format as test-privy-fetch.js
    const stateUrl = `https://app.privy.pro/dashboard?location_type=state&state=${stateUpper}&project_type=buy_hold&list_price_from=20000&list_price_to=600000&beds_from=3&sqft_from=1000&hoa=no&include_detached=true&include_active=true&date_range=all&sort_by=days-on-market&sort_dir=asc`;

    L.info(`Step 2: Navigating to ${stateUpper} state view...`);
    await page.goto(stateUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Wait for clusters to load (line 77-82 of test-privy-fetch.js)
    L.info('Waiting for map clusters...');
    try {
      await page.waitForSelector('.cluster.cluster-deal', { timeout: 15000 });
      L.info('Clusters loaded!');
    } catch {
      L.info('No clusters found');
    }
    await new Promise(r => setTimeout(r, 2000));

    // Click on clusters to zoom in and find addresses (lines 89-111 of test-privy-fetch.js)
    const allAddresses = [];
    const seenAddressKeys = new Set();
    L.info('Clicking clusters to find addresses...');

    for (let attempt = 0; attempt < 15 && allAddresses.length < limitNum; attempt++) {
      // Click the FIRST cluster - same as test-privy-fetch.js line 93
      const clusterInfo = await page.evaluate(() => {
        const clusters = document.querySelectorAll('.cluster.cluster-deal');
        if (clusters.length === 0) return { clicked: false, count: 0 };
        clusters[0].click();
        return { clicked: true, count: clusters.length };
      });

      L.info(`Click ${attempt + 1}: ${clusterInfo.count} clusters`);
      if (!clusterInfo.clicked) break;
      await new Promise(r => setTimeout(r, 2000));

      // Check for property cards (line 103-104 of test-privy-fetch.js)
      const hasProps = await page.evaluate(() => {
        return document.querySelectorAll('.property-module, .view-container').length > 0;
      });

      if (hasProps) {
        L.info('Property cards found!');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 3000));

    // Scroll to load more properties
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 500));
    }

    // Extract addresses (lines 123-142 of test-privy-fetch.js)
    L.info('Extracting addresses...');
    const addresses = await page.evaluate(() => {
      const results = [];

      // Find property modules - EXACT same selector as test-privy-fetch.js line 127
      const modules = document.querySelectorAll('.property-module .content, .property-card');

      for (const el of modules) {
        const line1 = el.querySelector('.address-line1')?.textContent?.trim() || '';
        const line2 = el.querySelector('.address-line2')?.textContent?.trim() || '';
        const fullAddress = line1 && line2 ? `${line1}, ${line2}` : (line1 || line2);

        if (fullAddress && fullAddress.length > 5) {
          const price = el.querySelector('.price')?.textContent?.trim() || '';
          const stats = Array.from(el.querySelectorAll('.quickstat')).map(s => s.textContent?.trim()).filter(Boolean);
          results.push({ fullAddress, price, stats });
        }
      }

      return results;
    });

    L.info(`Extracted ${addresses.length} addresses from property cards`);

    // Dedupe and format addresses
    for (const addr of addresses) {
      if (allAddresses.length >= limitNum) break;
      const key = addr.fullAddress.toLowerCase().trim();
      if (!seenAddressKeys.has(key)) {
        seenAddressKeys.add(key);

        // Extract city from address
        const parts = addr.fullAddress.split(',');
        const city = parts.length >= 2 ? parts[parts.length - 2].trim() : '';

        allAddresses.push({
          fullAddress: addr.fullAddress,
          price: addr.price,
          agentName: null,
          agentEmail: null,
          agentPhone: null,
          quickStats: addr.stats || [],
          city: city,
          state: stateUpper,
          source: 'privy',
          scrapedAt: new Date().toISOString()
        });

        // Emit SSE event for real-time updates
        scrapeEvents.emit('address', {
          state: stateUpper,
          city: city,
          address: allAddresses[allAddresses.length - 1],
          progress: { current: allAddresses.length, limit: limitNum }
        });
      }
    }

    // Release scraping slot
    scrapingInProgress = false;
    lastScrapeEndTime = Date.now();

    // Save to database
    let savedCount = 0;
    for (const addr of allAddresses) {
      try {
        const fullAddress_ci = addr.fullAddress.toLowerCase().trim();
        await ScrapedDeal.findOneAndUpdate(
          { fullAddress_ci },
          {
            $set: {
              address: addr.fullAddress.split(',')[0]?.trim() || addr.fullAddress,
              fullAddress: addr.fullAddress,
              fullAddress_ci,
              city: addr.city,
              state: stateUpper,
              listingPrice: addr.price ? Number(String(addr.price).replace(/[^0-9.-]/g, '')) : null,
              source: 'privy',
              scrapedAt: new Date()
            }
          },
          { upsert: true, new: true }
        );
        savedCount++;
      } catch {}
    }

    // Emit completion event
    scrapeEvents.emit('complete', { state: stateUpper, total: allAddresses.length });

    L.info(`State-level scrape complete for ${stateUpper}`, { count: allAddresses.length, saved: savedCount });

    return res.json({
      ok: true,
      state: stateUpper,
      mode: 'state',
      count: allAddresses.length,
      limit: limitNum,
      addresses: allAddresses,
      savedToScrapedDeal: savedCount
    });

  } catch (err) {
    scrapingInProgress = false;
    lastScrapeEndTime = Date.now();
    L.error('State-level Privy scrape failed', { error: err?.message });
    scrapeEvents.emit('error', { state: stateUpper, message: err?.message });
    return res.status(500).json({ ok: false, error: err?.message || 'Scrape failed' });
  }
}

// SSE endpoint for real-time scrape updates
// This endpoint STARTS a scrape AND streams results in real-time
router.get('/privy-stream', async (req, res) => {
  const state = (req.query.state || '').toUpperCase();
  const limit = parseInt(req.query.limit) || 100;

  if (!state) {
    return res.status(400).json({ ok: false, error: 'State parameter is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for SSE
  res.flushHeaders();

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ state, limit, timestamp: Date.now() })}\n\n`);

  // Handler for address events - use named SSE events for proper addEventListener handling
  const onAddress = (data) => {
    if (data.state === state) {
      res.write(`event: address\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Handler for status events (city started, progress, etc.)
  const onStatus = (data) => {
    if (data.state === state) {
      res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Handler for completion
  const onComplete = (data) => {
    if (data.state === state) {
      res.write(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Handler for errors
  const onError = (data) => {
    if (data.state === state) {
      res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Subscribe to events BEFORE starting scrape
  scrapeEvents.on('address', onAddress);
  scrapeEvents.on('status', onStatus);
  scrapeEvents.on('complete', onComplete);
  scrapeEvents.on('error', onError);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 30000);

  // Cleanup function
  const cleanup = () => {
    clearInterval(heartbeat);
    scrapeEvents.off('address', onAddress);
    scrapeEvents.off('status', onStatus);
    scrapeEvents.off('complete', onComplete);
    scrapeEvents.off('error', onError);
  };

  // Cleanup on disconnect
  req.on('close', () => {
    cleanup();
    L.info('SSE client disconnected');
  });

  L.info('SSE client connected, starting scrape', { state, limit });

  // Start the scrape asynchronously - use internal scrape function
  // Create a mock request/response for the internal call
  const mockReq = { query: { state, limit: limit.toString(), enrichAgent: 'true' } };
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        if (code >= 400) {
          scrapeEvents.emit('error', { state, message: data.error || 'Scrape failed' });
        }
      }
    }),
    json: (data) => {
      // Scrape completed via normal endpoint - send complete event
      if (data.ok && data.addresses) {
        scrapeEvents.emit('complete', { state, total: data.addresses.length, addresses: data.addresses });
      }
    }
  };

  // Run the scrape in background
  try {
    privyHandler(mockReq, mockRes).catch((err) => {
      scrapeEvents.emit('error', { state, message: err.message });
    });
  } catch (err) {
    scrapeEvents.emit('error', { state, message: err.message });
  }
});

// Test endpoint without auth - TEMPORARY for testing
router.get('/privy-test', async (req, res) => {
  req.query.state = req.query.state || 'TX';
  req.query.limit = req.query.limit || '5';
  // Forward to privy handler
  return privyHandler(req, res);
});

async function privyHandler(req, res) {
  const { state, limit = 100, autoBofa = 'false', enrichAgent = 'true', mode = 'city' } = req.query;
  const shouldAutoBofa = autoBofa === 'true' || autoBofa === '1';
  const shouldEnrichAgent = enrichAgent === 'true' || enrichAgent === '1';
  // mode: 'city' = city-by-city search (default), 'state' = state-level cluster approach (simpler)
  const scrapeMode = mode === 'state' ? 'state' : 'city';

  if (!state) {
    return res.status(400).json({ ok: false, error: 'State parameter is required (e.g., state=NJ)' });
  }

  const stateUpper = state.toUpperCase();
  const limitNum = parseInt(limit) || 100;

  // If state-level mode, use the simpler cluster-based approach
  if (scrapeMode === 'state') {
    return privyStateHandler(req, res, stateUpper, limitNum, shouldAutoBofa, shouldEnrichAgent);
  }

  // Get ALL cities for this state - we'll loop through them
  // SORT ALPHABETICALLY to ensure consistent, thorough coverage (A to Z)
  const rawCities = PRIVY_STATE_CITIES[stateUpper] || [];
  const stateCities = [...rawCities].sort((a, b) => a.localeCompare(b));
  if (stateCities.length === 0) {
    return res.status(400).json({ ok: false, error: `No cities configured for state ${stateUpper}` });
  }

  // Wait for scraping slot (only one scrape can run at a time)
  const gotSlot = await waitForScrapingSlot(stateUpper);
  if (gotSlot === false) {
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. A scrape is already in progress. Please wait.',
      retryAfter: 30
    });
  }

  // Retry loop for recoverable errors
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_SCRAPE_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        L.info(`Retry attempt ${attempt}/${MAX_SCRAPE_RETRIES} for ${stateUpper} scrape`);
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }

      L.info(`Starting MULTI-CITY Privy scrape for ${stateUpper}`, {
        state: stateUpper,
        limit: limitNum,
        totalCities: stateCities.length,
        cities: stateCities.slice(0, 5).join(', ') + (stateCities.length > 5 ? '...' : ''),
        attempt: attempt
      });

      // Global tracking across all cities
      const globalAddresses = [];
      const citiesScraped = [];
      const seenAddressKeys = new Set();
      let consecutiveEmptyCities = 0; // Track cities with 0 new addresses for early exit

    // CRITICAL: ALWAYS reset bot to avoid stale map data from Privy's aggressive caching
    // This is the nuclear option - completely restart the browser for each scrape request
    // to ensure Privy's SPA state is completely fresh
    if (sharedPrivyBot) {
      L.info(`Resetting bot for fresh scrape (current state: ${stateUpper}, previous: ${lastScrapedState || 'none'})`);
      try { await sharedPrivyBot.close(); } catch {}
      sharedPrivyBot = null;
      botInitializing = false;
      // Small delay to ensure browser is fully closed
      await new Promise(r => setTimeout(r, 500));
    }

    // Use shared bot instance to maintain session
    if (!sharedPrivyBot && !botInitializing) {
      botInitializing = true;
      L.info('Creating new PrivyBot instance...');
      try {
        sharedPrivyBot = new PrivyBot();
        await sharedPrivyBot.init();

        // Check current page - if on sign_in, we need to login
        const currentUrl = sharedPrivyBot.page.url();
        L.info('Current page after init', { url: currentUrl });

        if (currentUrl.includes('sign_in') || currentUrl === 'about:blank') {
          L.info('On sign-in page, using quick login...');
          const quickResult = await quickLogin(sharedPrivyBot.page);

          // quickLogin now returns { success, page } - update the bot's page reference
          if (quickResult && quickResult.page) {
            sharedPrivyBot.page = quickResult.page;
            L.info('Updated bot page reference to new tab');
          }

          if (quickResult?.success === true) {
            L.info('Quick login succeeded - on dashboard');
          } else if (quickResult?.success === 'otp_required') {
            L.info('OTP required, falling back to full login flow...');
            await sharedPrivyBot.login();
          } else {
            L.warn('Quick login failed, trying full login...');
            await sharedPrivyBot.login();
          }
        } else if (currentUrl.includes('dashboard')) {
          L.info('Already on dashboard, session is valid!');
        } else {
          // Try to go to dashboard with EXPLICIT filters to avoid saved search loading
          // CRITICAL: Never go to plain /dashboard - it loads "Below Market" saved search with include_sold=true
          L.info('Checking session by navigating to dashboard with clean filters...');
          const cleanCheckUrl = 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true&include_pending=false&include_under_contract=false';
          try {
            await sharedPrivyBot.page.goto(cleanCheckUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 30000
            });
            const urlAfterNav = sharedPrivyBot.page.url();
            if (urlAfterNav.includes('sign_in')) {
              L.info('Session expired, need to login');
              await sharedPrivyBot.login();
            } else {
              L.info('Session is valid!');
            }
          } catch (navErr) {
            L.warn('Navigation failed, attempting full login', { error: navErr.message });
            await sharedPrivyBot.login();
          }
        }
        // Don't start keep-alive loop here - it interferes with scraping
        // The loop will be started after scraping is complete
      } catch (initErr) {
        L.error('Bot initialization failed', { error: initErr?.message });
        // CRITICAL: Reset botInitializing flag on failure to prevent deadlock
        botInitializing = false;
        sharedPrivyBot = null;
        throw initErr;
      }
      botInitializing = false;
    } else if (botInitializing) {
      L.info('Waiting for bot to finish initializing...');
      let waitCount = 0;
      while (botInitializing && waitCount < 60) {
        await new Promise(r => setTimeout(r, 1000));
        waitCount++;
      }
      if (!sharedPrivyBot) {
        throw new Error('Bot initialization timed out');
      }
    }

    const bot = sharedPrivyBot;
    const page = bot.page;

    // Maximize the browser window and set large viewport for Privy to work correctly
    try {
      // Get screen dimensions and set viewport to full screen
      const session = await page.target().createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'maximized' }
      });
      L.info('Browser window maximized');

      // Also set a large viewport
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      L.info('Viewport set to 1920x1080');
    } catch (e) {
      L.warn('Could not maximize browser', { error: e?.message });
      // Fallback: just set a large viewport
      try {
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      } catch {}
    }

    // ========== STEP 0: LOGIN AND APPLY FILTER URL ==========
    // The filter URL with all correct parameters
    const filterUrl = 'https://app.privy.pro/dashboard?update_history=true&id=&name=&folder_id=&user_property_status=&batch_id=&saved_search=&search_text=&location_type=nationwide&search_shape=&search_shape_id=&geography_shape=&geography_shape_id=&include_surrounding=true&list_key=&email_frequency=&quick_filter_id=&project_type=buy_hold&spread_type=umv&spread=50&isLTRsearch=false&from_email_sender_id=&from_email_sender_feature_ltr=&from_email_sender_user_type=&preferred_only=false&list_price_from=20000&list_price_to=600000&price_per_sqft_from=0&price_per_sqft_to=&street_number=&street=&city=&zip=&county=&state=&lat=&lng=&radius=&cm=&zoom=5&sw_lat=29.658691955488298&sw_lng=-132.09084384947136&ne_lat=48.842479954833586&ne_lng=-66.78810947447136&size%5Bheight%5D=570&size%5Bwidth%5D=1486&gridViewWidth=&dom_from=&dom_to=&stories_from=&stories_to=&beds_from=3&beds_to=&baths_from=&baths_to=&sqft_from=1000&sqft_to=&year_built_from=&year_built_to=&hoa_fee_from=&hoa_fee_to=&unit_count_from=&unit_count_to=&zoned=&hoa=no&remarks=&basement=Any&basement_sqft_from=&basement_sqft_to=&include_condo=false&include_attached=false&include_detached=true&include_multi_family=false&include_active=true&include_under_contract=false&include_sold=false&include_pending=false&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc&site_id=&city_id=&for_pdf=&fast_match_property_id=';

    // CRITICAL: Intercept and block Privy from applying the "Below Market" saved search
    // Privy's frontend JavaScript tries to modify the URL to apply id=-101 (saved search)
    // We override history.pushState and history.replaceState to filter out bad parameters
    await page.evaluateOnNewDocument(() => {
      const originalPushState = history.pushState.bind(history);
      const originalReplaceState = history.replaceState.bind(history);

      const filterUrl = (url) => {
        if (!url || typeof url !== 'string') return url;
        try {
          const urlObj = new URL(url, location.origin);
          // Force correct filter values
          urlObj.searchParams.set('id', '');
          urlObj.searchParams.set('name', '');
          urlObj.searchParams.set('saved_search', '');
          urlObj.searchParams.set('include_sold', 'false');
          urlObj.searchParams.set('include_active', 'true');
          urlObj.searchParams.set('include_pending', 'false');
          urlObj.searchParams.set('include_under_contract', 'false');
          urlObj.searchParams.set('include_attached', 'false');
          urlObj.searchParams.set('include_detached', 'true');
          urlObj.searchParams.set('hoa', 'no');
          urlObj.searchParams.set('spread', '50');
          urlObj.searchParams.set('date_range', 'all');
          return urlObj.toString();
        } catch {
          return url;
        }
      };

      history.pushState = function(state, title, url) {
        return originalPushState(state, title, filterUrl(url));
      };

      history.replaceState = function(state, title, url) {
        return originalReplaceState(state, title, filterUrl(url));
      };

      console.log('[Privy Filter Override] History API intercepted - saved search blocked');
    });

    L.info('Opening Privy with filter URL...');
    await page.goto(filterUrl, { waitUntil: 'networkidle0', timeout: 90000 });

    // Check if we got redirected to login page
    let currentUrl = page.url();
    if (currentUrl.includes('sign_in')) {
      L.info('Session expired, re-authenticating...');
      await bot.login();
      // IMPORTANT: After login, go to filter URL (NOT dashboard)
      L.info('After login, navigating to filter URL...');
      await page.goto(filterUrl, { waitUntil: 'networkidle0', timeout: 90000 });
    }

    L.info('Waiting 10 seconds for filter URL to apply...');
    await new Promise(r => setTimeout(r, 10000));

    // DISABLED: closeAllModals was clicking on "Below Market" saved search section
    // The aggressive selectors like '[class*="filter"] button' and 'svg circle' were too broad
    // await closeAllModals(page);

    // Log actual URL to verify filters applied
    const actualUrl = page.url();
    L.info(`Actual URL after filter: ${actualUrl.substring(0, 150)}...`);

    // ============ MULTI-CITY LOOP ============
    // Loop through each city until we have enough addresses
    for (let cityIndex = 0; cityIndex < stateCities.length; cityIndex++) {
      const cityToUse = stateCities[cityIndex];

      // Check if we've reached the limit
      if (globalAddresses.length >= limitNum) {
        L.info(`✅ Reached target of ${limitNum} addresses after ${citiesScraped.length} cities. Stopping.`);
        break;
      }

      L.info(`\n========== CITY ${cityIndex + 1}/${stateCities.length}: ${cityToUse}, ${stateUpper} ==========`);
      L.info(`Current progress: ${globalAddresses.length}/${limitNum} addresses`);
      citiesScraped.push(cityToUse);

      // Emit status event for SSE clients
      scrapeEvents.emit('status', {
        state: stateUpper,
        event: 'city_start',
        city: cityToUse,
        cityIndex: cityIndex + 1,
        totalCities: stateCities.length,
        progress: {
          current: globalAddresses.length,
          limit: limitNum
        }
      });

    // ========== STEP 0.5: CLEAR PRIVY'S SAVED SEARCH FROM LOCALSTORAGE ==========
    // Privy stores the saved search in localStorage/sessionStorage - we need to clear it
    L.info(`Clearing Privy saved search from localStorage...`);
    await page.evaluate(() => {
      // Clear any saved search data from localStorage
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('search') || key.includes('filter') || key.includes('saved') || key.includes('privy'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Also clear sessionStorage
      const sessionKeysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('search') || key.includes('filter') || key.includes('saved') || key.includes('privy'))) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

      return { localStorageCleared: keysToRemove.length, sessionStorageCleared: sessionKeysToRemove.length };
    }).then(result => L.info('Storage cleared', result)).catch(() => {});

    // ========== STEP 1: APPLY FILTER URL FIRST (WITHOUT CITY) ==========
    // CRITICAL: First apply filters with explicit include_sold=false to override any saved search
    L.info(`STEP 1: Applying clean filter URL (no city yet)...`);

    // Build filter URL matching EXACT Privy format but NO city - this sets the filter state
    // Key: id=&name= clears any saved search, all other filters set correctly
    const filterOnlyUrl = `https://app.privy.pro/dashboard?update_history=true&id=&name=&folder_id=&user_property_status=&batch_id=&saved_search=&search_text=&location_type=nationwide&search_shape=&search_shape_id=&geography_shape=&geography_shape_id=&include_surrounding=true&list_key=&email_frequency=&quick_filter_id=&project_type=buy_hold&spread_type=umv&spread=50&isLTRsearch=false&from_email_sender_id=&from_email_sender_feature_ltr=&from_email_sender_user_type=&preferred_only=false&list_price_from=20000&list_price_to=600000&price_per_sqft_from=0&price_per_sqft_to=&street_number=&street=&city=&zip=&county=&state=&lat=&lng=&radius=&cm=&zoom=5&sw_lat=&sw_lng=&ne_lat=&ne_lng=&size%5Bheight%5D=570&size%5Bwidth%5D=1486&gridViewWidth=&dom_from=&dom_to=&stories_from=&stories_to=&beds_from=3&beds_to=&baths_from=&baths_to=&sqft_from=1000&sqft_to=&year_built_from=&year_built_to=&hoa_fee_from=&hoa_fee_to=&unit_count_from=&unit_count_to=&zoned=&hoa=no&remarks=&basement=Any&basement_sqft_from=&basement_sqft_to=&include_condo=false&include_attached=false&include_detached=true&include_multi_family=false&include_active=true&include_under_contract=false&include_sold=false&include_pending=false&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc&site_id=&city_id=&for_pdf=&fast_match_property_id=`;

    await page.goto(filterOnlyUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    L.info('Filter URL loaded, waiting 10 seconds for filters to apply...');
    await new Promise(r => setTimeout(r, 10000));

    // Verify the URL has correct filters
    const urlAfterFilter = page.url();
    L.info(`URL after filter: ${urlAfterFilter.substring(0, 150)}...`);

    // Check if saved search got re-applied
    if (urlAfterFilter.includes('id=-') || urlAfterFilter.includes('include_sold=true')) {
      L.warn('Saved search re-applied! Using page.goto() to force correct URL...');

      // FIXED: Use page.goto() instead of window.location.href
      // window.location.href triggers Privy's SPA router which reapplies saved search
      // page.goto() bypasses the SPA and loads the URL directly
      const fixedUrl = new URL(urlAfterFilter);
      fixedUrl.searchParams.set('id', '');
      fixedUrl.searchParams.set('name', '');
      fixedUrl.searchParams.set('saved_search', '');
      fixedUrl.searchParams.set('include_sold', 'false');
      fixedUrl.searchParams.set('include_active', 'true');
      fixedUrl.searchParams.set('include_pending', 'false');
      fixedUrl.searchParams.set('include_under_contract', 'false');
      fixedUrl.searchParams.set('include_attached', 'false');
      fixedUrl.searchParams.set('include_detached', 'true');
      fixedUrl.searchParams.set('hoa', 'no');
      fixedUrl.searchParams.set('spread', '50');
      fixedUrl.searchParams.set('date_range', 'all');

      await page.goto(fixedUrl.toString(), { waitUntil: 'networkidle0', timeout: 60000 });
      await new Promise(r => setTimeout(r, 5000));
    }

    // DISABLED: closeAllModals was clicking on "Below Market" saved search
    // await closeAllModals(page);

    // ========== STEP 2: TYPE CITY IN SEARCH BOX AND SELECT FROM DROPDOWN ==========
    // Instead of navigating via URL, we type in the search box like a human user
    L.info(`STEP 2: Typing "${cityToUse}, ${stateUpper}" in search box...`);

    const searchQuery = `${cityToUse}, ${stateUpper}`;

    // Find and click the search input box
    const searchInputSelectors = [
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="city"]',
      'input[placeholder*="City"]',
      'input[placeholder*="location"]',
      'input[placeholder*="Location"]',
      'input[type="search"]',
      '#search-input',
      '.search-input',
      '[data-testid="search-input"]',
      'input.search',
      '#SearchBlock input',
      '.search-block input',
      'input[name="search"]',
      'input[name="query"]',
    ];

    let searchInput = null;
    for (const selector of searchInputSelectors) {
      try {
        searchInput = await page.$(selector);
        if (searchInput) {
          L.info(`Found search input with selector: ${selector}`);
          break;
        }
      } catch {}
    }

    if (!searchInput) {
      // Try finding by visible text/placeholder
      searchInput = await page.evaluateHandle(() => {
        const inputs = document.querySelectorAll('input');
        for (const input of inputs) {
          const placeholder = (input.placeholder || '').toLowerCase();
          if (placeholder.includes('search') || placeholder.includes('city') || placeholder.includes('location')) {
            return input;
          }
        }
        return null;
      });
      if (searchInput) L.info('Found search input by placeholder text');
    }

    if (searchInput) {
      // Clear existing text and type the city
      await searchInput.click({ clickCount: 3 }); // Select all
      await new Promise(r => setTimeout(r, 300));
      await page.keyboard.press('Backspace'); // Clear
      await new Promise(r => setTimeout(r, 300));

      // Type slowly like a human
      await searchInput.type(searchQuery, { delay: 100 });
      L.info('Typed city in search box');

      // Wait for dropdown to appear (Privy needs time to fetch autocomplete results)
      L.info('Waiting for autocomplete dropdown...');
      await new Promise(r => setTimeout(r, 3000));

      // DEBUG: Take screenshot of dropdown state
      try {
        const screenshotPath = `c:/Users/91812/Desktop/Demo-3 Mioym/deal-finder-1/backend/var/dropdown-${cityToUse.replace(/\s+/g, '-')}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        L.info(`Saved search dropdown screenshot for ${cityToUse}`);
      } catch (e) {}

      // Use page.evaluate to find ALL visible dropdown-like elements
      // Also use a position-based approach to find elements near the search input
      const dropdownInfo = await page.evaluate(() => {
        const results = {
          items: [],
          allDropdowns: [],
          clickableItems: [],
          positionBasedItems: []
        };

        // First, find the search input to get its position
        const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"], input[name="search"], input[class*="search"]');
        let inputRect = null;
        if (searchInput) {
          inputRect = searchInput.getBoundingClientRect();
        }

        // Find any element that might be a dropdown container
        const dropdownContainers = document.querySelectorAll(
          '[class*="dropdown"], [class*="autocomplete"], [class*="suggestion"], ' +
          '[class*="results"], [class*="menu"], [role="listbox"], [role="menu"], ' +
          'ul:not([style*="display: none"]), .location-results, .search-dropdown'
        );

        for (const container of dropdownContainers) {
          if (container.offsetHeight > 0 && container.offsetWidth > 0) {
            results.allDropdowns.push({
              tagName: container.tagName,
              className: container.className,
              id: container.id,
              childCount: container.children.length
            });

            // Look for clickable items inside
            const items = container.querySelectorAll('li, a, div[role="option"], .option, .item, .result');
            for (const item of items) {
              if (item.offsetHeight > 0 && item.textContent.trim()) {
                results.items.push({
                  text: item.textContent.trim().substring(0, 80),
                  tagName: item.tagName,
                  className: item.className
                });
                if (results.clickableItems.length < 5) {
                  results.clickableItems.push(item);
                }
              }
            }
          }
        }

        // CRITICAL: Position-based approach - find ANY element below search that looks like a location
        // This catches Privy's dropdown which may use non-standard markup
        if (inputRect) {
          const allElements = document.querySelectorAll('div, li, span, a, p');
          for (const el of allElements) {
            const rect = el.getBoundingClientRect();
            // Check if element is in the dropdown area (below and near the search input)
            if (rect.top >= inputRect.bottom - 10 &&
                rect.top <= inputRect.bottom + 350 &&
                rect.left >= inputRect.left - 100 &&
                rect.right <= inputRect.right + 300 &&
                rect.height > 15 && rect.height < 80 &&
                rect.width > 50 &&
                el.offsetHeight > 0) {
              const text = el.textContent.trim();
              // Check if it looks like a location (City, ST pattern)
              if (text && text.match(/,\s*[A-Z]{2}($|\s|\d)/) && text.length < 80 && text.length > 3) {
                // Skip if it's a child of another location item we already have
                const isDuplicate = results.positionBasedItems.some(i =>
                  i.text === text || text.includes(i.text) || i.text.includes(text)
                );
                if (!isDuplicate) {
                  results.positionBasedItems.push({
                    text: text,
                    tagName: el.tagName,
                    className: el.className?.substring?.(0, 50) || '',
                    top: Math.round(rect.top),
                    left: Math.round(rect.left),
                    height: Math.round(rect.height)
                  });
                }
              }
            }
          }
          // Sort by position (top to bottom)
          results.positionBasedItems.sort((a, b) => a.top - b.top);
        }

        // Also check for Privy-specific location dropdown
        const locationItems = document.querySelectorAll('.location-item, .city-item, .state-item, [data-location], [data-city]');
        for (const item of locationItems) {
          if (item.offsetHeight > 0) {
            results.items.push({
              text: item.textContent.trim().substring(0, 80),
              tagName: item.tagName,
              className: item.className,
              isLocationItem: true
            });
          }
        }

        return results;
      });

      L.info('Dropdown items found', { items: dropdownInfo.items.slice(0, 5), total: dropdownInfo.items.length });
      if (dropdownInfo.allDropdowns.length > 0) {
        L.info('Dropdown containers found', { containers: dropdownInfo.allDropdowns.slice(0, 3) });
      }
      // Log position-based items (the most reliable method for Privy)
      if (dropdownInfo.positionBasedItems.length > 0) {
        L.info('Position-based location items found', {
          items: dropdownInfo.positionBasedItems.slice(0, 8),
          total: dropdownInfo.positionBasedItems.length
        });
      }

      let clicked = false;

      // Method 0 (NEW): Use position-based items found by the debug scan
      // This is the most reliable method for Privy since it finds ANY element that looks like a location
      if (!clicked && dropdownInfo.positionBasedItems.length > 0) {
        const cityLower = cityToUse.toLowerCase();
        const stateLower = stateUpper.toLowerCase();
        const exactMatch = `${cityLower}, ${stateLower}`;

        // Priority 0: Find EXACT "City, ST" match
        for (const item of dropdownInfo.positionBasedItems) {
          const textLower = item.text.toLowerCase();
          if (textLower === exactMatch || textLower.startsWith(exactMatch + ' ')) {
            // Click this element using page.evaluate with position
            const clickResult = await page.evaluate((targetText) => {
              const allElements = document.querySelectorAll('div, li, span, a, p');
              for (const el of allElements) {
                if (el.textContent.trim() === targetText && el.offsetHeight > 0) {
                  el.click();
                  return { clicked: true, text: targetText };
                }
              }
              return { clicked: false };
            }, item.text);

            if (clickResult.clicked) {
              L.info('Position-based click: EXACT city match', { text: item.text, priority: 0 });
              clicked = true;
              break;
            }
          }
        }

        // Priority 1: Find item that STARTS with city name
        if (!clicked) {
          for (const item of dropdownInfo.positionBasedItems) {
            const textLower = item.text.toLowerCase();
            if (textLower.startsWith(cityLower) && textLower.includes(stateLower)) {
              const clickResult = await page.evaluate((targetText) => {
                const allElements = document.querySelectorAll('div, li, span, a, p');
                for (const el of allElements) {
                  if (el.textContent.trim() === targetText && el.offsetHeight > 0) {
                    el.click();
                    return { clicked: true, text: targetText };
                  }
                }
                return { clicked: false };
              }, item.text);

              if (clickResult.clicked) {
                L.info('Position-based click: starts-with-city match', { text: item.text, priority: 1 });
                clicked = true;
                break;
              }
            }
          }
        }

        // Priority 2: Find first item that contains both city and state
        if (!clicked) {
          for (const item of dropdownInfo.positionBasedItems) {
            const textLower = item.text.toLowerCase();
            if (textLower.includes(cityLower) && textLower.includes(stateLower)) {
              const clickResult = await page.evaluate((targetText) => {
                const allElements = document.querySelectorAll('div, li, span, a, p');
                for (const el of allElements) {
                  if (el.textContent.trim() === targetText && el.offsetHeight > 0) {
                    el.click();
                    return { clicked: true, text: targetText };
                  }
                }
                return { clicked: false };
              }, item.text);

              if (clickResult.clicked) {
                L.info('Position-based click: city+state match', { text: item.text, priority: 2 });
                clicked = true;
                break;
              }
            }
          }
        }

        // Priority 3: Click first position-based item as fallback
        if (!clicked && dropdownInfo.positionBasedItems.length > 0) {
          const firstItem = dropdownInfo.positionBasedItems[0];
          const clickResult = await page.evaluate((targetText) => {
            const allElements = document.querySelectorAll('div, li, span, a, p');
            for (const el of allElements) {
              if (el.textContent.trim() === targetText && el.offsetHeight > 0) {
                el.click();
                return { clicked: true, text: targetText };
              }
            }
            return { clicked: false };
          }, firstItem.text);

          if (clickResult.clicked) {
            L.info('Position-based click: first item fallback', { text: firstItem.text, priority: 3 });
            clicked = true;
          }
        }
      }

      // Method 1: Try to click on a dropdown item that matches BOTH city AND state
      // This handles cases where multiple cities have the same name (e.g., Springfield in multiple states)
      // Only run if position-based method didn't work
      if (!clicked) {
        const matchingItem = await page.evaluate((cityName, stateName) => {
          // Privy uses a simple dropdown that appears below the search input
          // Find the search input first, then look for dropdown elements near it
          const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"], input[name="search"], input[class*="search"]');

          // Strategy: Find ALL visible text elements that could be dropdown items
          // Privy's dropdown items appear as simple divs or spans with location text
          const allItems = document.querySelectorAll(
            // Generic elements that could contain dropdown items
            'div[class*="dropdown"] > div, div[class*="dropdown"] > span, ' +
            'div[class*="dropdown"] div[class*="item"], div[class*="dropdown"] div[class*="option"], ' +
            'ul[class*="dropdown"] li, ul[class*="dropdown"] > div, ' +
            // Autocomplete containers
            '.pac-container .pac-item, .pac-item, ' +
            '[class*="autocomplete"] > div, [class*="autocomplete"] li, ' +
            '[class*="suggestion"] > div, [class*="suggestion"] li, ' +
            // Search results
            '.search-results > div, .search-results li, ' +
            '[class*="result"] > div, [class*="results"] > div, ' +
            // Generic list items near search
            '[role="listbox"] > *, [role="listbox"] [role="option"], ' +
            '[role="menu"] > *, [role="menu"] [role="menuitem"], ' +
            // Privy-specific: look for any visible clickable div with location-like text
            'div[style*="cursor: pointer"], div[style*="cursor:pointer"], ' +
            // Any div that's a direct child of a positioned container (dropdown pattern)
            'div[style*="position: absolute"] > div, div[style*="position:absolute"] > div, ' +
            // Simple selector for any visible div that might be a dropdown item
            '.location-item, .city-item, .option, .item, .result'
          );

          const visibleItems = [];
          for (const item of allItems) {
            if (item.offsetHeight > 0 && item.textContent.trim()) {
              const text = item.textContent.trim();
              // Filter out items that are clearly not location suggestions
              // (like "Map", "Deals", navigation items, etc.)
              if (text.length < 100 && !text.match(/^(Map|List|Deals|Filter|Search|Save|Clear|Reset)$/i)) {
                visibleItems.push({
                  element: item,
                  text: text.toLowerCase(),
                  rawText: text
                });
              }
            }
          }

          // Also try a position-based approach: find elements below the search input
          // that contain location-like text (comma-separated city, state)
          if (searchInput) {
            const inputRect = searchInput.getBoundingClientRect();
            // Look for any visible elements in the area below the search input
            const allDivs = document.querySelectorAll('div, li, span, a');
            for (const el of allDivs) {
              const rect = el.getBoundingClientRect();
              // Check if element is below the search input and within dropdown area
              if (rect.top >= inputRect.bottom - 5 &&
                  rect.top <= inputRect.bottom + 300 &&
                  rect.left >= inputRect.left - 50 &&
                  rect.left <= inputRect.right + 50 &&
                  rect.height > 10 && rect.height < 60 &&
                  el.offsetHeight > 0) {
                const text = el.textContent.trim();
                // Check if it looks like a location (contains comma + 2-letter state)
                if (text && text.match(/,\s*[A-Z]{2}($|\s)/) && text.length < 100) {
                  // Check if not already in visibleItems
                  const alreadyExists = visibleItems.some(v => v.rawText === text);
                  if (!alreadyExists) {
                    visibleItems.push({
                      element: el,
                      text: text.toLowerCase(),
                      rawText: text,
                      fromPosition: true
                    });
                  }
                }
              }
            }
          }

          const cityLower = cityName.toLowerCase();
          const stateLower = stateName.toLowerCase();
          const exactMatch = `${cityLower}, ${stateLower}`;  // e.g., "charlotte, nc"

          // Priority 0: Find EXACT match "City, ST" - this is the city option, not a street
          for (const item of visibleItems) {
            // Check if text is exactly "City, State" or starts with it
            if (item.text === exactMatch || item.text.startsWith(exactMatch + ' ')) {
              item.element.click();
              return { clicked: true, text: item.rawText, matchType: 'exact-city', priority: 0 };
            }
          }

          // Priority 1: Find item that STARTS with city name (like "Charlotte, NC")
          // This avoids matching "NC-115, Charlotte, NC" which starts with a highway number
          for (const item of visibleItems) {
            if (item.text.startsWith(cityLower) && item.text.includes(stateLower)) {
              item.element.click();
              return { clicked: true, text: item.rawText, matchType: 'starts-with-city', priority: 1 };
            }
          }

          // Priority 2: Find item that contains BOTH city AND state but doesn't start with city
          for (const item of visibleItems) {
            if (item.text.includes(cityLower) && item.text.includes(stateLower)) {
              item.element.click();
              return { clicked: true, text: item.rawText, matchType: 'city+state', priority: 2 };
            }
          }

          // Priority 3: Find item that contains city name (might be in wrong state)
          for (const item of visibleItems) {
            if (item.text.includes(cityLower)) {
              item.element.click();
              return { clicked: true, text: item.rawText, matchType: 'city-only', priority: 3, warning: 'State may not match' };
            }
          }

          // Priority 4: Click first visible item as last resort
          if (visibleItems.length > 0) {
            visibleItems[0].element.click();
            return { clicked: true, text: visibleItems[0].rawText, matchType: 'first-item', priority: 4, warning: 'No city match found' };
          }

          return { clicked: false, itemsFound: visibleItems.length, sampleItems: visibleItems.slice(0, 5).map(i => i.rawText) };
        }, cityToUse, stateUpper);

        if (matchingItem.clicked) {
          L.info('Clicked dropdown item', {
            text: matchingItem.text,
            matchType: matchingItem.matchType,
            priority: matchingItem.priority,
            warning: matchingItem.warning || null
          });
          if (matchingItem.warning) {
            L.warn(`⚠️ Dropdown selection warning: ${matchingItem.warning}. Selected: "${matchingItem.text}"`);
          }
          clicked = true;
        } else {
          L.info('No dropdown items matched', {
            itemsFound: matchingItem.itemsFound || 0,
            sampleItems: matchingItem.sampleItems || []
          });
        }
      }

      // Method 2: Use keyboard navigation (Arrow Down + Enter) as fallback
      // Try up to 5 items to find one with the correct state
      if (!clicked) {
        L.info('No dropdown click, trying keyboard navigation to find correct state...');

        for (let attempt = 0; attempt < 5; attempt++) {
          await page.keyboard.press('ArrowDown');
          await new Promise(r => setTimeout(r, 300));

          // Check what's highlighted/selected
          const selectedText = await page.evaluate(() => {
            // Try to get the currently highlighted/focused dropdown item
            const focused = document.querySelector('[class*="dropdown"] li:focus, [class*="dropdown"] li.active, ' +
              '[class*="dropdown"] li.selected, [class*="dropdown"] li.highlighted, ' +
              '[aria-selected="true"], .active, .selected, .highlighted');
            return focused ? focused.textContent.trim() : null;
          });

          if (selectedText) {
            L.info(`Keyboard nav item ${attempt + 1}: "${selectedText}"`);

            // Check if this item contains our state
            if (selectedText.toLowerCase().includes(stateUpper.toLowerCase())) {
              await page.keyboard.press('Enter');
              L.info(`Selected item with correct state: "${selectedText}"`);
              clicked = true;
              break;
            }
          }
        }

        // If no match found after 5 attempts, just select current item
        if (!clicked) {
          await page.keyboard.press('Enter');
          L.warn('⚠️ Could not find item with correct state, selected current item');
          clicked = true;
        }
      }

      // Wait for search results to load
      L.info('Waiting 10 seconds for city search results...');
      await new Promise(r => setTimeout(r, 10000));

    } else {
      L.warn('Could not find search input, falling back to URL navigation...');
      // Fallback to URL navigation
      const cityUrl = `https://app.privy.pro/dashboard?update_history=true&id=&name=&saved_search=&search_text=${encodeURIComponent(searchQuery)}&location_type=city&include_sold=false&include_active=true&hoa=no&spread=50&date_range=all`;
      await page.goto(cityUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      await new Promise(r => setTimeout(r, 10000));
    }

    // Verify final URL has correct parameters
    const finalUrl = page.url();
    L.info(`Final URL: ${finalUrl.substring(0, 200)}...`);

    // Build cityUrl for reference (used in forceCorrectUrl)
    const cityUrl = `https://app.privy.pro/dashboard?update_history=true&id=&name=&saved_search=&search_text=${encodeURIComponent(searchQuery)}&location_type=city&include_sold=false&include_active=true&include_pending=false&include_under_contract=false&include_attached=false&include_detached=true&hoa=no&spread=50&spread_type=umv&date_range=all`;

    // Check if saved search got applied again
    if (finalUrl.includes('id=-') || finalUrl.includes('include_sold=true')) {
      L.error('CRITICAL: Saved search still being applied!');
      L.info('Attempting to force correct filters...');

      // FIXED: Use page.goto() instead of window.location.href
      // window.location.href triggers Privy's SPA router which reapplies saved search
      const fixedCityUrl = new URL(finalUrl);
      fixedCityUrl.searchParams.set('id', '');
      fixedCityUrl.searchParams.set('name', '');
      fixedCityUrl.searchParams.set('saved_search', '');
      fixedCityUrl.searchParams.set('search_text', cityToUse + ', ' + stateUpper);
      fixedCityUrl.searchParams.set('include_sold', 'false');
      fixedCityUrl.searchParams.set('include_active', 'true');
      fixedCityUrl.searchParams.set('include_pending', 'false');
      fixedCityUrl.searchParams.set('include_under_contract', 'false');
      fixedCityUrl.searchParams.set('include_attached', 'false');
      fixedCityUrl.searchParams.set('include_detached', 'true');
      fixedCityUrl.searchParams.set('hoa', 'no');
      fixedCityUrl.searchParams.set('spread', '50');
      fixedCityUrl.searchParams.set('date_range', 'all');

      await page.goto(fixedCityUrl.toString(), { waitUntil: 'networkidle0', timeout: 60000 });
      await new Promise(r => setTimeout(r, 5000));
    }

    // Close any modals/banners that appeared - BUT SKIP THIS as it causes Privy to reload saved search
    // await closeAllModals(page);

    // CRITICAL: After any action, force the URL back to correct values
    // Privy's frontend keeps trying to apply the saved search
    const forceCorrectUrl = async () => {
      const currentUrl = page.url();
      if (currentUrl.includes('id=-') || currentUrl.includes('include_sold=true')) {
        L.warn('URL was modified by Privy, forcing correct URL...');
        await page.goto(cityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate((url) => window.history.replaceState({}, '', url), cityUrl);
      }
    };

    await forceCorrectUrl();

    // ========== STEP 2: CLOSE ANY OPEN MODALS/PANELS (including agent profile modals) ==========
    try {
      const closedCount = await page.evaluate(() => {
        let closed = 0;

        // 1. Close agent profile modals - look for modal with agent info and X button
        // These modals typically have: agent name, photo, contact info, and an X close button
        const modalSelectors = [
          // Direct close buttons
          '[aria-label="Close"]',
          '[aria-label="close"]',
          'button[aria-label*="close" i]',
          'button[aria-label*="dismiss" i]',
          '.close-btn',
          '.modal-close',
          'button.close',
          '[data-dismiss="modal"]',
          '.panel-close',
          '.filter-close',
          '[data-testid="close"]',
          '[data-testid*="close" i]',
          // SVG close icons (X buttons)
          'button svg[class*="close" i]',
          'button svg[data-icon="xmark"]',
          'button svg[data-icon="times"]',
          'button svg[data-icon="close"]',
          // Modal header close buttons
          '.modal-header button',
          '.modal-header .close',
          '.dialog-close',
          '.popup-close',
          // Generic X button patterns in modals
          '.modal button:has(svg)',
          '[role="dialog"] button:has(svg)',
          '[class*="modal"] button[class*="close" i]',
          '[class*="popup"] button[class*="close" i]',
          '[class*="overlay"] button[class*="close" i]',
          // Agent-specific patterns
          '[class*="agent"] button[class*="close" i]',
          '[class*="profile"] button[class*="close" i]',
          '[class*="card"] button[class*="close" i]',
        ];

        // Find and click all close buttons
        for (const sel of modalSelectors) {
          try {
            const buttons = document.querySelectorAll(sel);
            buttons.forEach(btn => {
              if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                btn.click();
                closed++;
              }
            });
          } catch {}
        }

        // 2. Look for any visible overlay/backdrop and click outside to close
        const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-bg"]');
        overlays.forEach(overlay => {
          if (overlay.offsetWidth > 0 && overlay.offsetHeight > 0) {
            // Click the overlay itself (not the modal content) to close
            const rect = overlay.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              overlay.click();
              closed++;
            }
          }
        });

        // 3. Look for any floating card/panel with X button (like agent info cards)
        const floatingPanels = document.querySelectorAll('[class*="floating"], [class*="popup"], [class*="tooltip"], [class*="card"][style*="position"]');
        floatingPanels.forEach(panel => {
          const closeBtn = panel.querySelector('button, [role="button"], svg');
          if (closeBtn && closeBtn.offsetWidth > 0) {
            closeBtn.click();
            closed++;
          }
        });

        // 4. Press Escape to close any modal
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        return closed;
      });

      // Also press Escape at page level
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));

      // If we found modals, wait a bit more and try again
      if (closedCount > 0) {
        L.info(`Closed ${closedCount} modals/panels, checking for more...`);
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.press('Escape');
      }

      L.info('Closed any open modals/panels');
    } catch (e) {
      L.warn('Error closing modals', { error: e?.message });
    }

    // ========== STEP 3: VERIFY URL AND LOG CURRENT LOCATION ==========
    // Since we navigated via URL, we don't need search box - just verify we're on the right page
    let currentUrl = page.url();
    L.info(`Current URL after navigation: ${currentUrl.substring(0, 120)}...`);

    // CRITICAL: Force correct URL if Privy changed it
    await forceCorrectUrl();
    currentUrl = page.url();

    // Check if the URL contains the city search_text
    if (currentUrl.includes(encodeURIComponent(cityToUse)) || currentUrl.includes(cityToUse.replace(/ /g, '+'))) {
      L.info(`✅ URL contains city: ${cityToUse}`);
    } else {
      L.warn(`⚠️ URL may not contain city ${cityToUse} - checking search_text param...`);
    }

    // ========== STEP 4: CLOSE ANY MODALS THAT OPENED (agent profiles, etc.) - SKIP to avoid triggering saved search ==========
    // Commenting out modal closing as it triggers Privy to reload saved search
    /*
    try {
      await page.evaluate(() => {
        const modalSelectors = [
          '[aria-label="Close"]',
          '[aria-label="close"]',
          'button[aria-label*="close" i]',
          'button[aria-label*="dismiss" i]',
          '.close-btn',
          '.modal-close',
          'button.close',
          '[data-dismiss="modal"]',
          '.panel-close',
          '.filter-close',
          '[data-testid="close"]',
          '[data-testid*="close" i]',
          'button svg[data-icon="xmark"]',
          'button svg[data-icon="times"]',
          '.modal-header button',
          '.dialog-close',
          '.popup-close',
          '.modal button:has(svg)',
          '[role="dialog"] button:has(svg)',
          '[class*="modal"] button[class*="close" i]',
          '[class*="popup"] button[class*="close" i]',
          '[class*="agent"] button[class*="close" i]',
          '[class*="profile"] button[class*="close" i]',
          '[class*="card"] button[class*="close" i]',
        ];
        for (const sel of modalSelectors) {
          try {
            const buttons = document.querySelectorAll(sel);
            buttons.forEach(btn => {
              if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                btn.click();
              }
            });
          } catch {}
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
    } catch {}
    */

    // Force correct URL again after modal operations
    await forceCorrectUrl();

    // ========== STEP 5: WAIT FOR MAP DATA AND GET TOTAL COUNT ==========
    try {
      const currentUrl = page.url();
      L.info(`Current URL: ${currentUrl.substring(0, 100)}...`);

      // Wait for network to be idle (map tiles and data loading)
      L.info('Waiting for map data to load (network idle)...');
      try {
        await page.waitForNetworkIdle({ idleTime: 1500, timeout: 10000 });
        L.info('✅ Map data loaded (network idle)');
      } catch {
        L.info('Network idle timeout, continuing...');
        await new Promise(r => setTimeout(r, 1500));
      }

      // Get the total property count from the "X Properties Found" indicator
      const propertyCount = await page.evaluate(() => {
        const countSelectors = [
          '.properties-found',
          '[data-testid="properties-found"]',
          '[data-test="properties-found"]',
          '.property-count',
          '[data-testid="properties-count"]'
        ];
        for (const sel of countSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || '';
            // Extract number from text like "123 Properties Found"
            const match = text.match(/(\d[\d,]*)/);
            if (match) {
              return parseInt(match[1].replace(/,/g, ''), 10);
            }
          }
        }
        return 0;
      });
      L.info(`Total properties in city: ${propertyCount}`);

      // Emit status event with property count
      scrapeEvents.emit('status', {
        state: stateUpper,
        event: 'city_count',
        city: cityToUse,
        totalInCity: propertyCount
      });

      // ========== STEP 5.5: CLICK ON PROPERTIES COUNT TO OPEN LIST VIEW ==========
      // This opens a scrollable list of all properties instead of just clusters
      L.info('Clicking on Properties Found to open list view...');
      const listOpened = await page.evaluate(() => {
        const countSelectors = [
          '.properties-found',
          '[data-testid="properties-found"]',
          '[data-test="properties-found"]'
        ];
        for (const sel of countSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (listOpened) {
        L.info('Clicked on properties count, waiting for list to open...');
        await new Promise(r => setTimeout(r, 2000));

        // Wait for the list/grid view container to appear
        try {
          await page.waitForSelector('.view-container, .grid-view-container, [data-testid="property-list"]', { timeout: 5000 });
          L.info('✅ List view opened');
        } catch {
          L.info('List view did not open, falling back to cluster method');
        }
      }

      // Wait for clusters to appear (if still on map view)
      L.info('Waiting for clusters to appear...');
      try {
        await page.waitForSelector('.cluster.cluster-deal, .cluster', { timeout: 5000 });
        L.info('✅ Clusters appeared after search');
        await new Promise(r => setTimeout(r, 800));
      } catch {
        L.info('No clusters found, extracting visible properties...');
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (searchErr) {
      L.warn('Search/navigation failed', { error: searchErr?.message });
      await new Promise(r => setTimeout(r, 1500));
    }

    // DISABLED: closeAllModals was triggering "Below Market" saved search
    // Use Escape key instead to close any open modals safely
    try {
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
    } catch {}

    // ========== STEP 6: SCROLL TO LOAD ALL PROPERTIES ==========
    // If list view is open, scroll to load ALL properties (virtual list loads on scroll)
    const scrollAndLoadAll = async () => {
      L.info('Scrolling to load all properties...');
      let lastCount = 0;
      let sameCountIterations = 0;
      const maxIterations = 50; // Safety limit

      for (let i = 0; i < maxIterations; i++) {
        // Count current visible property cards
        const currentCount = await page.evaluate(() => {
          const cards = document.querySelectorAll('.property-module .content, .property-card, [data-testid="property-card"]');
          return cards.length;
        });

        if (currentCount === lastCount) {
          sameCountIterations++;
          if (sameCountIterations >= 3) {
            L.info(`Loaded all ${currentCount} properties (no new ones after scrolling)`);
            break;
          }
        } else {
          sameCountIterations = 0;
          L.info(`Loaded ${currentCount} properties so far...`);
        }
        lastCount = currentCount;

        // Scroll down within the property list container
        await page.evaluate(() => {
          // Try to find the scrollable container
          const containers = [
            document.querySelector('.view-container'),
            document.querySelector('.grid-view-container'),
            document.querySelector('[data-testid="property-list"]'),
            document.querySelector('.property-list'),
            document.querySelector('.properties-list'),
            document.body
          ];

          for (const container of containers) {
            if (container && container.scrollHeight > container.clientHeight) {
              container.scrollTop += 500;
              return;
            }
          }
          // Fallback: scroll the window
          window.scrollBy(0, 500);
        });

        await new Promise(r => setTimeout(r, 500));
      }
    };

    // Try to load all properties by scrolling
    await scrollAndLoadAll();

    // Click on a cluster to open the property list (fallback if list view didn't work)
    // Prefer smaller clusters (< 500) to avoid large cluster loading issues that destroy execution context
    const clusterClicked = await page.evaluate(() => {
      const clusters = document.querySelectorAll('.cluster.cluster-deal, .cluster');
      if (clusters.length === 0) {
        return { clicked: false, count: 0, reason: 'no clusters' };
      }

      // Try to find a cluster with reasonable size (check text content for number)
      let bestCluster = null;
      let bestSize = Infinity;

      for (const cluster of clusters) {
        const text = cluster.textContent?.trim() || '';
        // More robust number extraction - handle commas and various formats
        const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
        const num = parseInt(cleanText, 10);
        // Only accept clusters with < 500 properties to avoid page crashes
        if (!isNaN(num) && num > 0 && num < 500 && num < bestSize) {
          bestSize = num;
          bestCluster = cluster;
        }
      }

      // If no small cluster found, try to find any cluster under 1000
      if (!bestCluster) {
        for (const cluster of clusters) {
          const text = cluster.textContent?.trim() || '';
          const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
          const num = parseInt(cleanText, 10);
          if (!isNaN(num) && num > 0 && num < 1000 && num < bestSize) {
            bestSize = num;
            bestCluster = cluster;
          }
        }
      }

      // Last resort: use a single-property marker (no number or very small)
      if (!bestCluster) {
        for (const cluster of clusters) {
          const text = cluster.textContent?.trim() || '';
          const cleanText = text.replace(/,/g, '').replace(/[^0-9]/g, '');
          const num = parseInt(cleanText, 10);
          // Single property markers often have no number or just "1"
          if (isNaN(num) || num <= 1) {
            bestCluster = cluster;
            bestSize = num || 1;
            break;
          }
        }
      }

      // If still no suitable cluster found, skip - don't click huge clusters
      if (!bestCluster) {
        const sizes = Array.from(clusters).map(c => {
          const t = c.textContent?.trim() || '';
          return parseInt(t.replace(/,/g, '').replace(/[^0-9]/g, ''), 10) || 0;
        });
        return { clicked: false, count: clusters.length, reason: 'all clusters too large', sizes: sizes.slice(0, 5) };
      }

      bestCluster.click();
      return { clicked: true, count: clusters.length, clusterSize: bestSize };
    });

    L.info(`Clicked cluster: ${JSON.stringify(clusterClicked)}`);

    // Wait for property list to appear (only once, with early exit check)
    if (clusterClicked.clicked) {
      try {
        await page.waitForSelector(propertyListContainerSelector, { timeout: 5000 });
        L.info('Property list appeared!');
      } catch {
        // Check for 0 properties indicator for early exit
        const zeroResults = await page.evaluate(() => {
          const countEl = document.querySelector('.properties-count, [data-testid="properties-count"], .count-text');
          return countEl && (countEl.textContent?.includes('0 ') || countEl.textContent?.includes('No '));
        });
        if (zeroResults) {
          L.info('City has 0 properties, skipping...');
          continue;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Calculate how many more addresses we still need
    const stillNeededBeforeExtract = Math.max(0, limitNum - globalAddresses.length);
    if (stillNeededBeforeExtract === 0) {
      L.info(`✅ Already have ${globalAddresses.length}/${limitNum} addresses. Skipping extraction.`);
      continue;
    }

    // DISABLED: closeAllModals was triggering "Below Market" saved search
    // Use Escape key instead to close any open modals safely
    try {
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 200));
    } catch {}

    // Extract addresses AND agent details in ONE PASS from property cards (limited to what we need)
    // Uses same approach as v1.js - extract agent from mailto/tel links on cards
    const addresses = await page.evaluate((contentSel, line1Sel, line2Sel, priceSel, statsSel, maxToExtract) => {
      const results = [];

      // Agent name selectors to try on each card (same as v1.js)
      const agentNameSels = ['.agent-name', '[data-testid="agent-name"]', '.listing-agent .name', '.contact-name', '.realtor-name'];
      const getAgentName = (el) => {
        for (const sel of agentNameSels) {
          const found = el.querySelector(sel);
          if (found?.textContent?.trim()) return found.textContent.trim();
        }
        return null;
      };

      // Get mailto/tel links from card (filter out system/user emails) - same as v1.js
      const getAgentContact = (el) => {
        let email = null, phone = null;
        const mailtoLink = el.querySelector('a[href^="mailto:"]');
        if (mailtoLink) {
          const href = mailtoLink.getAttribute('href') || '';
          const candidateEmail = href.replace('mailto:', '').split('?')[0].trim();
          const lower = candidateEmail.toLowerCase();
          // Skip system/platform emails
          if (!lower.includes('privy') &&
              !lower.includes('noreply') &&
              !lower.includes('mioym') &&
              !lower.includes('support') &&
              !lower.includes('info@') &&
              !lower.includes('admin')) {
            email = candidateEmail;
          }
        }
        const telLink = el.querySelector('a[href^="tel:"]');
        if (telLink) {
          const href = telLink.getAttribute('href') || '';
          phone = href.replace('tel:', '').trim();
        }
        return { email, phone };
      };

      // Use the config selectors for property cards
      const modules = document.querySelectorAll(contentSel);

      for (const module of modules) {
        // Stop if we have enough
        if (results.length >= maxToExtract) break;
        // Try multiple selector patterns for address lines
        const line1Patterns = line1Sel.split(',').map(s => s.trim());
        const line2Patterns = line2Sel.split(',').map(s => s.trim());

        let line1El = null;
        let line2El = null;

        for (const pat of line1Patterns) {
          line1El = module.querySelector(pat);
          if (line1El) break;
        }
        for (const pat of line2Patterns) {
          line2El = module.querySelector(pat);
          if (line2El) break;
        }

        const priceEl = module.querySelector(priceSel);

        if (line1El && line2El) {
          const line1 = line1El.textContent?.trim() || '';
          const line2 = line2El.textContent?.trim() || '';
          const price = priceEl?.textContent?.trim() || '';

          if (line1 && line2) {
            // Extract quick stats (beds, baths, sqft)
            const statsPatterns = statsSel.split(',').map(s => s.trim());
            const quickStats = [];
            for (const pat of statsPatterns) {
              const statEls = module.querySelectorAll(pat);
              statEls.forEach(el => {
                const text = el.textContent?.trim();
                if (text) quickStats.push(text);
              });
              if (quickStats.length > 0) break;
            }

            // Extract agent info from card using mailto/tel links (same as v1.js)
            const agentName = getAgentName(module);
            const { email: agentEmail, phone: agentPhone } = getAgentContact(module);

            results.push({
              fullAddress: `${line1}, ${line2}`,
              price,
              agentName,
              agentEmail,
              agentPhone,
              quickStats
            });
          }
        }
      }

      return results;
    }, propertyContentSelector, addressLine1Selector, addressLine2Selector, priceSelector, propertyStatsSelector, stillNeededBeforeExtract);

    // Count how many already have agent info from card extraction
    const withAgentFromCard = addresses.filter(a => a.agentName || a.agentPhone || a.agentEmail).length;
    L.info(`Found ${addresses.length} addresses in ${cityToUse} (extracted max ${stillNeededBeforeExtract}, ${withAgentFromCard} with agent info)`);

    // Click into property details to get phone/email (which aren't usually in cards)
    // Only enrich NEW addresses (skip duplicates to save time)
    const stillNeeded = Math.max(0, limitNum - globalAddresses.length);

    // Filter out duplicates BEFORE enrichment to avoid wasting time
    const newAddresses = addresses.filter(addr => {
      const key = addr.fullAddress?.toLowerCase();
      return key && !seenAddressKeys.has(key);
    });

    const maxAgentEnrich = Math.min(newAddresses.length, stillNeeded);

    if (newAddresses.length < addresses.length) {
      L.info(`Skipping ${addresses.length - newAddresses.length} duplicate addresses`);
    }

    if (shouldEnrichAgent && maxAgentEnrich > 0) {
      L.info(`Enriching phone/email for ${maxAgentEnrich} NEW properties (skipped ${addresses.length - newAddresses.length} duplicates)...`);

      for (let idx = 0; idx < maxAgentEnrich; idx++) {
        try {
          // Click on the property card at this index to open detail view
          const clicked = await page.evaluate((contentSel, openDetailSel, idx) => {
            const modules = document.querySelectorAll(contentSel);
            if (modules[idx]) {
              // Find the best clickable element - try openDetailSelector patterns first
              const openPatterns = openDetailSel.split(',').map(s => s.trim());
              for (const pat of openPatterns) {
                const clickable = modules[idx].querySelector(pat);
                if (clickable) {
                  clickable.click();
                  return { clicked: true, method: pat };
                }
              }
              // Fallback: click the module itself or find any anchor
              const fallback = modules[idx].querySelector('a') || modules[idx];
              fallback.click();
              return { clicked: true, method: 'fallback' };
            }
            return { clicked: false };
          }, propertyContentSelector, openDetailSelector, idx);

          if (clicked.clicked) {
            // Wait for detail panel/modal to load
            await new Promise(r => setTimeout(r, 1500));

            // Scroll down to reveal more content (agent info may be below the fold)
            await page.evaluate(() => {
              // Try scrolling the detail panel/modal
              const detailPanel = document.querySelector('.detail-panel, .property-detail, .modal-body, [class*="detail"]');
              if (detailPanel) {
                detailPanel.scrollTop = detailPanel.scrollHeight;
              }
              // Also scroll window
              window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise(r => setTimeout(r, 500));

            // Look for and click "Contact Agent" or similar buttons to reveal email
            await page.evaluate(() => {
              const contactBtns = document.querySelectorAll('button, a');
              for (const btn of contactBtns) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('contact') || text.includes('agent') || text.includes('email') || text.includes('show')) {
                  btn.click();
                  return true;
                }
              }
              return false;
            });
            await new Promise(r => setTimeout(r, 500));

            // Extract agent info from the detail view using ONLY Privy's labeled fields
            // Privy shows: "List Agent Direct Phone:", "List Agent Email:", "List Agent First/Last Name:", etc.
            // We ONLY use these labeled fields to avoid grabbing wrong agent info.
            const agentInfo = await page.evaluate(() => {
              let agentName = null, agentEmail = null, agentPhone = null, brokerage = null;
              let debugInfo = { foundElements: [] };
              const pageText = document.body.innerText || '';

              // ========== PRIVY-SPECIFIC LABELED FIELDS ONLY ==========

              // 1. PHONE: "List Agent Direct Phone: 678-951-7041"
              const phoneLabeled = pageText.match(/List\s+Agent\s+(?:Direct\s+)?Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
              if (phoneLabeled) {
                agentPhone = phoneLabeled[1].trim();
                debugInfo.foundElements.push({ sel: 'List Agent Phone', text: agentPhone });
              }
              // Fallback to office phone only if no agent phone
              if (!agentPhone) {
                const officePhoneLabeled = pageText.match(/List\s+Office\s+Phone\s*[:\s]\s*([(\d)\s\-\.]+\d)/i);
                if (officePhoneLabeled) {
                  agentPhone = officePhoneLabeled[1].trim();
                  debugInfo.foundElements.push({ sel: 'List Office Phone', text: agentPhone });
                }
              }

              // 2. EMAIL: "List Agent Email: amyksellsga@gmail.com"
              const emailLabeled = pageText.match(/List\s+Agent\s+Email\s*[:\s]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
              if (emailLabeled) {
                agentEmail = emailLabeled[1].trim();
                debugInfo.foundElements.push({ sel: 'List Agent Email', text: agentEmail });
              }

              // 3. NAME: Try multiple Privy formats
              // "List Agent Full Name: Jesse Burns"
              const fullNameMatch = pageText.match(/List\s+Agent\s+Full\s+Name\s*[:\s]\s*([^\n]+)/i);
              if (fullNameMatch) {
                let extractedName = fullNameMatch[1].trim();
                extractedName = extractedName.split(/(?:List Agent|Direct Phone|Email|Office)/i)[0].trim();
                if (extractedName.length > 3) {
                  agentName = extractedName;
                  debugInfo.foundElements.push({ sel: 'List Agent Full Name', text: agentName });
                }
              }

              // "List Agent First Name: Amy" + "List Agent Last Name: Smith"
              if (!agentName) {
                const firstMatch = pageText.match(/List\s+Agent\s+First\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
                const lastMatch = pageText.match(/List\s+Agent\s+Last\s+Name\s*[:\s]\s*([A-Za-z]+)/i);
                if (firstMatch && lastMatch) {
                  agentName = `${firstMatch[1].trim()} ${lastMatch[1].trim()}`;
                  debugInfo.foundElements.push({ sel: 'List Agent First+Last Name', text: agentName });
                }
              }

              // 4. BROKERAGE: "List Office Name: Keller Williams Realty Community Partners"
              const officeNameMatch = pageText.match(/List\s+Office\s+Name\s*[:\s]\s*([^\n]+)/i);
              if (officeNameMatch) {
                let officeName = officeNameMatch[1].trim();
                // Clean up - remove trailing labels
                officeName = officeName.split(/(?:List Agent|List Office Phone|Direct Phone|Email)/i)[0].trim();
                if (officeName.length > 2) {
                  brokerage = officeName;
                  debugInfo.foundElements.push({ sel: 'List Office Name', text: brokerage });
                }
              }

              return { agentName, agentEmail, agentPhone, brokerage, debug: debugInfo };
            });

            // Update the address with agent info
            if (agentInfo.agentName || agentInfo.agentEmail || agentInfo.agentPhone || agentInfo.brokerage) {
              addresses[idx].agentName = agentInfo.agentName;
              addresses[idx].agentEmail = agentInfo.agentEmail;
              addresses[idx].agentPhone = agentInfo.agentPhone;
              addresses[idx].brokerage = agentInfo.brokerage;
              L.info(`  Agent #${idx + 1}: ${agentInfo.agentName || 'N/A'}, ${agentInfo.agentPhone || 'N/A'}, ${agentInfo.agentEmail || 'N/A'}, Brokerage: ${agentInfo.brokerage || 'N/A'}`);
            }

            // Close the detail view - try multiple methods
            try {
              // Try clicking close button first
              const closed = await page.evaluate(() => {
                const closeBtn = document.querySelector('.close-btn, .close, [aria-label="Close"], .modal-close, button.close');
                if (closeBtn) { closeBtn.click(); return true; }
                return false;
              });
              if (!closed) {
                await page.keyboard.press('Escape');
              }
            } catch {}
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (agentErr) {
          L.warn(`Agent enrichment failed for property ${idx + 1}: ${agentErr.message}`);
        }
      }
    }

    // If first cluster didn't give results, try clicking more clusters
    if (addresses.length === 0 && clusterClicked.count > 1) {
      L.info('No addresses from first cluster, trying more clusters...');

      for (let clusterIdx = 1; clusterIdx < Math.min(clusterClicked.count, 3); clusterIdx++) {
        // Click on map to close current view
        await page.mouse.click(400, 300);
        await new Promise(r => setTimeout(r, 1000));

        // Click next cluster
        const nextClicked = await page.evaluate((idx) => {
          const clusters = document.querySelectorAll('.cluster.cluster-deal, .cluster');
          if (clusters.length > idx) {
            clusters[idx].click();
            return true;
          }
          return false;
        }, clusterIdx);

        if (nextClicked) {
          L.info(`Clicked cluster ${clusterIdx + 1}, waiting for properties...`);
          // OPTIMIZED: Wait for selector instead of fixed 8s
          try {
            await page.waitForSelector(propertyListContainerSelector, { timeout: 3000 });
          } catch {
            await new Promise(r => setTimeout(r, 1500));
          }

          // Extract from this cluster using proper selectors
          const moreAddresses = await page.evaluate((contentSel, line1Sel, line2Sel, priceSel, statsSel) => {
            const results = [];
            const modules = document.querySelectorAll(contentSel);
            for (const module of modules) {
              const line1Patterns = line1Sel.split(',').map(s => s.trim());
              const line2Patterns = line2Sel.split(',').map(s => s.trim());
              let line1El = null, line2El = null;
              for (const pat of line1Patterns) { line1El = module.querySelector(pat); if (line1El) break; }
              for (const pat of line2Patterns) { line2El = module.querySelector(pat); if (line2El) break; }
              const priceEl = module.querySelector(priceSel);
              if (line1El && line2El) {
                const line1 = line1El.textContent?.trim() || '';
                const line2 = line2El.textContent?.trim() || '';
                const price = priceEl?.textContent?.trim() || '';
                if (line1 && line2) {
                  // Extract quick stats
                  const statsPatterns = statsSel.split(',').map(s => s.trim());
                  const quickStats = [];
                  for (const pat of statsPatterns) {
                    const statEls = module.querySelectorAll(pat);
                    statEls.forEach(el => { const text = el.textContent?.trim(); if (text) quickStats.push(text); });
                    if (quickStats.length > 0) break;
                  }
                  results.push({ fullAddress: `${line1}, ${line2}`, price, agentName: null, agentEmail: null, agentPhone: null, quickStats });
                }
              }
            }
            return results;
          }, propertyContentSelector, addressLine1Selector, addressLine2Selector, priceSelector, propertyStatsSelector);

          L.info(`Cluster ${clusterIdx + 1} yielded ${moreAddresses.length} addresses`);

          // Add new addresses
          for (const addr of moreAddresses) {
            if (!addresses.find(a => a.fullAddress === addr.fullAddress)) {
              addresses.push(addr);
            }
          }

          if (addresses.length >= 20) break; // Got enough from this city
        }
      }
    }

    L.info(`Total from ${cityToUse}: ${addresses.length} addresses`);

    // Only take addresses up to what we need (respecting the limit)
    const addressesToAdd = addresses.slice(0, stillNeeded);
    L.info(`Adding ${addressesToAdd.length} of ${addresses.length} addresses (need ${stillNeeded} more to reach limit of ${limitNum})`);

    // Add to global addresses with deduplication AND state validation
    let validCount = 0;
    let rejectedCount = 0;

    // Debug: log first few addresses to understand format
    if (addressesToAdd.length > 0) {
      L.info(`Sample addresses from ${cityToUse}:`, {
        first3: addressesToAdd.slice(0, 3).map(a => a.fullAddress)
      });
    }

    for (const addr of addressesToAdd) {
      if (globalAddresses.length >= limitNum) break;

      const addrKey = addr.fullAddress.toLowerCase();
      if (seenAddressKeys.has(addrKey)) continue;

      // Extract state from the actual address and validate it matches requested state
      const extractedState = extractStateFromAddress(addr.fullAddress);

      // Debug: log extraction results for first few
      if (validCount + rejectedCount < 3) {
        L.debug(`State extraction: "${addr.fullAddress}" -> extracted: "${extractedState}", expected: "${stateUpper}"`);
      }

      if (extractedState && extractedState !== stateUpper) {
        // Address contains WRONG state - reject it
        rejectedCount++;
        if (rejectedCount <= 3) {
          L.info(`Rejected address: extracted="${extractedState}" vs expected="${stateUpper}": ${addr.fullAddress}`);
        }
        continue;
      }

      seenAddressKeys.add(addrKey);
      const newAddress = {
        ...addr,
        city: cityToUse,
        state: extractedState || stateUpper, // Use extracted state, fallback to requested
        source: 'privy',
        scrapedAt: new Date().toISOString()
      };
      globalAddresses.push(newAddress);
      validCount++;

      // Emit real-time event for SSE clients
      scrapeEvents.emit('address', {
        state: stateUpper,
        city: cityToUse,
        address: newAddress,
        progress: {
          current: globalAddresses.length,
          limit: limitNum
        }
      });
    }

    if (rejectedCount > 0) {
      L.info(`Filtered out ${rejectedCount} addresses from wrong states`);
    }
    L.info(`City ${cityToUse} complete: ${validCount} valid addresses, global total: ${globalAddresses.length}/${limitNum}`);

    // Early exit if we've reached the limit
    if (globalAddresses.length >= limitNum) {
      L.info(`✅ LIMIT REACHED: Got ${globalAddresses.length}/${limitNum} addresses. Stopping city loop.`);
      break;
    }

    // Track consecutive cities with no new valid addresses for early exit
    if (validCount === 0) {
      consecutiveEmptyCities++;
      if (consecutiveEmptyCities >= 3) {
        L.warn(`⚠️ EARLY EXIT: ${consecutiveEmptyCities} consecutive cities returned 0 new valid addresses. Privy may be returning stale data.`);
        L.info(`Stopping early with ${globalAddresses.length}/${limitNum} addresses to save time.`);
        break;
      }
    } else {
      consecutiveEmptyCities = 0; // Reset counter when we find valid addresses
    }

    } // ============ END MULTI-CITY LOOP ============

    // Enforce the limit - only return the requested number of addresses
    let finalAddresses = globalAddresses.slice(0, limitNum);

    L.info(`\n========== SCRAPING COMPLETE ==========`);
    L.info(`Total addresses scraped: ${globalAddresses.length}, returning: ${finalAddresses.length} (limit: ${limitNum})`);
    L.info(`Cities scraped: ${citiesScraped.join(', ')}`);

    // Emit completion event for SSE clients
    scrapeEvents.emit('complete', {
      state: stateUpper,
      totalAddresses: finalAddresses.length,
      citiesScraped: citiesScraped,
      limit: limitNum
    });

    // Calculate agent enrichment stats from in-loop enrichment
    const withNameCount = finalAddresses.filter(p => p.agentName).length;
    const withPhoneCount = finalAddresses.filter(p => p.agentPhone).length;
    const withEmailCount = finalAddresses.filter(p => p.agentEmail).length;
    const withBrokerageCount = finalAddresses.filter(p => p.brokerage).length;
    const agentEnrichmentStats = {
      total: finalAddresses.length,
      withName: withNameCount,
      withPhone: withPhoneCount,
      withEmail: withEmailCount,
      withBrokerage: withBrokerageCount
    };
    L.info(`Agent stats: ${withPhoneCount}/${finalAddresses.length} have phone, ${withEmailCount} have email, ${withBrokerageCount} have brokerage`);

    // Save session after successful scrape
    try { await sessionStore.saveSessionCookies(page); } catch {}

    // Track the last scraped state for state change detection
    lastScrapedState = stateUpper;

    // Release scraping slot for next request
    releaseScrapingSlot();

    // AUTO-BOFA: If enabled, fetch BofA valuations for the scraped addresses
    let bofaResults = null;
    if (shouldAutoBofa && finalAddresses.length > 0) {
      L.info(`Auto-BofA enabled, fetching valuations for ${finalAddresses.length} addresses...`);
      try {
        const authHeader = req.headers.authorization;
        const addressList = finalAddresses.map(a => a.fullAddress);

        // Call BofA batch endpoint internally (use the same host as the current request)
        const host = req.get('host') || `localhost:${process.env.PORT || 3015}`;
        const protocol = req.protocol || 'http';
        const bofaResponse = await fetch(`${protocol}://${host}/api/bofa/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify({
            addresses: addressList,
            concurrency: 3
          })
        });

        const bofaData = await bofaResponse.json();
        if (bofaData.ok && bofaData.results) {
          // Merge BofA results with addresses
          const bofaMap = new Map();
          for (const result of bofaData.results) {
            if (result.address) {
              bofaMap.set(result.address.toLowerCase(), result);
            }
          }

          // Attach BofA values to addresses
          for (const addr of finalAddresses) {
            const bofaResult = bofaMap.get(addr.fullAddress.toLowerCase());
            if (bofaResult) {
              addr.bofaValue = bofaResult.amv || bofaResult.avgSalePrice || bofaResult.estimatedHomeValue;
              addr.avgSalePrice = bofaResult.avgSalePrice;
              addr.estimatedHomeValue = bofaResult.estimatedHomeValue;
            }
          }

          bofaResults = {
            total: bofaData.results.length,
            successful: bofaData.results.filter(r => r.amv || r.avgSalePrice).length,
            failed: bofaData.results.filter(r => !r.amv && !r.avgSalePrice).length
          };
          L.info(`Auto-BofA complete: ${bofaResults.successful}/${bofaResults.total} addresses valued`);
        } else {
          L.warn('Auto-BofA failed', { error: bofaData.error });
        }
      } catch (bofaErr) {
        L.error('Auto-BofA error', { error: bofaErr.message });
      }
    }

    // Release scraping slot on success
    releaseScrapingSlot();

    // Save to ScrapedDeal for Pending AMV display
    let savedCount = 0;
    let skippedCount = 0;
    for (const addr of finalAddresses) {
      try {
        const fullAddress = addr.fullAddress?.trim();
        if (!fullAddress) continue;

        const fullAddress_ci = fullAddress.toLowerCase();

        // Parse price as number
        let listingPrice = null;
        if (addr.price) {
          const priceStr = String(addr.price).replace(/[^0-9.]/g, '');
          listingPrice = parseFloat(priceStr) || null;
        }

        await ScrapedDeal.findOneAndUpdate(
          { fullAddress_ci },
          {
            $setOnInsert: {
              address: addr.address || fullAddress.split(',')[0].trim(),
              fullAddress,
              fullAddress_ci,
              city: addr.city || null,
              state: addr.state || stateUpper,
              zip: addr.zip || null,
              source: 'privy',
              scrapedAt: new Date(),
              createdAt: new Date(),
            },
            $set: {
              listingPrice,
              beds: addr.quickStats?.beds || null,
              baths: addr.quickStats?.baths || null,
              sqft: addr.quickStats?.sqft || null,
              agentName: addr.agentName || null,
              agentEmail: addr.agentEmail || null,
              agentPhone: addr.agentPhone || null,
              updatedAt: new Date(),
            }
          },
          { upsert: true, new: true }
        );
        savedCount++;
      } catch (saveErr) {
        if (saveErr.code !== 11000) {
          L.warn('Failed to save to ScrapedDeal', { address: addr.fullAddress, error: saveErr.message });
        }
        skippedCount++;
      }
    }
    L.info(`Saved ${savedCount} addresses to ScrapedDeal (${skippedCount} skipped/duplicates)`);

    return res.json({
      ok: true,
      state: stateUpper,
      citiesScraped: citiesScraped,
      totalCitiesAvailable: stateCities.length,
      count: finalAddresses.length,
      limit: limitNum,
      limitReached: finalAddresses.length >= limitNum,
      addresses: finalAddresses,
      agentEnrichment: agentEnrichmentStats,
      bofaResults: bofaResults,
      savedToScrapedDeal: savedCount,
      attempt: attempt // Include which attempt succeeded
    });

    } catch (error) {
      lastError = error;
      L.error('Live Privy scrape failed', { error: error.message, attempt: attempt });

      // Emit error event for SSE clients
      scrapeEvents.emit('error', {
        state: stateUpper,
        error: error.message,
        attempt: attempt,
        maxRetries: MAX_SCRAPE_RETRIES
      });

      // Check if error is recoverable
      if (isRecoverableError(error.message)) {
        L.info(`Recoverable error detected, resetting bot for retry`, {
          attempt: attempt,
          maxRetries: MAX_SCRAPE_RETRIES,
          error: error.message
        });
        await resetSharedBot();

        // If we have more retries, continue the loop
        if (attempt < MAX_SCRAPE_RETRIES) {
          continue; // Try again
        }
      }

      // Non-recoverable error or max retries reached - exit loop
      break;
    }
  } // End of retry loop

  // If we get here with lastError, all retries failed
  if (lastError) {
    L.error('All retry attempts failed', {
      error: lastError.message,
      attempts: MAX_SCRAPE_RETRIES
    });

    // Release scraping slot
    releaseScrapingSlot();

    // Reset bot state
    botInitializing = false;

    return res.status(500).json({
      ok: false,
      error: lastError.message || 'Failed to scrape addresses',
      message: `Live scraping error after ${MAX_SCRAPE_RETRIES} attempts`,
      retriesExhausted: true
    });
  }
}

// Main authenticated endpoint
router.get('/privy', requireAuth, privyHandler);

/**
 * GET /api/live-scrape/redfin
 *
 * Scrapes addresses LIVE from Redfin.com and returns them immediately
 * Does NOT save to database - just for validation/testing
 * NO AUTHENTICATION REQUIRED - works without database
 *
 * Query params:
 *   - state: State code (e.g., CA, NY) - REQUIRED
 *   - city: City name (optional, but recommended)
 *   - limit: Max addresses to return (default: 20)
 *
 * Hardcoded filters applied:
 *   - For Sale, Active
 *   - Price: $50K - $500K
 *   - Beds: 3+
 *   - Home Type: House
 *   - Sqft: 1000+
 *   - No HOA
 */
router.get('/redfin', async (req, res) => {
  try {
    const { state, city = '', limit = 20, page = 1, enrichAgent = 'true' } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const shouldEnrichAgent = enrichAgent === 'true' || enrichAgent === '1';

    if (!state) {
      return res.status(400).json({
        ok: false,
        error: 'State parameter is required',
        message: 'Please provide a state code (e.g., CA, NY, TX)'
      });
    }

    L.info('Starting Redfin web scraping', { state, city, limit: limitNum, page: pageNum });

    // Map state code to state name
    const { STATES } = await import('../constants.js');
    const stateInfo = STATES.find(s => s.code === state.toUpperCase());

    if (!stateInfo) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid state code',
        message: `State "${state}" not found. Please use valid 2-letter state codes like CA, NY, TX`
      });
    }

    // Hardcoded filters as per requirements
    const REDFIN_FILTERS = [
      'property-type=house',
      'status=active',
      'min-price=50k',
      'max-price=500k',
      'min-beds=3',
      'min-sqft=1k-sqft',
      'hoa=0',
      'exclude-55+-community',
      'listing-source=agent,owner,foreclosure'
    ].join(',');

    // Skip browser scraping (too slow) - go directly to API
    // Try the direct API with city-level query (faster)
    try {
      const axios = (await import('axios')).default;

      // Multiple cities per state for fallback fetching (ordered by population/activity)
      const STATE_CITIES_LIST = {
        'AL': [{ name: 'Birmingham', id: 1823 }, { name: 'Huntsville', id: 8966 }, { name: 'Montgomery', id: 12923 }, { name: 'Mobile', id: 11715 }],
        'AK': [{ name: 'Anchorage', id: 781 }, { name: 'Fairbanks', id: 6603 }, { name: 'Juneau', id: 9483 }],
        'AZ': [{ name: 'Phoenix', id: 14240 }, { name: 'Tucson', id: 18805 }, { name: 'Mesa', id: 11350 }, { name: 'Scottsdale', id: 16095 }],
        'AR': [{ name: 'Little Rock', id: 10455 }, { name: 'Fort Smith', id: 7034 }, { name: 'Fayetteville', id: 6708 }],
        'CA': [{ name: 'Los Angeles', id: 11203 }, { name: 'San Diego', id: 16904 }, { name: 'San Jose', id: 17420 }, { name: 'San Francisco', id: 17151 }, { name: 'Fresno', id: 7240 }],
        'CO': [{ name: 'Denver', id: 5155 }, { name: 'Colorado Springs', id: 4436 }, { name: 'Aurora', id: 1025 }, { name: 'Fort Collins', id: 7010 }],
        'CT': [{ name: 'Hartford', id: 9406 }, { name: 'New Haven', id: 13172 }, { name: 'Stamford', id: 17822 }, { name: 'Bridgeport', id: 2349 }],
        'DE': [{ name: 'Wilmington', id: 19583 }, { name: 'Dover', id: 5566 }, { name: 'Newark', id: 13139 }],
        'FL': [{ name: 'Miami', id: 11458 }, { name: 'Orlando', id: 14038 }, { name: 'Tampa', id: 18349 }, { name: 'Jacksonville', id: 9277 }, { name: 'Fort Lauderdale', id: 7005 }],
        'GA': [{ name: 'Atlanta', id: 30756 }, { name: 'Savannah', id: 16044 }, { name: 'Augusta', id: 1020 }, { name: 'Columbus', id: 4665 }],
        'HI': [{ name: 'Honolulu', id: 34945 }],
        'ID': [{ name: 'Boise', id: 2287 }, { name: 'Meridian', id: 11344 }, { name: 'Nampa', id: 13024 }],
        'IL': [{ name: 'Chicago', id: 29470 }, { name: 'Aurora', id: 1026 }, { name: 'Naperville', id: 13032 }, { name: 'Rockford', id: 15936 }],
        'IN': [{ name: 'Indianapolis', id: 9170 }, { name: 'Fort Wayne', id: 7033 }, { name: 'Evansville', id: 6489 }, { name: 'South Bend', id: 17551 }],
        'IA': [{ name: 'Des Moines', id: 5415 }, { name: 'Cedar Rapids', id: 3294 }, { name: 'Davenport', id: 5038 }],
        'KS': [{ name: 'Wichita', id: 19878 }, { name: 'Overland Park', id: 14080 }, { name: 'Kansas City', id: 9498 }, { name: 'Topeka', id: 18595 }],
        'KY': [{ name: 'Louisville', id: 12262 }, { name: 'Lexington', id: 10351 }, { name: 'Bowling Green', id: 2315 }],
        'LA': [{ name: 'New Orleans', id: 14233 }, { name: 'Baton Rouge', id: 1467 }, { name: 'Shreveport', id: 17324 }],
        'ME': [{ name: 'Portland', id: 15614 }, { name: 'Lewiston', id: 10356 }, { name: 'Bangor', id: 1334 }],
        'MD': [{ name: 'Baltimore', id: 1073 }, { name: 'Columbia', id: 4519 }, { name: 'Germantown', id: 7540 }, { name: 'Silver Spring', id: 17355 }],
        'MA': [{ name: 'Boston', id: 1826 }, { name: 'Worcester', id: 19753 }, { name: 'Springfield', id: 17750 }, { name: 'Cambridge', id: 2965 }],
        'MI': [{ name: 'Detroit', id: 5665 }, { name: 'Grand Rapids', id: 7820 }, { name: 'Warren', id: 19148 }, { name: 'Ann Arbor', id: 798 }],
        'MN': [{ name: 'Minneapolis', id: 10943 }, { name: 'Saint Paul', id: 16814 }, { name: 'Rochester', id: 15906 }, { name: 'Duluth', id: 5778 }],
        'MS': [{ name: 'Jackson', id: 9165 }, { name: 'Gulfport', id: 8193 }, { name: 'Hattiesburg', id: 8581 }],
        'MO': [{ name: 'Kansas City', id: 35751 }, { name: 'Saint Louis', id: 16815 }, { name: 'Springfield', id: 17751 }, { name: 'Columbia', id: 4520 }],
        'MT': [{ name: 'Billings', id: 1720 }, { name: 'Missoula', id: 11707 }, { name: 'Great Falls', id: 8021 }],
        'NE': [{ name: 'Omaha', id: 9417 }, { name: 'Lincoln', id: 10414 }, { name: 'Bellevue', id: 1587 }],
        'NV': [{ name: 'Las Vegas', id: 10201 }, { name: 'Henderson', id: 8728 }, { name: 'Reno', id: 15740 }, { name: 'North Las Vegas', id: 13583 }],
        'NH': [{ name: 'Manchester', id: 11504 }, { name: 'Nashua', id: 13082 }, { name: 'Concord', id: 4588 }],
        'NJ': [{ name: 'Newark', id: 13136 }, { name: 'Jersey City', id: 9409 }, { name: 'Paterson', id: 14185 }, { name: 'Elizabeth', id: 6177 }, { name: 'Trenton', id: 18700 }],
        'NM': [{ name: 'Albuquerque', id: 513 }, { name: 'Las Cruces', id: 10184 }, { name: 'Rio Rancho', id: 15857 }, { name: 'Santa Fe', id: 16949 }],
        'NY': [{ name: 'New York', id: 30749 }, { name: 'Buffalo', id: 2704 }, { name: 'Rochester', id: 15907 }, { name: 'Syracuse', id: 18277 }, { name: 'Albany', id: 488 }],
        'NC': [{ name: 'Charlotte', id: 3105 }, { name: 'Raleigh', id: 15533 }, { name: 'Greensboro', id: 8050 }, { name: 'Durham', id: 5830 }, { name: 'Winston-Salem', id: 19657 }, { name: 'Fayetteville', id: 5903 }],
        'ND': [{ name: 'Fargo', id: 6610 }, { name: 'Bismarck', id: 1749 }, { name: 'Grand Forks', id: 7813 }],
        'OH': [{ name: 'Columbus', id: 4664 }, { name: 'Cleveland', id: 4207 }, { name: 'Cincinnati', id: 3959 }, { name: 'Toledo', id: 18553 }, { name: 'Akron', id: 468 }],
        'OK': [{ name: 'Oklahoma City', id: 14237 }, { name: 'Tulsa', id: 35765 }, { name: 'Norman', id: 13561 }, { name: 'Broken Arrow', id: 2451 }],
        'OR': [{ name: 'Portland', id: 30772 }, { name: 'Salem', id: 16843 }, { name: 'Eugene', id: 6460 }, { name: 'Gresham', id: 8108 }],
        'PA': [{ name: 'Philadelphia', id: 15502 }, { name: 'Pittsburgh', id: 14431 }, { name: 'Allentown', id: 556 }, { name: 'Reading', id: 15662 }],
        'RI': [{ name: 'Providence', id: 15272 }, { name: 'Warwick', id: 19168 }, { name: 'Cranston', id: 4868 }],
        'SC': [{ name: 'Charleston', id: 3478 }, { name: 'Columbia', id: 4521 }, { name: 'Greenville', id: 8064 }, { name: 'Myrtle Beach', id: 13009 }],
        'SD': [{ name: 'Sioux Falls', id: 15282 }, { name: 'Rapid City', id: 15565 }],
        'TN': [{ name: 'Nashville', id: 13415 }, { name: 'Memphis', id: 11323 }, { name: 'Knoxville', id: 9766 }, { name: 'Chattanooga', id: 3561 }],
        'TX': [{ name: 'Houston', id: 8903 }, { name: 'San Antonio', id: 16898 }, { name: 'Dallas', id: 4995 }, { name: 'Austin', id: 1028 }, { name: 'Fort Worth', id: 7036 }, { name: 'El Paso', id: 6155 }],
        'UT': [{ name: 'Salt Lake City', id: 17150 }, { name: 'West Valley City', id: 19436 }, { name: 'Provo', id: 15276 }, { name: 'Ogden', id: 13864 }],
        'VT': [{ name: 'Burlington', id: 2749 }, { name: 'South Burlington', id: 17552 }],
        'VA': [{ name: 'Virginia Beach', id: 20418 }, { name: 'Norfolk', id: 13560 }, { name: 'Chesapeake', id: 3595 }, { name: 'Richmond', id: 15819 }, { name: 'Arlington', id: 895 }],
        'WA': [{ name: 'Seattle', id: 16163 }, { name: 'Spokane', id: 17717 }, { name: 'Tacoma', id: 18299 }, { name: 'Vancouver', id: 18994 }, { name: 'Bellevue', id: 1588 }],
        'WV': [{ name: 'Charleston', id: 3787 }, { name: 'Huntington', id: 8970 }, { name: 'Morgantown', id: 12007 }],
        'WI': [{ name: 'Milwaukee', id: 35759 }, { name: 'Madison', id: 11445 }, { name: 'Green Bay', id: 8039 }, { name: 'Kenosha', id: 9603 }],
        'WY': [{ name: 'Cheyenne', id: 3616 }, { name: 'Casper', id: 3236 }, { name: 'Laramie', id: 10138 }]
      };

      // Legacy single city mapping (for backwards compatibility)
      const STATE_DEFAULT_CITIES = Object.fromEntries(
        Object.entries(STATE_CITIES_LIST).map(([state, cities]) => [state, cities[0]])
      );

      const stateUpper = state.toUpperCase();
      const defaultCity = STATE_DEFAULT_CITIES[stateUpper];

      if (!defaultCity) {
        throw new Error(`Unknown state: ${state}`);
      }

      // Determine which city to use - if user selected a city, look it up; otherwise use default
      let cityToUse = defaultCity;
      const userCity = city ? city.trim() : '';

      if (userCity && userCity.toLowerCase() !== defaultCity.name.toLowerCase()) {
        // User selected a different city - look up its ID from Redfin autocomplete API
        try {
          L.info(`Looking up city ID for: ${userCity}, ${stateUpper}`);
          const autocompleteUrl = `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(userCity + ', ' + stateUpper)}&v=2`;

          const autoResponse = await axios.get(autocompleteUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': 'https://www.redfin.com/'
            },
            timeout: 10000
          });

          let autoData = autoResponse.data;
          if (typeof autoData === 'string') {
            autoData = autoData.replace(/^\{\}&&/, '');
            autoData = JSON.parse(autoData);
          }

          L.info(`Autocomplete response sections: ${JSON.stringify(autoData.payload?.sections?.length || 0)}`);

          const sections = autoData.payload?.sections || [];
          let foundCity = false;

          for (const section of sections) {
            const rows = section.rows || [];
            for (const row of rows) {
              const rowType = parseInt(row.type);
              L.info(`Row: type=${rowType}, name=${row.name}, id=${row.id}`);

              // Look for city (type 2) or neighborhood (type 6) - Redfin returns actual cities as type 2
              // Type 2 = City, Type 6 = Neighborhood
              if ((rowType === 2 || rowType === 6) && row.id) {
                // Extract city ID from format like "2_1234" or "6_1234"
                const idParts = row.id.toString().split('_');
                const cityIdMatch = idParts.length > 1 ? idParts[1] : idParts[0];

                if (cityIdMatch) {
                  cityToUse = { name: userCity, id: parseInt(cityIdMatch) };
                  L.info(`✅ Found city ID for ${userCity}: ${cityToUse.id} (type=${rowType}, from row: ${row.name})`);
                  foundCity = true;
                  break;
                }
              }
            }
            if (foundCity) break;
          }

          if (!foundCity) {
            L.warn(`City ${userCity} not found in autocomplete, using default city ${defaultCity.name}`);
          }
        } catch (lookupErr) {
          L.warn(`City lookup failed for ${userCity}, using default city: ${lookupErr.message}`);
        }
      }

      // Use city-level query with market parameter - this returns correct state data
      const market = stateUpper.toLowerCase();

      // Different sort orders for pagination to get different results each page
      const sortOptions = ['redfin-recommended-asc', 'price-asc', 'price-desc', 'newest', 'beds-desc', 'sqft-desc'];
      const sortOrder = sortOptions[(pageNum - 1) % sortOptions.length];

      // Filter function for homes
      const filterHome = (home) => {
        const MIN_PRICE = 50000, MAX_PRICE = 500000, MIN_BEDS = 3, MIN_SQFT = 1000;
        const price = home.price?.value || home.price || 0;
        const beds = home.beds || 0;
        const sqft = home.sqFt?.value || home.sqFt || 0;
        const propertyType = home.propertyType?.value || home.propertyType;
        const hoa = home.hoa?.value || home.hoa || 0;

        // CRITICAL: Filter by state - Redfin API sometimes returns wrong states
        const homeState = (home.state || '').toUpperCase();
        if (homeState && homeState !== stateUpper) {
          L.debug(`Filtering out property from wrong state: ${homeState} (expected ${stateUpper})`);
          return false;
        }

        if (price < MIN_PRICE || price > MAX_PRICE) return false;
        if (beds < MIN_BEDS) return false;
        if (sqft < MIN_SQFT) return false;
        if (propertyType && ![1, 6, 'Single Family', 'House'].includes(propertyType)) return false;

        const hoaValue = typeof hoa === 'object' ? 0 : (hoa || 0);
        if (hoaValue > 0) return false;

        // Exclude 55+ communities
        const listingTags = home.listingTags || [];
        const remarks = (home.listingRemarks || '').toLowerCase();
        const keyFacts = (home.keyFacts || []).map(kf => (kf.description || '').toLowerCase());
        const seniorKeywords = ['55+', '55 +', 'senior', 'age restricted', 'age-restricted', 'adult community', 'retirement', 'over 55', 'active adult'];

        if (listingTags.some(tag => seniorKeywords.some(kw => tag.toLowerCase().includes(kw)))) return false;
        if (seniorKeywords.some(kw => remarks.includes(kw))) return false;
        if (keyFacts.some(fact => seniorKeywords.some(kw => fact.includes(kw)))) return false;

        const listingType = home.listingType || 1;
        if (![1, 2, 3].includes(listingType)) return false;

        return true;
      };

      // Build list of cities to fetch from
      // If user specified a city, start with that; otherwise use state's city list
      let citiesToFetch = [];
      if (userCity) {
        // User specified a city - use it first, then add other cities from the state as fallback
        citiesToFetch = [cityToUse];
        const stateCities = STATE_CITIES_LIST[stateUpper] || [];
        for (const c of stateCities) {
          if (c.name.toLowerCase() !== userCity.toLowerCase()) {
            citiesToFetch.push(c);
          }
        }
      } else {
        // No specific city - use all cities in the state
        citiesToFetch = STATE_CITIES_LIST[stateUpper] || [cityToUse];
      }

      // Collect properties from multiple cities until we reach the limit
      const allFilteredHomes = [];
      const citiesFetched = [];
      const seenAddresses = new Set(); // Avoid duplicates

      for (const currentCity of citiesToFetch) {
        if (allFilteredHomes.length >= limitNum) break;

        const cityId = currentCity.id;
        const numHomesToFetch = Math.min(2000, Math.max(500, limitNum * 10));
        const url = `https://www.redfin.com/stingray/api/gis?al=1&market=${market}&region_id=${cityId}&region_type=6&num_homes=${numHomesToFetch}&status=9&ord=${sortOrder}&v=8`;

        L.info(`Fetching from ${currentCity.name} (need ${limitNum - allFilteredHomes.length} more, have ${allFilteredHomes.length})`);

        try {
          const response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': `https://www.redfin.com/city/${cityId}/${stateUpper}/${currentCity.name}`
            },
            timeout: 15000
          });

          let data = response.data;
          if (typeof data === 'string') {
            data = data.replace(/^\{\}&&/, '');
            data = JSON.parse(data);
          }

          const homes = data.payload?.homes || [];
          L.info(`${currentCity.name}: API returned ${homes.length} homes`);

          // Filter and dedupe
          for (const home of homes) {
            if (allFilteredHomes.length >= limitNum) break;
            if (!filterHome(home)) continue;

            const addr = (home.streetLine?.value || home.streetLine || '').toLowerCase();
            if (seenAddresses.has(addr)) continue;
            seenAddresses.add(addr);

            allFilteredHomes.push(home);
          }

          citiesFetched.push(currentCity.name);
          L.info(`${currentCity.name}: After filtering, total collected: ${allFilteredHomes.length}`);

        } catch (cityErr) {
          L.warn(`Failed to fetch from ${currentCity.name}: ${cityErr.message}`);
        }
      }

      L.info(`Multi-city fetch complete: ${allFilteredHomes.length} homes from ${citiesFetched.length} cities`);

      if (allFilteredHomes.length > 0) {
        // Transform to our format
        const properties = allFilteredHomes.slice(0, limitNum).map((home, i) => {
          const address = home.streetLine?.value || home.streetLine || '';
          const cityName = home.city || '';
          const homeState = home.state || stateUpper;
          const zip = home.zip || home.postalCode?.value || '';
          const price = home.price?.value || home.price || null;

          // Extract agent info from Redfin API data
          // Note: API only provides agent name, not phone/email/brokerage
          const agentInfo = home.listingAgent || {};

          return {
            fullAddress: [address, cityName, homeState, zip].filter(Boolean).join(', '),
            vendor: 'redfin',
            extractedAt: new Date().toISOString(),
            sourceIndex: i,
            url: home.url ? `https://www.redfin.com${home.url}` : null,
            state: homeState,
            city: cityName,
            price: price,
            priceText: price ? `$${price.toLocaleString()}` : null,
            beds: home.beds || null,
            bedsText: home.beds ? `${home.beds} bed${home.beds !== 1 ? 's' : ''}` : null,
            baths: home.baths || null,
            bathsText: home.baths ? `${home.baths} bath${home.baths !== 1 ? 's' : ''}` : null,
            sqft: home.sqFt?.value || null,
            sqftText: home.sqFt?.value ? `${home.sqFt.value.toLocaleString()} sqft` : null,
            propertyType: home.propertyType?.value || home.propertyType || 'Single Family',
            listingId: home.listingId || null,
            yearBuilt: home.yearBuilt?.value || null,
            daysOnMarket: home.dom?.value || null,
            latitude: home.latLong?.value?.latitude || null,
            longitude: home.latLong?.value?.longitude || null,
            status: 'active',
            // Listing type: 1=Agent, 2=Owner (FSBO), 3=Foreclosure
            listingType: home.listingType || 1,
            listingTypeText: home.listingType === 2 ? 'For Sale by Owner' :
                            home.listingType === 3 ? 'Foreclosure' : 'Agent Listed',
            // Agent details from Redfin API (only name available)
            agentName: agentInfo.name || null,
            redfinAgentId: agentInfo.redfinAgentId || null,
            // These require deep scraping - null by default, can be enriched later
            agentPhone: null,
            agentEmail: null,
            brokerage: null,
            mlsId: home.mlsId?.value || home.mlsNumber || null,
            agentEnriched: false // Flag to track if deep scraping was done
          };
        });

        L.info(`Successfully fetched ${properties.length} real properties from Redfin API (page ${pageNum}, sort=${sortOrder})`);

        // Enrich properties with agent details (name, phone, brokerage) if enabled
        let finalProperties = properties;
        let agentEnrichmentStats = null;

        if (shouldEnrichAgent && properties.length > 0) {
          L.info(`Starting agent enrichment for ${properties.length} properties...`);
          finalProperties = await enrichPropertiesWithAgentDetails(properties, 3);

          // Calculate enrichment stats
          const enrichedCount = finalProperties.filter(p => p.agentEnriched).length;
          const withPhoneCount = finalProperties.filter(p => p.agentPhone).length;
          agentEnrichmentStats = {
            total: properties.length,
            enriched: enrichedCount,
            withPhone: withPhoneCount,
            withBrokerage: finalProperties.filter(p => p.brokerage).length
          };
          L.info(`Agent enrichment complete: ${withPhoneCount}/${properties.length} have phone numbers`);
        }

        // Determine if there are more results
        const hasMore = allFilteredHomes.length >= limitNum;

        return res.json({
          ok: true,
          source: 'redfin.com (live API - multi-city)',
          scrapedAt: new Date().toISOString(),
          state: stateInfo.name,
          stateCode: stateInfo.code,
          citiesFetched: citiesFetched,
          filters: REDFIN_FILTERS,
          count: finalProperties.length,
          addresses: finalProperties,
          agentEnrichment: agentEnrichmentStats,
          pagination: {
            currentPage: pageNum,
            limit: limitNum,
            hasMore: hasMore,
            nextPage: hasMore ? pageNum + 1 : null
          },
          message: `Real active listings from ${citiesFetched.join(', ')}, ${stateInfo.name} (${finalProperties.length} properties${agentEnrichmentStats ? `, ${agentEnrichmentStats.withPhone} with agent phone` : ''})`
        });
      }

      L.warn('Redfin API returned no results from any city');
      return res.status(404).json({
        ok: false,
        error: 'No properties found',
        message: `Redfin returned no results for ${city || stateInfo.name}. The API may be blocking server requests or there are no listings matching the filters.`,
        addresses: []
      });
    } catch (apiErr) {
      L.error(`Redfin API failed: ${apiErr.message}`);
      return res.status(500).json({
        ok: false,
        error: apiErr.message || 'Redfin API failed',
        message: 'Failed to fetch data from Redfin. The API may be blocking server requests.',
        addresses: []
      });
    }

  } catch (error) {
    L.error('Live Redfin scrape failed', { error: error.message });

    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to scrape Redfin',
      message: 'Failed to generate mock data. Please try again.',
      addresses: []
    });
  }
});

/**
 * GET /api/live-scrape/test
 *
 * Test endpoint that returns mock data to verify the API works
 */
router.get('/test', requireAuth, async (req, res) => {
  const { limit = 10 } = req.query;

  // Mock addresses for testing
  const mockAddresses = [
    '123 Main St, San Francisco, CA 94102',
    '456 Oak Ave, Los Angeles, CA 90001',
    '789 Pine Dr, San Diego, CA 92101',
    '321 Elm Blvd, Sacramento, CA 95814',
    '654 Maple Ct, San Jose, CA 95110',
    '987 Cedar Ln, Fresno, CA 93650',
    '147 Birch Way, Oakland, CA 94601',
    '258 Willow St, Long Beach, CA 90802',
    '369 Spruce Rd, Bakersfield, CA 93301',
    '741 Redwood Pl, Anaheim, CA 92801'
  ].slice(0, parseInt(limit)).map((addr, i) => ({
    fullAddress: addr,
    vendor: 'privy',
    extractedAt: new Date().toISOString(),
    sourceIndex: i,
    test: true
  }));

  res.json({
    ok: true,
    source: 'test-mode',
    scrapedAt: new Date().toISOString(),
    count: mockAddresses.length,
    addresses: mockAddresses,
    message: 'Test data - Live scraping endpoint is working'
  });
});

export default router;
