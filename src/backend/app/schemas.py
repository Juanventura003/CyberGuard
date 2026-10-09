from typing import Literal

from pydantic import BaseModel, Field
from .config import MAX_EMAILS_PER_BATCH


class ManualEmailInput(BaseModel):
    sender: str
    subject: str = ""
    body: str = ""
    urls: list[str] = []


class BatchManualRequest(BaseModel):
    emails: list[ManualEmailInput] = Field(..., min_length=1, max_length=MAX_EMAILS_PER_BATCH)


class GmailAnalyzeRequest(BaseModel):
    session: str
    message_ids: list[str] = Field(..., min_length=1, max_length=MAX_EMAILS_PER_BATCH)


class GmailTrashRequest(BaseModel):
   session: str
   message_ids: list[str] = Field(..., min_length=1, max_length=MAX_EMAILS_PER_BATCH)




class GmailTrashFailure(BaseModel):
   id: str
   error: str


class GmailTrashResponse(BaseModel):
   trashed: list[str]
   failed: list[GmailTrashFailure]


class EmailResult(BaseModel):
    source: str  # "manual" | "gmail"
    id: str | None = None
    sender: str
    subject: str
    risk_score: float
    classification: str
    confidence: float
    explanation: list[str]
    error: str | None = None


class GmailHeaderItem(BaseModel):
    id: str
    sender: str
    subject: str
    date: str
    snippet: str


class WebsiteAnalyzeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class WebsiteAnalyzeResponse(BaseModel):
    url: str
    domain: str
    risk_score: float
    risk_level: Literal["HIGH_RISK", "SUSPICIOUS", "NO_KNOWN_THREAT", "UNABLE_TO_VERIFY"]
    source: Literal["GOOGLE_WEB_RISK", "UNABLE_TO_VERIFY"]
    threat_types: list[str]
    explanation: list[str]
    expire_time: str | None = None


class WebsiteHistoryEntry(BaseModel):
    id: str | None = None
    url: str
    domain: str
    risk_score: float
    risk_level: Literal["HIGH_RISK", "SUSPICIOUS", "NO_KNOWN_THREAT", "UNABLE_TO_VERIFY"]
    source: Literal["GOOGLE_WEB_RISK", "UNABLE_TO_VERIFY"]
    threat_types: list[str]
    explanation: list[str]
    visited_at: str
class LinkCheckRequest(BaseModel):
    url: str
