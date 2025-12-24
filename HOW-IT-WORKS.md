# Deal-Finder-1: Complete System Architecture & Operation Guide

## 🎯 **PROJECT OVERVIEW**

**Deal-Finder-1** is an automated real estate investment platform that identifies undervalued properties by:
1. Scraping property listings from multiple sources
2. Cross-validating market values through multiple vendor APIs
3. Detecting deals where listing price is ≤50% of market value
4. Automatically contacting listing agents with cash offers

---

## 🏗️ **SYSTEM ARCHITECTURE**

### **High-Level Components**

```
┌─────────────────────────────────────────────────────────────┐
│                    DEAL-FINDER SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐    ┌─────────────┐ │
│  │   Frontend   │────▶│   Backend    │───▶│  MongoDB    │ │
│  │  (React UI)  │     │ (Node.js API)│    │  Database   │ │
│  └──────────────┘     └──────┬───────┘    └─────────────┘ │
│                               │                             │
│                               ▼                             │
│                    ┌──────────────────┐                    │
│                    │  Worker Process  │                    │
│                    │  (Automation)    │                    │
│                    └────────┬─────────┘                    │
│                             │                              │
│          ┌──────────────────┼──────────────────┐          │
│          ▼                   ▼                  ▼          │
│    ┌─────────┐        ┌──────────┐      ┌──────────┐     │
│    │ Scrapers│        │Valuations│      │  Agent   │     │
│    │ (Privy, │        │(BofA,    │      │ Outreach │     │
│    │ Redfin) │        │Chase,AVM)│      │ (Email)  │     │
│    └─────────┘        └──────────┘      └──────────┘     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 📊 **COMPLETE DATA FLOW WALKTHROUGH**

### **Phase 1: Property Discovery (Scraping)**

#### **How It Works:**

1. **Automation Scheduler Starts** ([server.js → runAutomation.js:774](backend/vendors/runAutomation.js#L774))
   - Runs every 3 minutes (configurable via `RUN_INTERVAL_MS`)
   - Jobs can be configured via environment variable `JOBS=privy,bofa,agent_offers`

2. **Privy Scraper Launches** ([privyBot.js:48-303](backend/vendors/privy/privyBot.js#L48-L303))

```javascript
// What happens when Privy scraper runs:

1. Login to Privy.pro with credentials
   - Email: PRIVY_EMAIL from .env
   - Password: PRIVY_PASSWORD from .env
   - Uses Puppeteer (headless Chrome) with session persistence

2. Navigate to dashboard: https://app.privy.pro/dashboard

3. Apply filters based on tags:
   - "tired_landlord" - motivated sellers
   - "foreclosures" - distressed properties
   - Other customizable tags

4. Scrape property data from filtered results:
   {
     fullAddress: "123 Main St, Pittsburgh, PA 15213",
     price: 100000,  // listing price
     beds: 3,
     baths: 2,
     sqft: 1500,
     built: 1950
   }

5. Save to database (rawProperty collection initially)
```

**Key Files:**
- [backend/vendors/privy/privyBot.js](backend/vendors/privy/privyBot.js) - Main scraper
- [backend/vendors/privy/scrapers/v1.js](backend/vendors/privy/scrapers/v1.js) - Parsing logic
- [backend/vendors/privy/auth/loginService.js](backend/vendors/privy/auth/loginService.js) - Authentication

#### **Similar Process for Other Sources:**
- **Redfin** ([backend/vendors/redfin/](backend/vendors/redfin/)) - Scrapes Redfin listings
- **Homes.com** ([backend/vendors/homes/](backend/vendors/homes/)) - For agent contact info
- **Estately** ([backend/estately/](backend/estately/)) - Python-based scraper

---

### **Phase 2: Address Normalization**

#### **Why This Matters:**
Prevent duplicate properties with slight address variations:
- "123 Main Street" vs "123 Main St"
- "Pittsburgh" vs "South Side"
- "15213-5423" vs "15213"

#### **How It Works:** ([runAutomation.js:603-610](backend/vendors/runAutomation.js#L603-L610))

```javascript
// Input from Privy:
"123 Main Street, Apt 2B, Pittsburgh, PA 15213-5423"

