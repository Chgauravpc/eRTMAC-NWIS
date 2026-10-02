"""Shared helpers for the BE-21 evaluation scripts: repo paths, the labelled set, and docs/eval_results.md.

Each script appends a dated section with the git commit hash, so every number in the pitch can be traced to
the code that produced it. Numbers go in as measured, good or bad.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parents[3]
EVAL_DIR = REPO_ROOT / "db" / "eval"
PAGES_DIR = EVAL_DIR / "pages"
GROUND_TRUTH = EVAL_DIR / "ground_truth.jsonl"
SYNTH_TRUTH_DIR = REPO_ROOT / "db" / "data" / "synth_truth"
EVAL_RESULTS = REPO_ROOT / "docs" / "eval_results.md"

HEADER = (
    "# Evaluation results\n\n"
    "Measured numbers only. Each section is appended by one script and carries the date and the git commit it ran at. "
    "Nothing here is an estimate. Targets come from `NWIS_PRD.md` §1.\n"
)


def commit_hash() -> str:
    """Short hash of HEAD, with `+dirty` when the working tree has uncommitted changes; 'unknown' without git."""
    try:
        head = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True, timeout=10
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        return head + ("+dirty" if dirty else "")
    except Exception:  # noqa: BLE001 - a missing git must not stop an evaluation
        return "unknown"


def load_ground_truth(path: Path | None = None) -> list[dict[str, Any]]:
    """One JSON object per non-empty line (db/eval/ground_truth.jsonl, DB-14)."""
    path = path or GROUND_TRUTH
    records = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path.name} line {number} is not valid JSON: {exc}") from exc
    return records


def markdown_table(headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def fmt(value: float | None, digits: int = 3, suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:.{digits}f}{suffix}"


def append_section(title: str, body: str, path: Path | None = None, now: datetime | None = None) -> str:
    """Append "## <title> (<date>, commit <hash>)" and the body to eval_results.md (created with a header)."""
    path = path or EVAL_RESULTS
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M UTC")
    section = f"\n## {title} ({stamp}, commit {commit_hash()})\n\n{body.strip()}\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else HEADER
    path.write_text(existing.rstrip("\n") + "\n" + section, encoding="utf-8")
    return section
