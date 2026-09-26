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

export function analyzeManualEmails(emails: ManualEmailInput[]): Promise<EmailResult[]> {
  return fetch(`${API_BASE}/api/email/batch-analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails }),
  }).then((r) => asJson<EmailResult[]>(r));
}