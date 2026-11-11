import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  clearPasswordRecovery,
  isPasswordRecoveryActive,
  onPasswordRecovery,
  sessionIsRecovery,
} from "../lib/passwordRecovery";
import "./ResetPassword.css";

type Status = "waiting" | "ready" | "invalid" | "done";

export default function ResetPassword() {
  const [status, setStatus] = useState<Status>(() =>
    isPasswordRecoveryActive() ? "ready" : "waiting"
  );
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const markReady = () => setStatus((current) => (current === "done" ? current : "ready"));

    const stop = onPasswordRecovery(markReady);

    const client = supabase;
    if (client) {
      void client.auth.getSession().then(({ data }) => {
        if (sessionIsRecovery(data.session?.access_token)) markReady();
      });
    }

    const timer = window.setTimeout(
      () => setStatus((current) => (current === "waiting" ? "invalid" : current)),
      8000
    );

    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const client = supabase;
    if (!client) return;

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    clearPasswordRecovery();
    setStatus("done");
  };

  return (
    <div className="reset-page">
      <div className="reset-card">
        {status === "waiting" && <p>Checking your reset link...</p>}

        {status === "invalid" && (
          <>
            <h1>This reset link isn't valid</h1>
            <p>
              It may have expired or already been used. Open the sign-in window,
              choose "Forgot password?", and request a new link.
            </p>
            <Link className="reset-button" to="/dashboard">
              Back to the app
            </Link>
          </>
        )}

        {status === "ready" && (
          <form className="reset-form" onSubmit={handleSubmit}>
            <h1>Choose a new password</h1>

            {error && (
              <p className="reset-message error" role="alert">
                {error}
              </p>
            )}

            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <label>
              Confirm new password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <button className="reset-button" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save new password"}
            </button>
          </form>
        )}

        {status === "done" && (
          <>
            <h1>Your password was updated</h1>
            <p>You're signed in with your new password.</p>
            <Link className="reset-button" to="/dashboard">
              Go to the dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}