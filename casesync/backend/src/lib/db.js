import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
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
  cases: [],
  emails: [],
  scanState: {
    isRunning: false,
    lastRun: null,
    nextRun: null,
  },
};

const adapter = new JSONFile(dbFile);
const db = new Low(adapter, defaultData);

let pool = null;
let storageMode = 'json';

const shouldUsePostgres = () => Boolean(process.env.DATABASE_URL);

const getPool = () => {
  if (!shouldUsePostgres()) {
    return null;
  }

  if (!pool) {
    const sslSetting = process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: false };

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslSetting,
    });
  }

  return pool;
};

const toSnake = (value = '') => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const normalizeScanLogRow = (row) => ({
  id: row.id,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  trigger: row.trigger,
  emailsScanned: row.emails_scanned || 0,
  casesCreated: row.cases_created || 0,
  casesUpdated: row.cases_updated || 0,
  notifications: row.notifications || [],
  errors: row.errors || [],
  skipped: Boolean(row.skipped),
  reason: row.reason || undefined,
});

const normalizeTriggerRow = (row) => ({
  id: row.id,
  name: row.name,
  senderEmails: row.sender_emails || [],
  keywords: row.keywords || [],
  caseIdPatterns: row.case_id_patterns || [],
  calendarId: row.calendar_id || 'primary',
  enabled: row.enabled !== false,
  createdAt: row.created_at,
});

const normalizeCaseRow = (row) => ({
  id: row.id,
  caseId: row.case_id,
  caseTitle: row.case_title || row.case_id,
  status: row.status || 'active',
  triggerId: row.trigger_id || null,
  triggerName: row.trigger_name || null,
  htmlLink: row.html_link || '',
  summary: row.summary || '',
  description: row.description || '',
  lastUpdated: row.last_updated || row.updated_at,
  caseConfidence: row.case_confidence === null || row.case_confidence === undefined ? null : Number(row.case_confidence),
  isEstimated: Boolean(row.is_estimated),
  deadlines: row.deadlines || [],
  sourceCalendarId: row.source_calendar_id || 'primary',
  sourceAccount: row.source_account || '',
  sourceEventSummary: row.source_event_summary || '',
  start: row.start_payload || null,
  end: row.end_payload || null,
  proofServiceDate: row.proof_service_date || '',
  proofServiceMethod: row.proof_service_method || '',
  responseDeadlineDate: row.response_deadline_date || '',
  discoverySets: row.discovery_sets || [],
});

const normalizeCaseEmailRow = (row) => ({
  messageId: row.message_id,
  threadId: row.thread_id || '',
  caseId: row.case_id,
  accountEmail: row.account_email || '',
  fromEmail: row.from_email || '',
  subject: row.subject || '(No subject)',
  snippet: row.snippet || '',
  bodyPreview: row.body_preview || '',
  receivedAt: row.received_at || row.created_at || null,
  triggerId: row.trigger_id || null,
  triggerName: row.trigger_name || '',
  caseConfidence: row.case_confidence === null || row.case_confidence === undefined ? null : Number(row.case_confidence),
  classification: row.classification || 'matched',
  needsReview: Boolean(row.needs_review),
  sourceReason: row.source_reason || '',
  raw: row.raw || {},
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
});

const normalizeAccountRow = (row, includeTokens = false) => {
  const account = {
    email: row.email,
    name: row.name || null,
    picture: row.picture || null,
    tokenExpiryDate: row.tokens?.expiry_date || null,
    calendarAccess: row.calendar_access || null,
    updatedAt: row.updated_at || null,
  };

  if (includeTokens) {
    account.tokens = row.tokens || null;
  }

  return account;
};

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
  cases: Array.isArray(data?.cases) ? data.cases : defaultData.cases,
  emails: Array.isArray(data?.emails) ? data.emails : defaultData.emails,
  scanState: data?.scanState && typeof data.scanState === 'object'
    ? data.scanState
    : defaultData.scanState,
});

const initJsonDb = async () => {
  await ensureDbFile();
  await db.read();
  db.data = sanitizeData(db.data || {});
  await db.write();
};

