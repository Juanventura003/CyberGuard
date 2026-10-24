import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import HelpTip from "./HelpTip";
import { supabase } from "../lib/supabase";
import type { OrganizationFinding } from "../lib/organizationFindings";
type Snapshot = {
  domain: string | null;
  blocked: boolean;
  revision: number;
  total: number;
  received: number;
  action?: "warn" | "block" | null;
  access_expires_at?: string | null;
};
export default function FindingProtection({
  finding,
  refreshRevision,
}: {
  finding: OrganizationFinding;
  refreshRevision: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase!.rpc("cg_incident_protection", {
          incident: finding.id,
        });
        if (error) throw error;
        if (active) {
          setSnapshot(data as Snapshot);
          setError("");
        }
      } catch {
        if (active) {
          setSnapshot(null);
          setError("Could not refresh team protection. Please retry.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [finding.id, finding.updated_at, reload, refreshRevision]);
  const response =
    finding.response_action === "blocked"
      ? "Admin published a website block"
      : finding.response_action === "warned"
        ? "Admin published a website warning"
        : finding.response_action === "temporary_access"
          ? "Admin granted temporary access to the requesting member"
          : finding.response_action === "unblocked"
            ? "Admin removed the website rule"
            : finding.response_action === "kept_blocked"
              ? "Admin kept the website restriction"
              : "No website action recorded";
  return (
    <section className="finding-protection">
      <h3>
        <ShieldCheck size={18} />
        Team protection
        <HelpTip label="rule delivery">
          Counts show active extension connections with recent check-ins that
          acknowledged the current organization rules. They do not show who
          visited a website or prove that a whole device is secure. The view
          refreshes every 15 seconds. Offline extensions keep cached rules until
          a successful sync.
        </HelpTip>
      </h3>
      <p>{response}</p>
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </p>
      ) : !snapshot ? (
        <p role="status">Checking protection…</p>
      ) : (
        <>
          {snapshot.domain && (
            <p>
              <strong>{snapshot.domain}</strong>
              <span
                className={`org-protection-badge ${snapshot.blocked ? "healthy" : "neutral"}`}
              >
                {snapshot.blocked
                  ? "Currently blocked by team rules"
                  : snapshot.action === "warn"
                    ? "Team warning · Continue with caution"
                    : "No current team rule"}
              </span>
            </p>
          )}
          {finding.response_action === "temporary_access" && (
            <p>
              {snapshot.access_expires_at
                ? `Current approval expires ${new Date(snapshot.access_expires_at).toLocaleString()}. Sync the member’s extension to receive it.`
                : `This approval has expired, was revoked, or its rule changed.${finding.access_expires_at ? ` Original expiry: ${new Date(finding.access_expires_at).toLocaleString()}.` : ""}`}{" "}
              Other members remain restricted. Personal blocks and other
              matching rules still apply.
            </p>
          )}
          {finding.response_action && finding.response_action !== "none" && (
            <>
              <strong className="finding-delivery-count">
                {snapshot.received} / {snapshot.total}
              </strong>
              <p>
                {snapshot.total
                  ? "Extension connections recently confirmed the current rules."
                  : "No active extension connections yet."}
              </p>
              {snapshot.total > snapshot.received && (
                <small>
                  {snapshot.total - snapshot.received} awaiting a current
                  confirmation.
                </small>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
