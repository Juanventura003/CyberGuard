export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export interface ManualEmailInput {
  sender: string;
  subject: string;
  body: string;
  urls: string[];
}

export interface GmailHeaderItem {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailResult {
  source: "manual" | "gmail";
  id: string | null;
  sender: string;
  subject: string;
  risk_score: number;
  classification: "SAFE" | "SUSPICIOUS" | "PHISHING" | "ERROR";
  confidence: number;
  explanation: string[];
  error?: string | null;
}

export interface WebsiteHistoryEntry {
  id: string;
  url: string;
  domain: string;
  risk_score: number;
  risk_level: "HIGH_RISK" | "SUSPICIOUS" | "NO_KNOWN_THREAT" | "UNABLE_TO_VERIFY";
  source: "GOOGLE_WEB_RISK" | "UNABLE_TO_VERIFY";
  threat_types: string[];
  explanation: string[];
  visited_at: string;
}

/** An error from the backend that keeps the HTTP status, so callers can tell
 * an expired Gmail session (401) apart from other failures. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* response wasn't JSON, fall back to statusText */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

// ---- Remembering the Gmail session between visits ----
// The backend keeps a Gmail session for SESSION_TTL_MINUTES (30 by default).
// Saving its id here lets the user leave the Email Scanner and come back
// without signing in to Google again until it expires.

const GMAIL_SESSION_KEY = "cyberguard.gmailSession";
const GMAIL_SESSION_MINUTES = 30;

export function saveGmailSession(sessionId: string) {
  try {
    const expiresAt = Date.now() + GMAIL_SESSION_MINUTES * 60 * 1000;
    localStorage.setItem(GMAIL_SESSION_KEY, JSON.stringify({ sessionId, expiresAt }));
  } catch {
    /* storage blocked (private mode etc.): the session just won't be remembered */
  }
}

export function loadGmailSession(): string | null {
  try {
    const raw = localStorage.getItem(GMAIL_SESSION_KEY);
    if (!raw) return null;
    const { sessionId, expiresAt } = JSON.parse(raw) as { sessionId?: string; expiresAt?: number };
    if (!sessionId || !expiresAt || Date.now() >= expiresAt) {
      localStorage.removeItem(GMAIL_SESSION_KEY);
      return null;
    }
    return sessionId;
  } catch {
    return null;
  }
}

export function clearGmailSession() {
  try {
    localStorage.removeItem(GMAIL_SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Full-page redirect to Google's consent screen.
 * straight back to `returnTo` with a `gmail_session` query param attached. */
export function startGmailConnect(returnTo: string) {
  const url = `${API_BASE}/api/email/oauth/login?${new URLSearchParams({ return_to: returnTo })}`;
  window.location.href = url;
}

export function listGmailMessages(session: string, limit = 50): Promise<GmailHeaderItem[]> {
  return fetch(`${API_BASE}/api/email/gmail/list?${new URLSearchParams({ session, limit: String(limit) })}`)
    .then((r) => asJson<GmailHeaderItem[]>(r));
}

export function analyzeGmailMessages(session: string, messageIds: string[]): Promise<EmailResult[]> {
  return fetch(`${API_BASE}/api/email/gmail/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, message_ids: messageIds }),
  }).then((r) => asJson<EmailResult[]>(r));
}

export interface GmailTrashResponse {
  trashed: string[];
  failed: { id: string; error: string }[];
}

/** Moves messages to Gmail's Trash (recoverable there for 30 days). */
export function trashGmailMessages(session: string, messageIds: string[]): Promise<GmailTrashResponse> {
  return fetch(`${API_BASE}/api/email/gmail/trash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, message_ids: messageIds }),
  }).then((r) => asJson<GmailTrashResponse>(r));
}


export function analyzeManualEmails(emails: ManualEmailInput[]): Promise<EmailResult[]> {
  return fetch(`${API_BASE}/api/email/batch-analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails }),
  }).then((r) => asJson<EmailResult[]>(r));
}

export function listWebsiteHistory(limit = 1000, accessToken?: string, since?: string): Promise<WebsiteHistoryEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (since) params.set("since", since);
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  return fetch(`${API_BASE}/api/websites/history?${params}`, { headers })
    .then((r) => asJson<WebsiteHistoryEntry[]>(r));
}

export function deleteWebsiteHistory(historyId: string, accessToken: string, url?: string): Promise<void> {
  const query = url ? `?url=${encodeURIComponent(url)}` : "";
  return fetch(`${API_BASE}/api/websites/history/${encodeURIComponent(historyId)}${query}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then(async (r) => {
    if (!r.ok) {
      await asJson<void>(r);
    }
  });
}

export function deleteAllWebsiteHistory(accessToken: string): Promise<void> {
  return fetch(`${API_BASE}/api/websites/history`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then(async (r) => {
    if (!r.ok) {
      await asJson<void>(r);
    }
  });
}