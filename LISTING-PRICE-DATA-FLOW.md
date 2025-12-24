# Listing Price (LP) - Complete Data Flow Trace

## 🔍 **Where Does `lp` (Listing Price) Come From?**

The listing price flows through multiple transformations from scraping to display. Here's the complete trace:

---

## 📊 **COMPLETE DATA FLOW DIAGRAM**

```
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 1: WEB SCRAPING                          │
└─────────────────────────────────────────────────────────────────┘

Privy.pro Dashboard HTML:
<div class="property-card">
  <div class="price-block">
    <div class="price">$100,000</div>    ← SOURCE!
  </div>
  <div class="address-line1">123 Main St</div>
  <div class="address-line2">Pittsburgh, PA 15213</div>
  <ul class="quickstats-horiz">
    <li>3 Beds</li>
    <li>2 Baths</li>
    <li>1,500 Sq Ft</li>
  </ul>
</div>

                    ↓ [Puppeteer Scraping]

┌─────────────────────────────────────────────────────────────────┐
│         vendors/privy/scrapers/v1.js:468                        │
└─────────────────────────────────────────────────────────────────┘

const price = bySelText(el, '.price-block > .price');
// Extracts: "$100,000"

const parsed = {
  fullAddress: "123 Main St, Pittsburgh, PA 15213",
  price: "$100,000",        ← Raw string from HTML
  quickStats: ["3 Beds", "2 Baths", "1,500 Sq Ft"]
}

                    ↓ [Data Normalization]

┌─────────────────────────────────────────────────────────────────┐
│         vendors/privy/scrapers/v1.js:740                        │
└─────────────────────────────────────────────────────────────────┘

const priceNum = toNumber(prop.price);
// toNumber("$100,000") → 100000 (removes $, commas)

const normalized = {
  fullAddress: "123 Main St, Pittsburgh, PA 15213",
  price: 100000,            ← Converted to number
  details: {
    beds: 3,
    baths: 2,
    sqft: 1500
  }
}

                    ↓ [Save to Database]

┌─────────────────────────────────────────────────────────────────┐
│              STEP 2: DATABASE STORAGE                            │
└─────────────────────────────────────────────────────────────────┘

MongoDB: rawProperty Collection (Temporary)
{
  _id: ObjectId("..."),
  fullAddress: "123 Main St, Pittsburgh, PA 15213",
  price: 100000,           ← Stored as number
  details: {
    beds: 3,
    baths: 2,
    sqft: 1500
  },
  status: "scraped"
}

                    ↓ [Upsert to Main Collection]

MongoDB: Property Collection (Main)
{
  _id: ObjectId("..."),
  prop_id: "prop_12345",
  fullAddress: "123 Main ST, Pittsburgh, PA, 15213",
  fullAddress_ci: "123 main st, pittsburgh, pa, 15213",

  price: 100000,           ← Field name in database schema

  details: {
    beds: 3,
    baths: 2,
    sqft: 1500
  },

  // Added later by valuation jobs:
  bofa_value: 200000,
  redfin_avm_value: 220000,
  amv: 210000,
  deal: true
}

┌─────────────────────────────────────────────────────────────────┐
│              STEP 3: API TRANSFORMATION                          │
└─────────────────────────────────────────────────────────────────┘

Backend: routes/properties.js:171-205

GET /api/properties/table

// Read from database
const p = {
  price: 100000,
  listingPrice: undefined  // May not exist in old documents
}

// Transformation logic:
let listingPrice = toNum(p.listingPrice ?? p.price);
//                       ↑ null/undefined  ↑ 100000
// Result: listingPrice = 100000

// Calculate derived values:
const lp80 = listingPrice * 0.80;  // 80000

// API Response:
{
  listingPrice: 100000,    ← Renamed from 'price'
  amv: 210000,
  lp80: 80000,            ← Calculated (80% of listing)
  amv40: 84000,           ← Calculated (40% of AMV)
  amv30: 63000            ← Calculated (30% of AMV)
}

┌─────────────────────────────────────────────────────────────────┐
│           STEP 4: FRONTEND NORMALIZATION                         │
└─────────────────────────────────────────────────────────────────┘

Frontend: site/src/screens/Deals.tsx:409-416

// Multiple field name variations supported for backward compatibility:
const getLP = (r: any) => pickFirstNumber(
  r.listingPrice,   // ← Primary field from API
  r.price,          // Legacy fallback
  r.listPrice,      // Alternative naming
  r.list_price,     // Snake case variant
  r.lp              // Short form
);

// Example:
const row = {
  listingPrice: 100000,
  price: null,
  listPrice: null,
  lp: null
};

const lp = getLP(row);
// Result: 100000 (picked from listingPrice)

┌─────────────────────────────────────────────────────────────────┐
│              STEP 5: UI DISPLAY                                  │
└─────────────────────────────────────────────────────────────────┘

Frontend: DataGrid Column

{
  field: 'listingPrice',
  headerName: 'Listing Price',
  valueFormatter: (params) => formatCurrency(params.value)
}

Display: "$100,000"    ← Formatted with $, commas
```

