import React, { useState, useMemo } from 'react';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
} from '@mui/material';
import { apiFetch } from '../helpers';

interface Address {
  fullAddress: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  url?: string;
  vendor?: string;
  extractedAt?: string;
  sourceIndex?: number;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  brokerage?: string | null;
  mlsId?: string | null;
  redfinAgentId?: number | null;
  agentEnriched?: boolean;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

// Cities by state (ALPHABETICAL ORDER - States A-Z, Cities A-Z within each state)
const STATE_CITIES: Record<string, string[]> = {
  'AL': ['Birmingham', 'Huntsville', 'Mobile', 'Montgomery', 'Tuscaloosa'],
  'AK': ['Anchorage', 'Fairbanks', 'Juneau', 'Ketchikan', 'Sitka'],
  'AR': ['Fayetteville', 'Fort Smith', 'Jonesboro', 'Little Rock', 'Springdale'],
  'AZ': ['Chandler', 'Gilbert', 'Glendale', 'Mesa', 'Phoenix', 'Scottsdale', 'Tempe', 'Tucson'],
  'CA': ['Anaheim', 'Bakersfield', 'Fresno', 'Long Beach', 'Los Angeles', 'Oakland', 'Sacramento', 'San Diego', 'San Francisco', 'San Jose'],
  'CO': ['Aurora', 'Boulder', 'Colorado Springs', 'Denver', 'Fort Collins', 'Lakewood'],
  'CT': ['Bridgeport', 'Hartford', 'New Haven', 'Stamford', 'Waterbury'],
  'DE': ['Bear', 'Dover', 'Middletown', 'Newark', 'Wilmington'],
  'FL': ['Fort Lauderdale', 'Hialeah', 'Jacksonville', 'Miami', 'Orlando', 'Port St. Lucie', 'St. Petersburg', 'Tampa'],
  'GA': ['Athens', 'Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah'],
  'HI': ['Hilo', 'Honolulu', 'Kailua', 'Pearl City', 'Waipahu'],
  'IA': ['Cedar Rapids', 'Davenport', 'Des Moines', 'Iowa City', 'Sioux City'],
  'ID': ['Boise', 'Idaho Falls', 'Meridian', 'Nampa', 'Pocatello'],
  'IL': ['Aurora', 'Chicago', 'Joliet', 'Naperville', 'Rockford', 'Springfield'],
  'IN': ['Carmel', 'Evansville', 'Fort Wayne', 'Indianapolis', 'South Bend'],
  'KS': ['Kansas City', 'Olathe', 'Overland Park', 'Topeka', 'Wichita'],
  'KY': ['Bowling Green', 'Covington', 'Lexington', 'Louisville', 'Owensboro'],
  'LA': ['Baton Rouge', 'Lafayette', 'Lake Charles', 'New Orleans', 'Shreveport'],
  'MA': ['Boston', 'Brockton', 'Cambridge', 'Lowell', 'Springfield', 'Worcester'],
  'MD': ['Baltimore', 'Bowie', 'Frederick', 'Gaithersburg', 'Rockville', 'Silver Spring'],
  'ME': ['Auburn', 'Bangor', 'Lewiston', 'Portland', 'South Portland'],
  'MI': ['Ann Arbor', 'Detroit', 'Grand Rapids', 'Lansing', 'Sterling Heights', 'Warren'],
  'MN': ['Bloomington', 'Duluth', 'Minneapolis', 'Rochester', 'St. Paul'],
  'MO': ['Columbia', 'Independence', 'Kansas City', 'Springfield', 'St. Louis'],
  'MS': ['Biloxi', 'Gulfport', 'Hattiesburg', 'Jackson', 'Southaven'],
  'MT': ['Billings', 'Bozeman', 'Butte', 'Great Falls', 'Missoula'],
  'NC': ['Cary', 'Charlotte', 'Durham', 'Fayetteville', 'Greensboro', 'Raleigh', 'Wilmington', 'Winston-Salem'],
  'ND': ['Bismarck', 'Fargo', 'Grand Forks', 'Minot', 'West Fargo'],
  'NE': ['Bellevue', 'Grand Island', 'Kearney', 'Lincoln', 'Omaha'],
  'NH': ['Concord', 'Derry', 'Dover', 'Manchester', 'Nashua'],
  'NJ': ['Camden', 'Clifton', 'Edison', 'Elizabeth', 'Jersey City', 'Newark', 'Passaic', 'Paterson', 'Trenton', 'Woodbridge'],
  'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Roswell', 'Santa Fe'],
  'NV': ['Henderson', 'Las Vegas', 'North Las Vegas', 'Reno', 'Sparks'],
  'NY': ['Albany', 'Buffalo', 'New Rochelle', 'New York', 'Rochester', 'Syracuse', 'Yonkers'],
  'OH': ['Akron', 'Cincinnati', 'Cleveland', 'Columbus', 'Dayton', 'Toledo'],
  'OK': ['Broken Arrow', 'Edmond', 'Norman', 'Oklahoma City', 'Tulsa'],
  'OR': ['Bend', 'Eugene', 'Gresham', 'Hillsboro', 'Portland', 'Salem'],
  'PA': ['Allentown', 'Erie', 'Philadelphia', 'Pittsburgh', 'Reading', 'Scranton'],
  'RI': ['Cranston', 'East Providence', 'Pawtucket', 'Providence', 'Warwick'],
  'SC': ['Charleston', 'Columbia', 'Greenville', 'Mount Pleasant', 'North Charleston', 'Rock Hill'],
  'SD': ['Aberdeen', 'Brookings', 'Rapid City', 'Sioux Falls', 'Watertown'],
  'TN': ['Chattanooga', 'Clarksville', 'Knoxville', 'Memphis', 'Murfreesboro', 'Nashville'],
  'TX': ['Arlington', 'Austin', 'Dallas', 'El Paso', 'Fort Worth', 'Houston', 'Laredo', 'Plano', 'San Antonio'],
  'UT': ['Orem', 'Provo', 'Salt Lake City', 'Sandy', 'West Jordan', 'West Valley City'],
  'VA': ['Alexandria', 'Arlington', 'Chesapeake', 'Newport News', 'Norfolk', 'Richmond', 'Virginia Beach'],
  'VT': ['Barre', 'Burlington', 'Montpelier', 'Rutland', 'South Burlington'],
  'WA': ['Bellevue', 'Kent', 'Seattle', 'Spokane', 'Tacoma', 'Vancouver'],
  'WI': ['Green Bay', 'Kenosha', 'Madison', 'Milwaukee', 'Racine'],
  'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling'],
  'WY': ['Casper', 'Cheyenne', 'Gillette', 'Laramie', 'Rock Springs'],
};

