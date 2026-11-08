import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

import {
  startGmailConnect,
  searchGmailMessages,
  analyzeGmailMessages,
  analyzeManualEmails,
  trashGmailMessages,
  spamGmailMessages,
  ApiError,
  saveGmailSession,
  loadGmailSession,
  clearGmailSession,
  type GmailHeaderItem,
  type EmailResult,
  type ManualEmailInput,
} from "../api/emailApi";

import ShareFinding from "../components/ShareFinding";
import {
  recordEmailScans,
  listEmailScans,
  syncEmailScans,
  findingLabel,
  SCAN_ACTIVITY_EVENT,
  type EmailScanEntry,
  type ScanFinding,
} from "../lib/scanActivity";
import "./EmailScanner.css";

const MAX_EMAILS = 50;
const RECENT_SCANS_SHOWN = 8;

type Mode = "landing" | "manual" | "gmail-picker" | "results";
type Folder = "Trash" | "Spam";
type Verdict = EmailResult["classification"];

interface QueuedEmail extends ManualEmailInput {
  localId: string;
}

interface InboxFilter {
  query: string;
  unreadOnly: boolean;
}

const NO_FILTER: InboxFilter = { query: "", unreadOnly: false };

const RISK_ORDER: Record<Verdict, number> = {
  PHISHING: 0,
  SUSPICIOUS: 1,
  ERROR: 2,
  SAFE: 3,
};

const VERDICT_LABELS: Record<Verdict, string> = {
  PHISHING: "Phishing",
  SUSPICIOUS: "Suspicious",
  SAFE: "Safe",
  ERROR: "Couldn't scan",
};

const CHECK_ICONS = { pass: "✓", warn: "!", fail: "✕", info: "i" } as const;

function emptyForm(): ManualEmailInput {
  return { sender: "", subject: "", body: "", urls: [] };
}

function readGmailReturnParams(): { session: string | null; error: string | null; fromRedirect: boolean } {
  const params = new URLSearchParams(window.location.search);
  const returned = params.get("gmail_session");
  return {
    // Coming back from Google's sign-in, or a session saved on an earlier
    // visit that hasn't expired yet.
    session: returned ?? loadGmailSession(),
    error: params.get("gmail_error"),
    fromRedirect: returned !== null,
  };
}

const isSessionExpired = (err: unknown) => err instanceof ApiError && err.status === 401;

