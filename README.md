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

Access is read-only (`gmail.readonly`). CyberGuard cannot send, delete or modify mail.

### Reading the results
- **Risk score** (0–100): higher means more likely phishing.
- **Classification**: `SAFE` or `PHISHING`.
- **Explanation**: the indicators found, such as urgency language or requests for credentials.

## Running it on a new device

### Prerequisites
- [Node.js](https://nodejs.org) 18 or newer (includes npm)
- [Python](https://www.python.org/downloads/) 3.10 or newer
- Git

### 1. Start the backend
Open a terminal in the project root (the `CyberGuard` folder).

**Windows (PowerShell):**
```powershell
cd src\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**macOS / Linux:**
```bash
cd src/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it works: open http://localhost:8000/api/health. You should see `{"status":"healthy"}`. Interactive API docs are at http://localhost:8000/docs.

### 2. Start the frontend
Open a **second** terminal in the project root:
```bash
npm install
npm run dev
```
Then open http://localhost:5173.

Both servers must be running at the same time. Stop them with `Ctrl+C`.

## Configuration

Backend settings are read from environment variables or from `src/backend/.env`. Put your Google credentials in `src/backend/.env`. `.env` is git-ignored, so your secret stays local.

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | *(empty)* | Google OAuth client ID (Gmail mode) |
| `GOOGLE_CLIENT_SECRET` | *(empty)* | Google OAuth client secret (Gmail mode) |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/email/oauth/callback` | Must exactly match a redirect URI registered in Google Cloud |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed frontend origin (CORS and OAuth return check) |
| `SESSION_TTL_MINUTES` | `30` | How long a Gmail session lasts |

To point the frontend at a backend on a different address, set `VITE_API_BASE_URL` (default `http://localhost:8000`) in a `.env` file in the project root.

## Troubleshooting

- **`ModuleNotFoundError` when starting the backend**: the virtual environment isn't activated, or `pip install -r requirements.txt` wasn't run.
- **PowerShell won't activate the venv**: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **Frontend shows a network or CORS error**: make sure the backend is running on port 8000 and `FRONTEND_ORIGIN` matches the URL in your browser.
- **Google says `redirect_uri_mismatch`**: the redirect URI in Google Cloud must match `GOOGLE_REDIRECT_URI` exactly.
- **Google says the app isn't verified or access is blocked**: add your account as a test user.
- **Port already in use**: stop the other process, or use a different `--port` and update `GOOGLE_REDIRECT_URI` / `VITE_API_BASE_URL` to match.
