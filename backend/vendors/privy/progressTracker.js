/**
 * Privy Progress Tracker
 *
 * Tracks which state and city was last processed, so scraping can resume
 * from where it left off after restarts. Processes states and cities
 * alphabetically.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Progress file location - use /tmp for cloud deployments, local for dev
const PROGRESS_FILE = process.env.PRIVY_PROGRESS_FILE ||
  (process.env.NODE_ENV === 'production' ? '/tmp/privy-progress.json' : path.join(__dirname, '../../../privy-progress.json'));

// Default progress state
const DEFAULT_PROGRESS = {
  lastState: null,        // Last completed state (e.g., 'AL')
  lastCityIndex: 0,       // Index of last completed city within current state
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
 * Load progress from file
 */
export function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log('[PrivyProgress] Loaded progress:', {
        currentState: data.currentState,
        lastCityIndex: data.lastCityIndex,
        completedStates: data.completedStates?.length || 0,
        totalCitiesProcessed: data.totalCitiesProcessed,
        cycleCount: data.cycleCount,
      });
      return { ...DEFAULT_PROGRESS, ...data };
    }
  } catch (e) {
    console.warn('[PrivyProgress] Failed to load progress file:', e.message);
  }
  return { ...DEFAULT_PROGRESS };
}

/**
 * Save progress to file
 */
export function saveProgress(progress) {
  try {
    const data = {
      ...progress,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[PrivyProgress] Failed to save progress:', e.message);
  }
}

/**
 * Mark a city as completed
 */
export function markCityComplete(progress, state, cityIndex, cityUrl) {
  const cityName = extractCityFromUrl(cityUrl);
  progress.lastCityIndex = cityIndex;
  progress.currentState = state;
  progress.totalCitiesProcessed += 1;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Completed city: ${cityName} (${state}) - Index ${cityIndex}`);
  saveProgress(progress);
  return progress;
}

/**
 * Mark a state as fully completed
 */
export function markStateComplete(progress, state) {
  if (!progress.completedStates.includes(state)) {
    progress.completedStates.push(state);
    progress.completedStates.sort(); // Keep alphabetical
  }
  progress.lastState = state;
  progress.currentState = null;
  progress.lastCityIndex = 0;
  progress.totalStatesCompleted = progress.completedStates.length;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Completed state: ${state} (${progress.totalStatesCompleted} total states completed)`);
  saveProgress(progress);
  return progress;
}

/**
 * Start a new cycle (all states completed, starting over)
 */
export function startNewCycle(progress) {
  progress.cycleCount += 1;
  progress.completedStates = [];
  progress.lastState = null;
  progress.currentState = null;
  progress.lastCityIndex = 0;
  progress.lastUpdated = new Date().toISOString();

  console.log(`[PrivyProgress] Starting new cycle #${progress.cycleCount}`);
  saveProgress(progress);
  return progress;
}

/**
 * Get the next state and cities to process based on progress
 * Returns { state, cities, startIndex } or null if all done
 */
export function getNextStateToProcess(urlsData, progress) {
  // Get all states sorted alphabetically
  const allStates = Object.keys(urlsData).sort();

  if (!allStates.length) {
    console.warn('[PrivyProgress] No states found in urls.json');
    return null;
  }

  // Find states not yet completed in this cycle
  const remainingStates = allStates.filter(s => !progress.completedStates.includes(s));

  if (remainingStates.length === 0) {
    // All states completed - start new cycle
    startNewCycle(progress);
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
      markStateComplete(progress, progress.currentState);
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
  saveProgress(progress);

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
    completedStates: progress.completedStates.length,
    totalCitiesProcessed: progress.totalCitiesProcessed,
    cycleCount: progress.cycleCount,
    lastUpdated: progress.lastUpdated,
  };
}

/**
 * Reset progress (for testing or fresh start)
 */
export function resetProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
    }
    console.log('[PrivyProgress] Progress reset');
    return { ...DEFAULT_PROGRESS };
  } catch (e) {
    console.warn('[PrivyProgress] Failed to reset progress:', e.message);
    return { ...DEFAULT_PROGRESS };
  }
}

export default {
  loadProgress,
  saveProgress,
  markCityComplete,
  markStateComplete,
  startNewCycle,
  getNextStateToProcess,
  getProgressSummary,
  resetProgress,
  extractCityFromUrl,
};
