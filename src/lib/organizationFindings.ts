export type ScanEvidence = {
  source?: string;
  verdict?: string;
  score?: number;
  reasons?: string[];
};
export type OrganizationFinding = {
  id: string;
  organization_id: string;
  reporter_id: string;
  title: string;
  kind: string;
  details: string;
  status: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  purpose?: "finding" | "unblock_request";
  domain?: string | null;
  scan_evidence?: ScanEvidence;
  response_action?:
    | "none"
    | "blocked"
    | "warned"
    | "unblocked"
    | "kept_blocked"
    | "temporary_access";
  access_expires_at?: string | null;
  action_domain?: string | null;
  action_revision?: number | null;
};
export function normalizeFindingDomain(input: string): string {
  const value = input.trim();
  if (!value || /\s/.test(value))
    throw new Error("Enter a website domain or HTTP/HTTPS URL.");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    host.length > 253 ||
    !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(
      host,
    ) ||
    host.endsWith(".localhost")
  )
    throw new Error(
      "Use a public website domain. Email addresses and IP addresses are not supported.",
    );
  return host;
}
