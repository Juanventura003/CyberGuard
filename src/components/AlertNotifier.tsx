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
/** A saved alert for a page visited this recently is the same event. */
const SAME_EVENT_MS = 2 * 60_000;

/** Where "View" takes the user for each kind of alert. */
const SOURCE_PAGE: Record<string, string> = {
  website: "/website-tracker",
  email: "/email-scanner",
  file: "/security-checker",
  link: "/security-checker",
};

interface Toast {
  /** Stable while on screen, even when a visit card is upgraded to its alert. */
  key: string;
  /** "visit": reported live by the extension; "alert": a saved Security Alert. */
  kind: "visit" | "alert";
  alert: SecurityAlert;
  reviewing: boolean;
  error: string | null;
}

/** What the extension sends for each risky website visit. */
interface RiskyVisit {
  url: string;
  domain: string;
  riskLevel: "HIGH_RISK" | "SUSPICIOUS";
  riskScore: number | null;
  threatTypes: string[];
  explanation: string[];
  visitedAt: string;
}

interface AlertNotifierProps {
  userId: string;
  accessToken: string;
}

function isRiskyVisit(value: unknown): value is RiskyVisit {
  const v = value as Partial<RiskyVisit> | null;
  return (
    !!v &&
    typeof v.url === "string" &&
    typeof v.domain === "string" &&
    (v.riskLevel === "HIGH_RISK" || v.riskLevel === "SUSPICIOUS")
  );
}

/** Present a live visit in the same shape as a saved alert. */
function visitToAlert(visit: RiskyVisit, key: string): SecurityAlert {
  const high = visit.riskLevel === "HIGH_RISK";
  const visitedAt = Date.parse(visit.visitedAt);
  return {
    id: key,
    source: "website",
    threat_type:
      visit.threatTypes?.find(Boolean) ?? (high ? "MALICIOUS_WEBSITE" : "SUSPICIOUS_WEBSITE"),
    risk_level: high ? "HIGH" : "MEDIUM",
    title: `${high ? "Dangerous" : "Suspicious"} website: ${visit.domain}`,
    details: {
      url: visit.url,
      risk_score: visit.riskScore,
      explanation: Array.isArray(visit.explanation) ? visit.explanation : [],
    },
    related_ref: visit.url,
    status: "new",
    detected_at: new Date(Number.isNaN(visitedAt) ? Date.now() : visitedAt).toISOString(),
    reviewed_at: null,
  };
}

