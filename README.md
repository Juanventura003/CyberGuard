# CyberGuard

CyberGuard is a React + Vite frontend with a FastAPI (Python) backend. The **Email Scanner** checks emails for phishing and reports a risk score, a classification (`SAFE` / `PHISHING`), a confidence value, and a plain-English explanation of why.

## Using the Email Scanner

Open the app and go to **Email Scanner** (`/email-scanner`). Choose one of two modes. Each scan handles up to 50 emails.

### Option 1: Paste emails manually
No account needed.

1. Click **Paste emails manually**.
2. Fill in the sender address, and optionally the subject, body and any links (one per line).
3. Click **Add to queue**. Repeat for each email.
4. Click the analyze button to scan the whole queue.

### Option 2: Connect Gmail
1. Click **Connect Gmail account** and sign in with Google.
2. Tick the messages you want to scan from your inbox list.
3. Click the analyze button.

CyberGuard requests `gmail.modify` so it can read messages and move emails you choose to Trash from the scan results. It never sends mail or permanently deletes anything; trashed messages stay recoverable in Gmail for 30 days.

### Reading the results
- **Risk score** (0–100): higher means more likely phishing.
- **Classification**: `SAFE` or `PHISHING`.
- **Explanation**: the indicators found, such as urgency language or requests for credentials.

## Running it on a new device

