import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = path.resolve(__dirname, '../../data/db.json');

const defaultData = {
  triggers: [],
  scanLog: [],
  accounts: [],
  processedEmailIds: [],
  scanState: {
    isRunning: false,
    lastRun: null,
    nextRun: null,
  },
};

const adapter = new JSONFile(dbFile);
const db = new Low(adapter, defaultData);

const ensureDbFile = async () => {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  const current = await fs.readFile(dbFile, 'utf8').catch(() => null);
  if (!current) {
    await fs.writeFile(dbFile, JSON.stringify(defaultData, null, 2), 'utf8');
  }
};

const sanitizeData = (data) => ({
  ...defaultData,
  ...data,
  triggers: Array.isArray(data?.triggers) ? data.triggers : defaultData.triggers,
  scanLog: Array.isArray(data?.scanLog) ? data.scanLog : defaultData.scanLog,
  accounts: Array.isArray(data?.accounts) ? data.accounts : defaultData.accounts,
  processedEmailIds: Array.isArray(data?.processedEmailIds) ? data.processedEmailIds : defaultData.processedEmailIds,
  scanState: data?.scanState && typeof data.scanState === 'object'
    ? data.scanState
    : defaultData.scanState,
});

export const initDb = async () => {
  await ensureDbFile();
  await db.read();
  db.data = sanitizeData(db.data || {});
  await db.write();
};

const write = async () => {
  db.data.scanLog = db.data.scanLog.slice(-2000);
  db.data.processedEmailIds = db.data.processedEmailIds.slice(-10000);
  await db.write();
};

// Triggers
export const getTriggers = async () => {
  await db.read();
  return db.data.triggers.slice();
};

export const addTrigger = async (payload) => {
  const trigger = {
    id: uuidv4(),
    name: payload.name,
    senderEmails: payload.senderEmails || [],
    keywords: payload.keywords || [],
    caseIdPatterns: payload.caseIdPatterns || [],
    calendarId: payload.calendarId || 'primary',
    enabled: payload.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  db.data.triggers.push(trigger);
  await write();
  return trigger;
};

export const updateTrigger = async (id, payload) => {
  const index = db.data.triggers.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const next = {
    ...db.data.triggers[index],
    ...payload,
    id,
  };
  db.data.triggers[index] = next;
  await write();
  return next;
};

export const deleteTrigger = async (id) => {
  const nextTriggers = db.data.triggers.filter((item) => item.id !== id);
  if (nextTriggers.length === db.data.triggers.length) {
    return false;
  }
  db.data.triggers = nextTriggers;
  await write();
  return true;
};

export const toggleTrigger = async (id) => {
  const index = db.data.triggers.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  db.data.triggers[index] = {
    ...db.data.triggers[index],
    enabled: !db.data.triggers[index].enabled,
  };
  await write();
  return db.data.triggers[index];
};

// Scan log
export const addScanLog = async (entry) => {
  const item = {
    id: uuidv4(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trigger: entry.trigger || 'manual',
    emailsScanned: 0,
    casesCreated: 0,
    casesUpdated: 0,
    notifications: [],
    errors: [],
    ...entry,
  };
  db.data.scanLog.unshift(item);
  db.data.scanLog = db.data.scanLog.slice(0, 200);
  await write();
  return item;
};

export const updateScanLog = async (id, patch) => {
  const index = db.data.scanLog.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  db.data.scanLog[index] = {
    ...db.data.scanLog[index],
    ...patch,
  };
  await write();
  return db.data.scanLog[index];
};

export const getRecentScanLogs = async (n = 20) => {
  await db.read();
  return db.data.scanLog.slice(0, n);
};

export const getScanState = async () => {
  await db.read();
  return db.data.scanState;
};

export const setScanState = async (state) => {
  db.data.scanState = {
    ...db.data.scanState,
    ...state,
  };
  await write();
};

// Accounts
export const getAccounts = async () => {
  await db.read();
  return db.data.accounts.map((account) => ({
    email: account.email,
    name: account.name || null,
    picture: account.picture || null,
    tokenExpiryDate: account.tokens?.expiry_date || null,
    calendarAccess: account.calendarAccess || null,
  }));
};

export const upsertAccount = async (account) => {
  const existingIndex = db.data.accounts.findIndex((item) => item.email === account.email);
  const payload = {
    ...account,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex === -1) {
    db.data.accounts.push(payload);
  } else {
    db.data.accounts[existingIndex] = {
      ...db.data.accounts[existingIndex],
      ...payload,
    };
  }
  await write();
};

export const removeAccount = async (email) => {
  db.data.accounts = db.data.accounts.filter((item) => item.email !== email);
  await write();
};

export const getRawAccountWithTokens = async (email) => {
  await db.read();
  return db.data.accounts.find((item) => item.email === email) || null;
};

export const getAllAccountsRaw = async () => {
  await db.read();
  return db.data.accounts.slice();
};

// Processed IDs
export const isProcessedEmail = async (messageId) => {
  await db.read();
  return db.data.processedEmailIds.includes(String(messageId));
};

export const markEmailProcessed = async (messageId) => {
  const idText = String(messageId);
  if (!db.data.processedEmailIds.includes(idText)) {
    db.data.processedEmailIds.push(idText);
  }
  await write();
};

export const getLastScan = async () => {
  await db.read();
  return db.data.scanLog[0] || null;
};
