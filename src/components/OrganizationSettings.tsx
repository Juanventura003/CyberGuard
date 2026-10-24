import { useState, type FormEvent } from "react";
import { Archive, Building2, LogOut, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./OrganizationSettings.css";

type Props = {
  organization: {
    id: string;
    name: string;
    owner_id: string;
    archived_at?: string | null;
  };
  userId: string;
  onExit: (message: string) => void;
  onArchiveChanged: (message: string) => void;
};
export default function OrganizationSettings({
  organization,
  userId,
  onExit,
  onArchiveChanged,
}: Props) {
  const owner = organization.owner_id === userId;
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiveConfirming, setArchiveConfirming] = useState(false);
  const [archiveName, setArchiveName] = useState("");
  async function changeArchive(event: FormEvent) {
    event.preventDefault();
    if (busy || archiveName !== organization.name) return;
    setBusy(true);
    setError("");
    const restoring = !!organization.archived_at;
    try {
      const { error } = await supabase!.rpc("cg_archive_organization", {
        org: organization.id,
        archive: !restoring,
        confirmation: archiveName,
      });
      if (error) throw error;
      setArchiveConfirming(false);
      setArchiveName("");
      onArchiveChanged(
        restoring
          ? "Organization restored. Members must reconnect their extensions to resume team protection."
          : "Organization archived. Connected extensions disconnect on their next successful sync.",
      );
    } catch (cause) {
      setError(
        (cause as { message?: string }).message ??
          "Could not update the organization.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (owner && confirmation !== organization.name)) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase!.rpc(
        owner ? "cg_delete_organization" : "cg_leave_organization",
        owner
          ? { org: organization.id, confirmation }
          : { org: organization.id },
      );
      if (error) throw new Error(error.message);
      onExit(
        owner
          ? `${organization.name} was deleted.`
          : `You left ${organization.name}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update your organization. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <section className="org-settings" aria-label="Organization settings">
      <div className="org-card org-settings-identity">
        <Building2 size={28} />
        <div>
          <p className="org-eyebrow">ORGANIZATION SETTINGS</p>
          <h2>{organization.name}</h2>
          <p>
            {owner ? "You own this organization." : "Your team membership."}
          </p>
        </div>
      </div>
      {owner && (
        <div className="org-card">
          <div className="org-settings-action">
            <div>
              <h2>
                {organization.archived_at
                  ? "Restore organization"
                  : "Archive organization"}
              </h2>
              <p>
                {organization.archived_at
                  ? "Reopen this team while keeping its saved records. Extensions stay disconnected until members reconnect."
                  : "Retire this team and preserve its records in a read-only archive. This ends active team protection."}
              </p>
            </div>
            {!archiveConfirming && (
              <button
                disabled={busy}
                onClick={() => {
                  setArchiveConfirming(true);
                  setConfirming(false);
                  setError("");
                }}
              >
                <Archive size={16} />{" "}
                {organization.archived_at ? "Restore" : "Archive organization"}
              </button>
            )}
          </div>
          {archiveConfirming && (
            <form className="org-settings-confirm" onSubmit={changeArchive}>
              <p>
                {organization.archived_at
                  ? "Existing browser connections and temporary approvals are not reactivated. Expired notices stay expired."
                  : "Members, findings, notices, and website rules stay saved. New activity is disabled. Browser connections and temporary approvals are revoked; presence is cleared. Offline browsers keep cached restrictions until they successfully sync. Personal blocks stay intact."}
              </p>
              <label>
                Type <strong>{organization.name}</strong> to confirm
                <input
                  value={archiveName}
                  onChange={(event) => setArchiveName(event.target.value)}
                  disabled={busy}
                  required
                  autoComplete="off"
                />
              </label>
              {error && (
                <p className="org-error" role="alert">
                  {error}
                </p>
              )}
              <div className="org-settings-buttons">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setArchiveConfirming(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button disabled={busy || archiveName !== organization.name}>
                  {busy
                    ? "Saving…"
                    : organization.archived_at
                      ? "Confirm restore"
                      : "Confirm archive"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="org-card org-settings-danger">
        <div className="org-settings-action">
          <div>
            <h2>{owner ? "Delete organization" : "Leave organization"}</h2>
            <p>
              {owner
                ? "Permanently delete this team and its shared data."
                : "End your membership and disconnect your team protection."}
            </p>
          </div>
          {!confirming && (
            <button
              className="org-danger-button"
              disabled={busy}
              onClick={() => {
                setConfirming(true);
                setArchiveConfirming(false);
                setError("");
              }}
            >
              {owner ? <Trash2 size={16} /> : <LogOut size={16} />}
              {owner ? "Delete organization" : "Leave organization"}
            </button>
          )}
        </div>
        {confirming && (
          <form onSubmit={submit} className="org-settings-confirm">
            <p>
              {owner
                ? "All members lose access. Team reports, invitations, website rules, and shared status will be deleted. This cannot be undone."
                : "Your shared status will be removed. Reports you already shared stay with the organization. You will need a new invitation to rejoin."}
            </p>
            <p>
              Connected extensions remove team rules on their next successful
              sync. Offline extensions keep cached rules until they reconnect.
              Personal accounts and scan history stay intact.
            </p>
            {owner && (
              <label>
                Type <strong>{organization.name}</strong> to confirm
                <input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                  required
                  aria-label="Organization name confirmation"
                />
              </label>
            )}
            {error && (
              <p className="org-error" role="alert">
                {error}
              </p>
            )}
            <div className="org-settings-buttons">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setConfirmation("");
                  setError("");
                }}
              >
                Cancel
              </button>
              <button
                className="org-danger-button"
                disabled={busy || (owner && confirmation !== organization.name)}
              >
                {busy
                  ? "Saving…"
                  : owner
                    ? "Permanently delete organization"
                    : "Confirm leave"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
