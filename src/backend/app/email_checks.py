"""
Phishing evidence beyond an email's wording.

1. Links: the real destination of every link (from the HTML, not just the
   visible text), whether the visible text claims a different site, and each
   destination checked against the website analyzer's URL rules, Google Web
   Risk and the OpenPhish feed.
2. Sender: SPF / DKIM / DMARC results Gmail recorded, a Reply-To that sends
   replies elsewhere, a display name claiming a brand the address doesn't
   belong to, and lookalike sender domains.

Each check returns findings for the UI plus a risk bonus that
phishing_detector adds to the model's score. Nothing here downloads or opens
the linked pages; Web Risk and OpenPhish only look the address up.
"""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import urlsplit

from . import threat_feeds
from .brand_catalog import BRANDS
from .web_risk import WebRiskLookupError, lookup_url
from .website_analyzer import url_signals

# Reputation lookups (Web Risk / OpenPhish) per email, most suspicious first.
MAX_REPUTATION_LOOKUPS = 5
# Links checked with the local URL rules per email (no network).
MAX_LINKS_CHECKED = 25
_CACHE_SECONDS = 10 * 60

# Display names that claim a brand -> the catalog identifier for that brand.
BRAND_NAMES = {
    "paypal": "paypal",
    "microsoft": "microsoft",
    "outlook": "microsoft",
    "office 365": "microsoft",
    "office365": "microsoft",
    "apple": "apple",
    "icloud": "apple",
    "amazon": "amazon",
    "google": "google",
    "gmail": "google",
    "netflix": "netflix",
    "linkedin": "linkedin",
    "coinbase": "coinbase",
    "metamask": "metamask",
}

# Click-tracking and link-protection services legitimate senders route links
# through. A link shown as "amazon.com" that goes via one of these isn't a
# disguised destination by itself.
TRACKING_SERVICES = {
    "sendgrid.net", "list-manage.com", "mailchimp.com", "mcsv.net", "rs6.net",
    "hubspotlinks.com", "hubspotemail.net", "mandrillapp.com", "mailgun.org",
    "sparkpostmail.com", "exacttarget.com", "klaviyo.com", "klclick.com",
    "customeriomail.com", "convertkit-mail.com", "mailjet.com", "sendibt2.com",
    "awstrack.me", "urldefense.com", "safelinks.protection.outlook.com",
    "outlook.com", "mimecast.com", "constantcontact.com", "cmail19.com", "cmail20.com",
}

# Shared free mail services: a brand name on one of these is a classic trick.
FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "proton.me", "protonmail.com"}

