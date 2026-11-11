import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import "../../lib/passwordRecovery";
import cyberGuardLogo from "../../assets/logo.png";

type AuthMode = "login" | "signup" | "forgot";

type AuthModalProps = {
  isOpen: boolean;
  onClose: () => void;
  startingMode?: "login" | "signup";
};

function AuthModal({
  isOpen,
  onClose,
  startingMode = "login",
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(startingMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  if (!isOpen) {
    return null;
  }

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setFirstName("");
    setLastName("");
    setEmail("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    setResetSent(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setError(null);

    if (mode === "forgot") {
      const client = supabase;
      if (!client) {
        setError("Password reset is unavailable because Supabase is not configured.");
        return;
      }

      setSubmitting(true);
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setSubmitting(false);

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setResetSent(true);
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);

    if (mode === "login") {
      const { error } = await signIn(email, password);

      setSubmitting(false);

      if (error) {
        setError(error.message);
        return;
      }

      onClose();
      navigate("/dashboard");
      return;
    }

    const { error } = await signUp(email, password, { username, firstName, lastName });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess(true);
  };

  const title =
    mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Reset Password";

  const subtitle =
    mode === "login"
      ? "Sign in to access your CyberGuard account."
      : mode === "signup"
        ? "Create an account to save your CyberGuard activity."
        : "Enter your email and we'll send you a link to choose a new password.";

  const submitLabel = submitting
    ? mode === "login"
      ? "Signing in..."
      : mode === "signup"
        ? "Creating account..."
        : "Sending..."
    : mode === "login"
      ? "Sign In"
      : mode === "signup"
        ? "Sign Up"
        : "Send reset link";

  const switchPrompt =
    mode === "login"
      ? "Don't have an account?"
      : mode === "signup"
        ? "Already have an account?"
        : "Remembered your password?";

  const switchTarget: AuthMode = mode === "login" ? "signup" : "login";
  const switchLabel = mode === "login" ? "Sign Up" : "Sign In";

  return (
    <div className="auth-modal-overlay">
      <div className="auth-modal">
        <button
          className="auth-modal-close"
          onClick={onClose}
          type="button"
        >
          <X size={20} />
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-icon">
            <img src={cyberGuardLogo} alt="CyberGuard logo" />
          </div>

          <h2>{title}</h2>

          <p>{subtitle}</p>
        </div>

        {resetSent ? (
          <div className="auth-success">
            <h3>Check your email</h3>

            <p>
              If an account exists for <strong>{email}</strong>, we sent a link
              to reset your password. The link expires after a short time.
            </p>

            <button
              className="auth-submit-button"
              type="button"
              onClick={() => switchMode("login")}
            >
              Back to Sign In
            </button>
          </div>
        ) : success ? (
          <div className="auth-success">
            <h3>Check your email</h3>

            <p>
              We sent a confirmation link to <strong>{email}</strong>.
              Confirm your account, then return here to sign in.
            </p>

            <button
              className="auth-submit-button"
              type="button"
              onClick={() => switchMode("login")}
            >
              Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            {error && (
              <div className="auth-error">
                {error}
              </div>
            )}

            {mode === "signup" && (
              <>
                <label>
                  First Name
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Enter your first name"
                    required
                  />
                </label>

                <label>
                  Last Name
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Enter your last name"
                    required
                  />
                </label>

                <label>
                  Username
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Choose a username"
                    required
                  />
                </label>
              </>
            )}

            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email"
                required
              />
            </label>

            {mode !== "forgot" && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  minLength={mode === "signup" ? 6 : undefined}
                  required
                />
              </label>
            )}

            {mode === "signup" && (
              <label>
                Confirm Password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm your password"
                  minLength={6}
                  required
                />
              </label>
            )}

            {mode === "login" && (
              <p className="auth-switch">
                <button type="button" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              </p>
            )}

            <button
              className="auth-submit-button"
              type="submit"
              disabled={submitting}
            >
              {submitLabel}
            </button>

            <p className="auth-switch">
              {switchPrompt}

              <button type="button" onClick={() => switchMode(switchTarget)}>
                {switchLabel}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default AuthModal;