import { useState, type FormEvent } from "react";
import { Shield } from "lucide-react";
import HelpTip from "./HelpTip";
import { supabase } from "../lib/supabase";
import {
  normalizeFindingDomain,
  type OrganizationFinding,
} from "../lib/organizationFindings";

type Props = {
  finding: OrganizationFinding;
  organizationName: string;
  onSaved: (message: string) => void;
};
export default function FindingResponse({
  finding,
  organizationName,
  onSaved,
}: Props) {
  const request = finding.purpose === "unblock_request";
  const [version, setVersion] = useState(finding.updated_at);
  const stale = version !== finding.updated_at;
  const [decision, setDecision] = useState("guidance");
  const [domain, setDomain] = useState(finding.domain ?? "");
  const [note, setNote] = useState(finding.admin_note);
  const [status, setStatus] = useState(
    finding.status === "new" ? "under_review" : finding.status,
  );
  const [preview, setPreview] = useState<{
    host: string;
    decision: string;
    note: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestions = [
    ...new Set(
      (finding.details.match(/https?:\/\/[^\s<>"']+/gi) ?? []).flatMap(
        (value) => {
          try {
            return [normalizeFindingDomain(value.replace(/[),.;!?]+$/, ""))];
          } catch {
            return [];
          }
        },
      ),
    ),
  ].slice(0, 6);
  async function save() {
    if (busy || stale) return;
    setBusy(true);
    setError("");
    try {
      const { error } = preview
        ? await supabase!.rpc("cg_act_on_incident", {
            incident: finding.id,
            decision: preview.decision,
            host: preview.host,
            note: preview.note,
            expected_updated_at: version,
          })
        : await supabase!.rpc("cg_review_incident", {
            incident: finding.id,
            next_status: status,
            note: note.trim(),
            expected_updated_at: version,
          });
      if (error) throw new Error(error.message);
      onSaved(
        preview
          ? "Decision saved. Website protection and the member’s response were updated together."
          : "Response shared with the member.",
      );
      setPreview(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save response.",
      );
    } finally {
      setBusy(false);
    }
  }
  function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (stale) return;
    if (decision === "guidance") {
      void save();
      return;
    }
    try {
      setPreview({
        host: normalizeFindingDomain(request ? (finding.domain ?? "") : domain),
        decision,
        note: note.trim(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Check the website domain.",
      );
    }
  }
  return (
    <section className="finding-response">
      <h3>
        <Shield size={18} />
        Respond & protect
        <HelpTip label="responding to findings">
          Review the evidence before acting. Scanner results are shared by the
          reporter and are not an independent verification. Website actions
          update the rule and the report in one transaction.
        </HelpTip>
      </h3>
      {stale && (
        <p className="org-notice" role="status">
          This finding was updated. Load the latest response before making
          another change.
          <button
            onClick={() => {
              setVersion(finding.updated_at);
              setNote(finding.admin_note);
              setStatus(
                finding.status === "new" ? "under_review" : finding.status,
              );
              setPreview(null);
              setError("");
            }}
          >
            Load latest response
          </button>
        </p>
      )}
      {preview ? (
        <div className="finding-action-preview">
          <strong>
            {preview.decision === "block"
              ? "Block"
              : preview.decision === "unblock"
                ? "Remove the block for"
                : "Keep blocking"}{" "}
            {preview.host}
          </strong>
          <p>
            {preview.decision === "keep_block"
              ? "The existing website rule stays in place."
              : `This changes the website rule for all extensions connected to ${organizationName}. Subdomains are included. Extensions apply changes on their next successful sync.`}
          </p>
          <p>{preview.note}</p>
          {preview.decision === "unblock" && (
            <p>Other shared or personal blocks may still prevent access.</p>
          )}
          <div className="finding-actions">
            <button
              className="org-primary"
              disabled={busy || stale}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Confirm decision"}
            </button>
            <button disabled={busy || stale} onClick={() => setPreview(null)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={review}>
          <label>
            Action
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              disabled={busy || stale}
            >
              <option value="guidance">Send guidance / update review</option>
              {request ? (
                <>
                  <option value="unblock">
                    Approve request — remove website block
                  </option>
                  <option value="keep_block">
                    Decline request — keep website blocked
                  </option>
                </>
              ) : (
                <option value="block">Block website for the team</option>
              )}
            </select>
          </label>
          {decision === "block" && (
            <>
              <label>
                Website domain
                <input
                  required
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  maxLength={2048}
                  placeholder="example.com"
                  disabled={busy || stale}
                />
              </label>
              {suggestions.length > 0 && (
                <div className="finding-actions">
                  {suggestions.map((host) => (
                    <button
                      type="button"
                      key={host}
                      onClick={() => setDomain(host)}
                    >
                      {host}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {decision === "guidance" && (
            <label>
              Review status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={busy || stale}
              >
                {["under_review", "confirmed", "dismissed", "resolved"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          <label>
            Guidance for the member
            <textarea
              required
              minLength={1}
              maxLength={decision === "guidance" ? 5000 : 800}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy || stale}
              placeholder="Explain your decision and what the member should do next."
            />
          </label>
          {decision !== "guidance" && note.length > 800 && (
            <p className="org-help">
              Shorten your website-action guidance to 800 characters. The
              existing response stays saved until you confirm a replacement.
            </p>
          )}
          <button
            className="org-primary"
            disabled={
              busy ||
              stale ||
              !note.trim() ||
              note.length > (decision === "guidance" ? 5000 : 800)
            }
          >
            {busy
              ? "Saving…"
              : decision === "guidance"
                ? "Share response"
                : "Review website action"}
          </button>
        </form>
      )}
      {error && (
        <p className="org-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
