import logging
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

import os
import re
import httpx
import asyncio
import dns.resolver
import dns.exception
from email_validator import validate_email, EmailNotValidError
from pathlib import Path as FilePath
from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Event, Thread
from urllib.parse import urlencode, urlparse
from urllib.parse import urlencode, urlparse, urlsplit, urlunsplit, parse_qsl

from fastapi import FastAPI, Header, HTTPException, Path, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import gmail_oauth, phishing_detector, file_checker
from .config import settings, MAX_EMAILS_PER_BATCH
from .schemas import (
    BatchManualRequest,
    GmailAnalyzeRequest,
    GmailTrashRequest,
    GmailTrashResponse,
    EmailResult,
    GmailHeaderItem,
    WebsiteAnalyzeRequest,
    WebsiteAnalyzeResponse,
    WebsiteHistoryEntry,
    WebsiteHistorySyncRequest,
    WebsiteHistorySyncResponse,
    PageAnalyzeRequest,
)
from .website_analyzer import analyze_url, analyze_page_signals
from . import supabase_store
from . import news_feed
from . import threat_feeds
from .protection import router as protection_router

load_dotenv(FilePath(__file__).resolve().parents[1] / ".env")

from difflib import SequenceMatcher
import re

@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = Event()
    worker = Thread(
        target=news_feed.run_refresh_loop,
        args=(stop,),
        name="cyberguard-news-refresh",
        daemon=True,
    )
    feed_worker = Thread(
        target=threat_feeds.run_refresh_loop,
        args=(stop,),
        name="extension-threat-feeds",
        daemon=True,
    )
    feed_worker.start()
    worker.start()
    try:
        yield
    finally:
        stop.set()
        await asyncio.to_thread(worker.join, 20)
        await asyncio.to_thread(feed_worker.join, 25)


app = FastAPI(
    title="CyberGuard Email Scanner",
    version="1.0.0",
    lifespan=lifespan,
)


class EmailCheckRequest(BaseModel):
    email: str

class PhoneReputationRequest(BaseModel):
    phone_number: str
    country: str = "US"


@app.post("/api/security/phone-reputation")
async def check_phone_reputation(request: PhoneReputationRequest):
    api_key = os.getenv("IPQS_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Phone reputation API is not configured. "
                "Add IPQS_API_KEY to src/backend/.env and restart the backend."
            ),
        )

    phone = re.sub(r"[^\d+]", "", request.phone_number)

    if not re.fullmatch(r"\+?\d{7,15}", phone):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid phone number."
        )

    country = request.country.upper()

    if not re.fullmatch(r"[A-Z]{2}", country):
        raise HTTPException(
            status_code=400,
            detail="Invalid country code."
        )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://ipqualityscore.com/api/json/phone",
                headers={"IPQS-KEY": api_key},
                params={
                    "phone": phone,
                    "country": country,
                    "strictness": 0
                }
            )

            response.raise_for_status()
            data = response.json()

    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Phone reputation service is unavailable."
        )

    if data.get("success") is not True:
        raise HTTPException(
            status_code=502,
            detail="Phone reputation lookup failed. Check API access or credits."
        )

    score = data.get("fraud_score")

    if not isinstance(score, int) or not 0 <= score <= 100:
        score = None

    return {
        "fraud_score": score,
        "spammer": data.get("spammer"),
        "recent_abuse": data.get("recent_abuse"),
        "risky": data.get("risky"),
        "voip": data.get("VOIP"),
        "carrier": data.get("carrier"),
        "line_type": data.get("line_type"),
        "valid": data.get("valid")
    }
app.include_router(protection_router)

#email address checker
DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com",
    "guerrillamail.com",
    "10minutemail.com",
    "tempmail.com",
    "yopmail.com",
    "trashmail.com",
}