// Step 1: Canonicalize
canonicalizeFullAddress()
  → Removes: parentheticals, unit markers
  → Result: "123 Main Street, Pittsburgh, PA 15213-5423"

// Step 2: Normalize for vendors
normalizeAddressForVendors()
  → Street: "Street" → "ST"
  → City: "South Side" → "Pittsburgh" (mapping)
  → ZIP: "15213-5423" → "15213" (5-digit only)
  → Result: "123 Main ST, Pittsburgh, PA, 15213"

// Step 3: Create case-insensitive key
fullAddress_ci = fullAddress.toLowerCase()
  → Used for database deduplication

// Step 4: Upsert to Properties collection
Property.findOneAndUpdate(
  { fullAddress_ci: "123 main st, pittsburgh, pa, 15213" },
  { address, city, state, zip, price, details },
  { upsert: true }
)
```

**Result:** Ensures one property = one database record

---

### **Phase 3: Market Valuation (The Core Intelligence)**

This is where the system determines if a property is actually a "deal."

#### **Step 1: Parallel Vendor Scraping**

The system queries **3 different valuation sources** simultaneously:

##### **A. Bank of America Home Value Estimator** ([bofa/bofaJob.js](backend/vendors/bofa/bofaJob.js))

```javascript
// What happens:

1. Launch Puppeteer with rotating residential proxies
   - Proxies hide scraping activity from BofA
   - Pool of 10-20 proxy IPs rotating

2. Navigate to: https://homevaluerealestatecenter.bankofamerica.com/

3. Fill address form with normalized address
   - Waits for autocomplete suggestions
   - Selects matching address

4. Submit and wait for results (15-40 seconds)

5. Extract valuation from iframe:
   {
     bofa_value: 200000,
     range: { low: 180000, high: 220000 }
   }

6. Update database:
   Property.updateOne(
     { fullAddress_ci: addressKey },
     { bofa_value: 200000 }
   )
```

**Key Features:**
- **Proxy rotation** - Avoids detection/blocking
- **Concurrency** - 10-12 addresses at once
- **Error handling** - Retries with different proxy on failure
- **Timeout management** - 30-40 second hard limit per address

##### **B. Chase Home Value Estimator** ([chase/chaseJob.js](backend/vendors/chase/chaseJob.js))

Similar process to BofA:
```javascript
1. Navigate to Chase calculator
2. Enter address with autocomplete handling
3. Extract chase_value from results
4. Update Property.chase_value
```

##### **C. Redfin AVM (Automated Valuation Model)** ([redfin/](backend/vendors/redfin/))

```javascript
// Redfin "What is my home worth" tool

1. Search property on Redfin
2. Navigate to AVM page
3. Extract redfin_avm_value (NOT listing price)
4. Update Property.redfin_avm_value
```

**Important Distinction:**
- `redfin_value` = Listing price from Redfin
- `redfin_avm_value` = Redfin's automated valuation (used for AMV)

---

#### **Step 2: AMV (Automated Market Value) Calculation**

**Formula:** ([Property.js:207-215](backend/models/Property.js#L207-L215))

```javascript
function computeAMV({ bofa_value, redfin_avm_value }) {
  const values = [];

  if (bofa_value !== null && isFinite(bofa_value)) {
    values.push(bofa_value);
  }

  if (redfin_avm_value !== null && isFinite(redfin_avm_value)) {
    values.push(redfin_avm_value);
  }

  if (values.length === 0) return null;

  // Average of available values
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg);
}

// Example:
// bofa_value: $200,000
// redfin_avm_value: $220,000
// AMV = ($200k + $220k) / 2 = $210,000
```

**Why Average of Only 2 Vendors?**
- BofA and Redfin AVM are most reliable
- Chase data is stored but not used in AMV (optional backup)
- More vendors = more scraping time/cost

---

#### **Step 3: Deal Detection Logic** ([runAutomation.js:667-668](backend/vendors/runAutomation.js#L667-L668))

```javascript
// The "50% Rule" - Property is a deal if:

