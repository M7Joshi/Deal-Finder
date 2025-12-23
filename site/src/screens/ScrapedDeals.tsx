// src/screens/ScrapedDeals.tsx
import React, { useEffect, useState, useCallback } from 'react';
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
  Chip,
  CircularProgress,
  Checkbox,
  ListItemText,
  OutlinedInput,
  LinearProgress,
  Box,
} from '@mui/material';
import { apiFetch } from '../helpers';

interface ScrapedDeal {
  _id: string;
  address: string;
  fullAddress: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  listingPrice?: number | null;
  amv?: number | null;
  source: 'privy' | 'redfin';
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  scrapedAt?: string;
  bofaFetchedAt?: string | null;
  createdAt?: string;
  // Agent details
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

const sourceColors: Record<string, { bg: string; text: string }> = {
  privy: { bg: '#f5f3ff', text: '#7c3aed' },
  redfin: { bg: '#fef2f2', text: '#dc2626' },
};

// All US states
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

export default function ScrapedDeals() {
  const [deals, setDeals] = useState<ScrapedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScrapedDeal | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null); // Track which row's agent is expanded

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('');

  // Auto Fetch state
  const [autoFetchStates, setAutoFetchStates] = useState<string[]>(['NC', 'TX']);
  const [autoFetchLimit, setAutoFetchLimit] = useState(10);
  const [autoFetching, setAutoFetching] = useState(false);
  const [autoFetchStatus, setAutoFetchStatus] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<{
    total: number;
    withAmv: number;
    bySource: Record<string, number>;
    byState: Record<string, number>;
  } | null>(null);

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (sourceFilter) params.set('source', sourceFilter);
      if (stateFilter) params.set('state', stateFilter);
      params.set('limit', '500');

      const res = await apiFetch(`/api/scraped-deals?${params.toString()}`);
      const data = await res.json();

      if (data.ok) {
        setDeals(data.rows || []);
      } else {
        setError(data.error || 'Failed to load deals');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, stateFilter]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch('/api/scraped-deals/stats');
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  useEffect(() => {
    loadDeals();
    loadStats();
  }, [loadDeals, loadStats]);

  // Get unique states from deals for filter
  const uniqueStates = [...new Set(deals.map(d => d.state).filter(Boolean))].sort() as string[];

