
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

const zoomMap = async (page, direction = "in") => {
  const deltaY = direction === "in" ? -300 : 300;
  await page.mouse.move(400, 300); // Center of map
  await page.mouse.wheel({ deltaY });
  console.log(direction === "in" ? "🔍 Zoomed In" : "🔎 Zoomed Out");
  await wait(1500); // Allow map to update
};

const getCurrentZoom = async (page) => {
  return await page.evaluate(() => {
    return window.map?.getZoom?.() ?? null;
  });
};

// Track iterations to prevent infinite loops
let __clusterIterations = 0;
const MAX_CLUSTER_ITERATIONS = 50; // Hard limit on zoom cycles

const clickClustersRecursively = async (
  page,
  browser,
  scrapeProperties,
  visited = new Set(),
  zoomLevel = 0,
  maxZoom = 21,
  minZoom = 3
) => {
  // GUARD: Prevent infinite zoom loops
  __clusterIterations++;
  if (__clusterIterations > MAX_CLUSTER_ITERATIONS) {
    console.log('🛑 Max cluster iterations reached - stopping to prevent infinite loop');
    __clusterIterations = 0; // Reset for next city
    return false;
  }

  const viewsVisible = await waitForViews(page);

  if (viewsVisible.length > 0) {
    console.log('🎉 View containers loaded!');
    await scrapeProperties(page, browser);
    // Reset iteration counter after successful scrape - we're done with this view
    __clusterIterations = 0;
    return true; // Return immediately after scraping - don't zoom and recurse
  }

  const clusters = await getClustersWithKeys(page);
  const unvisited = clusters.filter(c => !visited.has(c.key));

  if (unvisited.length === 0) {
    if (zoomLevel < maxZoom) {
      await zoomMap(page, "in");
      return await clickClustersRecursively(page, browser, scrapeProperties, visited, zoomLevel + 1, maxZoom, minZoom);
    } else if (zoomLevel > minZoom) {
      await zoomMap(page, "out");
      return await clickClustersRecursively(page, browser, scrapeProperties, visited, zoomLevel - 1, maxZoom, minZoom);
    } else {
      console.log("🛑 No more zoom levels or clusters to process.");
      __clusterIterations = 0; // Reset for next city
      return false;
    }
  }

  console.log(`📍 Found ${unvisited.length} unvisited cluster(s) at zoom level ${zoomLevel}`);
  for (const cluster of unvisited) {
    const { key, x, y } = cluster;
    try {
      // Use coordinates-based clicking to avoid stale element handles
      await page.mouse.move(x, y);
      await wait(100); // Small delay for hover effects
      await page.mouse.click(x, y);
      visited.add(key);
      console.log(`✅ Clicked cluster ${key} at (${x}, ${y})`);
      await wait(1000);
      const viewsAfterClick = await waitForViews(page);
      if (viewsAfterClick.length > 0) {
        console.log("🎯 Target views loaded after clicking cluster!");
        await scrapeProperties(page);
        __clusterIterations = 0; // Reset after successful scrape
        return true; // Done with this cluster - return success
      }
    } catch (err) {
      console.warn(`⚠️ Could not click cluster ${key}: ${err.message}`);
    }
  }

  // Recurse again at this zoom level in case new clusters loaded
  return await clickClustersRecursively(page, browser, scrapeProperties, visited, zoomLevel, maxZoom, minZoom);
};

export { clickClustersRecursively };
