/**
 * History for email scans and security checks (per signed-in user).
 *
 * Email scans are also saved to Supabase (public.email_scans) so they follow
 * the account across devices; localStorage is kept as a fast copy that
 * syncEmailScans() refreshes. Security checks stay in this browser only.
 */
import { supabase } from "./supabase";

export type ScanFinding = "safe" | "suspicious" | "high" | "unverified";

export type EmailScanEntry = {
  id: string;
  kind: "email";
  title: string;
  detail: string;
  finding: ScanFinding;
  occurredAt: string;
  /** Gmail message id, so the inbox can show which emails were already scanned. */
  messageId?: string;
  /** Saved in Supabase. Entries without this or `pending` are from before
   * history moved to Supabase and stay in this browser only. */
  synced?: boolean;
  /** Not saved to Supabase yet: what the email_scans row needs. Retried by
   * syncEmailScans() if the first save fails (offline, signed out, …). */
  pending?: PendingEmailScan;
};

type PendingEmailScan = {
  sender: string;
  subject: string;
  classification: string;
  riskScore: number;
  confidence: number | null;
  source: string;
};

export type SecurityScanEntry = {
  id: string;
  kind: "security";
  checkType: "password" | "phone" | "file" | "email_address";
  title: string;
  detail: string;
  finding: ScanFinding;
  occurredAt: string;
};

export type ScanActivityEntry = EmailScanEntry | SecurityScanEntry;

type ActivityStore = {
  emails: EmailScanEntry[];
  security: SecurityScanEntry[];
};

const MAX_ENTRIES = 200;
const EMAIL_SCANS_TABLE = "email_scans";
export const SCAN_ACTIVITY_EVENT = "cyberguard-scan-activity";

function storageKey(userId: string) {
  return `cyberguard.scanActivity.${userId}`;
}

function emptyStore(): ActivityStore {
  return { emails: [], security: [] };
}

function readStore(userId: string): ActivityStore {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ActivityStore>;
    return {
      emails: Array.isArray(parsed.emails) ? parsed.emails : [],
      security: Array.isArray(parsed.security) ? parsed.security : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(userId: string, store: ActivityStore) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(SCAN_ACTIVITY_EVENT));
  } catch {
    /* private mode / quota */
  }
}

function trim<T>(items: T[]): T[] {
  return items.slice(0, MAX_ENTRIES);
}

export function listEmailScans(userId: string): EmailScanEntry[] {
  return readStore(userId).emails;
}

export function listSecurityScans(userId: string): SecurityScanEntry[] {
  return readStore(userId).security;
}

export function listScanActivity(userId: string): ScanActivityEntry[] {
  const store = readStore(userId);
  return [...store.emails, ...store.security].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
}

export function emailFindingFromClassification(
  classification: string,
): ScanFinding {
  if (classification === "PHISHING") return "high";
  if (classification === "SUSPICIOUS") return "suspicious";
  if (classification === "SAFE") return "safe";
  return "unverified";
}

export function fileFindingFromClassification(
  classification: string,
): ScanFinding {
  if (classification === "HIGH RISK") return "high";
  if (classification === "SUSPICIOUS") return "suspicious";
  if (classification === "SAFE") return "safe";
  return "unverified";
}

/** zxcvbn score 0–4 → dashboard finding. */
export function passwordFindingFromScore(score: number): ScanFinding {
  if (score <= 1) return "high";
  if (score === 2) return "suspicious";
  return "safe";
}

export function phoneReputationFinding(input: {
  fraud_score: number | null;
  spammer: boolean | null;
  recent_abuse: boolean | null;
  risky: boolean | null;
}): ScanFinding {
  const score = input.fraud_score;
  if (
    input.spammer === true ||
    input.risky === true ||
    (typeof score === "number" && score >= 75)
  ) {
    return "high";
  }
  if (
    input.recent_abuse === true ||
    (typeof score === "number" && score >= 40)
  ) {
    return "suspicious";
  }
  if (score === null && input.spammer === null && input.risky === null) {
    return "unverified";
  }
  return "safe";
}

export function emailAddressFinding(input: {
  valid_format: boolean;
  domain_exists: boolean | null;
  has_mx_records: boolean | null;
  disposable: boolean | null;
}): ScanFinding {
  if (!input.valid_format) return "high";
  if (input.disposable === true) return "suspicious";
  if (input.domain_exists === false || input.has_mx_records === false) {
    return "suspicious";
  }
  return "safe";
}

export function emailReputationFinding(
  riskLevel: "Low" | "Medium" | "High" | "Unknown",
): ScanFinding {
  if (riskLevel === "High") return "high";
  if (riskLevel === "Medium") return "suspicious";
  if (riskLevel === "Low") return "safe";
  return "unverified";
}

export function recordEmailScans(
  userId: string | undefined,
  results: {
    subject: string;
    sender: string;
    classification: string;
    messageId?: string | null;
    /** Needed to save the scan to Supabase; without it the scan stays local. */
    riskScore?: number;
    confidence?: number | null;
    source?: string;
  }[],
) {
  if (!userId || results.length === 0) return;

  const store = readStore(userId);
  const now = new Date().toISOString();
  const entries: EmailScanEntry[] = results.map((result) => ({
    id: crypto.randomUUID(),
    kind: "email",
    title: result.subject.trim() || "(No subject)",
    detail: result.sender.trim() || "Unknown sender",
    finding: emailFindingFromClassification(result.classification),
    occurredAt: now,
    ...(result.messageId ? { messageId: result.messageId } : {}),
    ...(typeof result.riskScore === "number"
      ? {
          pending: {
            sender: result.sender,
            subject: result.subject,
            classification: result.classification,
            riskScore: result.riskScore,
            confidence: result.confidence ?? null,
            source: result.source ?? (result.messageId ? "gmail" : "manual"),
          },
        }
      : {}),
  }));

  store.emails = trim([...entries, ...store.emails]);
  writeStore(userId, store);
  void uploadPendingEmailScans(userId);
}

