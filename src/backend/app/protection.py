"""Device enrollment and credential-based rule sync; credentials never appear in URLs."""

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from uuid import UUID
from .config import settings

router = APIRouter(prefix="/api/protection", tags=["Organization protection"])


class Enrollment(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=80)
    version: str = Field(min_length=1, max_length=40)
    browser: str = Field(default="Unknown", max_length=20)
    os: str = Field(default="Unknown", max_length=20)


class Sync(BaseModel):
    token: str = Field(pattern=r"^[a-f0-9]{64}$")
    version: str = Field(min_length=1, max_length=40)
    applied: int | None = Field(default=None, ge=0)


def rpc(
    name: str,
    payload: dict,
    authorization: str | None = None,
    *,
    expect_json: bool = True,
):
    # The Authorization token still determines the caller's database role.
    # Match the existing backend auth lookup when only a server API key is configured.
    key = (
        settings.SUPABASE_SERVICE_ROLE_KEY
        if authorization is None
        else (settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_ROLE_KEY)
    )
    if not settings.SUPABASE_URL or not key:
        raise HTTPException(503, "Supabase protection configuration is missing.")
    try:
        response = httpx.post(
            f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/rpc/{name}",
            headers={"apikey": key, "Authorization": authorization or f"Bearer {key}"},
            json=payload,
            timeout=12,
        )
    except httpx.RequestError as exc:
        raise HTTPException(503, "Protection service is unavailable.") from exc
    if not response.is_success:
        if response.status_code >= 500:
            raise HTTPException(503, "Protection service is unavailable.")
        # Do not return database details or credential material to callers.
        raise HTTPException(
            403,
            "Protection request denied. Check membership, credentials, and SQL setup.",
        )
    if not expect_json:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(
            502, "Protection service returned an invalid response."
        ) from exc


@router.post("/enroll")
def enroll(payload: Enrollment, authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in before enrolling a browser.")
    return rpc(
        "cg_enroll_browser_v3",
        {
            "org": str(payload.organization_id),
            "browser_name": payload.name,
            "version": payload.version,
            "browser": payload.browser,
            "os": payload.os,
        },
        authorization,
    )


@router.post("/sync")
def sync(payload: Sync):
    return rpc(
        "cg_browser_sync_v2",
        {
            "secret": payload.token,
            "version": payload.version,
            "applied": payload.applied,
        },
    )


@router.post("/disconnect")
def disconnect(payload: Sync):
    rpc("cg_browser_disconnect", {"secret": payload.token}, expect_json=False)
    return {"ok": True}
