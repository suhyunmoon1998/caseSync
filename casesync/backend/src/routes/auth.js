import express from 'express';
import { google } from 'googleapis';
import {
  upsertAccount,
  getAccounts,
  removeAccount,
} from '../lib/db.js';

const router = express.Router();
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

const scopeList = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

router.get('/google', (_req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: scopeList,
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) {
    return res.redirect(`${FRONTEND_ORIGIN}?error=missing_code`);
  }

  try {
    const tokenResult = await oauth2Client.getToken(code);
    const tokens = tokenResult.tokens || {};

    const authWithToken = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    authWithToken.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: authWithToken });
    const profileResult = await oauth2.userinfo.get();
    const profile = profileResult.data || {};

    const email = profile.email || '';
    const sessionAccounts = req.session.accounts || [];
    const nextSession = sessionAccounts.filter((item) => item.email !== email);
    const next = {
      email,
      name: profile.name || null,
      picture: profile.picture || null,
      tokens,
    };

    req.session.accounts = [...nextSession, next];
    req.session.save?.();

    await upsertAccount({
      email,
      name: profile.name || null,
      picture: profile.picture || null,
      tokens,
      calendarAccess: true,
    });

    res.redirect(`${FRONTEND_ORIGIN}?connected=true`);
  } catch (error) {
    console.error('OAuth callback error', error);
    res.redirect(`${FRONTEND_ORIGIN}?error=oauth_failed`);
  }
});

router.get('/accounts', async (_req, res) => {
  const accounts = await getAccounts();
  const sessionAccounts = _req.session.accounts || [];
  const byEmail = new Map((accounts || []).map((acc) => [acc.email, acc]));

  const merged = [...new Map([
    ...sessionAccounts.map((acc) => [acc.email, acc]),
    ...byEmail,
  ].map(([email, value]) => [email, {
    email,
    name: value.name || null,
    picture: value.picture || null,
    tokenExpiryDate: value.tokenExpiryDate || null,
    calendarAccess: value.calendarAccess || null,
  }])).values()];

  res.json({ accounts: merged });
});

router.delete('/accounts/:email', async (req, res) => {
  const target = decodeURIComponent(req.params.email);
  req.session.accounts = (req.session.accounts || []).filter((item) => item.email !== target);
  await removeAccount(target);
  res.json({ success: true });
});

export default router;
