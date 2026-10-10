import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

import {
  startGmailConnect,
  listGmailMessages,
  analyzeGmailMessages,
  analyzeManualEmails,
  trashGmailMessages,
  ApiError,
  saveGmailSession,
  loadGmailSession,
  clearGmailSession,
  type GmailHeaderItem,
  type EmailResult,
  type ManualEmailInput,
} from "../api/emailApi";

import "./EmailScanner.css";

const MAX_EMAILS = 50;

type Mode = "landing" | "manual" | "gmail-picker" | "results";

interface QueuedEmail extends ManualEmailInput {
  localId: string;
}

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

  // shared
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // gmail trash state
const [trashedIds, setTrashedIds] = useState<Set<string>>(new Set());
const [trashingIds, setTrashingIds] = useState<Set<string>>(new Set());
const [trashErrors, setTrashErrors] = useState<Record<string, string>>({});


  /** Forget the Gmail session and return to the start screen. */
  const disconnectGmail = (message: string | null = null) => {
    clearGmailSession();
    setGmailSession(null);
    setGmailEmails([]);
    setSelectedIds(new Set());
    setGmailLoading(false);
    setResults(null);
    setTrashedIds(new Set());
    setTrashingIds(new Set());
    setTrashErrors({});
    setErrorMsg(null);
    setBanner(message);
    setMode("landing");
  };

  const handleGmailExpired = () =>
    disconnectGmail("Your Gmail session expired. Connect your Gmail account again to keep scanning.");

  const loadGmailList = async (session: string) => {
    await Promise.resolve();

    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const items = await listGmailMessages(session, MAX_EMAILS);
      setGmailEmails(items);
      // Drop selections for emails that are no longer in the inbox.
      setSelectedIds((prev) => new Set(items.map((m) => m.id).filter((id) => prev.has(id))));
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

  useEffect(() => {
    if (initialGmail.fromRedirect || initialGmail.error) {
      setSearchParams({}, { replace: true });
    }
    if (initialGmail.fromRedirect && initialGmail.session) {
      saveGmailSession(initialGmail.session);
    }
    if (initialGmail.session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadGmailList(initialGmail.session);
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

  /** From the results screen: Gmail scans go back to the inbox, manual scans start over. */
  const scanMore = () => {
    const fromGmail = results?.some((r) => r.source === "gmail") && gmailSession;
    if (!fromGmail) {
      resetManual();
      return;
    }
    setGmailEmails((prev) => prev.filter((m) => !trashedIds.has(m.id)));
    setSelectedIds(new Set());
    setResults(null);
    setTrashedIds(new Set());
    setTrashErrors({});
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
      const data = await analyzeManualEmails(payload);
      setResults(data);
      setMode("results");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  // ---- gmail picker ----

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
  const selectableIds = gmailEmails.slice(0, MAX_EMAILS).map((m) => m.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };

  const analyzeGmailSelection = async () => {
    if (!gmailSession || selectedIds.size === 0) return;
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const data = await analyzeGmailMessages(gmailSession, Array.from(selectedIds));
      setResults(data);
      setMode("results");
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

  const canTrash = (r: EmailResult): r is EmailResult & { id: string } =>
 r.source === "gmail" && r.id !== null && (r.classification === "PHISHING" || r.classification === "SUSPICIOUS");


const trashableIds = (classification: EmailResult["classification"]) =>
 (results ?? [])
   .filter((r) => canTrash(r) && r.classification === classification && !trashedIds.has(r.id))
   .map((r) => r.id as string);


const moveToTrash = async (ids: string[]) => {
 if (!gmailSession || ids.length === 0) return;
 const noun = ids.length === 1 ? "this email" : `these ${ids.length} emails`;
 if (!window.confirm(`Move ${noun} to your Gmail Trash? You can restore them from Trash within 30 days.`)) return;


 setTrashingIds((prev) => new Set([...prev, ...ids]));
 setErrorMsg(null);
 try {
   const { trashed, failed } = await trashGmailMessages(gmailSession, ids);
   setTrashedIds((prev) => new Set([...prev, ...trashed]));
   setTrashErrors((prev) => {
     const next = { ...prev };
     for (const id of trashed) delete next[id];
     for (const f of failed) next[f.id] = f.error;
     return next;
   });
 } catch (err) {
   if (isSessionExpired(err)) {
     handleGmailExpired();
     return;
   }
   setErrorMsg(err instanceof Error ? err.message : "Could not move emails to Trash.");
 } finally {
   setTrashingIds((prev) => {
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

  const summary = useMemo(() => {
    if (!results) return null;
    const counts = { PHISHING: 0, SUSPICIOUS: 0, SAFE: 0, ERROR: 0 };
    for (const r of results) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    return counts;
  }, [results]);

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
                emails to Trash — CyberGuard never sends mail or deletes anything permanently.
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

          {gmailLoading && <p className="es-loading">Loading your inbox…</p>}

          {!gmailLoading && (
            <>
              <div className="es-row">
                <span className={`es-count ${selectedIds.size >= MAX_EMAILS ? "at-limit" : ""}`}>
                  {selectedIds.size} / {MAX_EMAILS} selected
                </span>
                <div className="es-row-actions">
                  <button
                    className="es-btn secondary"
                    onClick={() => gmailSession && void loadGmailList(gmailSession)}
                    disabled={analyzing}
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

              <div className="es-picker-list">
                {gmailEmails.length === 0 && <p className="es-empty">No inbox messages found.</p>}
                {gmailEmails.map((m) => (
                  <label key={m.id} className={`es-picker-item ${selectedIds.has(m.id) ? "selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelected(m.id)}
                      disabled={!selectedIds.has(m.id) && selectedIds.size >= MAX_EMAILS}
                    />
                    <div className="es-item-main">
                      <div className="es-item-subject">{m.subject}</div>
                      <div className="es-item-meta">{m.sender} · {m.date}</div>
                      <div className="es-item-snippet">{m.snippet}</div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {mode === "results" && results && (
        <>
          <button className="es-back" onClick={scanMore}>&larr; Scan more emails</button>

          {summary && (
            <div className="es-summary">
              <div className="es-summary-chip"><span className="n">{results.length}</span>analyzed</div>
              <div className="es-summary-chip"><span className="n">{summary.PHISHING}</span>phishing</div>
              <div className="es-summary-chip"><span className="n">{summary.SUSPICIOUS}</span>suspicious</div>
              <div className="es-summary-chip"><span className="n">{summary.SAFE}</span>safe</div>
            </div>
          )}

          {trashableIds("PHISHING").length > 0 && (
              <div className="es-row">
                <span className="es-count">
                  {trashableIds("PHISHING").length} phishing email{trashableIds("PHISHING").length === 1 ? "" : "s"} still in your inbox
                </span>
                <button
                    className="es-btn danger"
                    onClick={() => moveToTrash(trashableIds("PHISHING"))}
                    disabled={trashingIds.size > 0}
                >
                  {trashingIds.size > 0 ? "Moving to Trash…" : "Move all phishing to Trash"}
                </button>
              </div>
          )}

          <div className="es-results-list">
            {results.map((r, i) => (
              <div key={r.id ?? i} className={`es-result-card ${r.classification}`}>
                <div className="es-result-top">
                  <span className="es-result-subject">{r.subject}</span>
                  <span className={`es-badge ${r.classification}`}>{r.classification}</span>
                </div>
                <div className="es-result-sender">{r.sender}</div>
                {r.classification !== "ERROR" && (
                  <div className="es-result-score">
                    Risk score: {r.risk_score}/100 · Confidence: {(r.confidence * 100).toFixed(0)}%
                  </div>
                )}
                {r.error ? (
                  <p className="es-result-explanation">{r.error}</p>
                ) : (
                  <ul className="es-result-explanation">
                    {r.explanation.map((line, j) => (
                      <li key={j}>{line}</li>
                    ))}
                  </ul>
                )}
                {canTrash(r) && (
                    <div className="es-result-actions">{trashedIds.has(r.id) ? (
                        <span className="es-trashed">Moved to Trash</span>
                    ) : (
                        <button
                            className="es-btn danger small"
                            onClick={() => moveToTrash([r.id])}
                            disabled={trashingIds.has(r.id)}
                        >
                          {trashingIds.has(r.id) ? "Moving…" : "Move to Trash"}
                        </button>
                    )}
                      {trashErrors[r.id] && <span className="es-trash-error">{trashErrors[r.id]}</span>}
                    </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

