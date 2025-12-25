
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const waitForViews = async (page) => {
  // Return all matching containers currently mounted
  return await page.$$('.view-container, .grid-view-container, .map-view-container');
};

const getClustersWithKeys = async (page) => {
  // Get cluster info with coordinates - don't store handles since they can become stale
  const clusterData = await page.evaluate(() => {
    const clusters = [];
    const elements = document.querySelectorAll('.cluster.cluster-deal');
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Only include visible clusters (within viewport)
      if (rect.width > 0 && rect.height > 0 && rect.x > 0 && rect.y > 0) {
        clusters.push({
          key: `${el.textContent?.trim()}@${Math.round(rect.x)}x${Math.round(rect.y)}`,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          count: parseInt(el.textContent?.trim() || '0', 10)
        });
      }
    }
    // Sort by count descending (larger clusters first)
    return clusters.sort((a, b) => b.count - a.count);
  });

  return clusterData;
};

// Max time to wait for clusters/properties before moving on (30 seconds)
const MAX_WAIT_TIME_MS = 30000;
// Max attempts to click clusters before giving up
const MAX_CLICK_ATTEMPTS = 10;

/**
 * Simple cluster crawler - waits for clusters, clicks them, scrapes properties
 * If nothing loads after timeout, moves to next city
 */
const clickClustersRecursively = async (
  page,
  browser,
  scrapeProperties,
  visited = new Set(),
  zoomLevel = 0,
  maxZoom = 21,
  minZoom = 3
) => {
  const startTime = Date.now();
  let clickAttempts = 0;

  // Wait and retry loop - give the page time to load
  while (Date.now() - startTime < MAX_WAIT_TIME_MS && clickAttempts < MAX_CLICK_ATTEMPTS) {
    // First check if view containers are already visible (properties list showing)
    const viewsVisible = await waitForViews(page);
    if (viewsVisible.length > 0) {
      console.log('🎉 View containers loaded - scraping properties');
      await scrapeProperties(page, browser);
      return true; // Done with this city
    }

    // Get visible clusters
    const clusters = await getClustersWithKeys(page);
    const unvisited = clusters.filter(c => !visited.has(c.key));

    if (unvisited.length === 0 && clusters.length === 0) {
      // No clusters at all - wait a bit and check again
      console.log(`⏳ No clusters yet, waiting... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      await wait(2000);
      continue;
    }

    if (unvisited.length === 0) {
      // We've clicked all visible clusters but no view loaded
      console.log(`⏳ All ${clusters.length} clusters clicked, waiting for view... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      await wait(2000);
      continue;
    }

    // Click the first unvisited cluster
    const cluster = unvisited[0];
    const { key, x, y, count } = cluster;
    visited.add(key);
    clickAttempts++;

    try {
      console.log(`✅ Clicking cluster #${clickAttempts} with ${count} properties at (${x}, ${y})`);
      await page.mouse.move(x, y);
      await wait(300);
      await page.mouse.click(x, y);
      await wait(2000); // Wait for view to load

      const viewsAfterClick = await waitForViews(page);
      if (viewsAfterClick.length > 0) {
        console.log('🎯 Properties view loaded - scraping');
        await scrapeProperties(page, browser);
        return true; // Done with this city
      }
    } catch (err) {
      console.warn(`⚠️ Could not click cluster: ${err.message}`);
    }
  }

  // Timeout reached - move on to next city
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`📭 Timeout after ${elapsed}s and ${clickAttempts} clicks - moving to next city`);
  return false;
};

export { clickClustersRecursively };
