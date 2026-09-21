"""
In-memory session store.

Maps a random session id -> that person's Gmail OAuth credentials (as JSON)
plus a created-at timestamp. """
import time
import uuid
from threading import Lock

from .config import settings

_store: dict[str, dict] = {}
_lock = Lock()


def create_session(credentials_json: str) -> str:
    session_id = uuid.uuid4().hex
    with _lock:
        _store[session_id] = {"credentials": credentials_json, "created_at": time.time()}
    return session_id


def get_credentials(session_id: str) -> str | None:
    _cleanup_expired()
    with _lock:
        entry = _store.get(session_id)
    return entry["credentials"] if entry else None


def update_credentials(session_id: str, credentials_json: str) -> None:
    with _lock:
        if session_id in _store:
            _store[session_id]["credentials"] = credentials_json


def _cleanup_expired() -> None:
    ttl_seconds = settings.SESSION_TTL_MINUTES * 60
    now = time.time()
    with _lock:
        expired = [sid for sid, e in _store.items() if now - e["created_at"] > ttl_seconds]
        for sid in expired:
            del _store[sid]
