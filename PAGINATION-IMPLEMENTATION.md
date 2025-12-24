# Live Address Pagination - Implementation Guide

## Overview

The address page now supports **pagination with live scraping** from Privy.pro, showing 20 addresses per page without saving to the database.

---

## 🎯 What You Asked For

1. ✅ **See 20 addresses at a time**
2. ✅ **Click "Next" to see more data**
3. ✅ **Data comes directly from website (live scraping)**
4. ✅ **No data saved anywhere**

---

## 🚀 How It Works

### Backend API (`/api/live-scrape/privy`)

**Endpoint:** `GET /api/live-scrape/privy`

**Query Parameters:**
- `limit` - Number of addresses per page (default: 20)
- `page` - Page number (1-based, default: 1)
- `offset` - Alternative to page (0-based offset)

**Example Requests:**
```bash
# Get first page (addresses 1-20)
GET /api/live-scrape/privy?limit=20&page=1

# Get second page (addresses 21-40)
GET /api/live-scrape/privy?limit=20&page=2

# Get third page (addresses 41-60)
GET /api/live-scrape/privy?limit=20&page=3
```

**Response Format:**
```json
{
  "ok": true,
  "source": "privy.pro",
  "scrapedAt": "2025-12-03T22:00:00.000Z",

  "pagination": {
    "currentPage": 1,
    "limit": 20,
    "offset": 0,
    "total": 150,
    "totalPages": 8,
    "hasMore": true,
    "hasPrevious": false,
    "nextPage": 2,
    "previousPage": null
  },

  "count": 20,
  "addresses": [
    {
      "fullAddress": "123 Main St, San Francisco, CA 94102",
      "vendor": "privy",
      "extractedAt": "2025-12-03T22:00:00.000Z",
      "sourceIndex": 0
    }
    // ... 19 more addresses
  ],
  "message": "Live data - not saved to database (pagination enabled)"
}
```

---

## 🎨 Frontend UI

### Default Mode
- **Page opens in LIVE MODE** by default
- Shows green alert: "🔴 LIVE MODE: Fetching addresses directly from Privy.pro"
- Displays total scraped addresses

### Pagination Controls
Located at the bottom of the address table:

```
┌─────────────────────────────────────────────────────┐
│  [← Previous]   Page 1 of 8 (20 addresses)   [Next →] │
└─────────────────────────────────────────────────────┘
```

**Buttons:**
- **Previous** - Go to previous page (disabled on page 1)
- **Next** - Go to next page (disabled on last page)
- Shows current page, total pages, and addresses on current page

---

## 🔧 Technical Implementation

### Files Modified

1. **Backend:** `backend/routes/live-scrape.js`
   - Added pagination logic to `/api/live-scrape/privy` endpoint
   - Calculates `offset`, `limit`, `totalPages`, `hasMore`, `hasPrevious`
   - Returns paginated slice of scraped addresses

2. **Frontend:** `site/src/screens/AddressValidation.tsx`
   - Added pagination state: `currentPage`, `totalPages`, `hasMore`, `hasPrevious`
   - Changed default mode from `database` to `live`
   - Added `handleNextPage()` and `handlePreviousPage()` functions
   - Added pagination controls UI
   - Updates page state on button click

### Data Flow

```
User clicks "Next"
    ↓
Frontend: setCurrentPage(currentPage + 1)
    ↓
useEffect triggers fetchProperties()
    ↓
API call: /api/live-scrape/privy?limit=20&page=2
    ↓
Backend: Scrapes Privy.pro website
    ↓
Backend: Returns addresses[20-39] (slice based on page)
    ↓
Frontend: Displays 20 new addresses
    ↓
Pagination controls update (Previous enabled, Next shows page 3)
```

---

## 📝 Important Notes

### No Data Persistence
- ✅ Addresses are **never saved** to MongoDB
- ✅ Each page load scrapes **fresh data** from Privy.pro
- ✅ Response includes `"message": "Live data - not saved to database"`

### Performance
- Each page change triggers a new scrape (takes 30-90 seconds)
- Loading spinner shown during scraping
- Cancel button available to abort long-running scrapes

