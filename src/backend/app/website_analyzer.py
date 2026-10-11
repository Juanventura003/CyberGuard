"""Browser extension URL evidence combined with known-threat reputation.

Scores express rule strength, not a probability. Never fetch the target site.
"""

import ipaddress
import re
from urllib.parse import urlsplit

from . import threat_feeds
from .brand_catalog import BRANDS, ASCII_LOOKALIKE_BRANDS
from .domain_confusables import brand_lookalikes
from .web_risk import WebRiskLookupError, lookup_url


def url_signals(url: str) -> tuple[str, int, list[str]]:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").rstrip(".").lower()
        _ = parsed.port
        if (
            parsed.scheme not in {"http", "https"}
            or not host
            or any(c.isspace() for c in url)
            or "\\" in url
        ):
            raise ValueError
        ascii_host = host.encode("idna").decode("ascii")
        if not re.fullmatch(r"[a-z0-9.:-]+", ascii_host):
            raise ValueError
    except (ValueError, UnicodeError):
        raise ValueError(
            "Enter a valid HTTP or HTTPS URL without whitespace or backslashes."
        ) from None

    score, reasons = 0, []
    if parsed.username is not None:
        score += 40
        reasons.append(
            f"Text before @ is user information, not the destination. The actual host is {ascii_host}."
        )
    if parsed.scheme == "http":
        score += 10
        reasons.append("The connection is not encrypted with HTTPS.")
    try:
        ipaddress.ip_address(host)
        score += 15
        reasons.append(
            "The destination is an IP address; this alone does not establish a threat."
        )
    except ValueError:
        pass
    if any(label.startswith("xn--") for label in ascii_host.split(".")):
        lookalikes = brand_lookalikes(ascii_host, BRANDS)
        if lookalikes:
            score += 40
            reasons.append(
                f"Internationalized characters in this hostname visually resemble {', '.join(lookalikes)}, outside its configured official domains. Verify the actual domain before signing in."
            )
    for brand, official in BRANDS.items():
        if any(
            ascii_host == domain or ascii_host.endswith("." + domain)
            for domain in official
        ):
            continue
        # Only domain labels, never login paths or query text.
        if re.search(r"(?:^|[.-])" + brand + r"(?:[.-]|$)", ascii_host):
            score += 40
            reasons.append(
                f"The hostname references {brand}, but is outside CyberGuard's configured official domains. This may be impersonation; third-party sites can also mention brands."
            )
    # Conservative ASCII lookalikes: one changed character in a full brand label.
    labels = ascii_host.split(".")[:-1]
    for brand, official in ASCII_LOOKALIKE_BRANDS.items():
        if any(
            ascii_host == domain or ascii_host.endswith("." + domain)
            for domain in official
        ):
            continue
        if any(
            label != brand
            and len(label) == len(brand)
            and sum(a != b for a, b in zip(label, brand)) == 1
            for label in labels
        ):
            score += 35
            reasons.append(
                f"A domain label closely resembles {brand}, but this is outside its configured official domains. Verify the spelling before signing in."
            )
    return ascii_host, min(score, 75), reasons


def analyze_url(url: str) -> dict:
    host, score, reasons = url_signals(url)
    if urlsplit(url).scheme == "https":
        reasons.append("The URL uses HTTPS.")
    reasons.append(
        "URL rules checked for embedded credentials, IP-address destinations, "
        "and configured-brand impersonation or spelling/Unicode lookalikes."
    )
    threats, expiry, lookup_failed = [], None, False
    try:
        lookup = lookup_url(url)
        threats, expiry = lookup["threat_types"], lookup["expire_time"]
        if not threats:
            reasons.append(
                "Google Web Risk returned no match for malware, social engineering, "
                "or unwanted software for this URL."
            )
    except WebRiskLookupError:
        lookup_failed = True
        reasons.append(
            "Google Web Risk could not be checked. Other available checks still ran."
        )
    feed_matches, feed_status, feed_incomplete = threat_feeds.lookup(url)
    reasons.extend(feed_status)
    if not feed_matches and any(
        status.startswith("OpenPhish feed last downloaded:") for status in feed_status
    ):
        reasons.append(
            "This exact URL was not listed in the available OpenPhish snapshot."
        )
    lookup_failed = lookup_failed or feed_incomplete
    if feed_matches:
        if "SOCIAL_ENGINEERING" not in threats:
            threats.append("SOCIAL_ENGINEERING")
        reasons.insert(
            0, f"{', '.join(feed_matches)} lists this exact URL as phishing."
        )
    if threats:
        score = (
            95 if any(t in threats for t in ("MALWARE", "SOCIAL_ENGINEERING")) else 80
        )
        level = "HIGH_RISK"
        if not feed_matches:
            reasons.insert(0, "Google Web Risk identifies this URL as a known threat.")
    elif score >= 35:
        level = "SUSPICIOUS"
    elif lookup_failed:
        level = "UNABLE_TO_VERIFY"
    else:
        level = "NO_KNOWN_THREAT"
        reasons.insert(0, "No known threat or strong URL warning was detected.")
    return dict(
        url=url,
        domain=host,
        risk_score=float(score),
        risk_level=level,
        source="LAYERED_ANALYSIS",
        threat_types=threats,
        explanation=reasons,
        expire_time=expiry,
    )


