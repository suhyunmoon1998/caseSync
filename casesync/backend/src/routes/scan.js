import express from 'express';
import {
  runAutoScan,
  getScanStatus,
} from '../lib/scanner.js';
import { getLastScan, getRecentScanLogs } from '../lib/db.js';

const router = express.Router();

const boundedLimit = (value, fallback, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
};

const parseCaseIds = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseBoolean = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
};

router.post('/run', async (req, res) => {
  try {
    const result = await runAutoScan('manual', {
      maxEmails: boundedLimit(req.body?.maxEmails || req.query.maxEmails, undefined, 1000),
      caseFolderMaxEmails: boundedLimit(req.body?.caseFolderMaxEmails || req.query.caseFolderMaxEmails, undefined, 250),
      caseIds: parseCaseIds(req.body?.caseIds || req.query.caseIds),
      caseFolderOnly: parseBoolean(req.body?.caseFolderOnly ?? req.query.caseFolderOnly, false),
      includeTriggers: parseBoolean(req.body?.includeTriggers ?? req.query.includeTriggers, true),
    });
    res.json({ success: true, result });
  } catch (error) {
    console.error('Scan failed', error);
    res.status(500).json({ error: error.message || 'Failed to run scan' });
  }
});

router.get('/logs', async (_req, res) => {
  const logs = await getRecentScanLogs(20);
  res.json({ logs });
});

router.get('/last-result', async (_req, res) => {
  const result = await getLastScan();
  res.json({ result });
});

router.get('/status', async (_req, res) => {
  const state = await getScanStatus();
  const nextRun = state.nextRun || null;
  res.json({
    isRunning: Boolean(state.isRunning),
    lastScan: state.lastRun || null,
    nextScan: nextRun,
  });
});

export default router;