@app.post("/api/security/email-check")
async def check_email_address(request: EmailCheckRequest):
    email = request.email.strip()

    if not email or len(email) > 254:
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid email address."
        )

    try:
        validated = validate_email(
            email,
            check_deliverability=False
        )
    except EmailNotValidError as exc:
        return {
            "valid_format": False,
            "email": email,
            "domain": None,
            "domain_exists": None,
            "has_mx_records": None,
            "mx_records": [],
            "disposable": None,
            "recommendations": [
                str(exc)
            ],
        }

    domain = validated.domain.lower()

    def lookup_dns():
        resolver = dns.resolver.Resolver()
        resolver.timeout = 2
        resolver.lifetime = 5

        domain_exists = None
        has_mx_records = None
        mx_records = []
        dns_error = None

        try:
            mx_answers = resolver.resolve(domain, "MX")

            mx_records = [
                str(record.exchange).rstrip(".")
                for record in mx_answers
                if str(record.exchange) != "."
            ]

            domain_exists = True
            has_mx_records = len(mx_records) > 0

        except dns.resolver.NXDOMAIN:
            domain_exists = False
            has_mx_records = False

        except dns.resolver.NoAnswer:
            domain_exists = True
            has_mx_records = False

        except (dns.exception.Timeout, dns.resolver.NoNameservers):
            dns_error = "DNS lookup could not be completed."

        return domain_exists, has_mx_records, mx_records, dns_error

    domain_exists, has_mx_records, mx_records, dns_error = (
        await asyncio.to_thread(lookup_dns)
    )

    disposable = domain in DISPOSABLE_EMAIL_DOMAINS

    recommendations = []

    if domain_exists is False:
        recommendations.append(
            "The email domain could not be found in DNS."
        )

    if has_mx_records is False:
        recommendations.append(
            "No mail exchange (MX) records were found. "
            "Some domains can receive mail through address-record fallback."
        )

    if disposable:
        recommendations.append(
            "This domain is commonly associated with temporary email services."
        )

    if dns_error:
        recommendations.append(dns_error)

    if not recommendations:
        recommendations.append(
            "No obvious email formatting or domain configuration issues were detected."
        )

    return {
        "valid_format": True,
        "email": validated.normalized,
        "domain": domain,
        "domain_exists": domain_exists,
        "has_mx_records": has_mx_records,
        "mx_records": mx_records,
        "disposable": disposable,
        "recommendations": recommendations,
    }

class EmailReputationRequest(BaseModel):
    email: str

PROTECTED_BRANDS = {
    "Google": {"google.com", "gmail.com"},
    "Microsoft": {"microsoft.com", "outlook.com", "office.com"},
    "PayPal": {"paypal.com"},
    "Amazon": {"amazon.com"},
    "Apple": {"apple.com", "icloud.com"},
    "Handshake": {"joinhandshake.com"},
}

def detect_email_impersonation(email: str) -> dict:
    domain = email.rsplit("@", 1)[-1].lower().rstrip(".")

    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError:
        ascii_domain = domain

    for brand, domains in PROTECTED_BRANDS.items():
        for official in domains:
            if ascii_domain == official or ascii_domain.endswith("." + official):
                return {
                    "status": "recognized_domain",
                    "brand": brand,
                    "details": (
                        f"The domain matches a listed {brand} domain "
                        "or one of its subdomains. This does not "
                        "authenticate the sender."
                    ),
                }

    parts = ascii_domain.split(".")
    if len(parts) < 2:
        return {
            "status": "not_detected",
            "brand": None,
            "details": "No lookalike pattern detected.",
        }

    domain_name = parts[-2]
    normalized_name = re.sub(r"[-_]", "", domain_name)

    for brand, domains in PROTECTED_BRANDS.items():
        for official in domains:
            official_name = official.split(".")[0]

            similarity = SequenceMatcher(
                None, normalized_name, official_name
            ).ratio()

            substitutions = str.maketrans({
                "0": "o",
                "1": "l",
                "3": "e",
                "5": "s",
            })
            decoded_name = normalized_name.translate(substitutions)

            suspicious = (
                decoded_name == official_name
                or (
                    similarity >= 0.82
                    and normalized_name != official_name
                )
            )

            if suspicious:
                return {
                    "status": "possible_impersonation",
                    "brand": brand,
                    "details": (
                        f"This domain resembles {brand}'s "
                        f"listed domain ({official}). "
                        "It may be an impersonation attempt."
                    ),
                }

    return {
        "status": "not_detected",
        "brand": None,
        "details": (
            "No lookalike pattern was detected against "
            "the configured brand list."
        ),
    }