const deal = (
  listingPrice <= (AMV * 0.50) &&  // Price is 50% or less of market value
  beds >= 3 &&                      // Minimum quality threshold
  AMV >= 150000                     // Minimum market value
);

// Real Example:
// Property: 123 Main St, Pittsburgh, PA
// Listing Price: $100,000
// BofA Value: $200,000
// Redfin AVM: $220,000
// AMV = $210,000
//
// Check: $100k <= ($210k × 0.50) = $105k ✅
// Beds: 3 ✅
// AMV: $210k >= $150k ✅
//
// Result: deal = TRUE

Property.updateOne(
  { _id: propertyId },
  {
    amv: 210000,
    deal: true,  // ← Flagged as deal!
    lp80: 80000,   // 80% of listing price
    amv40: 84000,  // 40% of AMV
    amv30: 63000   // 30% of AMV
  }
);
```

**Deal Scoring Breakdown:**
- **LP80** (`listingPrice × 0.80`) = Maximum cash offer based on listing
- **AMV40** (`AMV × 0.40`) = Maximum cash offer based on market value
- **AMV30** (`AMV × 0.30`) = Conservative cash offer
- **Suggested Offer** = `min(LP80, AMV40)` = Lowest of the two

---

### **Phase 4: Agent Enrichment (Finding Who to Contact)**

For properties flagged as `deal: true`, the system finds the listing agent's contact information.

#### **How It Works:** ([homes/homesBot.js](backend/vendors/homes/homesBot.js))

```javascript
// Only runs for: deal = true AND agentEmail = null

1. Search Homes.com or Realtor.com for the property address

2. Navigate to listing detail page

3. Extract agent information:
   {
     agentName: "John Smith",
     agentPhone: "(412) 555-1234",
     agentEmail: "john.smith@remax.com",
     agentCompany: "RE/MAX Properties"
   }

4. Update database with agent info:
   Property.updateOne(
     { _id: propertyId },
     {
       agentName: "John Smith",
       agentPhone: "(412) 555-1234",
       agentEmail: "john.smith@remax.com",

       // Also syncs to legacy snake_case fields:
       agent: "John Smith",
       agent_phone: "(412) 555-1234",
       agent_email: "john.smith@remax.com"
     }
   )
```

**Field Synchronization:** ([Property.js:90-107](backend/models/Property.js#L90-L107))
The schema maintains both naming conventions for backward compatibility:
- `agentName` ↔ `agent`
- `agentPhone` ↔ `agent_phone`
- `agentEmail` ↔ `agent_email`

Pre-save hooks automatically sync these fields bidirectionally.

---

### **Phase 5: Automated Agent Outreach**

Once agent email is available, the system can automatically send offers.

#### **How It Works:** ([agent_offers.js](backend/vendors/agent_offers.js))

```javascript
// Query: Properties with deals, agent emails, and not yet contacted

const properties = await Property.find({
  deal: true,
  agentEmail: { $exists: true, $ne: null, $ne: '' },
  'offerStatus.lastSentAt': { $exists: false }  // Not yet sent
});

// For each property:
for (const prop of properties) {
  // Calculate offer amount
  const offerAmount = Math.min(
    prop.price * 0.80,  // LP80
    prop.amv * 0.40     // AMV40
  );

  // Generate email from template
  const email = {
    to: prop.agentEmail,
    subject: `Cash Offer for ${prop.address}`,
    body: `
      Hi ${prop.agentName},

      We are interested in purchasing ${prop.fullAddress}
      and would like to submit a cash offer of $${offerAmount}.

      We can close quickly with no financing contingency.

      Please let us know if the seller would be interested.

      Best regards,
      [Your Company]
    `
  };

  // Send via Nodemailer + SendGrid SMTP
  await sendEmail(email);

  // Update database with send status
  await Property.updateOne(
    { _id: prop._id },
    {
      'offerStatus.lastSentAt': new Date(),
      'offerStatus.lastResult': 'sent',
      'offerStatus.offerAmount': offerAmount
    }
  );
}
```

**Email Configuration:** ([.env:177-183](backend/.env#L177-L183))
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<SendGrid API key>
SMTP_FROM="MIOYM <mcox@mioym.com>"
EMAIL_DRY_RUN=0  # Set to 1 to test without sending
```

