# CaseSync

CaseSync is an intelligent email-to-calendar case tracking system for legal operations. Users connect Google accounts, register trigger rules, scan Gmail for matching messages, extract case IDs and deadlines with Claude, then create or update Google Calendar events as the source of truth.

## What It Does

- Connects Google accounts with OAuth 2.0
- Stores trigger rules, scan logs, connected accounts, and processed email IDs in Postgres when `DATABASE_URL` is set, with local `lowdb` fallback for development
- Scans Gmail with sender and keyword rules
- Extracts case IDs, proof-of-service dates, response deadlines, and action items
- Calculates Proof of Service response deadlines from the proof date: personal service 30 days, electronic service 32 days by default, and mail service 35 days
- Creates or updates Google Calendar events using `extendedProperties`
- Creates related Calendar reminders for the response deadline, 2-week tickler, 1-week tickler, and client-call follow-up
- Adds discovery response skeletons, client questions, document requests, and verification explanation language to the case event description
- Shows tracked cases, deadline calendars, scan logs, and sticky notifications in the React UI
- Runs a daily automatic scan at 8:00 AM local server time with `node-cron`

## Project Structure

```text
casesync/
  backend/
    data/db.json
    src/index.js
    src/lib/calendar.js
    src/lib/db.js
    src/lib/gmail.js
    src/lib/parser.js
    src/lib/scanner.js
    src/routes/auth.js
    src/routes/calendar.js
    src/routes/cases.js
    src/routes/scan.js
    src/routes/triggers.js
  frontend/
    public/index.html
    src/App.jsx
    src/index.css
    src/components/
    src/pages/
    src/utils/api.js
```

## Google Setup

1. Open Google Cloud Console and create a project.
2. Enable Gmail API and Google Calendar API.
3. Configure OAuth consent screen and add yourself as a test user if the app is in testing mode.
4. Create an OAuth 2.0 Web Application client.
5. Add this authorized redirect URI:

```text
http://localhost:3001/auth/google/callback
```

## Anthropic Setup

Create an API key at `console.anthropic.com`. CaseSync uses `claude-sonnet-4-20250514` in `backend/src/lib/parser.js`.

## Environment

Create the backend environment file:

```bash
cd casesync/backend
cp .env.example .env
```

Fill these values:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
FRONTEND_ORIGIN=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
SESSION_SECRET=any_random_string
PORT=3001
SCAN_CALENDAR_ID=primary
ANTHROPIC_API_KEY=
DATABASE_URL=
DATABASE_SSL=true
```

## Supabase Postgres

For production, create a Supabase project and set the backend `DATABASE_URL` to your Supabase Postgres connection string. CaseSync automatically creates the required tables on startup.

Use the connection string only on the backend. Never expose it in frontend environment variables.

Recommended backend environment:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

Supabase documents connection strings and pooler options in their database connection guide: https://supabase.com/docs/guides/database/connecting-to-postgres

If port `3000` is occupied during local testing, run the frontend on `3002` and set:

```text
FRONTEND_ORIGIN=http://localhost:3002
CORS_ORIGINS=http://localhost:3000,http://localhost:3002
```

## Run Locally

Backend:

```bash
cd casesync/backend
npm install
npm run dev
```

Frontend:

```bash
cd casesync/frontend
npm install
npm start
```

Open `http://localhost:3000`. If using the alternate local port, run `PORT=3002 npm start` and open `http://localhost:3002`.

## Workflow

1. Connect a Google account.
2. Create a trigger rule with sender emails, keywords, optional case ID regex patterns, and a target calendar.
3. Run a manual scan or wait for the hourly auto scan.
4. CaseSync finds matching emails, parses deadlines, calculates proof-of-service response deadlines, and writes case records into Google Calendar.
5. For proof-of-service discovery emails, CaseSync also creates the 3+1 response calendar package: last-day deadline, two-week tickler, one-week tickler, and client-call follow-up.
6. The primary case event description includes response skeletons, client-meeting questions, requested documents, and verification language.
7. New and updated cases appear in the dashboard, calendar, case list, and notification bell.

## API Summary

| API | Method | Description |
| --- | --- | --- |
| `/auth/google` | GET | Start Google OAuth |
| `/auth/google/callback` | GET | Save tokens and account profile |
| `/auth/accounts` | GET | List connected accounts without tokens |
| `/auth/accounts/:email` | DELETE | Remove connected account |
| `/api/triggers` | GET/POST | List or create trigger rules |
| `/api/triggers/:id` | PUT/DELETE | Update or delete trigger rules |
| `/api/triggers/:id/toggle` | PATCH | Enable or disable a trigger |
| `/api/scan/run` | POST | Run a manual scan |
| `/api/scan/logs` | GET | Return recent scan logs |
| `/api/scan/status` | GET | Return scan state |
| `/api/scan/last-result` | GET | Return latest scan log with notifications |
| `/api/cases` | GET | List Calendar-backed case events |
| `/api/cases/:caseId` | GET | Get a single case |
| `/api/cases/:caseId/status` | PATCH | Update case status |
| `/api/cases/:caseId/confirm` | POST | Confirm/open a notified case |
| `/api/cases/:caseId` | DELETE | Delete a case Calendar event |
| `/api/calendar/list` | GET | List writable calendars for an account |

## Notes

- Google Calendar is the case source of truth.
- Postgres stores trigger rules, scan history, connected account tokens for cron, and processed email IDs when `DATABASE_URL` is configured. Without `DATABASE_URL`, local `lowdb` JSON fallback is used.
- Browser notifications require the user to allow notification permission in the browser.
- Real Gmail and Calendar scans require valid Google OAuth credentials and a valid Anthropic API key.
