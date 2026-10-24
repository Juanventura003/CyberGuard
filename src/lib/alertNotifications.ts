/**
 * Windows / macOS desktop notifications for Security Alerts, using the
 * browser's built-in Notification API (no extension needed).
 *
 * The on/off choice is saved per browser in localStorage, because
 * notification permission is granted per browser and device too.
 */

const PREF_KEY = "cyberguard.desktopNotifications";
/** Fired on window when the preference changes, so open listeners update. */
export const DESKTOP_PREF_EVENT = "cyberguard-desktop-notifications-changed";

export type DesktopPermission = "unsupported" | "default" | "granted" | "denied";

export interface AlertForNotification {
  id: string;
  title: string;
  risk_level: string;
  source: string;
  threat_type: string;
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentPermission(): DesktopPermission {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export function desktopNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(PREF_KEY, "on");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage blocked: the choice just won't be remembered */
  }
  window.dispatchEvent(new Event(DESKTOP_PREF_EVENT));
}

/** Must be called from a click; browsers ignore requests made on page load. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

const SOURCE_LABEL: Record<string, string> = {
  website: "Website Tracker",
  email: "Email Scanner",
  file: "File checker",
  link: "Link checker",
};

/** Human-readable name of the feature that found an alert. */
export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? "CyberGuard";
}

/**
 * Show a desktop notification. Returns false if it couldn't be shown
 * (unsupported, no permission, or the browser refused).
 */
export function showDesktopNotification(title: string, body: string, tag?: string): boolean {
  if (currentPermission() !== "granted") return false;
  try {
    const notification = new Notification(title, {
      body,
      icon: "/logo.png", // PNG: Windows notifications don't show SVG icons
      // Same tag = the OS replaces instead of stacking, so an alert seen
      // by two open CyberGuard tabs still pops up only once. Callers must use
      // a fresh tag for anything that should pop up again (e.g. tests).
      tag,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    // Some browsers (e.g. Chrome on Android) only allow notifications
    // from a service worker and throw here.
    return false;
  }
}

export function notifyAlert(alert: AlertForNotification): boolean {
  if (!desktopNotificationsEnabled()) return false;
  const level = alert.risk_level === "HIGH" ? "High risk" : "Medium risk";
  const where = SOURCE_LABEL[alert.source] ?? "CyberGuard";
  return showDesktopNotification(
    `⚠️ CyberGuard: ${level}`,
    `${alert.title}\nFound by ${where}.`,
    `cyberguard-alert-${alert.id}`,
  );
}