@app.post("/api/security/email-reputation")
async def check_email_reputation(request: EmailReputationRequest):
    api_key = os.getenv("IPQS_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Email reputation API is not configured. "
                "Add IPQS_API_KEY to src/backend/.env and restart the backend."
            ),
        )

    try:
        validated = validate_email(
            request.email.strip(),
            check_deliverability=False
        )
    except EmailNotValidError:
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid email address."
        )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://www.ipqualityscore.com/api/json/email/"
                + api_key + "/"
                + validated.normalized,
                params={
                    "fast": "true",
                    "abuse_strictness": 0,
                },
            )

            response.raise_for_status()
            data = response.json()

    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Email reputation service is unavailable."
        )

    if data.get("success") is not True:
        raise HTTPException(
            status_code=502,
            detail="Email reputation lookup failed. Check API access or credits."
        )

    score = data.get("fraud_score")

    if (
        isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not 0 <= score <= 100
    ):
        score = None

    recent_abuse = data.get("recent_abuse")
    disposable = data.get("disposable")
    honeypot = data.get("honeypot")
    leaked = data.get("leaked")

    impersonation = detect_email_impersonation(validated.normalized)

    warnings = []
    positive_signals = []
    unavailable_checks = []

    if recent_abuse is True:
        warnings.append("Recent abusive activity was reported.")
    elif recent_abuse is False:
        positive_signals.append("No recent abuse was reported.")
    else:
        unavailable_checks.append("Recent abuse information")

    if disposable is True:
        warnings.append("The address uses a disposable email service.")
    elif disposable is False:
        positive_signals.append("Not identified as a disposable address.")
    else:
        unavailable_checks.append("Disposable email detection")

    if honeypot is True:
        warnings.append("The address was identified as a potential spam trap.")
    elif honeypot is False:
        positive_signals.append("No spam-trap indicator was reported.")
    else:
        unavailable_checks.append("Spam-trap detection")

    if leaked is True:
        warnings.append(
            "The provider reported a possible data leak association. "
            "This does not mean the owner is a scammer."
        )
    elif leaked is False:
        positive_signals.append("No data leak indicator was reported.")
    else:
        unavailable_checks.append("Data leak information")

    if impersonation["status"] == "possible_impersonation":
        warnings.append(impersonation["details"])
    elif impersonation["status"] == "recognized_domain":
        positive_signals.append(impersonation["details"])

    if score is None:
        unavailable_checks.append("Email reputation score")

    has_impersonation = (
        impersonation["status"] == "possible_impersonation"
    )

    has_security_signal = (
        has_impersonation
        or recent_abuse is True
        or honeypot is True
        or disposable is True
    )

    if score is None and not has_security_signal:
        cyberguard_score = None
    else:
        cyberguard_score = 0.0

        if score is not None:
            cyberguard_score += score * 0.60

        if has_impersonation:
            cyberguard_score += 75

        if recent_abuse is True:
            cyberguard_score += 35

        if honeypot is True:
            cyberguard_score += 35

        if disposable is True:
            cyberguard_score += 15

        cyberguard_score = min(100, round(cyberguard_score))

    if cyberguard_score is None:
        risk_level = "Unknown"
        risk_label = "Insufficient Reputation Data"
    elif cyberguard_score >= 75:
        risk_level = "High"
        risk_label = "High-Risk Indicators Detected"
    elif cyberguard_score >= 40:
        risk_level = "Medium"
        risk_label = "Elevated Risk Indicators"
    else:
        risk_level = "Low"
        risk_label = "Low Reported Risk"

    if not warnings:
        warnings.append(
            "No elevated warning indicators were detected by "
            "the available checks. This does not guarantee safety."
        )

    findings = warnings

    first_seen_data = data.get("first_seen")

    if isinstance(first_seen_data, dict):
        first_seen = first_seen_data.get("human")
    else:
        first_seen = None

    if not isinstance(first_seen, str) or not first_seen.strip():
        first_seen = None
    elif "from now" in first_seen.lower():
        first_seen = None

    
    return {
        "email": validated.normalized,
        "fraud_score": score,
        "cyberguard_score": cyberguard_score,
        "risk_level": risk_level,
        "risk_label": risk_label,
        "recent_abuse": recent_abuse,
        "disposable": disposable,
        "honeypot": honeypot,
        "leaked": leaked,
        "spam_trap_score": data.get("spam_trap_score"),
        "domain_trust": data.get("domain_trust"),
        "first_seen": first_seen,
        "findings": findings,
        "impersonation": impersonation,
        "warnings": warnings,
        "positive_signals": positive_signals,
        "unavailable_checks": unavailable_checks,
    }

