"""Settings for the NWIS AI service (contract §13: environment variables).

Only the variables marked "Used by: Space" (or "Space, loaders") in §13 are
listed here — the others (VITE_*, AI_SERVICE_URL) belong to the frontend or
the Node layer.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_DB_URL: str = ""
    SERVICE_TOKEN: str = ""
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = ""
    EMBED_MODEL: str = "BAAI/bge-small-en-v1.5"
    OCR_ENGINE: str = "rapidocr"
    LOG_LEVEL: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