const initPostgresDb = async () => {
  const pg = getPool();
  await pg.query(`
    create table if not exists accounts (
      email text primary key,
      name text,
      picture text,
      tokens jsonb not null default '{}'::jsonb,
      calendar_access boolean,
      updated_at timestamptz not null default now()
    )
  `);
  await pg.query(`
    create table if not exists triggers (
      id uuid primary key,
      name text not null,
      sender_emails text[] not null default '{}',
      keywords text[] not null default '{}',
      case_id_patterns text[] not null default '{}',
      calendar_id text not null default 'primary',
      enabled boolean not null default true,
      created_at timestamptz not null default now()
    )
  `);
  await pg.query(`
    create table if not exists scan_log (
      id uuid primary key,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      trigger text not null default 'manual',
      emails_scanned integer not null default 0,
      cases_created integer not null default 0,
      cases_updated integer not null default 0,
      notifications jsonb not null default '[]'::jsonb,
      errors jsonb not null default '[]'::jsonb,
      skipped boolean not null default false,
      reason text
    )
  `);
  await pg.query(`
    create table if not exists processed_email_ids (
      message_id text primary key,
      created_at timestamptz not null default now()
    )
  `);
  await pg.query(`
    create table if not exists cases (
      case_id text primary key,
      event_id text,
      case_title text,
      status text not null default 'active',
      trigger_id text,
      trigger_name text,
      html_link text,
      summary text,
      description text,
      last_updated timestamptz,
      case_confidence integer,
      is_estimated boolean not null default false,
      deadlines jsonb not null default '[]'::jsonb,
      source_calendar_id text not null default 'primary',
      source_account text,
      source_event_summary text,
      start_payload jsonb,
      end_payload jsonb,
      proof_service_date text,
      proof_service_method text,
      response_deadline_date text,
      discovery_sets text[] not null default '{}',
      updated_at timestamptz not null default now()
    )
  `);
  await pg.query(`
    create table if not exists case_emails (
      message_id text primary key,
      thread_id text,
      case_id text not null,
      account_email text,
      from_email text,
      subject text,
      snippet text,
      body_preview text,
      received_at timestamptz,
      trigger_id text,
      trigger_name text,
      case_confidence integer,
      classification text not null default 'matched',
      needs_review boolean not null default false,
      source_reason text,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pg.query('create index if not exists idx_case_emails_case_id on case_emails (case_id)');
  await pg.query('create index if not exists idx_case_emails_needs_review on case_emails (needs_review)');
  await pg.query(`
    create table if not exists app_state (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);
  await pg.query(
    `insert into app_state (key, value)
     values ('scanState', $1::jsonb)
     on conflict (key) do nothing`,
    [JSON.stringify(defaultData.scanState)],
  );
};

export const initDb = async () => {
  if (shouldUsePostgres()) {
    storageMode = 'postgres';
    await initPostgresDb();
    return;
  }

  storageMode = 'json';
  await initJsonDb();
};

export const getStorageMode = () => storageMode;

const write = async () => {
  db.data.scanLog = db.data.scanLog.slice(-2000);
  db.data.processedEmailIds = db.data.processedEmailIds.slice(-10000);
  await db.write();
};

export const getTriggers = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from triggers order by created_at asc');
    return rows.map(normalizeTriggerRow);
  }

  await db.read();
  return db.data.triggers.slice();
};

