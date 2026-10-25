"""
Security alerts.

  1. Rules: which scan results raise an alert (website_alert, email_alert, file_alert).
  2. Storage: saving alerts to the Supabase `security_alerts` table, skipping
     duplicates of the same event and respecting the user's
     `notification_preferences`.
  3. API: /api/alerts endpoints for listing alerts and marking them reviewed.

Alert creation is best-effort and runs after the scan response has been sent,
so a missing table, an expired login or a Supabase outage never breaks a scan.
"""
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Path, Query
from pydantic import BaseModel

from . import supabase_store
from .config import settings

logger = logging.getLogger(__name__)

AlertRisk = Literal["HIGH", "MEDIUM"]
ALERT_SOURCES = ("website", "email", "link", "file")
RISK_RANK = {"MEDIUM": 1, "HIGH": 2}

# Used when a user has not saved any notification preferences yet.
# Matches the column defaults in the notification_preferences table.
DEFAULT_PREFERENCES: dict[str, Any] = {
    # The Settings page "Security alerts" on/off switch.
    "in_app_enabled": True,
    "min_risk_level": "HIGH",
    "alert_sources": list(ALERT_SOURCES),
}


# ---------------------------------------------------------------------------
# 1. Rules: which findings qualify for an alert
# ---------------------------------------------------------------------------

# Website Tracker / extension (website_analyzer risk levels)
WEBSITE_RISK = {"HIGH_RISK": "HIGH", "SUSPICIOUS": "MEDIUM"}
# Email Scanner (phishing_detector classifications)
EMAIL_RISK = {"PHISHING": "HIGH", "SUSPICIOUS": "MEDIUM"}
# File checker and Gmail attachment scans (file_checker classifications)
FILE_RISK = {"HIGH RISK": "HIGH", "SUSPICIOUS": "MEDIUM"}


def _fingerprint(*parts: Any) -> str:
    """Short stable hash used in dedupe keys."""
    joined = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:32]


def _normalize_url(url: str) -> str:
    """Host + path, so tracking query strings don't create separate alerts."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    path = parts.path.rstrip("/") or "/"
    return f"{host}{path}"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def website_alert(
    result: dict[str, Any],
    history_id: str | None = None,
    detected_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Alert for a website analysis result, or None if it doesn't qualify."""
    level = WEBSITE_RISK.get(result.get("risk_level", ""))
    if not level:
        return None

    url = result.get("url", "")
    domain = result.get("domain") or urlsplit(url).hostname or url
    threats = [t for t in (result.get("threat_types") or []) if t]
    threat_type = threats[0] if threats else (
        "MALICIOUS_WEBSITE" if level == "HIGH" else "SUSPICIOUS_WEBSITE"
    )
    # The same site + threat alerts at most once per day, so a revisit
    # tomorrow is a new event but reloading the page today is not.
    day = (detected_at or _utc_now()).date().isoformat()

    return {
        "source": "website",
        "threat_type": threat_type,
        "risk_level": level,
        "title": f"{'Dangerous' if level == 'HIGH' else 'Suspicious'} website: {domain}",
        "details": {
            "url": url,
            "domain": domain,
            "risk_score": result.get("risk_score"),
            "threat_types": threats,
            "explanation": list(result.get("explanation") or []),
            "history_id": history_id,
        },
        "related_ref": history_id or url,
        "dedupe_key": f"website:{_fingerprint(_normalize_url(url), threat_type, day)}",
    }


def email_alert(
    result: dict[str, Any],
    gmail_message_id: str | None = None,
    body: str = "",
) -> dict[str, Any] | None:
    """Alert for an Email Scanner result, or None if it doesn't qualify."""
    level = EMAIL_RISK.get(result.get("classification", ""))
    if not level or result.get("error"):
        return None

    sender = result.get("sender") or "(unknown sender)"
    subject = result.get("subject") or "(no subject)"
    if gmail_message_id:
        event = f"gmail:{gmail_message_id}"
    else:
        # Pasted emails have no id, so the same content counts as the same event.
        event = f"manual:{_fingerprint(sender, subject, body)}"

    return {
        "source": "email",
        "threat_type": "PHISHING_EMAIL" if level == "HIGH" else "SUSPICIOUS_EMAIL",
        "risk_level": level,
        "title": f"{'Phishing' if level == 'HIGH' else 'Suspicious'} email from {sender}",
        "details": {
            "sender": sender,
            "subject": subject,
            "risk_score": result.get("risk_score"),
            "confidence": result.get("confidence"),
            "classification": result.get("classification"),
            "explanation": list(result.get("explanation") or []),
            "gmail_message_id": gmail_message_id,
        },
        "related_ref": gmail_message_id,
        "dedupe_key": f"email:{event}",
    }


