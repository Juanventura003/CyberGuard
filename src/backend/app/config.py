from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore")

    GOOGLE_WEB_RISK_API_KEY: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/email/oauth/callback"
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    GOOGLE_SAFE_BROWSING_API_KEY: str = ""
    
    SESSION_TTL_MINUTES: int = 30
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""


settings = Settings()

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MAX_EMAILS_PER_BATCH = 50
