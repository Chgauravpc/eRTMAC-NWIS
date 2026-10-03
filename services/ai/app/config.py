"""Settings for the NWIS AI service (contract §13: environment variables).

Only the variables marked "Used by: Space" (or "Space, loaders") in §13 are
listed here — the others (VITE_*, AI_SERVICE_URL) belong to the frontend or
the Node layer.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# One env file for the whole repo: <repo>/.env (services/ai/app/config.py -> parents[3]).
# A .env in the working directory still overrides it. In a container the code sits at /app/app/config.py, which has
# no such parent (this raised IndexError at import and the service never started): there the settings come from the
# environment only.
_PARENTS = Path(__file__).resolve().parents
REPO_ENV_FILE = _PARENTS[3] / ".env" if len(_PARENTS) > 3 else Path(".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(str(REPO_ENV_FILE), ".env"), extra="ignore")

    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_DB_URL: str = ""
    SERVICE_TOKEN: str = ""
    DB_POOL_MAX: int = 8  # connections; the risk computation runs its queries concurrently
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = ""
    EMBED_MODEL: str = "BAAI/bge-small-en-v1.5"
    # "local" loads the model in this process (sentence-transformers + torch, about 1.5 GB of RAM);
    # "hf_api" calls the Hugging Face Inference API with HF_TOKEN (same model, same 384-d vectors): the slim profile.
    EMBED_BACKEND: str = "local"
    HF_TOKEN: str = ""
    L2_ENABLED: bool = True  # False: no ML layer (risk = L1 + L3), no lightgbm / offset-pool memory: the slim profile
    OCR_ENGINE: str = "rapidocr"
    LOG_LEVEL: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
