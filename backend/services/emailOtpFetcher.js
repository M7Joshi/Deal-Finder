/**
 * Email OTP Fetcher Service (IMAP-based)
 * Automatically fetches OTP codes from Gmail using IMAP
 * Requires Gmail App Password (not regular password)
 *
 * Setup:
 * 1. Enable 2-Step Verification on your Google account
 * 2. Generate App Password at https://myaccount.google.com/apppasswords
 * 3. Set GMAIL_IMAP_APP_PASSWORD in .env
 */

import { ImapFlow } from 'imapflow';
import fs from 'fs';
import path from 'path';
import { log as rootLog } from '../utils/logger.js';

const log = rootLog.child('emailOtpFetcher');

// Gmail credentials from environment
const GMAIL_USER = process.env.GMAIL_IMAP_USER || process.env.PRIVY_EMAIL;
const GMAIL_APP_PASSWORD = process.env.GMAIL_IMAP_APP_PASSWORD;

// Persist lastSeenUid to survive restarts
const LAST_UID_FILE = process.env.OTP_LAST_UID_FILE ||
  (process.env.NODE_ENV === 'production' ? '/var/data/otp-last-uid.json' : 'var/otp-last-uid.json');

// Track last seen email UID to avoid reusing old OTPs
let lastSeenUid = 0;

// Load lastSeenUid from disk on startup
function loadLastSeenUid() {
  try {
    if (fs.existsSync(LAST_UID_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAST_UID_FILE, 'utf8'));
      if (data.lastSeenUid && typeof data.lastSeenUid === 'number') {
        lastSeenUid = data.lastSeenUid;
        log.info('Loaded lastSeenUid from disk', { lastSeenUid, savedAt: data.savedAt });
      }
    }
  } catch (e) {
    log.warn('Failed to load lastSeenUid from disk', { error: e.message });
  }
}

// Save lastSeenUid to disk
function saveLastSeenUid() {
  try {
    const dir = path.dirname(LAST_UID_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LAST_UID_FILE, JSON.stringify({
      lastSeenUid,
      savedAt: new Date().toISOString()
    }), 'utf8');
    log.debug('Saved lastSeenUid to disk', { lastSeenUid });
  } catch (e) {
    log.warn('Failed to save lastSeenUid to disk', { error: e.message });
  }
}

// Load on module init
loadLastSeenUid();

// Regex patterns to extract 6-digit OTP codes
const OTP_PATTERNS = [
  /code[:\s]+(\d{6})/gi,                   // "code: 123456" or "code 123456"
  /verification[:\s]+(\d{6})/gi,           // "verification: 123456"
  /one[- ]time[:\s]+(\d{6})/gi,            // "one-time: 123456"
  /\b(\d{6})\b/g,                          // Any 6-digit number (fallback)
];

/**
 * Decode email content - handles base64 encoded parts
 * @param {string} rawEmail - Raw email source
 * @returns {string} Decoded text content
 */
function decodeEmailContent(rawEmail) {
  if (!rawEmail) return '';

  let decodedText = '';

  // Try to find and decode base64 text/plain part
  const textPlainMatch = rawEmail.match(/Content-Type:\s*text\/plain[\s\S]*?\r\n\r\n([A-Za-z0-9+\/=\r\n]+?)(?:\r\n--|\r\n\r\n)/);
  if (textPlainMatch) {
    try {
      const base64Content = textPlainMatch[1].replace(/[\r\n]/g, '');
      decodedText += Buffer.from(base64Content, 'base64').toString('utf-8');
    } catch (e) {
      // Not base64, use as-is
      decodedText += textPlainMatch[1];
    }
  }

  // Also try HTML part if no text/plain
  if (!decodedText) {
    const htmlMatch = rawEmail.match(/Content-Type:\s*text\/html[\s\S]*?\r\n\r\n([A-Za-z0-9+\/=\r\n]+?)(?:\r\n--|\r\n\r\n)/);
    if (htmlMatch) {
      try {
        const base64Content = htmlMatch[1].replace(/[\r\n]/g, '');
        const html = Buffer.from(base64Content, 'base64').toString('utf-8');
        // Strip HTML tags
        decodedText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      } catch (e) {
        // Ignore
      }
    }
  }

  // Fallback: use raw content (for non-multipart emails)
  if (!decodedText) {
    decodedText = rawEmail;
  }

  return decodedText;
}

/**
 * Extract OTP code from text - prioritize codes near keywords
 * @param {string} text - Text to search
 * @returns {string|null} 6-digit OTP or null
 */
