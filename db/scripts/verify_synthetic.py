"""Check the synthetic dataset that is loaded in the database against the DB-09 acceptance criteria.

  python db/scripts/verify_synthetic.py

Read-only apart from one throw-away user that is created inside a transaction and rolled back (to see what row level
security shows to a real signed-in user). Exit code 1 if any check fails.
"""

from __future__ import annotations

import sys

import psycopg

from dbenv import db_url, host_of

results: list[tuple[bool, str]] = []


def check(ok: bool, text: str) -> None:
    results.append((bool(ok), text))
    print(("  ok    " if ok else "  FAIL  ") + text)


def main() -> int:
    print(f"database: {host_of(db_url())}")
    with psycopg.connect(db_url(), connect_timeout=20) as conn:
        q = lambda sql, *a: conn.execute(sql, a or None).fetchall()  # noqa: E731
        one = lambda sql, *a: conn.execute(sql, a or None).fetchone()[0]  # noqa: E731

        n = one("select count(*) from wells where provenance = 'synthetic'")
        check(n == 30, f"30 synthetic wells ({n})")
        st = dict(q("select status, count(*) from wells where provenance = 'synthetic' group by 1"))
        check(st == {"completed": 26, "drilling": 3, "planned": 1}, f"26 completed / 3 drilling / 1 planned ({st})")
        check(one("select count(*) from wells where provenance = 'synthetic' and (name not like 'SYN-%' or operator <> 'SYNTHETIC' or datum_src <> 'WGS84' or basin <> 'Upper Assam')") == 0,
              "every well is SYN-*, operator SYNTHETIC, WGS84, Upper Assam")
        check(one("select count(*) from wells where provenance = 'synthetic' and not (ST_Y(surface::geometry) between 26.9 and 27.6 and ST_X(surface::geometry) between 94.8 and 95.6)") == 0,
              "all surface locations inside lat 26.9-27.6, lon 94.8-95.6")
        for table in ("events", "formation_tops", "hole_sections", "cement_jobs", "mud_records"):
            bad = one(f"select count(*) from {table} where provenance <> 'synthetic'")
            check(bad == 0, f"{table}: every row is synthetic ({bad} others)")

        # trajectories
        check(one("select count(*) from wellbores wb join wells w on w.id = wb.well_id where w.provenance = 'synthetic' and not exists (select 1 from trajectories t where t.wellbore_id = wb.id)") == 0,
              "every synthetic wellbore has a trajectory line")
        check(one("select count(*) from survey_stations ss join wellbores wb on wb.id = ss.wellbore_id join wells w on w.id = wb.well_id where w.provenance = 'synthetic' and ss.tvd_m = 0 and ss.md_m > 0") == 0,
              "no survey station below the surface has tvd 0 (the builder ran)")
        v = one("select count(*) from survey_stations ss join wellbores wb on wb.id = ss.wellbore_id join wells w on w.id = wb.well_id where w.provenance = 'synthetic' and w.name = 'SYN-DLJ-01' and abs(ss.tvd_m - ss.md_m) > 0.01 and ss.inc_deg = 0")
        check(v == 0, "a vertical station has tvd = md")

        # tops, sections, events
        # drilling wells have fewer actual tops (the rest is hidden), so count only completed wells
        low_completed = one("""select count(*) from (select wb.id from wellbores wb join wells w on w.id = wb.well_id left join formation_tops t on t.wellbore_id = wb.id and t.source = 'actual'
                               where w.provenance = 'synthetic' and w.status = 'completed' group by wb.id having count(t.id) < 8) x""")
        check(low_completed == 0, "every completed well has at least 8 formation tops")
        check(one("""select count(*) from (select wb.id from wellbores wb join wells w on w.id = wb.well_id left join hole_sections h on h.wellbore_id = wb.id
                     where w.provenance = 'synthetic' and w.status = 'completed' group by wb.id having count(h.id) < 3) x""") == 0, "every completed well has at least 3 hole sections")
        outside = one("""select count(*) from events e join formation_tops t on t.wellbore_id = e.wellbore_id and t.formation = e.formation and t.source = 'actual'
                         where e.provenance = 'synthetic' and e.md_from_m < t.top_md_m""")
        check(outside == 0, f"no event lies above the top of its formation ({outside})")
        outside2 = one("""select count(*) from events e
                          join formation_tops t on t.wellbore_id = e.wellbore_id and t.formation = e.formation and t.source = 'actual'
                          left join lateral (select min(n.top_md_m) as base from formation_tops n where n.wellbore_id = e.wellbore_id and n.source = 'actual' and n.top_md_m > t.top_md_m) nb on true
                          where e.provenance = 'synthetic' and nb.base is not null and e.md_from_m > nb.base""")
        check(outside2 == 0, f"no event lies below the base of its formation ({outside2})")
        check(one("select count(*) from events where provenance = 'synthetic' and review_status <> 'approved'") == 0, "all synthetic events are approved")

        # the drilling wells: no future in events, series visible only to the bit
        rows = q("select w.name, wb.id, s.bit_md_m, s.status from wells w join wellbores wb on wb.well_id = w.id join stream_state s on s.wellbore_id = wb.id where w.provenance = 'synthetic' order by 1")
        check(len(rows) == 3 and all(r[3] == 'stopped' for r in rows), f"3 stream_state rows, all stopped ({[(r[0], r[2]) for r in rows]})")
        for name, wb, bit, _ in rows:
            beyond = one("select count(*) from events where wellbore_id = %s and md_from_m > %s", wb, bit)
            check(beyond == 0, f"{name}: no event below the bit depth {bit:.0f} m")
            td = one("select max(md_m) from depth_series where wellbore_id = %s", wb)
            check(td > bit + 300, f"{name}: the stored series runs to TD ({td:.0f} m) for the replay")

        # the geo functions on the data
        for name, wb, bit, _ in rows:
            n_off = len(q("select 1 from offsets_within(%s::uuid, 10000::real, %s::real, 'surface')", wb, bit))
            check(n_off >= 5, f"{name}: {n_off} offsets within 10 km")
        vert = q("select wb.id, ST_X(w.surface::geometry), ST_Y(w.surface::geometry) from wells w join wellbores wb on wb.well_id = w.id where w.name = 'SYN-NHK-03'")[0]
        lon, lat, tvd = q("select lon, lat, tvd_m from well_position_at_md(%s::uuid, 1000::real)", vert[0])[0]
        check(abs(lon - vert[1]) < 1e-6 and abs(lat - vert[2]) < 1e-6 and abs(tvd - 1000) < 0.01, "a vertical well at md 1000 m is at its surface location with tvd 1000")

        # what a signed-in user sees: a throw-away rtoc engineer inside a transaction
        conn.execute("insert into auth.users (id, email, raw_user_meta_data) values ('a0000009-0000-0000-0000-000000000001', 'verify-rtoc@example.com', '{}')")
        conn.execute("update profiles set role = 'rtoc_engineer' where id = 'a0000009-0000-0000-0000-000000000001'")
        conn.execute("set local role authenticated")
        conn.execute("set local request.jwt.claims = '{\"sub\":\"a0000009-0000-0000-0000-000000000001\"}'")
        for name, wb, bit, _ in rows:
            seen = one("select max(md_m) from depth_series where wellbore_id = %s", wb)
            check(abs(seen - bit) < 0.6, f"{name}: a signed-in user sees the series only up to the bit ({seen:.1f} m, bit {bit:.1f} m)")
        check(one("select count(*) from v_well_summary") == 30, "v_well_summary: 30 rows for a signed-in user")
        check(one("select count(*) from v_trajectory_geojson") == 30, "v_trajectory_geojson: 30 lines")
        check(one("select count(*) from v_npt_by_formation") > 5, "v_npt_by_formation has rows")
        top = q("select well_name, top_risk_type, event_count, npt_h_total from v_well_summary where well_name = 'SYN-DLJ-01'")[0]
        check(top[2] >= 0, f"v_well_summary row for SYN-DLJ-01: {top}")
        conn.rollback()

    failed = [t for ok, t in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