---

### **Phase 6: Frontend Display & User Interaction**

#### **Backend API** ([routes/properties.js:34-238](backend/routes/properties.js#L34-L238))

```javascript
// GET /api/properties/table?onlyDeals=true&states=CA,FL

router.get('/table', requireAuth, scopeByState(), async (req, res) => {
  // 1. Apply filters
  const filters = {
    deal: req.query.onlyDeals === 'true' ? true : undefined,
    state: req.query.states ? { $in: states.split(',') } : undefined
  };

  // 2. MongoDB aggregation pipeline
  const pipeline = [
    { $match: filters },

    // Deduplicate by normalized address (prefer entries with price)
    { $sort: { hasPrice: -1, updatedAt: -1 } },
    { $group: { _id: '$fullAddress_ci', doc: { $first: '$$ROOT' } } },

    // Project only needed fields
    { $project: {
        fullAddress: 1,
        address: 1, city: 1, state: 1, zip: 1,
        listingPrice: '$price',
        amv: 1, lp80: 1, amv40: 1, amv30: 1,
        beds: '$details.beds',
        baths: '$details.baths',
        squareFeet: '$details.sqft',
        bofa_value: 1, chase_value: 1, redfin_avm_value: 1,
        agentName: 1, agentPhone: 1, agentEmail: 1,
        offerStatus: 1, deal: 1
      }
    }
  ];

  const properties = await Property.aggregate(pipeline);

  res.json({ rows: properties });
});
```

#### **Frontend React Component** ([site/src/screens/Deals.tsx](site/src/screens/Deals.tsx))

```typescript
function Deals() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    states: [],
    hasEmail: null,
    onlyDeals: true
  });

  // Fetch data every 3 minutes
  useEffect(() => {
    const fetchDeals = async () => {
      const response = await getDeals({
        onlyDeals: filters.onlyDeals,
        states: filters.states.join(','),
        hasEmail: filters.hasEmail
      });
      setRows(response.rows);
    };

    fetchDeals();
    const interval = setInterval(fetchDeals, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters]);

  return (
    <div>
      {/* Filters */}
      <StateFilter states={filters.states} onChange={setStates} />
      <EmailFilter hasEmail={filters.hasEmail} onChange={setHasEmail} />

      {/* Data Grid */}
      <DataGrid
        rows={rows}
        columns={[
          { field: 'fullAddress', headerName: 'Address', width: 300 },
          { field: 'listingPrice', headerName: 'Listing Price', format: '$' },
          { field: 'amv', headerName: 'AMV', format: '$' },
          { field: 'lp80', headerName: 'LP80', format: '$' },
          { field: 'amv40', headerName: 'AMV40', format: '$' },
          { field: 'beds', headerName: 'Beds' },
          { field: 'baths', headerName: 'Baths' },
          { field: 'agentName', headerName: 'Agent' },
          { field: 'agentEmail', headerName: 'Email' },
          { field: 'offerStatus', headerName: 'Status' }
        ]}
        onRowClick={openPropertyModal}
      />

      {/* Property Detail Modal */}
      <PropertyModal
        property={selectedProperty}
        onSendOffer={handleSendOffer}
        onEditAgent={handleEditAgent}
      />
    </div>
  );
}
```

**Features:**
- **Real-time filtering** by state, email status
- **Sortable columns** - Click headers to sort
- **Inline editing** - Edit agent details directly in grid
- **Property modal** - Detailed view with:
  - Google Maps Street View
  - Vendor valuations breakdown
  - Agent contact form
  - Send offer button
  - Activity log

---

