import { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions, Stack,
  TextField, Alert, Paper, Typography, Box, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../helpers';

interface AgentInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  nmls?: string | null;
}

interface AgentResult {
  ok: boolean;
  address: string;
  agent: AgentInfo | null;
  loanOfficer: AgentInfo | null;
  rawData?: {
    phones?: string[];
    emails?: string[];
    nmls?: string[];
  };
  error?: string;
  scrapedAt: string;
  wellsFargoFetched?: boolean; // Track if Wells Fargo fetch was attempted
}

export default function AgentFetcher() {
  const location = useLocation();
  const [address, setAddress] = useState('');
  const [batchAddresses, setBatchAddresses] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AgentResult[]>([]);
  const [selected, setSelected] = useState<AgentResult | null>(null);
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);
  const [mode, setMode] = useState<'single' | 'batch' | 'deals'>('deals');
  const [currentSelectedAddresses, setCurrentSelectedAddresses] = useState<string[]>([]);

  // Auto-load deals when navigating to this page
  useEffect(() => {
    console.log('[AgentFetcher] useEffect triggered, mode:', mode, 'pathname:', location.pathname);
    if (mode === 'deals') {
      // Check if we have selected addresses from the Deals page
      const selectedAddressesStr = localStorage.getItem('agentFetcherSelectedAddresses');
      console.log('[AgentFetcher] localStorage value:', selectedAddressesStr);
      if (selectedAddressesStr) {
        try {
          const selectedAddresses = JSON.parse(selectedAddressesStr);
          console.log('[AgentFetcher] Parsed addresses:', selectedAddresses);
          if (Array.isArray(selectedAddresses) && selectedAddresses.length > 0) {
            // Clear the stored selection after reading
            localStorage.removeItem('agentFetcherSelectedAddresses');
            // Fetch only the selected deals
            fetchSelectedDeals(selectedAddresses);
            return;
          }
        } catch (e) {
          console.error('Failed to parse selected addresses:', e);
        }
      }
      // Don't load all deals automatically - only load when selected from Deals page
      setLoading(false);
      setStatus({ message: 'Select deals from the Deals page to view their agent information here', type: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, mode]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setStatus({ message: 'Copied to clipboard!', type: 'success' });
    setTimeout(() => setStatus(null), 2000);
  };

  const fetchSingleAgent = async () => {
    if (!address.trim()) {
      setStatus({ message: 'Please enter an address', type: 'warning' });
      return;
    }

    setLoading(true);
    setStatus({ message: 'Fetching agent information... This may take 30-60 seconds.', type: 'info' });

    try {
      const res = await apiFetch(`/api/wellsfargo/agent?address=${encodeURIComponent(address.trim())}`);
      const data = await res.json();

      if (res.ok && data.ok) {
        setResults([data]);
        setStatus({ message: 'Successfully fetched agent information!', type: 'success' });
      } else {
        setStatus({ message: data.error || 'Failed to fetch agent information', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchBatchAgents = async () => {
    const addresses = batchAddresses
      .split('\n')
      .map(a => a.trim())
      .filter(a => a.length > 0);

    if (addresses.length === 0) {
      setStatus({ message: 'Please enter at least one address', type: 'warning' });
      return;
    }

    setLoading(true);
    setResults([]);
    setStatus({ message: `Fetching agent information for ${addresses.length} addresses... This may take a while.`, type: 'info' });

    try {
      const res = await apiFetch('/api/wellsfargo/batch', {
        method: 'POST',
        body: JSON.stringify({ addresses }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        setResults(data.results);
        setStatus({
          message: `Completed: ${data.summary.successful} successful, ${data.summary.failed} failed`,
          type: data.summary.failed > 0 ? 'warning' : 'success'
        });
      } else {
        setStatus({ message: data.error || 'Failed to fetch agent information', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchDealsWithAgents = async () => {
    setLoading(true);
    setResults([]);
    setStatus({ message: 'Loading deals with agent information...', type: 'info' });

    try {
      // Use the same endpoint as the Deals page: /api/properties/table with onlyDeals=true
      const res = await apiFetch('/api/properties/table?onlyDeals=true&limit=500');

      // Check if unauthorized
      if (res.status === 401) {
        setStatus({
          message: 'Authentication required. Please log in to view deals.',
          type: 'error'
        });
        setLoading(false);
        return;
      }

      const data = await res.json();

      // The /api/properties/table endpoint returns { rows } without { ok: true }
      if (res.ok && data.rows) {
        // Transform deals into AgentResult format
        const dealsAsResults: AgentResult[] = (data.rows || []).map((deal: any) => ({
          ok: true,
          address: deal.fullAddress || deal.address,
          agent: deal.agentName || deal.agentEmail || deal.agentPhone ? {
            name: deal.agentName || null,
            email: deal.agentEmail || null,
            phone: deal.agentPhone || null,
          } : null,
          loanOfficer: null,
          rawData: {
            phones: deal.agentPhone ? [deal.agentPhone] : [],
            emails: deal.agentEmail ? [deal.agentEmail] : [],
          },
          scrapedAt: deal.scrapedAt || deal.createdAt || new Date().toISOString(),
        }));

        setResults(dealsAsResults);
        const withAgents = dealsAsResults.filter(r => r.agent !== null).length;
        const withoutAgents = dealsAsResults.length - withAgents;
        setStatus({
          message: `Loaded ${dealsAsResults.length} deals: ${withAgents} with agents, ${withoutAgents} without agents`,
          type: 'success'
        });
      } else {
        const errorMsg = data.error || data.message || `Failed to fetch deals (HTTP ${res.status})`;
        console.error('[AgentFetcher] Error response:', { status: res.status, data });
        setStatus({ message: errorMsg, type: 'error' });
      }
    } catch (error: any) {
      console.error('[AgentFetcher] Fetch error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentsForDealsWithoutAgents = async (dealsToFetch: AgentResult[]) => {
    const dealsWithoutAgents = dealsToFetch.filter(r => !r.agent);
    if (dealsWithoutAgents.length === 0) {
      setStatus({ message: 'All deals already have agent information!', type: 'info' });
      return;
    }

    setLoading(true);
    setStatus({ message: `Fetching agents for ${dealsWithoutAgents.length} deals from Wells Fargo...`, type: 'info' });

    try {
      const addresses = dealsWithoutAgents.map(d => d.address);
      const res = await apiFetch('/api/wellsfargo/batch', {
        method: 'POST',
        body: JSON.stringify({ addresses }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        // Update the results with the newly fetched agent data
        const updatedResults = [...results];

        data.results.forEach((fetchedResult: any) => {
          const index = updatedResults.findIndex(r => r.address.toLowerCase().trim() === fetchedResult.address.toLowerCase().trim());
          if (index !== -1) {
            // Mark as fetched from Wells Fargo
            updatedResults[index] = {
              ...updatedResults[index],
              wellsFargoFetched: true,
            };

            // Only update agent data if found
            if (fetchedResult.ok && (fetchedResult.agent || fetchedResult.loanOfficer)) {
              updatedResults[index] = {
                ...updatedResults[index],
                agent: fetchedResult.agent,
                loanOfficer: fetchedResult.loanOfficer,
                rawData: fetchedResult.rawData,
              };
            }
          }
        });

        setResults(updatedResults);

        // Automatically save to database
        const dealsToSave = updatedResults.filter(r => r.agent || r.loanOfficer);
        setStatus({ message: `Fetched ${data.summary.successful} agents, saving ${dealsToSave.length} to database...`, type: 'info' });
        const saveResult = await saveAgentsToDatabase(dealsToSave);

        setStatus({
          message: `Fetched and saved: ${saveResult.saved} agents saved to database${saveResult.failed > 0 ? `, ${saveResult.failed} failed` : ''}`,
          type: saveResult.saved > 0 ? 'success' : 'error'
        });
      } else {
        setStatus({ message: data.error || 'Failed to fetch agents', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const saveAgentsToDatabase = async (dealsWithAgents: AgentResult[]) => {
    try {
      // Get fresh property data with IDs
      const propsRes = await apiFetch('/api/properties/table?onlyDeals=true&limit=500');
      const propsData = await propsRes.json();
      const propertyMap = new Map<string, string>();
      (propsData.rows || []).forEach((p: any) => {
        const addr = (p.fullAddress || p.address || '').toLowerCase().trim();
        if (addr && p._id) {
          propertyMap.set(addr, String(p._id));
        }
      });

      // Save the agent data to the database
      let saved = 0;
      let failed = 0;
      for (const result of dealsWithAgents) {
        const normalizedAddress = result.address.toLowerCase().trim();
        const propertyId = propertyMap.get(normalizedAddress);
        const agent = result.loanOfficer || result.agent;

        if (propertyId && agent) {
          try {
            await apiFetch(`/api/properties/${encodeURIComponent(propertyId)}`, {
              method: 'PUT',
              body: JSON.stringify({
                agentName: agent.name || '',
                agentEmail: agent.email || '',
                agentPhone: agent.phone || '',
              }),
            });
            saved++;
          } catch (err) {
            console.error('Failed to save agent for', result.address, err);
            failed++;
          }
        }
      }

      return { saved, failed };
    } catch (error: any) {
      console.error('Error saving to database:', error);
      return { saved: 0, failed: dealsWithAgents.length };
    }
  };

  const fetchSelectedDeals = async (selectedAddresses: string[]) => {
    console.log('[AgentFetcher] fetchSelectedDeals called with:', selectedAddresses);
    // Store the selected addresses for later refresh
    setCurrentSelectedAddresses(selectedAddresses);
    setLoading(true);
    setResults([]);
    setStatus({ message: `Loading ${selectedAddresses.length} selected deals with agent information...`, type: 'info' });

    try {
      // Fetch all deals first - USE THE SAME ENDPOINT AS DEALS PAGE
      const res = await apiFetch('/api/scraped-deals/deals?limit=500');
      console.log('[AgentFetcher] API response status:', res.status);

      if (res.status === 401) {
        setStatus({
          message: 'Authentication required. Please log in to view deals.',
          type: 'error'
        });
        setLoading(false);
        return;
      }

      const data = await res.json();
      console.log('[AgentFetcher] API data:', data);
      console.log('[AgentFetcher] API data rows count:', data.rows?.length);

      if (data.ok && data.rows) {
        // Normalize addresses for comparison
        const normalizeAddress = (addr: string) => addr.toLowerCase().trim();
        const selectedAddressesNormalized = new Set(selectedAddresses.map(normalizeAddress));
        console.log('[AgentFetcher] Normalized selected addresses:', Array.from(selectedAddressesNormalized));
        console.log('[AgentFetcher] First 5 deal addresses from API:');
        (data.rows || []).slice(0, 5).forEach((deal: any, idx: number) => {
          console.log(`  ${idx + 1}. fullAddress: "${deal.fullAddress}", address: "${deal.address}"`);
        });

        // Filter to only the selected addresses
        const filteredDeals = (data.rows || []).filter((deal: any) => {
          const dealAddress = normalizeAddress(deal.fullAddress || deal.address || '');
          const matches = selectedAddressesNormalized.has(dealAddress);
          if (matches) {
            console.log('[AgentFetcher] Match found:', dealAddress);
          }
          return matches;
        });
        console.log('[AgentFetcher] Filtered deals count:', filteredDeals.length);

        // Transform deals into AgentResult format
        const dealsAsResults: AgentResult[] = filteredDeals.map((deal: any) => ({
          ok: true,
          address: deal.fullAddress || deal.address,
          agent: deal.agentName || deal.agentEmail || deal.agentPhone ? {
            name: deal.agentName || null,
            email: deal.agentEmail || null,
            phone: deal.agentPhone || null,
          } : null,
          loanOfficer: null,
          rawData: {
            phones: deal.agentPhone ? [deal.agentPhone] : [],
            emails: deal.agentEmail ? [deal.agentEmail] : [],
          },
          scrapedAt: deal.scrapedAt || deal.createdAt || new Date().toISOString(),
        }));

        setResults(dealsAsResults);
        const withAgents = dealsAsResults.filter(r => r.agent !== null).length;
        const withoutAgents = dealsAsResults.length - withAgents;

        // If all deals don't have agents, automatically fetch from Wells Fargo
        if (withoutAgents > 0 && withAgents === 0) {
          setStatus({
            message: `Loaded ${dealsAsResults.length} deals without agent info. Automatically fetching from Wells Fargo...`,
            type: 'info'
          });
          // Auto-fetch agents after a short delay
          setTimeout(() => {
            fetchAgentsForDealsWithoutAgents(dealsAsResults);
          }, 1000);
        } else {
          setStatus({
            message: `Loaded ${dealsAsResults.length} selected deals: ${withAgents} with agents, ${withoutAgents} without agents`,
            type: 'success'
          });
        }
      } else {
        const errorMsg = data.error || data.message || `Failed to fetch deals (HTTP ${res.status})`;
        console.error('[AgentFetcher] Error response:', { status: res.status, data });
        setStatus({ message: errorMsg, type: 'error' });
      }
    } catch (error: any) {
      console.error('[AgentFetcher] Fetch error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (results.length === 0) return;

    const headers = ['Address', 'Agent Name', 'Agent Email', 'Agent Phone', 'Loan Officer Name', 'Loan Officer Email', 'Loan Officer Phone', 'NMLS', 'Scraped At'];
    const rows = results.map(r => [
      r.address,
      r.agent?.name || r.loanOfficer?.name || '',
      r.agent?.email || r.loanOfficer?.email || r.rawData?.emails?.[0] || '',
      r.agent?.phone || r.loanOfficer?.phone || r.rawData?.phones?.[0] || '',
      r.loanOfficer?.name || '',
      r.loanOfficer?.email || r.rawData?.emails?.[0] || '',
      r.loanOfficer?.phone || r.rawData?.phones?.[0] || '',
      r.loanOfficer?.nmls || '',
      r.scrapedAt,
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-data-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetBot = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/wellsfargo/reset', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus({ message: 'Bot reset successfully', type: 'success' });
      } else {
        setStatus({ message: data.error || 'Failed to reset bot', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111' }}>Wells Fargo Agent Fetcher</h2>
        <div style={{ fontSize: 14, color: '#6b7280' }}>Results: {results.length}</div>
      </div>

      {/* Mode Toggle */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
        <Button
          variant={mode === 'deals' ? 'contained' : 'outlined'}
          onClick={() => {
            setMode('deals');
            setResults([]);
            setStatus({ message: 'Select deals from the Deals page to view their agent information here', type: 'info' });
          }}
          sx={{
            backgroundColor: mode === 'deals' ? '#0ea5e9' : undefined,
            borderColor: '#0ea5e9',
            color: mode === 'deals' ? '#fff' : '#0ea5e9',
            '&:hover': { backgroundColor: mode === 'deals' ? '#0284c7' : '#f0f9ff' },
            textTransform: 'none',
          }}
        >
          Selected Deals
        </Button>
        <Button
          variant={mode === 'single' ? 'contained' : 'outlined'}
          onClick={() => setMode('single')}
          sx={{
            backgroundColor: mode === 'single' ? '#0ea5e9' : undefined,
            borderColor: '#0ea5e9',
            color: mode === 'single' ? '#fff' : '#0ea5e9',
            '&:hover': { backgroundColor: mode === 'single' ? '#0284c7' : '#f0f9ff' },
            textTransform: 'none',
          }}
        >
          Single Address
        </Button>
        <Button
          variant={mode === 'batch' ? 'contained' : 'outlined'}
          onClick={() => setMode('batch')}
          sx={{
            backgroundColor: mode === 'batch' ? '#0ea5e9' : undefined,
            borderColor: '#0ea5e9',
            color: mode === 'batch' ? '#fff' : '#0ea5e9',
            '&:hover': { backgroundColor: mode === 'batch' ? '#0284c7' : '#f0f9ff' },
            textTransform: 'none',
          }}
        >
          Batch Mode
        </Button>
      </Box>

      {/* Search Form */}
      {mode !== 'deals' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          {mode === 'single' ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <TextField
              label="Property Address"
              placeholder="e.g., 123 Main St, Newark, NJ 07102"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              size="small"
              sx={{
                minWidth: 400,
                '& .MuiOutlinedInput-root': { color: '#000', '& fieldset': { borderColor: '#d1d5db' } },
                '& .MuiInputLabel-root': { color: '#6b7280' },
              }}
              onKeyPress={(e) => e.key === 'Enter' && fetchSingleAgent()}
            />
            <Button
              variant="contained"
              onClick={fetchSingleAgent}
              disabled={loading || !address.trim()}
              sx={{ backgroundColor: '#0ea5e9', '&:hover': { backgroundColor: '#0284c7' }, textTransform: 'none', fontWeight: 600, px: 4 }}
            >
              {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Fetch Agent'}
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextField
              label="Addresses (one per line)"
              placeholder="123 Main St, Newark, NJ 07102&#10;456 Oak Ave, Jersey City, NJ 07302&#10;789 Elm St, Hoboken, NJ 07030"
              value={batchAddresses}
              onChange={(e) => setBatchAddresses(e.target.value)}
              multiline
              rows={6}
              sx={{
                '& .MuiOutlinedInput-root': { color: '#000', '& fieldset': { borderColor: '#d1d5db' } },
                '& .MuiInputLabel-root': { color: '#6b7280' },
              }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <Button
                variant="contained"
                onClick={fetchBatchAgents}
                disabled={loading || !batchAddresses.trim()}
                sx={{ backgroundColor: '#0ea5e9', '&:hover': { backgroundColor: '#0284c7' }, textTransform: 'none', fontWeight: 600, px: 4 }}
              >
                {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : `Fetch Agents (${batchAddresses.split('\n').filter(a => a.trim()).length})`}
              </Button>
              <Button
                variant="outlined"
                onClick={resetBot}
                disabled={loading}
                sx={{ borderColor: '#ef4444', color: '#ef4444', '&:hover': { borderColor: '#dc2626', backgroundColor: '#fef2f2' }, textTransform: 'none' }}
              >
                Reset Bot
              </Button>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Status Message */}
      {status && <Alert severity={status.type} sx={{ mb: 2 }} onClose={() => setStatus(null)}>{status.message}</Alert>}

      {/* Action Buttons */}
      {results.length > 0 && (
        <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={exportToCSV}
            sx={{ borderColor: '#22c55e', color: '#22c55e', '&:hover': { borderColor: '#16a34a', backgroundColor: '#f0fdf4' }, textTransform: 'none' }}
          >
            Export to CSV
          </Button>
          {mode === 'deals' && (
            <Button
              variant="contained"
              onClick={async () => {
                const dealsWithoutAgents = results.filter(r => !r.agent);
                if (dealsWithoutAgents.length === 0) {
                  setStatus({ message: 'All deals already have agent information!', type: 'info' });
                  return;
                }

                setLoading(true);
                setStatus({ message: `Fetching agents for ${dealsWithoutAgents.length} deals...`, type: 'info' });

                try {
                  const addresses = dealsWithoutAgents.map(d => d.address);
                  const res = await apiFetch('/api/wellsfargo/batch', {
                    method: 'POST',
                    body: JSON.stringify({ addresses }),
                  });
                  const data = await res.json();

                  if (res.ok && data.ok) {
                    // Get fresh property data with IDs
                    const propsRes = await apiFetch('/api/properties/table?onlyDeals=true&limit=500');
                    const propsData = await propsRes.json();
                    const propertyMap = new Map((propsData.rows || []).map((p: any) => [p.fullAddress, p._id]));

                    // Save the fetched agent data to the database
                    let saved = 0;
                    for (const result of data.results) {
                      if (result.ok && (result.agent || result.loanOfficer)) {
                        const propertyId = propertyMap.get(result.address);
                        if (propertyId) {
                          try {
                            const agent = result.loanOfficer || result.agent;
                            await apiFetch(`/api/properties/${encodeURIComponent(propertyId)}`, {
                              method: 'PUT',
                              body: JSON.stringify({
                                agentName: agent?.name || '',
                                agentEmail: agent?.email || '',
                                agentPhone: agent?.phone || '',
                              }),
                            });
                            saved++;
                          } catch (err) {
                            console.error('Failed to save agent for', result.address, err);
                          }
                        }
                      }
                    }

                    setStatus({
                      message: `Completed: ${data.summary.successful} fetched, ${saved} saved to database. Refreshing...`,
                      type: 'success'
                    });
                    // Refresh the deals list to show newly fetched agent info
                    // Use the stored selected addresses to maintain the filtered view
                    setTimeout(() => {
                      if (currentSelectedAddresses.length > 0) {
                        fetchSelectedDeals(currentSelectedAddresses);
                      } else {
                        fetchDealsWithAgents();
                      }
                    }, 2000);
                  } else {
                    setStatus({ message: data.error || 'Failed to fetch agents', type: 'error' });
                  }
                } catch (error: any) {
                  setStatus({ message: `Error: ${error.message}`, type: 'error' });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              sx={{ backgroundColor: '#f59e0b', '&:hover': { backgroundColor: '#d97706' }, textTransform: 'none' }}
            >
              {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Fetch Missing Agents (Auto-saves to DB)'}
            </Button>
          )}
        </Box>
      )}

      {/* Results Table */}
      <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ background: '#111827' }}>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>Address</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>Email</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>Phone</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>NMLS</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 600 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {results.map((result, i) => {
              // Handle empty strings and null values - show "—" for missing data
              const rawName = result.loanOfficer?.name || result.agent?.name;
              const rawEmail = result.loanOfficer?.email || result.agent?.email || result.rawData?.emails?.[0];
              const rawPhone = result.loanOfficer?.phone || result.agent?.phone || result.rawData?.phones?.[0];
              const rawNmls = result.loanOfficer?.nmls;

              // Check if we have any agent data at all
              const hasAgentData = (rawName && rawName.trim()) || (rawEmail && rawEmail.trim()) || (rawPhone && rawPhone.trim());

              // Only show "No Agent Found" if Wells Fargo fetch was attempted and nothing was found
              // Otherwise show "—" (dash) to indicate data not yet fetched
              const name = rawName && rawName.trim()
                ? rawName
                : (hasAgentData ? '—' : (result.wellsFargoFetched ? 'No Agent Found' : '—'));
              const email = rawEmail && rawEmail.trim() ? rawEmail : '—';
              const phone = rawPhone && rawPhone.trim() ? rawPhone : '—';
              const nmls = rawNmls && rawNmls.trim() ? rawNmls : '—';

              return (
                <TableRow
                  key={i}
                  onClick={() => setSelected(result)}
                  sx={{ cursor: 'pointer', '&:hover': { backgroundColor: '#f9fafb' }, background: i % 2 === 0 ? '#fff' : '#f9fafb' }}
                >
                  <TableCell sx={{ color: '#111', fontWeight: 600, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {result.address}
                  </TableCell>
                  <TableCell sx={{ color: name === '—' ? '#9ca3af' : '#111', fontStyle: name === '—' ? 'italic' : 'normal' }}>{name}</TableCell>
                  <TableCell sx={{ color: '#111' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {email !== '—' && (
                        <Tooltip title="Copy email">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); copyToClipboard(email); }}>
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {email}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: '#111' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {phone !== '—' && (
                        <Tooltip title="Copy phone">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); copyToClipboard(phone); }}>
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {phone}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: nmls === '—' ? '#9ca3af' : '#111', fontStyle: nmls === '—' ? 'italic' : 'normal' }}>{nmls}</TableCell>
                  <TableCell>
                    <Box
                      sx={{
                        display: 'inline-block',
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 1,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: !result.ok ? '#fef2f2' : !hasAgentData ? '#fef9c3' : '#dcfce7',
                        color: !result.ok ? '#dc2626' : !hasAgentData ? '#854d0e' : '#16a34a',
                      }}
                    >
                      {!result.ok ? 'Failed' : !hasAgentData ? 'No Agent' : 'Success'}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
            {results.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: 'center', color: '#6b7280', py: 4 }}>
                  No results yet. Enter an address and click "Fetch Agent" to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ background: '#111827', color: '#fff' }}>Agent Details</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Paper elevation={0} sx={{ p: 2, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ color: '#6b7280', mb: 1 }}>Address</Typography>
                  <Typography sx={{ fontWeight: 600, color: '#111' }}>{selected.address}</Typography>
                </Paper>

                {selected.loanOfficer && (
                  <Paper elevation={0} sx={{ p: 2, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 2 }}>
                    <Typography variant="subtitle2" sx={{ color: '#0369a1', mb: 1 }}>Loan Officer</Typography>
                    <Stack spacing={1}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography sx={{ color: '#6b7280' }}>Name:</Typography>
                        <Typography sx={{ fontWeight: 600, color: '#111' }}>{selected.loanOfficer.name || '—'}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography sx={{ color: '#6b7280' }}>Email:</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {selected.loanOfficer.email && (
                            <IconButton size="small" onClick={() => copyToClipboard(selected.loanOfficer!.email!)}>
                              <ContentCopyIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                          <Typography sx={{ fontWeight: 600, color: '#111' }}>{selected.loanOfficer.email || '—'}</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography sx={{ color: '#6b7280' }}>Phone:</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {selected.loanOfficer.phone && (
                            <IconButton size="small" onClick={() => copyToClipboard(selected.loanOfficer!.phone!)}>
                              <ContentCopyIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                          <Typography sx={{ fontWeight: 600, color: '#111' }}>{selected.loanOfficer.phone || '—'}</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography sx={{ color: '#6b7280' }}>NMLS:</Typography>
                        <Typography sx={{ fontWeight: 600, color: '#111' }}>{selected.loanOfficer.nmls || '—'}</Typography>
                      </Box>
                    </Stack>
                  </Paper>
                )}

                {selected.rawData && (
                  <Paper elevation={0} sx={{ p: 2, background: '#fefce8', border: '1px solid #fde047', borderRadius: 2 }}>
                    <Typography variant="subtitle2" sx={{ color: '#854d0e', mb: 1 }}>Raw Data Extracted</Typography>
                    <Stack spacing={1}>
                      {selected.rawData.emails && selected.rawData.emails.length > 0 && (
                        <Box>
                          <Typography sx={{ color: '#6b7280', fontSize: 12 }}>Emails Found:</Typography>
                          {selected.rawData.emails.map((email, i) => (
                            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <IconButton size="small" onClick={() => copyToClipboard(email)}>
                                <ContentCopyIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                              <Typography sx={{ color: '#111' }}>{email}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                      {selected.rawData.phones && selected.rawData.phones.length > 0 && (
                        <Box>
                          <Typography sx={{ color: '#6b7280', fontSize: 12 }}>Phones Found:</Typography>
                          {selected.rawData.phones.map((phone, i) => (
                            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <IconButton size="small" onClick={() => copyToClipboard(phone)}>
                                <ContentCopyIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                              <Typography sx={{ color: '#111' }}>{phone}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                      {selected.rawData.nmls && selected.rawData.nmls.length > 0 && (
                        <Box>
                          <Typography sx={{ color: '#6b7280', fontSize: 12 }}>NMLS Numbers:</Typography>
                          {selected.rawData.nmls.map((nmls, i) => (
                            <Typography key={i} sx={{ color: '#111' }}>{nmls}</Typography>
                          ))}
                        </Box>
                      )}
                    </Stack>
                  </Paper>
                )}

                {selected.error && (
                  <Alert severity="error">{selected.error}</Alert>
                )}

                <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                  Scraped at: {new Date(selected.scrapedAt).toLocaleString()}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelected(null)} sx={{ color: '#111' }}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}
