import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import cron from 'node-cron';

import { initDb, setScanState, getScanState, getStorageMode } from './lib/db.js';
import { getNextScheduledRun, runAutoScan } from './lib/scanner.js';
import authRouter from './routes/auth.js';
import triggersRouter from './routes/triggers.js';
import scanRouter from './routes/scan.js';
import casesRouter from './routes/cases.js';
import calendarRouter from './routes/calendar.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const corsOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'casesync-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
  },
}));

app.use('/auth', authRouter);
app.use('/api/triggers', triggersRouter);
app.use('/api/scan', scanRouter);
app.use('/api/cases', casesRouter);
app.use('/api/calendar', calendarRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'casesync-backend', storage: getStorageMode() });
});

app.get('/api/scan/status', async (_req, res) => {
  const state = await getScanState();
  res.json({
    isRunning: Boolean(state.isRunning),
    lastScan: state.lastRun || null,
    nextScan: state.nextRun || null,
  });
});

cron.schedule('0 8 * * *', async () => {
  try {
    await runAutoScan('auto');
  } catch (error) {
    console.error('Auto scan failed', error);
  }
});

await initDb();
setScanState({
  isRunning: false,
  nextRun: getNextScheduledRun(),
}).catch(() => undefined);

app.listen(port, () => {
  console.log(`CaseSync backend is running at http://localhost:${port}`);
});

export default app;
