"""Leave-one-well-out check of the predicted formation tops (BE-12 acceptance).

    python -m training.eval_tops [--radius-m 10000]

For every completed wellbore with actual tops, predict its tops from its offsets (the
wellbore never counts as its own offset, so this is leave-one-well-out) without storing
anything, and report how many predicted MDs fall within their own uncertainty of the
actual MD, and whether the predicted order is valid. Needs a live database.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app import db
from app.config import get_settings
from app.errors import NwisError
from app.geo import tops
from app.logging import configure_logging

TARGET_COVERAGE = 0.80


def summarise(pairs: list[tuple[float, float, float]]) -> dict:
    """pairs = (predicted_md, actual_md, uncertainty_m)."""
    within = sum(1 for predicted, actual, unc in pairs if abs(predicted - actual) <= unc)
    return {
        "n": len(pairs),
        "within": within,
        "coverage": within / len(pairs) if pairs else None,
        "mean_abs_error_m": sum(abs(p - a) for p, a, _ in pairs) / len(pairs) if pairs else None,
    }


async def evaluate(radius_m: float) -> dict:
    actual_rows = await db.fetch_all(
        """
        select ft.wellbore_id, ft.formation, ft.top_md_m
        from formation_tops ft
        join wellbores wb on wb.id = ft.wellbore_id
        join wells w on w.id = wb.well_id
        where ft.source = 'actual' and w.status = 'completed'
        """
    )
    actual: dict[str, dict[str, float]] = {}
    for row in actual_rows:
        actual.setdefault(str(row["wellbore_id"]), {})[row["formation"]] = row["top_md_m"]

    pairs: list[tuple[float, float, float]] = []
    skipped = 0
    for wellbore_id, truth in actual.items():
        try:
            predicted = await tops.predict_tops(wellbore_id, radius_m, store_result=False)
        except NwisError:
            skipped += 1
            continue
        order_ok = all(a.top_md_m < b.top_md_m for a, b in zip(predicted, predicted[1:]))
        if not order_ok:
            print(f"ORDER VIOLATION in {wellbore_id}")
        pairs += [(p.top_md_m, truth[p.formation], p.uncertainty_m) for p in predicted if p.formation in truth]
    return {**summarise(pairs), "wellbores": len(actual), "skipped": skipped}


async def _main(radius_m: float) -> None:
    try:
        result = await evaluate(radius_m)
    finally:
        await db.close_pool()
    coverage = result["coverage"]
    print(f"wellbores={result['wellbores']} skipped={result['skipped']} tops compared={result['n']}")
    if coverage is None:
        print("no predicted top could be compared with an actual one")
        return
    verdict = "meets" if coverage >= TARGET_COVERAGE else "BELOW"
    print(f"within uncertainty: {result['within']}/{result['n']} = {coverage:.0%} ({verdict} the {TARGET_COVERAGE:.0%} target)")
    print(f"mean absolute error: {result['mean_abs_error_m']:.1f} m")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m training.eval_tops", description=__doc__.split("\n\n")[0])
    parser.add_argument("--radius-m", type=float, default=tops.DEFAULT_RADIUS_M)
    args = parser.parse_args(argv)
    configure_logging(get_settings().LOG_LEVEL)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_main(args.radius_m))


if __name__ == "__main__":
    main()
