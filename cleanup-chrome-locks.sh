#!/bin/bash
# Clean up stale Chrome/Puppeteer lock files

echo "Cleaning up Chrome lock files..."

# Remove shared browser lock files
rm -f /tmp/deal-finder-shared/chrome.launch.lock
rm -f /tmp/deal-finder-shared/chrome.ws.json

# Kill any orphaned Chrome processes (optional - uncomment if needed)
# pkill -f "chrome.*--remote-debugging-port"

echo "✓ Chrome lock files cleaned up"
echo ""
echo "You can now restart the backend or try scraping again."
