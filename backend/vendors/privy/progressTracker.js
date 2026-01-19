/**
 * Privy Progress Tracker (MongoDB-based)
 *
 * Tracks which state and city was last processed, so scraping can resume
 * from where it left off after restarts. Uses MongoDB for persistence
 * across deployments (file-based storage gets wiped on Render restarts).
 */

import ScraperProgress from '../../models/ScraperProgress.js';

const SCRAPER_NAME = 'privy';

// Filter cycle configurations
// Each cycle uses different project_type and spread_type
export const FILTER_CYCLES = [
  { index: 0, source: 'privy',       project_type: 'buy_hold', spread_type: 'umv' },
  { index: 1, source: 'privy-Tear',  project_type: 'scrape',   spread_type: 'arv' },
  { index: 2, source: 'privy-flip',  project_type: 'flip',     spread_type: 'arv' },
];

// Default progress state
const DEFAULT_PROGRESS = {
  lastState: null,        // Last completed state (e.g., 'AL')
  lastCityIndex: -1,      // Index of last completed city within current state
  currentState: null,     // State currently being processed
  completedStates: [],    // Array of fully completed states
  lastUpdated: null,      // ISO timestamp
  totalCitiesProcessed: 0,
  totalStatesCompleted: 0,
  cycleCount: 0,          // How many full cycles through all states
  filterCycleIndex: 0,    // Which filter config (0=privy, 1=privy-Tear, 2=privy-flip)
};

/**
 * Extract city name from Privy URL
 */
function extractCityFromUrl(url) {
  try {
    const u = new URL(url);
    const searchText = u.searchParams.get('search_text') || '';
    // Decode and clean up: "Albany%2C+NY" -> "Albany, NY"
    return decodeURIComponent(searchText).replace(/\+/g, ' ');
  } catch {
    return url;
  }
}

/**
 * Load progress from MongoDB
 */
export async function loadProgress() {
  try {
    const doc = await ScraperProgress.findOne({ scraper: SCRAPER_NAME }).lean();
    // DEBUG: Log raw document to see what Mongoose returns
    console.log('[PrivyProgress] RAW doc from MongoDB:', {
      filterCycleIndex: doc?.filterCycleIndex,
      completedStates: doc?.completedStates?.length,
      processedCities: doc?.processedCities?.length,
      currentState: doc?.currentState,
    });
    if (doc) {
      // Convert MongoDB doc to our progress format
      const progress = {
        lastState: doc.lastState || null,
        lastCityIndex: doc.currentCityIndex ?? -1,
        currentState: doc.currentState || null,
        completedStates: doc.completedStates || doc.processedCities || [], // Prefer completedStates, fallback to processedCities for migration
        lastUpdated: doc.updatedAt?.toISOString() || null,
        totalCitiesProcessed: doc.totalScraped || 0,
        totalStatesCompleted: doc.currentStateIndex || 0,
        cycleCount: doc.cycleCount || 0,
        filterCycleIndex: doc.filterCycleIndex || 0,
      };
      const currentFilter = FILTER_CYCLES[progress.filterCycleIndex] || FILTER_CYCLES[0];
      console.log('[PrivyProgress] Loaded progress from MongoDB:', {
        currentState: progress.currentState,
        lastCityIndex: progress.lastCityIndex,
        completedStates: progress.completedStates?.length || 0,
        totalCitiesProcessed: progress.totalCitiesProcessed,
        cycleCount: progress.cycleCount,
        filterCycle: currentFilter.source,
      });
      return progress;
    }
  } catch (e) {
    console.warn('[PrivyProgress] Failed to load progress from MongoDB:', e.message);
  }
  console.log('[PrivyProgress] No existing progress found, starting fresh');
  return { ...DEFAULT_PROGRESS };
}

// Synchronous wrapper for compatibility
export function loadProgressSync() {
  // For backward compatibility - return default and let async version update
  console.warn('[PrivyProgress] loadProgressSync called - use loadProgress() async instead');
  return { ...DEFAULT_PROGRESS };
}

/**
 * Save progress to MongoDB
 *
 * IMPORTANT: This function uses ATOMIC UPDATES with $set to only update specific fields.
 * This prevents stale in-memory values from overwriting manually set DB values like filterCycleIndex.
 *
 * Fields that are ALWAYS preserved from DB (never overwritten by in-memory):
 * - filterCycleIndex (only changed by startNewCycle)
 *
 * Fields that are updated from in-memory progress:
 * - currentState, currentCityIndex, completedStates, totalScraped, cycleCount, lastState
 */
