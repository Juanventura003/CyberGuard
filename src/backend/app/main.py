import asyncio
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse

from fastapi import FastAPI, Header, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import gmail_oauth, phishing_detector, link_checker
from .config import settings, MAX_EMAILS_PER_BATCH
from .schemas import (
    BatchManualRequest,
    GmailAnalyzeRequest,
    EmailResult,
    GmailHeaderItem,
    WebsiteAnalyzeRequest,
    WebsiteAnalyzeResponse,
    WebsiteHistoryEntry,
)
from .web_risk import WebRiskLookupError, lookup_url
from . import supabase_store
from .schemas import BatchManualRequest, GmailAnalyzeRequest, EmailResult, GmailHeaderItem, LinkCheckRequest

app = FastAPI(title="CyberGuard Email Scanner", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "healthy"}

# Link Checker
@app.post("/api/security/link-check")
def check_link(payload: LinkCheckRequest):
    try:
        result = link_checker.check_url(payload.url)
        return result

@app.get("/api/websites/history", response_model=list[WebsiteHistoryEntry])
def get_website_history(
    limit: int = Query(20, ge=1, le=100),
    since: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    user_id = _authenticated_user_id(authorization)
    if not user_id:
        return []

    try:
        return supabase_store.list_history(user_id, limit, since)
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.delete("/api/websites/history/{history_id}", status_code=204)
def delete_website_history(
    history_id: str = Path(..., min_length=1),
    url: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    user_id = _authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in before deleting website history.")

    try:
        supabase_store.delete_history(user_id, history_id, url)
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/websites/history", response_model=WebsiteHistoryEntry)
def store_website_history(
    payload: WebsiteAnalyzeResponse,
    authorization: str | None = Header(default=None),
):
    history_entry = WebsiteHistoryEntry(
        url=payload.url,
        domain=payload.domain,
        risk_score=payload.risk_score,
        risk_level=payload.risk_level,
        source=payload.source,
        threat_types=payload.threat_types,
        explanation=payload.explanation,
        visited_at=datetime.now(timezone.utc).isoformat(),
    )

    user_id = _authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in before saving website history.")

    try:
        return supabase_store.insert_history(user_id, history_entry.model_dump(exclude_none=True))
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _authenticated_user_id(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    if not supabase_store.is_configured():
        raise HTTPException(status_code=503, detail="Supabase persistence is not configured.")

    try:
        user_id = supabase_store.get_user_id(authorization.removeprefix("Bearer ").strip())
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid Supabase access token.")
    return user_id


@app.post("/api/websites/analyze", response_model=WebsiteAnalyzeResponse)
def analyze_website(
    payload: WebsiteAnalyzeRequest,
    authorization: str | None = Header(default=None),
):
    parsed_url = urlparse(payload.url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise HTTPException(status_code=400, detail="URL must include an http or https scheme.")

    try:
        lookup = lookup_url(payload.url)
    except WebRiskLookupError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    threat_types = lookup["threat_types"]
    if "MALWARE" in threat_types or "SOCIAL_ENGINEERING" in threat_types:
        risk_score = 95.0
        risk_level = "HIGH_RISK"
        explanation = ["Google Web Risk identified this URL as a known malicious threat."]
    elif "UNWANTED_SOFTWARE" in threat_types:
        risk_score = 80.0
        risk_level = "SUSPICIOUS"
        explanation = ["Google Web Risk identified this URL as associated with unwanted software."]
    else:
        risk_score = 0.0
        risk_level = "NO_KNOWN_THREAT"
        transport_note = (
            "HTTPS is enabled, which protects the connection in transit."
            if parsed_url.scheme == "https"
            else "This site does not use HTTPS, so the connection is not encrypted in transit."
        )
        explanation = [
            f"Google Web Risk found no known threat for this URL. {transport_note}",
            "No known threat is not a guarantee that the website is safe.",
        ]

    response = WebsiteAnalyzeResponse(
        url=payload.url,
        domain=parsed_url.hostname or parsed_url.netloc,
        risk_score=risk_score,
        risk_level=risk_level,
        source="GOOGLE_WEB_RISK",
        threat_types=threat_types,
        explanation=explanation,
        expire_time=lookup["expire_time"],
    )

    user_id = _authenticated_user_id(authorization)
    if user_id:
        history_entry = WebsiteHistoryEntry(
            url=response.url,
            domain=response.domain,
            risk_score=response.risk_score,
            risk_level=response.risk_level,
            source=response.source,
            threat_types=response.threat_types,
            explanation=response.explanation,
            visited_at=datetime.now(timezone.utc).isoformat(),
        )
        try:
            supabase_store.insert_history(user_id, history_entry.model_dump(exclude_none=True))
        except supabase_store.SupabaseStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return response


    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not check URL: {exc}"
        )
# ---------------------------------------------------------------------------
# Manual paste-in (no Gmail account needed)
# ---------------------------------------------------------------------------

@app.post("/api/email/batch-analyze", response_model=list[EmailResult])
def batch_analyze_manual(payload: BatchManualRequest):
    results = []
    for item in payload.emails:
        scored = phishing_detector.analyze_email(item.sender, item.subject, item.body, item.urls)
        results.append(EmailResult(
            source="manual", id=None, sender=item.sender, subject=item.subject or "(no subject)", **scored,
        ))
    return results


# ---------------------------------------------------------------------------
# Gmail OAuth
# ---------------------------------------------------------------------------

@app.get("/api/email/oauth/login")
def oauth_login(return_to: str = Query(...)):
    if not return_to.startswith(settings.FRONTEND_ORIGIN):
        raise HTTPException(status_code=400, detail="return_to must point back at the configured frontend origin.")
    try:
        auth_url = gmail_oauth.start_login(return_to)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return RedirectResponse(auth_url)


@app.get("/api/email/oauth/callback")
def oauth_callback(code: str | None = None, state: str = "", error: str | None = None):
    if error:
        pending = gmail_oauth.pop_pending(state)
        return_to = pending["return_to"] if pending else settings.FRONTEND_ORIGIN
        return RedirectResponse(f"{return_to}?{urlencode({'gmail_error': error})}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code from Google.")

    try:
        session_id, return_to = gmail_oauth.handle_callback(code, state)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return RedirectResponse(f"{return_to}?{urlencode({'gmail_session': session_id})}")


@app.get("/api/email/gmail/list", response_model=list[GmailHeaderItem])
def gmail_list(session: str = Query(...), limit: int = Query(50, le=100)):
    try:
        return gmail_oauth.list_recent(session, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:  # Gmail API errors, expired refresh token, etc.
        raise HTTPException(status_code=502, detail=f"Could not read Gmail inbox: {exc}")


@app.post("/api/email/gmail/analyze", response_model=list[EmailResult])
async def gmail_analyze(payload: GmailAnalyzeRequest):
    if len(payload.message_ids) > MAX_EMAILS_PER_BATCH:
        raise HTTPException(status_code=400, detail=f"Select at most {MAX_EMAILS_PER_BATCH} emails at a time.")

    semaphore = asyncio.Semaphore(8)

    async def fetch_and_score(message_id: str) -> EmailResult:
        async with semaphore:
            try:
                full = await asyncio.to_thread(gmail_oauth.get_full_email, payload.session, message_id)
            except LookupError as exc:
                raise HTTPException(status_code=401, detail=str(exc))
            except Exception as exc:
                return EmailResult(
                    source="gmail", id=message_id, sender="(unavailable)", subject="(unavailable)",
                    risk_score=0, classification="ERROR", confidence=0,
                    explanation=[], error=f"Could not fetch this message: {exc}",
                )

            scored = phishing_detector.analyze_email(full["sender"], full["subject"], full["body"], full["urls"])
            return EmailResult(source="gmail", id=message_id, sender=full["sender"], subject=full["subject"], **scored)

    return await asyncio.gather(*(fetch_and_score(mid) for mid in payload.message_ids))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
