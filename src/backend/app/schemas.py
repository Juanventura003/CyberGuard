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