function extractOtpCode(text) {
  if (!text) return null;

  // First decode if it's raw email
  const decodedText = decodeEmailContent(text);

  // First, try patterns with context (more reliable)
  for (const pattern of OTP_PATTERNS.slice(0, -1)) {
    pattern.lastIndex = 0; // Reset regex state
    const match = pattern.exec(decodedText);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Fallback: find any 6-digit sequence that looks like an OTP
  // Avoid numbers that are clearly not OTPs (years, prices, etc.)
  const allSixDigit = decodedText.match(/\b(\d{6})\b/g) || [];
  for (const num of allSixDigit) {
    // Skip if it looks like a year (19xx, 20xx) or price
    if (/^(19|20)\d{4}$/.test(num)) continue;
    // Skip common non-OTP patterns like 000000 (often in email headers)
    if (/^0{6}$/.test(num)) continue;
    return num;
  }

  return null;
}

/**
 * Fetch OTP from Gmail using IMAP
 * Connects to Gmail, waits for NEW Privy email, extracts OTP code
 *
 * @param {Object} options
 * @param {number} options.timeoutMs - Max time to wait (default: 90000)
 * @param {number} options.pollIntervalMs - Poll interval (default: 3000)
 * @returns {Promise<string>} The 6-digit OTP code
 */
export async function fetchOtpFromEmail({
  timeoutMs = Number(process.env.OTP_EMAIL_TIMEOUT_MS || 90000),
  pollIntervalMs = 3000,
} = {}) {
  const enabled = process.env.OTP_AUTO_FETCH_ENABLED !== 'false';
  if (!enabled) {
    throw new Error('Auto OTP fetch is disabled');
  }

  if (!GMAIL_USER) {
    throw new Error('GMAIL_IMAP_USER not configured in .env');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_IMAP_APP_PASSWORD not configured in .env. Generate one at https://myaccount.google.com/apppasswords');
  }

  log.info('Starting IMAP-based OTP fetch from Gmail', { user: GMAIL_USER, timeoutMs });

  const startTime = Date.now();
  let client = null;
  let initialMaxUid = 0;

  try {
    // Create IMAP client
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
      logger: false, // Disable verbose IMAP logging
    });

    // Connect to Gmail
    log.info('Connecting to Gmail IMAP...');
    await client.connect();
    log.info('Connected to Gmail IMAP successfully');

    // First, get the current max UID so we only look at NEW emails
    await client.mailboxOpen('INBOX');

    // Get UIDs of existing Privy emails
    const existingEmails = await client.search({
      or: [
        { from: 'privy.pro' },
        { from: 'noreply@privy.pro' },
        { from: 'notifications@email.privy.pro' },
        { from: 'email.privy.pro' },
        { from: 'privy' },
      ],
    });

    // Check if the most recent Privy email was sent in the last 2 minutes
    // If so, it might be the OTP we're looking for (arrived before we started polling)
    if (existingEmails.length > 0) {
      const latestUid = Math.max(...existingEmails);

      // Check the date of the latest email
      try {
        const latestMsg = await client.fetchOne(latestUid, { envelope: true });
        const emailDate = latestMsg?.envelope?.date;

        if (emailDate) {
          const emailTime = new Date(emailDate).getTime();
          const twoMinutesAgo = Date.now() - 2 * 60 * 1000;

          if (emailTime > twoMinutesAgo) {
            // This email is very recent - might be the OTP we need
            // Don't ignore it, set initialMaxUid to one less
            initialMaxUid = latestUid - 1;
            log.info('Found recent Privy email, will check it', { latestUid, emailDate });
          } else {
            // Email is older, ignore it
            initialMaxUid = latestUid;
            log.info('Ignoring existing emails (not recent)', { initialMaxUid, existingCount: existingEmails.length });
          }
        } else {
          initialMaxUid = latestUid;
          log.info('Ignoring existing emails', { initialMaxUid, existingCount: existingEmails.length });
        }
      } catch (e) {
        // Fallback: ignore all existing
        initialMaxUid = Math.max(...existingEmails);
        log.info('Ignoring existing emails (fallback)', { initialMaxUid, existingCount: existingEmails.length });
      }
    }

    // Poll for NEW OTP emails
    let pollCount = 0;
    while (Date.now() - startTime < timeoutMs) {
      pollCount++;
      try {
        // Re-open inbox to get fresh state (IMAP caches)
        await client.mailboxOpen('INBOX');

        // Search for Privy emails
        const searchResults = await client.search({
          or: [
            { from: 'privy.pro' },
            { from: 'noreply@privy.pro' },
            { from: 'notifications@email.privy.pro' },
            { from: 'email.privy.pro' },
            { from: 'privy' },
            { subject: 'verification code' },
            { subject: 'security code' },
            { subject: 'login code' },
          ],
        });

        // Filter to only NEW emails (UID > initialMaxUid and > lastSeenUid)
        const newEmails = searchResults.filter(uid => uid > initialMaxUid && uid > lastSeenUid);

        log.debug('IMAP poll', {
          pollCount,
          totalFound: searchResults.length,
          newEmails: newEmails.length,
          initialMaxUid,
          lastSeenUid,
        });

        if (newEmails.length > 0) {
          // Get the newest email
          const latestUid = Math.max(...newEmails);

          // Fetch the email with envelope (has date) and body
          const message = await client.fetchOne(latestUid, {
            source: true,
            envelope: true,
          });

          if (message?.source) {
            const emailContent = message.source.toString();

            // Check if email is from Privy (additional validation)
            const isPrivyEmail = /privy/i.test(emailContent) ||
                                 /from:.*privy/i.test(emailContent);

            if (!isPrivyEmail) {
              log.debug('Email does not appear to be from Privy, skipping', { uid: latestUid });
              lastSeenUid = latestUid;
              saveLastSeenUid();
              continue;
            }

            // Extract OTP from email content
            const otpCode = extractOtpCode(emailContent);

            if (otpCode) {
              log.info('Successfully extracted OTP from NEW Gmail email via IMAP', {
                code: otpCode.slice(0, 2) + '****',
                elapsed: Date.now() - startTime,
                uid: latestUid,
              });

              // Update last seen UID to avoid reusing this OTP
              lastSeenUid = latestUid;
              saveLastSeenUid();

              // Mark email as read
              try {
                await client.messageFlagsAdd(latestUid, ['\\Seen']);
              } catch (e) {
                // Ignore flag errors
              }

              return otpCode;
            } else {
              log.warn('Found new Privy email but could not extract OTP', { uid: latestUid });
              lastSeenUid = latestUid;
              saveLastSeenUid();
            }
          }
        }

        log.debug('Waiting for new OTP email...', {
          elapsed: Date.now() - startTime,
          remaining: timeoutMs - (Date.now() - startTime),
          pollCount,
        });

      } catch (pollErr) {
        log.warn('Error during IMAP poll', { error: pollErr.message });
      }

      // Wait before next poll
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`OTP email fetch timed out after ${timeoutMs}ms - no new Privy email received`);

  } catch (err) {
    log.error('IMAP OTP fetch failed', { error: err.message });
    throw err;
  } finally {
    // Always close the IMAP connection
    if (client) {
      try {
        await client.logout();
        log.debug('IMAP connection closed');
      } catch (e) {
        // Ignore logout errors
      }
    }
  }
}

