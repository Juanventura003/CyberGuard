import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { getAlertSettings, updateAlertSettings } from "../api/alertsApi";
import {
  currentPermission,
  desktopNotificationsEnabled,
  requestDesktopPermission,
  setDesktopNotificationsEnabled,
  showDesktopNotification,
  type DesktopPermission,
} from "../lib/alertNotifications";
import "./Settings.css";

const NOT_CONFIGURED = "Supabase is not configured, so this action is unavailable.";
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

interface Profile {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}

interface ProfileResult {
  userId: string;
  profile: Profile | null;
  error: string | null;
}

interface FormMessage {
  type: "success" | "error" | "notice";
  text: string;
}

interface ProfileValues {
  firstName: string;
  lastName: string;
  username: string;
}

interface ProfileFormProps {
  userId: string;
  initialFirstName: string;
  initialLastName: string;
  initialUsername: string;
  onSaved: (values: ProfileValues) => void;
}

function ProfileForm({
  userId,
  initialFirstName,
  initialLastName,
  initialUsername,
  onSaved,
}: ProfileFormProps) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [username, setUsername] = useState(initialUsername);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const client = supabase;
    if (!client) {
      setMessage({ type: "error", text: NOT_CONFIGURED });
      return;
    }

    const values: ProfileValues = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      username: username.trim(),
    };

    if (!USERNAME_PATTERN.test(values.username)) {
      setMessage({
        type: "error",
        text: "Usernames must be 3 to 20 characters and use only letters, numbers and underscores.",
      });
      return;
    }

    setSaving(true);

    const { data, error } = await client
      .from("profiles")
      .update({
        first_name: values.firstName,
        last_name: values.lastName,
        username: values.username,
      })
      .eq("id", userId)
      .select("id");

    setSaving(false);

    if (error) {
      if (error.code === "23505") {
        setMessage({ type: "error", text: "That username is already taken. Please choose another." });
      } else {
        setMessage({ type: "error", text: error.message });
      }
      return;
    }

    if (!data || data.length === 0) {
      setMessage({ type: "error", text: "No profile was found for your account, so nothing was saved." });
      return;
    }

    onSaved(values);
    setMessage({ type: "success", text: "Your profile was updated." });
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      {message && (
        <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <div className="settings-row">
        <label className="settings-field">
          <span>First name</span>
          <input
            type="text"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
          />
        </label>

        <label className="settings-field">
          <span>Last name</span>
          <input
            type="text"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
          />
        </label>
      </div>

      <label className="settings-field">
        <span>Username</span>
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={20}
          required
        />
        <span className="settings-hint">3 to 20 characters: letters, numbers and underscores.</span>
      </label>

      <button className="settings-button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}

interface EmailFormProps {
  currentEmail: string;
  pendingEmail: string | null;
}

function EmailForm({ currentEmail, pendingEmail }: EmailFormProps) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const client = supabase;
    if (!client) {
      setMessage({ type: "error", text: NOT_CONFIGURED });
      return;
    }

    const email = newEmail.trim().toLowerCase();

    if (email === currentEmail.toLowerCase()) {
      setMessage({ type: "error", text: "That is already your email address." });
      return;
    }

    setSaving(true);

    const { error: verifyError } = await client.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });

    if (verifyError) {
      setSaving(false);
      setMessage({ type: "error", text: "Your current password is incorrect." });
      return;
    }

    const { error: updateError } = await client.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/settings` }
    );

    setSaving(false);

    if (updateError) {
      setMessage({ type: "error", text: updateError.message });
      return;
    }

    setNewEmail("");
    setCurrentPassword("");
    setMessage({
      type: "success",
      text: "Confirmation links were sent. Your email will change once you confirm. Check the inbox of the new address, and your current one too.",
    });
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      {pendingEmail && (
        <p className="settings-message notice" role="status">
          A change to {pendingEmail} is waiting for confirmation.
        </p>
      )}
      {message && (
        <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <label className="settings-field">
        <span>New email address</span>
        <input
          type="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="settings-field">
        <span>Current password</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <button className="settings-button" type="submit" disabled={saving}>
        {saving ? "Sending..." : "Change email"}
      </button>
    </form>
  );
}

interface PasswordFormProps {
  email: string;
}

function PasswordForm({ email }: PasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const client = supabase;
    if (!client) {
      setMessage({ type: "error", text: NOT_CONFIGURED });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords don't match." });
      return;
    }

    if (newPassword === currentPassword) {
      setMessage({ type: "error", text: "Your new password must be different from your current one." });
      return;
    }

    setSaving(true);

    const { error: verifyError } = await client.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyError) {
      setSaving(false);
      setMessage({ type: "error", text: "Your current password is incorrect." });
      return;
    }

    const { error: updateError } = await client.auth.updateUser({ password: newPassword });

    setSaving(false);

    if (updateError) {
      setMessage({ type: "error", text: updateError.message });
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage({ type: "success", text: "Your password was changed." });
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      {message && (
        <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <label className="settings-field">
        <span>Current password</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <label className="settings-field">
        <span>New password</span>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>

      <label className="settings-field">
        <span>Confirm new password</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>

      <button className="settings-button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Change password"}
      </button>
    </form>
  );
}

interface SecurityAlertsSettingsProps {
  accessToken: string;
}

const BLOCKED_HELP =
  "Notifications are blocked for CyberGuard in this browser. To allow them, click the icon to the left of the address bar, set Notifications to Allow, then reload this page.";

/** Desktop pop-up switch. Saved per browser, since permission is per browser. */
function DesktopNotificationsToggle({ alertsEnabled }: { alertsEnabled: boolean }) {
  const [permission, setPermission] = useState<DesktopPermission>(currentPermission);
  const [on, setOn] = useState(() => desktopNotificationsEnabled() && currentPermission() === "granted");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(() =>
    desktopNotificationsEnabled() && currentPermission() === "denied"
      ? { type: "error", text: BLOCKED_HELP }
      : null
  );

  const sendTest = () => {
    const shown = showDesktopNotification(
      "✅ CyberGuard notifications are working",
      "You'll get a pop-up like this when a scan finds a high-risk threat.",
      // A new tag each time: reusing one makes Windows silently replace the
      // previous test notification instead of popping up a new one.
      `cyberguard-test-${Date.now()}`
    );
    setMessage(
      shown
        ? {
            type: "success",
            text: "Test notification sent. If you didn't see it, make sure your computer allows notifications from your browser (Windows: Settings → System → Notifications; Mac: System Settings → Notifications) and that Do Not Disturb is off.",
          }
        : { type: "error", text: "Your browser couldn't show a notification." }
    );
  };

  const toggle = async () => {
    if (busy) return;
    setMessage(null);

    if (on) {
      setDesktopNotificationsEnabled(false);
      setOn(false);
      setMessage({ type: "success", text: "Desktop notifications are off in this browser." });
      return;
    }

    setBusy(true);
    const result = await requestDesktopPermission(); // shows the browser's Allow / Block prompt
    setPermission(result);
    setBusy(false);

    if (result === "granted") {
      setDesktopNotificationsEnabled(true);
      setOn(true);
      sendTest();
    } else if (result === "denied") {
      setDesktopNotificationsEnabled(false);
      setMessage({ type: "error", text: BLOCKED_HELP });
    } else if (result === "unsupported") {
      setMessage({ type: "error", text: "This browser doesn't support desktop notifications." });
    } else {
      setMessage({
        type: "notice",
        text: "The permission prompt was closed without a choice. Click the switch again and choose Allow.",
      });
    }
  };

  const unsupported = permission === "unsupported";
  const disabled = busy || unsupported || !alertsEnabled;
  const stateText = unsupported
    ? "Not supported in this browser"
    : !alertsEnabled
      ? "Turn on Security alerts first"
      : permission === "denied"
        ? "Blocked by your browser"
        : on
          ? "On in this browser (while a CyberGuard tab is open)"
          : "Off";

  return (
    <>
      <div className="settings-toggle-row">
        <div>
          <span className="settings-toggle-label" id="desktop-notifications-label">
            Desktop notifications
          </span>
          <span className="settings-toggle-state">{stateText}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on && alertsEnabled}
          aria-labelledby="desktop-notifications-label"
          className={`settings-switch ${on && alertsEnabled ? "on" : ""}`}
          onClick={toggle}
          disabled={disabled}
        >
          <span className="settings-switch-knob" />
        </button>
      </div>

      {on && alertsEnabled && (
        <button className="settings-button secondary" type="button" onClick={sendTest}>
          Send test notification
        </button>
      )}

      {message && (
        <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </>
  );
}

/** On/off switch for Security Alerts. Saves as soon as it is clicked. */
function SecurityAlertsSettings({ accessToken }: SecurityAlertsSettingsProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAlertSettings(accessToken)
      .then((settings) => {
        if (cancelled) return;
        setEnabled(settings.enabled);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Could not load your alert settings.");
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  const retry = () => {
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  const toggle = async () => {
    if (enabled === null || saving) return;
    const next = !enabled;

    setSaving(true);
    setMessage(null);
    setEnabled(next); // update the switch right away, undo if saving fails

    try {
      const saved = await updateAlertSettings(accessToken, next);
      setEnabled(saved.enabled);
      setMessage({
        type: "success",
        text: saved.enabled
          ? "Security alerts are on. Risky scan results will create alerts."
          : "Security alerts are off. Scans still work, but no new alerts will be created.",
      });
    } catch (err) {
      setEnabled(!next);
      setMessage({
        type: "error",
        text: err instanceof Error ? `Could not save: ${err.message}` : "Could not save your alert setting.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-card">
      <h2>Security alerts</h2>
      <p className="settings-card-desc">
        Get an alert when a scan finds a high-risk website, phishing email or dangerous file.
        Turning this off doesn't delete alerts you already have.
      </p>

      {loadError ? (
        <div className="settings-form">
          <p className="settings-message error" role="alert">
            Could not load your alert settings: {loadError}
          </p>
          <button className="settings-button" type="button" onClick={retry}>
            Try again
          </button>
        </div>
      ) : enabled === null ? (
        <p className="settings-empty">Loading your alert settings...</p>
      ) : (
        <div className="settings-form">
          <div className="settings-toggle-row">
            <div>
              <span className="settings-toggle-label" id="security-alerts-label">
                Security alerts
              </span>
              <span className="settings-toggle-state">{enabled ? "On" : "Off"}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby="security-alerts-label"
              className={`settings-switch ${enabled ? "on" : ""}`}
              onClick={toggle}
              disabled={saving}
            >
              <span className="settings-switch-knob" />
            </button>
          </div>

          {message && (
            <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}

          <DesktopNotificationsToggle alertsEnabled={enabled} />
        </div>
      )}
    </section>
  );
}

function Settings() {
  const { user, session, loading: authLoading } = useAuth();
  const [result, setResult] = useState<ProfileResult | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!user || !client) return;
    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await client
        .from("profiles")
        .select("first_name, last_name, username")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;
      setResult({ userId: user.id, profile: data, error: error?.message ?? null });
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleProfileSaved = (values: ProfileValues) => {
    setResult((previous) =>
      previous
        ? {
            ...previous,
            profile: {
              first_name: values.firstName,
              last_name: values.lastName,
              username: values.username,
            },
          }
        : previous
    );
  };

  if (!supabase) {
    return (
      <div className="settings">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">
          Account settings are unavailable because Supabase is not configured.
        </p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="settings">
        <p className="settings-empty">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="settings">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">Sign in to manage your account settings.</p>
      </div>
    );
  }

  const loadingProfile = result?.userId !== user.id;
  const profile = result?.profile ?? null;
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  return (
    <div className="settings">
      <h1 className="settings-title">Settings</h1>
      <p className="settings-subtitle">Manage your account details and security.</p>

      <section className="settings-card">
        <h2>Account information</h2>
        <p className="settings-card-desc">The details saved on your CyberGuard account.</p>

        {loadingProfile && <p className="settings-empty">Loading your profile...</p>}
        {result?.error && (
          <p className="settings-message error" role="alert">
            Could not load your profile: {result.error}
          </p>
        )}

        {!loadingProfile && !result?.error && (
          <dl className="settings-info">
            <div>
              <dt>Name</dt>
              <dd>{fullName || "Not set"}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{profile?.username || "Not set"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>
        )}
      </section>

      {session?.access_token && <SecurityAlertsSettings accessToken={session.access_token} />}

      {!loadingProfile && !result?.error && profile && (
        <section className="settings-card">
          <h2>Profile</h2>
          <p className="settings-card-desc">Update your name and username.</p>
          <ProfileForm
            key={user.id}
            userId={user.id}
            initialFirstName={profile.first_name ?? ""}
            initialLastName={profile.last_name ?? ""}
            initialUsername={profile.username ?? ""}
            onSaved={handleProfileSaved}
          />
        </section>
      )}

      <section className="settings-card">
        <h2>Email address</h2>
        <p className="settings-card-desc">You will need to confirm the new address before it takes effect.</p>
        <EmailForm currentEmail={user.email ?? ""} pendingEmail={user.new_email ?? null} />
      </section>

      <section className="settings-card">
        <h2>Password</h2>
        <p className="settings-card-desc">Choose a strong password that you don't use anywhere else.</p>
        <PasswordForm email={user.email ?? ""} />
      </section>
    </div>
  );
}

export default Settings;