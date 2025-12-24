// src/screens/PendingAMV.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Button,
} from '@mui/material';
import { apiFetch } from '../helpers';

interface PendingDeal {
  _id: string;
  fullAddress: string;
  state?: string | null;
  listingPrice?: number | null;
  scrapedAt?: string;
  source: 'privy' | 'redfin';
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
}

interface ScraperStatus {
  mode: 'scrape' | 'amv' | 'unknown';
  addressesScrapedThisBatch: number;
  batchLimit: number;
  schedulerEnabled?: boolean;
}

interface PendingByState {
  _id: string;
  count: number;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

const sourceColors: Record<string, { bg: string; text: string }> = {
  privy: { bg: '#f5f3ff', text: '#7c3aed' },
  redfin: { bg: '#fef2f2', text: '#dc2626' },
};

export default function PendingAMV() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus>({
    mode: 'unknown',
    addressesScrapedThisBatch: 0,
    batchLimit: 500,
  });
  const [stats, setStats] = useState({ pendingAMV: 0, withAMV: 0, total: 0 });
  const [pendingByState, setPendingByState] = useState<PendingByState[]>([]);
  const [recentPending, setRecentPending] = useState<PendingDeal[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clearing, setClearing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch('/api/scraped-deals/pending-amv');
      const data = await res.json();

      if (data.ok) {
        setScraperStatus(data.scraperStatus || {
          mode: 'unknown',
          addressesScrapedThisBatch: 0,
          batchLimit: 500,
        });
        setStats(data.stats || { pendingAMV: 0, withAMV: 0, total: 0 });
        setPendingByState(data.pendingByState || []);
        setRecentPending(data.recentPending || []);
      } else {
        setError(data.error || 'Failed to load data');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 5 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const progressPercent = scraperStatus.batchLimit > 0
    ? Math.min(100, (scraperStatus.addressesScrapedThisBatch / scraperStatus.batchLimit) * 100)
    : 0;

  const modeColor = scraperStatus.mode === 'scrape' ? '#22c55e' : scraperStatus.mode === 'amv' ? '#3b82f6' : '#9ca3af';
  const modeLabel = scraperStatus.mode === 'scrape' ? 'SCRAPING' : scraperStatus.mode === 'amv' ? 'FETCHING AMV' : 'UNKNOWN';

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear ALL data and start fresh? This cannot be undone.')) {
      return;
    }
    setClearing(true);
    try {
      const res = await apiFetch('/api/scraped-deals/clear-all', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        alert(`Cleared ${data.cleared?.scrapedDeals || 0} addresses. Ready to start fresh!`);
        loadData();
      } else {
        alert('Failed to clear: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Failed to clear: ' + (err?.message || 'Unknown error'));
    } finally {
      setClearing(false);
    }
  };

  const handleCleanupInvalid = async () => {
    if (!window.confirm('This will remove addresses that look like descriptions (not real addresses). Continue?')) {
      return;
    }
    setClearing(true);
    try {
      const res = await apiFetch('/api/scraped-deals/cleanup-invalid', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        alert(`Removed ${data.deleted} invalid addresses. ${data.after} valid addresses remain.`);
        loadData();
      } else {
        alert('Failed to cleanup: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Failed to cleanup: ' + (err?.message || 'Unknown error'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111' }}>Pending AMV Queue</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            color="warning"
            onClick={handleCleanupInvalid}
            disabled={clearing}
            sx={{ textTransform: 'none' }}
          >
            {clearing ? 'Cleaning...' : 'Cleanup Invalid'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="error"
            onClick={handleClearAll}
            disabled={clearing}
            sx={{ textTransform: 'none' }}
          >
            {clearing ? 'Clearing...' : 'Clear All & Start Fresh'}
          </Button>
          <Button
            variant={autoRefresh ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setAutoRefresh(!autoRefresh)}
            sx={{
              textTransform: 'none',
              backgroundColor: autoRefresh ? '#22c55e' : undefined,
              '&:hover': { backgroundColor: autoRefresh ? '#16a34a' : undefined },
            }}
          >
            {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={loadData}
            sx={{ textTransform: 'none' }}
          >
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Scraper Status Card */}
      <div
        style={{
          background: '#fff',
          border: `2px solid ${modeColor}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              background: modeColor,
              color: '#fff',
              padding: '6px 16px',
              borderRadius: 20,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {modeLabel}
          </div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>
            Current scheduler mode
          </div>
        </div>

        {scraperStatus.mode === 'scrape' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: '#111' }}>
                Batch Progress: {scraperStatus.addressesScrapedThisBatch} / {scraperStatus.batchLimit}
              </span>
              <span style={{ color: '#6b7280' }}>
                {progressPercent.toFixed(1)}%
              </span>
            </div>
            <LinearProgress
              variant="determinate"
              value={progressPercent}
              sx={{
                height: 10,
                borderRadius: 5,
                backgroundColor: '#e5e7eb',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: '#22c55e',
                  borderRadius: 5,
                },
              }}
            />
            <div style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>
              {scraperStatus.batchLimit - scraperStatus.addressesScrapedThisBatch} addresses remaining before switching to AMV mode
            </div>
          </div>
        )}

        {scraperStatus.mode === 'amv' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CircularProgress size={24} sx={{ color: '#3b82f6' }} />
            <span style={{ fontWeight: 600, color: '#111' }}>
              Processing {stats.pendingAMV} addresses for BofA AMV...
            </span>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card title="Pending AMV" value={stats.pendingAMV} color="#f59e0b" highlight />
        <Card title="With AMV" value={stats.withAMV} color="#22c55e" />
        <Card title="Total Scraped" value={stats.total} />
        <Card title="Batch Scraped" value={scraperStatus.addressesScrapedThisBatch} color="#3b82f6" />
      </div>

      {/* Pending by State */}
      {pendingByState.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, color: '#111', marginBottom: 12 }}>
            Pending by State
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingByState.map((s) => (
              <Chip
                key={s._id || 'unknown'}
                label={`${s._id || 'Unknown'}: ${s.count}`}
                sx={{
                  backgroundColor: '#f3f4f6',
                  fontWeight: 600,
                }}
              />
            ))}
          </div>
        </div>
      )}

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

      {/* Recent Pending Table */}
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
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', fontWeight: 700, color: '#111' }}>
            Recent Addresses Waiting for AMV ({recentPending.length} shown)
          </div>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ background: '#111827', color: '#fff' }}>
                {['Address', 'State', 'Listing Price', 'Agent', 'Source', 'Scraped At'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 || i === 3 ? 'left' : 'right',
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
              {recentPending.map((deal, i) => {
                const zebra = i % 2 === 0 ? '#ffffff' : '#f9fafb';
                const sourceStyle = sourceColors[deal.source] || { bg: '#f3f4f6', text: '#374151' };
                return (
                  <tr key={deal._id} style={{ background: zebra }}>
                    <td style={{ padding: 14, minWidth: 280 }}>
                      <div style={{ fontWeight: 600, color: '#111' }}>{deal.fullAddress || '—'}</div>
                    </td>
                    <td style={{ padding: 14, textAlign: 'right', color: '#6b7280' }}>{deal.state || '—'}</td>
                    <td style={{ padding: 14, textAlign: 'right', color: '#059669', fontWeight: 600 }}>{fmt(deal.listingPrice)}</td>
                    <td style={{ padding: 14, minWidth: 180 }}>
                      {deal.agentName ? (
                        <div>
                          <div style={{ fontWeight: 600, color: '#111', fontSize: 13 }}>{deal.agentName}</div>
                          {deal.agentPhone && (
                            <div style={{ color: '#3b82f6', fontSize: 12 }}>{deal.agentPhone}</div>
                          )}
                          {deal.agentEmail && (
                            <div style={{ color: '#6b7280', fontSize: 11, wordBreak: 'break-all' }}>{deal.agentEmail}</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: 14, textAlign: 'right' }}>
                      <Chip
                        label={deal.source}
                        size="small"
                        sx={{ backgroundColor: sourceStyle.bg, color: sourceStyle.text, fontWeight: 600 }}
                      />
                    </td>
                    <td style={{ padding: 14, textAlign: 'right', color: '#6b7280', fontSize: 13 }}>
                      {deal.scrapedAt ? new Date(deal.scrapedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
              {recentPending.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                    No addresses pending AMV. All caught up!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Info Box */}
      <div
        style={{
          marginTop: 16,
          padding: 16,
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: 8,
          color: '#0369a1',
          fontSize: 14,
        }}
      >
        <strong>How it works:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
          <li>The scraper fetches up to 500 addresses from Privy/Redfin (SCRAPE mode)</li>
          <li>Once 500 addresses are scraped, it switches to AMV mode to fetch BofA valuations</li>
          <li>After all pending addresses get AMV, it switches back to SCRAPE mode</li>
          <li>Addresses with AMV &ge; 2x Listing Price (and AMV &gt; $200k) become Deals</li>
        </ul>
      </div>
    </div>
  );
}

function Card({ title, value, color, highlight }: { title: string; value: number | string; color?: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: highlight ? `2px solid ${color || '#f59e0b'}` : '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 16,
        background: highlight ? '#fffbeb' : '#fff',
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280' }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, color: color || '#111' }}>{value}</div>
    </div>
  );
}
