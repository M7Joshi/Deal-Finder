// src/screens/DealStatus.tsx
// Shows deals with their final status (interested, not interested, under contract, closed, dead)

import { useEffect, useState, useCallback } from 'react';
import {
  Button, Stack, Chip, Snackbar, Alert, TextField,
  FormControl, InputLabel, Select, MenuItem, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions,
  useMediaQuery, useTheme,
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
  offerAmount?: number;
  movedToDealStatusAt?: string;
  source?: string;
};

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');
const formatDateTime = (d?: string | null) => d ? new Date(d).toLocaleString() : '—';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#6b7280', bg: '#f3f4f6' },
  interested: { label: 'Interested', color: '#059669', bg: '#d1fae5' },
  not_interested: { label: 'Not Interested', color: '#dc2626', bg: '#fee2e2' },
  under_contract: { label: 'Under Contract', color: '#2563eb', bg: '#dbeafe' },
  closed: { label: 'Closed', color: '#7c3aed', bg: '#ede9fe' },
  dead: { label: 'Dead', color: '#374151', bg: '#e5e7eb' },
};

export default function DealStatusPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');

  // Move dialog state
  const [moveDialog, setMoveDialog] = useState<{ open: boolean; deal: Deal | null; toStage: string }>({
    open: false, deal: null, toStage: ''
  });
  const [moveNote, setMoveNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [moving, setMoving] = useState(false);

  // Delete dialog state
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; deal: Deal | null }>({
    open: false, deal: null
  });
  const [deleting, setDeleting] = useState(false);

  // Edit status dialog
  const [editDialog, setEditDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [newStatus, setNewStatus] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [updating, setUpdating] = useState(false);

  // View notes dialog
  const [viewNotesDialog, setViewNotesDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });

  // Add note dialog
  const [noteDialog, setNoteDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const [toast, setToast] = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({
    open: false, msg: '', sev: 'success'
  });

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
      const res = await apiFetch(`/api/deal-pipeline/stage/deal_status?page=${page}&limit=50${statusParam}`);
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
  }, [page, statusFilter]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  const openMoveDialog = (deal: Deal, toStage: string) => {
    setMoveDialog({ open: true, deal, toStage });
    setMoveNote('');
    setFollowUpDate('');
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

      const res = await apiFetch(`/api/deal-pipeline/move/${moveDialog.deal._id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        const stageLabels: Record<string, string> = {
          'email_sent': 'Email Sent',
          'follow_up': 'Follow Up'
        };
        setToast({ open: true, msg: `Moved to ${stageLabels[moveDialog.toStage] || moveDialog.toStage}`, sev: 'success' });
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

  const openDeleteDialog = (deal: Deal) => {
    setDeleteDialog({ open: true, deal });
  };

  const handleDelete = async () => {
    if (!deleteDialog.deal) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/scraped-deals/${deleteDialog.deal._id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success || res.ok) {
        setToast({ open: true, msg: 'Deal deleted', sev: 'success' });
        setDeleteDialog({ open: false, deal: null });
        loadDeals();
      } else {
        setToast({ open: true, msg: data.error || 'Failed to delete', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: e?.message || 'Failed to delete', sev: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!editDialog.deal) return;
    setUpdating(true);
    try {
      const body: any = {};
      if (newStatus) body.dealStatus = newStatus;
      if (offerAmount) body.offerAmount = parseFloat(offerAmount.replace(/[^0-9.]/g, ''));
      if (editNote.trim()) body.note = editNote.trim();

      const res = await apiFetch(`/api/deal-pipeline/status/${editDialog.deal._id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ open: true, msg: 'Status updated', sev: 'success' });
        setEditDialog({ open: false, deal: null });
        loadDeals();
      } else {
        setToast({ open: true, msg: data.error || 'Failed to update', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: e?.message || 'Failed to update', sev: 'error' });
    } finally {
      setUpdating(false);
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

  const getStatusChip = (status?: string | null) => {
    const s = status || 'pending';
    const info = STATUS_LABELS[s] || STATUS_LABELS.pending;
    return (
      <Chip
        label={info.label}
        size="small"
        sx={{
          backgroundColor: info.bg,
          color: info.color,
          fontWeight: 600,
          fontSize: 10,
        }}
      />
    );
  };

  // Calculate pricing values
  const getLP = (deal: Deal) => deal.listingPrice || 0;
  const getLP80 = (deal: Deal) => {
    const lp = getLP(deal);
    return lp > 0 ? Math.round(lp * 0.8) : null;
  };
  const getAMV40 = (deal: Deal) => {
    const amv = deal.amv || 0;
    return amv > 0 ? Math.round(amv * 0.4) : null;
  };
  const getAMV30 = (deal: Deal) => {
    const amv = deal.amv || 0;
    return amv > 0 ? Math.round(amv * 0.3) : null;
  };
  const getOffer = (deal: Deal) => {
    const lp80 = getLP80(deal);
    const amv40 = getAMV40(deal);
    if (lp80 && amv40) return Math.min(lp80, amv40);
    return lp80 || amv40 || null;
  };

  const cellPadding = isMobile ? '8px 4px' : '10px 6px';
  const cellFontSize = isMobile ? '12px' : '13px';

  if (loading && deals.length === 0) return <div style={{ padding: 24 }}>Loading...</div>;
  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#111827' }}>
          Deal Status
        </h2>
        <Chip label={`${total} deals`} color="secondary" size="small" />
      </div>

      <p style={{ color: '#6b7280', marginBottom: 16, fontSize: 14 }}>
        Track the final outcome of your deals. Update status, add notes, and record offer amounts.
      </p>

      {/* Status Filter Tabs */}
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <Tabs
          value={statusFilter}
          onChange={(_, v) => { setStatusFilter(v); setPage(1); }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minWidth: 100 },
          }}
        >
          <Tab value="all" label="All" />
          <Tab value="pending" label="Pending" />
          <Tab value="interested" label="Interested" />
          <Tab value="not_interested" label="Not Interested" />
          <Tab value="under_contract" label="Under Contract" />
          <Tab value="closed" label="Closed" />
          <Tab value="dead" label="Dead" />
        </Tabs>
      </div>

      <div
        style={{
          overflowX: 'auto',
          borderRadius: 12,
          border: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 1500 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              {['Address', 'LP', '80%', 'AMV', '40%', '30%', 'Offer', 'Agent', 'Contact', 'Status', 'Notes', 'Edit', 'Move To', 'Delete'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 || i === 7 || i === 8 ? 'left' : 'right',
                    padding: cellPadding,
                    fontSize: 11,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    borderBottom: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.map((deal, i) => {
              const noteCount = deal.followUpNotes?.length || 0;

              return (
                <tr key={deal._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, fontWeight: 600, color: '#111', minWidth: 150 }}>
                    {deal.fullAddress || deal.address || '—'}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmt(getLP(deal))}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmt(getLP80(deal))}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmt(deal.amv)}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmt(getAMV40(deal))}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmt(getAMV30(deal))}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: '#059669' }}>
                    {fmt(getOffer(deal))}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize, color: '#374151' }}>
                    {deal.agentName || '—'}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {deal.agentEmail && (
                        <a href={`mailto:${deal.agentEmail}`} style={{ color: '#2563eb', fontSize: 11 }}>{deal.agentEmail}</a>
                      )}
                      {deal.agentPhone && (
                        <a href={`tel:${deal.agentPhone}`} style={{ color: '#2563eb', fontSize: 11 }}>{deal.agentPhone}</a>
                      )}
                      {!deal.agentEmail && !deal.agentPhone && '—'}
                    </div>
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    {getStatusChip(deal.dealStatus)}
                  </td>
                  <td style={{ padding: cellPadding, fontSize: cellFontSize }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Chip
                        label={`${noteCount}`}
                        size="small"
                        variant="outlined"
                        onClick={() => setViewNotesDialog({ open: true, deal })}
                        sx={{ cursor: 'pointer', fontSize: 10, height: 20 }}
                      />
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => setNoteDialog({ open: true, deal })}
                        sx={{ minWidth: 0, p: 0.25, fontSize: 10 }}
                      >
                        +
                      </Button>
                    </div>
                  </td>
                  <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setEditDialog({ open: true, deal });
                        setNewStatus(deal.dealStatus || 'pending');
                        setOfferAmount(deal.offerAmount ? String(deal.offerAmount) : '');
                        setEditNote('');
                      }}
                      sx={{ fontSize: 10, px: 1, py: 0.25, minWidth: 'auto', textTransform: 'none' }}
                    >
                      Edit
                    </Button>
                  </td>
                  <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openMoveDialog(deal, 'email_sent')}
                        sx={{
                          fontSize: 10,
                          px: 1,
                          py: 0.25,
                          minWidth: 'auto',
                          textTransform: 'none',
                          color: '#2563eb',
                          borderColor: '#2563eb',
                          '&:hover': { backgroundColor: '#eff6ff', borderColor: '#1d4ed8' }
                        }}
                      >
                        Email
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openMoveDialog(deal, 'follow_up')}
                        sx={{
                          fontSize: 10,
                          px: 1,
                          py: 0.25,
                          minWidth: 'auto',
                          textTransform: 'none',
                          color: '#d97706',
                          borderColor: '#d97706',
                          '&:hover': { backgroundColor: '#fffbeb', borderColor: '#b45309' }
                        }}
                      >
                        Follow
                      </Button>
                    </Stack>
                  </td>
                  <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => openDeleteDialog(deal)}
                      sx={{ fontSize: 10, px: 1, py: 0.25, minWidth: 'auto', textTransform: 'none' }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
            {deals.length === 0 && (
              <tr>
                <td colSpan={14} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                  No deals in Deal Status stage{statusFilter !== 'all' ? ` with status "${STATUS_LABELS[statusFilter]?.label}"` : ''}.
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
          Move to {moveDialog.toStage === 'email_sent' ? 'Email Sent' : 'Follow Up'}
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
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, deal: null })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: '#dc2626' }}>Delete Deal</DialogTitle>
        <DialogContent>
          <p style={{ margin: 0, color: '#374151' }}>
            Are you sure you want to delete this deal?
          </p>
          {deleteDialog.deal && (
            <p style={{ margin: '12px 0 0', fontWeight: 600, color: '#111827' }}>
              {deleteDialog.deal.fullAddress || deleteDialog.deal.address || 'Unknown address'}
            </p>
          )}
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#6b7280' }}>
            This action cannot be undone.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, deal: null })} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Status Dialog */}
      <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, deal: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Deal</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <div style={{ color: '#374151', fontSize: 14 }}>
              <strong>Address:</strong> {editDialog.deal?.fullAddress || editDialog.deal?.address}
            </div>

            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={newStatus}
                label="Status"
                onChange={(e) => setNewStatus(e.target.value)}
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
              label="Offer Amount"
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              placeholder="e.g., 250000"
              fullWidth
              type="number"
            />

            <TextField
              label="Add Note (optional)"
              multiline
              rows={3}
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, deal: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdateStatus} disabled={updating}>
            {updating ? 'Saving...' : 'Save'}
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
