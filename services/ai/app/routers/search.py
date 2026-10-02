"""POST /v1/search (contract §9.2): hybrid keyword + vector search over document chunks."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, ValidationError

from app.deps import ROLES, current_user
from app.errors import NwisError
from app.search import rag

router = APIRouter()


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    filters: rag.Filters = rag.Filters()
    limit: int = Field(default=20, ge=1, le=50)


async def parse_body(model: type[BaseModel], request: Request):
    # Parsed by hand so invalid bodies get the contract §4 error shape (400), not FastAPI's 422.
    try:
        return model.model_validate(await request.json())
    except ValidationError as exc:
        raise NwisError(
            "NWIS_BAD_REQUEST", "Invalid request body", 400,
            {"errors": exc.errors(include_url=False, include_context=False, include_input=False)},
        )  # fmt: skip
    except ValueError as exc:  # malformed JSON
        raise NwisError("NWIS_BAD_REQUEST", "Request body must be valid JSON", 400) from exc


@router.post("/search")
async def search(request: Request) -> dict:
    current_user(request).require_role(*ROLES)
    body = await parse_body(SearchRequest, request)
    return {"results": await rag.search(body.q.strip(), body.filters, body.limit)}
