import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import settings

WEB_RISK_URL = "https://webrisk.googleapis.com/v1/uris:search"
THREAT_TYPES = ("MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE")


class WebRiskLookupError(RuntimeError):
    pass


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
        if exc.code in {401, 403}:
            raise WebRiskLookupError(
                "Google Web Risk rejected the request. Verify the API key, API enablement, and billing."
            ) from exc
        raise WebRiskLookupError("Google Web Risk lookup failed.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise WebRiskLookupError("Google Web Risk lookup failed.") from exc

    threat = payload.get("threat", {})
    return {
        "threat_types": threat.get("threatTypes", []),
        "expire_time": threat.get("expireTime"),
    }