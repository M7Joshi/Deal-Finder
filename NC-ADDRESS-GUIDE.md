# 🏠 How to Fetch 10 NC Addresses from Privy

## ✅ Your System is Ready!

- **Backend**: Running on `http://localhost:3015` ✅
- **Frontend**: Running on `http://localhost:3000` ✅
- **Privy Credentials**: Configured ✅
- **Paid Proxies**: Available (10 proxies) ✅

---

## 🚀 Step-by-Step Instructions

### Step 1: Open Your Browser

Open your web browser and go to:
```
http://localhost:3000
```

### Step 2: Login

Use these credentials:
- **Email**: `mcox@mioym.com`
- **Password**: `Mioym@2900`

Click **"Login"**

### Step 3: Navigate to Address Validation Page

Once logged in, look for the sidebar menu and click:
- **"Address Validation"** or **"Addresses"**

### Step 4: Switch to LIVE Mode

On the Address Validation page:

1. Look for two buttons at the top:
   - **Gray button**: "From Database"
   - **Green button**: "🔴 LIVE from Privy.pro"

2. Click the **Green "LIVE from Privy.pro"** button

3. You should see a message:
   ```
   🔴 LIVE MODE: Fetching addresses directly from Privy.pro official website.
   No database, no CSV - just real-time data to verify scraper is working!
   ```

### Step 5: Click "Scrape Now"

1. Click the **"Scrape Now"** button

2. The system will:
   - Launch a browser (Puppeteer)
   - Log into Privy.pro
   - **IMPORTANT**: Privy will send a 2FA code to your email

### Step 6: Enter OTP Code

1. **Check your email**: `Kimberly@mioym.com`
2. Look for an email from Privy with a verification code
3. The page should show an **OTP Input Box**
4. Enter the 6-digit code from your email
5. Click **"Submit"** or **"Verify"**

### Step 7: Get Your Addresses!

Once OTP is verified:
- The scraper will fetch properties from Charlotte, NC
- Addresses will appear on the page in a table
- You'll see at least 10 addresses with:
  - Full Address
  - Price
  - Beds
  - Baths
  - Square Feet

---

## 🎯 Alternative: Use API Directly

If you prefer using the API instead of the web UI:

### Make API Call:

```bash
# First, get your auth token by logging in:
curl -X POST http://localhost:3015/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mcox@mioym.com","password":"Mioym@2900"}'

# This returns: {"token": "YOUR_TOKEN_HERE", ...}

# Then use the token to call live scraping:
curl -X GET "http://localhost:3015/api/live-scrape/privy?state=NC&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Note**: The API call will still require OTP, which needs to be entered via the web UI.

---

## 📋 What You'll See

Once scraping completes, you'll see a table like this:

| # | Address | Price | Beds | Baths | SqFt |
|---|---------|-------|------|-------|------|
| 1 | 123 Main St, Charlotte, NC 28202 | $185,000 | 3 | 2 | 1,450 |
| 2 | 456 Oak Ave, Charlotte, NC 28203 | $210,000 | 4 | 2.5 | 1,800 |
| 3 | 789 Elm Dr, Raleigh, NC 27601 | $195,000 | 3 | 2 | 1,600 |
| ... | ... | ... | ... | ... | ... |

---

## 🔧 Troubleshooting

### Problem: "OTP not appearing"

**Solution**: Check if there's an **OTP** or **Control Panel** link in the sidebar. Click it to see the OTP input field.

### Problem: "No addresses showing"

**Solutions**:
1. Make sure you clicked the **GREEN "LIVE from Privy.pro"** button (not the gray one)
2. Check browser console for errors (F12 → Console tab)
3. Verify backend is running: `curl http://localhost:3015/healthz`

### Problem: "Login failed"

**Solutions**:
1. Double-check credentials:
   - Email: `mcox@mioym.com`
   - Password: `Mioym@2900`
2. Check backend logs for errors

### Problem: "Privy session expired"

**Solution**:
1. The OTP prompt will appear automatically
2. Check email: `Kimberly@mioym.com` for the code
3. Enter the 6-digit code

---

## 🎉 Success!

Once you see the addresses appear:
- ✅ You've successfully fetched LIVE data from Privy.pro
- ✅ No database involved
- ✅ Pure real-time scraping
- ✅ Using your paid proxies (if enabled)

---

## 💡 Tips

1. **First Time OTP**: You'll need to enter OTP on first login. After that, the session should stay active for ~48 hours.

2. **Enable Proxies** (Optional):
   - Edit `backend/.env`
   - Change `PRIVY_PROXY_MODE=off` to `PRIVY_PROXY_MODE=auto`
   - Restart backend server
   - This uses your paid Decodo proxies for better scraping

3. **Get More Addresses**:
   - Change `limit=10` to `limit=50` in the URL or API call
   - The scraper can fetch hundreds of addresses

4. **Different Cities**:
   - The system is currently set to Charlotte, NC
   - You can modify the URL in the code to target:
     - Raleigh, NC
     - Durham, NC
     - Greensboro, NC
     - etc.

---

## 📞 Need Help?

If you get stuck:
1. Check the browser console (F12)
2. Check backend logs in terminal
3. Verify both servers are running:
   - Backend: `curl http://localhost:3015/healthz`
   - Frontend: `http://localhost:3000` in browser

---

**Created**: December 3, 2025
**Status**: ✅ Ready to Use
**Your Next Step**: Open `http://localhost:3000` and login!