def frontend_origins() -> list[str]:
    """Localhost and 127.0.0.1 are interchangeable for local OAuth return_to checks."""
    primary = settings.FRONTEND_ORIGIN.strip().rstrip("/")
    origins = {primary} if primary else set()
    if primary.startswith("http://localhost"):
        origins.add("http://127.0.0.1" + primary.removeprefix("http://localhost"))
    elif primary.startswith("http://127.0.0.1"):
        origins.add("http://localhost" + primary.removeprefix("http://127.0.0.1"))
    origins.update({"http://localhost:5173", "http://127.0.0.1:5173"})
    return sorted(origins)


def is_allowed_frontend_return(return_to: str) -> bool:
    return any(return_to.startswith(origin) for origin in frontend_origins())


app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def gmail_redirect_url(return_to: str, **values: str) -> str:
    parts = urlsplit(return_to)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    params.update(values)

    return urlunsplit((
        parts.scheme,
        parts.netloc,
        parts.path,
        urlencode(params),
        parts.fragment,
    ))


@app.get("/api/health")
def health():
    return {"status": "healthy"}


@app.get("/api/news")
def cybersecurity_news():
    try:
        return news_feed.get_news()
    except news_feed.NewsFeedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# File Checker
@app.post("/api/security/file-check")
async def check_uploaded_file(file: UploadFile = File(...)):
    max_file_size = 25 * 1024 * 1024

    contents = await file.read()

    if len(contents) > max_file_size:
        raise HTTPException(
            status_code=400,
            detail="File must be 25 MB or smaller."
        )

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="File must have a valid filename."
        )

    try:
        return file_checker.check_file(
            file.filename,
            contents
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not check file: {exc}"
        )

