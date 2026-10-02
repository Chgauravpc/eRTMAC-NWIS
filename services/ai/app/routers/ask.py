"""POST /v1/ask (contract §9.2): answer a question from the knowledge base, with citations."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.deps import ROLES, current_user
from app.routers.search import parse_body
from app.search import rag

router = APIRouter()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    filters: rag.Filters = rag.Filters()
    wellbore_id: UUID | None = None


@router.post("/ask")
async def ask(request: Request) -> dict:
    current_user(request).require_role(*ROLES)
    body = await parse_body(AskRequest, request)
    wellbore_id = str(body.wellbore_id) if body.wellbore_id else None
    return await rag.ask(body.question.strip(), body.filters, wellbore_id)
