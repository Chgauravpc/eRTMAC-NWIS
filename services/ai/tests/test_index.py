"""BE-09: chunking, tagging and indexing (embedding model and database mocked)."""

from uuid import uuid4

import pytest

from app import db
from app.ingest import normalize
from app.ingest import pipeline
from app.search import index as ix
from app.search.index import SynonymMatcher, chunk_page, tag_chunk

DOC_ID, WELL_ID = str(uuid4()), str(uuid4())
SYNONYMS = {
    "tipam": "Tipam", "tipam ss": "Tipam", "tipam sandstone": "Tipam",
    "barail": "Barail", "barail group": "Barail", "kopili": "Kopili",
    "hugin": "Hugin Fm", "hugin formation": "Hugin Fm",
}


def lines(count: int, width: int = 60) -> str:
    return "\n".join(f"line {n:03d} " + "x" * (width - 9) for n in range(count))


# ---------------------------------------------------------------- chunk_page


def test_empty_and_whitespace_pages_have_no_chunks():
    assert chunk_page("") == [] and chunk_page("  \n \r\n  ") == []


def test_a_short_page_is_one_chunk():
    assert chunk_page("  Partial losses at 2395 m.\nPumped LCM pill.  ") == ["Partial losses at 2395 m.\nPumped LCM pill."]


def test_chunks_respect_the_size_and_cover_all_text():
    text = lines(80)  # ~4900 chars
    chunks = chunk_page(text, size=1200, overlap=200)

    assert len(chunks) > 3
    assert all(len(c) <= 1200 for c in chunks)
    covered = set("\n".join(chunks).splitlines())
    assert covered == set(text.splitlines())  # nothing lost


def test_chunks_break_on_line_boundaries():
    text = lines(80)
    original = set(text.splitlines())
    for chunk in chunk_page(text):
        assert set(chunk.splitlines()) <= original  # only whole lines, no line cut in half


def test_consecutive_chunks_overlap_by_whole_lines_within_the_overlap_size():
    chunks = chunk_page(lines(80), size=1200, overlap=200)
    for previous, following in zip(chunks, chunks[1:]):
        shared = [line for line in previous.splitlines() if line in following.splitlines()]
        assert shared, "chunks should share their boundary lines"
        assert shared == previous.splitlines()[-len(shared):]  # the tail of one is the head of the next
        assert following.splitlines()[:len(shared)] == shared
        assert sum(len(line) + 1 for line in shared) <= 200


def test_zero_overlap_repeats_nothing():
    chunks = chunk_page(lines(80), size=1200, overlap=0)
    joined = [line for c in chunks for line in c.splitlines()]
    assert len(joined) == len(set(joined)) == 80


def test_overlap_must_be_smaller_than_size():
    with pytest.raises(ValueError):
        chunk_page("text", size=100, overlap=100)


def test_chunking_always_makes_progress_even_when_one_line_exceeds_the_overlap():
    text = "\n".join("y" * 190 for _ in range(30))
    chunks = chunk_page(text, size=400, overlap=399)
    assert 1 < len(chunks) <= 40 and all(len(c) <= 400 for c in chunks)


def test_a_very_long_line_is_split_at_spaces_without_cutting_words():
    words = [f"word{n}" for n in range(1200)]
    chunks = chunk_page(" ".join(words), size=1200, overlap=200)

    assert len(chunks) > 3 and all(len(c) <= 1200 for c in chunks)
    seen = [w for c in chunks for w in c.split()]
    assert set(seen) == set(words)  # every word survives intact


def test_a_giant_token_with_no_spaces_is_hard_cut_at_the_size():
    chunks = chunk_page("z" * 3000, size=1000, overlap=100)
    assert [len(c) for c in chunks] == [1000, 1000, 1000]


def test_long_text_breaks_at_a_sentence_end_when_there_is_one():
    sentence = "Partial losses were seen while drilling. "
    chunks = chunk_page(sentence * 100, size=1200, overlap=200)
    assert all(c.endswith("drilling.") for c in chunks[:-1])


TABLE = "\n".join([
    "Formation      Top MD (m)      Top TVDSS (m)",
    "Tipam          2310.5          2261.0",
    "Barail         2850.0          2790.0",
    "Kopili         3500.0          3440.0",
])


