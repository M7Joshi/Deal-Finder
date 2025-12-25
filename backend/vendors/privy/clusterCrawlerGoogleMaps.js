
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

/**
 * Simple cluster crawler - no zoom, just click visible clusters once
 * If no clusters or views found, move on to next city
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
  // First check if view containers are already visible (properties list showing)
  const viewsVisible = await waitForViews(page);
  if (viewsVisible.length > 0) {
    console.log('🎉 View containers already loaded - scraping properties');
    await scrapeProperties(page, browser);
    return true; // Done with this city
  }

  // Get visible clusters
  const clusters = await getClustersWithKeys(page);

  if (clusters.length === 0) {
    console.log('📭 No clusters found for this city - moving to next city');
    return false; // No properties in this city, move on
  }

  console.log(`📍 Found ${clusters.length} cluster(s) - clicking to load properties`);

  // Try clicking clusters until we get a view with properties
  for (const cluster of clusters) {
    const { key, x, y, count } = cluster;

    if (visited.has(key)) continue;
    visited.add(key);

    try {
      console.log(`✅ Clicking cluster with ${count} properties at (${x}, ${y})`);
      await page.mouse.move(x, y);
      await wait(200);
      await page.mouse.click(x, y);
      await wait(1500); // Wait for view to load

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

  // If we clicked all clusters but no view loaded, move on
  console.log('📭 Clicked all clusters but no properties view loaded - moving to next city');
  return false;
};

export { clickClustersRecursively };