def analyze_page_signals(url: str, page: dict) -> dict:
    """Assess bounded DOM facts. No page fetching or credential values."""
    host, url_score, _ = url_signals(url)
    forms = page.get("password_forms", [])
    has_password = bool(forms) or page.get("password_without_form", False)
    score, reasons = 0, []
    login_link_mismatch = False
    for link in page.get("misleading_links", []):
        displayed = link["displayed_host"].lower().removeprefix("www.")
        destination = link["destination_host"].lower().removeprefix("www.")
        if (
            displayed == destination
            or displayed.endswith("." + destination)
            or destination.endswith("." + displayed)
        ):
            continue
        login_link_mismatch = login_link_mismatch or link.get("in_password_form", False)
        reasons.append(
            f"A visible link displays {displayed} but points to {destination}. Tracking redirects can also cause this mismatch; verify before following it."
        )
    if reasons:
        # Only mismatches inside an inspected password form support a login warning.
        score = 35 if has_password and login_link_mismatch else 15
    if page.get("recovery_secret_fields", 0):
        score = max(score, 35)
        reasons.insert(
            0,
            "A visible field asks for a wallet recovery phrase, mnemonic, or private key. These secrets can give full access to funds. Verify the application before entering them; legitimate wallet restoration can also request them.",
        )
    if not has_password:
        return {
            "risk_score": score,
            "explanation": reasons
            or [
                "No visible password fields, labeled recovery-secret fields, "
                "or misleading URL labels were reported by the page check."
            ],
        }
    insecure = urlsplit(url).scheme == "http"
    external = False
    get_submission = False
    for form in forms:
        action = urlsplit(form["action_origin"])
        if action.scheme not in ("http", "https") or not action.hostname:
            continue
        action_host = action.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        insecure = insecure or action.scheme == "http"
        related = (
            action_host == host
            or action_host.endswith("." + host)
            or host.endswith("." + action_host)
        )
        external = external or not related
        get_submission = get_submission or form.get("method") == "get"
    if insecure:
        score += 40
        reasons.append(
            "This page requests a password over HTTP or a declared form or submit-button destination uses HTTP. The password may travel without encryption."
        )
    if get_submission:
        score += 35
        reasons.append(
            "A password form or submit button declares GET submission, which can put credentials in URLs and browser history unless scripts override submission."
        )
    if external:
        score += 15
        reasons.append(
            "A password form declares a destination on a different hostname. This can be legitimate authentication; verify the destination."
        )
    supporting_warning = insecure or get_submission or score >= 35 or url_score >= 35
    brand_bonus_applied = False
    for brand in sorted(set(page.get("brands", []))):
        official = BRANDS.get(brand, ())
        if official and not any(host == d or host.endswith("." + d) for d in official):
            if not brand_bonus_applied:
                score += 25 if supporting_warning else 10
                brand_bonus_applied = True
            if supporting_warning:
                reasons.append(
                    f"The login page references {brand} outside its configured official domains, alongside another URL or form warning. Verify who operates this page."
                )
            else:
                reasons.append(
                    f"The login page mentions {brand} outside its configured official domains. A brand mention alone is weak evidence and can occur on legitimate third-party pages."
                )
    if not reasons:
        reasons.append(
            "Visible password forms declare HTTPS POST submission to the same "
            "or a related hostname."
            if forms and all(form.get("method") == "post" for form in forms)
            else "No strong warning was found in the visible password fields "
            "and available declared form destinations."
        )
    reasons.append(
        "Page checks inspect visible password fields and declared form destinations, not scripts, hidden frames, or entered values."
    )
    return {
        "risk_score": min(score, 75 if supporting_warning else 25),
        "explanation": reasons,
    }