/**
 * Reset the last seen UID (useful for testing)
 */
export function resetLastSeenUid() {
  lastSeenUid = 0;
  log.info('Reset lastSeenUid to 0');
}

/**
 * Test IMAP connection (for debugging)
 */
export async function testImapConnection() {
  if (!GMAIL_USER) {
    return {
      ok: false,
      error: 'GMAIL_IMAP_USER not configured',
    };
  }

  if (!GMAIL_APP_PASSWORD) {
    return {
      ok: false,
      error: 'GMAIL_IMAP_APP_PASSWORD not configured. Generate one at https://myaccount.google.com/apppasswords',
    };
  }

  let client = null;

  try {
    log.info('Testing Gmail IMAP connection...');

    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
      logger: false,
    });

    await client.connect();

    // Try to open inbox
    const mailbox = await client.mailboxOpen('INBOX');

    // Count Privy emails
    const privyEmails = await client.search({
      or: [
        { from: 'privy.pro' },
        { from: 'noreply@privy.pro' },
      ],
    });

    const result = {
      ok: true,
      message: 'Gmail IMAP connection successful',
      mailbox: mailbox.name,
      totalMessages: mailbox.exists,
      privyEmails: privyEmails.length,
      lastSeenUid,
    };

    log.info('IMAP test successful', result);
    return result;

  } catch (err) {
    log.error('IMAP test failed', { error: err.message });
    return {
      ok: false,
      error: err.message,
    };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        // Ignore
      }
    }
  }
}

export default {
  fetchOtpFromEmail,
  testImapConnection,
  resetLastSeenUid,
};
