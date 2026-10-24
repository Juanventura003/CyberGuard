"""Server-only persistence for the rolling news feed; saved user copies are separate."""

import httpx
from .config import settings


class NewsStorageError(Exception):
    pass


def sync_articles(items, fetched_at=None):
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise NewsStorageError("Persistent news storage is not configured.")
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    try:
        # Recovery can contain more than one publisher fetch. Respect the RPC's
        # input limit; retries safely upsert any batches already stored.
        batches = (
            [None]
            if items is None
            else [items[i : i + 1000] for i in range(0, len(items), 1000)] or [[]]
        )
        for batch in batches:
            response = httpx.post(
                f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/rpc/cg_sync_news_feed",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                json={"items": batch, "fetch_time": fetched_at},
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("articles"), list):
                raise ValueError("Invalid news storage response.")
        return data
    except (httpx.HTTPError, ValueError) as exc:
        raise NewsStorageError("Persistent news storage is unavailable.") from exc
