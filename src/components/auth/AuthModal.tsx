import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import cyberGuardLogo from "../../assets/logo.png";

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
  const [mode, setMode] = useState<"login" | "signup">(startingMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  if (!isOpen) {
    return null;
  }

  const switchMode = (newMode: "login" | "signup") => {
    setMode(newMode);
    setEmail("");
    setPassword("");
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setError(null);
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

    const { error } = await signUp(email, password);

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess(true);
  };

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

          <h2>
            {mode === "login" ? "Sign In" : "Create Account"}
          </h2>

          <p>
            {mode === "login"
              ? "Sign in to access your CyberGuard account."
              : "Create an account to save your CyberGuard activity."}
          </p>
        </div>

        {success ? (
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

            <button
              className="auth-submit-button"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? mode === "login"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "login"
                ? "Sign In"
                : "Sign Up"}
            </button>

            <p className="auth-switch">
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}

              <button
                type="button"
                onClick={() =>
                  switchMode(
                    mode === "login" ? "signup" : "login"
                  )
                }
              >
                {mode === "login" ? "Sign Up" : "Sign In"}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default AuthModal;