def test_a_table_block_stays_whole_in_its_own_chunk_even_beyond_the_size():
    big_table = "\n".join(f"Row{n:03d}      {n * 10}.5      {n * 9}.0" for n in range(60))  # ~1900 chars
    assert 1200 < len(big_table) <= 2400
    text = lines(5) + "\n\n" + big_table + "\n\n" + lines(5)

    chunks = chunk_page(text)

    assert big_table in chunks
    assert chunks[0] == lines(5) and chunks[-1] == lines(5)  # text around it is separate, no overlap into it


def test_pipe_and_tab_tables_are_recognised():
    pipes = "| Formation | Top |\n| --- | --- |\n| Tipam | 2310.5 |"
    tabs = "Formation\tTop\nTipam\t2310.5\nBarail\t2850.0"
    assert chunk_page("intro\n\n" + pipes + "\n\nafter") == ["intro", pipes, "after"]
    assert chunk_page(tabs) == [tabs]


def test_plain_prose_is_not_mistaken_for_a_table():
    prose = "Partial losses at 2395 m.\nPumped LCM pill.\nLosses cured after 2 h."
    assert chunk_page("intro text\n\n" + prose + "\n\nmore") == ["intro text\nPartial losses at 2395 m."
                                                                "\nPumped LCM pill.\nLosses cured after 2 h.\nmore"]


def test_a_table_over_the_limit_is_split_like_ordinary_text():
    huge = "\n".join(f"Row{n:04d}      {n}.5      {n}.0" for n in range(200))  # > 2400 chars
    assert len(huge) > 2400
    chunks = chunk_page(huge)
    assert len(chunks) > 1 and all(len(c) <= 1200 for c in chunks)


def test_chunking_is_deterministic():
    text = lines(60) + "\n\n" + TABLE
    assert chunk_page(text) == chunk_page(text)


# ---------------------------------------------------------------- SynonymMatcher


def test_matcher_is_case_insensitive_whole_word_and_first_mention_first():
    matcher = SynonymMatcher(SYNONYMS)
    assert matcher.find_all("Kopili shale above, then BARAIL group coal, then Tipam") == ["Kopili", "Barail", "Tipam"]
    assert matcher.find_all("Tipamoto field and Barailing") == []  # not whole words
    assert matcher.first("no formation here") is None
    assert SynonymMatcher({}).find_all("Tipam") == []


def test_matcher_tolerates_irregular_spacing_inside_an_alias():
    assert SynonymMatcher(SYNONYMS).first("the Hugin   Formation top") == "Hugin Fm"


# ---------------------------------------------------------------- tag_chunk


LOSS_CHUNK = "Obs. partial losses @ 2395 m 15 m3/hr, pumped LCM pill. Losses cured after 2 h."
EVENT = {"snippet": "partial losses @ 2395 m 15 m3/hr, pumped LCM pill", "formation": "Tipam",
         "md_from_m": 2395.0, "md_to_m": 2410.0}


def test_entity_whose_snippet_lies_in_the_chunk_gives_formation_and_depths():
    tag = tag_chunk(LOSS_CHUNK, [EVENT], SYNONYMS)
    assert (tag.formation, tag.md_from_m, tag.md_to_m) == ("Tipam", 2395.0, 2410.0)


def test_entity_from_elsewhere_on_the_page_is_ignored():
    other = {"snippet": "stuck pipe at 2860 m, worked pipe free", "formation": "Barail",
             "md_from_m": 2860.0, "md_to_m": None}
    tag = tag_chunk(LOSS_CHUNK, [other], SYNONYMS)
    assert tag.formation is None and (tag.md_from_m, tag.md_to_m) == (2395.0, 2395.0)  # depth read from the text


def test_snippet_matching_tolerates_ocr_noise():
    noisy = dict(EVENT, snippet="partial  Iosses @ 2395 rn 15 m3/hr, pumped LCM pi11")
    assert tag_chunk(LOSS_CHUNK, [noisy], SYNONYMS).formation == "Tipam"


