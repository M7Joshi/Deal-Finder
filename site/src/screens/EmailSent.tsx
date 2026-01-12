// src/screens/EmailSent.tsx
// Shows deals where email has been sent to the agent

import React, { useEffect, useState, useCallback } from 'react';
import {
  Button, Stack, Chip, Snackbar, Alert, TextField,
  FormControl, InputLabel, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions,
  useMediaQuery, useTheme,
} from '@mui/material';
import { apiFetch } from '../helpers';

type Deal = {
  _id: string;
  fullAddress?: string;
  address?: string;
  city?: string;
  state?: string;
  listingPrice?: number;
  amv?: number;
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
  emailSentAt?: string;
  dealStage?: string;
  dealStatus?: string;
  followUpDate?: string;
  followUpNotes?: Array<{ note: string; createdAt: string }>;
  source?: string;
};

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');
const formatDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—';

export default function EmailSent() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Move dialog state
  const [moveDialog, setMoveDialog] = useState<{ open: boolean; deal: Deal | null; toStage: string }>({
    open: false, deal: null, toStage: ''
  });
  const [moveNote, setMoveNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [dealStatus, setDealStatus] = useState('pending');
  const [moving, setMoving] = useState(false);

  const [toast, setToast] = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({
    open: false, msg: '', sev: 'success'
  });

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/api/deal-pipeline/stage/email_sent?page=${page}&limit=50`);
      const data = await res.json();
      if (data.deals) {
        setDeals(data.deals);
        setTotalPages(data.pagination?.pages || 1);
        setTotal(data.pagination?.total || 0);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  const openMoveDialog = (deal: Deal, toStage: string) => {
    setMoveDialog({ open: true, deal, toStage });
    setMoveNote('');
    setFollowUpDate('');
    setDealStatus('pending');
  };

  const handleMove = async () => {
    if (!moveDialog.deal) return;
    setMoving(true);
    try {
      const body: any = {
        toStage: moveDialog.toStage,
        note: moveNote || undefined,
      };
      if (moveDialog.toStage === 'follow_up' && followUpDate) {
        body.followUpDate = followUpDate;
      }
      if (moveDialog.toStage === 'deal_status') {
        body.dealStatus = dealStatus;
      }

      const res = await apiFetch(`/api/deal-pipeline/move/${moveDialog.deal._id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ open: true, msg: `Moved to ${moveDialog.toStage.replace('_', ' ')}`, sev: 'success' });
        setMoveDialog({ open: false, deal: null, toStage: '' });
        loadDeals();
      } else {
        setToast({ open: true, msg: data.error || 'Failed to move', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: e?.message || 'Failed to move', sev: 'error' });
    } finally {
      setMoving(false);
    }
  };

  const cellPadding = isMobile ? '8px 4px' : '12px 8px';
  const cellFontSize = isMobile ? '13px' : '14px';

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#111827' }}>
          Email Sent
        </h2>
        <Chip label={`${total} deals`} color="primary" size="small" />
      </div>

      <p style={{ color: '#6b7280', marginBottom: 16, fontSize: 14 }}>
        Deals where email has been sent to the listing agent. Move to Follow Up or Deal Status.
      </p>

      <div
        style={{
          overflowX: 'auto',
          borderRadius: 12,
          border: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 800 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              {['Address', 'Agent', 'Email', 'Phone', 'Sent Date', 'LP', 'AMV', 'Actions'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 ? 'left' : i === 7 ? 'center' : 'left',
                    padding: cellPadding,
                    fontSize: 11,
                    letterSpacing: 0.3,
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
            {deals.map((deal, i) => (
              <tr key={deal._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                <td style={{ padding: cellPadding, fontSize: cellFontSize, fontWeight: 600, color: '#111' }}>
                  {deal.fullAddress || deal.address || '—'}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize, color: '#374151' }}>
                  {deal.agentName || '—'}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                  {deal.agentEmail ? (
                    <a href={`mailto:${deal.agentEmail}`} style={{ color: '#2563eb' }}>{deal.agentEmail}</a>
                  ) : '—'}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                  {deal.agentPhone ? (
                    <a href={`tel:${deal.agentPhone}`} style={{ color: '#2563eb' }}>{deal.agentPhone}</a>
                  ) : '—'}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize, color: '#6b7280' }}>
                  {formatDate(deal.emailSentAt)}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right' }}>
                  {fmt(deal.listingPrice)}
                </td>
                <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right' }}>
                  {fmt(deal.amv)}
                </td>
                <td style={{ padding: cellPadding, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => openMoveDialog(deal, 'follow_up')}
                    sx={{ mr: 1, textTransform: 'none', fontSize: 12 }}
                  >
                    Follow Up
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => openMoveDialog(deal, 'deal_status')}
                    sx={{ textTransform: 'none', fontSize: 12, bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
                  >
                    Deal Status
                  </Button>
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                  No deals in Email Sent stage.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span style={{ padding: '8px 16px', color: '#374151' }}>Page {page} of {totalPages}</span>
          <Button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Move Dialog */}
      <Dialog open={moveDialog.open} onClose={() => setMoveDialog({ open: false, deal: null, toStage: '' })} maxWidth="sm" fullWidth>
        <DialogTitle>
          Move to {moveDialog.toStage === 'follow_up' ? 'Follow Up' : 'Deal Status'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <div style={{ color: '#374151', fontSize: 14 }}>
              <strong>Address:</strong> {moveDialog.deal?.fullAddress || moveDialog.deal?.address}
            </div>

            {moveDialog.toStage === 'follow_up' && (
              <TextField
                type="date"
                label="Follow Up Date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            )}

            {moveDialog.toStage === 'deal_status' && (
              <FormControl fullWidth>
                <InputLabel>Deal Status</InputLabel>
                <Select
                  value={dealStatus}
                  label="Deal Status"
                  onChange={(e) => setDealStatus(e.target.value)}
                >
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="interested">Interested</MenuItem>
                  <MenuItem value="not_interested">Not Interested</MenuItem>
                  <MenuItem value="under_contract">Under Contract</MenuItem>
                  <MenuItem value="closed">Closed</MenuItem>
                  <MenuItem value="dead">Dead</MenuItem>
                </Select>
              </FormControl>
            )}

            <TextField
              label="Note (optional)"
              multiline
              rows={3}
              value={moveNote}
              onChange={(e) => setMoveNote(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog({ open: false, deal: null, toStage: '' })}>Cancel</Button>
          <Button variant="contained" onClick={handleMove} disabled={moving}>
            {moving ? 'Moving...' : 'Move'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast(t => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.sev} variant="filled">{toast.msg}</Alert>
      </Snackbar>
    </div>
  );
}
