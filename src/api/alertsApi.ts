import { API_BASE, ApiError } from "./emailApi";

export interface AlertSettings {
  enabled: boolean;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* response wasn't JSON, fall back to statusText */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

export interface SecurityAlert {
  id: string;
  source: "website" | "email" | "link" | "file";
  threat_type: string;
  risk_level: "HIGH" | "MEDIUM";
  title: string;
  details: Record<string, unknown>;
  related_ref: string | null;
  status: "new" | "reviewed";
  detected_at: string;
  reviewed_at: string | null;
}

/** The signed-in user's alerts, newest first. */
export function listAlerts(
  accessToken: string,
  status: "new" | "reviewed" | "all" = "new",
  limit = 50,
): Promise<SecurityAlert[]> {
  const params = new URLSearchParams({ status, limit: String(limit) });
  return fetch(`${API_BASE}/api/alerts?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => readJson<SecurityAlert[]>(r));
}

/** Mark one alert reviewed, so it moves to the user's previous alerts. */
export function markAlertReviewed(accessToken: string, alertId: string): Promise<SecurityAlert> {
  return fetch(`${API_BASE}/api/alerts/${encodeURIComponent(alertId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ status: "reviewed" }),
  }).then((r) => readJson<SecurityAlert>(r));
}

/** Whether Security Alerts are switched on for the signed-in user (on by default). */
export function getAlertSettings(accessToken: string): Promise<AlertSettings> {
  return fetch(`${API_BASE}/api/alerts/settings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => readJson<AlertSettings>(r));
}

/** Turn Security Alerts on or off. Existing alerts are kept either way. */
export function updateAlertSettings(accessToken: string, enabled: boolean): Promise<AlertSettings> {
  return fetch(`${API_BASE}/api/alerts/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ enabled }),
  }).then((r) => readJson<AlertSettings>(r));
}
