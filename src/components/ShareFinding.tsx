import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ScanEvidence } from "../lib/organizationFindings";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import "./ShareFinding.css";
import { collectOrganizationPages } from "../lib/organizationData";

type OrganizationChoice = { id: string; name: string };

type Finding = {
  title: string;
  kind: "email" | "link";
  details: string;
  domain?: string;
  scanner: ScanEvidence;
};
export default function ShareFinding({
  finding,
  initialOpen = false,
}: {
  finding: Finding;
  initialOpen?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading || !supabase) return null;
  if (!user)
    return (
      <p className="finding-share-hint">
        Sign in to share this finding with your team.
      </p>
    );
  return (
    <ReportForm
      key={`${user.id}:${JSON.stringify(finding)}`}
      userId={user.id}
      finding={finding}
      initialOpen={initialOpen}
    />
  );
}

function ReportForm({
  userId,
  finding,
  initialOpen,
}: {
  userId: string;
  finding: Finding;
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [choices, setChoices] = useState<OrganizationChoice[]>([]);
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sharedWith, setSharedWith] = useState("");
  const [sharedId, setSharedId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const details = `${finding.details}${note.trim() ? `\n\nReporter note:\n${note.trim()}` : ""}`;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const client = supabase!;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const memberships = await collectOrganizationPages<{
          organization_id: string;
        }>((from, to) =>
          client
            .from("cg_memberships")
            .select("organization_id", { count: "exact" })
            .eq("user_id", userId)
            .order("organization_id")
            .range(from, to),
        );
        const ids = new Set(memberships.map((item) => item.organization_id));
        const visibleOrganizations =
          await collectOrganizationPages<OrganizationChoice>((from, to) =>
            client
              .from("cg_organizations")
              .select("id,name", { count: "exact" })
              .is("archived_at", null)
              .order("id")
              .range(from, to),
          );
        const organizations = visibleOrganizations
          .filter((item) => ids.has(item.id))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (active) {
          setChoices(organizations);
          setOrganization((previous) =>
            organizations.some((item) => item.id === previous)
              ? previous
              : (organizations[0]?.id ?? ""),
          );
        }
      } catch (cause) {
        if (active) {
          setChoices([]);
          setOrganization("");
          setError(
            cause instanceof Error
              ? cause.message
              : ((cause as { message?: string }).message ??
                  "Could not load organizations."),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, userId, attempt]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !organization || loading || details.length > 10000) return;
    setBusy(true);
    setError("");
    try {
      const { data: findingId, error: failure } = await supabase!.rpc(
        "cg_submit_finding",
        {
          org: organization,
          finding_title: finding.title.slice(0, 150).padEnd(3, "."),
          content_kind: finding.kind,
          evidence_text: details,
          website: finding.domain ?? null,
          scanner: finding.scanner,
        },
      );
      if (failure) throw failure;
      setSharedId(findingId as string);
      setSharedWith(
        choices.find((item) => item.id === organization)?.name ??
          "your organization",
      );
    } catch (cause) {
      setError(
        (cause as { message?: string }).message ??
          "Could not submit report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (sharedWith)
    return (
      <div className="finding-share-success" role="status">
        Shared with {sharedWith}.{" "}
        <Link
          to={`/organization?org=${encodeURIComponent(organization)}&finding=${encodeURIComponent(sharedId)}`}
        >
          View your finding and response
        </Link>
      </div>
    );
  return (
    <div className="finding-share">
      {!initialOpen && (
        <button
          className="es-btn small"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close report preview" : "Share finding with team"}
        </button>
      )}
      {open && (
        <form onSubmit={submit}>
          <h3>Share this finding with your team</h3>
          <p>
            Your organization’s admins can see everything in the preview below.
            Only the evidence shown here and the scanner summary are shared.
            Review the preview before submitting. Email bodies, attachments, and
            inbox access are not attached.
          </p>
          {loading ? (
            <p role="status">Loading your organizations…</p>
          ) : choices.length > 0 ? (
            <label>
              Organization
              <select
                required
                value={organization}
                disabled={busy}
                onChange={(event) => setOrganization(event.target.value)}
              >
                {choices.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            !error && (
              <p>
                You haven’t joined an organization yet.{" "}
                <Link to="/organization">
                  Create one or accept an invitation
                </Link>
                .
              </p>
            )
          )}
          <label>
            Optional note
            <textarea
              rows={3}
              maxLength={2000}
              disabled={busy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Tell your admin why you’re concerned. Do not include passwords or private information."
            />
          </label>
          <label>
            Evidence preview<pre>{details}</pre>
          </label>
          <p>
            Scanner verdict: {finding.scanner.verdict} · Risk score:{" "}
            {finding.scanner.score}/100. These are reporter-shared scanner
            findings, not an independent admin verification.
          </p>
          {details.length > 10000 && (
            <p role="alert">
              This finding exceeds the 10,000-character limit. Shorten your note
              or submit a shorter report through Team Security.
            </p>
          )}
          {error && (
            <p className="finding-share-error" role="alert">
              {error}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => setAttempt((value) => value + 1)}
              >
                Reload organizations
              </button>
            </p>
          )}
          <button
            className="es-btn primary small"
            type="submit"
            disabled={
              busy || loading || !organization || details.length > 10000
            }
          >
            {busy ? "Submitting…" : "Share finding with admin"}
          </button>
        </form>
      )}
    </div>
  );
}
