import express from 'express';
import { getRawAccountWithTokens } from '../lib/db.js';
import { getAuthClient } from '../lib/gmail.js';
import { listCalendars } from '../lib/calendar.js';

const router = express.Router();

router.get('/list', async (_req, res) => {
  const email = String(_req.query.email || '').trim();
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const account = await getRawAccountWithTokens(email);
  if (!account?.tokens) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const auth = getAuthClient(account.tokens, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  try {
    const calendars = await listCalendars(auth);
    res.json({ calendars });
  } catch (error) {
    console.error('List calendars failed', error);
    res.status(500).json({ error: 'Failed to load calendars' });
  }
});

export default router;
