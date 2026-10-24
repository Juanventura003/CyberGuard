import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import settings

WEB_RISK_URL = "https://webrisk.googleapis.com/v1/uris:search"
THREAT_TYPES = ("MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE")


class WebRiskLookupError(RuntimeError):
    pass


def _google_error_message(exc: HTTPError) -> str:
    """Google's own explanation from an error response (never includes the key)."""
    try:
        body = json.loads(exc.read().decode("utf-8", errors="replace"))
        message = body.get("error", {}).get("message", "")
    except Exception:  # noqa: BLE001 - best effort only
        message = ""
    message = " ".join(str(message).split())[:300]
    return message or (exc.reason if isinstance(exc.reason, str) else "no details")


def lookup_url(url: str) -> dict:
    if not settings.GOOGLE_WEB_RISK_API_KEY:
        raise WebRiskLookupError("Google Web Risk API key is not configured.")

    query = urlencode([
        ("threatTypes", threat_type) for threat_type in THREAT_TYPES
    ] + [
        ("uri", url),
        ("key", settings.GOOGLE_WEB_RISK_API_KEY),
    ])
    request = Request(f"{WEB_RISK_URL}?{query}", headers={"Accept": "application/json"})

    try:
        with urlopen(request, timeout=5) as response:
            payload = json.load(response)
    except HTTPError as exc:
        reason = _google_error_message(exc)
        if exc.code in {400, 401, 403}:
            # 400 = invalid API key; 403 = API not enabled, billing, or key restrictions.
            raise WebRiskLookupError(
                f"Google rejected the request (HTTP {exc.code}: {reason}). "
                "Verify the API key, that the Web Risk API is enabled, and billing."
            ) from exc
        raise WebRiskLookupError(f"Google Web Risk lookup failed (HTTP {exc.code}: {reason}).") from exc
    except URLError as exc:
        # Network, DNS, proxy or certificate problems reaching Google.
        raise WebRiskLookupError(f"Could not reach Google Web Risk: {exc.reason}") from exc
    except TimeoutError as exc:
        raise WebRiskLookupError("Google Web Risk did not respond within 5 seconds.") from exc
    except json.JSONDecodeError as exc:
        raise WebRiskLookupError("Google Web Risk returned an unreadable response.") from exc

    threat = payload.get("threat", {})
    return {
        "threat_types": threat.get("threatTypes", []),
        "expire_time": threat.get("expireTime"),
    }