## 🔄 **JOB ORCHESTRATION & SCHEDULING**

### **Automation Runner** ([runAutomation.js](backend/vendors/runAutomation.js))

```javascript
// Environment configuration:
JOBS=privy,home_valuations,agent_offers,amv_daemon
RUN_INTERVAL_MS=180000  // 3 minutes
RUN_IMMEDIATELY=true

// Scheduler logic:
async function runAutomation() {
  // All jobs run in parallel via Promise.allSettled()
  const jobs = parseSelectedJobs(process.env.JOBS);

  const tasks = [];

  if (jobs.has('privy')) {
    tasks.push(runPrivyJob());  // Scrape new listings
  }

  if (jobs.has('home_valuations')) {
    tasks.push(runHomeValuations());  // BofA, Chase, Redfin AVM
  }

  if (jobs.has('agent_offers')) {
    tasks.push(runAgentOffers());  // Send emails
  }

  if (jobs.has('amv_daemon')) {
    tasks.push(runAmvDaemon());  // Continuous AMV recalculation
  }

  // Wait for all to complete (doesn't stop on errors)
  await Promise.allSettled(tasks);

  // Schedule next run after 3 minutes
  setTimeout(runAutomation, RUN_INTERVAL_MS);
}
```

### **Job Configuration Matrix**

| Job Name | Description | Typical Runtime | Concurrency |
|----------|-------------|-----------------|-------------|
| **privy** | Scrape Privy.pro listings | 5-15 min | 1-5 states |
| **bofa** | Bank of America valuations | 10-30 min | 10-12 addresses |
| **chase** | Chase valuations | 5-10 min | 5-8 addresses |
| **home_valuations** | AMV calculation only (no scraping) | 1-2 min | 16 concurrent |
| **current_listings** | Homes.com/Realtor agent scraping | 10-20 min | 6 concurrent |
| **agent_offers** | Send offer emails | 2-5 min | Sequential |
| **amv_daemon** | Continuous AMV updates | Continuous | 500/batch |
| **redfin** | Redfin listing scraper | 10-15 min | 1 city at a time |

---

## 🔒 **AUTHENTICATION & SECURITY**

### **User Authentication** ([routes/auth.js](backend/routes/auth.js))

```javascript
// Registration
POST /api/auth/register
{
  email: "user@example.com",
  password: "SecurePassword123",
  name: "John Doe"
}
→ Hashes password with bcrypt
→ Stores in User collection
→ Returns JWT token

// Login
POST /api/auth/login
{
  email: "user@example.com",
  password: "SecurePassword123"
}
→ Validates credentials
→ Generates JWT token (expires in 30 days)
→ Returns: { token, userId, email, isAdmin }

// Token verification
GET /api/auth/verify
Headers: { Authorization: "Bearer <token>" }
→ Validates JWT
→ Returns user info if valid
```

### **JWT Token Structure**

```javascript
// Token payload:
{
  userId: "507f1f77bcf86cd799439011",
  email: "user@example.com",
  isAdmin: false,
  iat: 1638360000,  // Issued at
  exp: 1641038400   // Expires at (30 days)
}

// Signed with: JWT_SECRET from .env
```

### **Authorization Middleware** ([middleware/authMiddleware.js](backend/middleware/authMiddleware.js))

```javascript
// Protect routes
router.get('/properties', requireAuth, async (req, res) => {
  // req.user is populated by requireAuth middleware
  // Contains: { userId, email, isAdmin, states }
});

// State-based access control
router.get('/properties', scopeByState(), async (req, res) => {
  // req.stateFilter is set based on user's allowed states
  // Admin: sees all states
  // User: sees only assigned states (e.g., ["CA", "FL"])
});
```

---

## 🗄️ **DATABASE SCHEMA**

### **Properties Collection** (Main data)