function alertUrl(alert: SecurityAlert): string | null {
  const url = (alert.details as { url?: unknown }).url;
  return alert.source === "website" && typeof url === "string" ? url : null;
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
 * Runs on every page while signed in and shows in-app pop-ups for:
 *  - every risky website visit the extension reports to this tab, and
 *  - new Security Alerts (emails, files, websites from any device),
 * plus a desktop notification for alerts if switched on in Settings.
 * A visit and the alert it creates show as one card.
 */
export default function AlertNotifier({ userId, accessToken }: AlertNotifierProps) {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());
  /** URL -> {when, toast key} for visits reported by the extension on this device. */
  const recentVisits = useRef(new Map<string, { at: number; key: string }>());

  // Supabase refreshes the access token about every hour; keep the latest
  // without restarting the listener.
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(key);
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  const addToast = useCallback(
    (key: string, kind: Toast["kind"], alert: SecurityAlert) => {
      setToasts((current) =>
        [
          { key, kind, alert, reviewing: false, error: null },
          ...current.filter((toast) => toast.key !== key),
        ].slice(0, MAX_TOASTS)
      );
      if (alert.risk_level !== "HIGH") {
        timers.current.set(key, window.setTimeout(() => dismiss(key), MEDIUM_TOAST_MS));
      }
    },
    [dismiss]
  );

  /** A visit reported live by the extension on this device. */
  const showVisit = useCallback(
    (visit: RiskyVisit) => {
      const now = Date.now();
      const previous = recentVisits.current.get(visit.url);
      // Its saved alert already showed a card moments ago: same event.
      if (previous && previous.key.startsWith("alert:") && now - previous.at < SAME_EVENT_MS) return;
      const key = `visit:${visit.url}:${now}`;
      recentVisits.current.set(visit.url, { at: now, key });
      addToast(key, "visit", visitToAlert(visit, key));
    },
    [addToast]
  );

  /** A saved alert. Returns false if it belongs to a visit already shown here. */
  const showAlert = useCallback(
    (alert: SecurityAlert): boolean => {
      const url = alertUrl(alert);
      const visit = url ? recentVisits.current.get(url) : undefined;
      if (url && visit && Date.now() - visit.at < SAME_EVENT_MS && visit.key.startsWith("visit:")) {
        // Upgrade the visit's card in place, so "Mark as reviewed" works.
        setToasts((current) =>
          current.map((toast) =>
            toast.key === visit.key ? { ...toast, kind: "alert", alert } : toast
          )
        );
        return false;
      }
      const key = `alert:${alert.id}`;
      if (url) recentVisits.current.set(url, { at: Date.now(), key });
      addToast(key, "alert", alert);
      return true;
    },
    [addToast]
  );

  // The listeners below are set up once per user; read the latest callbacks.
  const showVisitRef = useRef(showVisit);
  const showAlertRef = useRef(showAlert);
  useEffect(() => {
    showVisitRef.current = showVisit;
    showAlertRef.current = showAlert;
  }, [showVisit, showAlert]);

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
      const isNew = showAlertRef.current(alert); // in-app pop-up
      // Desktop pop-up (if on in Settings). A visit on this device already got
      // one from the extension, so don't pop up twice.
      if (isNew) notifyAlert(alert);
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

    // Risky visits, passed on by the extension's script in this tab.
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; visit?: unknown } | null;
      if (data?.type === "CYBERGUARD_RISKY_VISIT" && isRiskyVisit(data.visit)) {
        showVisitRef.current(data.visit);
      }
    };
    window.addEventListener("message", onWindowMessage);

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
      window.removeEventListener("message", onWindowMessage);
      pendingTimers.forEach((timer) => window.clearTimeout(timer));
      pendingTimers.clear();
      if (client && channel) void client.removeChannel(channel);
    };
  }, [userId]);

  const review = async (key: string, alertId: string) => {
    setToasts((current) =>
      current.map((toast) => (toast.key === key ? { ...toast, reviewing: true, error: null } : toast))
    );
    try {
      await markAlertReviewed(tokenRef.current, alertId);
      dismiss(key);
    } catch {
      setToasts((current) =>
        current.map((toast) =>
          toast.key === key ? { ...toast, reviewing: false, error: "Couldn't save. Try again." } : toast
        )
      );
    }
  };

  const view = (key: string, alert: SecurityAlert) => {
    dismiss(key);
    navigate(SOURCE_PAGE[alert.source] ?? "/dashboard");
  };

  return (
    <div className="alert-toasts" aria-live="polite" aria-label="Security alert notifications">
      {toasts.map(({ key, kind, alert, reviewing, error }) => {
        const high = alert.risk_level === "HIGH";
        const reason = firstReason(alert);
        const time = detectedTime(alert);
        return (
          <div
            key={key}
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
                onClick={() => dismiss(key)}
              >
                ×
              </button>
            </div>

            <p className="alert-toast-title">{alert.title}</p>
            {reason && <p className="alert-toast-reason">{reason}</p>}
            {error && <p className="alert-toast-error">{error}</p>}

            <div className="alert-toast-actions">
              <button type="button" className="alert-toast-btn primary" onClick={() => view(key, alert)}>
                View
              </button>
              {/* A live visit isn't a saved alert (yet), so there's nothing to review. */}
              {kind === "alert" && (
                <button
                  type="button"
                  className="alert-toast-btn"
                  onClick={() => void review(key, alert.id)}
                  disabled={reviewing}
                >
                  {reviewing ? "Saving…" : "Mark as reviewed"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
