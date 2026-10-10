"""
Gmail OAuth + Gmail API access.

Flow:
  1. login(return_to)      -> Google consent screen URL, remembers where to
                               send the browser back to when done
  2. handle_callback(...)  -> exchanges the auth code for tokens, opens a
                               session, returns (session_id, return_to)
  3. list_recent(session)  -> lightweight headers for the inbox picker
  4. get_full_email(...)   -> full sender/subject/body/urls for scoring
"""
import base64
import json
import os
import re
import time
from email.utils import parseaddr
from threading import Lock
from concurrent.futures import ThreadPoolExecutor

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .config import settings, GMAIL_SCOPES
from . import session_store

# Google returns previously granted scopes too (include_granted_scopes), which
# oauthlib otherwise treats as a fatal "Scope has changed" error.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

URL_RE = re.compile(r"https?://[^\s\"'<>)]+")

# Maps OAuth "state" -> where to redirect the browser once the callback
# finishes. Short-lived and self-cleaning; only needed for the few seconds
# between "click Connect Gmail" and Google redirecting back.
_pending_state: dict[str, dict] = {}
_state_lock = Lock()
_STATE_TTL_SECONDS = 600


def _build_flow(code_verifier: str | None = None) -> Flow:
    client_config = {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }
    return Flow.from_client_config(
        client_config, scopes=GMAIL_SCOPES, redirect_uri=settings.GOOGLE_REDIRECT_URI, code_verifier=code_verifier
    )


def start_login(return_to: str) -> str:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise RuntimeError(
            "Gmail OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in src/backend/.env."
        )

    flow = _build_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )

    _cleanup_expired_state()
    with _state_lock:
        _pending_state[state] = {
            "return_to": return_to,
            "code_verifier": flow.code_verifier,  # PKCE: the callback must send the same verifier
            "created_at": time.time(),
        }

    return auth_url


def pop_pending(state: str) -> dict | None:
    with _state_lock:
        return _pending_state.pop(state, None)


def handle_callback(code: str, state: str) -> tuple[str, str]:
    pending = pop_pending(state)
    if pending is None:
        raise RuntimeError("This login link expired or was already used. Please click Connect Gmail again.")

    flow = _build_flow(code_verifier=pending.get("code_verifier"))
    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        raise RuntimeError(f"Google sign-in failed: {exc}") from exc
    session_id = session_store.create_session(flow.credentials.to_json())
    return session_id, pending["return_to"]


def _cleanup_expired_state() -> None:
    now = time.time()
    with _state_lock:
        expired = [s for s, v in _pending_state.items() if now - v["created_at"] > _STATE_TTL_SECONDS]
        for s in expired:
            del _pending_state[s]