// Blocked states (same as Deals page) - excluded from fetching
const BLOCKED_STATES = ['SD', 'AK', 'ND', 'WY', 'HI', 'UT', 'NM', 'OH', 'MT'];

// 41 US states (excluding blocked states) - matches Deals page
const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
];

interface BofaResult {
  avgSalePrice: number | null;
  estimatedHomeValue: number | null;
  amv: number | null;
}

export default function RedfinFetcher() {
  // Read initial state from localStorage (synced with Deals page)
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem('selectedState');
    return saved && saved !== 'all' ? saved : 'NC';
  });
  const [city, setCity] = useState('');
  const [limit, setLimit] = useState(10);

  // Sync state selection to localStorage when it changes
  React.useEffect(() => {
    localStorage.setItem('selectedState', state);
  }, [state]);
  const [loading, setLoading] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // BofA integration state
  const [checkedAddresses, setCheckedAddresses] = useState<Set<number>>(new Set());
  const [bofaResults, setBofaResults] = useState<Record<number, BofaResult>>({});
  const [bofaLoading, setBofaLoading] = useState(false);
  const [bofaProgress, setBofaProgress] = useState({ current: 0, total: 0 });

  // Save to Deals state
  const [savingDeals, setSavingDeals] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Agent enrichment state
  const [enrichingAgents, setEnrichingAgents] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ current: 0, total: 0 });

  // Get unique states from addresses
  const uniqueStates = useMemo(() => {
    const s = new Set<string>();
    for (const r of addresses) {
      const st = r.state ? String(r.state).toUpperCase() : '';
      if (st) s.add(st);
    }
    return Array.from(s).sort();
  }, [addresses]);

  // Apply state filter
  const displayedAddresses = useMemo(() => {
    if (filterStates.length === 0) return addresses;
    const allowed = new Set(filterStates.map(s => s.toUpperCase()));
    return addresses.filter(r => r.state && allowed.has(String(r.state).toUpperCase()));
  }, [addresses, filterStates]);

  // Calculate totals
  const totals = useMemo(() => {
    return {
      total: addresses.length,
      filtered: displayedAddresses.length,
    };
  }, [addresses.length, displayedAddresses.length]);

  // Helper function to fetch BofA values for addresses - PROGRESSIVE UPDATES
  // Processes in small batches and updates UI after each batch completes
  const fetchBofaForAddresses = async (addressList: Address[], startIndex: number = 0) => {
    if (addressList.length === 0) return;

    setBofaLoading(true);
  
  
    setBofaProgress({ current: 0, total: addressList.length });

    const addressesToLookup = addressList.map((addr, i) => ({
      index: startIndex + i,
      address: addr.fullAddress || addr.address || '',
    })).filter(a => a.address);

    // Process in small batches of 5 for progressive updates
    const BATCH_SIZE = 5;
    let completedCount = 0;

    for (let i = 0; i < addressesToLookup.length; i += BATCH_SIZE) {
      const batch = addressesToLookup.slice(i, i + BATCH_SIZE);

      try {
        const res = await apiFetch('/api/bofa/batch', {
          method: 'POST',
          body: JSON.stringify({
            addresses: batch.map(a => a.address),
            concurrency: 5,
          }),
        });

        const data = await res.json();

        if (res.ok && data.ok && data.results) {
          // Update UI immediately with this batch's results
          data.results.forEach((result: any, j: number) => {
            const originalIndex = batch[j]?.index;
            if (originalIndex !== undefined) {
              setBofaResults(prev => ({
                ...prev,
                [originalIndex]: {
                  avgSalePrice: result.avgSalePrice,
                  estimatedHomeValue: result.estimatedHomeValue,
                  amv: result.amv,
                },
              }));
            }
          });
          completedCount += data.results.length;
          setBofaProgress({ current: completedCount, total: addressList.length });
        }
      } catch (err) {
        console.error(`BofA batch ${i / BATCH_SIZE + 1} failed:`, err);
        completedCount += batch.length; // Still count as processed
        setBofaProgress({ current: completedCount, total: addressList.length });
      }
    }

    setBofaLoading(false);
  };

  // Fetch addresses from a single city
  const fetchFromCity = async (cityName: string, currentCount: number): Promise<Address[]> => {
    const token = localStorage.getItem('authToken');
    const needed = limit - currentCount;
    if (needed <= 0) return [];

    try {
      const response = await fetch(
        `http://localhost:3015/api/live-scrape/redfin?state=${state}&city=${encodeURIComponent(cityName)}&limit=${needed}&page=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await response.json();
      if (data.ok && data.addresses && data.addresses.length > 0) {
        return data.addresses;
      }
    } catch (err) {
      console.log(`Failed to fetch from ${cityName}:`, err);
    }
    return [];
  };

  // Auto-fill: Fetch from multiple cities until reaching the limit
  const fetchAutoFill = async () => {
    if (!state) {
      alert('Please select a state');
      return;
    }

    setLoading(true);
    setAddresses([]);
    setCurrentPage(1);
    setBofaResults({});
    setCheckedAddresses(new Set());

    const cities = STATE_CITIES[state] || [];
    if (cities.length === 0) {
      alert('No cities available for this state');
      setLoading(false);
      return;
    }

    const allAddresses: Address[] = [];
    const existingSet = new Set<string>();

    for (const cityName of cities) {
      if (allAddresses.length >= limit) break;

      const cityAddresses = await fetchFromCity(cityName, allAddresses.length);

      // Filter duplicates and add city info
      for (const addr of cityAddresses) {
        const key = addr.fullAddress || addr.listingId || '';
        if (key && !existingSet.has(key) && allAddresses.length < limit) {
          existingSet.add(key);
          allAddresses.push({ ...addr, city: cityName });
        }
      }

      // Update UI progressively
      setAddresses([...allAddresses]);
    }

    setHasMore(false);
    setLoading(false);

    // Auto-fetch BofA values for all collected addresses
    if (allAddresses.length > 0) {
      fetchBofaForAddresses(allAddresses, 0);
      // Also auto-enrich agent details in the background
      enrichAgentDetailsForAddresses(allAddresses, 0);
    }
  };

  const fetchAddresses = async (page: number = 1, append: boolean = false) => {
    if (!state) {
      alert('Please select a state');
      return;
    }

    // If "Auto-fill" is selected, use the auto-fill function
    if (city === '__autofill__') {
      await fetchAutoFill();
      return;
    }

    setLoading(true);
    if (!append) {
      setAddresses([]);
      setCurrentPage(1);
      setBofaResults({}); // Clear BofA results when fetching new addresses
      setCheckedAddresses(new Set()); // Clear selections
    }

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(
        `http://localhost:3015/api/live-scrape/redfin?state=${state}&city=${encodeURIComponent(city)}&limit=${limit}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (data.ok && data.addresses && data.addresses.length > 0) {
        let newAddresses: Address[] = [];
        let startIndex = 0;

        if (append) {
          // Filter out duplicates based on fullAddress or listingId
          setAddresses(prev => {
            const existingAddresses = new Set(prev.map(a => a.fullAddress || a.listingId));
            newAddresses = data.addresses.filter(
              (a: Address) => !existingAddresses.has(a.fullAddress || a.listingId)
            );
            startIndex = prev.length; // Start index for BofA results
            return [...prev, ...newAddresses];
          });
        } else {
          newAddresses = data.addresses;
          setAddresses(data.addresses);
          startIndex = 0;
        }
        setCurrentPage(page);
        setHasMore(data.pagination?.hasMore || false);
        setLoading(false);

        // Auto-fetch BofA values for new addresses
        if (newAddresses.length > 0) {
          fetchBofaForAddresses(newAddresses, startIndex);
          // Also auto-enrich agent details in the background
          enrichAgentDetailsForAddresses(newAddresses, startIndex);
        }
        return; // Exit early since we set loading to false above
      } else if (data.addresses && data.addresses.length === 0) {
        if (!append) setAddresses([]);
        setHasMore(false);
      } else {
        if (!append) showMockData();
        setHasMore(false);
      }
    } catch (error: any) {
      console.log('API error, showing mock data:', error.message);
      if (!append) showMockData();
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const fetchNextPage = () => {
    if (hasMore && !loading) {
      fetchAddresses(currentPage + 1, true);
    }
  };

  // Toggle checkbox for an address
  const toggleCheck = (index: number) => {
    setCheckedAddresses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Toggle all checkboxes
  const toggleAllChecks = () => {
    if (checkedAddresses.size === displayedAddresses.length) {
      setCheckedAddresses(new Set());
    } else {
      setCheckedAddresses(new Set(displayedAddresses.map((_, i) => i)));
    }
  };

  // Send selected addresses to BofA (PARALLEL batch processing)
  const sendToBofA = async () => {
    const selectedIndices = Array.from(checkedAddresses);
    if (selectedIndices.length === 0) {
      alert('Please select at least one address');
      return;
    }

    setBofaLoading(true);
    setBofaProgress({ current: 0, total: selectedIndices.length });

    // Collect all addresses to send
    const addressesToLookup: { index: number; address: string }[] = [];
    for (const index of selectedIndices) {
      const addr = displayedAddresses[index];
      const fullAddress = addr.fullAddress || addr.address || '';
      if (fullAddress) {
        addressesToLookup.push({ index, address: fullAddress });
      }
    }

    try {
      // Use batch endpoint for parallel processing (3 browsers at once)
      const res = await apiFetch('/api/bofa/batch', {
        method: 'POST',
        body: JSON.stringify({
          addresses: addressesToLookup.map(a => a.address),
          concurrency: 5, // Run 5 browsers in parallel
        }),
      });

      const data = await res.json();

      if (res.ok && data.ok && data.results) {
        // Map results back to indices
        data.results.forEach((result: any, i: number) => {
          const originalIndex = addressesToLookup[i]?.index;
          if (originalIndex !== undefined) {
            setBofaResults(prev => ({
              ...prev,
              [originalIndex]: {
                avgSalePrice: result.avgSalePrice,
                estimatedHomeValue: result.estimatedHomeValue,
                amv: result.amv,
              },
            }));
          }
        });
        setBofaProgress({ current: data.results.length, total: selectedIndices.length });
      } else {
        console.error('Batch BofA lookup failed:', data);
      }
    } catch (err) {
      console.error('BofA batch lookup failed:', err);
    }

    setBofaLoading(false);
    setCheckedAddresses(new Set()); // Clear selections after processing
  };

  // Save addresses with BofA AMV to ScrapedDeals collection
  const saveToDeals = async () => {
    // Get addresses that have BofA AMV results
    const addressesWithAmv = displayedAddresses
      .map((addr, index) => ({ addr, index, bofa: bofaResults[index] }))
      .filter(item => item.bofa && item.bofa.amv);

    if (addressesWithAmv.length === 0) {
      setSaveStatus({ message: 'No addresses with BofA AMV to save. Wait for BofA fetch to complete.', type: 'error' });
      return;
    }

    setSavingDeals(true);
    setSaveStatus({ message: `Saving ${addressesWithAmv.length} addresses to deals...`, type: 'info' });

    try {
      const dealsToSave = addressesWithAmv.map(({ addr, bofa }) => ({
        fullAddress: addr.fullAddress || addr.address || '',
        address: addr.address || addr.fullAddress?.split(',')[0] || '',
        city: addr.city || null,
        state: addr.state || null,
        zip: addr.zip || null,
        listingPrice: addr.price || null,
        amv: bofa?.amv || null,
        source: 'redfin',
        beds: addr.beds || null,
        baths: addr.baths || null,
        sqft: addr.sqft || null,
        agentName: addr.agentName || null,
        agentPhone: addr.agentPhone || null,
        agentEmail: addr.agentEmail || null,
        brokerage: addr.brokerage || null,
        scrapedAt: new Date().toISOString(),
      }));

      const res = await apiFetch('/api/scraped-deals/save', {
        method: 'POST',
        body: JSON.stringify({ deals: dealsToSave }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setSaveStatus({
          message: `Saved ${data.saved} new, updated ${data.updated}, failed ${data.failed}`,
          type: data.failed > 0 ? 'error' : 'success'
        });
      } else {
        setSaveStatus({ message: data.error || 'Failed to save deals', type: 'error' });
      }
    } catch (err: any) {
      console.error('Failed to save deals:', err);
      setSaveStatus({ message: err?.message || 'Failed to save deals', type: 'error' });
    } finally {
      setSavingDeals(false);
    }
  };

  // Enrich agent details for addresses via deep scraping
  const enrichAgentDetailsForAddresses = async (addressList: Address[], startIndex: number = 0) => {
    if (addressList.length === 0) return;

    // Only enrich properties that have URLs and haven't been enriched yet
    const toEnrich = addressList
      .map((addr, i) => ({ index: startIndex + i, addr }))
      .filter(({ addr }) => addr.url && !addr.agentEnriched);

    if (toEnrich.length === 0) return;

    setEnrichingAgents(true);
    setEnrichProgress({ current: 0, total: toEnrich.length });

    let completed = 0;

    // Process one at a time to avoid overwhelming the server
    for (const { index, addr } of toEnrich) {
      try {
        const res = await apiFetch('/api/enrich-redfin-agent', {
          method: 'POST',
          body: JSON.stringify({ url: addr.url }),
        });

        const data = await res.json();

        if (res.ok && data.ok && data.agent) {
          // Update the address with enriched agent details
          setAddresses(prev => {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              agentPhone: data.agent.phone || updated[index].agentPhone,
              agentEmail: data.agent.email || updated[index].agentEmail,
              brokerage: data.agent.brokerage || updated[index].brokerage,
              agentEnriched: true
            };
            return updated;
          });
        }

        completed++;
        setEnrichProgress({ current: completed, total: toEnrich.length });
      } catch (err) {
        console.error(`Failed to enrich ${addr.fullAddress}:`, err);
        completed++;
        setEnrichProgress({ current: completed, total: toEnrich.length });
      }
    }

    setEnrichingAgents(false);
  };

  // Enrich agent details for selected addresses via deep scraping
  const enrichAgentDetails = async () => {
    const selectedIndices = Array.from(checkedAddresses);
    if (selectedIndices.length === 0) {
      alert('Please select at least one property to enrich');
      return;
    }

    // Get selected addresses
    const selectedAddresses = selectedIndices.map(i => displayedAddresses[i]);

    // Clear selections first
    setCheckedAddresses(new Set());

    // Enrich them
    await enrichAgentDetailsForAddresses(selectedAddresses, selectedIndices[0]);
  };

  const showMockData = () => {
    const streets = [
      'Main St',
      'Oak Ave',
      'Maple Dr',
      'Pine Rd',
      'Cedar Ln',
      'Elm St',
      'Park Ave',
      'Lake Dr',
      'Hill St',
      'Valley Rd',
    ];
    const cities = ['City Center', 'Downtown', 'Westside', 'Eastside', 'Northville', 'Southside'];

    const mockAddresses: Address[] = [];
    for (let i = 0; i < limit; i++) {
      const streetNum = 100 + Math.floor(Math.random() * 9000);
      const street = streets[i % streets.length];
      const city = cities[Math.floor(Math.random() * cities.length)];
      const zip = 10000 + Math.floor(Math.random() * 89999);

      mockAddresses.push({
        fullAddress: `${streetNum} ${street}, ${city}, ${state} ${zip}`,
        address: `${streetNum} ${street}`,
        city: city,
        state: state,
        zip: String(zip),
        price: 150000 + Math.floor(Math.random() * 300000),
        beds: 2 + Math.floor(Math.random() * 4),
        baths: 1 + Math.floor(Math.random() * 3),
        sqft: 1000 + Math.floor(Math.random() * 2000),
        url: `https://www.redfin.com/${state.toLowerCase()}/mock-property-${i}`,
        vendor: 'redfin',
        extractedAt: new Date().toISOString(),
        sourceIndex: i,
      });
    }

    setAddresses(mockAddresses);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Redfin Properties</h2>
        <div style={{ fontSize: 14, color: '#6b7280' }}>Total: {displayedAddresses.length}</div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card title="Total Properties" value={totals.total} />
        <Card title="Filtered Properties" value={totals.filtered} />
      </div>

      {/* Search Form */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormControl
            size="small"
            sx={{
              minWidth: 220,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Select State</InputLabel>
            <Select
              value={state}
              label="Select State"
              onChange={(e) => {
                setState(e.target.value);
                setCity(''); // Reset city when state changes
                setAddresses([]); // Clear addresses when state changes
                setCurrentPage(1);
                setBofaResults({}); // Clear BofA results
                setCheckedAddresses(new Set()); // Clear selections
              }}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000', maxHeight: 400 } } }}
            >
              {US_STATES.map((s) => (
                <MenuItem key={s.code} value={s.code}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl
            size="small"
            sx={{
              minWidth: 200,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Select City</InputLabel>
            <Select
              value={city}
              label="Select City"
              onChange={(e) => {
                setCity(e.target.value);
                setAddresses([]); // Clear addresses when city changes
                setCurrentPage(1); // Reset page
                setBofaResults({}); // Clear BofA results when city changes
                setCheckedAddresses(new Set()); // Clear selections
              }}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000', maxHeight: 400 } } }}
            >
              <MenuItem value="__autofill__" sx={{ fontWeight: 600, color: '#0284c7' }}>
                🔄 Auto-fill (reach limit)
              </MenuItem>
              <MenuItem value="">All Cities</MenuItem>
              {(STATE_CITIES[state] || []).map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl
            size="small"
            sx={{
              minWidth: 160,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Limit</InputLabel>
            <Select
              value={limit}
              label="Limit"
              onChange={(e) => setLimit(Number(e.target.value))}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000' } } }}
            >
              <MenuItem value={10}>10 addresses</MenuItem>
              <MenuItem value={20}>20 addresses</MenuItem>
              <MenuItem value={50}>50 addresses</MenuItem>
              <MenuItem value={100}>100 addresses</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={() => fetchAddresses(1, false)}
            disabled={loading || !state}
            sx={{
              backgroundColor: '#111827',
              '&:hover': { backgroundColor: '#1f2937' },
              textTransform: 'none',
            }}
          >
            {loading ? 'Fetching...' : 'Fetch Addresses'}
          </Button>
        </div>
      </div>

      {/* Agent Enrichment Status */}
      {addresses.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 16,
            padding: 12,
            background: enrichingAgents ? '#fef3c7' : '#f0fdf4',
            border: enrichingAgents ? '1px solid #f59e0b' : '1px solid #22c55e',
            borderRadius: 8,
            flexWrap: 'wrap',
          }}
        >
          {enrichingAgents ? (
            <>
              <div style={{
                padding: '8px 14px',
                backgroundColor: '#f59e0b',
                color: '#fff',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14
              }}>
                Enriching {enrichProgress.current}/{enrichProgress.total}
              </div>
              <span style={{ color: '#92400e', fontSize: 14 }}>
                Deep scraping for phone, email, brokerage... (auto-running in background)
              </span>
            </>
          ) : (
            <>
              <div style={{
                padding: '8px 14px',
                backgroundColor: '#22c55e',
                color: '#fff',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14
              }}>
                ✓ Agent Auto-Enrichment
              </div>
              <span style={{ color: '#166534', fontSize: 14 }}>
                Agent details automatically enriched when fetching properties
              </span>
              {checkedAddresses.size > 0 && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={enrichAgentDetails}
                  disabled={enrichingAgents}
                  sx={{
                    borderColor: '#22c55e',
                    color: '#166534',
                    '&:hover': { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
                    textTransform: 'none',
                    marginLeft: 'auto'
                  }}
                >
                  Re-enrich Selected ({checkedAddresses.size})
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* BofA Send Button & Progress */}
      {addresses.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 16,
            padding: 12,
            background: '#f0f9ff',
            border: '1px solid #0284c7',
            borderRadius: 8,
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="contained"
            onClick={sendToBofA}
            disabled={bofaLoading || checkedAddresses.size === 0}
            sx={{
              backgroundColor: '#0284c7',
              '&:hover': { backgroundColor: '#0369a1' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
            }}
          >
            {bofaLoading
              ? `Processing ${bofaProgress.current}/${bofaProgress.total}...`
              : `Send to BofA (${checkedAddresses.size} selected)`}
          </Button>
          <span style={{ color: '#0369a1', fontSize: 14 }}>
            {bofaLoading
              ? `Fetching BofA values... ${bofaProgress.current}/${bofaProgress.total}`
              : 'BofA values auto-fetch after addresses load'}
          </span>
        </div>
      )}

      {/* Save to Deals Button */}
      {addresses.length > 0 && Object.keys(bofaResults).length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 16,
            padding: 12,
            background: '#f0fdf4',
            border: '1px solid #22c55e',
            borderRadius: 8,
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="contained"
            onClick={saveToDeals}
            disabled={savingDeals || Object.keys(bofaResults).length === 0}
            sx={{
              backgroundColor: '#22c55e',
              '&:hover': { backgroundColor: '#16a34a' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
            }}
          >
            {savingDeals ? 'Saving...' : `Save to Deals (${Object.keys(bofaResults).length} with AMV)`}
          </Button>
          {saveStatus && (
            <span style={{
              color: saveStatus.type === 'success' ? '#16a34a' : saveStatus.type === 'error' ? '#dc2626' : '#0369a1',
              fontSize: 14
            }}>
              {saveStatus.message}
            </span>
          )}
          {!saveStatus && (
            <span style={{ color: '#16a34a', fontSize: 14 }}>
              Save addresses with BofA AMV to the Deals database
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      {addresses.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <FormControl
            size="small"
            sx={{
              minWidth: 220,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Filter by State</InputLabel>
            <Select
              multiple
              value={filterStates}
              onChange={(e) => setFilterStates(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
              label="Filter by State"
              renderValue={(selected) => (selected as string[]).join(', ')}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000' } } }}
            >
              {uniqueStates.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {filterStates.length > 0 && (
            <Button size="small" onClick={() => setFilterStates([])}>
              Clear Filter
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          overflowX: 'auto',
          borderRadius: 12,
          border: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              {/* Checkbox column */}
              <th
                style={{
                  padding: '12px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.12)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  width: 50,
                }}
              >
                <Checkbox
                  checked={displayedAddresses.length > 0 && checkedAddresses.size === displayedAddresses.length}
                  indeterminate={checkedAddresses.size > 0 && checkedAddresses.size < displayedAddresses.length}
                  onChange={toggleAllChecks}
                  sx={{ color: '#fff', '&.Mui-checked': { color: '#fff' }, '&.MuiCheckbox-indeterminate': { color: '#fff' } }}
                  size="small"
                />
              </th>
              {['Full Address', 'Price', 'Agent Name', 'Brokerage', 'Phone', 'Email', 'BofA Avg Sale', 'BofA Est Value', 'BofA AMV', 'Actions'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 ? 'left' : 'right',
                    padding: '12px 14px',
                    fontSize: 12,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    borderBottom: '1px solid rgba(255,255,255,0.12)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    whiteSpace: 'nowrap',
                    ...(h.startsWith('BofA') ? { backgroundColor: '#0369a1' } : {}),
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedAddresses.map((addr, i) => {
              const zebra = i % 2 === 0 ? '#ffffff' : '#f9fafb';
              const bofaData = bofaResults[i];
              return (
                <tr
                  key={i}
                  onClick={() => setSelected(addr)}
                  style={{ background: zebra, cursor: 'pointer' }}
                >
                  {/* Checkbox cell */}
                  <td style={{ ...tdBase, padding: '8px', textAlign: 'center' }}>
                    <Checkbox
                      checked={checkedAddresses.has(i)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleCheck(i);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      size="small"
                    />
                  </td>
                  <td style={tdLWide}>
                    <div style={{ fontWeight: 600 }}>{addr.fullAddress || addr.address || '—'}</div>
                  </td>
                  <td style={tdR}>{fmt(addr.price)}</td>
                  {/* Agent columns */}
                  <td style={{ ...tdL, maxWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{addr.agentName || '—'}</span>
                      {addr.agentEnriched && (
                        <span style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          backgroundColor: '#f59e0b',
                          color: '#fff',
                          borderRadius: 4,
                          fontWeight: 600
                        }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdL, maxWidth: 180 }}>
                    <div style={{ fontSize: 13, color: addr.brokerage ? '#111827' : '#9ca3af' }}>
                      {addr.brokerage || '—'}
                    </div>
                  </td>
                  <td style={{ ...tdR, whiteSpace: 'nowrap', color: addr.agentPhone ? '#111827' : '#9ca3af' }}>
                    {addr.agentPhone || '—'}
                  </td>
                  <td style={{ ...tdL, maxWidth: 200, color: addr.agentEmail ? '#111827' : '#9ca3af' }}>
                    {addr.agentEmail ? (
                      <a href={`mailto:${addr.agentEmail}`} style={{ color: '#0284c7', textDecoration: 'none' }}>
                        {addr.agentEmail}
                      </a>
                    ) : '—'}
                  </td>
                  {/* BofA Result columns */}
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined }}>
                    {bofaData ? fmt(bofaData.avgSalePrice) : '—'}
                  </td>
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined }}>
                    {bofaData ? fmt(bofaData.estimatedHomeValue) : '—'}
                  </td>
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined, fontWeight: bofaData ? 600 : undefined }}>
                    {bofaData ? fmt(bofaData.amv) : '—'}
                  </td>
                  <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(addr);
                        }}
                        sx={{
                          borderColor: '#111827',
                          color: '#111827',
                          '&:hover': { borderColor: '#1f2937', bgcolor: '#f9fafb' }
                        }}
                      >
                        Details
                      </Button>
                      {addr.url && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(addr.url, '_blank');
                          }}
                          sx={{
                            backgroundColor: '#d32323',
                            '&:hover': { backgroundColor: '#a61d1d' },
                            minWidth: 100
                          }}
                        >
                          View Listing
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!displayedAddresses.length && (
              <tr>
                <td colSpan={11} style={{ padding: 18, textAlign: 'center', color: '#6b7280' }}>
                  {addresses.length === 0
                    ? 'No properties loaded. Select a state, then click "Fetch Addresses".'
                    : 'No properties match the selected filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Next Button - Load more addresses */}
      {displayedAddresses.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
            marginTop: 20,
            marginBottom: 20,
          }}
        >
          <span style={{ color: '#6b7280', fontSize: 14 }}>
            Page {currentPage} • {displayedAddresses.length} properties loaded
          </span>
          <Button
            variant="contained"
            onClick={fetchNextPage}
            disabled={loading || !hasMore}
            sx={{
              backgroundColor: '#111827',
              '&:hover': { backgroundColor: '#1f2937' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
              minWidth: 150,
            }}
          >
            {loading ? 'Loading...' : hasMore ? 'Next →' : 'No More Results'}
          </Button>
        </div>
      )}

      {/* Detail modal */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {selected && (
          <>
            <DialogTitle>Property Details</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Info label="Full Address" value={selected.fullAddress || selected.address || '—'} />
                <Info label="City" value={selected.city || '—'} />
                <Info label="State" value={selected.state || '—'} />
                <Info label="ZIP" value={selected.zip || '—'} />
                <Info label="Price" value={fmt(selected.price)} />
                {selected.agentName && (
                  <>
                    <div style={{
                      background: '#f0f9ff',
                      border: '1px solid #0284c7',
                      borderRadius: 10,
                      padding: 12,
                      marginTop: 8
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#0369a1', marginBottom: 8 }}>
                        Agent Information
                      </div>
                      <Stack spacing={1.5}>
                        <Info label="Agent Name" value={selected.agentName || '—'} />
                        <Info label="Brokerage" value={selected.brokerage || '—'} />
                        <Info label="Phone" value={selected.agentPhone || '—'} />
                        {selected.agentEmail && <Info label="Email" value={selected.agentEmail} />}
                        {selected.mlsId && <Info label="MLS ID" value={selected.mlsId} />}
                      </Stack>
                    </div>
                  </>
                )}
                {selected.url && (
                  <div
                    style={{
                      background: '#fafafa',
                      border: '1px solid #eee',
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Listing URL</div>
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#d32323',
                        textDecoration: 'none',
                        fontWeight: 600,
                        wordBreak: 'break-all'
                      }}
                    >
                      View on Redfin →
                    </a>
                  </div>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelected(null)}>Close</Button>
              {selected.url && (
                <Button
                  variant="contained"
                  onClick={() => window.open(selected.url, '_blank')}
                  sx={{
                    backgroundColor: '#d32323',
                    '&:hover': { backgroundColor: '#a61d1d' }
                  }}
                >
                  View Listing on Redfin
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}

function Card({ title, value }: { title: string; value: number | string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666' }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: '#111' }}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 180,
        background: '#fafafa',
        border: '1px solid #eee',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, color: '#111827' }}>{value}</div>
    </div>
  );
}

const tdBase: React.CSSProperties = {
  padding: '14px',
  borderBottom: '1px solid #eef2f7',
  color: '#111827',
  verticalAlign: 'top',
};
const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdLWide: React.CSSProperties = { ...tdL, minWidth: 260 };