export const addTrigger = async (payload) => {
  if (storageMode === 'postgres') {
    const id = uuidv4();
    const { rows } = await getPool().query(
      `insert into triggers (id, name, sender_emails, keywords, case_id_patterns, calendar_id, enabled)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        id,
        payload.name,
        payload.senderEmails || [],
        payload.keywords || [],
        payload.caseIdPatterns || [],
        payload.calendarId || 'primary',
        payload.enabled !== false,
      ],
    );
    return normalizeTriggerRow(rows[0]);
  }

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
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `update triggers
       set name = $2,
           sender_emails = $3,
           keywords = $4,
           case_id_patterns = $5,
           calendar_id = $6,
           enabled = $7
       where id = $1
       returning *`,
      [
        id,
        payload.name,
        payload.senderEmails || [],
        payload.keywords || [],
        payload.caseIdPatterns || [],
        payload.calendarId || 'primary',
        payload.enabled !== false,
      ],
    );
    return rows[0] ? normalizeTriggerRow(rows[0]) : null;
  }

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
  if (storageMode === 'postgres') {
    const result = await getPool().query('delete from triggers where id = $1', [id]);
    return result.rowCount > 0;
  }

  const nextTriggers = db.data.triggers.filter((item) => item.id !== id);
  if (nextTriggers.length === db.data.triggers.length) {
    return false;
  }
  db.data.triggers = nextTriggers;
  await write();
  return true;
};

export const toggleTrigger = async (id) => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `update triggers set enabled = not enabled where id = $1 returning *`,
      [id],
    );
    return rows[0] ? normalizeTriggerRow(rows[0]) : null;
  }

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

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `insert into scan_log (
        id, started_at, finished_at, trigger, emails_scanned, cases_created,
        cases_updated, notifications, errors, skipped, reason
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       returning *`,
      [
        item.id,
        item.startedAt,
        item.finishedAt,
        item.trigger,
        item.emailsScanned,
        item.casesCreated,
        item.casesUpdated,
        JSON.stringify(item.notifications || []),
        JSON.stringify(item.errors || []),
        Boolean(item.skipped),
        item.reason || null,
      ],
    );
    return normalizeScanLogRow(rows[0]);
  }

  db.data.scanLog.unshift(item);
  db.data.scanLog = db.data.scanLog.slice(0, 200);
  await write();
  return item;
};

export const updateScanLog = async (id, patch) => {
  if (storageMode === 'postgres') {
    const allowed = new Set([
      'finishedAt',
      'trigger',
      'emailsScanned',
      'casesCreated',
      'casesUpdated',
      'notifications',
      'errors',
      'skipped',
      'reason',
    ]);
    const entries = Object.entries(patch || {}).filter(([key]) => allowed.has(key));
    if (!entries.length) {
      const { rows } = await getPool().query('select * from scan_log where id = $1', [id]);
      return rows[0] ? normalizeScanLogRow(rows[0]) : null;
    }

    const values = [id];
    const sets = entries.map(([key, value], index) => {
      const column = toSnake(key);
      values.push(Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value);
      const cast = key === 'notifications' || key === 'errors' ? '::jsonb' : '';
      return `${column} = $${index + 2}${cast}`;
    });

    const { rows } = await getPool().query(
      `update scan_log set ${sets.join(', ')} where id = $1 returning *`,
      values,
    );
    return rows[0] ? normalizeScanLogRow(rows[0]) : null;
  }

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
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      'select * from scan_log order by started_at desc limit $1',
      [n],
    );
    return rows.map(normalizeScanLogRow);
  }

  await db.read();
  return db.data.scanLog.slice(0, n);
};

export const getScanState = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query("select value from app_state where key = 'scanState'");
    return rows[0]?.value || defaultData.scanState;
  }

  await db.read();
  return db.data.scanState;
};

export const setScanState = async (state) => {
  if (storageMode === 'postgres') {
    const current = await getScanState();
    const next = {
      ...current,
      ...state,
    };
    await getPool().query(
      `insert into app_state (key, value, updated_at)
       values ('scanState', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(next)],
    );
    return;
  }

  db.data.scanState = {
    ...db.data.scanState,
    ...state,
  };
  await write();
};

export const getAccounts = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from accounts order by updated_at desc');
    return rows.map((row) => normalizeAccountRow(row, false));
  }

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
  if (storageMode === 'postgres') {
    await getPool().query(
      `insert into accounts (email, name, picture, tokens, calendar_access, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, now())
       on conflict (email) do update set
         name = excluded.name,
         picture = excluded.picture,
         tokens = excluded.tokens,
         calendar_access = excluded.calendar_access,
         updated_at = now()`,
      [
        account.email,
        account.name || null,
        account.picture || null,
        JSON.stringify(account.tokens || {}),
        account.calendarAccess || null,
      ],
    );
    return;
  }

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
  if (storageMode === 'postgres') {
    await getPool().query('delete from accounts where email = $1', [email]);
    return;
  }

  db.data.accounts = db.data.accounts.filter((item) => item.email !== email);
  await write();
};