def test_several_entities_give_the_overall_depth_range_and_the_first_formation():
    first = dict(EVENT, snippet="partial losses", md_from_m=2395.0, md_to_m=2410.0)
    second = {"snippet": "LCM pill", "formation": "Barail", "md_from_m": 2380.0, "md_to_m": 2500.0}
    tag = tag_chunk(LOSS_CHUNK, [first, second], SYNONYMS)
    assert (tag.formation, tag.md_from_m, tag.md_to_m) == ("Tipam", 2380.0, 2500.0)


def test_formation_comes_from_the_text_when_no_entity_matches():
    tag = tag_chunk("Drilled ahead through Barail Group coal and shale to 2860 m.", [], SYNONYMS)
    assert tag.formation == "Barail"


def test_a_formation_top_without_a_snippet_counts_only_when_its_formation_is_named_in_the_chunk():
    top = {"snippet": None, "formation": "Kopili", "md_from_m": 3500.0, "md_to_m": None}
    named = tag_chunk("Kopili shale reached.", [top], SYNONYMS)
    assert (named.formation, named.md_from_m, named.md_to_m) == ("Kopili", 3500.0, 3500.0)
    unrelated = tag_chunk("Routine rig maintenance on the top drive.", [top], SYNONYMS)
    assert unrelated == tag_chunk("Routine rig maintenance on the top drive.", [], SYNONYMS)
    assert (unrelated.formation, unrelated.md_from_m) == (None, None)


def test_depths_are_parsed_from_the_text_in_metres_ignoring_non_depth_quantities():
    chunk = "Set 9 5/8 in casing at 7870 ft, 12.25 in hole, pumped 30 m3 and 15 m3/hr, MW 1.18 SG, TD 99999 m."
    tag = tag_chunk(chunk, [], SYNONYMS)
    assert tag.md_from_m == pytest.approx(7870 * 0.3048)
    assert tag.md_to_m == pytest.approx(7870 * 0.3048)  # inch, m3, SG and the 99999 m typo are not depths


def test_depth_range_from_text_spans_min_to_max():
    tag = tag_chunk("Losses between 2395-2410 m and again at 2600 m.", [], SYNONYMS)
    assert (tag.md_from_m, tag.md_to_m) == (2395.0, 2600.0)


def test_nothing_to_tag():
    assert tag_chunk("Rig move completed, no depth or formation mentioned.", [], SYNONYMS) == ix.ChunkTag(None, None, None)


# ---------------------------------------------------------------- index_document


class FakeDb:
    def __init__(self):
        self.log: list[str] = []
        self.executed: list[tuple[str, object]] = []
        self.doc = {"id": DOC_ID, "well_id": WELL_ID}
        self.pages = [{"page_no": 1, "text": LOSS_CHUNK}, {"page_no": 2, "text": "Kopili shale at 3500 m.\n\n" + TABLE}]
        self.events = [dict(EVENT, page=1)]
        self.tops: list[dict] = []
        self.event_sql = ""

    async def fetch_one(self, sql, params=None):
        return self.doc if "from documents" in sql else None

    async def fetch_all(self, sql, params=None):
        if "from document_pages" in sql:
            return self.pages
        if "from events" in sql:
            self.event_sql = sql
            return self.events
        if "from formation_tops" in sql:
            return self.tops
        if "formation_synonyms" in sql:
            return [{"alias": a, "formation": f} for a, f in SYNONYMS.items()]
        if "from formations" in sql:
            return [{"name": n, "strat_order": i} for i, n in enumerate(sorted(set(SYNONYMS.values())), 1)]
        raise AssertionError(sql)

    async def execute(self, sql, params=None):
        self.log.append("delete" if sql.strip().startswith("delete from chunks") else "execute")
        self.executed.append((sql, params))

    async def execute_many(self, sql, params_seq):
        self.log.append("insert")
        self.executed.append((sql, params_seq))

    def inserted(self):
        return [p for sql, p in self.executed if "insert into chunks" in sql]


@pytest.fixture
def fake(monkeypatch):
    fake_db = FakeDb()
    for name in ("fetch_one", "fetch_all", "execute", "execute_many"):
        monkeypatch.setattr(db, name, getattr(fake_db, name))

    def embed(texts):
        fake_db.log.append("embed")
        return [[float(i)] * 384 for i, _ in enumerate(texts)]

    monkeypatch.setattr(ix, "_embed", embed)
    normalize.clear_resolver_cache()
    yield fake_db
    normalize.clear_resolver_cache()