### Prerequisites
- [Node.js](https://nodejs.org) 18 or newer (includes npm)
- [Python](https://www.python.org/downloads/) 3.10 or newer
- Git

### 1. One-time setup
Open a terminal in the project root (the `CyberGuard` folder).

Create the backend's Python virtual environment and install its packages:

**Windows (PowerShell):**
```powershell
python -m venv src\backend\.venv
src\backend\.venv\Scripts\python.exe -m pip install -r src\backend\requirements.txt
```

**macOS / Linux:**
```bash
python3 -m venv src/backend/.venv
src/backend/.venv/bin/python -m pip install -r src/backend/requirements.txt
```

Then install the frontend packages (same on every OS):
```bash
npm install
```

Finally, add your settings to `src/backend/.env` and the root `.env` (see [Configuration](#configuration)).

### 2. Run the app
From the project root, on Windows, macOS or Linux:
```bash
npm run dev:all
```
This starts the frontend and the backend together in one terminal. `npm run backend` picks the right virtual environment Python for your OS automatically (`.venv\Scripts\python.exe` on Windows, `.venv/bin/python` on macOS/Linux).

- Frontend: http://localhost:5173
- Backend health check: http://localhost:8000/api/health should show `{"status":"healthy"}`. Interactive API docs are at http://localhost:8000/docs.

Stop both with `Ctrl+C`.

To run them in separate terminals instead, use `npm run backend` in one and `npm run dev` in the other.

## Configuration

Backend settings are read from environment variables or from `src/backend/.env`. Put your Google credentials in `src/backend/.env`. `.env` is git-ignored, so your secret stays local.

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | *(empty)* | Google OAuth client ID (Gmail mode) |
| `GOOGLE_CLIENT_SECRET` | *(empty)* | Google OAuth client secret (Gmail mode) |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/email/oauth/callback` | Must exactly match a redirect URI registered in Google Cloud |
| `GOOGLE_WEB_RISK_API_KEY` | *(empty)* | Google Web Risk API key used by Website Tracker and the browser extension |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed frontend origin (CORS and OAuth return check) |
| `SESSION_TTL_MINUTES` | `30` | How long a Gmail session lasts |
| `SUPABASE_URL` | *(empty)* | Supabase project URL used for authentication and website history |
| `SUPABASE_ANON_KEY` | *(empty)* | Public Supabase key used by the frontend and backend token validation |
| `SUPABASE_SERVICE_ROLE_KEY` | *(empty)* | Server-only Supabase key used by the backend to write website history |

To point the frontend at a backend on a different address, set `VITE_API_BASE_URL` (default `http://localhost:8000`) in a `.env` file in the project root. The frontend Supabase client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from that same file.

Keep all backend credentials in `src/backend/.env`; never copy them into the frontend or extension files. The service-role key is especially sensitive and must never be exposed to the browser. The root `.env` is only for frontend-safe values such as `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.

### Browser extension and Website Tracker

The extension checks websites using Google Web Risk, OpenPhish, and URL/page signals. Website Tracker shows saved visits, risk scores, and explanations, with search, filters, personal blocking, and history deletion. Scores indicate evidence strength, not a probability that a site is unsafe.

```bash
npm run build:extension
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `extension/dist`.
3. Keep the backend running. Sign in to CyberGuard and open **Website Tracker** to connect history saving.

Use the popup to control monitoring, floating notifications, and personal website blocks. Organization rules show Warn, Block, or temporary-access status. Page checks do not collect entered values or raw page contents.

After extension changes, rebuild, reload the extension, and refresh website tabs. Restart the backend after backend changes. OpenPhish needs no API key; Google Web Risk uses `GOOGLE_WEB_RISK_API_KEY`.

### Cyber Assistant
The Cyber Assistant uses a local guided knowledge base for cybersecurity questions and can redirect you to app pages (Email Scanner, Website Tracker, and so on).

Open **Cyber Assistant** in the sidebar (`/cyber-assistant`). Try questions like “Where is the Email Scanner?” or “How do I spot phishing?” — answers include clickable links to the right CyberGuard page.

### CyberTech News

News collects BleepingComputer RSS articles every five minutes while the backend runs. Search, filter by topic, read summaries, and open original articles. Recent news retains collected articles for seven days after publication; signed-in users can keep private saved copies until they unsave them.

Supabase preserves the retained feed across restarts, and its scheduled cleanup removes expired articles without deleting saved copies or team notices. A new feed may cover less than a week. Source or storage failures are shown in the app.

## Troubleshooting

- **`Backend virtualenv not found`**: the virtual environment hasn't been created on this computer yet. Run the one-time setup above. A `.venv` copied from another OS won't work; create a fresh one on each machine.
- **`ModuleNotFoundError` when starting the backend**: the backend packages aren't installed in the virtual environment. Rerun the `pip install` step from the one-time setup.
- **Frontend shows a network or CORS error**: make sure the backend is running on port 8000 and `FRONTEND_ORIGIN` matches the URL in your browser.
- **Google says `redirect_uri_mismatch`**: the redirect URI in Google Cloud must match `GOOGLE_REDIRECT_URI` exactly.
- **Google says the app isn't verified or access is blocked**: add your account as a test user.
- **Port already in use**: stop the other process, or use a different `--port` and update `GOOGLE_REDIRECT_URI` / `VITE_API_BASE_URL` to match.

## Team Security

Create an organization from the team toolbar, invite verified accounts inside CyberGuard, and manage members. Each organization has its own admins and data; admins do not receive members’ complete browsing history or inbox access.

- **Website protection:** Admins publish Warn or Block rules for enrolled browser profiles. Members can continue past warnings or request review of a block.
- **Temporary access:** Admins can approve one member for 15 minutes, 1 hour, 4 hours, or 24 hours. Normal website use is allowed; personal blocks and other matching restrictions still apply. Expiry is handled locally, although Chrome can delay it during sleep. Early revocation requires synchronization.
- **Security inbox:** Members explicitly share selected findings. Admins respond with guidance or website actions and can archive handled findings without changing protection.
- **Team notices:** Admins share News articles with guidance. Members acknowledge notices; admins see receipt counts and can pin, expire, or archive notices.
- **Presence:** Members explicitly accept required Active/Away and approximate device/OS sharing. Admins retain optional sharing. Presence covers CyberGuard activity only, with a two-second Away grace period.
- **Organization lifecycle:** Owners can archive, restore, or delete a team. Archive preserves read-only records but revokes browser connections and temporary approvals; members reconnect after restoration.

Protection applies only to connected browser profiles and remains after CyberGuard sign-out. Offline browsers keep cached restrictions until they successfully sync. Personal blocks remain separate.

Use the team’s configured Supabase project for Team Security and persistent News. A separate project needs the organization/news database setup and scheduled cleanup; obtain that setup from the team. Keep `SUPABASE_SERVICE_ROLE_KEY` in the backend environment only.
