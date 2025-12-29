/**
 * Privy Progress Tracker (MongoDB-based)
 *
 * Tracks which state and city was last processed, so scraping can resume
 * from where it left off after restarts. Uses MongoDB for persistence
 * across deployments (file-based storage gets wiped on Render restarts).
 */

import ScraperProgress from '../../models/ScraperProgress.js';

const SCRAPER_NAME = 'privy';

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
    if (doc) {
      // Convert MongoDB doc to our progress format
      const progress = {
        lastState: doc.lastState || null,
        lastCityIndex: doc.currentCityIndex ?? -1,
        currentState: doc.currentState || null,
        completedStates: doc.processedCities || [], // Using processedCities to store completed states
        lastUpdated: doc.updatedAt?.toISOString() || null,
        totalCitiesProcessed: doc.totalScraped || 0,
        totalStatesCompleted: doc.currentStateIndex || 0,
        cycleCount: doc.cycleCount || 0,
      };
      console.log('[PrivyProgress] Loaded progress from MongoDB:', {
        currentState: progress.currentState,
        lastCityIndex: progress.lastCityIndex,
        completedStates: progress.completedStates?.length || 0,
        totalCitiesProcessed: progress.totalCitiesProcessed,
        cycleCount: progress.cycleCount,
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
 */
export async function saveProgress(progress) {
  try {
    await ScraperProgress.findOneAndUpdate(
      { scraper: SCRAPER_NAME },
      {
        scraper: SCRAPER_NAME,
        currentState: progress.currentState,
        currentCityIndex: progress.lastCityIndex,
        currentStateIndex: progress.totalStatesCompleted,
        processedCities: progress.completedStates, // Store completed states here
        totalScraped: progress.totalCitiesProcessed,
        cycleCount: progress.cycleCount,
        lastState: progress.lastState,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );
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
 * Start a new cycle (all states completed, starting over)
 */
export async function startNewCycle(progress) {
  progress.cycleCount += 1;
  progress.completedStates = [];
  progress.lastState = null;
  progress.currentState = null;
  progress.lastCityIndex = -1;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Starting new cycle #${progress.cycleCount}`);
  await saveProgress(progress);
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
 * Get progress summary for logging
 */
export function getProgressSummary(progress) {
  return {
    currentState: progress.currentState,
    lastCityIndex: progress.lastCityIndex,
    completedStates: progress.completedStates?.length || 0,
    totalCitiesProcessed: progress.totalCitiesProcessed,
    cycleCount: progress.cycleCount,
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
  resetProgress,
  extractCityFromUrl,
};