export const getRawAccountWithTokens = async (email) => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from accounts where email = $1', [email]);
    return rows[0] ? normalizeAccountRow(rows[0], true) : null;
  }

  await db.read();
  return db.data.accounts.find((item) => item.email === email) || null;
};

export const getAllAccountsRaw = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from accounts order by updated_at desc');
    return rows.map((row) => normalizeAccountRow(row, true));
  }

  await db.read();
  return db.data.accounts.slice();
};

export const isProcessedEmail = async (messageId) => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      'select message_id from processed_email_ids where message_id = $1',
      [String(messageId)],
    );
    return rows.length > 0;
  }

  await db.read();
  return db.data.processedEmailIds.includes(String(messageId));
};

export const markEmailProcessed = async (messageId) => {
  if (storageMode === 'postgres') {
    await getPool().query(
      `insert into processed_email_ids (message_id) values ($1) on conflict do nothing`,
      [String(messageId)],
    );
    await getPool().query(`
      delete from processed_email_ids
      where message_id in (
        select message_id
        from processed_email_ids
        order by created_at desc
        offset 10000
      )
    `);
    return;
  }

  const idText = String(messageId);
  if (!db.data.processedEmailIds.includes(idText)) {
    db.data.processedEmailIds.push(idText);
  }
  await write();
};

export const getLastScan = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from scan_log order by started_at desc limit 1');
    return rows[0] ? normalizeScanLogRow(rows[0]) : null;
  }

  await db.read();
  return db.data.scanLog[0] || null;
};


export const upsertCaseRecord = async (record) => {
  const payload = {
    id: record.id || record.eventId || record.caseId,
    caseId: record.caseId,
    caseTitle: record.caseTitle || record.caseId,
    status: record.status || 'active',
    triggerId: record.triggerId || record.trigger?.id || null,
    triggerName: record.triggerName || record.trigger?.name || null,
    htmlLink: record.htmlLink || '',
    summary: record.summary || '',
    description: record.description || '',
    lastUpdated: record.lastUpdated || new Date().toISOString(),
    caseConfidence: Number.isFinite(Number(record.caseConfidence)) ? Number(record.caseConfidence) : null,
    isEstimated: Boolean(record.isEstimated ?? record.estimated),
    deadlines: Array.isArray(record.deadlines) ? record.deadlines : [],
    sourceCalendarId: record.sourceCalendarId || record.calendarId || 'primary',
    sourceAccount: record.sourceAccount || record.sourceEmail || '',
    sourceEventSummary: record.sourceEventSummary || record.summary || '',
    start: record.start || null,
    end: record.end || null,
    proofServiceDate: record.proofServiceDate || '',
    proofServiceMethod: record.proofServiceMethod || '',
    responseDeadlineDate: record.responseDeadlineDate || '',
    discoverySets: Array.isArray(record.discoverySets) ? record.discoverySets : [],
  };

  if (!payload.caseId) {
    return null;
  }

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `insert into cases (
        case_id, event_id, case_title, status, trigger_id, trigger_name, html_link, summary,
        description, last_updated, case_confidence, is_estimated, deadlines, source_calendar_id,
        source_account, source_event_summary, start_payload, end_payload, proof_service_date,
        proof_service_method, response_deadline_date, discovery_sets, updated_at
       ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14,
        $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22, now()
       )
       on conflict (case_id) do update set
        event_id = excluded.event_id,
        case_title = excluded.case_title,
        status = excluded.status,
        trigger_id = excluded.trigger_id,
        trigger_name = excluded.trigger_name,
        html_link = excluded.html_link,
        summary = excluded.summary,
        description = excluded.description,
        last_updated = excluded.last_updated,
        case_confidence = excluded.case_confidence,
        is_estimated = excluded.is_estimated,
        deadlines = excluded.deadlines,
        source_calendar_id = excluded.source_calendar_id,
        source_account = excluded.source_account,
        source_event_summary = excluded.source_event_summary,
        start_payload = excluded.start_payload,
        end_payload = excluded.end_payload,
        proof_service_date = excluded.proof_service_date,
        proof_service_method = excluded.proof_service_method,
        response_deadline_date = excluded.response_deadline_date,
        discovery_sets = excluded.discovery_sets,
        updated_at = now()
       returning *`,
      [
        payload.caseId,
        payload.id,
        payload.caseTitle,
        payload.status,
        payload.triggerId,
        payload.triggerName,
        payload.htmlLink,
        payload.summary,
        payload.description,
        payload.lastUpdated,
        payload.caseConfidence,
        payload.isEstimated,
        JSON.stringify(payload.deadlines),
        payload.sourceCalendarId,
        payload.sourceAccount,
        payload.sourceEventSummary,
        JSON.stringify(payload.start),
        JSON.stringify(payload.end),
        payload.proofServiceDate,
        payload.proofServiceMethod,
        payload.responseDeadlineDate,
        payload.discoverySets,
      ],
    );
    return normalizeCaseRow(rows[0]);
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  const index = db.data.cases.findIndex((item) => item.caseId === payload.caseId);
  const next = { ...payload, updatedAt: new Date().toISOString() };
  if (index === -1) {
    db.data.cases.unshift(next);
  } else {
    db.data.cases[index] = { ...db.data.cases[index], ...next };
  }
  await write();
  return next;
};

