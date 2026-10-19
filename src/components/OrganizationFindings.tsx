import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Shield, Plus, FileSearch } from "lucide-react";
import HelpTip from "./HelpTip";
import FindingResponse from "./FindingResponse";
import FindingProtection from "./FindingProtection";
import WebsiteReviewRequest from "./WebsiteReviewRequest";
import ListPagination from "./ListPagination";
import { organizationError } from "../lib/organizationData";
import { supabase } from "../lib/supabase";
import {
  normalizeFindingDomain,
  type OrganizationFinding,
} from "../lib/organizationFindings";
import "./OrganizationFindings.css";
type Props = {
  organization: { id: string; name: string };
  members: { user_id: string; email: string }[];
  userId: string;
  email: string;
  isAdmin: boolean;
  initialFinding?: string;
  reviewDomain?: string;
  refreshRevision: string;
  onCancelReview: () => void;
  onRefresh: (message: string) => void;
};
const label = (value: string) => value.replaceAll("_", " ");
export default function OrganizationFindings({
  organization,
  members,
  userId,
  email,
  isAdmin,
  initialFinding,
  reviewDomain,
  refreshRevision,
  onCancelReview,
  onRefresh,
}: Props) {
  const [selected, setSelected] = useState(initialFinding ?? "");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: OrganizationFinding[];
    detail: OrganizationFinding | null;
    total: number;
    open: number;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const pageSize = 25;
  const listKey = `${organization.id}:${page}:${filter}`;
  const queryKey = `${listKey}:${selected}`;
  const loading = result?.key !== listKey;
  const visible = loading ? [] : result.rows;
  const finding = loading
    ? undefined
    : selected
      ? result.detail?.id === selected
        ? result.detail
        : result.rows.find((item) => item.id === selected)
      : visible[0];
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = supabase!;
        let list = client
          .from("cg_incidents")
          .select("*", { count: "exact" })
          .eq("organization_id", organization.id);
        if (filter === "requests") list = list.eq("purpose", "unblock_request");
        if (filter === "open")
          list = list.in("status", ["new", "under_review", "confirmed"]);
        const [items, detail, outstanding] = await Promise.all([
          list
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1),
          selected &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            selected,
          )
            ? client
                .from("cg_incidents")
                .select("*")
                .eq("organization_id", organization.id)
                .eq("id", selected)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          client
            .from("cg_incidents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organization.id)
            .in("status", ["new", "under_review", "confirmed"]),
        ]);
        const failure = items.error ?? detail.error ?? outstanding.error;
        if (failure) throw failure;
        if (active) {
          setResult({
            key: listKey,
            rows: items.data ?? [],
            detail: detail.data,
            total: items.count ?? 0,
            open: outstanding.count ?? 0,
          });
          setLoadError("");
        }
      } catch (cause) {
        if (active)
          setLoadError(organizationError(cause, "Could not load findings."));
      }
    })();
    return () => {
      active = false;
    };
  }, [
    organization.id,
    page,
    filter,
    selected,
    queryKey,
    listKey,
    refreshRevision,
    retry,
  ]);
  const source = (item: OrganizationFinding) =>
    item.purpose === "unblock_request"
      ? "Website review request"
      : item.scan_evidence?.source === "website_tracker"
        ? "Website Tracker finding"
        : item.scan_evidence?.source === "website_scanner"
          ? "Website scan"
          : item.scan_evidence?.source === "email_scanner"
            ? "Email scan"
            : `${label(item.kind)} finding`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const entered = String(values.get("domain") ?? "").trim();
      const { data, error } = await supabase!.rpc("cg_submit_finding", {
        org: organization.id,
        finding_title: values.get("title"),
        content_kind: values.get("kind"),
        evidence_text: values.get("details"),
        website: entered ? normalizeFindingDomain(entered) : null,
        scanner: {},
      });
      if (error) throw new Error(error.message);
      setSelected(data as string);
      setFilter("all");
      setPage(0);
      form.reset();
      onRefresh("Finding shared. Your admin can review it and take action.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not share finding.",
      );
    } finally {
      setBusy(false);
    }
  }
  const scanner = finding?.scan_evidence;
  const reasons = Array.isArray(scanner?.reasons)
    ? scanner.reasons
        .filter((value): value is string => typeof value === "string")
        .slice(0, 6)
    : [];
  const hasResponse = !!finding?.admin_note;
  return (
    <div className="org-findings">
      {reviewDomain && (
        <WebsiteReviewRequest
          key={reviewDomain}
          organizationId={organization.id}
          organizationName={organization.name}
          domain={reviewDomain}
          onCancel={onCancelReview}
          onSubmitted={(id) => {
            setSelected(id);
            setFilter("all");
            setPage(0);
            onCancelReview();
            onRefresh(
              "Website review request received. If one was already pending, it is shown below.",
            );
          }}
        />
      )}
      <div className="org-card finding-overview">
        <div>
          <p className="org-eyebrow">FIND · REVIEW · PROTECT</p>
          <h2>{isAdmin ? "Security inbox" : "My findings"}</h2>
          <p>
            {isAdmin
              ? "Turn shared findings into team protection."
              : "Share a concern. Get guidance. Help protect your team."}
          </p>
        </div>
        <div className="finding-overview-count">
          <strong>{result?.open ?? "—"}</strong>
          <span>Awaiting resolution</span>
        </div>
      </div>
      <div className="finding-workspace">
        <section className="org-card finding-list">
          <div className="org-list-heading">
            <h2>
              <FileSearch size={19} />
              {isAdmin ? "Team findings" : "Your findings"}
              <HelpTip label="findings">
                Email and website scan evidence, manual findings, and website
                review requests share this inbox. Members see their own
                submissions; admins see team submissions. Findings are paged
                within the selected organization. Members see only their own
                submissions.
              </HelpTip>
            </h2>
            <select
              aria-label="Filter findings"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
                setSelected("");
              }}
            >
              <option value="all">All findings</option>
              <option value="open">Needs resolution</option>
              <option value="requests">Website review requests</option>
            </select>
          </div>
          {loadError && (
            <p className="org-error" role="alert">
              {loadError}
              <button onClick={() => setRetry((value) => value + 1)}>
                Retry
              </button>
            </p>
          )}
          {loading && !loadError && <p role="status">Loading findings…</p>}
          {!loading && !visible.length && (
            <div className="org-empty">
              <Shield size={28} />
              <h3>No findings here yet</h3>
              <p>
                Share an email or website scan, or request a review of a blocked
                website.
              </p>
              <Link to="/website-tracker">Open Website Tracker</Link>
            </div>
          )}
          <div className="finding-list-rows">
            {visible.map((item) => (
              <button
                className={`org-report ${finding?.id === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => {
                  setSelected(item.id);
                  if (window.innerWidth <= 1000)
                    requestAnimationFrame(() => {
                      const detail =
                        document.querySelector<HTMLElement>(".finding-detail");
                      detail?.scrollIntoView({ block: "start" });
                      detail?.focus({ preventScroll: true });
                    });
                }}
              >
                <strong>{item.title}</strong>
                <span className={`org-status ${item.status}`}>
                  {label(item.status)}
                </span>
                <small>
                  {source(item)} · {new Date(item.created_at).toLocaleString()}
                </small>
                {item.domain && <small>{item.domain}</small>}
                {!isAdmin && item.admin_note && (
                  <span className="finding-response-available">
                    Admin response available
                  </span>
                )}
              </button>
            ))}
          </div>
          <ListPagination
            label="findings"
            page={page}
            total={result?.total ?? 0}
            pageSize={pageSize}
            busy={loading}
            onPage={(value) => {
              setPage(value);
              setSelected("");
            }}
          />
        </section>
        <section
          className="org-card finding-detail"
          aria-label="Finding details"
          tabIndex={-1}
        >
          {finding ? (
            <>
              <p className="org-eyebrow">{source(finding).toUpperCase()}</p>
              <h2>{finding.title}</h2>
              <p className="org-help">
                {members.find((item) => item.user_id === finding.reporter_id)
                  ?.email ??
                  (finding.reporter_id === userId
                    ? email
                    : "Former member")}{" "}
                · {new Date(finding.created_at).toLocaleString()}
              </p>
              <ol className="finding-progress" aria-label="Finding progress">
                <li className="done">Shared</li>
                <li
                  className={
                    hasResponse || finding.status !== "new" ? "done" : ""
                  }
                >
                  {hasResponse ? "Reviewed" : "Review"}
                </li>
                <li className={hasResponse ? "done" : ""}>
                  {finding.response_action === "blocked"
                    ? "Block published"
                    : finding.response_action === "unblocked"
                      ? "Rule removed"
                      : finding.response_action === "kept_blocked"
                        ? "Block retained"
                        : hasResponse
                          ? "Guidance sent"
                          : "Response"}
                </li>
              </ol>
              {scanner?.verdict && typeof scanner.verdict === "string" && (
                <section className="finding-scan-summary">
                  <div>
                    <strong>{scanner.verdict}</strong>
                    {typeof scanner.score === "number" && (
                      <span>Risk {scanner.score}/100</span>
                    )}
                  </div>
                  {reasons.length > 0 && (
                    <ul>
                      {reasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <small>
                    Scanner evidence shared by the reporter; admin review is
                    separate.
                  </small>
                </section>
              )}
              <details
                className="finding-evidence"
                open={finding.purpose === "unblock_request"}
              >
                <summary>
                  {finding.purpose === "unblock_request"
                    ? "Why the member requested a review"
                    : "Shared evidence & context"}
                </summary>
                <div className="org-evidence">{finding.details}</div>
              </details>
              <div className="finding-guidance">
                <h3>
                  {isAdmin
                    ? "Response shared with member"
                    : "Your admin’s response"}
                </h3>
                <p>
                  {finding.admin_note ||
                    "Awaiting admin review. You do not need to open suspicious content while you wait."}
                </p>
                <span className={`org-status ${finding.status}`}>
                  {label(finding.status)}
                </span>
              </div>
              {(finding.domain ||
                finding.action_domain ||
                (finding.response_action &&
                  finding.response_action !== "none")) && (
                <FindingProtection
                  key={`protection:${finding.id}`}
                  finding={finding}
                  refreshRevision={refreshRevision}
                />
              )}
              {isAdmin && (
                <FindingResponse
                  key={`response:${finding.id}`}
                  finding={finding}
                  organizationName={organization.name}
                  onSaved={onRefresh}
                />
              )}
            </>
          ) : (
            <div className="org-empty">
              <FileSearch size={30} />
              <h3>
                {loading
                  ? "Loading finding…"
                  : selected
                    ? "Finding unavailable"
                    : "Select a finding"}
              </h3>
              <p>
                Review evidence, the admin’s response, and website protection
                here.
              </p>
            </div>
          )}
        </section>
      </div>
      <details className="org-card finding-submit">
        <summary>
          <Plus size={18} />
          Share a finding manually
        </summary>
        <p className="org-consent-summary">
          Shared with your organization’s admins. Leave out passwords and
          private content.
        </p>
        <form onSubmit={submit}>
          <label>
            Title
            <input
              name="title"
              required
              minLength={3}
              maxLength={150}
              placeholder="What looks suspicious?"
            />
          </label>
          <label>
            Type
            <select name="kind">
              <option value="link">Website / link</option>
              <option value="email">Email</option>
              <option value="file">File</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Website domain (optional)
            <input name="domain" maxLength={2048} placeholder="example.com" />
          </label>
          <label>
            Evidence & context
            <textarea
              name="details"
              required
              maxLength={10000}
              rows={3}
              placeholder="What did you observe, and why are you concerned?"
            />
          </label>
          {error && (
            <p className="org-error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} className="org-primary">
            {busy ? "Sharing…" : "Share with admin"}
          </button>
        </form>
        <p className="org-help">
          You can also share results directly from{" "}
          <Link to="/email-scanner">Email Scanner</Link> or{" "}
          <Link to="/website-tracker">Website Tracker</Link>.
        </p>
      </details>
    </div>
  );
}