@app.get("/api/websites/history", response_model=list[WebsiteHistoryEntry])
def get_website_history(
    limit: int = Query(1000, ge=1, le=1000),
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


@app.post("/api/websites/history/sync", response_model=WebsiteHistorySyncResponse)
def sync_website_history(
    payload: WebsiteHistorySyncRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _authenticated_user_id(authorization)
    if not user_id:
        return {"entries": [], "ids": []}
    try:
        return supabase_store.sync_history(user_id, payload.known, payload.limit, payload.since)
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


@app.delete("/api/websites/history", status_code=204)
def delete_all_website_history(
    authorization: str | None = Header(default=None),
):
    user_id = _authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in before deleting website history.")

    try:
        supabase_store.delete_all_history(user_id)
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
        raise HTTPException(
            status_code=400, detail="URL must include an http or https scheme."
        )

    try:
        response = WebsiteAnalyzeResponse(**analyze_url(payload.url))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
            supabase_store.insert_history(
                user_id, history_entry.model_dump(exclude_none=True)
            )
        except supabase_store.SupabaseStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return response


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
    if not is_allowed_frontend_return(return_to):
        raise HTTPException(
            status_code=400,
            detail=(
                "return_to must point back at the configured frontend origin "
                f"({', '.join(frontend_origins())})."
            ),
        )
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
        return RedirectResponse(
            gmail_redirect_url(return_to, gmail_error=error)
        )

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code from Google.")

    try:
        session_id, return_to = gmail_oauth.handle_callback(code, state)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return RedirectResponse(
        gmail_redirect_url(return_to, gmail_session=session_id)
    )


@app.get("/api/email/gmail/list", response_model=list[GmailHeaderItem])
def gmail_list(session: str = Query(...), limit: int = Query(50, le=100)):
    try:
        return gmail_oauth.list_recent(session, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:  # Gmail API errors, expired refresh token, etc.
        raise HTTPException(status_code=502, detail=f"Could not read Gmail inbox: {exc}")

@app.get("/api/security/gmail/attachments")
def gmail_attachment_list(
    session: str = Query(...),
    limit: int = Query(50, ge=1, le=100),
):
    try:
        return gmail_oauth.list_attachments(session, limit)

    except LookupError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    except HttpError as exc:
        print("\n===== GMAIL API ERROR =====")
        print("Google HTTP Status:", exc.resp.status)
        print("Error Details:", exc)
        print("===========================\n")

        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Gmail attachments.",
        ) from exc

    except Exception as exc:
        import traceback

        print("\n===== UNEXPECTED GMAIL ERROR =====")
        traceback.print_exc()
        print("==================================\n")

        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Gmail attachments.",
        ) from exc


@app.post("/api/security/gmail/scan-attachment")
async def scan_gmail_attachment(
    session: str = Query(...),
    message_id: str = Query(...),
    attachment_index: int = Query(..., ge=0),
):
    try:
        filename, contents = await asyncio.to_thread(
            gmail_oauth.get_attachment,
            session,
            message_id,
            attachment_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Gmail attachment.",
        )

    try:
        return await asyncio.to_thread(
            file_checker.check_file,
            filename,
            contents,
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not scan Gmail attachment.",
        )

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


@app.post("/api/email/gmail/trash", response_model=GmailTrashResponse)
async def gmail_trash(payload: GmailTrashRequest):
   semaphore = asyncio.Semaphore(8)


   async def trash(message_id: str) -> str | None:
       async with semaphore:
           try:
               await asyncio.to_thread(gmail_oauth.trash_message, payload.session, message_id)
           except LookupError as exc:
               raise HTTPException(status_code=401, detail=str(exc))
           except PermissionError as exc:
               raise HTTPException(status_code=403, detail=str(exc))
           except Exception as exc:
               return f"Could not move this message to Trash: {exc}"
           return None


   errors = await asyncio.gather(*(trash(mid) for mid in payload.message_ids))
   return GmailTrashResponse(
       trashed=[mid for mid, err in zip(payload.message_ids, errors) if err is None],
       failed=[{"id": mid, "error": err} for mid, err in zip(payload.message_ids, errors) if err is not None],
   )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)


@app.post("/api/websites/page-signals")
def analyze_extension_page(payload: PageAnalyzeRequest):
    try:
        return analyze_page_signals(payload.url, payload.page.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/websites/history/{history_id}", response_model=WebsiteHistoryEntry)
def update_website_history(
    payload: WebsiteAnalyzeResponse,
    history_id: str = Path(..., min_length=1),
    authorization: str | None = Header(default=None),
):
    user_id = _authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in before updating website history."
        )
    try:
        return supabase_store.update_history(user_id, history_id, payload.model_dump())
    except supabase_store.SupabaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
