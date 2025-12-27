import React, { useEffect, useState } from 'react';
import {
  Box, Button, Container, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, Typography, Chip, IconButton, Table, TableHead, TableRow, TableCell,
  TableBody, Stack, MenuItem, Select, FormControl, OutlinedInput, Checkbox,
  TableContainer, Paper, Card, CardContent, Grid, InputLabel, ListItemText,
  Alert, CircularProgress, Tooltip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/PersonAdd';
import SecurityIcon from '@mui/icons-material/Security';
import PersonIcon from '@mui/icons-material/Person';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EmailIcon from '@mui/icons-material/Email';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import InputAdornment from '@mui/material/InputAdornment';
import { getUsers, createUser, updateUser, deleteUser } from '../helpers';
import { STATES } from '../constants.ts';

const BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3015';

const authHeaders = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function normalizeUsers(resp: any): any[] {
  const payload = resp?.data ?? resp;
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.result)) return payload.result;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

const asStates = (v: any): string[] => {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim().toUpperCase()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[\s,\n]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  return [];
};

const getStateName = (code: string): string => {
  const state = STATES.find(s => s.code === code);
  return state ? state.name : code;
};

export default function ManageSubadmins(): JSX.Element {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  // SMTP credentials for sending emails from subadmin's account
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  // Stats
  const [stats, setStats] = useState({ total: 0, admins: 0, subadmins: 0, statesInUse: 0 });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getUsers();
      let list = normalizeUsers(resp).map((u: any) => ({ ...u, states: asStates(u.states) }));

      if (!Array.isArray(list) || list.length === 0) {
        const r = await fetch(`${BASE}/api/user`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json', ...authHeaders() },
        });
        if (r.ok) {
          const j = await r.json();
          const alt = normalizeUsers(j).map((u: any) => ({ ...u, states: asStates(u.states) }));
          if (alt.length) list = alt;
        }
      }

      setRows(list);

      // Calculate stats
      const admins = list.filter(u => u.role === 'admin').length;
      const subadmins = list.filter(u => u.role === 'subadmin').length;
      const allStates = new Set<string>();
      list.forEach(u => u.states?.forEach((s: string) => allStates.add(s)));
      setStats({
        total: list.length,
        admins,
        subadmins,
        statesInUse: allStates.size
      });
    } catch (e: any) {
      console.error('Failed to load users', e);
      setError(e?.message || 'Failed to load users');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setEditing(null);
    setFullName('');
    setEmail('');
    setPassword('');
    setStates([]);
    setShowPassword(false);
    // Reset SMTP fields
    setSmtpHost('smtp.gmail.com');
    setSmtpPort('587');
    setSmtpUser('');
    setSmtpPass('');
    setShowSmtpPass(false);
  };

  const onAdd = () => { resetForm(); setOpen(true); };

  const onEdit = (u: any) => {
    setEditing(u);
    setFullName(u.full_name || u.fullName || '');
    setEmail(u.email || '');
    setPassword('');
    setStates(asStates(u.states));
    // Populate SMTP fields
    setSmtpHost(u.smtp_host || 'smtp.gmail.com');
    setSmtpPort(String(u.smtp_port || 587));
    setSmtpUser(u.smtp_user || '');
    setSmtpPass(''); // Don't show existing password
    setShowSmtpPass(false);
    setOpen(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const normStates = Array.from(new Set(asStates(states)));
      const userId = (fullName || email).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 40) || `user-${Date.now()}`;

      const payload: any = {
        full_name: fullName,
        email: String(email || '').toLowerCase(),
        role: 'subadmin',
        states: normStates,
        phone: '+1-000-000-0000',
        user_id: userId,
        // SMTP credentials for sending emails
        smtp_host: smtpHost || 'smtp.gmail.com',
        smtp_port: parseInt(smtpPort, 10) || 587,
        smtp_user: smtpUser || '',
      };

      // Only include SMTP password if provided and not the masked placeholder
      if (smtpPass.trim() && smtpPass.trim() !== '********') {
        payload.smtp_pass = smtpPass.trim();
      }

      if (!editing) {
        const pw = (password || '').trim();
        if (!pw) { alert('Password is required when creating a new user.'); setSaving(false); return; }
        payload.password = pw;
      } else if (password.trim()) {
        payload.password = password.trim();
      }

      const resp = editing
        ? await updateUser(editing._id, payload)
        : await createUser(payload);

      if (!resp?.ok) { alert(resp?.error || resp?.message || 'Save failed'); setSaving(false); return; }

      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (u: any) => {
    if (!window.confirm(`Are you sure you want to delete "${u.full_name || u.email}"?\n\nThis action cannot be undone.`)) return;
    const resp = await deleteUser(u._id);
    if (!resp?.ok) { alert(resp?.error || 'Delete failed'); return; }
    await load();
  };

  const onQuickUpdateStates = async (user: any, newStates: string[]) => {
    const resp = await updateUser(user._id, { states: newStates });
    if (!resp?.ok) { alert(resp?.error || 'Failed to update states'); return; }
    await load();
  };

  // Filter to show only subadmins
  const subadminRows = rows.filter(u => u.role === 'subadmin');

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" sx={{ color: '#111', fontWeight: 800 }}>
            Manage Subadmins
          </Typography>
          <Typography variant="body2" sx={{ color: '#666', mt: 0.5 }}>
            Create and manage subadmin accounts and their state access permissions
          </Typography>
        </Box>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={onAdd}
          sx={{
            bgcolor: '#111',
            '&:hover': { bgcolor: '#333' },
            borderRadius: 2,
            px: 3,
            py: 1
          }}
        >
          Add Subadmin
        </Button>
      </Stack>

      {/* Stats Cards */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={6} sm={3}>
          <Card sx={{ border: '1px solid #e5e7eb', boxShadow: 'none' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <PersonIcon sx={{ fontSize: 32, color: '#6366f1', mb: 1 }} />
              <Typography variant="h4" sx={{ color: '#111', fontWeight: 800 }}>{stats.total}</Typography>
              <Typography variant="body2" sx={{ color: '#666' }}>Total Users</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ border: '1px solid #e5e7eb', boxShadow: 'none' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <SecurityIcon sx={{ fontSize: 32, color: '#10b981', mb: 1 }} />
              <Typography variant="h4" sx={{ color: '#111', fontWeight: 800 }}>{stats.admins}</Typography>
              <Typography variant="body2" sx={{ color: '#666' }}>Admins</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ border: '1px solid #e5e7eb', boxShadow: 'none' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <PersonIcon sx={{ fontSize: 32, color: '#f59e0b', mb: 1 }} />
              <Typography variant="h4" sx={{ color: '#111', fontWeight: 800 }}>{stats.subadmins}</Typography>
              <Typography variant="body2" sx={{ color: '#666' }}>Subadmins</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ border: '1px solid #e5e7eb', boxShadow: 'none' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <LocationOnIcon sx={{ fontSize: 32, color: '#ef4444', mb: 1 }} />
              <Typography variant="h4" sx={{ color: '#111', fontWeight: 800 }}>{stats.statesInUse}</Typography>
              <Typography variant="body2" sx={{ color: '#666' }}>States Assigned</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}

      {/* Subadmins Table */}
      <Paper sx={{ border: '1px solid #e5e7eb', boxShadow: 'none', borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid #e5e7eb', bgcolor: '#f9fafb' }}>
          <Typography variant="h6" sx={{ color: '#111', fontWeight: 700 }}>
            Subadmin Accounts ({subadminRows.length})
          </Typography>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: '#f9fafb' }}>
                <TableCell sx={{ fontWeight: 700, color: '#111' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#111' }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#111', width: '35%' }}>Assigned States (Authorities)</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#111' }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                    <Typography sx={{ mt: 1, color: '#666' }}>Loading...</Typography>
                  </TableCell>
                </TableRow>
              ) : subadminRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography sx={{ color: '#666' }}>No subadmin accounts found.</Typography>
                    <Button onClick={onAdd} startIcon={<AddIcon />} sx={{ mt: 1 }}>
                      Create your first subadmin
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                subadminRows.map((u: any) => (
                  <TableRow key={u._id} hover>
                    <TableCell sx={{ color: '#111', fontWeight: 600 }}>
                      {u.full_name || u.fullName || '-'}
                    </TableCell>
                    <TableCell sx={{ color: '#111' }}>{u.email}</TableCell>
                    <TableCell>
                      {u.states?.length > 0 ? (
                        <Stack direction="row" gap={0.5} flexWrap="wrap">
                          {u.states.map((s: string) => (
                            <Tooltip key={s} title={getStateName(s)} arrow>
                              <Chip
                                size="small"
                                label={s}
                                onDelete={() => {
                                  const newStates = u.states.filter((st: string) => st !== s);
                                  onQuickUpdateStates(u, newStates);
                                }}
                                sx={{
                                  color: '#111',
                                  backgroundColor: '#e0f2fe',
                                  border: '1px solid #bae6fd',
                                  fontWeight: 600,
                                  '& .MuiChip-deleteIcon': {
                                    color: '#0369a1',
                                    '&:hover': { color: '#ef4444' }
                                  }
                                }}
                              />
                            </Tooltip>
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" sx={{ color: '#999', fontStyle: 'italic' }}>
                          No states assigned
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit user & states" arrow>
                        <IconButton onClick={() => onEdit(u)} sx={{ color: '#111' }}>
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete user" arrow>
                        <IconButton color="error" onClick={() => onDelete(u)}>
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add/Edit Dialog */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        PaperProps={{
          sx: {
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column'
          }
        }}
      >
        <DialogTitle sx={{ color: '#111', fontWeight: 700, borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          {editing ? 'Edit Subadmin' : 'Add New Subadmin'}
        </DialogTitle>
        <DialogContent sx={{ mt: 2, overflowY: 'auto', flex: 1 }}>
          <Stack spacing={2.5}>
            <TextField
              label="Full Name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              fullWidth
              required
              InputLabelProps={{ style: { color: '#666' } }}
              inputProps={{ style: { color: '#111' } }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              fullWidth
              required
              disabled={!!editing}
              InputLabelProps={{ style: { color: '#666' } }}
              inputProps={{ style: { color: '#111' } }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            {/* States Selection */}
            <FormControl fullWidth>
              <InputLabel sx={{ color: '#666' }}>Assigned States (Authorities)</InputLabel>
              <Select
                multiple
                value={states}
                onChange={(e) => setStates(e.target.value as string[])}
                input={<OutlinedInput label="Assigned States (Authorities)" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map((value) => (
                      <Chip
                        key={value}
                        label={value}
                        size="small"
                        sx={{ bgcolor: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}
                      />
                    ))}
                  </Box>
                )}
                sx={{
                  color: '#111',
                  borderRadius: 2,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' }
                }}
                MenuProps={{
                  PaperProps: {
                    style: { maxHeight: 300 }
                  }
                }}
              >
                {STATES.map(s => (
                  <MenuItem key={s.code} value={s.code}>
                    <Checkbox checked={states.indexOf(s.code) > -1} />
                    <ListItemText
                      primary={`${s.code} - ${s.name}`}
                      sx={{ '& .MuiTypography-root': { color: '#111' } }}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Quick state selection buttons */}
            <Box>
              <Typography variant="caption" sx={{ color: '#666', mb: 1, display: 'block' }}>
                Quick select:
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setStates(STATES.map(s => s.code))}
                  sx={{ borderRadius: 2, fontSize: 12 }}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setStates([])}
                  sx={{ borderRadius: 2, fontSize: 12 }}
                >
                  Clear All
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setStates(['TX', 'FL', 'CA', 'NY', 'IL'])}
                  sx={{ borderRadius: 2, fontSize: 12 }}
                >
                  Top 5 States
                </Button>
              </Stack>
            </Box>

            {/* Password */}
            {!editing ? (
              <TextField
                label="Password (required)"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                fullWidth
                InputLabelProps={{ style: { color: '#666' } }}
                inputProps={{ style: { color: '#111' } }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        sx={{ color: '#666' }}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            ) : (
              <TextField
                label="New Password (leave blank to keep current)"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                fullWidth
                InputLabelProps={{ style: { color: '#666' } }}
                inputProps={{ style: { color: '#111' } }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        sx={{ color: '#666' }}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            )}

            {/* SMTP Email Settings Section */}
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #e5e7eb' }}>
              <Stack direction="row" alignItems="center" gap={1} mb={2}>
                <EmailIcon sx={{ color: '#6366f1' }} />
                <Typography variant="subtitle1" sx={{ color: '#111', fontWeight: 600 }}>
                  Email Settings (for sending agent emails)
                </Typography>
              </Stack>
              <Alert severity="info" sx={{ mb: 2 }}>
                For Gmail: Use <strong>smtp.gmail.com</strong> with port <strong>587</strong>.
                You must use an <strong>App Password</strong> (not your regular password).
                Enable 2FA and create an App Password in your Google Account settings.
              </Alert>
              <Stack spacing={2}>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="SMTP Host"
                    value={smtpHost}
                    onChange={e => setSmtpHost(e.target.value)}
                    fullWidth
                    placeholder="smtp.gmail.com"
                    InputLabelProps={{ style: { color: '#666' } }}
                    inputProps={{ style: { color: '#111' } }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                  />
                  <TextField
                    label="Port"
                    value={smtpPort}
                    onChange={e => setSmtpPort(e.target.value)}
                    sx={{ width: 120, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                    placeholder="587"
                    InputLabelProps={{ style: { color: '#666' } }}
                    inputProps={{ style: { color: '#111' } }}
                  />
                </Stack>
                <TextField
                  label="SMTP Email (usually same as login email)"
                  value={smtpUser}
                  onChange={e => setSmtpUser(e.target.value)}
                  fullWidth
                  placeholder="your-email@gmail.com"
                  InputLabelProps={{ style: { color: '#666' } }}
                  inputProps={{ style: { color: '#111' } }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                />
                <TextField
                  label={editing ? "App Password (leave blank to keep current)" : "App Password (required for sending emails)"}
                  type={showSmtpPass ? 'text' : 'password'}
                  value={smtpPass}
                  onChange={e => setSmtpPass(e.target.value)}
                  fullWidth
                  placeholder="xxxx xxxx xxxx xxxx"
                  InputLabelProps={{ style: { color: '#666' } }}
                  inputProps={{ style: { color: '#111' } }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowSmtpPass(!showSmtpPass)}
                          edge="end"
                          sx={{ color: '#666' }}
                        >
                          {showSmtpPass ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid #e5e7eb', flexShrink: 0, bgcolor: '#fff' }}>
          <Button onClick={() => setOpen(false)} sx={{ color: '#666' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={saving || (!editing && !password.trim()) || !fullName.trim() || !email.trim()}
            sx={{
              bgcolor: '#111',
              '&:hover': { bgcolor: '#333' },
              borderRadius: 2,
              px: 3
            }}
          >
            {saving ? <CircularProgress size={20} sx={{ color: 'white' }} /> : (editing ? 'Save Changes' : 'Create Subadmin')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
