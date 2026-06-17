import axios from 'axios';

const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'https://casesync-backend.onrender.com';

const client = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});

export const getAccounts = async () => {
  const response = await client.get('/auth/accounts');
  return response.data.accounts || [];
};

export const removeAccount = async (email) => {
  const response = await client.delete(`/auth/accounts/${encodeURIComponent(email)}`);
  return response.data;
};

export const loginWithGoogle = (email = '', setup = '') => {
  const params = new URLSearchParams();
  const cleanEmail = String(email || '').trim();
  const cleanSetup = String(setup || '').trim();
  if (cleanEmail) {
    params.set('login_hint', cleanEmail);
  }
  if (cleanSetup) {
    params.set('setup', cleanSetup);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  window.location.href = `${apiBaseUrl}/auth/google${suffix}`;
};

export const getTriggers = async () => {
  const response = await client.get('/api/triggers');
  return response.data.triggers || [];
};

export const createTrigger = async (payload) => {
  const response = await client.post('/api/triggers', payload);
  return response.data.trigger;
};

export const updateTrigger = async (id, payload) => {
  const response = await client.put(`/api/triggers/${id}`, payload);
  return response.data.trigger;
};

export const deleteTrigger = async (id) => {
  const response = await client.delete(`/api/triggers/${id}`);
  return response.data;
};

export const toggleTrigger = async (id) => {
  const response = await client.patch(`/api/triggers/${id}/toggle`);
  return response.data.trigger;
};

export const runScan = async () => {
  const response = await client.post('/api/scan/run');
  return response.data;
};

export const getScanLogs = async () => {
  const response = await client.get('/api/scan/logs');
  return response.data.logs || [];
};

export const getScanStatus = async () => {
  const response = await client.get('/api/scan/status');
  return response.data;
};

export const getLastScanResult = async () => {
  const response = await client.get('/api/scan/last-result');
  return response.data.result || null;
};

export const getCases = async () => {
  const response = await client.get('/api/cases');
  return response.data.cases || [];
};

export const getCase = async (caseId) => {
  const response = await client.get(`/api/cases/${encodeURIComponent(caseId)}`);
  return response.data.case;
};

export const getCaseEmails = async (caseId) => {
  const response = await client.get(`/api/cases/${encodeURIComponent(caseId)}/emails`);
  return response.data.emails || [];
};

export const updateCaseEmail = async (caseId, messageId, payload) => {
  const response = await client.patch(
    `/api/cases/${encodeURIComponent(caseId)}/emails/${encodeURIComponent(messageId)}`,
    payload,
  );
  return response.data.email;
};

export const updateCaseStatus = async (caseId, status) => {
  const response = await client.patch(`/api/cases/${encodeURIComponent(caseId)}/status`, { status });
  return response.data;
};

export const updateCaseSettings = async (caseId, payload) => {
  const response = await client.patch(`/api/cases/${encodeURIComponent(caseId)}/settings`, payload);
  return response.data.case;
};

export const deleteCase = async (caseId) => {
  const response = await client.delete(`/api/cases/${encodeURIComponent(caseId)}`);
  return response.data;
};

export const confirmCase = async (caseId) => {
  const response = await client.post(`/api/cases/${encodeURIComponent(caseId)}/confirm`);
  return response.data;
};

export const createManualCase = async (payload) => {
  const response = await client.post('/api/cases/manual', payload);
  return response.data;
};

export const createCaseFolder = async (payload) => {
  const response = await client.post('/api/cases/folder', payload);
  return response.data.case;
};

export const getCalendars = async (email) => {
  const response = await client.get('/api/calendar/list', { params: { email } });
  return response.data.calendars || [];
};