def file_alert(
    result: dict[str, Any],
    origin: Literal["upload", "gmail_attachment"] = "upload",
    gmail_message_id: str | None = None,
) -> dict[str, Any] | None:
    """Alert for a file checker result, or None if it doesn't qualify."""
    level = FILE_RISK.get(result.get("classification", ""))
    sha256 = result.get("sha256")
    if not level or not sha256:
        return None

    filename = result.get("filename") or "(unnamed file)"
    return {
        "source": "file",
        "threat_type": "MALICIOUS_FILE" if level == "HIGH" else "SUSPICIOUS_FILE",
        "risk_level": level,
        "title": f"{'Dangerous' if level == 'HIGH' else 'Suspicious'} file: {filename}",
        "details": {
            "filename": filename,
            "sha256": sha256,
            "file_size": result.get("file_size"),
            "risk_score": result.get("risk_score"),
            "classification": result.get("classification"),
            "reasons": list(result.get("reasons") or []),
            "origin": origin,
            "gmail_message_id": gmail_message_id,
        },
        "related_ref": sha256,
        # The same file contents count as the same event wherever they came from.
        "dedupe_key": f"file:{sha256}",
    }


def passes_preferences(alert: dict[str, Any], preferences: dict[str, Any]) -> bool:
    """True if alerts are switched on and the user wants this source and risk level."""
    if preferences.get("in_app_enabled") is False:
        return False
    sources = preferences.get("alert_sources") or DEFAULT_PREFERENCES["alert_sources"]
    minimum = preferences.get("min_risk_level") or DEFAULT_PREFERENCES["min_risk_level"]
    return (
        alert["source"] in sources
        and RISK_RANK.get(alert["risk_level"], 0) >= RISK_RANK.get(minimum, RISK_RANK["HIGH"])
    )


# ---------------------------------------------------------------------------
# 2. Storage (Supabase REST, service-role key, same pattern as supabase_store)
# ---------------------------------------------------------------------------

class AlertStoreError(RuntimeError):
    pass


def _rest_url(table: str) -> str:
    return f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"


def _headers(prefer: str | None = None) -> dict[str, str]:
    headers = supabase_store._service_headers()
    if prefer:
        headers["Prefer"] = prefer
    return headers


def get_preferences(user_id: str) -> dict[str, Any]:
    response = httpx.get(
        _rest_url("notification_preferences"),
        params={"select": "in_app_enabled,min_risk_level,alert_sources", "user_id": f"eq.{user_id}"},
        headers=_headers(),
        timeout=10,
    )
    if not response.is_success:
        raise AlertStoreError(f"Could not read notification preferences ({response.status_code}).")
    rows = response.json()
    return {**DEFAULT_PREFERENCES, **rows[0]} if rows else dict(DEFAULT_PREFERENCES)


