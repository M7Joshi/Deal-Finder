# External Data Sources - The Only 3 Things Coming From Outside

## 🌐 **EXTERNAL DATA SOURCES (Scraped from Websites)**

Only **3 pieces of data** actually come from external sources (outside your system):

---

## 1️⃣ **PROPERTY LISTINGS** (From Privy.pro)

### **What Comes In:**
- ✅ **Address** (123 Main St, Pittsburgh, PA 15213)
- ✅ **Listing Price** ($100,000)
- ✅ **Property Details** (beds, baths, sqft, year built)

### **Source:**
- **Website:** https://app.privy.pro/dashboard
- **Scraper:** [backend/vendors/privy/scrapers/v1.js](backend/vendors/privy/scrapers/v1.js)
- **Method:** Puppeteer web scraping

### **What Gets Extracted:**
```javascript
{
  fullAddress: "123 Main St, Pittsburgh, PA 15213",
  price: 100000,           // ← EXTERNAL DATA #1
  details: {
    beds: 3,               // ← EXTERNAL DATA #2
    baths: 2,              // ← EXTERNAL DATA #2
    sqft: 1500,            // ← EXTERNAL DATA #2
    built: 1950            // ← EXTERNAL DATA #2
  }
}
```

**HTML Source:**
```html
<div class="property-card">
  <div class="price">$100,000</div>
  <div class="address-line1">123 Main St</div>
  <div class="address-line2">Pittsburgh, PA 15213</div>
  <ul class="quickstats-horiz">
    <li>3 Beds</li>
    <li>2 Baths</li>
    <li>1,500 Sq Ft</li>
  </ul>
</div>
```

---

## 2️⃣ **MARKET VALUATIONS** (From BofA & Redfin AVM)

### **What Comes In:**
- ✅ **Bank of America Valuation** ($200,000)
- ✅ **Redfin AVM Valuation** ($220,000)
- ✅ *(Optional: Chase Valuation)*

### **Source A: Bank of America**
- **Website:** https://homevaluerealestatecenter.bankofamerica.com/
- **Scraper:** [backend/vendors/bofa/bofaJob.js](backend/vendors/bofa/bofaJob.js)
- **Method:** Puppeteer with proxy rotation

### **What Gets Extracted:**
```javascript
{
  bofa_value: 200000      // ← EXTERNAL DATA #3a
}
```

**Process:**
1. Navigate to BofA home value estimator
2. Enter address: "123 Main St, Pittsburgh, PA 15213"
3. Submit form with autocomplete
4. Wait for valuation iframe to load
5. Extract value from results

### **Source B: Redfin AVM**
- **Website:** https://www.redfin.com/what-is-my-home-worth
- **Scraper:** [backend/vendors/redfin/](backend/vendors/redfin/)
- **Method:** Puppeteer scraping

### **What Gets Extracted:**
```javascript
{
  redfin_avm_value: 220000  // ← EXTERNAL DATA #3b
}
```

**Important:** This is **NOT** the Redfin listing price. It's Redfin's own automated valuation model.

---

## 3️⃣ **AGENT CONTACT INFORMATION** (From Homes.com/Realtor.com)

### **What Comes In:**
- ✅ **Agent Name** (John Smith)
- ✅ **Agent Phone** ((412) 555-1234)
- ✅ **Agent Email** (john.smith@remax.com)
- ✅ **Agent Company** (RE/MAX Properties)

### **Source:**
- **Website:** https://www.homes.com/ or https://www.realtor.com/
- **Scraper:** [backend/vendors/homes/homesBot.js](backend/vendors/homes/homesBot.js)
- **Method:** Puppeteer web scraping

### **What Gets Extracted:**
```javascript
{
  agentName: "John Smith",           // ← EXTERNAL DATA #4
  agentPhone: "(412) 555-1234",     // ← EXTERNAL DATA #5
  agentEmail: "john.smith@remax.com", // ← EXTERNAL DATA #6
  agentCompany: "RE/MAX Properties"  // ← EXTERNAL DATA #7
}
```

**Process:**
1. Search for property address on Homes.com
2. Navigate to listing detail page
3. Extract agent contact card information
4. Parse name, phone, email from listing

---

## 📊 **SUMMARY TABLE**

