"""Fetch publisher RSS metadata"""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import logging
from threading import Event, Lock
from time import monotonic
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx

FEED_URL = "https://www.bleepingcomputer.com/feed/"
CACHE_SECONDS = 300
_lock = Lock()
_cached = None
_expires = 0.0
_logger = logging.getLogger(__name__)


class NewsFeedError(Exception):
    pass


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(value)
    return " ".join(" ".join(parser.parts).split())


def category_for(title, summary):
    text = f"{title} {summary}".lower()
    for category, terms in (
        ("Phishing", ("phishing", "smishing", "scam")),
        ("Breaches", ("breach", "data leak", "stolen data")),
        ("Malware", ("malware", "ransomware", "trojan", "botnet")),
        ("Vulnerabilities", ("vulnerability", "vulnerabilities", "zero-day", "cve-", "security flaw")),
    ):
        if any(term in text for term in terms):
            return category
    return "General"


def parse_feed(content):
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise NewsFeedError("The news source returned an unsupported feed.")
    root = ElementTree.fromstring(content)
    if root.tag != "rss" or root.find("channel") is None:
        raise NewsFeedError("The news source returned an unsupported feed.")
    articles, seen = [], set()
    for item in root.findall("./channel/item"):
        title = plain_text(item.findtext("title", ""))
        url = item.findtext("link", "").strip()
        parsed = urlparse(url)
        if not title or parsed.scheme != "https" or parsed.hostname not in {"www.bleepingcomputer.com", "bleepingcomputer.com"} or url in seen:
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        seen.add(url)
        summary = plain_text(item.findtext("description", ""))[:700]
        articles.append(dict(id=sha256(url.encode()).hexdigest()[:24], title=title,
                             url=url, summary=summary, source="BleepingComputer",
                             published_at=published.astimezone(timezone.utc).isoformat(),
                             category=category_for(title, summary)))
    if not articles:
        raise NewsFeedError("The news source returned no usable articles.")
    return sorted(articles, key=lambda article: article["published_at"], reverse=True)[:100]


def refresh_news():
    global _cached, _expires
    with _lock:
        try:
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                with client.stream("GET", FEED_URL, headers={"User-Agent": "CyberGuard/1.0 RSS Reader"}) as response:
                    response.raise_for_status()
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > 2_000_000:
                            raise NewsFeedError("The news feed exceeded the size limit.")
            articles = parse_feed(bytes(content))
        except (httpx.HTTPError, ElementTree.ParseError, NewsFeedError, ValueError) as exc:
            _expires = 0.0
            if _cached is not None:
                return {**_cached, "stale": True}
            raise NewsFeedError("News is temporarily unavailable. Please try again shortly.") from exc
        _cached = {"articles": articles, "fetched_at": datetime.now(timezone.utc).isoformat(),
                   "source_url": FEED_URL}
        _expires = monotonic() + CACHE_SECONDS
        return {**_cached, "stale": False}


def get_news():
    """Serve the shared cache without triggering a publisher request."""
    with _lock:
        if _cached is None:
            raise NewsFeedError("News is not available yet. Please try again shortly.")
        return {**_cached, "stale": monotonic() >= _expires}


def run_refresh_loop(stop: Event):
    """Refresh immediately and every five minutes until server shutdown."""
    while not stop.is_set():
        started = monotonic()
        try:
            result = refresh_news()
            if result["stale"]:
                _logger.warning("News refresh failed; keeping the last successful feed.")
        except NewsFeedError:
            _logger.warning("News source unavailable; will retry on the next scheduled refresh.")
        stop.wait(max(0.0, CACHE_SECONDS - (monotonic() - started)))
