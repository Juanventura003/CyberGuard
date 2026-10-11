"""Extension-only threat feeds. Download lists, never visit their listed sites."""

import json
import logging
import time
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit, urlunsplit

import requests
from .config import settings

CACHE = (
    Path(__file__).resolve().parent.parent / ".cache" / "extension-threat-feeds.json"
)
OPENPHISH = (
    "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt"
)
MAX_BYTES = 64 * 1024 * 1024
_lock = Lock()
_snapshots = {}
_attempts = {}


def url_key(url):
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("Invalid feed URL")
    host = p.hostname.encode("idna").decode("ascii").lower()
    if ":" in host:
        host = f"[{host}]"
    port = p.port
    if port and not (
        p.scheme == "http" and port == 80 or p.scheme == "https" and port == 443
    ):
        host += f":{port}"
    # Exact path/query matching avoids condemning an entire shared hosting domain.
    return urlunsplit((p.scheme, host, p.path or "/", p.query, ""))


def configured():
    feeds = {}
    if settings.OPENPHISH_ENABLED:
        feeds["OpenPhish"] = (OPENPHISH, 12 * 3600)
    return feeds


def parse_feed(name, data):
    urls = data.decode("utf-8").splitlines()
    result = set()
    for url in urls:
        try:
            result.add(url_key(url.strip()))
        except (ValueError, UnicodeError, AttributeError):
            continue
    if not result:
        raise ValueError("Empty or invalid feed; retain previous snapshot")
    return result


def refresh():
    for name, (endpoint, interval) in configured().items():
        now = time.time()
        with _lock:
            last = _snapshots.get(name, {}).get("updated", 0)
            if now - last < interval or now - _attempts.get(name, 0) < 3600:
                continue
            _attempts[name] = now
        try:
            with requests.get(
                endpoint,
                headers={"User-Agent": "CyberGuard-extension/1.0 threat-feed-cache"},
                timeout=(5, 20),
                stream=True,
            ) as response:
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise ValueError("Feed too large")
            urls = parse_feed(name, bytes(data))
            with _lock:
                _snapshots[name] = {"updated": time.time(), "urls": urls}
                payload = {
                    k: {"updated": v["updated"], "urls": sorted(v["urls"])}
                    for k, v in _snapshots.items()
                }
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            temporary = CACHE.with_suffix(".tmp")
            temporary.write_text(json.dumps(payload))
            temporary.replace(CACHE)
        except (requests.RequestException, ValueError, KeyError, OSError):
            # Never log a keyed endpoint or exception containing credentials.
            logging.getLogger(__name__).warning(
                "%s feed refresh failed; retaining cached data", name
            )


def lookup(url):
    key = url_key(url)
    matches, status, incomplete = [], [], False
    with _lock:
        for name, (_, interval) in configured().items():
            snapshot = _snapshots.get(name)
            if not snapshot or time.time() - snapshot["updated"] > interval * 2:
                incomplete = True
                status.append(f"{name} feed is unavailable or stale.")
                continue
            from datetime import datetime, timezone

            updated = datetime.fromtimestamp(
                snapshot["updated"], timezone.utc
            ).isoformat()
            status.append(f"{name} feed last downloaded: {updated}.")
            if key in snapshot["urls"]:
                matches.append(name)
    return matches, status, incomplete


def run_refresh_loop(stop):
    try:
        if CACHE.stat().st_size <= MAX_BYTES:
            payload = json.loads(CACHE.read_text())
            with _lock:
                for name, value in payload.items():
                    if (
                        name in configured()
                        and isinstance(value.get("updated"), (int, float))
                        and value["updated"] <= time.time()
                    ):
                        _snapshots[name] = {
                            "updated": value["updated"],
                            "urls": {url_key(u) for u in value["urls"]},
                        }
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    while not stop.is_set():
        refresh()
        stop.wait(60)
