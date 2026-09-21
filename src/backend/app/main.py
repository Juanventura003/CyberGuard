import asyncio
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import gmail_oauth, phishing_detector
from .config import settings, MAX_EMAILS_PER_BATCH
from .schemas import BatchManualRequest, GmailAnalyzeRequest, EmailResult, GmailHeaderItem

app = FastAPI(title="CyberGuard Email Scanner", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "healthy"}


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

    semaphore = asyncio.Semaphore(8)  #don't hit Gmail's API quotas and limits

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
