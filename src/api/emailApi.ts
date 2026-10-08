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

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* response wasn't JSON, fall back to statusText */
    }
    throw new Error(detail);
  }
  return res.json();
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

export function listWebsiteHistory(limit = 20, accessToken?: string, since?: string): Promise<WebsiteHistoryEntry[]> {
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