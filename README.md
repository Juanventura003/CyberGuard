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

The extension monitors completed HTTP(S) tabs, analyzes URLs through the local backend, caches successful analyses locally for 24 hours, and keeps a local activity list. Signed-in website analyses are also written to the Supabase `website_history` table by the backend.

Build the extension from the project root:

```bash
npm run build:extension
```

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`. After source changes, run the build again and click **Reload** for the extension. Keep both the frontend and backend running. Open the Website Tracker while signed in once so the extension can receive the current Supabase access token. The extension itself does not contain API keys; it sends the token to the local backend over the configured development connection.


### Cyber Assistant
The Cyber Assistant uses a local guided knowledge base for cybersecurity questions and can redirect you to app pages (Email Scanner, Website Tracker, and so on).

Open **Cyber Assistant** in the sidebar (`/cyber-assistant`). Try questions like “Where is the Email Scanner?” or “How do I spot phishing?” — answers include clickable links to the right CyberGuard page.

### CyberTech News

Open **News** (`/news`) to search and filter BleepingComputer articles, read summaries, and open full stories. The backend updates the feed every five minutes while running; no news API key is needed. Recent news covers available articles from the past seven days, while Saved includes any date. The feed may cover less than a full week.

Sign in to save articles and track what you’ve read. Your saved articles and read status are private to your account.

## Troubleshooting

- **`Backend virtualenv not found`**: the virtual environment hasn't been created on this computer yet. Run the one-time setup above. A `.venv` copied from another OS won't work; create a fresh one on each machine.
- **`ModuleNotFoundError` when starting the backend**: the backend packages aren't installed in the virtual environment. Rerun the `pip install` step from the one-time setup.
- **Frontend shows a network or CORS error**: make sure the backend is running on port 8000 and `FRONTEND_ORIGIN` matches the URL in your browser.
- **Google says `redirect_uri_mismatch`**: the redirect URI in Google Cloud must match `GOOGLE_REDIRECT_URI` exactly.
- **Google says the app isn't verified or access is blocked**: add your account as a test user.
- **Port already in use**: stop the other process, or use a different `--port` and update `GOOGLE_REDIRECT_URI` / `VITE_API_BASE_URL` to match.
