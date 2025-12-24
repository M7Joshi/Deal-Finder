# Redfin Live Address Scraper - Final Version ✅

## What I Built For You

A **clean, simple Redfin address scraper** that fetches data **directly from Redfin.com** with a state selector. No database, no CSV files, no Privy - just pure Redfin scraping!

---

## 🎯 Features

### 1. **State Selection Dropdown**
   - Select from any of the 50 US states
   - Dropdown in the header (similar to Deals page)
   - Easy to switch between states

### 2. **Live Scraping from Redfin Only**
   - Fetches addresses **directly from Redfin.com official website**
   - **NO database storage**
   - **NO CSV files**
   - **NO Privy or other vendors**
   - Just pure, real-time Redfin data

### 3. **Clean, Simple UI**
   - One page - "Redfin Address Scraper"
   - State selector dropdown
   - "Scrape {STATE}" button
   - Real-time address validation
   - Google Maps integration

---

## 📁 Files Modified

### Backend:
1. **`backend/routes/live-scrape.js`**
   - `/api/live-scrape/redfin` endpoint
   - Accepts `state` parameter (required)
   - Returns live addresses from Redfin

### Frontend:
1. **`site/src/api.tsx`**
   - `liveScrapeRedfin()` function

2. **`site/src/screens/AddressValidation.tsx`** (COMPLETELY REWRITTEN)
   - Simplified to show only Redfin scraping
   - State selector dropdown in header
   - Removed database and Privy modes
   - Clean, focused interface

---

## 🚀 How to Use

### Step 1: Start Your Servers

#### Backend:
```bash
cd backend
npm start
```

#### Frontend:
```bash
cd site
npm start
```

### Step 2: Access the Page

1. Open your browser: `http://localhost:3000`
2. Log in with:
   - Email: `mcox@mioym.com`
   - Password: `Mioym@2900`

3. Navigate to **"Address Validation"** page

### Step 3: Scrape Addresses

1. Select a state from the dropdown (e.g., **CA**, **NY**, **TX**, **FL**)
2. Click **"Scrape {STATE}"** button
3. Wait for addresses to appear (fetched directly from Redfin.com)
4. View addresses in the table with validation status

---

## 🎨 User Interface

### Header:
- **Title:** "Redfin Address Scraper"
- **State Selector:** Dropdown with all 50 states
- **Button:** "Scrape {STATE}" (red button)

### Alert Message:
> 🔴 **LIVE MODE:** Fetching addresses directly from **Redfin.com** official website.
> No database, no CSV - just real-time data from **{STATE}** state.

### Stats Cards:
1. **Total Addresses** - Gray card
2. **Valid Addresses** - Green card
3. **Invalid Addresses** - Red card

### Address Table:
- Status (✓ or ✗ icon)
- Full Address with "redfin" badge
- City
- State
- ZIP
- Price
- Google Maps link button

---

## 📊 API Endpoint

### Live Redfin Scraping
```
GET /api/live-scrape/redfin?state=CA&limit=50
```

**Query Parameters:**
- `state` (required): 2-letter state code (e.g., CA, NY, TX)
- `limit` (optional): Max addresses to return (default: 20, set to 50 in UI)

**Response:**
```json
{
  "ok": true,
  "source": "redfin.com",
  "scrapedAt": "2025-12-03T...",
  "state": "California",
  "stateCode": "CA",
  "cityUrl": "https://www.redfin.com/city/...",
  "count": 50,
  "addresses": [
    {
      "fullAddress": "123 Main St, Los Angeles, CA 90001",
      "vendor": "redfin",
      "extractedAt": "2025-12-03T...",
      "sourceIndex": 0,
      "url": "https://www.redfin.com/...",
      "price": "$500,000",
      "beds": "3 beds",
      "baths": "2 baths",
      "sqft": "1,500 sqft"
    }
  ],
  "message": "Live data - not saved to database"
}
```

---

## 🔍 How It Works

1. **User selects a state** from the dropdown (e.g., "CA")

2. **User clicks "Scrape CA"**

3. **Backend processing:**
   - Converts state code to Redfin format (CA → California)
   - Fetches Redfin state page: `https://www.redfin.com/state/California`
   - Extracts city URLs from the page
   - Scrapes listings from the first city
   - Parses addresses, prices, beds, baths, sqft

4. **Frontend display:**
   - Shows addresses in table
   - Validates address format
   - Shows stats (total, valid, invalid)
   - Provides Google Maps links

---

## ✅ Supported States

All 50 US states are supported:

**A-F:** AL, AK, AZ, AR, CA, CO, CT, DE, FL
**G-M:** GA, HI, ID, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, MT
**N-R:** NE, NV, NH, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI
**S-W:** SC, SD, TN, TX, UT, VT, VA, WA, WV, WI, WY

---

## 🔍 Troubleshooting

### If you see no addresses:

1. **Check backend is running:**
   ```bash
   curl http://localhost:3015/healthz
   ```

2. **Check Redfin endpoint:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        "http://localhost:3015/api/live-scrape/redfin?state=CA"
   ```

3. **Try a different state** - Some states may have fewer listings

### If Redfin scraping fails:

1. **Check Crawlbase token** in `backend/.env`:
   - `CRAWLBASE_TOKEN=your_token_here`

2. **Check internet connection**

3. **Check backend logs** for error messages

---

## 📝 Summary

You now have a **clean, simple Redfin scraper** that:

✅ Fetches addresses directly from Redfin.com
✅ State selector dropdown (50 states)
✅ Real-time scraping (no database)
✅ NO CSV files
✅ NO Privy or other vendors
✅ Just Redfin addresses
✅ Address validation
✅ Google Maps integration

---

## 🎯 What Changed from Previous Version

### Removed:
- ❌ Database mode button
- ❌ Privy live mode button
- ❌ Multiple vendor support
- ❌ State filter for database mode
- ❌ Vendor filter dropdown
- ❌ Pagination (for Privy)

### Simplified:
- ✅ Only Redfin scraping
- ✅ State selector in header (not in alert)
- ✅ Clean, focused UI
- ✅ One-click scraping per state

---

## 💡 Example Usage

### Scrape California Addresses:
1. Open Address Validation page
2. Select "CA" from state dropdown (already selected by default)
3. Click "Scrape CA"
4. See up to 50 addresses from California

### Scrape Texas Addresses:
1. Select "TX" from state dropdown
2. Click "Scrape TX"
3. See up to 50 addresses from Texas

### Scrape New York Addresses:
1. Select "NY" from state dropdown
2. Click "Scrape NY"
3. See up to 50 addresses from New York

---

## 🎨 UI Highlights

- **Red theme** for Redfin branding
- **Clean, modern design** with Material-UI
- **State selector** prominently in header
- **Real-time stats** with colored cards
- **Address validation** with icons
- **Google Maps** integration for verification

---

**Created:** December 3, 2025
**Status:** ✅ Ready to Use
**Focus:** Redfin Only - Clean & Simple

Enjoy your simplified Redfin address scraper! 🎉
