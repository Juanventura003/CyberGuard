from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore")

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/email/oauth/callback"
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    SESSION_TTL_MINUTES: int = 30


settings = Settings()

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MAX_EMAILS_PER_BATCH = 50