  // Delete a single deal
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this deal?')) return;
    try {
      const res = await apiFetch(`/api/scraped-deals/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        setDeals(prev => prev.filter(d => d._id !== id));
        setSelected(null);
        loadStats();
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // Delete all deals
  const handleDeleteAll = async () => {
    const filterDesc = sourceFilter || stateFilter
      ? `all ${sourceFilter || ''} ${stateFilter || ''} deals`.trim()
      : 'ALL deals';
    if (!window.confirm(`Are you sure you want to delete ${filterDesc}? This cannot be undone.`)) return;

    try {
      const params = new URLSearchParams();
      if (sourceFilter) params.set('source', sourceFilter);
      if (stateFilter) params.set('state', stateFilter);

      const res = await apiFetch(`/api/scraped-deals?${params.toString()}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        loadDeals();
        loadStats();
      }
    } catch (err) {
      console.error('Failed to delete all:', err);
    }
  };

  // Auto Fetch - trigger Privy + Redfin for selected states
  const handleAutoFetch = async () => {
    if (autoFetchStates.length === 0) {
      alert('Please select at least one state');
      return;
    }

    setAutoFetching(true);
    setAutoFetchStatus(`Starting auto-fetch for ${autoFetchStates.length} states...`);

    try {
      const res = await apiFetch('/api/auto-fetch/run', {
        method: 'POST',
        body: JSON.stringify({
          states: autoFetchStates,
          limitPerSource: autoFetchLimit,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        setAutoFetchStatus(`Done! Fetched ${data.totalFetched} addresses. Saved: ${data.saved}, Updated: ${data.updated}, Failed: ${data.failed}`);
        // Refresh the deals list
        loadDeals();
        loadStats();
      } else {
        setAutoFetchStatus(`Error: ${data.error || 'Auto-fetch failed'}`);
      }
    } catch (err: any) {
      console.error('Auto-fetch failed:', err);
      setAutoFetchStatus(`Error: ${err?.message || 'Auto-fetch failed'}`);
    } finally {
      setAutoFetching(false);
    }
  };

  return (
    <div style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111' }}>Scraped Deals</h2>
        <div style={{ fontSize: 14, color: '#6b7280' }}>
          {loading ? 'Loading...' : `${deals.length} deals`}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Card title="Total" value={stats.total} />
          <Card title="With AMV" value={stats.withAmv} />
          <Card title="Privy" value={stats.bySource?.privy || 0} color="#7c3aed" />
          <Card title="Redfin" value={stats.bySource?.redfin || 0} color="#dc2626" />
        </div>
      )}

      {/* Auto Fetch Section */}
      <div
        style={{
          background: '#fff',
          border: '2px solid #22c55e',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 12, fontSize: 16 }}>
          Auto Fetch (Privy + Redfin)
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 300 }}>
            <InputLabel>Select States</InputLabel>
            <Select
              multiple
              value={autoFetchStates}
              onChange={(e) => setAutoFetchStates(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
              input={<OutlinedInput label="Select States" />}
              renderValue={(selected) => selected.join(', ')}
              MenuProps={{ PaperProps: { sx: { maxHeight: 400 } } }}
            >
              {US_STATES.map((s) => (
                <MenuItem key={s.code} value={s.code}>
                  <Checkbox checked={autoFetchStates.indexOf(s.code) > -1} />
                  <ListItemText primary={`${s.code} - ${s.name}`} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Addresses per Source</InputLabel>
            <Select
              value={autoFetchLimit}
              label="Addresses per Source"
              onChange={(e) => setAutoFetchLimit(Number(e.target.value))}
            >
              <MenuItem value={5}>5 per source</MenuItem>
              <MenuItem value={10}>10 per source</MenuItem>
              <MenuItem value={15}>15 per source</MenuItem>
              <MenuItem value={20}>20 per source</MenuItem>
              <MenuItem value={25}>25 per source</MenuItem>
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={handleAutoFetch}
            disabled={autoFetching || autoFetchStates.length === 0}
            sx={{
              backgroundColor: '#22c55e',
              '&:hover': { backgroundColor: '#16a34a' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
              fontWeight: 600,
              px: 4,
              py: 1,
            }}
          >
            {autoFetching ? 'Fetching...' : `Auto Fetch (${autoFetchStates.length} states)`}
          </Button>
        </div>

        {/* Progress/Status */}
        {autoFetching && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress color="success" />
          </Box>
        )}
        {autoFetchStatus && (
          <div style={{
            marginTop: 12,
            padding: 10,
            background: autoFetchStatus.startsWith('Error') ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${autoFetchStatus.startsWith('Error') ? '#fecaca' : '#86efac'}`,
            borderRadius: 8,
            color: autoFetchStatus.startsWith('Error') ? '#dc2626' : '#16a34a',
            fontSize: 14,
          }}>
            {autoFetchStatus}
          </div>
        )}

        <div style={{ marginTop: 12, color: '#6b7280', fontSize: 13 }}>
          Will fetch {autoFetchLimit} addresses from Privy + {autoFetchLimit} from Redfin per state, then auto-fetch BofA AMV and save to database.
          <br />
          Total expected: ~{autoFetchStates.length * autoFetchLimit * 2} addresses
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Source</InputLabel>
          <Select
            value={sourceFilter}
            label="Source"
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <MenuItem value="">All Sources</MenuItem>
            <MenuItem value="privy">Privy</MenuItem>
            <MenuItem value="redfin">Redfin</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>State</InputLabel>
          <Select
            value={stateFilter}
            label="State"
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <MenuItem value="">All States</MenuItem>
            {uniqueStates.map(s => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          onClick={() => { setSourceFilter(''); setStateFilter(''); }}
          sx={{ textTransform: 'none' }}
        >
          Clear Filters
        </Button>

        <Button
          variant="outlined"
          onClick={loadDeals}
          sx={{ textTransform: 'none' }}
        >
          Refresh
        </Button>

        <div style={{ flex: 1 }} />

        <Button
          variant="outlined"
          color="error"
          onClick={handleDeleteAll}
          disabled={deals.length === 0}
          sx={{ textTransform: 'none' }}
        >
          Delete {sourceFilter || stateFilter ? 'Filtered' : 'All'}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <CircularProgress />
        </div>
      )}

      {/* Table */}
      {!loading && (
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
                {['Address', 'State', 'L.P', 'AMV', 'Source', 'Agent', 'Actions'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? 'left' : i === 6 ? 'center' : 'right',
                      padding: '12px 14px',
                      fontSize: 12,
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((deal, i) => {
                const zebra = i % 2 === 0 ? '#ffffff' : '#f9fafb';
                const sourceStyle = sourceColors[deal.source] || { bg: '#f3f4f6', text: '#374151' };
                const hasAgentInfo = deal.agentName || deal.agentPhone || deal.agentEmail;
                const isAgentExpanded = expandedAgentId === deal._id;
                return (
                  <React.Fragment key={deal._id}>
                    <tr
                      style={{ background: zebra, cursor: 'pointer' }}
                      onClick={() => setSelected(deal)}
                    >
                      <td style={{ padding: 14, minWidth: 280 }}>
                        <div style={{ fontWeight: 600, color: '#111' }}>{deal.fullAddress || deal.address || '—'}</div>
                      </td>
                      <td style={{ padding: 14, textAlign: 'right', color: '#6b7280' }}>{deal.state || '—'}</td>
                      <td style={{ padding: 14, textAlign: 'right', color: '#059669', fontWeight: 600 }}>{fmt(deal.listingPrice)}</td>
                      <td style={{ padding: 14, textAlign: 'right', color: '#0369a1', fontWeight: 600 }}>{fmt(deal.amv)}</td>
                      <td style={{ padding: 14, textAlign: 'right' }}>
                        <Chip
                          label={deal.source}
                          size="small"
                          sx={{ backgroundColor: sourceStyle.bg, color: sourceStyle.text, fontWeight: 600 }}
                        />
                      </td>
                      <td style={{ padding: 14, textAlign: 'right' }}>
                        {hasAgentInfo ? (
                          <Button
                            size="small"
                            variant={isAgentExpanded ? 'contained' : 'outlined'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedAgentId(isAgentExpanded ? null : deal._id);
                            }}
                            sx={{
                              textTransform: 'none',
                              backgroundColor: isAgentExpanded ? '#7c3aed' : undefined,
                              '&:hover': { backgroundColor: isAgentExpanded ? '#6d28d9' : undefined },
                            }}
                          >
                            {isAgentExpanded ? 'Hide Agent' : 'View Agent'}
                          </Button>
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: 13 }}>No agent</span>
                        )}
                      </td>
                      <td style={{ padding: 14, textAlign: 'center' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(deal);
                          }}
                          sx={{ mr: 1 }}
                        >
                          View
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(deal._id);
                          }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                    {/* Expandable Agent Details Row */}
                    {isAgentExpanded && hasAgentInfo && (
                      <tr style={{ background: '#f5f3ff' }}>
                        <td colSpan={7} style={{ padding: '12px 14px' }}>
                          <div style={{
                            display: 'flex',
                            gap: 24,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            paddingLeft: 20,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#6b7280', fontSize: 13 }}>Name:</span>
                              <span style={{ fontWeight: 600, color: '#111' }}>{deal.agentName || '—'}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#6b7280', fontSize: 13 }}>Phone:</span>
                              {deal.agentPhone ? (
                                <a
                                  href={`tel:${deal.agentPhone}`}
                                  style={{ fontWeight: 600, color: '#7c3aed', textDecoration: 'none' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {deal.agentPhone}
                                </a>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>—</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#6b7280', fontSize: 13 }}>Email:</span>
                              {deal.agentEmail ? (
                                <a
                                  href={`mailto:${deal.agentEmail}`}
                                  style={{ fontWeight: 600, color: '#7c3aed', textDecoration: 'none' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {deal.agentEmail}
                                </a>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>—</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {deals.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                    No scraped deals found. Use the Auto Fetch button above to scrape addresses from Privy and Redfin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ background: '#111827', color: '#fff' }}>
              Deal Details
              <Chip
                label={selected.source}
                size="small"
                sx={{
                  ml: 2,
                  backgroundColor: sourceColors[selected.source]?.bg || '#f3f4f6',
                  color: sourceColors[selected.source]?.text || '#374151',
                }}
              />
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Info label="Full Address" value={selected.fullAddress || selected.address} />
                <div style={{ display: 'flex', gap: 12 }}>
                  <Info label="City" value={selected.city || '—'} />
                  <Info label="State" value={selected.state || '—'} />
                  <Info label="ZIP" value={selected.zip || '—'} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Info label="Listing Price (L.P)" value={fmt(selected.listingPrice)} highlight="green" />
                  <Info label="BofA AMV" value={fmt(selected.amv)} highlight="blue" />
                </div>
                {(selected.beds || selected.baths || selected.sqft) && (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Info label="Beds" value={selected.beds ?? '—'} />
                    <Info label="Baths" value={selected.baths ?? '—'} />
                    <Info label="Sq Ft" value={selected.sqft?.toLocaleString() ?? '—'} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <Info label="Scraped At" value={selected.scrapedAt ? new Date(selected.scrapedAt).toLocaleString() : '—'} />
                  <Info label="BofA Fetched" value={selected.bofaFetchedAt ? new Date(selected.bofaFetchedAt).toLocaleString() : '—'} />
                </div>
                {/* Agent Details Section */}
                {(selected.agentName || selected.agentPhone || selected.agentEmail) && (
                  <div style={{
                    background: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    borderRadius: 10,
                    padding: 12,
                    marginTop: 8,
                  }}>
                    <div style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600, marginBottom: 10 }}>
                      Agent Details
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <Info label="Agent Name" value={selected.agentName || '—'} />
                      <Info
                        label="Phone"
                        value={
                          selected.agentPhone ? (
                            <a href={`tel:${selected.agentPhone}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>
                              {selected.agentPhone}
                            </a>
                          ) : '—'
                        }
                      />
                      <Info
                        label="Email"
                        value={
                          selected.agentEmail ? (
                            <a href={`mailto:${selected.agentEmail}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>
                              {selected.agentEmail}
                            </a>
                          ) : '—'
                        }
                      />
                    </div>
                  </div>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                color="error"
                onClick={() => handleDelete(selected._id)}
              >
                Delete
              </Button>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}

function Card({ title, value, color }: { title: string; value: number | string; color?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fff' }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: color || '#111' }}>{value}</div>
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: 'green' | 'blue' }) {
  const highlightStyles: Record<string, { bg: string; border: string }> = {
    green: { bg: '#f0fdf4', border: '#86efac' },
    blue: { bg: '#f0f9ff', border: '#7dd3fc' },
  };
  const style = highlight ? highlightStyles[highlight] : { bg: '#f9fafb', border: '#e5e7eb' };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 100,
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, color: '#111' }}>{value}</div>
    </div>
  );
}