export const getCaseRecordsFromDb = async () => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query('select * from cases order by updated_at desc');
    return rows.map(normalizeCaseRow);
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  return db.data.cases.slice();
};

export const updateCaseRecordStatus = async (caseId, status) => {
  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      'update cases set status = $2, updated_at = now() where case_id = $1 returning *',
      [caseId, status],
    );
    return rows[0] ? normalizeCaseRow(rows[0]) : null;
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  const index = db.data.cases.findIndex((item) => item.caseId === caseId);
  if (index === -1) {
    return null;
  }
  db.data.cases[index] = { ...db.data.cases[index], status, updatedAt: new Date().toISOString() };
  await write();
  return db.data.cases[index];
};

export const deleteCaseRecord = async (caseId) => {
  if (storageMode === 'postgres') {
    const result = await getPool().query('delete from cases where case_id = $1', [caseId]);
    return result.rowCount > 0;
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  const next = db.data.cases.filter((item) => item.caseId !== caseId);
  const deleted = next.length !== db.data.cases.length;
  db.data.cases = next;
  await write();
  return deleted;
};

const normalizeEmailDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const emailPreview = (value = '', limit = 1800) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

export const upsertCaseEmailRecord = async (record) => {
  const payload = {
    messageId: String(record.messageId || record.id || '').trim(),
    threadId: record.threadId || '',
    caseId: String(record.caseId || '').trim(),
    accountEmail: record.accountEmail || '',
    fromEmail: record.fromEmail || record.from || '',
    subject: record.subject || '(No subject)',
    snippet: record.snippet || '',
    bodyPreview: emailPreview(record.bodyPreview || record.body || record.snippet || ''),
    receivedAt: normalizeEmailDate(record.receivedAt || record.date),
    triggerId: record.triggerId || record.trigger?.id || null,
    triggerName: record.triggerName || record.trigger?.name || '',
    caseConfidence: Number.isFinite(Number(record.caseConfidence)) ? Number(record.caseConfidence) : null,
    classification: record.classification || 'matched',
    needsReview: Boolean(record.needsReview),
    sourceReason: record.sourceReason || '',
    raw: record.raw || {},
  };

  if (!payload.messageId || !payload.caseId) {
    return null;
  }

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `insert into case_emails (
        message_id, thread_id, case_id, account_email, from_email, subject, snippet,
        body_preview, received_at, trigger_id, trigger_name, case_confidence,
        classification, needs_review, source_reason, raw, updated_at
       ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, now()
       )
       on conflict (message_id) do update set
        thread_id = excluded.thread_id,
        case_id = excluded.case_id,
        account_email = excluded.account_email,
        from_email = excluded.from_email,
        subject = excluded.subject,
        snippet = excluded.snippet,
        body_preview = excluded.body_preview,
        received_at = excluded.received_at,
        trigger_id = excluded.trigger_id,
        trigger_name = excluded.trigger_name,
        case_confidence = excluded.case_confidence,
        classification = excluded.classification,
        needs_review = excluded.needs_review,
        source_reason = excluded.source_reason,
        raw = excluded.raw,
        updated_at = now()
       returning *`,
      [
        payload.messageId,
        payload.threadId,
        payload.caseId,
        payload.accountEmail,
        payload.fromEmail,
        payload.subject,
        payload.snippet,
        payload.bodyPreview,
        payload.receivedAt,
        payload.triggerId,
        payload.triggerName,
        payload.caseConfidence,
        payload.classification,
        payload.needsReview,
        payload.sourceReason,
        JSON.stringify(payload.raw),
      ],
    );
    return normalizeCaseEmailRow(rows[0]);
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  const now = new Date().toISOString();
  const index = db.data.emails.findIndex((item) => item.messageId === payload.messageId);
  const next = {
    ...payload,
    createdAt: index === -1 ? now : db.data.emails[index].createdAt,
    updatedAt: now,
  };
  if (index === -1) {
    db.data.emails.unshift(next);
  } else {
    db.data.emails[index] = { ...db.data.emails[index], ...next };
  }
  await write();
  return next;
};

