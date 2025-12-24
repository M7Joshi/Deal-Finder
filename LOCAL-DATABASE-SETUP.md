# Local MongoDB Database Setup - Complete ✅

Your Deal-Finder application is now successfully connected to your **local MongoDB database** running on your Windows machine.

---

## ✅ What Was Changed

### 1. **Database Configuration** ([backend/.env:30-34](backend/.env#L30-L34))

**Before:**
```env
MONGO_URI=mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority
```

**After:**
```env
# Remote MongoDB Atlas (commented out - backup available)
# MONGO_URI=mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority

# Local MongoDB (active)
MONGO_URI=mongodb://localhost:27017/deal_finder
```

### 2. **Database Connection Verified**

- ✅ MongoDB service is **running** on Windows
- ✅ Database name: `deal_finder`
- ✅ Connection successful via Mongoose
- ✅ Backend API server connected successfully

---

## 📊 Current Database State

Your local database already contains:

| Collection | Count | Description |
|------------|-------|-------------|
| **properties** | 6 | Main property records (6 deals with agent emails) |
| **addresses** | 79 | Canonical address lookups |
| **users** | 1 | User accounts |
| **rawproperties** | 0 | Temporary scrape staging |
| **agentsends** | 0 | Email tracking records |
| **otp_state** | 0 | 2FA state management |

**Property Breakdown:**
- ✅ 6 deals identified
- ✅ All 6 have agent email addresses
- ✅ States: CA, FL, TX

---

## 🚀 How to Start the Application

### **Option 1: Using the Helper Script (Recommended)**

```bash
cd "C:\Users\91812\Desktop\Demo-3 Mioym\deal-finder-1\backend"
node start-api.js
```

### **Option 2: Using NPM Scripts**

```bash
cd "C:\Users\91812\Desktop\Demo-3 Mioym\deal-finder-1\backend"

# API server only (no automation)
npm run api

# Or start both API + Worker
npm run start
```

### **Option 3: Using Batch File**

Double-click: `backend/test-server.bat`

---

## 🔍 Testing the Connection

### **Test Scripts Created:**

1. **test-db-connection.js** - Verify MongoDB connection
   ```bash
   node test-db-connection.js
   ```

2. **check-db-data.js** - View database contents
   ```bash
   node check-db-data.js
   ```

3. **start-api.js** - Start API server (no workers)
   ```bash
   node start-api.js
   ```

### **API Endpoints:**

Once the server is running on `http://localhost:3015`:

- **Health Check:** `http://localhost:3015/healthz`
- **Properties API:** `http://localhost:3015/api/properties/table` (requires auth)
- **Dashboard:** `http://localhost:3015/api/dashboard/summary`

---

## 📡 Frontend Configuration

Your frontend (React app in `/site`) should connect to:

```
API_BASE_URL=http://localhost:3015
```

Check [site/src/api.tsx](site/src/api.tsx) to ensure it's pointing to the correct backend URL.

---

## 🔄 Switching Between Local and Cloud Database

### **To use Local MongoDB (Current):**
```env
MONGO_URI=mongodb://localhost:27017/deal_finder
```

### **To use MongoDB Atlas (Cloud):**
```env
MONGO_URI=mongodb+srv://mioymapp_db_user:sUdtApk9gnylGAV7@cluster0.ldjcoor.mongodb.net/deal_finder?retryWrites=true&w=majority
```

Simply uncomment/comment the appropriate line in `.env` and restart the server.

---

## 🛠️ Troubleshooting

### **MongoDB Service Not Running**

If you see connection errors:
```bash
# Check service status
net start | findstr -i mongo

# Start MongoDB service
net start MongoDB
```

### **Port 3015 Already in Use**

```bash
# Find process using port 3015
netstat -ano | findstr ":3015"

# Kill the process (replace PID with actual number)
taskkill //F //PID <PID>
```

### **Database Empty After Switch**

This is normal! Your local database is separate from the cloud database. Run the Privy scraper to populate it:

```bash
npm run worker:privy
```

---

## 📈 Next Steps

Now that your local database is connected:

1. **Start the Frontend:**
   ```bash
   cd ../site
   npm start
   ```

2. **Run Automation Jobs** (optional):
   ```bash
   # Scrape Privy for new properties
   npm run worker:privy

   # Run valuations (BofA, Chase, Redfin)
   npm run worker:bofa

   # Send agent offers
   npm run all
   ```

3. **Access the Dashboard:**
   - Open `http://localhost:3000` (frontend)
   - Login with admin credentials from `.env`

---

## 🔐 Default Admin Credentials

From `.env`:
```
Email: mcox@mioym.com
Password: Mioym@2900
```

---

## 📊 Data Flow Reminder

```
Privy/Redfin → rawProperty → Property (normalized)
                                  ↓
                            BofA/Chase/Redfin AVM
                                  ↓
                            AMV Calculation
                                  ↓
                            Deal Detection (LP ≤ AMV × 0.5)
                                  ↓
                            Homes.com Agent Scraper
                                  ↓
                            Automated Email Offers
                                  ↓
                            Frontend Dashboard
```

---

## ✅ Success Indicators

You'll know everything is working when you see:

```log
✅ MongoDB connected successfully {"db":"deal_finder"}
✅ Deal Finder API server running {"port":3015}
ℹ️  Base API endpoint {"url":"http://localhost:3015/api"}
```

**Current Status: ✅ ALL SYSTEMS OPERATIONAL**

---

## 📞 Need Help?

- Check logs in the terminal where you started the server
- Run `node check-db-data.js` to verify database contents
- Ensure MongoDB service is running: `net start MongoDB`

---

**Created:** 2025-12-02
**Status:** Local MongoDB Connection Active ✅
**Database:** `deal_finder` @ `localhost:27017`
