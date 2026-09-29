"""Tests for app/db.py (contract §7 RPCs, §6/§8 depth visibility).

The insert/read/RPC tests need a real Postgres with the contract's schema
applied (e.g. a local Docker Postgres with PostGIS + pgvector, migrated via
db/supabase/migrations/). Set DATABASE_URL_TEST to run them; they're skipped
automatically when it isn't set.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app import db as db_module

DATABASE_URL_TEST = os.environ.get("DATABASE_URL_TEST")

requires_test_db = pytest.mark.skipif(
    not DATABASE_URL_TEST,
    reason="DATABASE_URL_TEST not set; skipping DB integration tests",
)


@pytest.fixture
def _test_db(monkeypatch):
    """Point db.py's pool at DATABASE_URL_TEST for the duration of a test."""
    from app.config import get_settings

    monkeypatch.setenv("SUPABASE_DB_URL", DATABASE_URL_TEST)
    get_settings.cache_clear()
    db_module._pool = None
    yield
    db_module._pool = None
    get_settings.cache_clear()


def test_call_fn_allowlist_matches_contract_section_7():
    assert "offsets_within" in db_module.ALLOWED_FUNCTIONS
    assert "hybrid_search" in db_module.ALLOWED_FUNCTIONS
    assert "drop_all_tables" not in db_module.ALLOWED_FUNCTIONS


@pytest.mark.asyncio
async def test_call_fn_rejects_unknown_name_without_touching_the_database():
    with pytest.raises(ValueError, match="not an allowed"):
        await db_module.call_fn("pg_sleep", p_x=1)


@pytest.mark.asyncio
async def test_call_fn_rejects_malicious_parameter_name():
    with pytest.raises(ValueError, match="not a valid contract"):
        await db_module.call_fn(
            "offsets_within",
            **{"p_x); drop table wells; --": 1},
        )


@requires_test_db
@pytest.mark.asyncio
async def test_insert_and_read_well(_test_db):
    well_id = uuid.uuid4()
    await db_module.execute(
        """
        insert into wells (id, name, surface, provenance, status)
        values (
            %(id)s, %(name)s,
            ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'),
            'synthetic', 'completed'
        )
        """,
        {"id": str(well_id), "name": f"SYN-TEST-{well_id.hex[:8]}"},
    )
    try:
        row = await db_module.fetch_one(
            "select id, name, provenance from wells where id = %(id)s",
            {"id": str(well_id)},
        )
        assert row is not None
        assert row["name"].startswith("SYN-TEST-")
        assert row["provenance"] == "synthetic"
    finally:
        await db_module.execute("delete from wells where id = %(id)s", {"id": str(well_id)})


@requires_test_db
@pytest.mark.asyncio
async def test_offsets_within_rpc_with_python_floats(_test_db):
    """BE-02 acceptance: insert wells, call offsets_within (DB-04) through call_fn.

    Python floats/lists must reach the ``real`` / ``text[]`` parameters of the
    contract functions; this failed with "function does not exist" when they
    were bound as float8.
    """
    tag = uuid.uuid4().hex[:8]
    ids = {k: (str(uuid.uuid4()), str(uuid.uuid4())) for k in ("active", "near", "far")}
    surface = {
        "active": "POINT(95.3000 27.3500)",
        "near": "POINT(95.3200 27.3500)",  # ~2 km east
        "far": "POINT(95.7000 27.3500)",  # ~40 km east
    }
    try:
        for key, (well_id, wb_id) in ids.items():
            await db_module.execute(
                "insert into wells (id, name, surface, provenance, status) values "
                "(%(id)s, %(name)s, ST_GeogFromText(%(wkt)s), 'synthetic', 'completed')",
                {"id": well_id, "name": f"SYN-T{tag}-{key}", "wkt": "SRID=4326;" + surface[key]},
            )
            await db_module.execute(
                "insert into wellbores (id, well_id, name) values (%(id)s, %(w)s, %(name)s)",
                {"id": wb_id, "w": well_id, "name": f"SYN-T{tag}-{key}-WB1"},
            )
        await db_module.execute(
            "insert into events (wellbore_id, event_type, md_from_m, formation, description, provenance) "
            "values (%(wb)s, 'loss_partial', 1900.0, 'Tipam', 'partial losses', 'synthetic')",
            {"wb": ids["near"][1]},
        )

        rows = await db_module.call_fn(
            "offsets_within", p_wellbore=ids["active"][1], p_radius_m=10000.0
        )
        assert [r["well_name"] for r in rows] == [f"SYN-T{tag}-near"]  # excludes self and the 40 km well
        assert 1500 < rows[0]["surface_distance_m"] < 2500

        events = await db_module.call_fn(
            "events_for_offsets",
            p_wellbore=ids["active"][1],
            p_radius_m=10000.0,
            p_formations=["Tipam"],
            p_limit=10,
        )
        assert [e["event_type"] for e in events] == ["loss_partial"]
    finally:
        for well_id, _ in ids.values():
            await db_module.execute("delete from wells where id = %(id)s", {"id": well_id})


def test_untyped_literals_for_numbers_bools_and_arrays():
    assert db_module._untyped(10000.0) == "10000.0"
    assert db_module._untyped(7) == "7"
    assert db_module._untyped(True) == "true"
    assert db_module._untyped(None) is None
    assert db_module._untyped("Tipam") == "Tipam"
    assert db_module._untyped(["Tipam", 'Bar"ail']) == '{"Tipam","Bar\\"ail"}'
    assert db_module._untyped([1.5, 2]) == '{"1.5","2"}'


@requires_test_db
@pytest.mark.asyncio
async def test_visible_depth_limit_none_without_stream_state(_test_db):
    limit = await db_module.visible_depth_limit(uuid.uuid4())
    assert limit is None


@requires_test_db
@pytest.mark.asyncio
async def test_visible_depth_limit_returns_bit_md_m_while_drilling(_test_db):
    well_id = uuid.uuid4()
    wellbore_id = uuid.uuid4()
    await db_module.execute(
        """
        insert into wells (id, name, surface, provenance, status)
        values (%(id)s, %(name)s, ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 'synthetic', 'drilling')
        """,
        {"id": str(well_id), "name": f"SYN-TEST-{well_id.hex[:8]}"},
    )
    await db_module.execute(
        "insert into wellbores (id, well_id, name) values (%(id)s, %(well_id)s, %(name)s)",
        {"id": str(wellbore_id), "well_id": str(well_id), "name": f"SYN-TEST-{well_id.hex[:8]}-WB1"},
    )
    await db_module.execute(
        "insert into stream_state (wellbore_id, status, bit_md_m) values (%(id)s, 'live', %(bit)s)",
        {"id": str(wellbore_id), "bit": 2450.5},
    )

    try:
        limit = await db_module.visible_depth_limit(wellbore_id)
        assert limit == pytest.approx(2450.5)
    finally:
        await db_module.execute("delete from wells where id = %(id)s", {"id": str(well_id)})