@pytest.mark.asyncio
async def test_index_document_writes_tagged_embedded_chunks(fake):
    count = await ix.index_document(DOC_ID)

    (rows,) = fake.inserted()
    assert count == len(rows) == 3  # page 1 text; page 2: the prose line + the table
    assert {r["doc_id"] for r in rows} == {DOC_ID} and {r["well_id"] for r in rows} == {WELL_ID}
    first = rows[0]
    assert first["page"] == 1 and first["text"] == LOSS_CHUNK
    assert (first["formation"], first["md_from_m"], first["md_to_m"]) == ("Tipam", 2395.0, 2410.0)  # from the event
    assert first["embedding"].startswith("[") and first["embedding"].count(",") == 383  # a 384-dim pgvector literal
    assert rows[-1]["text"] == TABLE and rows[-1]["page"] == 2  # the table stays whole
    assert any(r["formation"] == "Kopili" and r["md_from_m"] == 3500.0 for r in rows if r["page"] == 2)


@pytest.mark.asyncio
async def test_old_chunks_are_replaced_only_after_everything_is_computed(fake):
    await ix.index_document(DOC_ID)
    assert fake.log == ["embed", "delete", "insert"]  # embedding first: a failure keeps the old index

    fake.log.clear()
    await ix.index_document(DOC_ID)
    assert fake.log == ["embed", "delete", "insert"]  # idempotent: each run replaces


@pytest.mark.asyncio
async def test_embedding_failure_leaves_the_old_chunks_alone(fake, monkeypatch):
    def broken(texts):
        raise RuntimeError("model could not load")

    monkeypatch.setattr(ix, "_embed", broken)
    with pytest.raises(RuntimeError):
        await ix.index_document(DOC_ID)
    assert fake.log == [] and fake.executed == []  # nothing deleted, nothing inserted


@pytest.mark.asyncio
async def test_a_document_without_text_clears_its_chunks_and_embeds_nothing(fake):
    fake.pages = [{"page_no": 1, "text": "   "}, {"page_no": 2, "text": None}]
    assert await ix.index_document(DOC_ID) == 0
    assert fake.log == ["delete"] and fake.inserted() == []


@pytest.mark.asyncio
async def test_rejected_events_are_not_used_and_tops_tag_their_page(fake):
    fake.events = []
    fake.tops = [{"page": 2, "formation": "Kopili", "top_md_m": 3500.0}]
    await ix.index_document(DOC_ID)

    assert "review_status <> 'rejected'" in fake.event_sql
    page_two = [r for r in fake.inserted()[0] if r["page"] == 2]
    assert any(r["formation"] == "Kopili" and r["md_from_m"] == 3500.0 for r in page_two)


@pytest.mark.asyncio
async def test_unknown_document_is_an_error(fake):
    fake.doc = None
    with pytest.raises(LookupError):
        await ix.index_document(DOC_ID)


@pytest.mark.asyncio
async def test_document_without_a_well_gets_null_well_ids(fake):
    fake.doc = {"id": DOC_ID, "well_id": None}
    await ix.index_document(DOC_ID)
    assert {r["well_id"] for r in fake.inserted()[0]} == {None}


# ---------------------------------------------------------------- pipeline + CLI


def test_the_pipeline_index_stage_is_the_real_indexer():
    assert pipeline.index is ix.index_document


@pytest.mark.asyncio
async def test_reindex_all_visits_every_document_with_pages(monkeypatch, capsys):
    ids = [str(uuid4()) for _ in range(3)]
    seen = []

    async def fetch_all(sql, params=None):
        assert "from document_pages" in sql
        return [{"doc_id": i} for i in ids]

    async def fake_index(doc_id):
        seen.append(doc_id)
        return 2

    monkeypatch.setattr(db, "fetch_all", fetch_all)
    monkeypatch.setattr(ix, "index_document", fake_index)

    assert await ix.reindex_all() == (3, 6)
    assert seen == ids
    assert "[3/3]" in capsys.readouterr().out


def test_cli_requires_one_mode():
    with pytest.raises(SystemExit):
        ix.main([])
    with pytest.raises(SystemExit):
        ix.main(["--reindex-all", "--doc-id", str(uuid4())])
