export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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
  unread?: boolean;
}

/** One row of a result's sender/link checks. */
export interface EmailCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
}

/** A risky link found in an email: what it shows vs. where it really goes. */
export interface EmailLinkReport {
  url: string;
  host: string;
  text: string;
  displayed_host: string | null;
  mismatch: boolean;
  verdict: "dangerous" | "suspicious" | "ok";
  threats: string[];
  reasons: string[];
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
  checks?: EmailCheck[];
  links?: EmailLinkReport[];
  /** Words in the email that point to phishing, for highlighting in the preview. */
  highlights?: string[];
  preview?: string | null;
}

export interface WebsiteHistoryEntry {
  id: string;
  url: string;
  domain: string;
  risk_score: number;
  risk_level:
    | "HIGH_RISK"
    | "SUSPICIOUS"
    | "NO_KNOWN_THREAT"
    | "UNABLE_TO_VERIFY";
  source: "GOOGLE_WEB_RISK" | "LAYERED_ANALYSIS" | "UNABLE_TO_VERIFY";
  threat_types: string[];
  explanation: string[];
  visited_at: string;
  updated_at?: string | null;
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
    localStorage.setItem(
      GMAIL_SESSION_KEY,
      JSON.stringify({ sessionId, expiresAt }),
    );
  } catch {
    /* storage blocked (private mode etc.): the session just won't be remembered */
  }
}

export function loadGmailSession(): string | null {
  try {
    const raw = localStorage.getItem(GMAIL_SESSION_KEY);
    if (!raw) return null;
    const { sessionId, expiresAt } = JSON.parse(raw) as {
      sessionId?: string;
      expiresAt?: number;
    };
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

export function listGmailMessages(
  session: string,
  limit = 50,
): Promise<GmailHeaderItem[]> {
  return fetch(
    `${API_BASE}/api/email/gmail/list?${new URLSearchParams({ session, limit: String(limit) })}`,
  ).then((r) => asJson<GmailHeaderItem[]>(r));
}

export interface GmailSearchPage {
  items: GmailHeaderItem[];
  next_page_token: string | null;
}

/** One page of inbox messages matching a Gmail search ("from:paypal",
 * "invoice", …). Pass the previous page's next_page_token to load more. */
export function searchGmailMessages(
  session: string,
  options: { query?: string; unreadOnly?: boolean; pageToken?: string | null; limit?: number } = {},
): Promise<GmailSearchPage> {
  const params = new URLSearchParams({ session, limit: String(options.limit ?? 50) });
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.unreadOnly) params.set("unread", "true");
  if (options.pageToken) params.set("page_token", options.pageToken);
  return fetch(`${API_BASE}/api/email/gmail/search?${params}`).then((r) =>
    asJson<GmailSearchPage>(r),
  );
}

/** JSON headers, plus the CyberGuard login token when signed in so the
 * backend can create Security Alerts for the scan's risky findings. */
function scanHeaders(accessToken?: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export function analyzeGmailMessages(
  session: string,
  messageIds: string[],
  accessToken?: string | null,
): Promise<EmailResult[]> {
  return fetch(`${API_BASE}/api/email/gmail/analyze`, {
    method: "POST",
    headers: scanHeaders(accessToken),
    body: JSON.stringify({ session, message_ids: messageIds }),
  }).then((r) => asJson<EmailResult[]>(r));
}

export interface GmailTrashResponse {
  trashed: string[];
  failed: { id: string; error: string }[];
}

/** Moves messages to Gmail's Trash (recoverable there for 30 days). */
export function trashGmailMessages(
  session: string,
  messageIds: string[],
): Promise<GmailTrashResponse> {
  return fetch(`${API_BASE}/api/email/gmail/trash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, message_ids: messageIds }),
  }).then((r) => asJson<GmailTrashResponse>(r));
}

export interface GmailSpamResponse {
  moved: string[];
  failed: { id: string; error: string }[];
}

/** Moves messages to Gmail's Spam folder, which also teaches Gmail's own filter. */
export function spamGmailMessages(
  session: string,
  messageIds: string[],
): Promise<GmailSpamResponse> {
  return fetch(`${API_BASE}/api/email/gmail/spam`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, message_ids: messageIds }),
  }).then((r) => asJson<GmailSpamResponse>(r));
}

export function analyzeManualEmails(
  emails: ManualEmailInput[],
  accessToken?: string | null,
): Promise<EmailResult[]> {
  return fetch(`${API_BASE}/api/email/batch-analyze`, {
    method: "POST",
    headers: scanHeaders(accessToken),
    body: JSON.stringify({ emails }),
  }).then((r) => asJson<EmailResult[]>(r));
}

export function listWebsiteHistory(
  limit = 1000,
  accessToken?: string,
  since?: string,
): Promise<WebsiteHistoryEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (since) params.set("since", since);
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : undefined;
  return fetch(`${API_BASE}/api/websites/history?${params}`, { headers }).then(
    (r) => asJson<WebsiteHistoryEntry[]>(r),
  );
}

export async function syncWebsiteHistory(
  known: Record<string, string>,
  accessToken?: string,
  since?: string,
): Promise<{ entries: WebsiteHistoryEntry[]; ids: string[] }> {
  const response = await fetch(`${API_BASE}/api/websites/history/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ known, since, limit: 1000 }),
  });
  return asJson<{ entries: WebsiteHistoryEntry[]; ids: string[] }>(response);
}

export function deleteWebsiteHistory(
  historyId: string,
  accessToken: string,
  url?: string,
): Promise<void> {
  const query = url ? `?url=${encodeURIComponent(url)}` : "";
  return fetch(
    `${API_BASE}/api/websites/history/${encodeURIComponent(historyId)}${query}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  ).then(async (r) => {
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