/** True when Supabase is signed in as this user. History is per account, so
 * nothing is saved or loaded while a different account is signed in (e.g.
 * someone signed out and another account signed in mid-save). */
async function signedInAs(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === userId;
}

/** Saves scans that aren't in Supabase yet. Safe to call repeatedly: rows are
 * keyed by the entry id, so a retry never creates duplicates. */
async function uploadPendingEmailScans(userId: string): Promise<void> {
  if (!supabase || !(await signedInAs(userId))) return;
  const pending = readStore(userId).emails.filter((e) => e.pending);
  if (pending.length === 0) return;

  const rows = pending.map((e) => ({
    id: e.id,
    // Stated explicitly (not left to the table default) so Supabase's
    // "own scans" policy rejects the row if a different account is signed in.
    user_id: userId,
    sender: e.pending!.sender.trim() || "Unknown sender",
    subject: e.pending!.subject.trim() || null,
    classification: e.pending!.classification,
    // risk_score is an integer column; scores like 54.2 would be rejected.
    risk_score: Math.round(e.pending!.riskScore),
    confidence: e.pending!.confidence,
    source: e.pending!.source,
    gmail_message_id: e.messageId ?? null,
    scanned_at: e.occurredAt,
  }));

  const { error } = await supabase
    .from(EMAIL_SCANS_TABLE)
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) {
    console.warn("CyberGuard: couldn't save email scan history; will retry.", error.message);
    return;
  }

  // Re-read: more scans may have been added while this was saving.
  const saved = new Set(pending.map((e) => e.id));
  const store = readStore(userId);
  store.emails = store.emails.map((e) => {
    if (!saved.has(e.id)) return e;
    const savedEntry: EmailScanEntry = { ...e, synced: true };
    delete savedEntry.pending;
    return savedEntry;
  });
  writeStore(userId, store);
}

type EmailScanRow = {
  id: string;
  sender: string | null;
  subject: string | null;
  classification: string;
  gmail_message_id: string | null;
  scanned_at: string;
};

/**
 * Brings this browser's email history up to date with Supabase: saves any
 * scans still waiting, then loads the newest ones saved from any device.
 * Call it when a page that shows email history opens. On failure the local
 * copy is left as it was.
 */
export async function syncEmailScans(userId: string): Promise<void> {
  if (!supabase || !(await signedInAs(userId))) return;
  await uploadPendingEmailScans(userId);

  const { data, error } = await supabase
    .from(EMAIL_SCANS_TABLE)
    .select("id, sender, subject, classification, gmail_message_id, scanned_at")
    .eq("user_id", userId)
    .order("scanned_at", { ascending: false })
    .limit(MAX_ENTRIES);
  // The account changed while loading: don't put its rows in this user's history.
  if (error || !data || !(await signedInAs(userId))) return;

  const fromServer: EmailScanEntry[] = (data as EmailScanRow[]).map((row) => ({
    id: row.id,
    kind: "email",
    title: row.subject?.trim() || "(No subject)",
    detail: row.sender?.trim() || "Unknown sender",
    finding: emailFindingFromClassification(row.classification),
    occurredAt: row.scanned_at,
    synced: true,
    ...(row.gmail_message_id ? { messageId: row.gmail_message_id } : {}),
  }));

  // Keep scans that only exist here: ones still waiting to be saved, and
  // older ones from before history was saved to Supabase.
  const serverIds = new Set(fromServer.map((e) => e.id));
  const store = readStore(userId);
  const localOnly = store.emails.filter((e) => !e.synced && !serverIds.has(e.id));

  store.emails = trim(
    [...fromServer, ...localOnly].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    ),
  );
  writeStore(userId, store);
}

export function recordSecurityScan(
  userId: string | undefined,
  entry: Omit<SecurityScanEntry, "id" | "kind" | "occurredAt"> & {
    occurredAt?: string;
  },
) {
  if (!userId) return;

  const store = readStore(userId);
  store.security = trim([
    {
      id: crypto.randomUUID(),
      kind: "security",
      checkType: entry.checkType,
      title: entry.title,
      detail: entry.detail,
      finding: entry.finding,
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
    },
    ...store.security,
  ]);
  writeStore(userId, store);
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}•••@${domain}`;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `••${digits.slice(-4)}`;
}

export function findingLabel(finding: ScanFinding) {
  if (finding === "high") return "High Risk";
  if (finding === "suspicious") return "Suspicious";
  if (finding === "unverified") return "Unverified";
  return "Safe";
}

export function isThreatFinding(finding: ScanFinding) {
  return finding === "high" || finding === "suspicious";
}

export function startOfTodayMs() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function isTodayIso(iso: string) {
  const value = Date.parse(iso);
  return Number.isFinite(value) && value >= startOfTodayMs();
}
