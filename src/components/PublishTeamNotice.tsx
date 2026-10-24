import { useEffect, useRef, useState, type FormEvent } from "react";
import type { NewsArticle } from "../api/newsApi";
import { supabase } from "../lib/supabase";
import { noticeArticleLink, type NoticeOrganization } from "../lib/teamNotices";
import { organizationError } from "../lib/organizationData";
import "./TeamNotices.css";

export default function PublishTeamNotice({
  article,
  organizations,
  onClose,
  onPublished,
}: {
  article: NewsArticle;
  organizations: NoticeOrganization[];
  onClose: () => void;
  onPublished: (org: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef({ payload: "", key: "" });
  const [organization, setOrganization] = useState(organizations[0]?.id ?? "");
  const [guidance, setGuidance] = useState("");
  const [pin, setPin] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const url = noticeArticleLink(article.url);
      if (!url)
        throw new Error("This article does not have a supported news link.");
      if (
        expiry &&
        (!Number.isFinite(Date.parse(expiry)) ||
          Date.parse(expiry) <= Date.now())
      )
        throw new Error("Choose an expiry in the future, or leave it blank.");
      const payload = {
        org: organization,
        news_id: article.id,
        news_title: article.title,
        news_url: url,
        news_source: article.source,
        message: guidance.trim(),
        pin,
        expiry: expiry ? new Date(expiry).toISOString() : null,
      };
      const serialized = JSON.stringify(payload);
      if (request.current.payload !== serialized)
        request.current = { payload: serialized, key: crypto.randomUUID() };
      const { error } = await supabase!.rpc("cg_publish_team_notice", {
        ...payload,
        request_key: request.current.key,
      });
      if (error) throw error;
      onPublished(organization);
    } catch (cause) {
      setError(
        organizationError(
          cause,
          "Could not publish your notice. Please retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="team-notice-dialog"
      aria-labelledby="publish-notice-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <form onSubmit={publish}>
        <p className="notice-eyebrow">TEAM NOTICES</p>
        <h2 id="publish-notice-title">Share news with your organization</h2>
        <p className="notice-article-title">{article.title}</p>
        <label>
          Organization
          <select
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            disabled={busy}
            required
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Why this matters and what members should do
          <textarea
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            required
            minLength={3}
            maxLength={3000}
            rows={5}
            disabled={busy}
            placeholder="Explain how this news affects your team and what action to take."
          />
        </label>
        <label>
          Expires at (optional, your local time)
          <input
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="notice-check">
          <input
            type="checkbox"
            checked={pin}
            onChange={(event) => setPin(event.target.checked)}
            disabled={busy}
          />
          Pin at the top of Team notices
        </label>
        <p className="notice-help">
          All current organization members can read and acknowledge this notice.
          Acknowledgement records receipt; it does not prove understanding.
          Published guidance stays fixed; archive and publish a new notice if it
          changes.
        </p>
        {error && (
          <p className="notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="notice-actions">
          <button
            type="submit"
            disabled={busy || !organization || guidance.trim().length < 3}
          >
            {busy ? "Publishing…" : "Publish team notice"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
