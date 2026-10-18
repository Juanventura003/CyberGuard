import { useState, type FormEvent } from "react";
import { Building2, LogOut, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./OrganizationSettings.css";

type Props = {
  organization: { id: string; name: string; owner_id: string };
  userId: string;
  onExit: (message: string) => void;
};
export default function OrganizationSettings({
  organization,
  userId,
  onExit,
}: Props) {
  const owner = organization.owner_id === userId;
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
              onClick={() => setConfirming(true)}
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
