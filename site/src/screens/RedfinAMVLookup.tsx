// src/screens/RedfinAMVLookup.tsx
// Test Redfin AMV lookup - manual lookup OR loop through states like automation
// Data persists to database and can resume from where left off

import { useState, useRef, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  Alert,
  Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SpeedIcon from '@mui/icons-material/Speed';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { apiFetch, getApiBaseUrl } from '../helpers';

interface LookupResult {
  id: number;
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  listPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  amv: number | null;
  success: boolean;
  error: string | null;
  timeMs: number;
  isDeal: boolean;
  url?: string;
}

interface Progress {
  currentStateIndex: number;
  currentCityIndex: number;
  currentState: string | null;
  processedCities: number;
  totalScraped: number;
  cycleCount: number;
  totalStates: number;
  totalCities: number;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

export default function RedfinAMVLookup() {
  // Manual lookup state
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Loop state
  const [loopRunning, setLoopRunning] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>('');
  const eventSourceRef = useRef<EventSource | null>(null);

  // Results
  const [results, setResults] = useState<LookupResult[]>([]);
  const [idCounter, setIdCounter] = useState(1);

  // Stats
  const [stats, setStats] = useState({ total: 0, success: 0, deals: 0 });

  // Progress
  const [progress, setProgress] = useState<Progress | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  // Load persisted data on page load
  useEffect(() => {
    loadPersistedData();
  }, []);

  const loadPersistedData = async () => {
    setInitialLoading(true);
    try {
      // Fetch stored results and progress in parallel
      const [resultsRes, progressRes] = await Promise.all([
        apiFetch('/api/redfin-amv-lookup/results?limit=5000'),
        apiFetch('/api/redfin-amv-lookup/progress'),
      ]);

      const resultsData = await resultsRes.json();
      const progressData = await progressRes.json();

      if (resultsData.success && resultsData.results) {
        // Convert stored results to LookupResult format
        const loadedResults: LookupResult[] = resultsData.results.map((r: any, idx: number) => ({
          id: idx + 1,
          propertyId: r.propertyId,
          address: r.address,
          city: r.city,
          state: r.state,
          listPrice: r.listPrice,
          beds: r.beds,
          baths: r.baths,
          sqft: r.sqft,
          amv: r.amv,
          success: r.success,
          error: r.error,
          timeMs: r.timeMs || 0,
          isDeal: r.isDeal,
          url: r.url,
        }));

        setResults(loadedResults);
        setIdCounter(loadedResults.length + 1);
        setStats(resultsData.stats || { total: 0, success: 0, deals: 0 });

        if (loadedResults.length > 0) {
          setCurrentStatus(`Loaded ${loadedResults.length} results from database`);
        }
      }

      if (progressData.success && progressData.progress) {
        setProgress(progressData.progress);
      }
    } catch (err: any) {
      console.error('Failed to load persisted data:', err);
    } finally {
      setInitialLoading(false);
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (tableRef.current && loopRunning) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight;
    }
  }, [results, loopRunning]);

  // Manual fetch
  const handleManualFetch = async () => {
    if (!input.trim()) {
      setError('Please enter a Redfin URL or Property ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/redfin-amv-lookup/fetch', {
        method: 'POST',
        body: JSON.stringify({ input: input.trim() }),
      });

      const data = await res.json();

      const isDeal = data.success && data.listPrice &&
        data.amv >= data.listPrice * 2 && data.amv > 200000;

      const newResult: LookupResult = {
        id: idCounter,
        propertyId: data.propertyId || '',
        address: data.fullAddress || data.address || input.trim(),
        city: data.city || null,
        state: data.state || null,
        listPrice: data.listPrice || null,
        beds: data.beds || null,
        baths: data.baths || null,
        sqft: data.sqft || null,
        amv: data.amv || null,
        success: data.success,
        error: data.error || null,
        timeMs: data.timeMs || 0,
        isDeal,
      };

      setResults(prev => [newResult, ...prev]);
      setIdCounter(prev => prev + 1);
      setStats(prev => ({
        total: prev.total + 1,
        success: prev.success + (data.success ? 1 : 0),
        deals: prev.deals + (isDeal ? 1 : 0),
      }));
      setInput('');
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch AMV');
    } finally {
      setLoading(false);
    }
  };

  // Start loop (resumes from where left off)
  const startLoop = () => {
    setLoopRunning(true);
    setCurrentStatus('Starting...');
    setError(null);

    const eventSource = new EventSource(`${getApiBaseUrl()}/api/redfin-amv-lookup/stream-loop`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'started') {
        setStreamId(data.streamId);
        setCurrentStatus('Connected, starting loop...');
      } else if (data.type === 'status') {
        setCurrentStatus(data.message);
        if (data.resuming) {
          setCurrentStatus(`Resuming... ${data.message}`);
        }
      } else if (data.type === 'result') {
        const newResult: LookupResult = {
          id: data.index,
          propertyId: data.propertyId,
          address: data.address,
          city: data.city,
          state: data.state,
          listPrice: data.listPrice,
          beds: data.beds,
          baths: data.baths,
          sqft: data.sqft,
          amv: data.amv,
          success: data.success,
          error: data.error,
          timeMs: data.timeMs,
          isDeal: data.isDeal,
          url: data.url,
        };

        setResults(prev => [...prev, newResult]);
        setStats(prev => ({
          total: prev.total + 1,
          success: prev.success + (data.success ? 1 : 0),
          deals: prev.deals + (data.isDeal ? 1 : 0),
        }));
        setIdCounter(data.index + 1);
      } else if (data.type === 'complete') {
        setCurrentStatus(`Complete! ${data.summary.total} processed, ${data.summary.deals} deals found`);
        setLoopRunning(false);
        eventSource.close();
      } else if (data.type === 'error') {
        setError(data.error);
        setLoopRunning(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError('Connection lost');
      setLoopRunning(false);
      eventSource.close();
    };
  };

  // Stop loop
  const stopLoop = async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      await apiFetch('/api/redfin-amv-lookup/stop', {
        method: 'POST',
        body: JSON.stringify({ streamId }),
      });
    } catch (err) {
      // Ignore
    }

    setLoopRunning(false);
    setCurrentStatus('Stopped - Click "Start Loop" to resume from where you left off');
  };

  // Reset everything (start fresh)
  const resetAll = async () => {
    if (loopRunning) {
      await stopLoop();
    }

    try {
      await apiFetch('/api/redfin-amv-lookup/reset', {
        method: 'POST',
      });

      setResults([]);
      setStats({ total: 0, success: 0, deals: 0 });
      setIdCounter(1);
      setProgress(null);
      setCurrentStatus('Reset complete - Ready to start fresh');
    } catch (err: any) {
      setError(err?.message || 'Failed to reset');
    }
  };

  const clearResultsView = () => {
    // Only clears the view, not the database
    setResults([]);
    setStats({ total: 0, success: 0, deals: 0 });
    setIdCounter(1);
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getSpeedColor = (ms: number) => {
    if (ms < 400) return '#22c55e';
    if (ms < 800) return '#f59e0b';
    return '#ef4444';
  };

  if (initialLoading) {
    return (
      <Box sx={{ p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress sx={{ mr: 2 }} />
        <Typography>Loading saved results...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          Redfin AMV Lookup
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Test the Redfin AMV API - manual lookup or loop through states automatically.
          Data is saved and can be resumed after refresh.
        </Typography>
      </Box>

      {/* Stats Cards */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">Total</Typography>
          <Typography variant="h5" fontWeight={700}>{stats.total}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">Success</Typography>
          <Typography variant="h5" fontWeight={700} color="success.main">{stats.success}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">Deals</Typography>
          <Typography variant="h5" fontWeight={700} color="primary.main">{stats.deals}</Typography>
        </Paper>
        {progress && progress.processedCities > 0 && (
          <Paper variant="outlined" sx={{ p: 2, minWidth: 150 }}>
            <Typography variant="caption" color="text.secondary">Progress</Typography>
            <Typography variant="h6" fontWeight={700}>
              {progress.processedCities}/{progress.totalCities} cities
            </Typography>
          </Paper>
        )}
        <Chip
          icon={<SpeedIcon />}
          label="~300ms per lookup"
          color="success"
          variant="outlined"
          sx={{ alignSelf: 'center' }}
        />
      </Box>

      {/* Controls Section */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        {/* Loop Controls */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Loop Mode - Scrape States Automatically (Resumes from where left off)
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {!loopRunning ? (
              <Button
                variant="contained"
                color="success"
                startIcon={<PlayArrowIcon />}
                onClick={startLoop}
                sx={{ fontWeight: 600 }}
              >
                {progress && progress.processedCities > 0 ? 'Resume Loop' : 'Start Loop'}
              </Button>
            ) : (
              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={stopLoop}
                sx={{ fontWeight: 600 }}
              >
                Stop Loop
              </Button>
            )}
            <Button
              variant="outlined"
              color="warning"
              startIcon={<RestartAltIcon />}
              onClick={resetAll}
              disabled={loopRunning}
              sx={{ fontWeight: 600 }}
            >
              Reset All
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadPersistedData}
              disabled={loopRunning}
            >
              Reload Data
            </Button>
            {currentStatus && (
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {loopRunning && <CircularProgress size={14} sx={{ mr: 1 }} />}
                {currentStatus}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Manual Lookup */}
        <Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Manual Lookup - Single Property
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label="Redfin URL or Property ID"
              placeholder="5509005 or https://www.redfin.com/.../home/5509005"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !loading && handleManualFetch()}
              disabled={loading || loopRunning}
              size="small"
              sx={{ flex: 1, minWidth: 300 }}
            />
            <Button
              variant="outlined"
              onClick={handleManualFetch}
              disabled={loading || loopRunning || !input.trim()}
              startIcon={loading ? <CircularProgress size={16} /> : <SearchIcon />}
            >
              Lookup
            </Button>
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Results Table */}
      <Paper variant="outlined">
        <Box sx={{
          p: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: '#f9fafb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Results {results.length > 0 && `(${results.length})`}
          </Typography>
          {results.length > 0 && (
            <Button
              size="small"
              startIcon={<DeleteIcon />}
              onClick={clearResultsView}
              sx={{ color: '#6b7280' }}
            >
              Clear View
            </Button>
          )}
        </Box>

        <TableContainer ref={tableRef} sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 40 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 40 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Address</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 80 }}>State</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">List Price</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">AMV</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 70 }} align="center">Deal?</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 70 }} align="right">Speed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Click "Start Loop" to scrape states automatically, or use manual lookup above
                  </TableCell>
                </TableRow>
              )}
              {results.map((row) => (
                <TableRow
                  key={row.id}
                  sx={{
                    bgcolor: row.isDeal ? '#f0fdf4' : row.success ? 'inherit' : '#fef2f2',
                    '&:hover': { bgcolor: row.isDeal ? '#dcfce7' : row.success ? '#f9fafb' : '#fee2e2' },
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{row.id}</Typography>
                  </TableCell>
                  <TableCell>
                    {row.success ? (
                      <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 18 }} />
                    ) : (
                      <ErrorIcon sx={{ color: '#ef4444', fontSize: 18 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {row.address}
                    </Typography>
                    {row.beds && (
                      <Typography variant="caption" color="text.secondary">
                        {row.beds} bed • {row.baths} bath {row.sqft && `• ${row.sqft.toLocaleString()} sqft`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.state || '—'}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">{fmt(row.listPrice)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: row.success ? '#166534' : '#991b1b' }}
                    >
                      {row.success ? fmt(row.amv) : row.error}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {row.isDeal && (
                      <Chip
                        label="DEAL"
                        size="small"
                        sx={{
                          bgcolor: '#22c55e',
                          color: 'white',
                          fontWeight: 600,
                          fontSize: 10,
                          height: 20,
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 500, color: getSpeedColor(row.timeMs) }}
                    >
                      {formatTime(row.timeMs)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