/** The email text with the words that pointed to phishing wrapped in <mark>. */
function highlightText(text: string, phrases: string[]): ReactNode {
  // Phrases come from the model in lower case with punctuation removed, so
  // match their words with any punctuation/spacing in between.
  const patterns = phrases
    .filter((p) => /^[a-z0-9 ]+$/.test(p))
    .sort((a, b) => b.length - a.length)
    .map((p) => p.split(" ").join("[^a-z0-9]+"));
  if (patterns.length === 0) return text;
  const re = new RegExp(`\\b(?:${patterns.join("|")})\\b`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<mark key={start}>{m[0]}</mark>);
    last = start + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** "PayPal Security <a@b.com>" -> "PayPal Security"; a bare address stays as is. */
function senderName(sender: string): string {
  const m = sender.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return (m && m[1].trim()) || sender.replace(/[<>]/g, "").trim();
}

/** Gmail's Date header shown like Gmail does: a time for today, otherwise "Nov 7". */
function shortDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** Lines in the model's explanation that aren't already shown as checks. */
function reasonsFor(r: EmailResult): string[] {
  const checkDetails = new Set((r.checks ?? []).map((c) => c.detail));
  return r.explanation.filter((line) => !checkDetails.has(line));
}

const resultKey = (r: EmailResult, i: number) => r.id ?? `manual-${i}`;

export default function EmailScanner() {
  const { session, loading: authLoading } = useAuth();
  const [, setSearchParams] = useSearchParams();

  // Read the OAuth-return params exactly once, during the component's first
  // render, instead of setting state after the fact inside an effect (which
  // would force an extra render right after mount).
  const [initialGmail] = useState(readGmailReturnParams);

  const [mode, setMode] = useState<Mode>(initialGmail.session ? "gmail-picker" : "landing");
  const [banner, setBanner] = useState<string | null>(
    initialGmail.error
      ? initialGmail.error === "access_denied"
        ? "Gmail connection was cancelled."
        : `Gmail connection failed: ${initialGmail.error}`
      : null
  );

  // manual paste-in state
  const [form, setForm] = useState<ManualEmailInput>(emptyForm());
  const [urlsText, setUrlsText] = useState("");
  const [queue, setQueue] = useState<QueuedEmail[]>([]);

  // gmail state
  const [gmailSession, setGmailSession] = useState<string | null>(initialGmail.session);
  const [gmailEmails, setGmailEmails] = useState<GmailHeaderItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [gmailLoading, setGmailLoading] = useState(Boolean(initialGmail.session));

  // inbox search / filter / paging
  const [searchText, setSearchText] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>(NO_FILTER);
  const [notScannedOnly, setNotScannedOnly] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // shared
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // results view: verdict filter chips (empty = all) and the open email
  const [verdictFilter, setVerdictFilter] = useState<Set<Verdict>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);

  // gmail Trash / Spam state
  const [movedTo, setMovedTo] = useState<Record<string, Folder>>({});
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});

  // scan history (saved in this browser by lib/scanActivity)
  const userId = session?.user.id;
  const [scanHistory, setScanHistory] = useState<EmailScanEntry[]>(() =>
    userId ? listEmailScans(userId) : [],
  );

  useEffect(() => {
    const refresh = () => setScanHistory(userId ? listEmailScans(userId) : []);
    refresh();
    // Pull in scans saved on other devices (and save any still waiting).
    if (userId) void syncEmailScans(userId);
    window.addEventListener(SCAN_ACTIVITY_EVENT, refresh);
    return () => window.removeEventListener(SCAN_ACTIVITY_EVENT, refresh);
  }, [userId]);

  /** Latest scan result for each Gmail message, for the inbox's "Scanned" badges. */
  const lastScanById = useMemo(() => {
    const map = new Map<string, ScanFinding>();
    for (const entry of scanHistory) {
      // History is newest first, so keep the first one seen.
      if (entry.messageId && !map.has(entry.messageId)) map.set(entry.messageId, entry.finding);
    }
    return map;
  }, [scanHistory]);

  const resetMoves = () => {
    setMovedTo({});
    setMovingIds(new Set());
    setMoveErrors({});
  };

  /** Forget the Gmail session and return to the start screen. */
  const disconnectGmail = (message: string | null = null) => {
    clearGmailSession();
    setGmailSession(null);
    setGmailEmails([]);
    setSelectedIds(new Set());
    setGmailLoading(false);
    setNextPageToken(null);
    setSearchText("");
    setInboxFilter(NO_FILTER);
    setNotScannedOnly(false);
    setResults(null);
    resetMoves();
    setErrorMsg(null);
    setBanner(message);
    setMode("landing");
  };

  const handleGmailExpired = () =>
    disconnectGmail("Your Gmail session expired. Connect your Gmail account again to keep scanning.");

  /** Loads the first page of the inbox for a search/filter (also used by Refresh). */
  const loadGmailList = async (gmail: string, filter: InboxFilter = inboxFilter) => {
    await Promise.resolve();

    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const page = await searchGmailMessages(gmail, {
        query: filter.query,
        unreadOnly: filter.unreadOnly,
        limit: MAX_EMAILS,
      });
      setGmailEmails(page.items);
      setNextPageToken(page.next_page_token);
      // Drop selections for emails that are no longer listed.
      setSelectedIds((prev) => new Set(page.items.map((m) => m.id).filter((id) => prev.has(id))));
    } catch (err) {
      if (isSessionExpired(err)) {
        handleGmailExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Could not load your Gmail inbox.");
    } finally {
      setGmailLoading(false);
    }
  };

  const loadMore = async () => {
    if (!gmailSession || !nextPageToken) return;
    setLoadingMore(true);
    setErrorMsg(null);
    try {
      const page = await searchGmailMessages(gmailSession, {
        query: inboxFilter.query,
        unreadOnly: inboxFilter.unreadOnly,
        pageToken: nextPageToken,
        limit: MAX_EMAILS,
      });
      setGmailEmails((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.items.filter((m) => !seen.has(m.id))];
      });
      setNextPageToken(page.next_page_token);
    } catch (err) {
      if (isSessionExpired(err)) {
        handleGmailExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Could not load more emails.");
    } finally {
      setLoadingMore(false);
    }
  };

  const applyFilter = (filter: InboxFilter) => {
    setInboxFilter(filter);
    if (gmailSession) void loadGmailList(gmailSession, filter);
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    applyFilter({ ...inboxFilter, query: searchText.trim() });
  };

  const clearSearch = () => {
    setSearchText("");
    applyFilter({ ...inboxFilter, query: "" });
  };

  useEffect(() => {
    if (initialGmail.fromRedirect || initialGmail.error) {
      setSearchParams({}, { replace: true });
    }
    if (initialGmail.fromRedirect && initialGmail.session) {
      saveGmailSession(initialGmail.session);
    }
    if (initialGmail.session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadGmailList(initialGmail.session, NO_FILTER);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gmail is only available while signed in to CyberGuard, so signing out
  // also forgets the Gmail session saved in this browser.
  useEffect(() => {
    if (!authLoading && !session && gmailSession) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      disconnectGmail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session, gmailSession]);

  const resetManual = () => {
    setMode("landing");
    setForm(emptyForm());
    setUrlsText("");
    setQueue([]);
    setResults(null);
    setErrorMsg(null);
    setBanner(null);
  };

  /** Back from the inbox picker: keep the Gmail session and the loaded inbox. */
  const leavePicker = () => {
    setMode("landing");
    setErrorMsg(null);
    setBanner(null);
  };

  const openInbox = () => {
    if (!gmailSession) return;
    setBanner(null);
    setErrorMsg(null);
    setMode("gmail-picker");
    if (gmailEmails.length === 0) void loadGmailList(gmailSession);
  };

  const showResults = (data: EmailResult[]) => {
    setResults(data);
    setVerdictFilter(new Set());
    setOpenKey(null);
    recordEmailScans(
      session?.user.id,
      data.map((item) => ({
        subject: item.subject,
        sender: item.sender,
        classification: item.classification,
        messageId: item.source === "gmail" ? item.id : null,
        riskScore: item.risk_score,
        confidence: item.classification === "ERROR" ? null : item.confidence,
        source: item.source,
      })),
    );
    setMode("results");
    window.scrollTo?.({ top: 0 });
  };

  /** From the results screen: Gmail scans go back to the inbox, manual scans start over. */
  const fromGmail = Boolean(results?.some((r) => r.source === "gmail") && gmailSession);
  const scanMore = () => {
    if (!fromGmail) {
      resetManual();
      return;
    }
    setGmailEmails((prev) => prev.filter((m) => !movedTo[m.id]));
    setSelectedIds(new Set());
    setResults(null);
    resetMoves();
    setErrorMsg(null);
    setMode("gmail-picker");
  };

  // ---- manual paste-in ----

  const addToQueue = () => {
    if (!form.sender.trim()) return;
    if (queue.length >= MAX_EMAILS) return;
    const urls = urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    setQueue((q) => [...q, { ...form, urls, localId: crypto.randomUUID() }]);
    setForm(emptyForm());
    setUrlsText("");
  };

  const removeFromQueue = (localId: string) => {
    setQueue((q) => q.filter((e) => e.localId !== localId));
  };

  const analyzeManual = async () => {
    if (queue.length === 0) return;
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const payload: ManualEmailInput[] = queue.map(({ sender, subject, body, urls }) => ({
        sender,
        subject,
        body,
        urls,
      }));
      // The login token lets the backend raise Security Alerts for risky emails.
      showResults(await analyzeManualEmails(payload, session?.access_token));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  // ---- gmail picker ----

  const visibleEmails = notScannedOnly
    ? gmailEmails.filter((m) => !lastScanById.has(m.id))
    : gmailEmails;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_EMAILS) {
        next.add(id);
      }
      return next;
    });
  };

  // "Select all" picks every listed email, up to the per-scan limit.
  const selectableIds = visibleEmails.slice(0, MAX_EMAILS).map((m) => m.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };

  const analyzeGmailSelection = async () => {
    if (!gmailSession || selectedIds.size === 0) return;
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      showResults(
        await analyzeGmailMessages(gmailSession, Array.from(selectedIds), session?.access_token),
      );
    } catch (err) {
      if (isSessionExpired(err)) {
        handleGmailExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  // ---- Trash / Spam ----

  const canMove = (r: EmailResult): r is EmailResult & { id: string } =>
    r.source === "gmail" && r.id != null && (r.classification === "PHISHING" || r.classification === "SUSPICIOUS");

  const movableIds = (classification: Verdict) =>
    (results ?? [])
      .filter((r) => canMove(r) && r.classification === classification && !movedTo[r.id])
      .map((r) => r.id as string);

  const moveMessages = async (ids: string[], folder: Folder) => {
    if (!gmailSession || ids.length === 0) return;
    const noun = ids.length === 1 ? "this email" : `these ${ids.length} emails`;
    const question =
      folder === "Spam"
        ? `Move ${noun} to your Gmail Spam folder? This also helps Gmail catch similar emails. You can move them back from Spam.`
        : `Move ${noun} to your Gmail Trash? You can restore them from Trash within 30 days.`;
    if (!window.confirm(question)) return;

    setMovingIds((prev) => new Set([...prev, ...ids]));
    setErrorMsg(null);
    try {
      let done: string[];
      let failed: { id: string; error: string }[];
      if (folder === "Spam") {
        ({ moved: done, failed } = await spamGmailMessages(gmailSession, ids));
      } else {
        ({ trashed: done, failed } = await trashGmailMessages(gmailSession, ids));
      }
      setMovedTo((prev) => {
        const next = { ...prev };
        for (const id of done) next[id] = folder;
        return next;
      });
      setMoveErrors((prev) => {
        const next = { ...prev };
        for (const id of done) delete next[id];
        for (const f of failed) next[f.id] = f.error;
        return next;
      });
    } catch (err) {
      if (isSessionExpired(err)) {
        handleGmailExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : `Could not move emails to ${folder}.`);
    } finally {
      setMovingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const connectGmail = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}`;
    startGmailConnect(returnTo);
  };

  // ---- results view ----

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { PHISHING: 0, SUSPICIOUS: 0, SAFE: 0, ERROR: 0 };
    for (const r of results ?? []) c[r.classification] = (c[r.classification] ?? 0) + 1;
    return c;
  }, [results]);

  // Riskiest first (highest score within a verdict), then the chip filter.
  const shownResults = useMemo(() => {
    const keyed = (results ?? []).map((r, i) => ({ r, key: resultKey(r, i) }));
    const filtered = verdictFilter.size === 0 ? keyed : keyed.filter(({ r }) => verdictFilter.has(r.classification));
    return [...filtered].sort(
      (a, b) =>
        RISK_ORDER[a.r.classification] - RISK_ORDER[b.r.classification] ||
        b.r.risk_score - a.r.risk_score,
    );
  }, [results, verdictFilter]);

  // The open email: the one picked, or the riskiest one shown.
  const open = shownResults.find((x) => x.key === openKey) ?? shownResults[0] ?? null;

  const toggleVerdict = (v: Verdict) => {
    setVerdictFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const openResult = (key: string) => {
    setOpenKey(key);
    // On narrow screens the details sit under the list, so bring them into view.
    if (window.matchMedia?.("(max-width: 1000px)").matches) {
      document.getElementById("es-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const filtering = inboxFilter.query !== "" || inboxFilter.unreadOnly || notScannedOnly;
  const phishingLeft = movableIds("PHISHING");
  const busyMoving = movingIds.size > 0;
  const total = results?.length ?? 0;

  const renderDetail = (r: EmailResult) => {
    const checks = r.checks ?? [];
    const riskyLinks = (r.links ?? []).filter((l) => l.verdict !== "ok");
    const reasons = reasonsFor(r);
    const score = Math.max(0, Math.min(100, r.risk_score));
    return (
      <>
        <div className="es-detail-head">
          <div className="es-detail-title">
            <span className={`es-badge ${r.classification}`}>{r.classification}</span>
            <h2>{r.subject.trim() || "(no subject)"}</h2>
            <div className="es-detail-sender">{r.sender}</div>
          </div>
          {r.classification !== "ERROR" && (
            <div className="es-meter" aria-label={`Risk ${r.risk_score} out of 100`}>
              <div className="es-meter-top">
                <span>Risk</span>
                <span className={`es-meter-score ${r.classification}`}>{r.risk_score} / 100</span>
              </div>
              <div className="es-meter-track">
                <span className="es-meter-knob" style={{ left: `${score}%` }} />
              </div>
              <div className="es-meter-note">Model confidence {(r.confidence * 100).toFixed(0)}%</div>
            </div>
          )}
        </div>

        <div className="es-detail-actions">
          {canMove(r) &&
            (movedTo[r.id] ? (
              <span className="es-trashed">Moved to {movedTo[r.id]}</span>
            ) : (
              <>
                <button
                  className="es-btn danger"
                  onClick={() => moveMessages([r.id], "Spam")}
                  disabled={movingIds.has(r.id)}
                >
                  {movingIds.has(r.id) ? "Moving…" : "Move to Spam"}
                </button>
                <button
                  className="es-btn secondary"
                  onClick={() => moveMessages([r.id], "Trash")}
                  disabled={movingIds.has(r.id)}
                >
                  Move to Trash
                </button>
              </>
            ))}
          {r.classification !== "ERROR" && (
            <ShareFinding
              finding={{
                title: r.subject.trim() || "Suspicious email",
                kind: "email",
                details: `Sender: ${r.sender}\nSubject: ${r.subject}\nScanner: ${r.classification} · Risk ${r.risk_score}/100\n${r.explanation.join("\n")}`,
                scanner: { source: "email_scanner", verdict: r.classification, score: r.risk_score, reasons: r.explanation },
              }}
            />
          )}
        </div>
        {canMove(r) && moveErrors[r.id] && <p className="es-trash-error">{moveErrors[r.id]}</p>}

        {r.error ? (
          <p className="es-detail-reasons">{r.error}</p>
        ) : (
          <ul className="es-detail-reasons">
            {reasons.map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
        )}

        {checks.length > 0 && (
          <>
            <h3 className="es-section-title">Sender &amp; link checks</h3>
            <ul className="es-checks" aria-label="Sender and link checks">
              {checks.map((c) => (
                <li key={c.id} className={`es-check ${c.status}`}>
                  <span className="es-check-icon" aria-label={c.status}>{CHECK_ICONS[c.status]}</span>
                  <div>
                    <div className="es-check-label">{c.label}</div>
                    <div className="es-check-detail">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {(riskyLinks.length > 0 || r.preview) && (
          <div className={`es-detail-cols ${riskyLinks.length > 0 && r.preview ? "two" : ""}`}>
            {riskyLinks.length > 0 && (
              <div>
                <h3 className="es-section-title">Risky links — don't click these</h3>
                {riskyLinks.map((l) => (
                  <div key={l.url} className={`es-link ${l.verdict}`}>
                    <div className="es-link-row">
                      <span className={`es-link-verdict ${l.verdict}`}>
                        {l.verdict === "dangerous" ? "Dangerous" : "Suspicious"}
                      </span>
                      {l.mismatch && l.displayed_host ? (
                        <span className="es-link-hosts">
                          Shows <b>{l.displayed_host}</b> → really goes to <b>{l.host}</b>
                        </span>
                      ) : (
                        <span className="es-link-hosts">Goes to <b>{l.host}</b></span>
                      )}
                    </div>
                    <div className="es-link-url">{l.url}</div>
                    {l.reasons.length > 0 && (
                      <ul className="es-link-reasons">
                        {l.reasons.map((reason, j) => <li key={j}>{reason}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {r.preview && (
              <div>
                <h3 className="es-section-title">
                  Email text
                  {(r.highlights ?? []).length > 0 && <span className="es-section-note"> · suspicious words highlighted</span>}
                </h3>
                <div className="es-preview-body">
                  {r.preview.split("\n").map((line, j) => (
                    <Fragment key={j}>
                      {j > 0 && <br />}
                      {highlightText(line, r.highlights ?? [])}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="es">
      <p className="es-intro">
        Check up to {MAX_EMAILS} emails at once for phishing and scam indicators — paste them in
        by hand, or connect a Gmail account and pick straight from your inbox.
      </p>

      {banner && <div className="es-banner error">{banner}</div>}
      {errorMsg && <div className="es-banner error">{errorMsg}</div>}

      {mode === "landing" && (
        <div className="es-choice-grid">
          <button className="es-choice-card" onClick={() => setMode("manual")}>
            <h3>Paste emails manually</h3>
            <p>
              Copy and paste the sender address, subject, body, and any links from up to{" "}
              {MAX_EMAILS} emails, then check them together.
            </p>
          </button>
          <button
            className={`es-choice-card ${!session ? "disabled" : ""}`}
            onClick={session ? (gmailSession ? openInbox : connectGmail) : undefined}
            disabled={!session}
          >
            <h3>{session && gmailSession ? "Open your Gmail inbox" : "Connect Gmail account"}</h3>

            {session && gmailSession ? (
              <p>
                Your Gmail account is connected. Pick up to {MAX_EMAILS} messages from your
                inbox to scan, without signing in again.
              </p>
            ) : session ? (
              <p>
                Sign in with Google, then pick up to {MAX_EMAILS} messages straight
                from your inbox to scan. After the scan you can move phishing
                emails to Spam or Trash — CyberGuard never sends mail or deletes anything permanently.
              </p>
            ) : (
              <p>
                  Log in to your CyberGuard account to connect Gmail and scan emails
                  directly from your inbox.
              </p>
            )}
        </button>
        </div>
      )}

      {mode === "landing" && session && gmailSession && (
        <div className="es-row es-connected">
          <span className="es-count">Gmail connected</span>
          <button className="es-btn secondary small" onClick={() => disconnectGmail()}>
            Disconnect Gmail
          </button>
        </div>
      )}

      {mode === "landing" && session && (
        <section className="es-recent">
          <div className="es-recent-head">
            <h3>Recent scans</h3>
            <span className="es-recent-note">Saved in this browser</span>
          </div>
          {scanHistory.length === 0 ? (
            <p className="es-empty">Emails you scan will be listed here.</p>
          ) : (
            <ul className="es-recent-list">
              {scanHistory.slice(0, RECENT_SCANS_SHOWN).map((entry) => (
                <li key={entry.id} className="es-recent-item">
                  <span className={`es-recent-dot ${entry.finding}`} aria-hidden="true" />
                  <div className="es-item-main">
                    <div className="es-item-subject">{entry.title}</div>
                    <div className="es-item-meta">{entry.detail}</div>
                  </div>
                  <span className={`es-recent-finding ${entry.finding}`}>{findingLabel(entry.finding)}</span>
                  <span className="es-recent-time">{timeAgo(entry.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mode === "manual" && (
        <>
          <button className="es-back" onClick={resetManual}>&larr; Back</button>

          <div className="es-form">
            <div className="es-field">
              <label>Sender email address</label>
              <input
                value={form.sender}
                onChange={(e) => setForm((f) => ({ ...f, sender: e.target.value }))}
                placeholder="sender@example.com"
              />
            </div>
            <div className="es-field">
              <label>Subject</label>
              <input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Email subject line"
              />
            </div>
            <div className="es-field">
              <label>Body</label>
              <textarea
                rows={5}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Paste the email content here"
              />
            </div>
            <div className="es-field">
              <label>Links in the email (one per line, optional)</label>
              <textarea rows={2} value={urlsText} onChange={(e) => setUrlsText(e.target.value)} />
            </div>
            <button className="es-btn secondary" onClick={addToQueue} disabled={!form.sender.trim() || queue.length >= MAX_EMAILS}>
              Add to batch
            </button>
          </div>

          <div className="es-row">
            <span className={`es-count ${queue.length >= MAX_EMAILS ? "at-limit" : ""}`}>
              {queue.length} / {MAX_EMAILS} queued
            </span>
            <button className="es-btn" onClick={analyzeManual} disabled={queue.length === 0 || analyzing}>
              {analyzing ? "Analyzing…" : `Analyze ${queue.length || ""} email${queue.length === 1 ? "" : "s"}`}
            </button>
          </div>

          <div className="es-queue-list">
            {queue.length === 0 && <p className="es-empty">No emails queued yet — add one above.</p>}
            {queue.map((e) => (
              <div key={e.localId} className="es-queue-item">
                <div className="es-item-main">
                  <div className="es-item-subject">{e.subject || "(no subject)"}</div>
                  <div className="es-item-meta">{e.sender}</div>
                </div>
                <button className="es-remove" onClick={() => removeFromQueue(e.localId)} aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "gmail-picker" && (
        <>
          <button className="es-back" onClick={leavePicker}>&larr; Back</button>

          <div className="es-toolbar">
            <form className="es-search" onSubmit={submitSearch}>
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder='Search your inbox, e.g. "invoice" or from:paypal'
                maxLength={200}
                aria-label="Search your inbox"
              />
              <button type="submit" className="es-btn secondary" disabled={gmailLoading}>
                Search
              </button>
              {inboxFilter.query && (
                <button type="button" className="es-btn secondary" onClick={clearSearch} disabled={gmailLoading}>
                  Clear
                </button>
              )}
            </form>
            <div className="es-toolbar-group">
              <button
                type="button"
                className={`es-chip ${inboxFilter.unreadOnly ? "on" : ""}`}
                aria-pressed={inboxFilter.unreadOnly}
                onClick={() => applyFilter({ ...inboxFilter, unreadOnly: !inboxFilter.unreadOnly })}
                disabled={gmailLoading}
              >
                Unread only
              </button>
              <button
                type="button"
                className={`es-chip ${notScannedOnly ? "on" : ""}`}
                aria-pressed={notScannedOnly}
                onClick={() => setNotScannedOnly((v) => !v)}
              >
                Not scanned yet
              </button>
            </div>
            <div className="es-toolbar-group es-toolbar-end">
              <span className={`es-count ${selectedIds.size >= MAX_EMAILS ? "at-limit" : ""}`}>
                {selectedIds.size} / {MAX_EMAILS} selected
              </span>
              <button
                className="es-btn secondary"
                onClick={() => gmailSession && void loadGmailList(gmailSession)}
                disabled={analyzing || gmailLoading}
              >
                Refresh
              </button>
              <button
                className="es-btn secondary"
                onClick={toggleSelectAll}
                disabled={selectableIds.length === 0 || analyzing}
              >
                {allSelected ? "Clear selection" : `Select all (${selectableIds.length})`}
              </button>
              <button className="es-btn" onClick={analyzeGmailSelection} disabled={selectedIds.size === 0 || analyzing}>
                {analyzing ? "Analyzing…" : `Analyze ${selectedIds.size || ""} email${selectedIds.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {gmailLoading ? (
            <p className="es-loading">Loading your inbox…</p>
          ) : (
            <>
              {filtering && (
                <p className="es-list-note">
                  {visibleEmails.length} matching email{visibleEmails.length === 1 ? "" : "s"}
                  {nextPageToken && " so far"}
                </p>
              )}
              <div className="es-inbox">
                {visibleEmails.length === 0 && (
                  <p className="es-empty">
                    {filtering ? "No inbox messages match these filters." : "No inbox messages found."}
                  </p>
                )}
                {visibleEmails.map((m) => {
                  const scanned = lastScanById.get(m.id);
                  const selected = selectedIds.has(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`es-inbox-row ${selected ? "selected" : ""} ${m.unread ? "unread" : ""}`}
                      title={m.sender}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(m.id)}
                        disabled={!selected && selectedIds.size >= MAX_EMAILS}
                      />
                      <span className="es-inbox-sender">{senderName(m.sender)}</span>
                      <span className="es-inbox-line">
                        <span className="es-inbox-subject">{m.subject || "(no subject)"}</span>
                        {m.snippet && <span className="es-inbox-snippet"> — {m.snippet}</span>}
                      </span>
                      <span className="es-inbox-tag-cell">
                        {scanned && (
                          <span className={`es-scanned-tag ${scanned}`}>Scanned · {findingLabel(scanned)}</span>
                        )}
                      </span>
                      <span className="es-inbox-date">{shortDate(m.date)}</span>
                    </label>
                  );
                })}
              </div>
              {nextPageToken && (
                <div className="es-load-more-wrap">
                  <button className="es-btn secondary" onClick={loadMore} disabled={loadingMore || analyzing}>
                    {loadingMore ? "Loading…" : "Load more emails"}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {mode === "results" && results && (
        <>
          <div className="es-toolbar">
            <button className="es-btn secondary" onClick={scanMore}>
              &larr; {fromGmail ? "Back to inbox" : "Scan more emails"}
            </button>
            <h2 className="es-toolbar-title">
              {total} email{total === 1 ? "" : "s"} scanned
            </h2>
            {phishingLeft.length > 0 && (
              <div className="es-toolbar-group es-toolbar-end">
                <span className="es-count">
                  {phishingLeft.length} phishing email{phishingLeft.length === 1 ? "" : "s"} still in your inbox
                </span>
                <button className="es-btn danger" onClick={() => moveMessages(phishingLeft, "Spam")} disabled={busyMoving}>
                  {busyMoving ? "Moving…" : "Move all phishing to Spam"}
                </button>
                <button className="es-btn secondary" onClick={() => moveMessages(phishingLeft, "Trash")} disabled={busyMoving}>
                  Move all to Trash
                </button>
              </div>
            )}
          </div>

          <div className="es-summary-bar">
            <div className="es-split" role="img" aria-label={`${counts.PHISHING} phishing, ${counts.SUSPICIOUS} suspicious, ${counts.SAFE} safe`}>
              {(["PHISHING", "SUSPICIOUS", "ERROR", "SAFE"] as Verdict[]).map((v) =>
                counts[v] > 0 ? (
                  <span key={v} className={`es-split-part ${v}`} style={{ width: `${(counts[v] / total) * 100}%` }} />
                ) : null,
              )}
            </div>
            <div className="es-chips" role="group" aria-label="Filter results">
              <button
                className={`es-chip ${verdictFilter.size === 0 ? "on" : ""}`}
                aria-pressed={verdictFilter.size === 0}
                onClick={() => setVerdictFilter(new Set())}
              >
                All <b>{total}</b>
              </button>
              {(["PHISHING", "SUSPICIOUS", "SAFE", "ERROR"] as Verdict[])
                .filter((v) => v !== "ERROR" || counts.ERROR > 0)
                .map((v) => (
                  <button
                    key={v}
                    className={`es-chip ${verdictFilter.has(v) ? "on" : ""}`}
                    aria-pressed={verdictFilter.has(v)}
                    onClick={() => toggleVerdict(v)}
                  >
                    <span className={`es-dot ${v}`} aria-hidden="true" />
                    {VERDICT_LABELS[v]} <b>{counts[v]}</b>
                  </button>
                ))}
            </div>
          </div>

          {shownResults.length === 0 ? (
            <p className="es-empty">No emails match these filters.</p>
          ) : (
            <div className="es-panes">
              <div className="es-result-list" role="listbox" aria-label="Scanned emails">
                {shownResults.map(({ r, key }) => (
                  <button
                    key={key}
                    role="option"
                    aria-selected={open?.key === key}
                    className={`es-result-row ${r.classification} ${open?.key === key ? "open" : ""}`}
                    onClick={() => openResult(key)}
                  >
                    <span className="es-result-row-main">
                      <span className="es-result-row-subject">{r.subject.trim() || "(no subject)"}</span>
                      <span className="es-result-row-sender">
                        {r.id && movedTo[r.id] ? `Moved to ${movedTo[r.id]} · ` : ""}
                        {r.sender}
                      </span>
                    </span>
                    <span className={`es-result-row-score ${r.classification}`}>
                      {r.classification === "ERROR" ? "—" : Math.round(r.risk_score)}
                      <small>{r.classification === "ERROR" ? "ERROR" : r.classification}</small>
                    </span>
                  </button>
                ))}
              </div>
              <section id="es-detail" className={`es-detail ${open?.r.classification ?? ""}`}>
                {open && renderDetail(open.r)}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
