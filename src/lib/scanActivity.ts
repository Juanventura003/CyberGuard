/** Client-side history for email scans and security checks (per signed-in user). */

export type ScanFinding = "safe" | "suspicious" | "high" | "unverified";

export type EmailScanEntry = {
  id: string;
  kind: "email";
  title: string;
  detail: string;
  finding: ScanFinding;
  occurredAt: string;
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
  }));

  store.emails = trim([...entries, ...store.emails]);
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