def save_alerts(user_id: str, alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert alerts, silently skipping any whose dedupe_key already exists for
    this user. Returns only the alerts that were actually created."""
    detected_at = _utc_now().isoformat()
    unique: dict[str, dict[str, Any]] = {}
    for alert in alerts:
        unique.setdefault(alert["dedupe_key"], {"user_id": user_id, "detected_at": detected_at, **alert})
    if not unique:
        return []

    response = httpx.post(
        _rest_url("security_alerts"),
        params={"on_conflict": "user_id,dedupe_key"},
        json=list(unique.values()),
        headers=_headers("resolution=ignore-duplicates,return=representation"),
        timeout=10,
    )
    if not response.is_success:
        detail = response.text[:240].replace("\n", " ")
        raise AlertStoreError(f"Could not save security alerts ({response.status_code}): {detail}")
    return response.json()


def record_alerts_for_user(user_id: str | None, alerts: list[dict[str, Any] | None]) -> None:
    """Best-effort: apply preferences and save. Never raises."""
    candidates = [alert for alert in alerts if alert]
    if not user_id or not candidates or not supabase_store.is_configured():
        return
    try:
        preferences = get_preferences(user_id)
        wanted = [alert for alert in candidates if passes_preferences(alert, preferences)]
        if wanted:
            created = save_alerts(user_id, wanted)
            if created:
                logger.info("Created %d security alert(s) for user %s", len(created), user_id)
    except Exception:  # noqa: BLE001 - alerts must never break a scan
        logger.exception("Could not record security alerts")


def record_alerts(authorization: str | None, alerts: list[dict[str, Any] | None]) -> None:
    """Best-effort version for scans that only have the Authorization header.
    Does nothing for signed-out users. Never raises."""
    if not authorization or not authorization.startswith("Bearer "):
        return
    if not any(alerts) or not supabase_store.is_configured():
        return
    try:
        user_id = supabase_store.get_user_id(authorization.removeprefix("Bearer ").strip())
    except Exception:  # noqa: BLE001
        logger.exception("Could not identify user for security alerts")
        return
    record_alerts_for_user(user_id, alerts)


# ---------------------------------------------------------------------------
# 3. API
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/alerts", tags=["Security alerts"])

ALERT_COLUMNS = (
    "id,source,threat_type,risk_level,title,details,related_ref,"
    "status,detected_at,reviewed_at"
)


class AlertOut(BaseModel):
    id: str
    source: str
    threat_type: str
    risk_level: str
    title: str
    details: dict[str, Any]
    related_ref: str | None = None
    status: Literal["new", "reviewed"]
    detected_at: str
    reviewed_at: str | None = None


class AlertStatusUpdate(BaseModel):
    status: Literal["new", "reviewed"]


class AlertSettings(BaseModel):
    enabled: bool


def _require_user(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to view security alerts.")
    if not supabase_store.is_configured():
        raise HTTPException(status_code=503, detail="Supabase persistence is not configured.")
    try:
        user_id = supabase_store.get_user_id(authorization.removeprefix("Bearer ").strip())
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid Supabase access token.")
    return user_id


def _unavailable(response: httpx.Response) -> HTTPException:
    return HTTPException(status_code=503, detail=f"Security alerts are unavailable ({response.status_code}).")


@router.get("", response_model=list[AlertOut])
def list_alerts(
    status: Literal["new", "reviewed", "all"] = Query("new"),
    limit: int = Query(50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user(authorization)
    params = {
        "select": ALERT_COLUMNS,
        "user_id": f"eq.{user_id}",
        "order": "detected_at.desc",
        "limit": str(limit),
    }
    if status != "all":
        params["status"] = f"eq.{status}"

    response = httpx.get(_rest_url("security_alerts"), params=params, headers=_headers(), timeout=10)
    if not response.is_success:
        raise _unavailable(response)
    return response.json()


@router.get("/settings", response_model=AlertSettings)
def get_alert_settings(authorization: str | None = Header(default=None)):
    """The Settings page on/off switch. On by default."""
    user_id = _require_user(authorization)
    try:
        preferences = get_preferences(user_id)
    except AlertStoreError as exc:
        raise HTTPException(status_code=503, detail="Alert settings are unavailable.") from exc
    return {"enabled": preferences.get("in_app_enabled") is not False}


@router.put("/settings", response_model=AlertSettings)
def update_alert_settings(
    payload: AlertSettings,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user(authorization)
    # Upsert: creates the user's preferences row if needed and only changes
    # in_app_enabled, so other saved preferences are kept.
    response = httpx.post(
        _rest_url("notification_preferences"),
        params={"on_conflict": "user_id", "select": "in_app_enabled"},
        json={"user_id": user_id, "in_app_enabled": payload.enabled},
        headers=_headers("resolution=merge-duplicates,return=representation"),
        timeout=10,
    )
    if not response.is_success:
        raise HTTPException(status_code=503, detail="Could not save alert settings.")
    rows = response.json()
    return {"enabled": bool(rows[0]["in_app_enabled"]) if rows else payload.enabled}


@router.get("/unread-count")
def unread_count(authorization: str | None = Header(default=None)):
    user_id = _require_user(authorization)
    response = httpx.get(
        _rest_url("security_alerts"),
        params={"select": "id", "user_id": f"eq.{user_id}", "status": "eq.new", "limit": "1"},
        headers=_headers("count=exact"),
        timeout=10,
    )
    if not response.is_success:
        raise _unavailable(response)
    # Content-Range looks like "0-0/7" (or "*/0" when there are none).
    total = response.headers.get("content-range", "*/0").rsplit("/", 1)[-1]
    return {"count": int(total) if total.isdigit() else 0}


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert_status(
    payload: AlertStatusUpdate,
    alert_id: UUID = Path(...),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user(authorization)
    reviewed_at = _utc_now().isoformat() if payload.status == "reviewed" else None
    response = httpx.patch(
        _rest_url("security_alerts"),
        params={"id": f"eq.{alert_id}", "user_id": f"eq.{user_id}", "select": ALERT_COLUMNS},
        json={"status": payload.status, "reviewed_at": reviewed_at},
        headers=_headers("return=representation"),
        timeout=10,
    )
    if not response.is_success:
        raise _unavailable(response)
    rows = response.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Alert not found.")
    return rows[0]


@router.post("/review-all")
def review_all_alerts(authorization: str | None = Header(default=None)):
    user_id = _require_user(authorization)
    response = httpx.patch(
        _rest_url("security_alerts"),
        params={"user_id": f"eq.{user_id}", "status": "eq.new", "select": "id"},
        json={"status": "reviewed", "reviewed_at": _utc_now().isoformat()},
        headers=_headers("return=representation"),
        timeout=10,
    )
    if not response.is_success:
        raise _unavailable(response)
    return {"reviewed": len(response.json())}
