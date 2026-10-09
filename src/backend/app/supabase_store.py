from typing import Any

import httpx

from .config import settings


class SupabaseStoreError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)


def get_user_id(access_token: str) -> str | None:
    if not is_configured():
        return None

    response = httpx.get(
        f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {access_token}",
        },
        timeout=10,
    )
    if response.status_code == 401:
        return None
    if response.status_code == 403 and response.json().get("error_code") == "session_not_found":
        return None
    if not response.is_success:
        detail = response.text[:200].replace("\n", " ")
        raise SupabaseStoreError(
            f"Supabase auth lookup failed with status {response.status_code}: {detail}"
        )
    user_id = response.json().get("id")
    return user_id if isinstance(user_id, str) else None


def list_history(user_id: str, limit: int, since: str | None = None) -> list[dict[str, Any]]:
    params = {
        "select": "id,url,domain,risk_score,risk_level,source,threat_types,explanation,visited_at",
        "user_id": f"eq.{user_id}",
        "risk_level": "neq.UNABLE_TO_VERIFY",
        "order": "visited_at.desc",
        "limit": str(limit),
    }
    if since:
        params["visited_at"] = f"gte.{since}"

    response = httpx.get(
        f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/website_history",
        params=params,
        headers=_service_headers(),
        timeout=10,
    )
    if not response.is_success:
        raise SupabaseStoreError(f"Supabase history read failed with status {response.status_code}.")
    return response.json()


def delete_history(user_id: str, history_id: str, url: str | None = None) -> None:
    filters = {"user_id": f"eq.{user_id}"}
    if url:
        filters["url"] = f"eq.{url}"
    else:
        filters["id"] = f"eq.{history_id}"
    response = httpx.delete(
        f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/website_history",
        params=filters,
        headers=_service_headers(),
        timeout=10,
    )
    if not response.is_success:
        raise SupabaseStoreError(f"Supabase history delete failed with status {response.status_code}.")


def delete_all_history(user_id: str) -> None:
    response = httpx.delete(
        f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/website_history",
        params={"user_id": f"eq.{user_id}"},
        headers=_service_headers(),
        timeout=10,
    )
    if not response.is_success:
        raise SupabaseStoreError(f"Supabase history delete failed with status {response.status_code}.")


def insert_history(user_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    history_row = {
        **entry,
        "risk_score": round(float(entry["risk_score"])),
    }
    response = httpx.post(
        f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/website_history",
        json={"user_id": user_id, **history_row},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=10,
    )
    if not response.is_success:
        detail = response.text[:240].replace("\n", " ")
        raise SupabaseStoreError(
            f"Supabase history write failed with status {response.status_code}: {detail}"
        )
    rows = response.json()
    if not rows:
        raise SupabaseStoreError("Supabase history write returned no row.")
    return rows[0]


def _service_headers() -> dict[str, str]:
    return {
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }