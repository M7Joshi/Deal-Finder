// src/screens/RedfinAMVTest.tsx
// Live dashboard to test and watch Redfin AMV API performance
// Shows real-time data feed like Redfin Fetcher

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Chip,
  Card,
  CardContent,
  TextField,
  Alert,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SpeedIcon from '@mui/icons-material/Speed';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import RefreshIcon from '@mui/icons-material/Refresh';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3015';

interface Stats {
  totalRedfin: number;
  withPropertyId: number;
  pendingAMV: number;
  withAMV: number;
}

interface Result {
  index: number;
  total: number;
  fullAddress: string;
  propertyId: string;
  listingPrice: number | null;
  amv: number | null;
  success: boolean;
  error: string | null;
  timeMs: number;
  isDeal: boolean;
}

interface Summary {
  total: number;
  successful: number;
  failed: number;
  deals: number;
  totalTimeMs: number;
  avgTimeMs: number;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

export default function RedfinAMVTest() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [limit, setLimit] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  // Auto-scroll to bottom when new results come in
  useEffect(() => {
    if (tableRef.current && running) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight;
    }
  }, [results, running]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/redfin-amv-test/stats`);
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const startStream = () => {
    setRunning(true);
    setResults([]);
    setSummary(null);
    setError(null);
    setCurrentIndex(0);
    setTotalCount(0);

    const eventSource = new EventSource(`${API_BASE}/api/redfin-amv-test/stream-batch?limit=${limit}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'start') {
        setTotalCount(data.total);
        console.log(`Starting batch of ${data.total} properties`);
      } else if (data.type === 'result') {
        setCurrentIndex(data.index);
        setResults((prev) => [...prev, data]);
      } else if (data.type === 'complete') {
        setSummary(data.summary || data);
        setRunning(false);
        eventSource.close();
        fetchStats(); // Refresh stats
      } else if (data.type === 'error') {
        setError(data.error);
        setRunning(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError('Connection lost');
      setRunning(false);
      eventSource.close();
    };
  };

  const stopStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setRunning(false);
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getSpeedColor = (ms: number) => {
    if (ms < 400) return '#22c55e'; // green
    if (ms < 800) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Redfin AMV Speed Test
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Watch real-time AMV data from Redfin API (no browser needed)
          </Typography>
        </Box>
        <Chip
          icon={<SpeedIcon />}
          label="~300ms per address"
          color="success"
          variant="outlined"
        />
      </Box>

      {/* Stats Cards */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Card variant="outlined" sx={{ flex: '1 1 150px', minWidth: 150 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography color="text.secondary" variant="caption">
              Total Redfin
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {stats?.totalRedfin?.toLocaleString() || '—'}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: '1 1 150px', minWidth: 150 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography color="text.secondary" variant="caption">
              With Property ID
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {stats?.withPropertyId?.toLocaleString() || '—'}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: '1 1 150px', minWidth: 150 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography color="text.secondary" variant="caption">
              Pending AMV
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'warning.main' }}>
              {stats?.pendingAMV?.toLocaleString() || '—'}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: '1 1 150px', minWidth: 150 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography color="text.secondary" variant="caption">
              With AMV
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>
              {stats?.withAMV?.toLocaleString() || '—'}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Batch Size"
            type="number"
            size="small"
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
            disabled={running}
            sx={{ width: 100 }}
            inputProps={{ min: 1, max: 100 }}
          />

          {!running ? (
            <Button
              variant="contained"
              color="success"
              startIcon={<PlayArrowIcon />}
              onClick={startStream}
              disabled={!stats?.pendingAMV}
              sx={{ fontWeight: 600 }}
            >
              Start Test
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              startIcon={<StopIcon />}
              onClick={stopStream}
              sx={{ fontWeight: 600 }}
            >
              Stop
            </Button>
          )}

          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchStats}
            disabled={running}
          >
            Refresh
          </Button>

          {running && totalCount > 0 && (
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Processing...
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {currentIndex} / {totalCount}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={(currentIndex / totalCount) * 100}
                sx={{ height: 8, borderRadius: 1 }}
              />
            </Box>
          )}
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Summary */}
      {summary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f0fdf4', borderColor: '#22c55e' }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700, color: '#166534' }}>
            Test Complete
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Total</Typography>
              <Typography variant="h6" fontWeight={700}>{summary.total}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Success</Typography>
              <Typography variant="h6" fontWeight={700} color="success.main">{summary.successful}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Failed</Typography>
              <Typography variant="h6" fontWeight={700} color="error.main">{summary.failed}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Deals</Typography>
              <Typography variant="h6" fontWeight={700} color="primary.main">{summary.deals}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Total Time</Typography>
              <Typography variant="h6" fontWeight={700}>{formatTime(summary.totalTimeMs)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Avg Time</Typography>
              <Typography variant="h6" fontWeight={700}>{formatTime(summary.avgTimeMs)}</Typography>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Live Results Table */}
      <Paper variant="outlined">
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f9fafb' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Live Data Feed {results.length > 0 && `(${results.length} addresses)`}
          </Typography>
        </Box>
        <TableContainer ref={tableRef} sx={{ maxHeight: 500, overflowY: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 50 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 50 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Address</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }}>Property ID</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">List Price</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">AMV</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 80 }} align="center">Deal?</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 80 }} align="right">Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.length === 0 && !running && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Click "Start Test" to begin fetching AMV data
                  </TableCell>
                </TableRow>
              )}
              {results.length === 0 && running && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Waiting for data...
                  </TableCell>
                </TableRow>
              )}
              {results.map((row, idx) => (
                <TableRow
                  key={idx}
                  sx={{
                    bgcolor: row.isDeal ? '#f0fdf4' : row.success ? 'inherit' : '#fef2f2',
                    '&:hover': { bgcolor: row.isDeal ? '#dcfce7' : row.success ? '#f9fafb' : '#fee2e2' },
                    transition: 'background-color 0.2s',
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{row.index}</Typography>
                  </TableCell>
                  <TableCell>
                    {row.success ? (
                      <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 20 }} />
                    ) : (
                      <ErrorIcon sx={{ color: '#ef4444', fontSize: 20 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {row.fullAddress}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                      {row.propertyId}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">{fmt(row.listingPrice)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: row.success ? '#166534' : '#991b1b',
                      }}
                    >
                      {row.success ? fmt(row.amv) : row.error}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {row.isDeal && (
                      <Chip
                        icon={<TrendingUpIcon sx={{ fontSize: 14 }} />}
                        label="DEAL"
                        size="small"
                        sx={{
                          bgcolor: '#22c55e',
                          color: 'white',
                          fontWeight: 600,
                          fontSize: 10,
                          height: 22,
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        color: getSpeedColor(row.timeMs),
                      }}
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

      {/* Speed Comparison Info */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: '#f8fafc' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <SpeedIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="subtitle2" fontWeight={600}>
            Speed Comparison
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="caption" color="text.secondary">API Method (new)</Typography>
            <Typography variant="body1" fontWeight={600} color="success.main">~300ms / address</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Browser Method (old)</Typography>
            <Typography variant="body1" fontWeight={600} color="text.secondary">~4500ms / address</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Speedup</Typography>
            <Typography variant="body1" fontWeight={700} color="primary.main">~15x FASTER</Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
