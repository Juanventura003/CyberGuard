from typing import Literal

from pydantic import BaseModel, Field, field_validator
from .brand_catalog import BRANDS
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
    risk_level: Literal[
        "HIGH_RISK", "SUSPICIOUS", "NO_KNOWN_THREAT", "UNABLE_TO_VERIFY"
    ]
    source: Literal["GOOGLE_WEB_RISK", "LAYERED_ANALYSIS", "UNABLE_TO_VERIFY"]
    threat_types: list[str]
    explanation: list[str]
    expire_time: str | None = None


class WebsiteHistoryEntry(BaseModel):
    id: str | None = None
    url: str
    domain: str
    risk_score: float
    risk_level: Literal[
        "HIGH_RISK", "SUSPICIOUS", "NO_KNOWN_THREAT", "UNABLE_TO_VERIFY"
    ]
    source: Literal["GOOGLE_WEB_RISK", "LAYERED_ANALYSIS", "UNABLE_TO_VERIFY"]
    threat_types: list[str]
    explanation: list[str]
    visited_at: str


class PageFormSignal(BaseModel):
    action_origin: str = Field(..., max_length=300)
    method: Literal["get", "post", "other"] = "post"


class PageLinkSignal(BaseModel):
    in_password_form: bool = False
    displayed_host: str = Field(
        ..., min_length=1, max_length=253, pattern=r"^[a-zA-Z0-9.-]+$"
    )
    destination_host: str = Field(
        ..., min_length=1, max_length=253, pattern=r"^[a-zA-Z0-9.-]+$"
    )


class PageSignals(BaseModel):
    brands: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("brands")
    @classmethod
    def validate_brands(cls, brands: list[str]) -> list[str]:
        if any(brand not in BRANDS for brand in brands):
            raise ValueError("Unknown or inactive brand identifier")
        return list(dict.fromkeys(brands))

    password_forms: list[PageFormSignal] = Field(default_factory=list, max_length=20)
    password_without_form: bool = False
    recovery_secret_fields: int = Field(default=0, ge=0, le=200)
    misleading_links: list[PageLinkSignal] = Field(default_factory=list, max_length=10)


class PageAnalyzeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    page: PageSignals