| # | Data Field | External Source | Scraper Location |
|---|-----------|----------------|------------------|
| 1 | **Listing Price** | Privy.pro | [privy/scrapers/v1.js:468](backend/vendors/privy/scrapers/v1.js#L468) |
| 2 | **Property Details** (beds/baths/sqft) | Privy.pro | [privy/scrapers/v1.js:469](backend/vendors/privy/scrapers/v1.js#L469) |
| 3a | **BofA Valuation** | Bank of America | [bofa/bofaJob.js](backend/vendors/bofa/bofaJob.js) |
| 3b | **Redfin AVM** | Redfin.com | [redfin/](backend/vendors/redfin/) |
| 4 | **Agent Name** | Homes.com | [homes/homesBot.js](backend/vendors/homes/homesBot.js) |
| 5 | **Agent Phone** | Homes.com | [homes/homesBot.js](backend/vendors/homes/homesBot.js) |
| 6 | **Agent Email** | Homes.com | [homes/homesBot.js](backend/vendors/homes/homesBot.js) |

---

## 🔄 **EVERYTHING ELSE IS CALCULATED INTERNALLY**

All other fields are **computed** from the external data:

### **Calculated Fields:**

```javascript
// From external data:
listingPrice = 100000    // From Privy
bofa_value = 200000      // From BofA
redfin_avm_value = 220000 // From Redfin

// CALCULATED (not scraped):
amv = (200000 + 220000) / 2 = 210000  // Average of valuations

deal = (100000 <= 210000 * 0.5)      // 100k <= 105k = TRUE

lp80 = 100000 * 0.80 = 80000         // 80% of listing price

amv40 = 210000 * 0.40 = 84000        // 40% of market value

amv30 = 210000 * 0.30 = 63000        // 30% of market value

suggestedOffer = min(80000, 84000) = 80000  // Lowest offer
```

### **Derived Fields:**
- ❌ `amv` - Calculated (not scraped)
- ❌ `deal` - Calculated (not scraped)
- ❌ `lp80` - Calculated (not scraped)
- ❌ `amv40` - Calculated (not scraped)
- ❌ `amv30` - Calculated (not scraped)
- ❌ `suggestedOffer` - Calculated (not scraped)
- ❌ `fullAddress_ci` - Normalized internally (not scraped)
- ❌ `prop_id` - Generated internally (not scraped)

---

## 🎯 **THE 3 EXTERNAL DATA CATEGORIES**

If we group by **source type**, there are exactly **3 categories**:

### **Category 1: Property Listings**
- **Source:** Privy.pro (or Redfin, Estately)
- **Data:** Address, Listing Price, Beds, Baths, Sqft

### **Category 2: Market Valuations**
- **Source:** BofA, Chase, Redfin AVM
- **Data:** Automated home value estimates

### **Category 3: Agent Contact**
- **Source:** Homes.com, Realtor.com
- **Data:** Agent name, phone, email

---

## 🔍 **DATA FLOW VISUALIZATION**

```
┌─────────────────────────────────────────────────────────────┐
│              EXTERNAL SOURCES (The Only 3)                   │
└─────────────────────────────────────────────────────────────┘

       ┌──────────────┐
       │   Privy.pro  │
       │  (Listings)  │
       └──────┬───────┘
              │
              ├─→ Address
              ├─→ Listing Price ($100k)
              ├─→ Beds (3)
              ├─→ Baths (2)
              └─→ Sqft (1500)

       ┌──────────────────┐
       │ BofA + Redfin AVM│
       │  (Valuations)    │
       └──────┬───────────┘
              │
              ├─→ BofA Value ($200k)
              └─→ Redfin AVM ($220k)

       ┌──────────────┐
       │  Homes.com   │
       │ (Agent Info) │
       └──────┬───────┘
              │
              ├─→ Agent Name
              ├─→ Agent Phone
              └─→ Agent Email

              ↓
       ┌──────────────┐
       │   DATABASE   │
       └──────┬───────┘
              │
              ↓
       ┌──────────────────┐
       │  CALCULATIONS    │
       │  (All Internal)  │
       └──────┬───────────┘
              │
              ├─→ AMV = (BofA + Redfin) / 2
              ├─→ Deal = LP ≤ AMV × 0.5
              ├─→ LP80 = LP × 0.8
              ├─→ AMV40 = AMV × 0.4
              └─→ Suggested Offer = min(LP80, AMV40)

              ↓
       ┌──────────────┐
       │   FRONTEND   │
       │   (Display)  │
       └──────────────┘
```

---

## 🚫 **WHAT IS NOT SCRAPED**

These fields are **NOT** external data (they're calculated internally):

- ❌ AMV (Automated Market Value) - **Calculated** from BofA + Redfin
- ❌ Deal flag - **Calculated** from LP vs AMV comparison
- ❌ LP80, AMV40, AMV30 - **Calculated** percentages
- ❌ Suggested Offer - **Calculated** min of LP80 and AMV40
- ❌ Full Address normalized - **Processed** internally
- ❌ Property ID - **Generated** by database
- ❌ Created/Updated timestamps - **Generated** by database

---

## 🔑 **KEY INSIGHT**

**The system only scrapes 3 types of data:**
1. **Property listings** (address, price, details)
2. **Market valuations** (BofA, Redfin AVM)
3. **Agent contacts** (name, phone, email)

**Everything else is computed from these 3 inputs!**

The intelligence of the system comes from:
- ✅ **Cross-validating** multiple valuations (BofA vs Redfin)
- ✅ **Detecting deals** using the 50% rule
- ✅ **Automating outreach** to the right agents
- ✅ **Presenting results** in an easy-to-use dashboard

---

## 📚 **RELATED FILES**

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) - Complete system explanation
- [LISTING-PRICE-DATA-FLOW.md](LISTING-PRICE-DATA-FLOW.md) - How LP flows through system
- [backend/vendors/privy/](backend/vendors/privy/) - Property listing scraper
- [backend/vendors/bofa/](backend/vendors/bofa/) - BofA valuation scraper
- [backend/vendors/homes/](backend/vendors/homes/) - Agent contact scraper