def _get_gmail_service(session_id: str):
    creds_json = session_store.get_credentials(session_id)
    if creds_json is None:
        raise LookupError("No active Gmail session. Please reconnect your Gmail account.")

    creds = Credentials.from_authorized_user_info(json.loads(creds_json), GMAIL_SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        session_store.update_credentials(session_id, creds.to_json())

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def list_recent(session_id: str, limit: int = 50) -> list[dict]:
    service = _get_gmail_service(session_id)
    limit = max(1, min(limit, 100))

    msg_list = service.users().messages().list(userId="me", maxResults=limit, labelIds=["INBOX"]).execute()
    message_refs = msg_list.get("messages", [])

    results = []
    for ref in message_refs:
        msg = (
            service.users().messages()
            .get(userId="me", id=ref["id"], format="metadata", metadataHeaders=["From", "Subject", "Date"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        results.append({
            "id": msg["id"],
            "sender": headers.get("From", "(unknown sender)"),
            "subject": headers.get("Subject", "(no subject)"),
            "date": headers.get("Date", ""),
            "snippet": msg.get("snippet", ""),
        })
    return results


def _decode_part(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8") + b"==").decode("utf-8", errors="replace")


def _extract_plain_text(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return _decode_part(payload["body"]["data"])

    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data") and "parts" not in payload:
        html = _decode_part(payload["body"]["data"])
        return re.sub(r"<[^>]+>", " ", html)

    for part in payload.get("parts", []) or []:
        text = _extract_plain_text(part)
        if text:
            return text
    return ""


def get_full_email(session_id: str, message_id: str) -> dict:
    service = _get_gmail_service(session_id)
    msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    payload = msg.get("payload", {})
    headers = {h["name"]: h["value"] for h in payload.get("headers", [])}

    raw_from = headers.get("From", "")
    display_name, sender_email = parseaddr(raw_from)
    sender = sender_email or raw_from

    body = _extract_plain_text(payload) or msg.get("snippet", "")
    urls = list(dict.fromkeys(URL_RE.findall(body)))  # de-duped, order preserved

    return {
        "id": message_id,
        "sender": sender,
        "sender_display": display_name or sender,
        "subject": headers.get("Subject", "(no subject)"),
        "body": body,
        "urls": urls,
    }

def trash_message(session_id: str, message_id: str) -> None:
   service = _get_gmail_service(session_id)
   try:
       service.users().messages().trash(userId="me", id=message_id).execute()
   except HttpError as exc:
       if exc.resp.status == 403:
           raise PermissionError(
               "Gmail did not grant permission to move messages to Trash. Please reconnect your Gmail account."
           ) from exc
       raise

def _attachment_parts(payload: dict) -> list[dict]:
    found = []

    def walk(part: dict):
        filename = part.get("filename", "")
        body = part.get("body", {})

        if filename and (body.get("attachmentId") or body.get("data")):
            found.append({
                "filename": filename,
                "attachment_id": body.get("attachmentId"),
                "size": body.get("size", 0),
                "inline_data": body.get("data"),
            })

        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload)
    return found




def list_attachments(session_id: str, limit: int = 50) -> list[dict]:
    service = _get_gmail_service(session_id)

    limit = max(1, min(limit, 100))

    response = service.users().messages().list(
        userId="me",
        labelIds=["INBOX"],
        maxResults=limit,
    ).execute()

    message_refs = response.get("messages", [])

    # Get credentials once, then create a separate Gmail
    # service per worker for safe concurrent requests.
    creds_json = session_store.get_credentials(session_id)

    if creds_json is None:
        raise LookupError(
            "No active Gmail session. Please reconnect your Gmail account."
        )

    def fetch_email(ref: dict) -> dict:
        credentials = Credentials.from_authorized_user_info(
            json.loads(creds_json),
            GMAIL_SCOPES,
        )

        worker_service = build(
            "gmail",
            "v1",
            credentials=credentials,
            cache_discovery=False,
        )

        msg = worker_service.users().messages().get(
            userId="me",
            id=ref["id"],
            format="full",
        ).execute()

        payload = msg.get("payload", {})

        headers = {
            h["name"].lower(): h["value"]
            for h in payload.get("headers", [])
        }

        attachments = _attachment_parts(payload)

        return {
            "id": msg["id"],
            "sender": headers.get(
                "from", "(unknown sender)"
            ),
            "subject": headers.get(
                "subject", "(no subject)"
            ),
            "date": headers.get("date", ""),
            "snippet": msg.get("snippet", ""),
            "attachments": [
                {
                    "index": index,
                    "filename": item["filename"],
                    "size": item["size"],
                }
                for index, item in enumerate(attachments)
            ],
        }

    # Fetch up to 8 emails simultaneously instead of
    # waiting for each individual Gmail request.
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(fetch_email, message_refs)
        )

    return results

def get_attachment(
    session_id: str,
    message_id: str,
    attachment_index: int,
) -> tuple[str, bytes]:
    service = _get_gmail_service(session_id)

    msg = service.users().messages().get(
        userId="me",
        id=message_id,
        format="full",
    ).execute()

    attachments = _attachment_parts(msg.get("payload", {}))

    if attachment_index < 0 or attachment_index >= len(attachments):
        raise ValueError("Attachment not found.")

    item = attachments[attachment_index]
    max_size = 25 * 1024 * 1024

    if item["size"] > max_size:
        raise ValueError("File must be 25 MB or smaller.")

    if item["attachment_id"]:
        attachment = service.users().messages().attachments().get(
            userId="me",
            messageId=message_id,
            id=item["attachment_id"],
        ).execute()
        encoded = attachment["data"]
    else:
        encoded = item["inline_data"]

    if not encoded:
        raise ValueError("Attachment has no downloadable data.")

    contents = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))

    if len(contents) > max_size:
        raise ValueError("File must be 25 MB or smaller.")

    return item["filename"], contents
