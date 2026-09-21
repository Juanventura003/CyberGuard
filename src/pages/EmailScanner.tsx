import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  startGmailConnect,
  listGmailMessages,
  analyzeGmailMessages,
  analyzeManualEmails,
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

function readGmailReturnParams(): { session: string | null; error: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    session: params.get("gmail_session"),
    error: params.get("gmail_error"),
  };
}

export default function EmailScanner() {
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
  const [gmailLoading, setGmailLoading] = useState(false);

  // shared
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadGmailList = async (session: string) => {
    // Yield one microtask before touching any state. An async function's
    // body runs synchronously up to its first `await`, so without this a
    // caller in a useEffect (like below) would still trigger setGmailLoading
    // synchronously within that effect's own call stack.
    await Promise.resolve();

    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const items = await listGmailMessages(session, MAX_EMAILS);
      setGmailEmails(items);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not load your Gmail inbox.");
    } finally {
      setGmailLoading(false);
    }
  };

  // The only things left to do after mount: strip the OAuth params back out
  // of the URL, and — if we arrived with a session — kick off the async
  // inbox fetch. loadGmailList defers past a microtask before it sets any
  // state, so nothing here runs synchronously within this effect.
  useEffect(() => {
    if (initialGmail.session || initialGmail.error) {
      setSearchParams({}, { replace: true });
    }
    if (initialGmail.session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadGmailList(initialGmail.session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAll = () => {
    setMode("landing");
    setForm(emptyForm());
    setUrlsText("");
    setQueue([]);
    setGmailSession(null);
    setGmailEmails([]);
    setSelectedIds(new Set());
    setResults(null);
    setErrorMsg(null);
    setBanner(null);
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

  const analyzeGmailSelection = async () => {
    if (!gmailSession || selectedIds.size === 0) return;
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const data = await analyzeGmailMessages(gmailSession, Array.from(selectedIds));
      setResults(data);
      setMode("results");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
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
          <button className="es-choice-card" onClick={connectGmail}>
            <h3>Connect Gmail account</h3>
            <p>
              Sign in with Google, then pick up to {MAX_EMAILS} messages straight from your inbox
              to scan. Read-only access — CyberGuard can never send, delete, or change anything.
            </p>
          </button>
        </div>
      )}

      {mode === "manual" && (
        <>
          <button className="es-back" onClick={resetAll}>&larr; Back</button>

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
          <button className="es-back" onClick={resetAll}>&larr; Back</button>

          {gmailLoading && <p className="es-loading">Loading your inbox…</p>}

          {!gmailLoading && (
            <>
              <div className="es-row">
                <span className={`es-count ${selectedIds.size >= MAX_EMAILS ? "at-limit" : ""}`}>
                  {selectedIds.size} / {MAX_EMAILS} selected
                </span>
                <button className="es-btn" onClick={analyzeGmailSelection} disabled={selectedIds.size === 0 || analyzing}>
                  {analyzing ? "Analyzing…" : `Analyze ${selectedIds.size || ""} email${selectedIds.size === 1 ? "" : "s"}`}
                </button>
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
          <button className="es-back" onClick={resetAll}>&larr; Scan more emails</button>

          {summary && (
            <div className="es-summary">
              <div className="es-summary-chip"><span className="n">{results.length}</span>analyzed</div>
              <div className="es-summary-chip"><span className="n">{summary.PHISHING}</span>phishing</div>
              <div className="es-summary-chip"><span className="n">{summary.SUSPICIOUS}</span>suspicious</div>
              <div className="es-summary-chip"><span className="n">{summary.SAFE}</span>safe</div>
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

