import { Bell, Check, ShieldAlert } from "lucide-react";
import type { useWarningOverrides } from "../lib/useWarningOverrides";

export default function OrganizationWarningOverrides({ activity }: { activity: ReturnType<typeof useWarningOverrides> }) {
  const { events, unread, loading, error, actionError, busy, review, refresh, onlyUnread, setOnlyUnread } = activity;
  const pending = events.filter((event) => !event.reviewed_at);
  const shown = events;
  return (
    <div className="org-card org-overrides">
      <div className="org-overrides-heading">
        <div>
          <span className="org-overrides-eyebrow">MEMBER SUPERVISION</span>
          <h2><ShieldAlert size={22} /> Warning overrides {!error && !loading && <span className="org-overrides-count" role="status"><Bell size={13} /> {unread} unread</span>}</h2>
          <p className="org-help">See when a member chooses to continue after an organization website warning.</p>
        </div>
        <button type="button" disabled={busy || loading || !!error || !pending.length} onClick={() => void review(pending.map((event) => event.id))}>Mark displayed events reviewed</button>
      </div>
      {(error || actionError) && <p className="org-error" role="alert">{error || actionError} <button type="button" onClick={refresh}>Refresh</button></p>}
      <div className="org-overrides-toolbar">
        <strong>Recent overrides</strong>
        <label><input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} /> Unread only</label>
      </div>
      <div className="org-overrides-events" aria-busy={loading || busy}>
        {loading && <p role="status">Loading warning overrides…</p>}
        {!loading && !error && shown.map((event) => (
          <article key={event.id} className={`org-override-event ${event.reviewed_at ? "is-reviewed" : ""}`}>
            <span className="org-override-icon"><ShieldAlert size={20} /></span>
            <div className="org-override-detail">
              <div className="org-override-title"><strong>{event.member_email}</strong><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time></div>
              <p>Chose to continue to <strong>{event.domain}</strong> after a warning.</p>
              <div className="org-override-tags">{event.reasons.map((reason, index) => <span key={index}>{reason}</span>)}</div>
              {event.reviewed_at && <p className="org-help">Reviewed {new Date(event.reviewed_at).toLocaleString()}</p>}
            </div>
            <button type="button" disabled={busy || !!event.reviewed_at} onClick={() => void review([event.id])}>{event.reviewed_at ? <><Check size={15} /> Reviewed</> : "Mark reviewed"}</button>
          </article>
        ))}
        {!loading && !error && !shown.length && <p className="org-help" role="status">{onlyUnread ? "You’re all caught up. No unread warning overrides." : "No warning overrides yet."}</p>}
      </div>
    </div>
  );
}
