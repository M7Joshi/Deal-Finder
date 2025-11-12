# Real Estate Investment Dashboard

A modern web application for automating real estate property research across multiple states (Nevada, California, Texas) using the Privy API.

## Features

- **Multi-State Automation**: Run property searches for NV, CA, and TX
- **Real-time Dashboard**: Live status updates and results visualization
- **Property Data**: Comprehensive property information including prices, beds/baths, agents, etc.
- **Results Export**: Automated JSON export of property data
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS

## Architecture

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express API
- **Automation**: Puppeteer-based scripts for each state
- **Data**: JSON file-based storage for results

## Quick Start

### 1. Install Dependencies

```bash
# Backend dependencies
cd backend
npm install

# Frontend dependencies  
cd ../frontend
npm install
```

### 2. Start the Backend API

```bash
cd backend
npm run dev
```

The API will start on `http://localhost:3001`

### 3. Start the Frontend

```bash
cd frontend
npm run dev
```

The dashboard will be available at `http://localhost:3000`

## Usage

1. **Select States**: Choose which states to run automation for (NV, CA, TX)
2. **Run Automation**: Click "Run All Selected" or run individual state automations
3. **View Results**: Real-time status updates and property data display
4. **Export Data**: Results are automatically saved to JSON files

## API Endpoints

- `POST /api/run-automation` - Execute automation for a specific state
- `GET /api/results/:state` - Retrieve results for a state
- `GET /api/status` - Check API status and available states

## File Structure

```
real-estate/
├── frontend/           # React dashboard
│   ├── src/
│   │   ├── App.jsx    # Main dashboard component
│   │   └── main.jsx   # React entry point
│   └── package.json
├── backend/           # Express API server
│   ├── server.js     # API routes and automation execution
│   └── package.json
├── test_NV.js        # Nevada automation script
├── test_CA.js        # California automation script  
├── test_TX.js        # Texas automation script
└── README.md
```

## State Scripts

Each state has its own dedicated script:
- `test_NV.js` - Nevada property automation
- `test_CA.js` - California property automation  
- `test_TX.js` - Texas property automation

Scripts output results to `test_output_{STATE}_extracted.json` files.

## Requirements

- Node.js 16+
- Chrome browser (for Puppeteer)
- Active Privy account session (run privy_login.js first)

## Development

The application uses:
- **Vite** for fast development builds
- **Tailwind CSS** for styling
- **Lucide React** for icons
- **Express.js** for API server
- **Puppeteer** for browser automation



TODO:

// north carolina (current)
// nevada (start)
// redfin bot
// movoto bot
// link to a google search with the agent 
// link to property on redfin or home 
// normalize and format all code
// set automation order 
// create routes to start and stop automation 
// update frontend to deal with automation states
// capture emails if present and fix send email 
// update user on front end to add notes a default message
// add to notes when message is sent: date, time, platform
// show table info in property modal 
//# Deal-Finder