export async function saveProgress(progress, options = {}) {
  try {
    // Build update object - only include fields we want to update
    const updateFields = {
      currentState: progress.currentState,
      currentCityIndex: progress.lastCityIndex,
      currentStateIndex: progress.totalStatesCompleted,
      completedStates: progress.completedStates,
      processedCities: progress.completedStates, // Keep for backward compatibility
      totalScraped: progress.totalCitiesProcessed,
      cycleCount: progress.cycleCount,
      lastState: progress.lastState,
      updatedAt: new Date(),
    };

    // Only update filterCycleIndex if explicitly requested (e.g., from startNewCycle)
    if (options.updateFilterCycleIndex) {
      updateFields.filterCycleIndex = progress.filterCycleIndex;
      console.log('[PrivyProgress] Updating filterCycleIndex to:', progress.filterCycleIndex);
    }

    // DEBUG: Log what we're about to save
    console.log('[PrivyProgress] SAVING to MongoDB:', {
      currentState: progress.currentState,
      completedStates: progress.completedStates?.length || 0,
      totalCitiesProcessed: progress.totalCitiesProcessed,
      updatingFilterCycleIndex: options.updateFilterCycleIndex || false,
    });

    const result = await ScraperProgress.findOneAndUpdate(
      { scraper: SCRAPER_NAME },
      { $set: updateFields },
      { upsert: true, new: true }
    );

    // DEBUG: Log what was actually saved
    console.log('[PrivyProgress] SAVED - filterCycleIndex in DB:', result?.filterCycleIndex);
  } catch (e) {
    console.warn('[PrivyProgress] Failed to save progress to MongoDB:', e.message);
  }
}

/**
 * Mark a city as completed
 */
export async function markCityComplete(progress, state, cityIndex, cityUrl) {
  const cityName = extractCityFromUrl(cityUrl);
  progress.lastCityIndex = cityIndex;
  progress.currentState = state;
  progress.totalCitiesProcessed += 1;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Completed city: ${cityName} (${state}) - Index ${cityIndex}`);
  await saveProgress(progress);
  return progress;
}

/**
 * Mark a state as fully completed
 */
export async function markStateComplete(progress, state) {
  if (!progress.completedStates.includes(state)) {
    progress.completedStates.push(state);
    progress.completedStates.sort(); // Keep alphabetical
  }
  progress.lastState = state;
  progress.currentState = null;
  progress.lastCityIndex = -1;
  progress.totalStatesCompleted = progress.completedStates.length;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Completed state: ${state} (${progress.totalStatesCompleted} total states completed)`);
  await saveProgress(progress);
  return progress;
}

/**
 * Start a new filter cycle (all states completed for current filter, move to next filter)
 * When all 3 filter cycles complete, increment cycleCount and start over
 */
export async function startNewCycle(progress) {
  // Move to next filter cycle
  const nextFilterIndex = (progress.filterCycleIndex || 0) + 1;

  if (nextFilterIndex >= FILTER_CYCLES.length) {
    // All filter cycles done, start full new cycle from first filter
    progress.cycleCount += 1;
    progress.filterCycleIndex = 0;
    console.log(`[PrivyProgress] All filter cycles complete! Starting full cycle #${progress.cycleCount} with filter: ${FILTER_CYCLES[0].source}`);
  } else {
    // Move to next filter cycle
    progress.filterCycleIndex = nextFilterIndex;
    const nextFilter = FILTER_CYCLES[nextFilterIndex];
    console.log(`[PrivyProgress] Starting next filter cycle: ${nextFilter.source} (${nextFilter.project_type} + ${nextFilter.spread_type})`);
  }

  // Reset state progress for new filter cycle
  progress.completedStates = [];
  progress.lastState = null;
  progress.currentState = null;
  progress.lastCityIndex = -1;
  progress.lastUpdated = new Date().toISOString();

  // IMPORTANT: Pass updateFilterCycleIndex=true since startNewCycle is the ONLY place that should change it
  await saveProgress(progress, { updateFilterCycleIndex: true });
  return progress;
}

/**
 * Get the next state and cities to process based on progress
 * Returns { state, cities, startIndex } or null if all done
 */
