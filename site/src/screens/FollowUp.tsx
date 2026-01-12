// src/screens/FollowUp.tsx
// Shows deals that need follow-up action

import React, { useEffect, useState, useCallback } from 'react';
import {
  Button, Stack, Chip, Snackbar, Alert, TextField,
  FormControl, InputLabel, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions,
  useMediaQuery, useTheme, IconButton,
} from '@mui/material';
import { apiFetch } from '../helpers';

type Note = { note: string; createdAt: string };

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
  followUpNotes?: Note[];
  movedToFollowUpAt?: string;
  source?: string;
};

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');
const formatDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—';
const formatDateTime = (d?: string | null) => d ? new Date(d).toLocaleString() : '—';

export default function FollowUp() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Move to Deal Status dialog
  const [moveDialog, setMoveDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [moveNote, setMoveNote] = useState('');
  const [dealStatus, setDealStatus] = useState('pending');
  const [moving, setMoving] = useState(false);

  // Add note dialog
  const [noteDialog, setNoteDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // View notes dialog
  const [viewNotesDialog, setViewNotesDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });

  // Edit follow-up date dialog
  const [dateDialog, setDateDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [newDate, setNewDate] = useState('');
  const [updatingDate, setUpdatingDate] = useState(false);

  const [toast, setToast] = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({
    open: false, msg: '', sev: 'success'
  });

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/api/deal-pipeline/stage/follow_up?page=${page}&limit=50`);
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

  const handleMove = async () => {
    if (!moveDialog.deal) return;
    setMoving(true);
    try {
      const res = await apiFetch(`/api/deal-pipeline/move/${moveDialog.deal._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          toStage: 'deal_status',
          dealStatus,
          note: moveNote || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ open: true, msg: 'Moved to Deal Status', sev: 'success' });
        setMoveDialog({ open: false, deal: null });
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

  const handleAddNote = async () => {
    if (!noteDialog.deal || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await apiFetch(`/api/deal-pipeline/note/${noteDialog.deal._id}`, {
        method: 'POST',
        body: JSON.stringify({ note: newNote.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ open: true, msg: 'Note added', sev: 'success' });
        setNoteDialog({ open: false, deal: null });
        setNewNote('');
        loadDeals();
      } else {
        setToast({ open: true, msg: data.error || 'Failed to add note', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: e?.message || 'Failed to add note', sev: 'error' });
    } finally {
      setAddingNote(false);
    }
  };

  const handleUpdateDate = async () => {
    if (!dateDialog.deal) return;
    setUpdatingDate(true);
    try {
      const res = await apiFetch(`/api/deal-pipeline/followup-date/${dateDialog.deal._id}`, {
        method: 'PUT',
        body: JSON.stringify({ followUpDate: newDate || null }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ open: true, msg: 'Follow-up date updated', sev: 'success' });
        setDateDialog({ open: false, deal: null });
        setNewDate('');
        loadDeals();
      } else {
        setToast({ open: true, msg: data.error || 'Failed to update date', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: e?.message || 'Failed to update date', sev: 'error' });
    } finally {
      setUpdatingDate(false);
    }
  };

  const isOverdue = (date?: string | null) => {
    if (!date) return false;
    return new Date(date) < new Date();
  };

  const cellPadding = isMobile ? '8px 4px' : '12px 8px';
  const cellFontSize = isMobile ? '13px' : '14px';

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#111827' }}>
          Follow Up
        </h2>
        <Chip label={`${total} deals`} color="warning" size="small" />
      </div>

      <p style={{ color: '#6b7280', marginBottom: 16, fontSize: 14 }}>
        Deals that need follow-up. Add notes, set follow-up dates, or move to Deal Status.
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
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              {['Address', 'Agent', 'Contact', 'Follow Up Date', 'Notes', 'LP', 'AMV', 'Actions'].map((h, i) => (
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
            {deals.map((deal, i) => {
              const overdue = isOverdue(deal.followUpDate);
              const noteCount = deal.followUpNotes?.length || 0;

              return (
                <tr key={deal._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, fontWeight: 600, color: '#111' }}>
                    {deal.fullAddress || deal.address || '—'}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, color: '#374151' }}>
                    {deal.agentName || '—'}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {deal.agentEmail && (
                        <a href={`mailto:${deal.agentEmail}`} style={{ color: '#2563eb', fontSize: 12 }}>{deal.agentEmail}</a>
                      )}
                      {deal.agentPhone && (
                        <a href={`tel:${deal.agentPhone}`} style={{ color: '#2563eb', fontSize: 12 }}>{deal.agentPhone}</a>
                      )}
                      {!deal.agentEmail && !deal.agentPhone && '—'}
                    </div>
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: overdue ? '#dc2626' : '#374151', fontWeight: overdue ? 600 : 400 }}>
                        {formatDate(deal.followUpDate)}
                      </span>
                      {overdue && <Chip label="Overdue" size="small" color="error" sx={{ fontSize: 10 }} />}
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          setDateDialog({ open: true, deal });
                          setNewDate(deal.followUpDate ? new Date(deal.followUpDate).toISOString().split('T')[0] : '');
                        }}
                        sx={{ minWidth: 0, p: 0.5, fontSize: 11 }}
                      >
                        Edit
                      </Button>
                    </div>
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Chip
                        label={`${noteCount} note${noteCount !== 1 ? 's' : ''}`}
                        size="small"
                        variant="outlined"
                        onClick={() => setViewNotesDialog({ open: true, deal })}
                        sx={{ cursor: 'pointer', fontSize: 11 }}
                      />
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => setNoteDialog({ open: true, deal })}
                        sx={{ minWidth: 0, p: 0.5, fontSize: 11 }}
                      >
                        + Add
                      </Button>
                    </div>
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
                      variant="contained"
                      onClick={() => {
                        setMoveDialog({ open: true, deal });
                        setMoveNote('');
                        setDealStatus('pending');
                      }}
                      sx={{ textTransform: 'none', fontSize: 12, bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
                    >
                      Move to Deal Status
                    </Button>
                  </td>
                </tr>
              );
            })}
            {deals.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                  No deals in Follow Up stage.
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

      {/* Move to Deal Status Dialog */}
      <Dialog open={moveDialog.open} onClose={() => setMoveDialog({ open: false, deal: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Move to Deal Status</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <div style={{ color: '#374151', fontSize: 14 }}>
              <strong>Address:</strong> {moveDialog.deal?.fullAddress || moveDialog.deal?.address}
            </div>

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
          <Button onClick={() => setMoveDialog({ open: false, deal: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleMove} disabled={moving}>
            {moving ? 'Moving...' : 'Move'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialog.open} onClose={() => setNoteDialog({ open: false, deal: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Add Note</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <div style={{ color: '#374151', fontSize: 14 }}>
              <strong>Address:</strong> {noteDialog.deal?.fullAddress || noteDialog.deal?.address}
            </div>
            <TextField
              label="Note"
              multiline
              rows={4}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              fullWidth
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteDialog({ open: false, deal: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleAddNote} disabled={addingNote || !newNote.trim()}>
            {addingNote ? 'Adding...' : 'Add Note'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Notes Dialog */}
      <Dialog open={viewNotesDialog.open} onClose={() => setViewNotesDialog({ open: false, deal: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Notes</DialogTitle>
        <DialogContent>
          <div style={{ color: '#374151', fontSize: 14, marginBottom: 16 }}>
            <strong>Address:</strong> {viewNotesDialog.deal?.fullAddress || viewNotesDialog.deal?.address}
          </div>
          {viewNotesDialog.deal?.followUpNotes?.length ? (
            <Stack spacing={2}>
              {viewNotesDialog.deal.followUpNotes.map((n, i) => (
                <div key={i} style={{ background: '#f9fafb', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    {formatDateTime(n.createdAt)}
                  </div>
                  <div style={{ color: '#111', whiteSpace: 'pre-wrap' }}>{n.note}</div>
                </div>
              ))}
            </Stack>
          ) : (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: 24 }}>No notes yet.</div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewNotesDialog({ open: false, deal: null })}>Close</Button>
          <Button
            variant="outlined"
            onClick={() => {
              setViewNotesDialog({ open: false, deal: null });
              setNoteDialog({ open: true, deal: viewNotesDialog.deal });
            }}
          >
            Add Note
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Follow-Up Date Dialog */}
      <Dialog open={dateDialog.open} onClose={() => setDateDialog({ open: false, deal: null })} maxWidth="xs" fullWidth>
        <DialogTitle>Set Follow-Up Date</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              type="date"
              label="Follow Up Date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDateDialog({ open: false, deal: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdateDate} disabled={updatingDate}>
            {updatingDate ? 'Saving...' : 'Save'}
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
