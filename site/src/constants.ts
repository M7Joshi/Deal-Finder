// src/constants.ts

// Resolve API base (frontend .env takes priority, then CRA dev proxy fallback)
export const API_BASE: string =
  (process.env.REACT_APP_API_BASE_URL as string) ||
  'http://localhost:3015';

// Alias some projects expect
export const API_BASE_URL = API_BASE;

// Common US states list (sorted alphabetically by state code)
export const STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'IA', name: 'Iowa' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MD', name: 'Maryland' },
  { code: 'ME', name: 'Maine' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NY', name: 'New York' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WV', name: 'West Virginia' },
];

// Month names used by SummaryDashboard
export const monthNames = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// Centralized routes object (preferred)
export const routes = {
  auth: {
    login: `${API_BASE}/api/auth/login`,
    verify: `${API_BASE}/api/auth/verify`,
  },
  automation: {
    run: `${API_BASE}/api/automation/run`,
    service: {
      status: `${API_BASE}/api/automation/service/status`,
      start:  `${API_BASE}/api/automation/service/start`,
      stop:   `${API_BASE}/api/automation/service/stop`,
      restart:`${API_BASE}/api/automation/service/restart`,
    },
    otp: `${API_BASE}/api/automation/otp`,
    otpCancel: `${API_BASE}/api/automation/otp/cancel`,
    otpState: `${API_BASE}/api/automation/otp`,
  },
  properties: {
    base: `${API_BASE}/api/properties`,
    raw:  `${API_BASE}/api/properties/raw`,
    deals:`${API_BASE}/api/properties/deals`,
    table:`${API_BASE}/api/properties/table`,
  },
  propertiesTable: `${API_BASE}/api/properties/table`,
  users: {
    base:   `${API_BASE}/api/user`,
    create: `${API_BASE}/api/user/create`,
    update: (id: string) => `${API_BASE}/api/user/update/${id}`,
    delete: (id: string) => `${API_BASE}/api/user/delete/${id}`,
  },
};

// Backward-compatible named exports (so existing imports keep working)
export const automationRoute   = routes.automation.run;
export const propertiesRoute   = routes.properties.base;
export const rawPropertiesRoute= routes.properties.raw;
export const loginRoute        = routes.auth.login;
export const verifyRoute       = routes.auth.verify;
export const userRoute         = routes.users.base;
export const otpRoute          = routes.automation.otp;
export const otpCancelRoute    = routes.automation.otpCancel;
export const otpStateRoute     = routes.automation.otpState;
export const createUserRoute   = routes.users.create;
export const updateUserRoute   = routes.users.update;
export const deleteUserRoute   = routes.users.delete;