_DOMAIN_IN_TEXT = re.compile(
    r"(?:https?://)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def domain_of(address: str) -> str:
    """Lower-case domain of an email address ('' if none)."""
    _, email = parseaddr(address or "")
    email = email or address or ""
    return email.rsplit("@", 1)[-1].strip().strip(">").lower() if "@" in email else ""


def registrable(host: str) -> str:
    """Rough 'site' of a host: its last two labels (last three for e.g. co.uk)."""
    parts = [p for p in (host or "").lower().rstrip(".").split(".") if p]
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in {"co", "com", "org", "net", "ac", "gov", "edu"}:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def same_site(a: str, b: str) -> bool:
    return bool(a) and bool(b) and registrable(a) == registrable(b)


def _official_brand(host: str, brand: str) -> bool:
    return any(host == d or host.endswith("." + d) for d in BRANDS.get(brand, ()))


def _check(check_id: str, label: str, status: str, detail: str) -> dict:
    """One row in the result's 'Checks' list. status: pass | warn | fail | info."""
    return {"id": check_id, "label": label, "status": status, "detail": detail}


# ---------------------------------------------------------------------------
# 1. Links
# ---------------------------------------------------------------------------

class _LinkParser(HTMLParser):
    """Collects <a href> destinations and the text shown for each."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[dict] = []
        self._open: dict | None = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            href = dict(attrs).get("href") or ""
            self._open = {"href": href.strip(), "text": ""}

    def handle_data(self, data):
        if self._open is not None:
            self._open["text"] += data

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._open is not None:
            self._open["text"] = " ".join(self._open["text"].split())[:200]
            self.links.append(self._open)
            self._open = None


def extract_html_links(html: str) -> list[dict]:
    """[{href, text}] for every web link in an HTML email body."""
    parser = _LinkParser()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:  # noqa: BLE001 - malformed HTML still yields what was parsed
        pass
    return [link for link in parser.links if link["href"].lower().startswith(("http://", "https://"))]


def html_to_text(html: str) -> str:
    """Readable text from an HTML body (scripts/styles dropped)."""
    html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html or "")
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", html)
    text = re.sub(r"<[^>]+>", " ", html)
    from html import unescape

    text = unescape(text)
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n\n", text)).strip()


def _displayed_host(text: str) -> str | None:
    """The site a link's visible text claims to be, if it looks like an address."""
    match = _DOMAIN_IN_TEXT.search(text or "")
    if not match:
        return None
    host = match.group(1).lower()
    # Plain words like "file.pdf" or "v2.0" aren't site names.
    if host.rsplit(".", 1)[-1] in {"pdf", "doc", "docx", "jpg", "png", "zip", "exe", "html"}:
        return None
    return host


_reputation_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _reputation(url: str) -> dict:
    """Web Risk + OpenPhish verdict for one address, cached for a few minutes."""
    now = time.time()
    with _cache_lock:
        hit = _reputation_cache.get(url)
        if hit and now - hit[0] < _CACHE_SECONDS:
            return hit[1]

    threats: list[str] = []
    checked = False
    try:
        threats = list(lookup_url(url)["threat_types"])
        checked = True
    except WebRiskLookupError:
        pass
    try:
        feed_matches, feed_status, _ = threat_feeds.lookup(url)
        # Only a feed that has actually been downloaded counts as a check.
        checked = checked or any("last downloaded" in status for status in feed_status)
        if feed_matches and "SOCIAL_ENGINEERING" not in threats:
            threats.append("SOCIAL_ENGINEERING")
    except Exception:  # noqa: BLE001 - feeds are best effort
        feed_matches = []
    result = {"threats": threats, "checked": checked, "feeds": feed_matches}

    with _cache_lock:
        if len(_reputation_cache) > 2000:
            _reputation_cache.clear()
        _reputation_cache[url] = (now, result)
    return result


def analyze_links(links: list[dict], plain_urls: list[str], sender_domain: str) -> dict:
    """
    links: [{href, text}] from the HTML body; plain_urls: addresses written in
    the text. Returns {reports, checks, bonus, known_threat}.
    """
    # Unique destinations, keeping the visible text that went with each.
    seen: dict[str, dict] = {}
    for link in links:
        seen.setdefault(link["href"], {"url": link["href"], "text": link.get("text", "")})
    for url in plain_urls:
        seen.setdefault(url, {"url": url, "text": ""})

    reports: list[dict] = []
    for item in list(seen.values())[:MAX_LINKS_CHECKED]:
        url = item["url"]
        try:
            host, rule_score, rule_reasons = url_signals(url)
        except ValueError:
            continue  # not a normal web address
        reasons = list(rule_reasons)
        shown = _displayed_host(item["text"])
        mismatch = (
            bool(shown)
            and not same_site(shown, host)
            and registrable(host) not in TRACKING_SERVICES
        )
        if mismatch:
            reasons.insert(0, f'The link text shows "{shown}", but it actually goes to {host}.')
        reports.append({
            "url": url,
            "host": host,
            "text": item["text"][:120],
            "displayed_host": shown,
            "mismatch": mismatch,
            "rule_score": rule_score,
            "reasons": reasons,
            "threats": [],
            "verdict": "ok",
        })

    # Reputation lookups for the most suspicious-looking destinations first.
    priority = sorted(reports, key=lambda r: (not r["mismatch"], -r["rule_score"]))
    to_lookup = []
    for report in priority:
        if report["url"] not in {r["url"] for r in to_lookup}:
            to_lookup.append(report)
        if len(to_lookup) == MAX_REPUTATION_LOOKUPS:
            break
    with ThreadPoolExecutor(max_workers=MAX_REPUTATION_LOOKUPS) as pool:
        verdicts = list(pool.map(lambda r: _reputation(r["url"]), to_lookup))
    any_checked = False
    for report, verdict in zip(to_lookup, verdicts):
        any_checked = any_checked or verdict["checked"]
        if verdict["threats"]:
            report["threats"] = verdict["threats"]
            source = "OpenPhish" if verdict["feeds"] and len(verdict["threats"]) == 1 else "Google Web Risk"
            report["reasons"].insert(0, f"{source} lists this address as a known threat ({', '.join(verdict['threats'])}).")

    bonus = 0.0
    for report in reports:
        if report["threats"]:
            report["verdict"] = "dangerous"
        elif report["mismatch"] or report["rule_score"] >= 35:
            report["verdict"] = "suspicious"

    dangerous = [r for r in reports if r["verdict"] == "dangerous"]
    mismatched = [r for r in reports if r["mismatch"]]
    rule_flagged = [r for r in reports if r["rule_score"] >= 35 and not r["mismatch"]]

    checks = []
    if not reports:
        checks.append(_check("links", "Links", "info", "No web links found in this email."))
    else:
        if dangerous:
            checks.append(_check(
                "link_reputation", "Known dangerous links", "fail",
                (f"A link goes to {dangerous[0]['host']}, which is listed as phishing or malware." if len(dangerous) == 1
                 else f"{len(dangerous)} links go to addresses listed as phishing or malware, e.g. {dangerous[0]['host']}."),
            ))
            bonus += 45
        elif any_checked:
            checks.append(_check(
                "link_reputation", "Known dangerous links", "pass",
                ("The link isn't on Google Web Risk or OpenPhish." if len(to_lookup) == 1
                 else f"None of the {len(to_lookup)} most suspicious links are on Google Web Risk or OpenPhish."),
            ))
        else:
            checks.append(_check(
                "link_reputation", "Known dangerous links", "info",
                "Link reputation couldn't be checked (Web Risk key or threat feed unavailable).",
            ))

        if mismatched:
            first = mismatched[0]
            checks.append(_check(
                "link_mismatch", "Link text matches destination", "fail",
                f'A link shows "{first["displayed_host"]}" but really goes to {first["host"]}.',
            ))
            bonus += 25
        else:
            checks.append(_check(
                "link_mismatch", "Link text matches destination", "pass",
                "No link pretends to go to a different site than it really does.",
            ))

        if rule_flagged:
            checks.append(_check(
                "link_rules", "Link address warning signs", "warn",
                f"{rule_flagged[0]['host']}: {rule_flagged[0]['reasons'][0]}",
            ))
            bonus += 12

    return {
        "reports": [r for r in reports if r["verdict"] != "ok"][:10],
        "checks": checks,
        "bonus": bonus,
        "known_threat": bool(dangerous),
    }


# ---------------------------------------------------------------------------
# 2. Sender and headers
# ---------------------------------------------------------------------------

def parse_auth_results(header_values: list[str]) -> dict[str, str]:
    """{'spf': 'pass', 'dkim': 'fail', 'dmarc': 'pass'} from Authentication-Results.
    Uses the receiving server's (Gmail's) header when present."""
    if not header_values:
        return {}
    chosen = next((v for v in header_values if "mx.google.com" in v.lower()), header_values[0])
    results = {}
    for method in ("spf", "dkim", "dmarc"):
        match = re.search(rf"\b{method}\s*=\s*([a-z]+)", chosen, re.IGNORECASE)
        if match:
            results[method] = match.group(1).lower()
    return results


# Character swaps scammers use to fake a brand name (paypa1, micros0ft).
_TRICK_SWAPS = {
    frozenset(p) for p in (("0", "o"), ("1", "l"), ("1", "i"), ("l", "i"), ("5", "s"),
                           ("3", "e"), ("4", "a"), ("8", "b"), ("9", "g"), ("6", "g"))
}


def _trick_spelling(piece: str, brand: str) -> bool:
    """True if piece is brand with exactly one look-alike character swapped."""
    if len(piece) != len(brand) or piece == brand:
        return False
    diffs = [(a, b) for a, b in zip(piece, brand) if a != b]
    return len(diffs) == 1 and frozenset(diffs[0]) in _TRICK_SWAPS


def _lookalike_brand(domain: str) -> str | None:
    """Brand a sender domain imitates, e.g. micros0ft-verify.xyz -> microsoft."""
    if not domain:
        return None
    site_label = registrable(domain).split(".")[0]
    pieces = re.split(r"[.-]", domain.lower())
    for brand in BRANDS:
        # Official domains, and the brand's own country domains (paypal.co.uk).
        if _official_brand(domain, brand) or site_label == brand:
            continue
        for piece in pieces:
            if piece == brand:
                return brand  # brand name inside someone else's domain
            if _trick_spelling(piece, brand):
                return brand  # one character swapped (micros0ft, paypa1)
    # Unicode lookalikes (e.g. Cyrillic letters) arrive as xn-- labels; the
    # website analyzer's confusables check handles those.
    if not any(label.startswith("xn--") for label in domain.split(".")):
        return None
    try:
        _, score, _ = url_signals(f"https://{domain}/")
    except ValueError:
        return None
    return "a known brand" if score >= 35 else None


def analyze_sender(
    sender: str,
    display_name: str = "",
    headers: dict[str, list[str]] | None = None,
) -> dict:
    """
    sender: the From address; display_name: the name shown with it;
    headers: lower-case header name -> all values (Gmail only).
    Returns {checks, bonus}.
    """
    checks: list[dict] = []
    bonus = 0.0
    domain = domain_of(sender)
    headers = headers or {}

    # Authentication (only available for emails fetched from Gmail).
    auth = parse_auth_results(headers.get("authentication-results", []))
    if auth:
        dmarc, spf, dkim = auth.get("dmarc"), auth.get("spf"), auth.get("dkim")
        if dmarc == "fail":
            checks.append(_check("auth", "Sender authentication", "fail",
                                 f"DMARC failed: this email did not prove it really came from {domain or 'its sender'}."))
            bonus += 25
        elif spf in {"fail", "softfail"} or dkim == "fail":
            failed = ", ".join(m.upper() for m, r in (("spf", spf), ("dkim", dkim)) if r in {"fail", "softfail"})
            checks.append(_check("auth", "Sender authentication", "warn",
                                 f"{failed} check failed, so the sending server may not be authorized for {domain}."))
            bonus += 10
        elif dmarc == "pass" or (spf == "pass" and dkim == "pass"):
            checks.append(_check("auth", "Sender authentication", "pass",
                                 f"SPF/DKIM/DMARC passed: the email really came from {domain}. (Scammers can pass this with their own domains.)"))
        else:
            summary = ", ".join(f"{m.upper()} {r}" for m, r in auth.items())
            checks.append(_check("auth", "Sender authentication", "info", f"Results: {summary}."))
    elif headers:
        checks.append(_check("auth", "Sender authentication", "warn",
                             "No authentication results were recorded for this email."))
        bonus += 5
    else:
        checks.append(_check("auth", "Sender authentication", "info",
                             "Not available for pasted emails; connect Gmail to check SPF/DKIM/DMARC."))

    # Reply-To sending replies somewhere else.
    reply_to = (headers.get("reply-to") or [""])[0]
    reply_domain = domain_of(reply_to)
    if reply_domain and domain and not same_site(reply_domain, domain):
        checks.append(_check("reply_to", "Reply-To address", "warn",
                             f"Replies go to {reply_domain}, not the sender's domain ({domain})."))
        bonus += 10
    elif headers:
        checks.append(_check("reply_to", "Reply-To address", "pass", "Replies go back to the sender's own domain."))

    # Display name claiming a brand the address doesn't belong to.
    name = (display_name or "").lower()
    claimed = next((brand for word, brand in BRAND_NAMES.items() if re.search(rf"\b{re.escape(word)}\b", name)), None)
    if claimed and domain and not _official_brand(domain, claimed):
        where = "a free email account" if domain in FREE_MAIL else domain
        checks.append(_check("display_name", "Sender name matches address", "fail",
                             f'The sender calls itself "{display_name.strip()}", but the email comes from {where}.'))
        bonus += 20
    elif claimed:
        checks.append(_check("display_name", "Sender name matches address", "pass",
                             f"The sender name matches an official {claimed} domain."))

    # Lookalike sender domain.
    imitated = _lookalike_brand(domain)
    if imitated:
        checks.append(_check("lookalike", "Lookalike sender domain", "fail",
                             f"{domain} looks like it imitates {imitated}, but isn't one of its official domains."))
        bonus += 25
    elif domain:
        checks.append(_check("lookalike", "Lookalike sender domain", "pass",
                             f"{domain} doesn't imitate any brand CyberGuard watches."))

    return {"checks": checks, "bonus": bonus}
