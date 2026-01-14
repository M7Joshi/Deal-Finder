
// src/screens/Deals.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { getDeals, getDashboardSummary, updatePropertyBasic, deletePropertyById, sendAgentOffer } from '../api.tsx';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Stack, Chip, Snackbar, Alert, TextField, Tabs, Tab,
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput,
  LinearProgress, Box, useMediaQuery, useTheme,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch, startService, stopService, getServiceStatus } from '../helpers';


const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const onlyDigits = (s: string) => (s || '').replace(/\D+/g, '');
const formatPhone = (s: string) => {
  const d = onlyDigits(s).slice(0, 10);
  const p1 = d.slice(0,3), p2 = d.slice(3,6), p3 = d.slice(6,10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${p1}) ${p2}`;
  return `(${p1}) ${p2}-${p3}`;
};

// Sanitize agent name - truncate if too long or contains garbage data
const sanitizeAgentName = (name?: string | null): string => {
  if (!name) return '—';
  const s = String(name).trim();
  // If it looks like JSON/HTML garbage, return placeholder
  if (s.includes('{') || s.includes('<') || s.includes('\\u') || s.length > 100) {
    return '—';
  }
  // Truncate to reasonable length
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
};

// Toggle verbose console logs for debugging data shape
const DEBUG = true;

// Dashboard-style totals for cards
type Totals = { properties: number; deals: number; nonDeals: number };
const normalizeTotals = (resp: any): Totals => {
  const t = resp?.data?.totals ?? resp?.totals ?? {};
  const properties = Number(t.properties ?? 0);
  const deals = Number(t.deals ?? 0);
  const nonDeals = Number(t.nonDeals ?? (properties - deals));
  return { properties, deals, nonDeals };
};

const isValidPhone = (s?: string) => {
  if (!s) return true; // optional
  return onlyDigits(s).length === 10;
};

// Coerce money/number-like values to numbers (handles "420000", "$420,000", Mongo Extended JSON, etc.)
const toNum = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.replace(/\$/g, '').replace(/,/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  // Handle Mongo Extended JSON numbers: {$numberInt:"..."}, {$numberLong:"..."}, {$numberDouble:"..."}
  if (typeof v === 'object') {
    if ('$numberInt' in (v as any)) {
      const n = Number((v as any)['$numberInt']);
      return Number.isFinite(n) ? n : null;
    }
    if ('$numberLong' in (v as any)) {
      const n = Number((v as any)['$numberLong']);
      return Number.isFinite(n) ? n : null;
    }
    if ('$numberDouble' in (v as any)) {
      const n = Number((v as any)['$numberDouble']);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
};

const pickFirstNumber = (...vals: any[]) => {
  for (const v of vals) {
    const n = toNum(v);
    if (typeof n === 'number' && n > 0) return n;
  }
  return null;
};

// Loose row shape to tolerate backend changes
type Row = {
  _id?: string;
  address?: string;
  fullAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  listPrice?: number | null;
  list_price?: number | null;
  lp?: number | null;
  listingPrice?: number | null;
  price?: number | null;
  amv?: number | null;
  lp80?: number | null;
  amv40?: number | null;
  amv30?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  built?: number | null;
  bofa_value?: number | null;
  chase_value?: number | null;
  movoto_adjusted?: number | null;
  movoto_value?: number | null;
  // Redfin fields (optional)
  redfin_value?: number | null;
  redfin_adjusted?: number | null;
  redfin?: number | null;
  lat?: number | null;
  lng?: number | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  agentEmailSent?: boolean | null; // if backend provides it
  // Agent lookup tracking for Privy deals
  agentLookupStatus?: 'pending' | 'found' | 'not_found' | null;
  agentLookupAt?: string | null;
  source?: string | null;
  deal?: boolean;
  prop_id?: string;
  updatedAt?: string;
  squareFeet?: number | null;
};

const getId = (r: any) => r?._id || r?.prop_id || (r?.fullAddress || r?.address || '');

// Heuristic: treat as SENT if backend indicates an automatic email went out (including offerStatus)
function isAutoEmailSent(r: any): boolean {
  const bools = [
    r.agentEmailSent, r.autoEmailSent, r.automaticEmailSent,
    r.offerEmailSent, r.emailSent, r.agent_email_sent, r.email_sent
  ].map((v: any) => v === true || v === 'true' || v === 1 || v === '1');

  // timestamp-style flags (include offerStatus)
  const timestamps = [
    r.agentEmailSentAt, r.emailSentAt, r.offerEmailSentAt, r.lastEmailSentAt,
    r?.offerStatus?.lastSentAt
  ].filter(Boolean);

  // status strings (include offerStatus.lastResult)
  const statusStr = String(r.emailStatus || r.agentEmailStatus || r?.offerStatus?.lastResult || '')
    .toLowerCase().trim();
  const statusLooksSent = ['sent', 'delivered', 'ok', 'success'].includes(statusStr);

  return bools.some(Boolean) || timestamps.length > 0 || statusLooksSent;
}

const normalizeAddress = (addr: string) => {
  if (!addr) return '';
  let a = addr.toLowerCase().trim();
  // remove punctuation and normalize spacing
  a = a.replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
  // drop ZIP+4 suffix (e.g., 46902-5423 -> 46902)
  a = a.replace(/-\d{4}\b/g, '');
  // normalize common suffixes
  const replacements: Record<string, string> = {
    street: 'st', st: 'st',
    avenue: 'ave', ave: 'ave',
    road: 'rd', rd: 'rd',
    drive: 'dr', dr: 'dr',
    boulevard: 'blvd', blvd: 'blvd',
    lane: 'ln', ln: 'ln',
    court: 'ct', ct: 'ct',
    circle: 'cir', cir: 'cir',
    place: 'pl', pl: 'pl',
    parkway: 'pkwy', pkwy: 'pkwy',
    highway: 'hwy', hwy: 'hwy',
    terrace: 'ter', ter: 'ter',
    way: 'wy', wy: 'wy',
    north: 'n', n: 'n',
    south: 's', s: 's',
    east: 'e', e: 'e',
    west: 'w', w: 'w',
    drivecourt: 'dr ct' // guard weird merges after punctuation removal
  };
  for (const [long, short] of Object.entries(replacements)) {
    const regex = new RegExp(`\\b${long}\\b`, 'g');
    a = a.replace(regex, short);
  }
  // collapse multiple spaces again after replacements
  a = a.replace(/\s+/g, ' ').trim();
  return a;
};

const dealKey = (r: any) => {
  const base = String(r.fullAddress || r.address || '').trim();
  return r._id || r.prop_id || normalizeAddress(base);
};

// Blocked states - these won't appear in state selection dropdowns
const BLOCKED_STATES = ['SD', 'AK', 'ND', 'WY', 'HI', 'UT', 'NM', 'OH', 'MT'];

// All US states for Auto Fetch (excluding blocked states)
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

const dedupeByKey = <T,>(items: T[], keyFn: (x: T) => string) => {
  const map = new Map<string, T>();
  for (const it of items) {
    const k = keyFn(it);
    const prev: any = map.get(k);
    const curr: any = it as any;
    if (!prev) { map.set(k, it); continue; }
    const prevTs = prev?.updatedAt ? Date.parse(prev.updatedAt) : 0;
    const currTs = curr?.updatedAt ? Date.parse(curr.updatedAt) : 0;
    if (currTs >= prevTs) map.set(k, it);
  }
  return Array.from(map.values());
};


export default function Deals() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // < 600px
  const isTablet = useMediaQuery(theme.breakpoints.down('md')); // < 900px
  const REFRESH_MS = 3 * 60 * 1000; // 3 minutes
  const MIN_BEDS = 3; // hide anything below this count
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'street'>('street');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [streetPano, setStreetPano] = useState<string | null>(null);
  // Minimal edit/toast state so handlers compile even if Edit UI isn't shown yet
  const [editDraft, setEditDraft] = useState<Row | null>(null);
  const closeEdit = () => setEditDraft(null);
  const openEdit = (r: Row) => setEditDraft(r);
  const [toast, setToast] = useState<{ open: boolean; msg: string; sev: 'success' | 'error' | 'info' }>({ open: false, msg: '', sev: 'success' });
  const [detailTab, setDetailTab] = useState<'details' | 'activity'>('details');

  // Selection state for viewing in Agent Fetcher
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Track which row's agent details are expanded
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  // Delete confirmation dialog state
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; deal: Row | null }>({ open: false, deal: null });
  const [deleting, setDeleting] = useState(false);

  // Move to stage dialog state
  const [moveDialog, setMoveDialog] = useState<{ open: boolean; deal: Row | null; toStage: string }>({ open: false, deal: null, toStage: '' });
  const [moving, setMoving] = useState(false);

  // Refs for synced horizontal scrollbars (top + bottom)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Sync scroll between top scrollbar and table
  const handleTopScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };
  const handleTableScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  };

  // Toggle selection for a single row
  const toggleRowSelection = (id: string) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Toggle all visible rows
  const toggleAllRows = () => {
    if (selectedRows.size === displayedRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(displayedRows.map(r => getId(r))));
    }
  };

  // Auto Fetch state
  const [autoFetchStates, setAutoFetchStates] = useState<string[]>([]);
  const [autoFetchLimit, setAutoFetchLimit] = useState(10);
  const [autoFetching, setAutoFetching] = useState(false);
  const [autoFetchStatus, setAutoFetchStatus] = useState<string | null>(null);

  // Backend Automation control state
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<string | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);

  // Check automation status on mount and periodically
  const checkAutomationStatus = useCallback(async () => {
    try {
      const res = await getServiceStatus();
      // Backend returns progressTracker: { isRunning, status: 'running'|'idle'|'completed'|'error' }
      const isRunning = res?.isRunning === true || res?.status === 'running';
      setAutomationRunning(isRunning);
    } catch (e) {
      console.error('Failed to check automation status:', e);
    }
  }, []);

  useEffect(() => {
    checkAutomationStatus();
    const interval = setInterval(checkAutomationStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [checkAutomationStatus]);

  // Start automation handler
  const handleStartAutomation = async () => {
    setAutomationLoading(true);
    setAutomationStatus(null);
    try {
      const res = await startService();
      if (res?.ok || res?.running) {
        setAutomationRunning(true);
        setAutomationStatus('✅ Automation started successfully');
      } else {
        setAutomationStatus(`❌ Failed to start: ${res?.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setAutomationStatus(`❌ Error: ${e?.message || 'Failed to start automation'}`);
    } finally {
      setAutomationLoading(false);
    }
  };

  // Stop automation handler
  const handleStopAutomation = async () => {
    setAutomationLoading(true);
    setAutomationStatus(null);
    try {
      const res = await stopService();
      if (res?.ok || !res?.running) {
        setAutomationRunning(false);
        setAutomationStatus('⏹️ Automation stopped');
      } else {
        setAutomationStatus(`❌ Failed to stop: ${res?.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setAutomationStatus(`❌ Error: ${e?.message || 'Failed to stop automation'}`);
    } finally {
      setAutomationLoading(false);
    }
  };

  // User's allowed states (from API response)
  const [userStates, setUserStates] = useState<string[] | 'all'>('all');

  // State filter for deals table - always default to All States
  const [filterState, setFilterState] = useState<string>('all');
  // Limit for deals table display - default to All
  const [displayLimit, setDisplayLimit] = useState<number>(99999);
  // AMV sort order - 'desc' (high to low) or 'asc' (low to high)
  const [amvSortOrder, setAmvSortOrder] = useState<'desc' | 'asc'>('desc');


  // Summary totals for cards
  const [totals, setTotals] = useState<Totals>({ properties: 0, deals: 0, nonDeals: 0 });
  const loadSummary = useCallback(async () => {
    try {
      // Use the new scraped deals stats endpoint
      const res = await apiFetch('/api/scraped-deals/stats');
      const data = await res.json();
      if (data.ok && data.stats) {
        setTotals({
          properties: data.stats.total || 0,           // Total addresses scraped
          deals: data.stats.dealsCount || 0,           // Addresses where AMV >= 2x LP
          nonDeals: (data.stats.total || 0) - (data.stats.dealsCount || 0),
        });
      }
    } catch (_) {
      // ignore errors; cards will show zeros
    }
  }, []);

  // local row-level edits
  type Edits = {
    [id: string]: { agentName?: string; agentPhone?: string; agentEmail?: string; busy?: boolean }
  };
  const [edits, setEdits] = useState<Edits>({});

  const setEdit = useCallback((id: string, patch: Partial<Edits[string]>) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const onSend = useCallback(async (row: Row) => {
    const id = String(getId(row));
    if (!id || id === 'undefined') {
      setToast({ open: true, msg: 'Cannot send: missing property id', sev: 'error' });
      return;
    }
    const e = edits[id] || {};
    const agentName  = (e.agentName  ?? row.agentName  ?? '').trim();
    const agentPhone = (e.agentPhone ?? row.agentPhone ?? '').trim();
    const agentEmail = (e.agentEmail ?? row.agentEmail ?? (row as any).agent_email ?? '').trim();
    console.debug('[Deals:onSend] using', { id, agentName, agentPhone, agentEmail });

    // Fallback to UI if merged values are blank
const elName  = document.getElementById(`agent-name-${id}`)  as HTMLInputElement | null;
const elPhone = document.getElementById(`agent-phone-${id}`) as HTMLInputElement | null;
const elEmail = document.getElementById(`agent-email-${id}`) as HTMLInputElement | null;

const agentNameUI  = (elName?.value  ?? '').trim();
const agentPhoneUI = (elPhone?.value ?? '').trim();
const agentEmailUI = (elEmail?.value ?? '').trim();

const finalName  = agentName  || agentNameUI;
const finalPhone = agentPhone || agentPhoneUI;
const finalEmail = agentEmail || agentEmailUI;

console.debug('[Deals:onSend] fallback UI values', { finalName, finalPhone, finalEmail });


if (!emailRe.test(finalEmail)) {
  setToast({ open: true, msg: `Please enter a valid agent email: "${finalEmail}"`, sev: 'error' });
  return;
}
if (!isValidPhone(finalPhone)) {
  setToast({ open: true, msg: 'Phone must be 10 digits (or leave blank)', sev: 'error' });
  return;
}

    try {
      setEdit(id, { busy: true });
      await sendAgentOffer(id, {
        agentName: finalName,
        agentPhone: finalPhone,
        agentEmail: finalEmail,
      });
      const sentAt = new Date().toISOString();
      // mark as sent in local state + selected row
      setRows(cur =>
        cur.map(x => (getId(x) === id
          ? { ...x, agentEmailSent: true, offerStatus: { ...(x as any).offerStatus, lastSentAt: sentAt, lastResult: 'ok' } }
          : x
        ))
      );
      setSelected(sel =>
        sel && getId(sel) === id
          ? ({ ...sel, agentEmailSent: true, offerStatus: { ...(sel as any).offerStatus, lastSentAt: sentAt, lastResult: 'ok' } } as any)
          : sel
      );
      setEdit(id, { busy: false });
      // optional: toast/snackbar
      setToast({ open: true, msg: 'Offer sent!', sev: 'success' });
    } catch (err: any) {
      setEdit(id, { busy: false });
      setToast({ open: true, msg: err?.message || 'Failed to send offer', sev: 'error' });
    }
  }, [edits, setEdit]);

  const onSaveAgentOnly = useCallback(async (row: Row) => {
    const id = String(getId(row));
    if (!id || id === 'undefined') {
      setToast({ open: true, msg: 'Cannot save: missing property id', sev: 'error' });
      return;
    }
    const e = edits[id] || {};
    const agentName = (e.agentName ?? row.agentName ?? '').trim();
    const agentPhone = (e.agentPhone ?? row.agentPhone ?? '').trim();
    const agentEmail = (e.agentEmail ?? row.agentEmail ?? (row as any).agent_email ?? '').trim();
    console.debug('[Deals:onSaveAgentOnly] using', { id, agentName, agentPhone, agentEmail });
    // Fallback to UI if merged values are blank
const elName  = document.getElementById(`agent-name-${id}`)  as HTMLInputElement | null;
const elPhone = document.getElementById(`agent-phone-${id}`) as HTMLInputElement | null;
const elEmail = document.getElementById(`agent-email-${id}`) as HTMLInputElement | null;

const agentNameUI  = (elName?.value  ?? '').trim();
const agentPhoneUI = (elPhone?.value ?? '').trim();
const agentEmailUI = (elEmail?.value ?? '').trim();

const finalName  = agentName  || agentNameUI;
const finalPhone = agentPhone || agentPhoneUI;
const finalEmail = agentEmail || agentEmailUI;

console.debug('[Deals:onSaveAgentOnly] fallback UI values', { finalName, finalPhone, finalEmail });
    if (finalEmail && !emailRe.test(finalEmail)) {
      setToast({ open: true, msg: `Invalid email: "${finalEmail}"`, sev: 'error' });
      return;
    }
    if (!isValidPhone(finalPhone)) {
      setToast({ open: true, msg: `Phone must be 10 digits (or leave blank). Got: "${finalPhone}"`, sev: 'error' });
      return;
    }
    try {
      setEdit(id, { busy: true });
      await updatePropertyBasic(id, { agentName: finalName, agentPhone: finalPhone, agentEmail: finalEmail });
      setRows(cur => cur.map(x => (getId(x) === id ? { ...x, agentName: finalName, agentPhone: finalPhone, agentEmail: finalEmail } : x)));
      setEdit(id, { busy: false });
      setToast({ open: true, msg: 'Agent saved', sev: 'success' });
    } catch (err: any) {
      setEdit(id, { busy: false });
      setToast({ open: true, msg: err?.message || 'Save failed', sev: 'error' });
    }
  }, [edits, setEdit]);
  const GMAPS_KEY =
    (process.env.REACT_APP_GOOGLE_MAPS_GOOGLE_MAPS_KEY as string) ||
    (process.env.REACT_APP_GOOGLE_MAPS_KEY as string) ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY as string) ||
    '';

  const currency = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
    []
  );
 


const cleanAddress = (address?: string | null): string => {
  if (!address) return '';
  
  // Split the address into parts (street, city, state, zip)
  const parts = address.split(',').map(part => part.trim());
  if (parts.length < 2) return address;

  // Process the street address part
  const street = parts[0]
    // Remove everything from "Unit" (case-insensitive) to the end of the street part
    .split(/\s*(?:#|Unit|Apt|Apartment|Suite|Ste|Rm|Room|Bldg|Building|Lot|Spc|Space|Trlr|Trailer|Uint|Unt|U|#|No|Number)\b/i)[0]
    // Clean up any trailing special characters or spaces
    .replace(/[\s,-]+$/, '')
    .trim();
  
  // Reconstruct the address with cleaned street
  return [street, ...parts.slice(1)].filter(Boolean).join(', ');
};


  const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

  // Shared TextField styling so labels/inputs are visible against white dialog
  const tfSx = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: '#ffffff',
    },
    '& .MuiInputBase-input': {
      color: '#111827', // slate-900
    },
    '& .MuiInputLabel-root': {
      color: '#374151', // slate-700
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: '#d1d5db', // gray-300
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: '#9ca3af', // gray-400
    },
    '& .Mui-focused .MuiOutlinedInput-notchedOutline, &.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: '#111827', // slate-900
    },
  } as const;
  const tfLabelProps = { shrink: true } as const;

  const getLP = (r: any): number | null => {
    // Accept more backend aliases for listing price
    const direct = pickFirstNumber(
      r.listingPrice,
      r.price,
      r.listPrice,
      r.list_price,
      r.listing_price,     // snake_case variant
      r.lp,                // generic lp
      r.askingPrice,
      r.asking_price,
      r.askPrice,
      r.listprice,         // occasional lowercased merge
      r.currentListPrice,
      r.originalListPrice
    );
    if (direct) return direct;

    // Derive from 80% helper fields if present
    const lp80 = pickFirstNumber(r.lp80, r.listPrice80, r.listingPrice80);
    if (lp80) return Math.round(lp80 / 0.8);

    return null;
  };

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('[Deals:loadDeals] Starting fetch...');

      // Fetch ONLY real deals (AMV >= 2x LP AND AMV > $200k) from the endpoint
      const response = await apiFetch('/api/scraped-deals/deals?limit=500');
      console.log('[Deals:loadDeals] Response status:', response.status);

      const data = await response.json();
      console.log('[Deals:loadDeals] Response data:', data);

      if (!data.ok) {
        throw new Error(data.error || 'Failed to load deals');
      }

      // Capture user's allowed states from response
      if (data.userStates) {
        setUserStates(data.userStates);
      }

      const arr: Row[] = data.rows || [];

      console.log('[Deals:loadDeals] fetched REAL deals (AMV >= 2x LP):', arr.length);
      if (DEBUG) {
        console.log('[Deals:loadDeals] sample:', arr.slice(0, 3));
      }

      // Normalize the scraped deals data
      const normalized = arr.map((r: any) => {
        const listingPrice = toNum(r.listingPrice);
        const amv = toNum(r.amv);

        // derive fallbacks for calculated fields
        const lp80Final = listingPrice != null ? Math.round(listingPrice * 0.8) : null;
        const amv40Final = amv != null ? Math.round(amv * 0.4) : null;
        const amv30Final = amv != null ? Math.round(amv * 0.3) : null;

        const beds = toNum(r.beds);
        const baths = toNum(r.baths);
        const squareFeet = toNum(r.sqft);

        // derive state from fullAddress if missing
        const stateFromAddr = (() => {
          const addr = String(r.fullAddress ?? r.address ?? '').toUpperCase();
          const m = addr.match(/,\s*([A-Z]{2})\b(?:\s*\d{5}(?:-\d{4})?)?\s*$/);
          return m ? m[1] : null;
        })();
        const stateNorm = (r.state ? String(r.state).toUpperCase() : null) ?? stateFromAddr;

        return {
          ...r,
          _id: r._id,
          listingPrice,
          amv,
          lp80: lp80Final,
          amv40: amv40Final,
          amv30: amv30Final,
          beds,
          baths,
          squareFeet,
          state: stateNorm,
          source: r.source, // 'privy' or 'redfin'
        } as Row;
      });

      setRows(normalized);
      setTotals(prev => ({
        ...prev,
        deals: normalized.length,
        nonDeals: 0,
      }));
      if (DEBUG) {
        try {
          console.table(
            normalized.slice(0, 5).map((x: any) => ({
              id: x._id,
              address: x.fullAddress || x.address,
              listingPrice: x.listingPrice,
              amv: x.amv,
              source: x.source,
            }))
          );
        } catch (e) {
          console.warn('[Deals] post-normalize table failed', e);
        }
      }
      console.debug('[Deals] loaded scraped deals', { total: normalized.length });
    } catch (e: any) {
      console.error('Failed to load deals', e);
      setError(e?.message || 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, []);

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
        const privyCount = data.progress ? Object.values(data.progress.states).reduce((sum: number, s: any) => {
          const match = String(s.privy || '').match(/\((\d+)\)/);
          return sum + (match ? parseInt(match[1]) : 0);
        }, 0) : Math.floor(data.totalFetched / 2);
        const redfinCount = data.totalFetched - privyCount;
        const dealsFound = data.dealsCount ?? 0;
        const skippedCount = data.progress?.skippedExisting ?? 0;

        let statusMsg = `Done! Fetched ${data.totalFetched} new addresses (${privyCount} Privy + ${redfinCount} Redfin).`;
        if (skippedCount > 0) {
          statusMsg += ` Skipped ${skippedCount} existing.`;
        }
        statusMsg += ` Deals found: ${dealsFound} (AMV >= 2x LP). Saved: ${data.saved}, Updated: ${data.updated}, Failed: ${data.failed}`;

        setAutoFetchStatus(statusMsg);
        // Refresh the deals list
        loadDeals();
        loadSummary();
      } else {
        // Check if it's already running
        if (data.status) {
          setAutoFetchStatus(`Already in progress: ${data.status}`);
        } else {
          setAutoFetchStatus(`Error: ${data.error || 'Auto-fetch failed'}`);
        }
      }
    } catch (err: any) {
      console.error('Auto-fetch failed:', err);
      setAutoFetchStatus(`Error: ${err?.message || 'Auto-fetch failed'}`);
    } finally {
      setAutoFetching(false);
    }
  };

  // Filter rows by selected state, sort by AMV, and apply limit
  const displayedRows = useMemo(() => {
    let filtered = rows;
    if (filterState !== 'all') {
      filtered = rows.filter(r => {
        const rowState = (r.state || '').toUpperCase();
        return rowState === filterState.toUpperCase();
      });
    }
    // Sort by AMV
    const sorted = [...filtered].sort((a, b) => {
      const amvA = typeof a.amv === 'number' ? a.amv : 0;
      const amvB = typeof b.amv === 'number' ? b.amv : 0;
      return amvSortOrder === 'desc' ? amvB - amvA : amvA - amvB;
    });
    // Apply display limit
    return sorted.slice(0, displayLimit);
  }, [rows, filterState, displayLimit, amvSortOrder]);

  // Total count before limit (for showing "X of Y")
  const totalFilteredCount = useMemo(() => {
    if (filterState === 'all') return rows.length;
    return rows.filter(r => {
      const rowState = (r.state || '').toUpperCase();
      return rowState === filterState.toUpperCase();
    }).length;
  }, [rows, filterState]);

  useEffect(() => {
    if (!DEBUG) return;
    if (!selected) return;
    try {
      const lpSel = getLP(selected);
      const lp80Display  = typeof (selected as any).lp80 === 'number' ? (selected as any).lp80 : (typeof lpSel === 'number' ? Math.round(lpSel * 0.8) : null);
      const amv40Display = typeof (selected as any).amv40 === 'number' ? (selected as any).amv40 : (typeof (selected as any).amv === 'number' ? Math.round((selected as any).amv * 0.4) : null);
      const amv30Display = typeof (selected as any).amv30 === 'number' ? (selected as any).amv30 : (typeof (selected as any).amv === 'number' ? Math.round((selected as any).amv * 0.3) : null);
      console.group('[Deals:selected]');
      console.log('id', getId(selected));
      console.log('fullAddress', selected.fullAddress || selected.address);
      console.log('listingPrice(raw)', (selected as any).listingPrice, 'getLP()', lpSel);
      console.log('amv(raw)', (selected as any).amv);
      console.log('lp80 (display)', lp80Display);
      console.log('amv40 (display)', amv40Display);
      console.log('amv30 (display)', amv30Display);
      console.log('offer amount (min(lp80, amv40))', (Number.isFinite(Number(lp80Display)) && Number.isFinite(Number(amv40Display))) ? Math.min(Number(lp80Display), Number(amv40Display)) : null);
      console.groupEnd();
    } catch (e) {
      console.warn('[Deals:selected] debug failed', e);
    }
  }, [selected]);

  // initial load + refresh when page becomes visible again or when navigating to this page
  useEffect(() => {
    loadSummary();
    loadDeals();

    // Refresh data when user navigates back to this tab/page
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadSummary();
        loadDeals();
      }
    };

    // Refresh data when window gets focus (e.g., user switches back from another tab)
    const handleFocus = () => {
      loadSummary();
      loadDeals();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]); // Re-run when navigating to this page

  useEffect(() => {
    // Reset Street View as default when opening a property
    if (selected) setViewMode('street');
  }, [selected]);

  useEffect(() => {
    // Reset geocoded coords when selection changes
    setGeo(null);
    setStreetPano(null);

    if (!selected) return;
    // If backend already provided coords, use them
    if (typeof selected.lat === 'number' && typeof selected.lng === 'number') {
      setGeo({ lat: selected.lat, lng: selected.lng });
      return;
    }

    // If no API key, skip (iframe will fall back to non-key mode)
    if (!GMAPS_KEY) return;

    // Build an address string to geocode
    const addr =
      selected.fullAddress ||
      selected.address ||
      [selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ');
    if (!addr) return;

    const controller = new AbortController();
    const q = encodeURIComponent(addr);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GMAPS_KEY}`;

    (async () => {
      try {
        setGeoLoading(true);
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        const loc = data?.results?.[0]?.geometry?.location;
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          setGeo({ lat: loc.lat, lng: loc.lng });
        }
      } catch (_) {
        // ignore network/abort errors
      } finally {
        setGeoLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selected, GMAPS_KEY]);

  useEffect(() => {
    // Look up nearest Street View pano for better coverage
    // We prefer pano id over raw lat/lng to avoid map fallback when no imagery at the exact point.
    if (!selected || !GMAPS_KEY) return;

    // Prefer backend coords, else geocoded
    const lat = (typeof (selected as any)?.lat === 'number' ? (selected as any).lat : undefined) ?? (geo?.lat);
    const lng = (typeof (selected as any)?.lng === 'number' ? (selected as any).lng : undefined) ?? (geo?.lng);
    if (lat == null || lng == null) return;

    const controller = new AbortController();
    // radius in meters to search for a pano around the point
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=100&key=${GMAPS_KEY}`;

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        // If imagery exists nearby, prefer its pano_id for embedding
        if (data?.status === 'OK') {
          const pano = data?.pano_id ?? data?.location?.pano_id ?? null;
          if (pano) setStreetPano(pano);
          // If no pano_id provided but a nearby pano location is returned, update geo to that
          if (!pano && data?.location && typeof data.location.lat === 'number' && typeof data.location.lng === 'number') {
            setGeo({ lat: data.location.lat, lng: data.location.lng });
          }
        } else {
          // No coverage: ensure we don't keep a stale pano id
          setStreetPano(null);
        }
      } catch {
        // ignore network/abort errors
      }
    })();

    return () => controller.abort();
  }, [selected, geo?.lat, geo?.lng, GMAPS_KEY]);

  // Open delete confirmation dialog
  const openDeleteDialog = (r: Row) => {
    setDeleteDialog({ open: true, deal: r });
  };

  // Confirm delete from dialog
  const confirmDelete = async () => {
    const r = deleteDialog.deal;
    if (!r) return;

    const id = getId(r);
    if (!id) {
      setToast({ open: true, msg: 'Cannot delete: missing id', sev: 'error' });
      setDeleteDialog({ open: false, deal: null });
      return;
    }

    setDeleting(true);
    const prev = rows;
    setRows(cur => cur.filter(x => getId(x) !== id));
    try {
      const res = await deletePropertyById(String(id));
      if ((res as any)?.ok || res === undefined) {
        setToast({ open: true, msg: 'Deal deleted', sev: 'success' });
      } else {
        setToast({ open: true, msg: 'Deleted', sev: 'success' });
      }
    } catch (e: any) {
      setRows(prev);
      setToast({ open: true, msg: `Delete failed: ${e?.message || 'unknown error'}`, sev: 'error' });
    } finally {
      setDeleting(false);
      setDeleteDialog({ open: false, deal: null });
    }
  };

  // Open move dialog
  const openMoveDialog = (r: Row, toStage: string) => {
    setMoveDialog({ open: true, deal: r, toStage });
  };

  // Confirm move to stage
  const confirmMove = async () => {
    const { deal, toStage } = moveDialog;
    if (!deal || !toStage) return;

    const id = getId(deal);
    if (!id) {
      setToast({ open: true, msg: 'Cannot move: missing id', sev: 'error' });
      setMoveDialog({ open: false, deal: null, toStage: '' });
      return;
    }

    setMoving(true);
    try {
      const res = await apiFetch(`/api/deal-pipeline/move/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage })
      });
      const data = await res.json();

      if (data.success || data.deal) {
        // Remove from current view since it moved to another stage
        setRows(cur => cur.filter(x => getId(x) !== id));
        const stageLabels: Record<string, string> = {
          'email_sent': 'Email Sent',
          'follow_up': 'Follow Up',
          'deal_status': 'Deal Status'
        };
        setToast({ open: true, msg: `Moved to ${stageLabels[toStage] || toStage}`, sev: 'success' });
      } else {
        setToast({ open: true, msg: data.error || 'Failed to move deal', sev: 'error' });
      }
    } catch (e: any) {
      setToast({ open: true, msg: `Move failed: ${e?.message || 'unknown error'}`, sev: 'error' });
    } finally {
      setMoving(false);
      setMoveDialog({ open: false, deal: null, toStage: '' });
    }
  };

  // Legacy handleDelete for backwards compatibility (uses dialog now)
  const handleDelete = async (r: Row) => {
    openDeleteDialog(r);
  };

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    const id = getId(editDraft);
    if (!id) { setToast({ open: true, msg: 'Missing id; cannot save', sev: 'error' }); return; }

    const payload: Partial<Row> = {
          // address
          fullAddress: editDraft.fullAddress ?? null,
          address: editDraft.address ?? null,
          city: editDraft.city ?? null,
          state: editDraft.state ?? null,
          zip: editDraft.zip ?? null,
      
          // pricing / valuation
          listingPrice: editDraft.listingPrice ?? (editDraft.price ?? null),
          amv: editDraft.amv ?? null,
          bofa_value: editDraft.bofa_value ?? null,
          chase_value: editDraft.chase_value ?? null,
          movoto_adjusted: editDraft.movoto_adjusted ?? null,
          movoto_value: editDraft.movoto_value ?? null,
      
          // details
          beds: editDraft.beds ?? null,
          baths: editDraft.baths ?? null,
          squareFeet: (editDraft.squareFeet ?? editDraft.sqft) ?? null,
          built: (editDraft as any).built ?? null,
      
          // agent
          agentName: editDraft.agentName ?? null,
          agentPhone: editDraft.agentPhone ?? null,
          agentEmail: editDraft.agentEmail ?? null,
        };

    setRows(cur => cur.map(x => (getId(x) === id ? { ...x, ...payload } : x)));

    try {
      await updatePropertyBasic(String(id), payload);
      setToast({ open: true, msg: 'Changes saved', sev: 'success' });
      closeEdit();
    } catch (e: any) {
      setToast({ open: true, msg: `Save failed: ${e?.message || 'unknown error'}`, sev: 'error' });
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Loading deals…</div>;
  if (error)   return <div style={{ padding: 24, color: '#ef4444' }}>{error}</div>;

  const isAllStates = userStates === 'all';
  const statesLabel = isAllStates
    ? 'All States'
    : Array.isArray(userStates) && userStates.length > 0
      ? userStates.join(', ')
      : 'No states assigned';

  // Responsive table cell styles
  const cellPadding = isMobile ? '8px 4px' : '12px 6px';
  const cellFontSize = isMobile ? '13px' : '15px';
  const tdBaseResponsive: React.CSSProperties = {
    padding: cellPadding,
    borderBottom: '1px solid #e5e7eb',
    color: '#111827',
    verticalAlign: 'middle',
    fontSize: cellFontSize,
  };
  const tdRResponsive: React.CSSProperties = { ...tdBaseResponsive, textAlign: 'right', whiteSpace: 'nowrap' };
  const tdLWideResponsive: React.CSSProperties = { ...tdBaseResponsive, textAlign: 'left', minWidth: isMobile ? 120 : 160 };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#111827' }}>Deals</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: isMobile ? 12 : 14, color: '#6b7280' }}>Total: {rows.length}</div>
          <Chip
            label={automationRunning ? 'Running' : 'Stopped'}
            color={automationRunning ? 'success' : 'default'}
            size="small"
          />
          <Button
            variant="contained"
            onClick={handleStartAutomation}
            disabled={automationLoading || automationRunning}
            size="small"
            sx={{
              backgroundColor: '#22c55e',
              '&:hover': { backgroundColor: '#16a34a' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
              fontWeight: 600,
              px: isMobile ? 1 : 2,
              fontSize: isMobile ? 12 : 14,
            }}
          >
            {automationLoading && !automationRunning ? '...' : 'Start'}
          </Button>
          <Button
            variant="contained"
            onClick={handleStopAutomation}
            disabled={automationLoading || !automationRunning}
            size="small"
            sx={{
              backgroundColor: '#ef4444',
              '&:hover': { backgroundColor: '#dc2626' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
              fontWeight: 600,
              px: isMobile ? 1 : 2,
              fontSize: isMobile ? 12 : 14,
            }}
          >
            {automationLoading && automationRunning ? '...' : 'Stop'}
          </Button>
          {!isMobile && (
            <Button
              variant="outlined"
              onClick={checkAutomationStatus}
              disabled={automationLoading}
              size="small"
              sx={{
                borderColor: '#3b82f6',
                color: '#3b82f6',
                '&:hover': { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },
                textTransform: 'none',
                fontWeight: 600,
                px: 2,
              }}
            >
              Status
            </Button>
          )}
        </div>
      </div>

      {/* State access indicator */}
      <div style={{
        marginBottom: 16,
        padding: '8px 12px',
        background: isAllStates ? '#e0f2fe' : '#fef3c7',
        borderRadius: 6,
        display: 'inline-block',
        fontSize: 14,
        color: isAllStates ? '#0369a1' : '#92400e'
      }}>
        {isAllStates ? 'Viewing: All States (Admin)' : `Viewing: ${statesLabel}`}
      </div>

      {/* Filter Controls Box - same style as Redfin/Privy */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: isMobile ? 8 : 12,
          padding: isMobile ? 12 : 16,
          marginBottom: isMobile ? 12 : 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormControl
            size="small"
            sx={{
              minWidth: isMobile ? 140 : 200,
              flex: isMobile ? '1 1 140px' : 'none',
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Filter by State</InputLabel>
            <Select
              value={filterState}
              label="Filter by State"
              onChange={(e) => setFilterState(e.target.value)}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000', maxHeight: 400 } } }}
            >
              <MenuItem value="all">All States</MenuItem>
              {US_STATES.map((s) => (
                <MenuItem key={s.code} value={s.code}>
                  {s.code} - {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl
            size="small"
            sx={{
              minWidth: 160,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Show Limit</InputLabel>
            <Select
              value={displayLimit}
              label="Show Limit"
              onChange={(e) => setDisplayLimit(Number(e.target.value))}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000' } } }}
            >
              <MenuItem value={20}>20 addresses</MenuItem>
              <MenuItem value={25}>25 addresses</MenuItem>
              <MenuItem value={50}>50 addresses</MenuItem>
              <MenuItem value={100}>100 addresses</MenuItem>
              <MenuItem value={200}>200 addresses</MenuItem>
              <MenuItem value={500}>500 addresses</MenuItem>
              <MenuItem value={99999}>All</MenuItem>
            </Select>
          </FormControl>
          <FormControl
            size="small"
            sx={{
              minWidth: 160,
              '& .MuiOutlinedInput-root': {
                color: '#000',
                '& fieldset': { borderColor: '#000' },
                '&:hover fieldset': { borderColor: '#000' },
                '&.Mui-focused fieldset': { borderColor: '#000' },
              },
              '& .MuiInputLabel-root': { color: '#000' },
              '& .MuiSelect-icon': { color: '#000' },
            }}
          >
            <InputLabel>Sort by AMV</InputLabel>
            <Select
              value={amvSortOrder}
              label="Sort by AMV"
              onChange={(e) => setAmvSortOrder(e.target.value as 'desc' | 'asc')}
              MenuProps={{ PaperProps: { sx: { color: '#000', border: '1px solid #000' } } }}
            >
              <MenuItem value="desc">High to Low</MenuItem>
              <MenuItem value="asc">Low to High</MenuItem>
            </Select>
          </FormControl>
          <div style={{ fontSize: 14, color: '#6b7280', padding: '8px 0' }}>
            Showing: {displayedRows.length} of {totalFilteredCount} {filterState !== 'all' ? `(${filterState})` : ''}
          </div>
        </div>
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
        <Card title="Total Properties" value={totals.properties} />
        <Card title="Total Deals" value={totals.deals} />
        <Card title="Not Deals" value={totals.nonDeals} />
      </div>

      {/* Top scrollbar for mobile - synced with table */}
      {isMobile && (
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          style={{
            overflowX: 'auto',
            overflowY: 'hidden',
            marginBottom: 4,
            borderRadius: 6,
            background: '#f3f4f6',
          }}
        >
          <div style={{ width: 1100, height: 8 }} />
        </div>
      )}

      <div
        ref={tableScrollRef}
        onScroll={handleTableScroll}
        style={{
          overflowX: 'auto',
          borderRadius: isMobile ? 8 : 12,
          border: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? 1100 : 1000 }}>
          <thead>
            <tr style={{ background: '#111827', color: '#fff' }}>
              {[
                'Address',
                'LP',
                '80%',
                'AMV',
                '40%',
                '30%',
                'Offer',
                'Agent',
                'Email',
                '',
                'Move To',
                'Delete',
              ].map((h, i) => (
                <th
                  key={h + i}
                  style={{
                    textAlign: i === 0 ? 'left' : 'right',
                    padding: isMobile ? '8px 4px' : '10px 6px',
                    fontSize: isMobile ? 10 : 11,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    borderBottom: '1px solid rgba(255,255,255,0.12)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((r, i) => {
              const addr = r.fullAddress || r.address || '';
              const lp = getLP(r);
              const lp80Display  = typeof r.lp80  === 'number' ? r.lp80  : (typeof lp === 'number' ? Math.round(lp * 0.8) : null);
              const amv40Display = typeof r.amv40 === 'number' ? r.amv40 : (typeof r.amv === 'number' ? Math.round(r.amv * 0.4) : null);
              const amv30Display = typeof r.amv30 === 'number' ? r.amv30 : (typeof r.amv === 'number' ? Math.round(r.amv * 0.3) : null);
              const zebra = i % 2 === 0 ? '#ffffff' : '#f9fafb';
              const emailStatus = isAutoEmailSent(r);
              const id = String(getId(r));
              const e = edits[id] || {};

              if (DEBUG && i < 3) {
                try {
                  console.debug('[Deals:rowRender]', {
                    id,
                    addr,
                    lp,
                    lp80Display,
                    amv: r.amv,
                    amv40Display,
                    amv30Display
                  });
                } catch {
                  /* ignore */
                }
              }

              const hasAgentInfo = r.agentName || r.agentPhone || r.agentEmail;
              const isAgentExpanded = expandedAgentId === id;
              const isPrivySource = (r as any).source?.toLowerCase()?.startsWith('privy');
              const agentLookupStatus = (r as any).agentLookupStatus;

              return (
                <React.Fragment key={r._id || r.prop_id || (r.fullAddress || r.address)}>
                  <tr style={{ background: zebra }}>
                    <td style={{ ...tdLWideResponsive, cursor: 'pointer' }} onClick={() => { setSelected(r); setDetailTab('details'); }}>
                      <span style={{ fontWeight: 600 }}>{addr || '—'}</span>
                    </td>
                    <td style={tdRResponsive}>{fmt(lp)}</td>
                    <td style={tdRResponsive}>{fmt(lp80Display)}</td>
                    <td style={tdRResponsive}>{fmt(r.amv)}</td>
                    <td style={tdRResponsive}>{fmt(amv40Display)}</td>
                    <td style={tdRResponsive}>{fmt(amv30Display)}</td>
                    <td style={tdRResponsive}>{fmt(
                      (() => {
                        const a = typeof lp80Display === 'number' ? lp80Display : NaN;
                        const b = typeof amv40Display === 'number' ? amv40Display : NaN;
                        if (Number.isFinite(a) && Number.isFinite(b)) return Math.min(a, b);
                        if (Number.isFinite(a)) return a;
                        if (Number.isFinite(b)) return b;
                        return null;
                      })()
                    )}</td>
                    <td style={tdRResponsive}>
                      {hasAgentInfo ? (
                        <Button
                          size="small"
                          variant={isAgentExpanded ? 'contained' : 'outlined'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedAgentId(isAgentExpanded ? null : id);
                          }}
                          sx={{
                            textTransform: 'none',
                            fontSize: isMobile ? 11 : 14,
                            px: isMobile ? 1 : 2,
                            backgroundColor: isAgentExpanded ? '#7c3aed' : undefined,
                            '&:hover': { backgroundColor: isAgentExpanded ? '#6d28d9' : undefined },
                          }}
                        >
                          {isAgentExpanded ? 'Hide' : 'View'}
                        </Button>
                      ) : isPrivySource && agentLookupStatus === 'not_found' ? (
                        <span style={{ color: '#ef4444', fontSize: isMobile ? 11 : 13, fontWeight: 500 }}>No Agent</span>
                      ) : isPrivySource && (!agentLookupStatus || agentLookupStatus === 'pending') ? (
                        <span style={{ color: '#f59e0b', fontSize: isMobile ? 11 : 13, fontWeight: 500 }}>Pending</span>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: isMobile ? 11 : 13 }}>—</span>
                      )}
                    </td>
                    <td style={tdRResponsive}>
                      <Chip
                        size="small"
                        label={emailStatus ? 'SENT' : '—'}
                        color={emailStatus ? 'success' : 'default'}
                        variant={emailStatus ? 'filled' : 'outlined'}
                        sx={{
                          fontSize: isMobile ? 10 : 12,
                          ...(emailStatus
                            ? {}
                            : { color: '#111827', borderColor: '#9ca3af', bgcolor: 'transparent' })
                        }}
                      />
                    </td>
                    <td style={{ ...tdRResponsive, whiteSpace: 'nowrap' }}>
                      <Button size="small" variant="outlined" onClick={(ev) => { ev.stopPropagation(); openEdit(r); }} sx={{ mr: isMobile ? 0.5 : 1, fontSize: isMobile ? 11 : 14, px: isMobile ? 1 : 2 }}>Edit</Button>
                      {!isMobile && (
                        <Chip
                          label={
                            (r as any).source?.startsWith('privy')
                              ? ((r as any).source === 'privy-flip' ? 'Privy-Flip'
                                : (r as any).source === 'privy-Tear' ? 'Privy-Tear'
                                : 'Privy')
                              : (r as any).source === 'redfin' ? 'Redfin'
                              : (r as any).source || 'Other'
                          }
                          size="small"
                          sx={{
                            ml: 1,
                            fontWeight: 600,
                            fontSize: 11,
                            backgroundColor: (r as any).source?.startsWith('privy') ? '#f5f3ff' : (r as any).source === 'redfin' ? '#fef2f2' : '#f3f4f6',
                            color: (r as any).source?.startsWith('privy') ? '#7c3aed' : (r as any).source === 'redfin' ? '#dc2626' : '#6b7280',
                            border: `1px solid ${(r as any).source?.startsWith('privy') ? '#7c3aed' : (r as any).source === 'redfin' ? '#dc2626' : '#9ca3af'}`,
                          }}
                        />
                      )}
                    </td>
                    {/* Move To Column */}
                    <td style={{ ...tdRResponsive, whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(ev) => { ev.stopPropagation(); openMoveDialog(r, 'email_sent'); }}
                          sx={{
                            fontSize: isMobile ? 9 : 11,
                            px: isMobile ? 0.5 : 1,
                            py: 0.25,
                            minWidth: 'auto',
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
                          onClick={(ev) => { ev.stopPropagation(); openMoveDialog(r, 'follow_up'); }}
                          sx={{
                            fontSize: isMobile ? 9 : 11,
                            px: isMobile ? 0.5 : 1,
                            py: 0.25,
                            minWidth: 'auto',
                            color: '#d97706',
                            borderColor: '#d97706',
                            '&:hover': { backgroundColor: '#fffbeb', borderColor: '#b45309' }
                          }}
                        >
                          Follow
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(ev) => { ev.stopPropagation(); openMoveDialog(r, 'deal_status'); }}
                          sx={{
                            fontSize: isMobile ? 9 : 11,
                            px: isMobile ? 0.5 : 1,
                            py: 0.25,
                            minWidth: 'auto',
                            color: '#059669',
                            borderColor: '#059669',
                            '&:hover': { backgroundColor: '#ecfdf5', borderColor: '#047857' }
                          }}
                        >
                          Status
                        </Button>
                      </Stack>
                    </td>
                    {/* Delete Column */}
                    <td style={{ ...tdRResponsive, whiteSpace: 'nowrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={(ev) => { ev.stopPropagation(); openDeleteDialog(r); }}
                        sx={{
                          fontSize: isMobile ? 10 : 12,
                          px: isMobile ? 1 : 1.5,
                          minWidth: 'auto',
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                  {/* Expandable Agent Details Row */}
                  {isAgentExpanded && hasAgentInfo && (
                    <tr style={{ background: '#f5f3ff' }}>
                      <td colSpan={13} style={{ padding: '12px 14px' }}>
                        <div style={{
                          display: 'flex',
                          gap: 24,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          paddingLeft: 20,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#6b7280', fontSize: 13 }}>Name:</span>
                            <span style={{ fontWeight: 600, color: '#111' }}>{r.agentName || '—'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#6b7280', fontSize: 13 }}>Phone:</span>
                            {r.agentPhone ? (
                              <a
                                href={`tel:${r.agentPhone}`}
                                style={{ fontWeight: 600, color: '#7c3aed', textDecoration: 'none' }}
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {r.agentPhone}
                              </a>
                            ) : (
                              <span style={{ color: '#9ca3af' }}>—</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#6b7280', fontSize: 13 }}>Email:</span>
                            {r.agentEmail ? (
                              <a
                                href={`mailto:${r.agentEmail}`}
                                style={{ fontWeight: 600, color: '#7c3aed', textDecoration: 'none' }}
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {r.agentEmail}
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
            {!displayedRows.length && (
              <tr>
                <td colSpan={11} style={{ padding: 18, textAlign: 'center', color: '#6b7280' }}>
                  No deals found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      <Dialog open={!!editDraft} onClose={() => setEditDraft(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit deal</DialogTitle>
        <DialogContent dividers>
          {editDraft ? (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
  {/* Address block */}
  <TextField
    size="small"
    label="Full address"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={String(editDraft.fullAddress ?? editDraft.address ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, fullAddress: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="Address (line 1)"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={String(editDraft.address ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, address: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="City"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={String(editDraft.city ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, city: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="State"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={String(editDraft.state ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, state: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="ZIP"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={String(editDraft.zip ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, zip: e.target.value } : prev)}
  />

  {/* Pricing / valuation */}
  <TextField
    size="small" type="number" label="Listing Price"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.listingPrice ?? editDraft.price ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, listingPrice: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="AMV"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.amv ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, amv: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="BofA valuation"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.bofa_value ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, bofa_value: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Chase valuation"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.chase_value ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, chase_value: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Movoto (adjusted)"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.movoto_adjusted ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, movoto_adjusted: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Movoto (value/high)"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.movoto_value ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, movoto_value: e.target.value ? Number(e.target.value) : null } : prev)}
  />

  {/* Details */}
  <TextField
    size="small" type="number" label="Beds"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.beds ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, beds: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Baths"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={(editDraft.baths ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, baths: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Square Feet"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={((editDraft.squareFeet ?? editDraft.sqft) ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, squareFeet: e.target.value ? Number(e.target.value) : null } : prev)}
  />
  <TextField
    size="small" type="number" label="Year Built"
    InputLabelProps={tfLabelProps}
    sx={tfSx}
    value={((editDraft as any).built ?? '') as any}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, built: e.target.value ? Number(e.target.value) : null } : prev)}
  />

  {/* Agent */}
  <TextField
    size="small"
    label="Agent name"
    InputLabelProps={tfLabelProps}
    InputProps={{
      style: { color: '#000' }
    }}
    sx={{
      ...tfSx,
      minWidth: 160,
      '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 }
    }}
    value={String(editDraft.agentName ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, agentName: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="Agent phone"
    InputLabelProps={tfLabelProps}
    InputProps={{
      style: { color: '#000' }
    }}
    sx={{
      ...tfSx,
      minWidth: 160,
      '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 }
    }}
    value={String(editDraft.agentPhone ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, agentPhone: e.target.value } : prev)}
  />
  <TextField
    size="small"
    label="Agent email"
    InputLabelProps={tfLabelProps}
    InputProps={{
      style: { color: '#000' }
    }}
    sx={{
      ...tfSx,
      minWidth: 220,
      '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 }
    }}
    value={String(editDraft.agentEmail ?? '')}
    onChange={(e) => setEditDraft(prev => prev ? { ...prev, agentEmail: e.target.value } : prev)}
  />
</div>
          ) : (
            <div style={{ padding: 8, color: '#6b7280' }}>No deal selected.</div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDraft(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={!editDraft}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Detail modal */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        {selected && (
          <>
            <DialogTitle>Property details</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                {/* Map / Street View */}
                {(() => {
                  const addrForMap =
                    (selected?.fullAddress) ||
                    (selected?.address) ||
                    [selected?.address, selected?.city, selected?.state, selected?.zip].filter(Boolean).join(', ');

                  const addressQ = encodeURIComponent(addrForMap || '');

                  const hasKey = !!GMAPS_KEY;

                  // Prefer lat/lng if available (from backend or geocoding)
                  const lat = (typeof (selected as any)?.lat === 'number' ? (selected as any).lat : undefined) ?? (geo?.lat);
                  const lng = (typeof (selected as any)?.lng === 'number' ? (selected as any).lng : undefined) ?? (geo?.lng);

                  // --- Build true Street View endpoint ---
                  const streetSrc = (hasKey && (lat != null && lng != null))
                    ? (streetPano
                        ? `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&pano=${streetPano}&heading=0&pitch=0&fov=80`
                        : `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&location=${lat},${lng}&heading=0&pitch=0&fov=80`)
                    : (!hasKey && addrForMap)
                      ? `https://www.google.com/maps?q=${addressQ}&layer=c&output=svembed`
                      : '';

                  // Normal map for the Map tab
                  const mapSrc = hasKey
                    ? (lat != null && lng != null)
                      ? `https://www.google.com/maps/embed/v1/view?key=${GMAPS_KEY}&center=${lat},${lng}&zoom=16&maptype=roadmap`
                      : `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${addressQ}&zoom=16`
                    : `https://www.google.com/maps?hl=en&q=${addressQ}&z=16&output=embed`;

                  const streetExternal = (lat != null && lng != null)
                    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
                    : `https://www.google.com/maps/search/?api=1&query=${addressQ}&layer=c`;

                  return (
                    <div style={{ width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid #eee' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 8, borderBottom: '1px solid #eee', background: '#fafafa' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button
                            size="small"
                            variant={viewMode === 'street' ? 'contained' : 'outlined'}
                            onClick={() => setViewMode('street')}
                          >
                            Street View
                          </Button>
                          <Button
                            size="small"
                            variant={viewMode === 'map' ? 'contained' : 'outlined'}
                            onClick={() => setViewMode('map')}
                          >
                            Map
                          </Button>
                        </div>
                        <a
                          href={streetExternal}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', padding: '4px 6px' }}
                          title="Open this address in Google Maps Street View"
                        >
                          Open in Google Maps →
                        </a>
                      </div>
                      <div style={{ width: '100%', height: 280 }}>
                        {viewMode === 'street' ? (
                          streetSrc ? (
                            <iframe
                              key={`street-${streetPano ?? lat ?? addressQ}`}
                              title={'street-view'}
                              width="100%"
                              height="100%"
                              style={{ border: 0 }}
                              loading="lazy"
                              src={streetSrc}
                              referrerPolicy="no-referrer-when-downgrade"
                            />
                          ) : (
                            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',fontSize:13,color:'#6b7280',padding:12}}>
                              {geoLoading ? 'Loading Street View…' : 'Street View not available for this address. Showing map instead.'}
                            </div>
                          )
                        ) : (
                          <iframe
                            key={`map-${lat ?? addressQ}`}
                            title={'map'}
                            width="100%"
                            height="100%"
                            style={{ border: 0 }}
                            loading="lazy"
                            src={mapSrc}
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        )}
                      </div>
                    </div>
                  );
                })()}

                <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)} sx={{ mt: 1 }}>
                  <Tab value="details" label="Details" />
                  <Tab value="activity" label="Activity" />
                </Tabs>

                {detailTab === 'details' && (
                  <>
                    {(() => {
                      const lpSel = getLP(selected);
                      var _lp80Display = (typeof (selected as any).lp80 === 'number') ? (selected as any).lp80 : (typeof lpSel === 'number' ? Math.round(lpSel * 0.8) : null);
                      var _amv40Display = (typeof (selected as any).amv40 === 'number') ? (selected as any).amv40 : (typeof (selected as any).amv === 'number' ? Math.round((selected as any).amv * 0.4) : null);
                      var _amv30Display = (typeof (selected as any).amv30 === 'number') ? (selected as any).amv30 : (typeof (selected as any).amv === 'number' ? Math.round((selected as any).amv * 0.3) : null);
                      (selected as any).__lp80Display = _lp80Display;
                      (selected as any).__amv40Display = _amv40Display;
                      (selected as any).__amv30Display = _amv30Display;
                      return null;
                    })()}
                    {/* Deal fields in requested order */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} flexWrap="wrap">
                      <Info label="Full address" value={selected.fullAddress || selected.address || '—'} />
                      <Info label="L.P" value={fmt(getLP(selected))} />
                      <Info label="L.P 80%" value={fmt((selected as any).__lp80Display)} />
                      <Info label="AMV" value={fmt(selected.amv)} />
                      <Info label="AMV 40%" value={fmt((selected as any).__amv40Display)} />
                      <Info label="AMV 30%" value={fmt((selected as any).__amv30Display)} />
                      <Info
                        label="Offer amount"
                        value={fmt((() => {
                          const a = typeof (selected as any).__lp80Display === 'number' ? (selected as any).__lp80Display : NaN;
                          const b = typeof (selected as any).__amv40Display === 'number' ? (selected as any).__amv40Display : NaN;
                          if (Number.isFinite(a) && Number.isFinite(b)) return Math.min(a, b);
                          if (Number.isFinite(a)) return a;
                          if (Number.isFinite(b)) return b;
                          return null;
                        })())}
                      />
                      <Info
                        label="Email status"
                        value={isAutoEmailSent(selected) ? 'SENT' : 'UNSENT'}
                      />
                    </Stack>

                    {/* Beds / Baths / Sq Ft */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
                      <Info label="Bed" value={Number.isFinite(Number(selected.beds)) ? String(selected.beds) : '—'} />
                      <Info label="Bath" value={Number.isFinite(Number(selected.baths)) ? String(selected.baths) : '—'} />
                      <Info label="Sq Ft" value={Number.isFinite(Number((selected as any).squareFeet ?? selected.sqft)) ? String((selected as any).squareFeet ?? selected.sqft) : '—'} />
                    </Stack>

                    {/* Vendor valuations */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
                      <Info label="BofA valuation" value={fmt(selected.bofa_value)} />
                      <Info label="Redfin valuation" value={fmt((selected as any).redfin_adjusted ?? (selected as any).redfin_value ?? (selected as any).redfin)} />
                    </Stack>

                    {/* Agent details */}
                    <Stack direction="row" gap={2} flexWrap="wrap">
                      <Info label="Agent" value={selected.agentName ?? (selected as any).agent ?? 'Not found'} />
                      <Info label="Phone" value={selected.agentPhone ?? (selected as any).agent_phone ?? 'Not found'} />
                      <Info label="Email" value={selected.agentEmail ?? (selected as any).agent_email ?? 'Not found'} />
                    </Stack>

                    {/* Send email to agent (moved from table to details dialog) */}
                    {(() => {
                      const sid = String(getId(selected));
                      const eSel = edits[sid] || {};
                      return (
                        <div style={{ width: '100%', marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#111827' }}>Send email to agent</div>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap' }}>
                            <TextField
                              id={`agent-name-${sid}`}
                              size="small"
                              placeholder="Agent name"
                              value={eSel.agentName ?? selected.agentName ?? ''}
                              onChange={(ev) => setEdit(sid, { agentName: (ev.target as HTMLInputElement).value })}
                              InputProps={{ style: { color: '#000' } }}
                              sx={{ minWidth: 160, '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 } }}
                            />
                            <TextField
                              id={`agent-phone-${sid}`}
                              size="small"
                              placeholder="Agent phone"
                              value={eSel.agentPhone ?? selected.agentPhone ?? ''}
                              onChange={(ev) => setEdit(sid, { agentPhone: formatPhone((ev.target as HTMLInputElement).value) })}
                              InputProps={{ style: { color: '#000' } }}
                              sx={{ minWidth: 160, '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 } }}
                            />
                            <TextField
                              id={`agent-email-${sid}`}
                              size="small"
                              placeholder="Agent email"
                              value={eSel.agentEmail ?? selected.agentEmail ?? (selected as any).agent_email ?? ''}
                              onChange={(ev) => setEdit(sid, { agentEmail: (ev.target as HTMLInputElement).value })}
                              InputProps={{ style: { color: '#000' } }}
                              sx={{ minWidth: 220, '& .MuiInputBase-input::placeholder': { color: '#000', opacity: 1 } }}
                            />
                            <Button size="small" variant="outlined" onClick={() => onSaveAgentOnly(selected)} disabled={!!eSel.busy}>
                              Save agent
                            </Button>
                            <Button size="small" variant="contained" onClick={() => onSend(selected)} disabled={!!eSel.busy}>
                              Send offer
                            </Button>
                          </Stack>
                        </div>
                      );
                    })()}
                  </>
                )}

                {detailTab === 'activity' && (
                  <div style={{ marginTop: 8 }}>
                    {(() => {
                      const os: any = (selected as any).offerStatus || {};
                      const last = os?.lastSentAt ? new Date(os.lastSentAt) : null;
                      return (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <Info label="Last sent at" value={last ? last.toLocaleString() : '—'} />
                          <Info label="Message ID" value={os?.lastMessageId || '—'} />
                          <Info label="Sent by (subadminId)" value={os?.subadminId || '—'} />
                          <Info label="Last result" value={os?.lastResult || '—'} />
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </DialogActions>
          </>
        )}
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
          <Button onClick={confirmDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move to Stage Confirmation Dialog */}
      <Dialog open={moveDialog.open} onClose={() => setMoveDialog({ open: false, deal: null, toStage: '' })} maxWidth="xs" fullWidth>
        <DialogTitle>
          Move to {moveDialog.toStage === 'email_sent' ? 'Email Sent' : moveDialog.toStage === 'follow_up' ? 'Follow Up' : 'Deal Status'}
        </DialogTitle>
        <DialogContent>
          <p style={{ margin: 0, color: '#374151' }}>
            Move this deal to the <strong>{moveDialog.toStage === 'email_sent' ? 'Email Sent' : moveDialog.toStage === 'follow_up' ? 'Follow Up' : 'Deal Status'}</strong> page?
          </p>
          {moveDialog.deal && (
            <p style={{ margin: '12px 0 0', fontWeight: 600, color: '#111827' }}>
              {moveDialog.deal.fullAddress || moveDialog.deal.address || 'Unknown address'}
            </p>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog({ open: false, deal: null, toStage: '' })} disabled={moving}>
            Cancel
          </Button>
          <Button
            onClick={confirmMove}
            variant="contained"
            disabled={moving}
            sx={{
              backgroundColor: moveDialog.toStage === 'email_sent' ? '#2563eb' : moveDialog.toStage === 'follow_up' ? '#d97706' : '#059669',
              '&:hover': {
                backgroundColor: moveDialog.toStage === 'email_sent' ? '#1d4ed8' : moveDialog.toStage === 'follow_up' ? '#b45309' : '#047857',
              }
            }}
          >
            {moving ? 'Moving...' : 'Move'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={toast.open} autoHideDuration={3000} onClose={() => setToast(t => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setToast(t => ({ ...t, open: false }))} severity={toast.sev} variant="filled" sx={{ width: '100%' }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </div>
  );
}



function Card({ title, value }: { title: string; value: number | string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 16 }}>
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

const tdBase: React.CSSProperties = {
  padding: '12px 6px',
  borderBottom: '1px solid #e5e7eb',
  color: '#111827',
  verticalAlign: 'middle',
  fontSize: '15px',
};
const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdLWide: React.CSSProperties = { ...tdL, minWidth: 160 };