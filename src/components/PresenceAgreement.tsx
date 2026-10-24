import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Monitor, ShieldCheck, X } from "lucide-react";
import "./PresenceAgreement.css";

export default function PresenceAgreement({
  organizationName,
  joining = false,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  organizationName: string;
  joining?: boolean;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="presence-agreement"
      aria-labelledby="presence-agreement-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (acknowledged && !busy) onConfirm();
        }}
      >
        <div className="presence-agreement-heading">
          <span className="presence-agreement-icon">
            <ShieldCheck size={24} />
          </span>
          <button
            type="button"
            className="presence-agreement-close"
            aria-label="Close agreement"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p className="presence-agreement-eyebrow">ORGANIZATION MEMBERSHIP</p>
        <h2 id="presence-agreement-title">
          {joining
            ? `Join ${organizationName}`
            : `Continue with ${organizationName}`}
        </h2>
        <p className="presence-agreement-intro">
          Members share the following with admins:
        </p>
        <div className="presence-agreement-fact">
          <Activity size={19} />
          <div>
            <strong>Active and Away status</strong>
            <p>Active/Away while using CyberGuard.</p>
          </div>
        </div>
        <div className="presence-agreement-fact">
          <Monitor size={19} />
          <div>
            <strong>Basic device information</strong>
            <p>Approximate device type and operating system.</p>
          </div>
        </div>
        <p className="presence-agreement-note">
          Required for membership; leaving stops sharing. Browsing history,
          other apps, and typed content stay private.
        </p>
        {!joining && (
          <p className="presence-agreement-note">
            This replaces optional sharing for members. Please review and
            accept.
          </p>
        )}
        <label className="presence-agreement-check">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            disabled={busy}
            required
          />
          <span>I agree to required presence sharing.</span>
        </label>
        {error && (
          <p className="presence-agreement-error" role="alert">
            {error}
          </p>
        )}
        <div className="presence-agreement-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {joining ? "Not now" : "Cancel"}
          </button>
          <button type="submit" disabled={!acknowledged || busy}>
            {busy
              ? "Saving…"
              : joining
                ? "Agree and join"
                : "Accept and continue"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
