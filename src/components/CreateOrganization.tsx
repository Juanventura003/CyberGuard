import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { organizationError } from "../lib/organizationData";
import "./CreateOrganization.css";

export default function CreateOrganization({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function create() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase!.rpc("cg_create_organization", {
        org_name: name.trim(),
      });
      if (error) throw error;
      if (typeof data !== "string")
        throw new Error(
          "Could not confirm the new organization. Refresh your teams before retrying.",
        );
      onCreated(data);
    } catch (cause) {
      setError(
        organizationError(
          cause,
          "Could not create your organization. Please retry.",
        ),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="create-organization-dialog"
      aria-labelledby="create-organization-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="create-organization-heading">
          <Building2 size={24} />
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="create-organization-title">Create organization</h2>
        <p>
          You’ll be the owner and admin. Invite your team after creating it.
        </p>
        <label>
          Organization name
          <input
            name="name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={100}
            placeholder="e.g. CyberGuard Project Team"
            disabled={busy}
          />
        </label>
        {error && (
          <p className="create-organization-error" role="alert">
            {error}
          </p>
        )}
        <div className="create-organization-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || name.trim().length < 2}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
