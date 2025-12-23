// Test direct access to Redfin (without proxy) to see if we can get any data
import axios from 'axios';

async function testDirectRedfin() {
  try {
    console.log('Testing DIRECT access to Redfin (no proxy)...\n');

    const url = 'https://www.redfin.com/city/30742/NJ/Newark';
    console.log(`Fetching: ${url}\n`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    });

    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content length:', response.data.length, 'characters');

    // Check if we got HTML or a block page
    const html = response.data;
    if (html.includes('<!DOCTYPE html>') || html.includes('<html')) {
      console.log('✅ Got HTML response');

      // Check for property links
      const homeLinksMatch = html.match(/\/home\/\d+/g);
      if (homeLinksMatch) {
        console.log(`✅ Found ${homeLinksMatch.length} property links in HTML`);
        console.log('Sample links:', homeLinksMatch.slice(0, 3));
      } else {
        console.log('❌ No property links found in HTML');
      }

      // Check for common blocking indicators
      if (html.includes('captcha') || html.includes('CAPTCHA')) {
        console.log('⚠️  WARNING: Page contains CAPTCHA');
      }
      if (html.includes('Access Denied') || html.includes('403')) {
        console.log('⚠️  WARNING: Access denied message detected');
      }
      if (html.includes('bot') || html.includes('robot')) {
        console.log('⚠️  WARNING: Bot detection may be active');
      }
    } else {
      console.log('❌ Did not get HTML response');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
    }
  }
}

testDirectRedfin();