### Chrome Timeout Fix
The previous "Timeout waiting for shared Chrome" error has been fixed:
- Timeout increased from 30s → 90s
- Configurable via `CHROME_LAUNCH_TIMEOUT_MS` env variable
- Stale lock file cleanup added

---

## 🧪 Testing

### Test Pagination Manually

1. **Open Address Page**
   - Navigate to `/address-validation` in your app
   - Should default to LIVE mode

2. **Verify First Page**
   - See green alert: "🔴 LIVE MODE"
   - See 20 addresses
   - Previous button disabled
   - Next button enabled

3. **Click Next**
   - Loading spinner appears
   - New set of 20 addresses loads
   - Previous button now enabled
   - Page counter updates: "Page 2 of X"

4. **Click Previous**
   - Returns to first page
   - Previous button disabled again

### Test API Directly

```bash
# Test first page
curl "http://localhost:3015/api/live-scrape/privy?limit=20&page=1" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test second page
curl "http://localhost:3015/api/live-scrape/privy?limit=20&page=2" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🎯 Usage Instructions for End Users

1. **Open Address Validation Page**
   - The page will automatically start in LIVE mode

2. **View Current Page**
   - See 20 addresses from Privy.pro
   - View address validation status (green checkmark = valid)
   - See vendor badges, city, state, ZIP

3. **Navigate Pages**
   - Click **"Next →"** to see the next 20 addresses
   - Click **"← Previous"** to go back
   - Page number updates automatically

4. **No Data Saved**
   - All addresses are fetched directly from website
   - Nothing is stored in your database
   - Fresh data on every page load

---

## 🔄 Switching Between Modes

### Live Mode (Default)
- Shows data directly from Privy.pro website
- Pagination enabled (20 per page)
- No database storage
- Real-time scraping

### Database Mode (Optional)
- Shows data from MongoDB
- No pagination (shows first 5000)
- Uses saved data
- Faster loading

**To switch:** Click the "From Database" / "🔴 LIVE from Privy.pro" buttons at the top.

---

## 🐛 Troubleshooting

### Issue: "Timeout waiting for shared Chrome to come up"

**Solution:**
1. Increase timeout in `backend/.env`:
   ```
   CHROME_LAUNCH_TIMEOUT_MS=120000
   ```
2. Restart backend server
3. Try again

### Issue: No addresses showing

**Solution:**
1. Check backend logs: `tail -f backend/backend.log`
2. Verify server is running on port 3015
3. Check authentication token is valid
4. Try clicking "Scrape Now" button

### Issue: Pagination not working

**Solution:**
1. Clear browser cache
2. Refresh page (Ctrl+R / Cmd+R)
3. Check browser console for errors
4. Verify backend is running latest code

---

## 📊 Summary

| Feature | Status | Details |
|---------|--------|---------|
| Live Scraping | ✅ | Fetches from Privy.pro directly |
| Pagination | ✅ | 20 addresses per page |
| No Storage | ✅ | Never saves to database |
| Next/Previous | ✅ | Navigation buttons working |
| Page Counter | ✅ | Shows "Page X of Y" |
| Total Count | ✅ | Displays total scraped addresses |
| Loading State | ✅ | Shows spinner during scrape |
| Error Handling | ✅ | Displays errors with alerts |
| Cancel Scraping | ✅ | "Stop Scraping" button available |

---

## 🔗 Related Files

- **Backend API:** `backend/routes/live-scrape.js` (lines 12-171)
- **Frontend UI:** `site/src/screens/AddressValidation.tsx` (lines 103-615)
- **API Client:** `site/src/api.tsx` (lines 202-209)
- **Chrome Fix:** `backend/utils/browser.js` (lines 156-162)
- **Previous Fix:** `backend/routes/properties.js` (lines 111-170)

---

## ✅ Completed Tasks

1. ✅ Fixed MongoDB sort memory limit error
2. ✅ Fixed Chrome timeout issue
3. ✅ Added pagination to live scraping API
4. ✅ Updated frontend with pagination controls
5. ✅ Changed default mode to LIVE
6. ✅ Added "Next" and "Previous" buttons
7. ✅ Display 20 addresses per page
8. ✅ Data never saved to database
9. ✅ Fresh scraping on each page

---

**Ready to use!** 🎉

Open your address validation page and start browsing addresses 20 at a time, directly from Privy.pro!
