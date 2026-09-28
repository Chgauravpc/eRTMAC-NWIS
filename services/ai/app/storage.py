"""Supabase Storage access with the service role (contract §8 buckets).

Buckets: 'documents' (incoming uploads, moved to {doc_id}/{filename}),
'page-images' ({doc_id}/{page_no}.png), 'models' ({version}.joblib).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from supabase import Client, create_client

from app.config import get_settings

Bucket = Literal["documents", "page-images", "models"]


@lru_cache
def get_storage_client() -> Client:
    settings = get_settings()
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def upload(bucket: Bucket, path: str, data: bytes, content_type: str) -> None:
    get_storage_client().storage.from_(bucket).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def download(bucket: Bucket, path: str) -> bytes:
    return get_storage_client().storage.from_(bucket).download(path)


def move(bucket: Bucket, src_path: str, dst_path: str) -> None:
    get_storage_client().storage.from_(bucket).move(src_path, dst_path)


def signed_url(bucket: Bucket, path: str, seconds: int = 3600) -> str:
    result = get_storage_client().storage.from_(bucket).create_signed_url(path, seconds)
    return result["signedURL"]