---

## 🔄 **FIELD NAME EVOLUTION**

The listing price has had multiple names throughout the application's history:

| Location | Field Name | Type | Notes |
|----------|-----------|------|-------|
| **Privy HTML** | `.price` | String | `"$100,000"` |
| **Scraper Output** | `price` | String | `"$100,000"` |
| **After toNumber()** | `price` | Number | `100000` |
| **Database Schema** | `price` | Number | Main field in Property model |
| **API Response** | `listingPrice` | Number | Renamed for clarity |
| **Frontend Row Type** | `listingPrice`, `listPrice`, `lp`, `price` | Number | Multiple names supported |
| **UI Display** | "Listing Price" | String | `"$100,000"` |

---

## 📝 **KEY CODE LOCATIONS**

### **1. Scraping (Source of Truth)**

**File:** [backend/vendors/privy/scrapers/v1.js:468](backend/vendors/privy/scrapers/v1.js#L468)

```javascript
const price = bySelText(el, '.price-block > .price');
// Extracts raw text from HTML: "$100,000"
```

**Selector Definition:** [backend/vendors/privy/config/selection.js:11](backend/vendors/privy/config/selection.js#L11)

```javascript
export const priceSelector = '.price-block > .price';
```

---

### **2. Number Conversion**

**File:** [backend/vendors/privy/scrapers/v1.js:740](backend/vendors/privy/scrapers/v1.js#L740)

```javascript
const priceNum = toNumber(prop.price);
// toNumber("$100,000") → 100000
```

**Helper Function:** [backend/utils/normalize.js](backend/utils/normalize.js)

```javascript
export function toNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Remove $, commas, whitespace
    const clean = val.replace(/[$,\s]/g, '');
    const num = Number(clean);
    return isFinite(num) ? num : null;
  }
  return null;
}
```

---

### **3. Database Schema**

**File:** [backend/models/Property.js:16](backend/models/Property.js#L16)

```javascript
const PropertySchema = new mongoose.Schema({
  // Listing price (may be unknown at create time)
  price: { type: Number, default: null },

  // ... other fields
});
```

**No `listingPrice` field in schema!** The API transforms `price` → `listingPrice` on the fly.

---

### **4. API Transformation**

**File:** [backend/routes/properties.js:172-173](backend/routes/properties.js#L172-L173)

```javascript
// prefer explicit listingPrice; else fall back to price
let listingPrice = toNum(p.listingPrice ?? p.price);
```

This line explains why:
- Database has `price` field
- API returns `listingPrice` field
- They're the same value, just renamed

**Response Builder:** [backend/routes/properties.js:193-209](backend/routes/properties.js#L193-L209)

```javascript
return {
  _id: String(p._id),
  fullAddress: p.fullAddress,

  // pricing/valuations (NEVER default to 0)
  listingPrice,      // ← Renamed from database 'price'
  amv,
  lp80: lp80Final,   // Calculated: listingPrice * 0.80
  amv40: amv40Final, // Calculated: amv * 0.40
  amv30: amv30Final, // Calculated: amv * 0.30

  // ... other fields
};
```

---

### **5. Frontend Compatibility Layer**

**File:** [site/src/screens/Deals.tsx:409-418](site/src/screens/Deals.tsx#L409-L418)

```typescript
// Helper function to extract listing price from any field variation
const getLP = (r: any) => pickFirstNumber(
  r.listingPrice,   // Primary (from new API)
  r.price,          // Legacy fallback
  r.listPrice,      // Alternative naming
  r.list_price,     // Snake case
  r.lp,             // Short form
  0                 // Final fallback (avoid null errors)
);

// Usage:
const lp = getLP(rowData);  // 100000
```

**Why So Many Variations?**
- `listingPrice` - Current API standard (camelCase)
- `price` - Legacy database field
- `listPrice` - Alternative camelCase
- `list_price` - Snake case (Python/SQL conventions)
- `lp` - Shorthand used in some calculations

This ensures backward compatibility if the backend changes field names.

---

### **6. Deal Detection Logic**

**File:** [site/src/screens/Deals.tsx:452-457](site/src/screens/Deals.tsx#L452-L457)

```typescript
const lp = getLP(r);  // Get listing price
const amv = getAMV(r); // Get automated market value

// Check if it's a deal: LP ≤ 50% of AMV
const calcDeal = Number.isFinite(amv) &&
                 typeof lp === 'number' &&
                 Number.isFinite(lp) &&
                 lp <= Math.round(0.5 * amv);

// Example:
// lp = 100000
// amv = 210000
// Check: 100000 <= (210000 * 0.5) = 105000
// Result: true ✅ It's a deal!
```

---

## 🧮 **CALCULATED FIELDS (Derived from LP)**

Once the listing price is in the system, several calculated fields are derived:

### **LP80 (80% of Listing Price)**

```javascript
lp80 = Math.round(listingPrice * 0.80);
// Example: $100,000 * 0.80 = $80,000
```

**Purpose:** Maximum cash offer based on listing price

**Calculated In:**
- Backend: [routes/properties.js:184](backend/routes/properties.js#L184)
- Frontend: [Deals.tsx:494](site/src/screens/Deals.tsx#L494)

---

### **AMV40 (40% of Automated Market Value)**

```javascript
amv40 = Math.round(amv * 0.40);
// Example: $210,000 * 0.40 = $84,000
```

**Purpose:** Maximum cash offer based on market value

**Calculated In:**
- Backend: [routes/properties.js:185](backend/routes/properties.js#L185)
- Frontend: [Deals.tsx:495](site/src/screens/Deals.tsx#L495)

---

### **AMV30 (30% of Automated Market Value)**

```javascript
amv30 = Math.round(amv * 0.30);
// Example: $210,000 * 0.30 = $63,000
```

**Purpose:** Conservative cash offer

**Calculated In:**
- Backend: [routes/properties.js:186](backend/routes/properties.js#L186)
- Frontend: [Deals.tsx:496](site/src/screens/Deals.tsx#L496)

---

### **Suggested Offer Amount**

```javascript
suggestedOffer = Math.min(lp80, amv40);
// Example: min($80,000, $84,000) = $80,000
```

**Purpose:** Final offer sent to agent (lowest of LP80 and AMV40)

---

## 🔍 **DEBUGGING THE DATA FLOW**

### **Check What's in the Database:**

```bash
cd backend
node check-db-data.js
```

Look for the `price` field in properties:

```javascript
{
  fullAddress: "123 Main St, Pittsburgh, PA 15213",
  price: 100000,  // ← This is the listing price
  amv: 210000,
  deal: true
}
```

---

### **Check What the API Returns:**

```bash
curl http://localhost:3015/api/properties/table \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Response:

```json
{
  "rows": [
    {
      "fullAddress": "123 Main St, Pittsburgh, PA 15213",
      "listingPrice": 100000,  // ← Renamed from 'price'
      "amv": 210000,
      "lp80": 80000,
      "amv40": 84000,
      "amv30": 63000,
      "deal": true
    }
  ]
}
```

---

### **Check What the Frontend Receives:**

Open browser console on the Deals page:

```javascript
// In site/src/screens/Deals.tsx:646
console.log('listingPrice(raw)', selected.listingPrice, 'getLP()', lpSel);
```

Output:

```
listingPrice(raw) 100000 getLP() 100000
```

---

## 📊 **SUMMARY TABLE**

| Stage | Location | Field Name | Value | Type |
|-------|----------|-----------|-------|------|
| 1. HTML Source | Privy.pro | `.price` | `"$100,000"` | String |
| 2. Scraper Output | v1.js:468 | `price` | `"$100,000"` | String |
| 3. After toNumber() | v1.js:740 | `price` | `100000` | Number |
| 4. Database (raw) | rawProperty | `price` | `100000` | Number |
| 5. Database (main) | Property | `price` | `100000` | Number |
| 6. API Response | /table | `listingPrice` | `100000` | Number |
| 7. Frontend Variable | Deals.tsx | `lp` | `100000` | Number |
| 8. UI Display | DataGrid | "Listing Price" | `"$100,000"` | String |

---

## ❓ **WHY THE RENAME?**

**Question:** Why does the database use `price` but the API returns `listingPrice`?

**Answer:** Clarity and disambiguation!

```javascript
// In real estate, "price" is ambiguous:
price: 100000         // Is this listing price? Sold price? Offer price?

// More explicit naming in API:
listingPrice: 100000  // Clearly the advertised listing price
salePrice: 95000      // Clearly the final sold price
offerPrice: 80000     // Clearly the offered price
```

The database schema was created early using generic `price`, but the API layer adds clarity by renaming to `listingPrice` before sending to frontend.

---

## 🎯 **KEY TAKEAWAYS**

1. **Source:** Listing price originates from Privy.pro HTML (`.price-block > .price`)
2. **Scraping:** Extracted as string `"$100,000"` by Puppeteer
3. **Normalization:** Converted to number `100000` by `toNumber()` helper
4. **Storage:** Stored in database as `price: 100000` (Number type)
5. **API Transform:** Renamed to `listingPrice` in API response for clarity
6. **Frontend Flexibility:** Multiple field names supported (`listingPrice`, `price`, `lp`) for backward compatibility
7. **Calculations:** Used to compute `lp80`, `amv40`, `amv30`, and deal detection

**The listing price is the foundation for all deal calculations!**

---

## 📚 **RELATED DOCUMENTATION**

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) - Complete system overview
- [LOCAL-DATABASE-SETUP.md](LOCAL-DATABASE-SETUP.md) - Database configuration
- [backend/models/Property.js](backend/models/Property.js) - Database schema
- [backend/routes/properties.js](backend/routes/properties.js) - API transformation logic
- [site/src/screens/Deals.tsx](site/src/screens/Deals.tsx) - Frontend display logic

