import express from 'express';
import {
  runAutoScan,
  getScanStatus,
} from '../lib/scanner.js';
import { getLastScan, getRecentScanLogs } from '../lib/db.js';

const router = express.Router();

router.post('/run', async (_req, res) => {
  try {
    const result = await runAutoScan('manual');
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
