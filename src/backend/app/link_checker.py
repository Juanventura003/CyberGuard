import re
from urllib.parse import urlparse
import requests
from .config import settings


SAFE_BROWSING_URL = (
    "https://safebrowsing.googleapis.com/v4/threatMatches:find"
)


def check_url(url: str):
    if not settings.GOOGLE_SAFE_BROWSING_API_KEY:
        raise RuntimeError("Google Safe Browsing API key is not configured.")

    payload = {
        "client": {
            "clientId": "cyberguard",
            "clientVersion": "1.0.0",
        },
        "threatInfo": {
            "threatTypes": [
                "MALWARE",
                "SOCIAL_ENGINEERING",
                "UNWANTED_SOFTWARE",
                "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [
                {"url": url}
            ],
        },
    }

    response = requests.post(
        SAFE_BROWSING_URL,
        params={
            "key": settings.GOOGLE_SAFE_BROWSING_API_KEY
        },
        json=payload,
        timeout=10,
    )

    response.raise_for_status()

    data = response.json()
    matches = data.get("matches", [])

    # Risk score guidelines
    risk_score = 5
    reasons = []

    parsed_url = urlparse(url)
    hostname = parsed_url.hostname or ""

    # HTTP instead of HTTPS
    if parsed_url.scheme == "http":
        risk_score += 10
        reasons.append("Website does not use HTTPS.")

    # IP address instead of normal domain name
    ip_pattern = r"^\d{1,3}(\.\d{1,3}){3}$"

    if re.match(ip_pattern, hostname):
        risk_score += 20
        reasons.append("URL uses an IP address instead of a domain name.")

    # Suspicious words commonly seen in phishing URLs
    suspicious_words = [
        "login",
        "verify",
        "secure",
        "account",
        "update",
        "password",
        "bank",
        "signin",
        "confirm",
        "wallet",
        "payment",
    ]

    lowercase_url = url.lower()

    suspicious_word_count = sum(
        1 for word in suspicious_words if word in lowercase_url
    )

    if suspicious_word_count > 0:
        word_score = min(suspicious_word_count * 5, 20)
        risk_score += word_score
        reasons.append(
            "URL contains words commonly used in phishing links."
        )

    if len(url) > 100:
        risk_score += 10
        reasons.append("URL is unusually long.")

    if hostname.count(".") >= 3:
        risk_score += 10
        reasons.append("URL contains multiple subdomains.")


    # Result from Google Safe Browsing
    threat_types = []

    if matches:
        for match in matches:
            threat_type = match.get("threatType")

            if threat_type and threat_type not in threat_types:
                threat_types.append(threat_type)
        risk_score = max(risk_score, 90)

        reasons.append(
            "Google Safe Browsing identified this URL as a known threat."
        )

    risk_score = min(risk_score, 100)

   #what considers a safe,suspicious or high risk
    if risk_score <= 30:
        classification = "SAFE"

    elif risk_score <= 70:
        classification = "SUSPICIOUS"

    else:
        classification = "HIGH RISK"

    if not reasons:
        reasons.append(
            "No known threats or suspicious URL characteristics were detected."
        )

    return {
        "url": url,
        "risk_score": risk_score,
        "classification": classification,
        "known_threat": len(matches) > 0,
        "threat_types": threat_types,
        "reasons": reasons,
    }