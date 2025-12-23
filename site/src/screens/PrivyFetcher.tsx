import React, { useState, useMemo } from 'react';
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions, Stack,
  TextField, Alert, Paper, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Box,
  Checkbox,
} from '@mui/material';
import { apiFetch } from '../helpers';

// Blocked states (same as Deals page) - excluded from fetching
const BLOCKED_STATES = ['SD', 'AK', 'ND', 'WY', 'HI', 'UT', 'NM', 'OH', 'MT'];

// 41 US states (excluding blocked states) - matches Deals page
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
];

// Filters applied on backend
const APPLIED_FILTERS = [
  { label: 'Price', value: '$20K - $600K' },
  { label: 'Beds', value: '3+' },
  { label: 'Sqft', value: '1,000+' },
  { label: 'HOA', value: 'No' },
  { label: 'Type', value: 'Single Family' },
  { label: 'Status', value: 'Active' },
];

interface Address {
  fullAddress: string;
  price?: string;
  stats?: string[];
  state?: string;
  source?: string;
  scrapedAt?: string;
  privyUrl?: string;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  brokerage?: string | null;
  agentEnriched?: boolean;
}

interface BofaResult {
  avgSalePrice: number | null;
  estimatedHomeValue: number | null;
  amv: number | null;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

export default function PrivyFetcher() {
  // State selector - synced with localStorage (shared with Deals page)
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem('selectedState');
    return saved && saved !== 'all' ? saved : 'NJ';
  });
  const [limit, setLimit] = useState(50);

  // Sync state selection to localStorage when it changes
  React.useEffect(() => {
    localStorage.setItem('selectedState', state);
  }, [state]);

  // Results
  const [loading, setLoading] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);

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

  // Auto-fetch ALL states state
  const [autoFetchingAll, setAutoFetchingAll] = useState(false);
  const [autoFetchProgress, setAutoFetchProgress] = useState({ currentState: '', stateIndex: 0, totalStates: 0 });
  const [autoFetchAbort, setAutoFetchAbort] = useState(false);

  // Calculate totals
  const totals = useMemo(() => {
    return {
      total: addresses.length,
      withAgent: addresses.filter(a => a.agentName).length,
      withAmv: Object.keys(bofaResults).length,
    };
  }, [addresses, bofaResults]);

  // Helper function to fetch BofA values for addresses - PROGRESSIVE UPDATES
  const fetchBofaForAddresses = async (addressList: Address[], startIndex: number = 0) => {
    if (addressList.length === 0) return;

    setBofaLoading(true);
    setBofaProgress({ current: 0, total: addressList.length });

    const addressesToLookup = addressList.map((addr, i) => ({
      index: startIndex + i,
      address: addr.fullAddress || '',
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
        completedCount += batch.length;
        setBofaProgress({ current: completedCount, total: addressList.length });
      }
    }

    setBofaLoading(false);
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
    if (checkedAddresses.size === addresses.length) {
      setCheckedAddresses(new Set());
    } else {
      setCheckedAddresses(new Set(addresses.map((_, i) => i)));
    }
  };

  // Send selected addresses to BofA - processes in chunks of 5 for progressive updates
  const sendToBofA = async () => {
    const selectedIndices = Array.from(checkedAddresses);
    if (selectedIndices.length === 0) {
      alert('Please select at least one address');
      return;
    }

    setBofaLoading(true);
    setBofaProgress({ current: 0, total: selectedIndices.length });

    const addressesToLookup: { index: number; address: string }[] = [];
    for (const index of selectedIndices) {
      const addr = addresses[index];
      const fullAddress = addr.fullAddress || '';
      if (fullAddress) {
        addressesToLookup.push({ index, address: fullAddress });
      }
    }

    console.log('Sending addresses to BofA:', addressesToLookup.map(a => a.address));

    if (addressesToLookup.length === 0) {
      setStatus({ message: 'No valid addresses to send to BofA', type: 'warning' });
      setBofaLoading(false);
      return;
    }

    // Process in chunks of 5 for progressive updates
    const CHUNK_SIZE = 5;
    let completedCount = 0;
    let successfulCount = 0;
    let failedCount = 0;

    for (let i = 0; i < addressesToLookup.length; i += CHUNK_SIZE) {
      const chunk = addressesToLookup.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(addressesToLookup.length / CHUNK_SIZE);

      setStatus({ message: `Processing chunk ${chunkNum}/${totalChunks}...`, type: 'info' });

      try {
        const res = await apiFetch('/api/bofa/batch', {
          method: 'POST',
          body: JSON.stringify({
            addresses: chunk.map(a => a.address),
            concurrency: 5,
          }),
        });

        const data = await res.json();
        console.log(`BofA chunk ${chunkNum} response:`, data);

        if (res.ok && data.ok && data.results) {
          // Update UI immediately with this chunk's results
          data.results.forEach((result: any, j: number) => {
            const originalIndex = chunk[j]?.index;
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
          successfulCount += data.summary?.successful || data.results.length;
          failedCount += data.summary?.failed || 0;
          setBofaProgress({ current: completedCount, total: addressesToLookup.length });
        } else {
          console.error(`BofA chunk ${chunkNum} failed:`, data);
          completedCount += chunk.length;
          failedCount += chunk.length;
          setBofaProgress({ current: completedCount, total: addressesToLookup.length });
        }
      } catch (err: any) {
        console.error(`BofA chunk ${chunkNum} error:`, err);
        completedCount += chunk.length;
        failedCount += chunk.length;
        setBofaProgress({ current: completedCount, total: addressesToLookup.length });
      }
    }

    setStatus({ message: `BofA lookup complete: ${successfulCount} successful, ${failedCount} failed`, type: 'success' });
    setBofaLoading(false);
    setCheckedAddresses(new Set());
  };

  // Parse price string to number (e.g., "$250,000" -> 250000)
  const parsePrice = (priceStr?: string): number | null => {
    if (!priceStr) return null;
    const num = Number(priceStr.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  // Save addresses with BofA AMV to ScrapedDeals collection
  const saveToDeals = async () => {
    // Get addresses that have BofA AMV results
    const addressesWithAmv = addresses
      .map((addr, index) => ({ addr, index, bofa: bofaResults[index] }))
      .filter(item => item.bofa && item.bofa.amv);

    if (addressesWithAmv.length === 0) {
      setSaveStatus({ message: 'No addresses with BofA AMV to save. Wait for BofA fetch to complete.', type: 'error' });
      return;
    }

    setSavingDeals(true);
    setSaveStatus({ message: `Saving ${addressesWithAmv.length} addresses to deals...`, type: 'info' });

    try {
      const stats = addresses.map(a => parseStats(a.stats));

      const dealsToSave = addressesWithAmv.map(({ addr, index, bofa }) => {
        const addrStats = stats[index] || {};
        return {
          fullAddress: addr.fullAddress || '',
          address: addr.fullAddress?.split(',')[0]?.trim() || '',
          city: null, // Privy doesn't provide city separately
          state: addr.state || state || null,
          zip: null,
          listingPrice: parsePrice(addr.price),
          amv: bofa?.amv || null,
          source: 'privy',
          beds: addrStats.beds ? Number(addrStats.beds) : null,
          baths: addrStats.baths ? Number(addrStats.baths) : null,
          sqft: addrStats.sqft ? Number(addrStats.sqft.replace(/[^0-9]/g, '')) : null,
          agentName: addr.agentName || null,
          agentPhone: addr.agentPhone || null,
          agentEmail: addr.agentEmail || null,
          brokerage: addr.brokerage || null,
          scrapedAt: addr.scrapedAt || new Date().toISOString(),
        };
      });

      const res = await apiFetch('/api/scraped-deals/save', {
        method: 'POST',
        body: JSON.stringify({ deals: dealsToSave }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        const emailMsg = data.emailsSent > 0 ? `, ${data.emailsSent} emails auto-sent` : '';
        setSaveStatus({
          message: `Saved ${data.saved} new, updated ${data.updated}, failed ${data.failed}${emailMsg}`,
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

  // Enrich agent details for addresses via Privy deep scraping
  const enrichAgentDetailsForAddresses = async (addressList: Address[], startIndex: number = 0) => {
    if (addressList.length === 0) return;

    // Only enrich properties that have privyUrl and haven't been enriched yet
    const toEnrich = addressList
      .map((addr, i) => ({ index: startIndex + i, addr }))
      .filter(({ addr }) => addr.privyUrl && !addr.agentEnriched);

    if (toEnrich.length === 0) return;

    setEnrichingAgents(true);
    setEnrichProgress({ current: 0, total: toEnrich.length });

    let completed = 0;

    // Process one at a time to avoid overwhelming the server
    for (const { index, addr } of toEnrich) {
      try {
        const res = await apiFetch('/api/enrich-privy-agent', {
          method: 'POST',
          body: JSON.stringify({ url: addr.privyUrl, address: addr.fullAddress }),
        });

        const data = await res.json();

        if (res.ok && data.ok && data.agent) {
          // Update the address with enriched agent details
          setAddresses(prev => {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              agentName: data.agent.name || updated[index].agentName,
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

  // Enrich agent details for selected addresses
  const enrichAgentDetails = async () => {
    const selectedIndices = Array.from(checkedAddresses);
    if (selectedIndices.length === 0) {
      alert('Please select at least one property to enrich');
      return;
    }

    // Get selected addresses
    const selectedAddresses = selectedIndices.map(i => addresses[i]);

    // Clear selections first
    setCheckedAddresses(new Set());

    // Enrich them
    await enrichAgentDetailsForAddresses(selectedAddresses, selectedIndices[0]);
  };

  const fetchAddresses = async () => {
    if (!state) { alert('Please select a state'); return; }
    setLoading(true);
    setAddresses([]);
    setBofaResults({});
    setCheckedAddresses(new Set());
    setStatus({ message: 'Connecting to Privy.pro... This may take 30-60 seconds.', type: 'info' });

    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');

      // State-level URL (no city parameter)
      const url = `http://localhost:3015/api/live-scrape/privy?state=${state}&limit=${limit}`;

      const response = await fetch(
        url,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const data = await response.json();

      if (data.requiresOTP || data.error?.includes('OTP')) {
        setStatus({ message: 'Privy requires verification. Enter the 2FA code above.', type: 'warning' });
      } else if (data.ok && data.addresses) {
        console.log('Privy addresses received:', data.addresses.slice(0, 3)); // Debug: log first 3 addresses
        setAddresses(data.addresses);

        // Show cities that were scraped and limit status
        const citiesInfo = data.citiesScraped
          ? ` from ${data.citiesScraped.length} cities`
          : '';
        const limitStatus = data.limitReached
          ? ` (limit of ${data.limit} reached!)`
          : '';
        setStatus({
          message: `✅ Fetched ${data.addresses.length}/${data.limit} addresses${citiesInfo}${limitStatus}`,
          type: 'success'
        });

        // Auto-fetch BofA values ENABLED - automatically fetch when addresses arrive
        if (data.addresses.length > 0) {
          // Small delay to let UI update first
          setTimeout(() => {
            // Select all addresses automatically
            setCheckedAddresses(new Set(data.addresses.map((_: any, i: number) => i)));
            fetchBofaForAddresses(data.addresses, 0);
          }, 500);
        }
      } else {
        setStatus({ message: data.message || data.error || 'Failed to fetch addresses', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Fetch ALL states alphabetically (A to Z), one by one
  const fetchAllStatesAlphabetically = async () => {
    if (autoFetchingAll) return;

    // Sort states alphabetically by code
    const sortedStates = [...US_STATES].sort((a, b) => a.code.localeCompare(b.code));

    setAutoFetchingAll(true);
    setAutoFetchAbort(false);
    setAddresses([]);
    setBofaResults({});
    setCheckedAddresses(new Set());

    const allAddresses: Address[] = [];
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');

    for (let i = 0; i < sortedStates.length; i++) {
      // Check if user wants to abort
      if (autoFetchAbort) {
        setStatus({ message: `Stopped after ${i} states. Total addresses: ${allAddresses.length}`, type: 'warning' });
        break;
      }

      const currentState = sortedStates[i];
      setAutoFetchProgress({ currentState: currentState.code, stateIndex: i + 1, totalStates: sortedStates.length });
      setStatus({ message: `Fetching ${currentState.name} (${currentState.code}) - State ${i + 1}/${sortedStates.length}...`, type: 'info' });
      setState(currentState.code);

      try {
        const url = `http://localhost:3015/api/live-scrape/privy?state=${currentState.code}&limit=${limit}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.requiresOTP || data.error?.includes('OTP')) {
          setStatus({ message: `OTP required for ${currentState.code}. Enter code and click "Submit OTP", then resume.`, type: 'warning' });
          // Wait for OTP - pause here
          await new Promise(resolve => setTimeout(resolve, 120000)); // Wait up to 2 minutes for OTP
          continue;
        }

        if (data.ok && data.addresses && data.addresses.length > 0) {
          // Add state to each address and append to all
          const stateAddresses = data.addresses.map((addr: Address) => ({
            ...addr,
            state: currentState.code
          }));
          allAddresses.push(...stateAddresses);
          setAddresses([...allAddresses]);

          setStatus({
            message: `${currentState.code}: Found ${data.addresses.length} addresses. Total: ${allAddresses.length}`,
            type: 'success'
          });

          // Auto-fetch BofA for new addresses
          const startIndex = allAddresses.length - stateAddresses.length;
          await fetchBofaForAddresses(stateAddresses, startIndex);
        } else {
          setStatus({ message: `${currentState.code}: No addresses found or error. Moving to next state...`, type: 'info' });
        }

        // Small delay between states to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        console.error(`Error fetching ${currentState.code}:`, error);
        setStatus({ message: `Error in ${currentState.code}: ${error.message}. Continuing...`, type: 'error' });
        // Continue to next state on error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setAutoFetchingAll(false);
    if (!autoFetchAbort) {
      setStatus({
        message: `Completed all ${sortedStates.length} states! Total addresses: ${allAddresses.length}`,
        type: 'success'
      });

      // Select all and save to deals
      if (allAddresses.length > 0) {
        setCheckedAddresses(new Set(allAddresses.map((_, i) => i)));
      }
    }
  };

  // Stop the auto-fetch process
  const stopAutoFetch = () => {
    setAutoFetchAbort(true);
    setStatus({ message: 'Stopping after current state completes...', type: 'warning' });
  };

  const submitOTP = async () => {
    if (otpCode.length !== 6) { alert('Please enter a 6-digit code'); return; }
    setStatus({ message: 'Submitting verification code...', type: 'info' });
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const response = await fetch('http://localhost:3015/api/automation/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: otpCode, service: 'privy' }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        setOtpCode('');
        setStatus({ message: 'Code submitted successfully!', type: 'success' });
      } else {
        setStatus({ message: data.error || 'Failed to submit code. Please try again.', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    }
  };

  // Parse stats array to extract individual values
  const parseStats = (stats?:
     string[]) => {
    if (!stats || stats.length === 0) return {};
    const result: Record<string, string> = {};
    for (const stat of stats) {
      if (stat.startsWith('Beds')) result.beds = stat.replace('Beds', '');
      else if (stat.startsWith('Baths')) result.baths = stat.replace('Baths', '');
      else if (stat.startsWith('Square Ft')) result.sqft = stat.replace('Square Ft', '');
      else if (stat.startsWith('Built')) result.built = stat.replace('Built', '');
      else if (stat.startsWith('Lot')) result.lot = stat.replace('Lot', '');
      else if (stat.startsWith('Type')) result.type = stat.replace('Type', '');
    }
    return result;
  };

  // Handle row click - extract state from address and update dropdown
  const handleRowClick = (addr: Address) => {
    // Extract state from address and update the state dropdown
    let extractedState = addr.state;
    if (!extractedState && addr.fullAddress) {
      // Try to extract state from full address (e.g., "123 Main St, Newark, NJ 07102")
      const stateMatch = addr.fullAddress.match(/,\s*([A-Z]{2})\s*\d{5}/);
      if (stateMatch && stateMatch[1]) {
        extractedState = stateMatch[1];
      }
    }
    // Update state dropdown if valid state found
    if (extractedState && US_STATES.some(s => s.code === extractedState)) {
      setState(extractedState);
    }
    setSelected(addr);
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Privy Properties</h2>
        <div style={{ fontSize: 14, color: '#6b7280' }}>Total: {addresses.length}</div>
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
        <Card title="With Agent Info" value={totals.withAgent} />
        <Card title="With AMV" value={totals.withAmv} />
      </div>

      {/* Filters Info */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: '#6b7280', mr: 1 }}>Applied Filters:</Typography>
        {APPLIED_FILTERS.map((f) => (
          <Chip key={f.label} label={`${f.label}: ${f.value}`} size="small" sx={{ bgcolor: '#e0f2fe', color: '#0369a1' }} />
        ))}
      </Box>

      {/* Search Form */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200, '& .MuiOutlinedInput-root': { color: '#000', '& fieldset': { borderColor: '#000' } }, '& .MuiInputLabel-root': { color: '#000' }, '& .MuiSelect-icon': { color: '#000' } }}>
            <InputLabel>Select State</InputLabel>
            <Select
              value={state}
              label="Select State"
              onChange={(e) => {
                setState(e.target.value);
                setAddresses([]);
                setBofaResults({});
                setCheckedAddresses(new Set());
              }}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000', maxHeight: 400 } } }}
            >
              {US_STATES.map((s) => (<MenuItem key={s.code} value={s.code}>{s.name}</MenuItem>))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140, '& .MuiOutlinedInput-root': { color: '#000', '& fieldset': { borderColor: '#000' } }, '& .MuiInputLabel-root': { color: '#000' }, '& .MuiSelect-icon': { color: '#000' } }}>
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
              <MenuItem value={200}>200 addresses</MenuItem>
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={fetchAddresses}
            disabled={loading || autoFetchingAll || !state}
            sx={{ backgroundColor: '#0ea5e9', '&:hover': { backgroundColor: '#0284c7' }, textTransform: 'none', fontWeight: 600, px: 4 }}
          >
            {loading ? 'Fetching...' : 'Fetch Properties'}
          </Button>

          {/* Fetch ALL States button */}
          {!autoFetchingAll ? (
            <Button
              variant="contained"
              onClick={fetchAllStatesAlphabetically}
              disabled={loading || autoFetchingAll}
              sx={{ backgroundColor: '#7c3aed', '&:hover': { backgroundColor: '#6d28d9' }, textTransform: 'none', fontWeight: 600, px: 3 }}
            >
              Fetch ALL States (A-Z)
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={stopAutoFetch}
              sx={{ backgroundColor: '#dc2626', '&:hover': { backgroundColor: '#b91c1c' }, textTransform: 'none', fontWeight: 600, px: 3 }}
            >
              Stop ({autoFetchProgress.currentState} - {autoFetchProgress.stateIndex}/{autoFetchProgress.totalStates})
            </Button>
          )}

          <Button
            variant="outlined"
            onClick={() => {
              const privyUrl = `https://app.privy.pro/dashboard?location_type=state&state=${state}&project_type=buy_hold&list_price_from=20000&list_price_to=600000&beds_from=3&sqft_from=1000&hoa=no&include_detached=true&include_active=true&date_range=all&sort_by=days-on-market&sort_dir=asc`;
              window.open(privyUrl, '_blank');
            }}
            disabled={!state}
            sx={{ borderColor: '#7c3aed', color: '#7c3aed', '&:hover': { borderColor: '#6d28d9', backgroundColor: '#f5f3ff' }, textTransform: 'none', fontWeight: 600, px: 3 }}
          >
            View on Privy
          </Button>
        </div>
      </div>

      {/* Status Message */}
      {status && <Alert severity={status.type} sx={{ mb: 2 }} onClose={() => setStatus(null)}>{status.message}</Alert>}

      {/* OTP Box */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Typography variant="subtitle2" sx={{ color: '#166534', fontWeight: 600 }}>Privy 2FA Code</Typography>
            <Typography variant="caption" sx={{ color: '#4b5563' }}>Enter the verification code from your email if prompted</Typography>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TextField
              value={otpCode}
              onChange={(e) => { const val = e.target.value.replace(/[^0-9]/g, ''); setOtpCode(val); }}
              placeholder="000000"
              size="small"
              sx={{ width: 140, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#16a34a' } } }}
              inputProps={{ maxLength: 6, style: { textAlign: 'center', fontSize: '1.1rem', letterSpacing: '0.3rem', fontWeight: 'bold' } }}
            />
            <Button variant="contained" onClick={submitOTP} disabled={otpCode.length !== 6}
              sx={{ backgroundColor: '#16a34a', '&:hover': { backgroundColor: '#15803d' }, textTransform: 'none', fontWeight: 600 }}>
              Submit OTP
            </Button>
          </div>
        </div>
      </Paper>

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
              : 'Select addresses and click "Send to BofA" to fetch values'}
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
                Deep scraping for agent name, phone, email, brokerage...
              </span>
            </>
          ) : (
            <>
              <Button
                variant="contained"
                onClick={enrichAgentDetails}
                disabled={enrichingAgents || checkedAddresses.size === 0}
                sx={{
                  backgroundColor: '#7c3aed',
                  '&:hover': { backgroundColor: '#6d28d9' },
                  '&:disabled': { backgroundColor: '#9ca3af' },
                  textTransform: 'none',
                }}
              >
                Enrich Agent Info ({checkedAddresses.size} selected)
              </Button>
              <span style={{ color: '#166534', fontSize: 14 }}>
                Select addresses and enrich to get agent name, phone, email & brokerage
              </span>
            </>
          )}
        </div>
      )}

      {/* Results Table */}
      <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              <th style={{ padding: '12px 8px', borderBottom: '1px solid rgba(255,255,255,0.12)', position: 'sticky', top: 0, zIndex: 1, width: 50 }}>
                <Checkbox
                  checked={addresses.length > 0 && checkedAddresses.size === addresses.length}
                  indeterminate={checkedAddresses.size > 0 && checkedAddresses.size < addresses.length}
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
            {addresses.map((addr, i) => {
              const bofaData = bofaResults[i];
              const zebra = i % 2 === 0 ? '#ffffff' : '#f9fafb';
              return (
                <tr key={i} onClick={() => handleRowClick(addr)} style={{ background: zebra, cursor: 'pointer' }}>
                  <td style={{ ...tdBase, padding: '8px', textAlign: 'center' }}>
                    <Checkbox
                      checked={checkedAddresses.has(i)}
                      onChange={(e) => { e.stopPropagation(); toggleCheck(i); }}
                      onClick={(e) => e.stopPropagation()}
                      size="small"
                    />
                  </td>
                  <td style={tdLWide}><div style={{ fontWeight: 600 }}>{addr.fullAddress || '—'}</div></td>
                  <td style={{ ...tdR, color: '#059669', fontWeight: 600 }}>{addr.price || '—'}</td>
                  {/* Agent columns */}
                  <td style={{ ...tdL, maxWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{addr.agentName || '—'}</span>
                      {addr.agentEnriched && (
                        <span style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          backgroundColor: '#7c3aed',
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
                      <a href={`mailto:${addr.agentEmail}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>
                        {addr.agentEmail}
                      </a>
                    ) : '—'}
                  </td>
                  {/* BofA Result columns */}
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined }}>{bofaData ? fmt(bofaData.avgSalePrice) : '—'}</td>
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined }}>{bofaData ? fmt(bofaData.estimatedHomeValue) : '—'}</td>
                  <td style={{ ...tdR, backgroundColor: bofaData ? '#f0f9ff' : undefined, fontWeight: bofaData ? 600 : undefined }}>{bofaData ? fmt(bofaData.amv) : '—'}</td>
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
                      {addr.privyUrl && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(addr.privyUrl, '_blank');
                          }}
                          sx={{
                            backgroundColor: '#7c3aed',
                            '&:hover': { backgroundColor: '#6d28d9' },
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
            {!addresses.length && (
              <tr><td colSpan={11} style={{ padding: 18, textAlign: 'center', color: '#6b7280' }}>
                No properties loaded. Select a state and click "Fetch Properties" to load data.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {selected && (() => {
          const stats = parseStats(selected.stats);
          return (
            <>
              <DialogTitle sx={{ background: '#111827', color: '#fff' }}>Property Details</DialogTitle>
              <DialogContent dividers>
                <Stack spacing={2}>
                  <Info label="Full Address" value={selected.fullAddress || '—'} />
                  <Info label="Price" value={selected.price || '—'} />
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <Info label="Beds" value={stats.beds || '—'} />
                    <Info label="Baths" value={stats.baths || '—'} />
                    <Info label="Sq Ft" value={stats.sqft || '—'} />
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <Info label="Year Built" value={stats.built || '—'} />
                    <Info label="Lot Size" value={stats.lot || '—'} />
                    <Info label="Property Type" value={stats.type || '—'} />
                  </div>
                  <Info label="State" value={selected.state || '—'} />

                  {/* Agent Information Section */}
                  {(selected.agentName || selected.agentPhone || selected.agentEmail || selected.brokerage) && (
                    <div style={{
                      background: '#f5f3ff',
                      border: '1px solid #c4b5fd',
                      borderRadius: 10,
                      padding: 12,
                      marginTop: 8
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#7c3aed', marginBottom: 8 }}>
                        Agent Information
                      </div>
                      <Stack spacing={1.5}>
                        <Info label="Agent Name" value={selected.agentName || '—'} />
                        <Info label="Brokerage" value={selected.brokerage || '—'} />
                        <Info label="Phone" value={selected.agentPhone || '—'} />
                        {selected.agentEmail && (
                          <div style={{
                            flex: 1,
                            minWidth: 180,
                            background: '#fafafa',
                            border: '1px solid #eee',
                            borderRadius: 10,
                            padding: '10px 12px',
                          }}>
                            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Email</div>
                            <a href={`mailto:${selected.agentEmail}`} style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none' }}>
                              {selected.agentEmail}
                            </a>
                          </div>
                        )}
                      </Stack>
                    </div>
                  )}

                  {selected.privyUrl && (
                    <div style={{ background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Listing URL</div>
                      <a
                        href={selected.privyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}
                      >
                        View on Privy.pro →
                      </a>
                    </div>
                  )}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSelected(null)}>Close</Button>
                {selected.privyUrl && (
                  <Button
                    variant="contained"
                    onClick={() => window.open(selected.privyUrl, '_blank')}
                    sx={{
                      backgroundColor: '#7c3aed',
                      '&:hover': { backgroundColor: '#6d28d9' }
                    }}
                  >
                    View Listing on Privy
                  </Button>
                )}
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </div>
  );
}

// Helper components
function Card({ title, value }: { title: string; value: number | string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 16, background: '#fff' }}>
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

// Table style constants
const tdBase: React.CSSProperties = {
  padding: '14px',
  borderBottom: '1px solid #eef2f7',
  color: '#111827',
  verticalAlign: 'top',
};
const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdLWide: React.CSSProperties = { ...tdL, minWidth: 260 };