export async function getNextStateToProcess(urlsData, progress) {
  // Get all states sorted alphabetically
  const allStates = Object.keys(urlsData).sort();

  if (!allStates.length) {
    console.warn('[PrivyProgress] No states found in urls data');
    return null;
  }

  // Find states not yet completed in this cycle
  const remainingStates = allStates.filter(s => !progress.completedStates.includes(s));

  if (remainingStates.length === 0) {
    // All states completed - start new cycle
    await startNewCycle(progress);
    const firstState = allStates[0];
    const cities = urlsData[firstState] || [];
    // Sort cities alphabetically by city name
    const sortedCities = [...cities].sort((a, b) => {
      const cityA = extractCityFromUrl(a).toLowerCase();
      const cityB = extractCityFromUrl(b).toLowerCase();
      return cityA.localeCompare(cityB);
    });

    console.log(`[PrivyProgress] New cycle starting with state: ${firstState} (${sortedCities.length} cities)`);
    return {
      state: firstState,
      cities: sortedCities,
      startIndex: 0,
    };
  }

  // If we have a current state in progress, continue from there
  if (progress.currentState && remainingStates.includes(progress.currentState)) {
    const cities = urlsData[progress.currentState] || [];
    const sortedCities = [...cities].sort((a, b) => {
      const cityA = extractCityFromUrl(a).toLowerCase();
      const cityB = extractCityFromUrl(b).toLowerCase();
      return cityA.localeCompare(cityB);
    });

    // Resume from next city after lastCityIndex
    const startIndex = progress.lastCityIndex + 1;

    if (startIndex < sortedCities.length) {
      const resumeCity = extractCityFromUrl(sortedCities[startIndex]);
      console.log(`[PrivyProgress] Resuming state: ${progress.currentState} from city index ${startIndex} (${resumeCity})`);
      return {
        state: progress.currentState,
        cities: sortedCities,
        startIndex,
      };
    } else {
      // State was actually completed, mark it
      await markStateComplete(progress, progress.currentState);
      return getNextStateToProcess(urlsData, progress);
    }
  }

  // Start with the first remaining state (alphabetically)
  const nextState = remainingStates[0];
  const cities = urlsData[nextState] || [];
  const sortedCities = [...cities].sort((a, b) => {
    const cityA = extractCityFromUrl(a).toLowerCase();
    const cityB = extractCityFromUrl(b).toLowerCase();
    return cityA.localeCompare(cityB);
  });

  progress.currentState = nextState;
  progress.lastCityIndex = -1; // Will start at 0
  await saveProgress(progress);

  console.log(`[PrivyProgress] Starting new state: ${nextState} (${sortedCities.length} cities)`);
  return {
    state: nextState,
    cities: sortedCities,
    startIndex: 0,
  };
}

/**
 * Get current filter configuration based on progress
 */
export function getCurrentFilterConfig(progress) {
  const idx = progress.filterCycleIndex || 0;
  return FILTER_CYCLES[idx] || FILTER_CYCLES[0];
}

/**
 * Get progress summary for logging
 */
export function getProgressSummary(progress) {
  const currentFilter = getCurrentFilterConfig(progress);
  return {
    currentState: progress.currentState,
    lastCityIndex: progress.lastCityIndex,
    completedStates: progress.completedStates?.length || 0,
    totalCitiesProcessed: progress.totalCitiesProcessed,
    cycleCount: progress.cycleCount,
    filterCycle: currentFilter.source,
    filterCycleIndex: progress.filterCycleIndex || 0,
    lastUpdated: progress.lastUpdated,
  };
}

/**
 * Reset progress (for testing or fresh start)
 */
export async function resetProgress() {
  try {
    await ScraperProgress.deleteOne({ scraper: SCRAPER_NAME });
    console.log('[PrivyProgress] Progress reset');
    return { ...DEFAULT_PROGRESS };
  } catch (e) {
    console.warn('[PrivyProgress] Failed to reset progress:', e.message);
    return { ...DEFAULT_PROGRESS };
  }
}

export default {
  loadProgress,
  loadProgressSync,
  saveProgress,
  markCityComplete,
  markStateComplete,
  startNewCycle,
  getNextStateToProcess,
  getProgressSummary,
  getCurrentFilterConfig,
  resetProgress,
  extractCityFromUrl,
  FILTER_CYCLES,
};
