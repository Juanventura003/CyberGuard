"""Fetch publisher RSS metadata"""

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import logging
from threading import Event, Lock
from time import monotonic
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx
from . import news_store

FEED_URL = "https://www.bleepingcomputer.com/feed/"
CACHE_SECONDS = 300
_lock = Lock()
_refresh_lock = Lock()
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
        (
            "Vulnerabilities",
            ("vulnerability", "vulnerabilities", "zero-day", "cve-", "security flaw"),
        ),
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
        if (
            not title
            or len(url) > 2048
            or parsed.scheme != "https"
            or parsed.hostname
            not in {"www.bleepingcomputer.com", "bleepingcomputer.com"}
            or parsed.username
            or parsed.password
            or parsed.netloc not in {"www.bleepingcomputer.com", "bleepingcomputer.com"}
            or parsed.fragment
            or url in seen
        ):
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        seen.add(url)
        summary = plain_text(item.findtext("description", ""))[:700]
        articles.append(
            dict(
                id=sha256(url.encode()).hexdigest()[:24],
                title=title[:1000],
                url=url,
                summary=summary,
                source="BleepingComputer",
                published_at=published.astimezone(timezone.utc).isoformat(),
                category=category_for(title, summary),
            )
        )
    if not articles:
        raise NewsFeedError("The news source returned no usable articles.")
    return sorted(articles, key=lambda article: article["published_at"], reverse=True)[
        :1000
    ]


def retained_articles(articles, now=None):
    """Enforce expiry even between refreshes, during outages, and after restarts."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=168)
    retained = []
    for article in articles:
        try:
            published = datetime.fromisoformat(
                article["published_at"].replace("Z", "+00:00")
            )
            if cutoff < published <= now:
                retained.append(article)
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(
        retained,
        key=lambda article: (
            datetime.fromisoformat(article["published_at"].replace("Z", "+00:00")),
            article["id"],
        ),
        reverse=True,
    )


def merge_articles(previous, incoming):
    merged = {article["id"]: article for article in previous}
    for article in incoming:
        existing = merged.get(article["id"])
        # A later feed edit must not extend an article's original retention period.
        if existing:
            original = min(
                (existing["published_at"], article["published_at"]),
                key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")),
            )
            merged[article["id"]] = {**article, "published_at": original}
        else:
            merged[article["id"]] = article
    return retained_articles(merged.values())


def refresh_news():
    global _cached, _expires
    with _refresh_lock:
        with _lock:
            previous = _cached
        fresh = None
        fetched_at = previous["fetched_at"] if previous else None
        try:
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                with client.stream(
                    "GET", FEED_URL, headers={"User-Agent": "CyberGuard/1.0 RSS Reader"}
                ) as response:
                    response.raise_for_status()
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > 2_000_000:
                            raise NewsFeedError(
                                "The news feed exceeded the size limit."
                            )
            fresh = parse_feed(bytes(content))
            fetched_at = datetime.now(timezone.utc).isoformat()
        except (httpx.HTTPError, ElementTree.ParseError, NewsFeedError, ValueError):
            pass
        candidates = merge_articles(
            previous["articles"] if previous else [], fresh or []
        )
        persistent = True
        try:
            # Persist only publisher changes normally; replay the retained cache after
            # a storage outage so articles collected in memory are not lost.
            pending = (
                candidates
                if previous and previous.get("storage") == "memory"
                else fresh
            )
            stored = news_store.sync_articles(pending, fetched_at)
            articles = retained_articles(stored["articles"])
            fetched_at = stored.get("fetched_at")
        except news_store.NewsStorageError:
            persistent = False
            articles = candidates
            _logger.warning(
                "Persistent news storage unavailable; using the in-memory feed."
            )
        if not fetched_at:
            raise NewsFeedError(
                "News is temporarily unavailable. Please try again shortly."
            )
        stale = fresh is None
        payload = {
            "articles": articles,
            "fetched_at": fetched_at,
            "source_url": FEED_URL,
            "storage": "persistent" if persistent else "memory",
        }
        with _lock:
            _cached = payload
            _expires = 0.0 if stale else monotonic() + CACHE_SECONDS
        return {**payload, "stale": stale}


def get_news():
    """Serve the shared cache without triggering a publisher request."""
    with _lock:
        if _cached is None:
            raise NewsFeedError("News is not available yet. Please try again shortly.")
        return {
            **_cached,
            "articles": retained_articles(_cached["articles"]),
            "stale": monotonic() >= _expires,
        }


def run_refresh_loop(stop: Event):
    """Refresh immediately and every five minutes until server shutdown."""
    while not stop.is_set():
        started = monotonic()
        try:
            result = refresh_news()
            if result["stale"]:
                _logger.warning(
                    "News refresh failed; keeping the last successful feed."
                )
        except NewsFeedError:
            _logger.warning(
                "News source unavailable; will retry on the next scheduled refresh."
            )
        stop.wait(max(0.0, CACHE_SECONDS - (monotonic() - started)))