```javascript
{
  _id: ObjectId("..."),
  prop_id: "prop_12345",  // Unique stable ID

  // Address (normalized)
  fullAddress: "123 Main ST, Pittsburgh, PA, 15213",
  fullAddress_ci: "123 main st, pittsburgh, pa, 15213",  // For deduplication
  address: "123 Main ST",
  city: "Pittsburgh",
  state: "PA",
  zip: "15213",

  // Pricing
  price: 100000,  // Listing price

  // Property details
  details: {
    beds: 3,
    baths: 2,
    sqft: 1500,
    built: 1950
  },

  // Valuations (from vendors)
  bofa_value: 200000,
  chase_value: 195000,
  redfin_avm_value: 220000,

  // Calculated fields
  amv: 210000,  // (bofa + redfin_avm) / 2
  deal: true,   // price <= amv * 0.50
  lp80: 80000,  // price * 0.80
  amv40: 84000, // amv * 0.40
  amv30: 63000, // amv * 0.30

  // Agent contact (dual format for compatibility)
  agentName: "John Smith",
  agent: "John Smith",  // synced
  agentPhone: "(412) 555-1234",
  agent_phone: "(412) 555-1234",  // synced
  agentEmail: "john@remax.com",
  agent_email: "john@remax.com",  // synced
  agentCompany: "RE/MAX",

  // Offer tracking
  offerStatus: {
    lastSentAt: ISODate("2024-12-02T10:30:00Z"),
    lastResult: "sent",
    offerAmount: 80000
  },

  // Metadata
  images: ["url1.jpg", "url2.jpg"],
  notes: ["Note 1", "Note 2"],
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

**Indexes:**
- `fullAddress_ci` (unique) - Deduplication
- `prop_id` (unique) - Stable reference
- `{ deal: 1, state: 1 }` - Fast deal queries
- `{ createdAt: -1 }` - Recent properties first

### **rawProperty Collection** (Temporary staging)

```javascript
{
  _id: ObjectId("..."),
  fullAddress: "123 Main Street, Pittsburgh, PA 15213-5423",
  address: "123 Main Street",
  city: "Pittsburgh",
  state: "PA",
  zip: "15213-5423",
  price: 100000,
  details: { beds: 3, baths: 2, sqft: 1500 },
  status: "scraped",  // scraped | valued | error | not_found
  scrapedAt: ISODate("...")
}
```

**Lifecycle:**
1. Scraper creates record with `status: "scraped"`
2. Valuation jobs update with `bofa_value`, `chase_value`
3. Once processed, data moves to `Property` collection
4. Raw entry marked as `status: "archived"`

### **User Collection**

```javascript
{
  _id: ObjectId("..."),
  email: "user@example.com",
  password: "$2b$10$..." // bcrypt hash,
  name: "John Doe",
  role: "user",  // "admin" | "user"
  isAdmin: false,
  states: ["CA", "FL"],  // Allowed states (null = all for admins)
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

---

## 🚀 **DEPLOYMENT ARCHITECTURE**

### **Render.com Configuration** ([render.yaml](render.yaml))

```yaml
services:
  # Service 1: API Server
  - type: web
    name: deal-finder-api
    env: docker
    dockerfilePath: ./Dockerfile
    dockerContext: ./backend
    envVars:
      - key: AUTOMATION_WORKER
        value: "0"  # Disable automation in API service
      - key: PORT
        value: "3015"
    healthCheckPath: /healthz

  # Service 2: Background Worker
  - type: worker
    name: deal-finder-worker
    env: docker
    dockerfilePath: ./Dockerfile
    dockerContext: ./backend
    envVars:
      - key: AUTOMATION_WORKER
        value: "1"  # Enable automation
      - key: RUN_IMMEDIATELY
        value: "true"
      - key: JOBS
        value: "privy,home_valuations,agent_offers"
```

**Why Two Services?**
- **API Server** - Handles HTTP requests, serves frontend
- **Worker Process** - Runs automation jobs in background
- **Separation** - Prevents automation from blocking API responses
- **Scalability** - Can scale API and workers independently

---

## 🔧 **ADVANCED FEATURES**

### **1. Proxy Management** ([services/proxyManager.js](backend/services/proxyManager.js))

**Why Needed?**
- Web scrapers get blocked after too many requests
- Residential proxies rotate IP addresses
- Appears as normal traffic from different users

```javascript
// Proxy pool configuration
const PAID_PROXIES = [
  'gate.decodo.com:10011:user-xxx:password',
  'gate.decodo.com:10012:user-xxx:password',
  // ... 10-20 proxies
];

// Proxy features:
- Health checking (test before use)
- Automatic rotation on failure
- Per-service isolation (BofA gets dedicated proxies)
- Cooldown on failures (10 min timeout)
- Session persistence (same proxy for login → scrape)
```

### **2. Browser Automation** ([utils/browser.js](backend/utils/browser.js))

```javascript
// Shared Chrome instance for efficiency
const browser = await initSharedBrowser({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ],
  userDataDir: '/path/to/profile'  // Persistent cookies/session
});

// Features:
- Stealth mode (evades bot detection)
- Ad blocker (faster page loads)
- Request interception (block images/media)
- User agent randomization
```

### **3. Concurrency Control**

```javascript
// Global concurrency limiter
const limit = pLimit(12);  // Max 12 concurrent operations

const tasks = properties.map(prop =>
  limit(() => scrapeBofaValue(prop))
);

await Promise.allSettled(tasks);

// Per-vendor concurrency:
- BofA: 10-12 (proxy-limited)
- Chase: 5-8 (more aggressive blocking)
- Homes.com: 6 (avoid detection)
- Privy: 1-5 (serialize login, parallel scrape)
```

### **4. Error Handling & Retry Logic**

```javascript
// Exponential backoff for transient errors
async function scrapeBofaValue(property, attempt = 1) {
  try {
    return await scrape(property);
  } catch (error) {
    if (isNetworkOrProxyError(error) && attempt < 3) {
      // Rotate proxy and retry
      const newProxy = getNextProxy();
      await wait(1000 * attempt);  // 1s, 2s, 3s
      return scrapeBofaValue(property, attempt + 1);
    }
    throw error;  // Give up after 3 attempts
  }
}
```

---

## 📈 **PERFORMANCE METRICS**

### **Typical Processing Times**

| Operation | Properties | Time | Notes |
|-----------|-----------|------|-------|
| Privy scrape | 50-200 | 5-10 min | Depends on filters |
| BofA valuations | 100 | 15-20 min | 10 concurrent |
| Chase valuations | 100 | 10-15 min | 8 concurrent |
| Agent enrichment | 50 | 8-12 min | 6 concurrent |
| AMV calculation | 1000 | 30-60 sec | No external calls |
| Email sending | 50 | 2-3 min | Sequential |

### **Resource Usage**

```
Memory: 1-2 GB (with Chrome instances)
CPU: 2-4 cores (parallel scraping)
Disk: 500 MB (logs, screenshots, profile)
Network: 10-50 Mbps (during scraping)
Database: 100-500 MB (10k-50k properties)
```

---

## 🐛 **TROUBLESHOOTING GUIDE**

### **Common Issues**

#### **1. BofA Scraper Failing**
```
Error: "No valuation found" or "Timeout"

Solutions:
- Check proxy health: Run proxy warmup
- Reduce concurrency: BOFA_MAX_CONCURRENCY=5
- Increase timeout: BOFA_RESULT_TIMEOUT_MS=60000
- Check debug screenshots: /tmp/bofa_debug/
```

#### **2. Privy Login Fails**
```
Error: "Login failed" or "OTP required"

Solutions:
- Check credentials in .env
- Disable headless mode: PRIVY_HEADLESS=false
- Check session file: ~/.cache/privy/privy_session.json
- Manually login once to save session
```

#### **3. Database Connection Errors**
```
Error: "MongoError: connection refused"

Solutions:
- Check MongoDB is running: net start MongoDB
- Verify connection string in .env
- Test connection: node test-db-connection.js
```

#### **4. Proxy Issues**
```
Error: "ERR_TUNNEL_CONNECTION_FAILED"

Solutions:
- Test proxy manually: curl --proxy http://proxy:port URL
- Check proxy credentials in .env
- Verify proxy IP allowlist on Decodo dashboard
- Switch to direct mode temporarily: BOFA_USE_PAID=0
```

---

## 🎯 **KEY BUSINESS LOGIC**

### **What Makes a "Deal"?**

```javascript
// Criteria (all must be true):
1. Listing Price ≤ 50% of AMV
   → Example: $100k listing, $210k AMV = 47.6% ✅

2. Minimum 3 bedrooms
   → Ensures property is substantial, not studio/1BR

3. AMV ≥ $150,000
   → Filters out low-value properties

// Why 50% rule?
- Allows for renovation costs (10-15%)
- Provides profit margin for flip (20-30%)
- Covers holding costs, closing fees (5-10%)
- Example math:
  - Buy: $100k (50% of $200k AMV)
  - Renovate: $30k
  - Total: $130k
  - Sell: $200k (at AMV)
  - Profit: $70k (35% return)
```

### **Offer Strategy**

```javascript
// Calculated offer amounts:

LP80 = listingPrice × 0.80
  → Shows seller we're serious (80% of ask)
  → Accounts for negotiation room

AMV40 = amv × 0.40
  → Conservative based on market value
  → Protects against overvaluation

AMV30 = amv × 0.30
  → Ultra-conservative fallback
  → For highly uncertain properties

// Final offer logic:
suggestedOffer = min(LP80, AMV40)
  → Lowest of the two = safest offer
  → Example: min($80k, $84k) = $80k
```

---

## 🔮 **FUTURE ENHANCEMENTS**

### **Planned Features:**

1. **Machine Learning AMV**
   - Train on historical sold prices
   - Improve accuracy over vendor APIs
   - Predict deal probability

2. **Property Analytics Dashboard**
   - Profit calculator
   - Market trend charts
   - ROI projections

3. **Multi-vendor Agent Enrichment**
   - Zillow, Trulia, Realtor.com
   - LinkedIn integration
   - Email validation service

4. **SMS Outreach**
   - Text agents directly
   - Higher response rates
   - Twilio integration

5. **Mobile App**
   - Push notifications for new deals
   - Quick approve/reject offers
   - Map view of properties

---

## 📚 **ADDITIONAL RESOURCES**

### **Key Documentation Files:**

- [LOCAL-DATABASE-SETUP.md](LOCAL-DATABASE-SETUP.md) - Database configuration
- [README.md](README.md) - Original project documentation
- [render.yaml](render.yaml) - Deployment configuration
- [backend/models/Property.js](backend/models/Property.js) - Database schema

### **Important Environment Variables:**

```env
# Core
MONGO_URI=mongodb://localhost:27017/deal_finder
JWT_SECRET=your-secret-key

# Privy
PRIVY_EMAIL=your-email@example.com
PRIVY_PASSWORD=your-password
PRIVY_STATES=ALL  # or CA,FL,TX

# Proxies
PAID_PROXIES=host:port:user:pass,host:port:user:pass

# Email
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key

# Jobs
JOBS=privy,home_valuations,agent_offers
RUN_INTERVAL_MS=180000  # 3 minutes
```

---

## 🎓 **SUMMARY**

**Deal-Finder-1 automates the entire real estate investment workflow:**

1. **Discovery** - Scrapes 1000s of listings from multiple sources
2. **Valuation** - Cross-validates prices with 3+ vendor APIs
3. **Analysis** - Identifies deals using 50% rule + quality filters
4. **Outreach** - Finds agents and sends personalized offers
5. **Management** - Dashboard for tracking, filtering, and analytics

**Key Innovation:** Cross-vendor validation prevents false positives (bad deals that only one vendor thinks are good).

**Result:** A stream of high-probability real estate deals requiring minimal manual work.

---

**System Status:** ✅ Fully Operational
**Database:** Local MongoDB @ `localhost:27017`
**API:** Running on `http://localhost:3015`
**Frontend:** Available at `http://localhost:3000`

