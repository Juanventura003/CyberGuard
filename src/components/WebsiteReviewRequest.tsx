import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { normalizeFindingDomain } from "../lib/organizationFindings";
export default function WebsiteReviewRequest({
  organizationId,
  organizationName,
  domain,
  onSubmitted,
  onCancel,
}: {
  organizationId: string;
  organizationName: string;
  domain: string;
  onSubmitted: (id: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const host = normalizeFindingDomain(domain);
      const { data, error } = await supabase!.rpc("cg_request_rule_review", {
        org: organizationId,
        host,
        reason: reason.trim(),
      });
      if (error) throw new Error(error.message);
      onSubmitted(data as string);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not request a review.",
      );
      setBusy(false);
    }
  }
  return (
    <section className="org-card finding-review-request">
      <h2>Request a website review</h2>
      <p>
        <strong>{domain}</strong> · {organizationName}
      </p>
      <form onSubmit={submit}>
        <label>
          Why should your admin review this restriction?
          <textarea
            required
            minLength={3}
            maxLength={5000}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            placeholder="For example: I need this website for a class assignment."
          />
        </label>
        <p className="org-consent-summary">
          Only this rule domain and your explanation will be shared with your
          admins. Sending this request does not unblock the website. Your admin
          can keep the restriction, remove the rule for everyone, or approve
          temporary access to a blocked website just for you.
        </p>
        {error && (
          <p className="org-error" role="alert">
            {error}
          </p>
        )}
        <div className="finding-actions">
          <button
            className="org-primary"
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? "Sending…" : "Send review request"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
