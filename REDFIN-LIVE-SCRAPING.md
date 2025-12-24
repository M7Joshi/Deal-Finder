# Redfin Live Scraping - Setup Complete ✅

## What Was Built

I've created a **real-time Redfin address scraping system** that fetches data **directly from Redfin.com** without touching any database or CSV files. This is exactly what you requested!

---

## 🎯 Features

### 1. **State Selection**
   - Select from any US state (AL, AK, AZ, AR, CA, CO, CT, etc.)
   - Dropdown selector in the UI
   - Fetches addresses from the selected state only

### 2. **Live Scraping Mode**
   - Fetches addresses **directly from Redfin.com official website**
   - **NO database storage**
   - **NO CSV files**
   - Just pure, real-time data

### 3. **Address Validation Page Updated**
   - Three buttons: **"From Database"**, **"🔴 LIVE from Redfin"**, and **"🔴 LIVE from Privy.pro"**
   - Click "LIVE from Redfin" mode to see real-time addresses from Redfin
   - Select state from dropdown
   - Click "Scrape Now" to fetch fresh data

---

## 📁 Files Created/Modified

### Backend:
1. **`backend/routes/live-scrape.js`** (MODIFIED)
   - Added `/api/live-scrape/redfin` endpoint
   - Accepts `state` parameter (required)
   - Fetches city URLs from Redfin state page
   - Scrapes listings from first city
   - Returns addresses WITHOUT saving to database

### Frontend:
1. **`site/src/api.tsx`** (MODIFIED)
   - Added `liveScrapeRedfin()` function
   - Accepts state parameter

2. **`site/src/screens/AddressValidation.tsx`** (MODIFIED)
   - Added "LIVE from Redfin" mode button (red)
   - Added state selector dropdown in alert message
   - Added live scraping logic for Redfin
   - Shows addresses directly from Redfin.com

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

### Step 3: Use Live Redfin Scraping

1. Click the **🔴 LIVE from Redfin** button (red)
2. Select a state from the dropdown (e.g., CA, NY, TX, FL)
3. Click **"Scrape Now"**
4. Wait for addresses to appear (fetched directly from Redfin.com)

---

## 🎨 User Interface

The Address Validation page now has:

1. **Mode Toggle Buttons:**
   - Gray button: "From Database" (old way)
   - Red button: "🔴 LIVE from Redfin" (new way - Redfin)
   - Green button: "🔴 LIVE from Privy.pro" (new way - Privy)

2. **State Selector (Redfin Mode Only):**
   When in LIVE Redfin mode, shows:
   > 🔴 **LIVE MODE:** Fetching addresses directly from Redfin.com official website.
   > No database, no CSV - just real-time data.
   > [State Selector Dropdown]

3. **Scrape Button:**
   - In database mode: "Refresh"
   - In LIVE mode: "Scrape Now"

---

## 📊 API Endpoints

### Live Redfin Scraping
```
GET /api/live-scrape/redfin?state=CA&limit=20
```

**Query Parameters:**
- `state` (required): 2-letter state code (e.g., CA, NY, TX)
- `limit` (optional): Max addresses to return (default: 20)

**Response:**
```json
{
  "ok": true,
  "source": "redfin.com",
  "scrapedAt": "2025-12-03T...",
  "state": "California",
  "stateCode": "CA",
  "cityUrl": "https://www.redfin.com/city/...",
  "count": 20,
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

1. **State Selection:**
   - User selects a state (e.g., "CA" for California)

2. **Backend Processing:**
   - Converts state code to Redfin format (CA → California)
   - Fetches Redfin state page: `https://www.redfin.com/state/California`
   - Extracts city URLs from the page
   - Scrapes listings from the first city
   - Parses addresses, prices, beds, baths, sqft

3. **Frontend Display:**
   - Receives addresses in real-time
   - Displays in table format
   - Shows validation status (valid/invalid address format)
   - Links to Google Maps for verification

---

## ✅ Supported States

All 50 US states are supported:
- AL, AK, AZ, AR, CA, CO, CT, DE, FL, GA
- HI, ID, IL, IN, IA, KS, KY, LA, ME, MD
- MA, MI, MN, MS, MO, MT, NE, NV, NH, NJ
- NM, NY, NC, ND, OH, OK, OR, PA, RI, SC
- SD, TN, TX, UT, VT, VA, WA, WV, WI, WY

---

## 🔍 Troubleshooting

### If you see no addresses:

1. **Check authentication:**
   - Make sure you're logged in
   - Check browser console for errors

2. **Check backend is running:**
   ```bash
   curl http://localhost:3015/healthz
   ```

3. **Check Redfin endpoint:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        "http://localhost:3015/api/live-scrape/redfin?state=CA"
   ```

### If Redfin scraping fails:

1. **Check Crawlbase token** in `backend/.env`:
   - `CRAWLBASE_TOKEN=your_token_here`

2. **Check internet connection**

3. **Try a different state** - Some states may have fewer listings

---

## 📝 Summary

You now have a **complete live Redfin scraping system** that:

✅ Fetches addresses directly from Redfin.com
✅ Allows state selection via dropdown
✅ Shows them in real-time on Address Validation page
✅ NO database storage
✅ NO CSV files
✅ Just live data for verification

**Current Features:**
- ✅ State selector dropdown
- ✅ Real-time scraping from Redfin.com
- ✅ No database persistence
- ✅ Address validation
- ✅ Google Maps integration

---

## 🎯 What Changed

### Before:
- Only Privy.pro live scraping
- No state selection for Redfin

### After:
- **Added Redfin live scraping**
- **State selector dropdown** (50 states)
- **Three modes:** Database, Live Redfin, Live Privy
- **Real-time data** from Redfin official site

---

**Created:** December 3, 2025
**Status:** ✅ Ready to Use

---

## 💡 Example Usage

1. Open Address Validation page
2. Click "🔴 LIVE from Redfin" (red button)
3. Select "CA" from state dropdown
4. Click "Scrape Now"
5. See addresses from California appear instantly!

Try different states:
- **CA** - California (lots of listings)
- **TX** - Texas (major cities)
- **FL** - Florida (beach properties)
- **NY** - New York (urban areas)

Enjoy your live Redfin scraping! 🎉