export const getCaseEmailRecords = async (caseId, limit = 50) => {
  const targetCaseId = String(caseId || '').trim();
  if (!targetCaseId) {
    return [];
  }

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `select * from case_emails
       where case_id = $1
       order by needs_review desc, received_at desc nulls last, updated_at desc
       limit $2`,
      [targetCaseId, limit],
    );
    return rows.map(normalizeCaseEmailRow);
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  return db.data.emails
    .filter((item) => item.caseId === targetCaseId)
    .sort((a, b) => {
      if (Boolean(a.needsReview) !== Boolean(b.needsReview)) {
        return Boolean(a.needsReview) ? -1 : 1;
      }
      return String(b.receivedAt || b.updatedAt || '').localeCompare(String(a.receivedAt || a.updatedAt || ''));
    })
    .slice(0, limit);
};

export const getCaseEmailByMessageId = async (messageId) => {
  const id = String(messageId || '').trim();
  if (!id) {
    return null;
  }

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      'select * from case_emails where message_id = $1',
      [id],
    );
    return rows[0] ? normalizeCaseEmailRow(rows[0]) : null;
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  return db.data.emails.find((item) => item.messageId === id) || null;
};

export const updateCaseEmailRecord = async (messageId, patch = {}) => {
  const id = String(messageId || '').trim();
  if (!id) {
    return null;
  }

  const nextCaseId = patch.caseId ? String(patch.caseId).trim() : null;
  const nextNeedsReview = patch.needsReview === undefined ? null : Boolean(patch.needsReview);
  const nextClassification = patch.classification ? String(patch.classification).trim() : null;
  const nextReason = patch.sourceReason ? String(patch.sourceReason).trim() : null;

  if (storageMode === 'postgres') {
    const { rows } = await getPool().query(
      `update case_emails set
        case_id = coalesce($2, case_id),
        needs_review = coalesce($3, needs_review),
        classification = coalesce($4, classification),
        source_reason = coalesce($5, source_reason),
        updated_at = now()
       where message_id = $1
       returning *`,
      [id, nextCaseId, nextNeedsReview, nextClassification, nextReason],
    );
    return rows[0] ? normalizeCaseEmailRow(rows[0]) : null;
  }

  await db.read();
  db.data = sanitizeData(db.data || {});
  const index = db.data.emails.findIndex((item) => item.messageId === id);
  if (index === -1) {
    return null;
  }

  db.data.emails[index] = {
    ...db.data.emails[index],
    ...(nextCaseId ? { caseId: nextCaseId } : {}),
    ...(nextNeedsReview === null ? {} : { needsReview: nextNeedsReview }),
    ...(nextClassification ? { classification: nextClassification } : {}),
    ...(nextReason ? { sourceReason: nextReason } : {}),
    updatedAt: new Date().toISOString(),
  };
  await write();
  return db.data.emails[index];
};
