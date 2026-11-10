import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { organizationError } from "../lib/organizationData";
import type { NoticeOrganization } from "../lib/teamNotices";
import "./TeamNotices.css";

export default function PublishGeneralAnnouncement({
  organizations,
  onClose,
  onPublished,
}: {
  organizations: NoticeOrganization[];
  onClose: () => void;
  onPublished: (org: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [organization, setOrganization] = useState(organizations[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
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
    setBusy(true);
    setError("");
    try {
      if (
        expiry &&
        (!Number.isFinite(Date.parse(expiry)) ||
          Date.parse(expiry) <= Date.now())
      )
        throw new Error("Choose an expiry in the future, or leave it blank.");
      const { data: userData, error: userError } =
        await supabase!.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("Sign in required.");
      const { error: insertError } = await supabase!
        .from("cg_general_announcements")
        .insert({
          organization_id: organization,
          created_by: userData.user.id,
          title: title.trim(),
          message: message.trim(),
          pinned: pin,
          expires_at: expiry ? new Date(expiry).toISOString() : null,
        });
      if (insertError) throw insertError;
      onPublished(organization);
    } catch (cause) {
      setError(
        organizationError(cause, "Could not publish the announcement. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="team-notice-dialog" onClose={onClose}>
      <form onSubmit={publish}>
        <p className="notice-eyebrow">TEAM NOTICES</p>
        <h2>Publish a general announcement</h2>
        <label>
          Organization
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} disabled={busy} required>
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} required disabled={busy} />
        </label>
        <label>
          Announcement
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={3} maxLength={5000} rows={7} required disabled={busy} placeholder="Write an announcement for everyone in the organization." />
        </label>
        <label>
          Expires at (optional, your local time)
          <input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={busy} />
        </label>
        <label className="notice-check">
          <input type="checkbox" checked={pin} onChange={(event) => setPin(event.target.checked)} disabled={busy} />
          Pin at the top of Team notices
        </label>
        <p className="notice-help">All current members can read and acknowledge this announcement.</p>
        {error && <p className="notice-error" role="alert">{error}</p>}
        <div className="notice-actions">
          <button type="submit" disabled={busy || !organization || title.trim().length < 3 || message.trim().length < 3}>
            {busy ? "Publishing…" : "Publish announcement"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
