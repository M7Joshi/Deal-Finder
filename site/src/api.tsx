const BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3015';

// --- Auth token helpers ---
export function setAuthToken(token: string) {
  if (!token) return;
  try {
    localStorage.setItem('token', token);
    localStorage.setItem('authToken', token);
  } catch {}
}

export function clearAuthToken() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('authToken');
  } catch {}
}

function authHeaders() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Unified JSON handler that throws on HTTP errors
async function asJson<T = any>(res: Response): Promise<T> {
  let payload: any = null;
  try { payload = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload as T;
}

// Helper to build query strings safely
function qs(params: Record<string, any> = {}): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// === Auth ===
export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await asJson<{ token?: string; ok?: boolean; success?: boolean; user?: any }>(res);
  if ((data as any).token) setAuthToken((data as any).token);
  return data;
}

export async function verify() {
  const res = await fetch(`${BASE}/api/auth/verify`, { headers: { ...authHeaders() } });
  return asJson(res);
}

// === Dashboard / Deals ===
export async function getDashboardRows(params: { page?: number; limit?: number; q?: string; onlyDeals?: boolean } = {}) {
  const res = await fetch(`${BASE}/api/properties/table${qs(params)}`, { headers: { ...authHeaders() } });
  return asJson(res);
}

export async function getDashboardSummary() {
  const res = await fetch(`${BASE}/api/dashboard/summary`, { headers: { ...authHeaders() } });
  return asJson(res);
}

// Convenience: fetch only deals (subadmins will be state-scoped by the API)
export async function getDeals(params: { page?: number; limit?: number; q?: string } = {}) {
  const res = await fetch(`${BASE}/api/properties/table${qs({ ...params, onlyDeals: true })}` , { headers: { ...authHeaders() } });
  return asJson(res);
}

// === User Management (Admin-only) ===
export async function createUser(data: any) {
  const res = await fetch(`${BASE}/api/user/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return asJson(res);
}

export async function updateUser(id: string, updates: any) {
  const res = await fetch(`${BASE}/api/user/update/${id}` , {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(updates),
  });
  return asJson(res);
}

export async function deleteUser(id: string) {
  const res = await fetch(`${BASE}/api/user/delete/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return asJson(res);
}

export async function getUsers() {
  const res = await fetch(`${BASE}/api/user`, { headers: { ...authHeaders() } });
  return asJson(res);
}

// === Automation Control ===
export async function getServiceStatus() {
  const res = await fetch(`${BASE}/api/automation/service/status`, { headers: { ...authHeaders() } });
  return asJson(res);
}

export async function startService() {
  const res = await fetch(`${BASE}/api/automation/service/start`, { method: 'POST', headers: { ...authHeaders() } });
  return asJson(res);
}

export async function stopService() {
  const res = await fetch(`${BASE}/api/automation/service/stop`, { method: 'POST', headers: { ...authHeaders() } });
  return asJson(res);
}

export async function restartService() {
  const res = await fetch(`${BASE}/api/automation/service/restart`, { method: 'POST', headers: { ...authHeaders() } });
  return asJson(res);
}

// Optional: simple health check
export async function ping() {
  const res = await fetch(`${BASE}/api/health`);
  return asJson(res);
}

// === OTP (Automation) ===
export async function getOtpState() {
  const res = await fetch(`${BASE}/api/automation/otp`, {
    headers: { ...authHeaders() },
  });
  return asJson(res); // -> { ok, otp: {...} | null } from /api/automation/otp
}

export async function submitOtp(input: { id?: string; service?: string; code: string } | string) {
  const payload = typeof input === 'string' ? { code: input } : input;
  const res = await fetch(`${BASE}/api/automation/otp/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return asJson(res); // -> { ok: true }
}

export async function cancelOtp() {
  const res = await fetch(`${BASE}/api/automation/otp/cancel`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return asJson(res); // -> { ok: true }
}
// === Properties: edit/delete ===
export async function updatePropertyBasic(id: string, payload: {
  listingPrice?: number | null;
  amv?: number | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
}) {
  const res = await fetch(`${BASE}/api/properties/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

// === ScrapedDeals: edit ===
export async function updateScrapedDeal(id: string, payload: {
  fullAddress?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  listingPrice?: number | null;
  amv?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  brokerage?: string | null;
}) {
  const res = await fetch(`${BASE}/api/scraped-deals/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

export async function deletePropertyById(id: string) {
  const res = await fetch(`${BASE}/api/properties/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (res.status === 204) return { ok: true };
  return asJson(res);
}

export async function sendAgentOffer(propertyId: string, payload: {
  agentName: string; agentPhone: string; agentEmail: string;
}) {
  const res = await fetch(`${BASE}/api/agent-offers/send/${encodeURIComponent(propertyId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

// === Live Scraping (no database) ===
export async function liveScrapePrivy(params: { state?: string; city?: string; limit?: number; page?: number } = {}, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/api/live-scrape/privy${qs(params)}`, {
    headers: authHeaders() as HeadersInit,
    signal
  });
  return asJson(res);
}

export async function liveScrapeRedfin(params: { state: string; limit?: number } = { state: 'CA' }, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/api/live-scrape/redfin${qs(params)}`, {
    headers: authHeaders() as HeadersInit,
    signal
  });
  return asJson(res);
}

export async function liveScrapeTest(params: { limit?: number } = {}, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/api/live-scrape/test${qs(params)}`, {
    headers: authHeaders() as HeadersInit,
    signal
  });
  return asJson(res);
}

// === Scraped Deals (new deal-finding system) ===

// Get all scraped addresses (deals and non-deals)
export async function getScrapedDeals(params: { state?: string; source?: string; limit?: number; skip?: number } = {}) {
  const res = await fetch(`${BASE}/api/scraped-deals${qs(params)}`, {
    headers: authHeaders() as HeadersInit,
  });
  return asJson(res);
}

// Get only real deals (AMV >= 2x LP)
export async function getRealDeals(params: { state?: string; source?: string; limit?: number; skip?: number } = {}) {
  const res = await fetch(`${BASE}/api/scraped-deals/deals${qs(params)}`, {
    headers: authHeaders() as HeadersInit,
  });
  return asJson(res);
}

// Get scraped deals stats
export async function getScrapedDealsStats() {
  const res = await fetch(`${BASE}/api/scraped-deals/stats`, {
    headers: authHeaders() as HeadersInit,
  });
  return asJson(res);
}

// Recalculate isDeal for all existing records
export async function recalculateDeals() {
  const res = await fetch(`${BASE}/api/scraped-deals/recalculate`, {
    method: 'POST',
    headers: authHeaders() as HeadersInit,
  });
  return asJson(res);
}