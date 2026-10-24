import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { listAlerts, markAlertReviewed, type SecurityAlert } from "../api/alertsApi";
import { notifyAlert, sourceLabel } from "../lib/alertNotifications";
import "./AlertNotifier.css";

/** Backup check in case the live connection drops. */
const POLL_MS = 30_000;
/** At most this many pop-ups on screen; older ones are replaced. */
const MAX_TOASTS = 3;
/** Medium-risk pop-ups close on their own; high-risk ones stay until closed. */
const MEDIUM_TOAST_MS = 10_000;

/** Where "View" takes the user for each kind of alert. */
const SOURCE_PAGE: Record<string, string> = {
  website: "/website-tracker",
  email: "/email-scanner",
  file: "/security-checker",
  link: "/security-checker",
};

interface Toast {
  alert: SecurityAlert;
  reviewing: boolean;
  error: string | null;
}

interface AlertNotifierProps {
  userId: string;
  accessToken: string;
}

function firstReason(alert: SecurityAlert): string | null {
  const { explanation, reasons } = alert.details as { explanation?: unknown; reasons?: unknown };
  const list = Array.isArray(explanation) ? explanation : Array.isArray(reasons) ? reasons : [];
  const reason = list.find((item) => typeof item === "string" && item.trim());
  return typeof reason === "string" ? reason : null;
}

function detectedTime(alert: SecurityAlert): string {
  const date = new Date(alert.detected_at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Runs on every page while signed in. When a new Security Alert is created
 * for this user, it shows a pop-up inside CyberGuard, plus a desktop
 * notification if the user turned those on in Settings.
 */
export default function AlertNotifier({ userId, accessToken }: AlertNotifierProps) {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  // Supabase refreshes the access token about every hour; keep the latest
  // without restarting the listener.
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const dismiss = useCallback((alertId: string) => {
    const timer = timers.current.get(alertId);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(alertId);
    setToasts((current) => current.filter((toast) => toast.alert.id !== alertId));
  }, []);

  const showToast = useCallback(
    (alert: SecurityAlert) => {
      setToasts((current) =>
        [
          { alert, reviewing: false, error: null },
          ...current.filter((toast) => toast.alert.id !== alert.id),
        ].slice(0, MAX_TOASTS)
      );
      if (alert.risk_level !== "HIGH") {
        timers.current.set(
          alert.id,
          window.setTimeout(() => dismiss(alert.id), MEDIUM_TOAST_MS)
        );
      }
    },
    [dismiss]
  );

  // The listener below is set up once per user; read the latest callback.
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    // Alerts already shown or already existing, so nothing pops up twice.
    const seen = new Set<string>();
    // Until the first successful check, existing alerts are only recorded,
    // so opening CyberGuard doesn't pop up old alerts.
    let primed = false;

    const handle = (alert: SecurityAlert) => {
      if (!alert?.id || seen.has(alert.id)) return;
      seen.add(alert.id);
      showToastRef.current(alert); // in-app pop-up
      notifyAlert(alert); // desktop pop-up, only if switched on in Settings
    };

    const poll = async () => {
      try {
        const alerts = await listAlerts(tokenRef.current, "new", 20);
        if (cancelled) return;
        if (!primed) {
          alerts.forEach((alert) => seen.add(alert.id));
          primed = true;
          return;
        }
        // Oldest first, so several new alerts appear in order.
        [...alerts].reverse().forEach(handle);
      } catch {
        // Backend unreachable or signed out: try again on the next check.
      }
    };

    // Live updates: Supabase Realtime sends each new security_alerts row
    // for this user (row-level security limits it to their own alerts).
    const client = supabase;
    const channel = client
      ?.channel(`security-alerts-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "security_alerts",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => handle(payload.new as SecurityAlert)
      )
      .subscribe();

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    const pendingTimers = timers.current;

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      pendingTimers.forEach((timer) => window.clearTimeout(timer));
      pendingTimers.clear();
      if (client && channel) void client.removeChannel(channel);
    };
  }, [userId]);

  const review = async (alertId: string) => {
    setToasts((current) =>
      current.map((toast) =>
        toast.alert.id === alertId ? { ...toast, reviewing: true, error: null } : toast
      )
    );
    try {
      await markAlertReviewed(tokenRef.current, alertId);
      dismiss(alertId);
    } catch {
      setToasts((current) =>
        current.map((toast) =>
          toast.alert.id === alertId
            ? { ...toast, reviewing: false, error: "Couldn't save. Try again." }
            : toast
        )
      );
    }
  };

  const view = (alert: SecurityAlert) => {
    dismiss(alert.id);
    navigate(SOURCE_PAGE[alert.source] ?? "/dashboard");
  };

  return (
    <div className="alert-toasts" aria-live="polite" aria-label="Security alert notifications">
      {toasts.map(({ alert, reviewing, error }) => {
        const high = alert.risk_level === "HIGH";
        const reason = firstReason(alert);
        const time = detectedTime(alert);
        return (
          <div
            key={alert.id}
            className={`alert-toast ${high ? "high" : "medium"}`}
            role={high ? "alert" : "status"}
          >
            <div className="alert-toast-head">
              <span className="alert-toast-badge">{high ? "High risk" : "Medium risk"}</span>
              <span className="alert-toast-meta">
                {sourceLabel(alert.source)}
                {time && ` · ${time}`}
              </span>
              <button
                type="button"
                className="alert-toast-close"
                aria-label="Dismiss alert"
                onClick={() => dismiss(alert.id)}
              >
                ×
              </button>
            </div>

            <p className="alert-toast-title">{alert.title}</p>
            {reason && <p className="alert-toast-reason">{reason}</p>}
            {error && <p className="alert-toast-error">{error}</p>}

            <div className="alert-toast-actions">
              <button type="button" className="alert-toast-btn primary" onClick={() => view(alert)}>
                View
              </button>
              <button
                type="button"
                className="alert-toast-btn"
                onClick={() => void review(alert.id)}
                disabled={reviewing}
              >
                {reviewing ? "Saving…" : "Mark as reviewed"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
