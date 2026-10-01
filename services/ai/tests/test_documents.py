"""BE-05: POST /v1/documents and the ingest pipeline (DB and storage mocked)."""

import hashlib
from uuid import uuid4

import psycopg.errors
import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main, storage
from app.ingest import pipeline
from app.routers import documents as documents_router

TOKEN = "test-token"
USER_ID = str(uuid4())
PDF_BYTES = b"%PDF-1.4 fake pdf bytes"
BODY = {"storage_path": "incoming/abc/DDR 12.pdf", "filename": "DDR 12.pdf"}


class FakeDb:
    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.existing_id: str | None = None  # row returned for the sha256 lookup
        self.latest_job_status: str | None = None  # status of the existing document's newest job
        self.doc_exists = True  # row returned for "select id from documents where id"
        self.active_job: str | None = None  # a queued/running job on the document, if any
        self.job_doc: dict | None = None  # row returned for the job+document lookup
        self.pending = 0
        self.wells: list[dict] = []
        self.fail_insert_document: Exception | None = None

    async def fetch_one(self, sql, params=None):
        self.calls.append((sql, params))
        if "from documents where sha256" in sql:
            return {"id": self.existing_id} if self.existing_id else None
        if "from documents where id" in sql:
            return {"id": params["id"]} if self.doc_exists else None
        if "from jobs where status in" in sql:
            return {"id": self.active_job} if self.active_job else None
        if "from jobs where doc_id" in sql:
            return {"status": self.latest_job_status} if self.latest_job_status else None
        if "from jobs j join documents" in sql:
            return dict(self.job_doc) if self.job_doc else None
        if "count(*)" in sql:
            return {"n": self.pending}
        raise AssertionError(f"unexpected fetch_one: {sql}")

    async def fetch_all(self, sql, params=None):
        self.calls.append((sql, params))
        if "from wells" in sql:
            return self.wells
        raise AssertionError(f"unexpected fetch_all: {sql}")

    async def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if "insert into documents" in sql and self.fail_insert_document:
            raise self.fail_insert_document

    def params_of(self, fragment: str) -> list[dict]:
        return [p for sql, p in self.calls if fragment in sql]

    def job_updates(self) -> list[dict]:
        return [p for sql, p in self.calls if sql.strip().startswith("update jobs")]


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(db, "fetch_one", fake.fetch_one)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    monkeypatch.setattr(db, "execute", fake.execute)
    return fake


@pytest.fixture
def fake_storage(monkeypatch):
    state = {"moves": [], "discarded": [], "download_error": None}

    def download(bucket, path):
        if state["download_error"]:
            raise state["download_error"]
        return PDF_BYTES

    def move(bucket, src, dst):
        state["moves"].append((bucket, src, dst))

    async def discard(path):
        state["discarded"].append(path)

    monkeypatch.setattr(storage, "download", download)
    monkeypatch.setattr(storage, "move", move)
    monkeypatch.setattr(documents_router, "_discard_incoming", discard)
    return state


@pytest.fixture
def pipeline_runs(monkeypatch):
    runs = []

    async def fake_run(job_id):
        runs.append(job_id)

    monkeypatch.setattr(pipeline, "run_pipeline", fake_run)
    return runs


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return TestClient(app_main.app)


def headers(role="reviewer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": USER_ID, "X-User-Role": role}


# ---------------------------------------------------------------- endpoint


def test_happy_path_creates_document_and_job_and_starts_pipeline(client, fake_db, fake_storage, pipeline_runs):
    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 202
    body = response.json()
    assert body["duplicate"] is False
    doc_id, job_id = body["document_id"], body["job_id"]

    (doc,) = fake_db.params_of("insert into documents")
    assert doc["id"] == doc_id
    assert doc["sha256"] == hashlib.sha256(PDF_BYTES).hexdigest()
    assert doc["title"] == "DDR 12.pdf"
    assert doc["uploaded_by"] == USER_ID
    assert doc["doc_type"] == "other" and doc["provenance"] == "direct"
    assert doc["file_path"] == f"{doc_id}/DDR_12.pdf"  # sanitised, under the document id

    assert fake_storage["moves"] == [("documents", BODY["storage_path"], f"{doc_id}/DDR_12.pdf")]
    (job,) = fake_db.params_of("insert into jobs")
    assert job["id"] == job_id and job["doc_id"] == doc_id and job["created_by"] == USER_ID
    (audit,) = fake_db.params_of("insert into audit_log")
    assert audit["action"] == "doc.upload" and audit["entity_id"] == doc_id
    assert pipeline_runs == [job_id]
    assert fake_storage["discarded"] == []


def test_request_fields_are_stored(client, fake_db, fake_storage, pipeline_runs):
    well_id, wellbore_id = str(uuid4()), str(uuid4())
    body = {**BODY, "well_id": well_id, "wellbore_id": wellbore_id, "doc_type": "wcr", "provenance": "synthetic"}

    assert client.post("/v1/documents", json=body, headers=headers("office_engineer")).status_code == 202

    (doc,) = fake_db.params_of("insert into documents")
    assert (doc["well_id"], doc["wellbore_id"], doc["doc_type"], doc["provenance"]) == (
        well_id,
        wellbore_id,
        "wcr",
        "synthetic",
    )


def test_duplicate_returns_existing_document_and_runs_nothing(client, fake_db, fake_storage, pipeline_runs):
    existing = str(uuid4())
    fake_db.existing_id = existing

    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 200
    assert response.json() == {"document_id": existing, "job_id": None, "duplicate": True}
    assert fake_storage["discarded"] == [BODY["storage_path"]]  # incoming object removed
    assert fake_storage["moves"] == []
    assert fake_db.params_of("insert into documents") == []
    assert fake_db.params_of("insert into jobs") == []
    assert pipeline_runs == []


@pytest.mark.parametrize("status", [None, "done", "needs_review", "running", "queued"])
def test_duplicate_without_a_failed_job_is_not_rerun(client, fake_db, fake_storage, pipeline_runs, status):
    fake_db.existing_id = str(uuid4())
    fake_db.latest_job_status = status

    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 200 and response.json()["duplicate"] is True
    assert fake_db.params_of("insert into jobs") == [] and pipeline_runs == []


def test_duplicate_of_a_failed_document_starts_a_new_job(client, fake_db, fake_storage, pipeline_runs):
    existing = str(uuid4())
    fake_db.existing_id = existing
    fake_db.latest_job_status = "failed"

    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 202
    body = response.json()
    assert body["document_id"] == existing and body["duplicate"] is False and body["job_id"]
    (job,) = fake_db.params_of("insert into jobs")
    assert job["id"] == body["job_id"] and job["doc_id"] == existing and job["created_by"] == USER_ID
    assert fake_db.params_of("insert into audit_log")[0]["action"] == "doc.retry"
    assert pipeline_runs == [body["job_id"]]
    assert fake_storage["discarded"] == [BODY["storage_path"]]  # stored copy is reused
    assert fake_db.params_of("insert into documents") == [] and fake_storage["moves"] == []


def test_concurrent_duplicate_insert_is_reported_as_duplicate(client, fake_db, fake_storage, pipeline_runs, monkeypatch):
    existing = str(uuid4())
    answers = iter([None, {"id": existing}])  # not there at first lookup, there after the race
    original = fake_db.fetch_one

    async def fetch_one(sql, params=None):
        if "from documents where sha256" in sql:
            return next(answers)
        return await original(sql, params)

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    fake_db.fail_insert_document = psycopg.errors.UniqueViolation()

    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 200
    assert response.json()["document_id"] == existing and response.json()["duplicate"] is True
    assert pipeline_runs == []


def test_wrong_role_is_forbidden(client, fake_db, fake_storage, pipeline_runs):
    for role in ("rig_engineer", "rtoc_engineer"):
        response = client.post("/v1/documents", json=BODY, headers=headers(role))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "NWIS_FORBIDDEN"
    assert fake_db.calls == []


def test_missing_service_token_is_unauthorized(client):
    assert client.post("/v1/documents", json=BODY).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"filename": "x.pdf"},  # storage_path missing
        {**BODY, "doc_type": "not_a_type"},
        {**BODY, "well_id": "nope"},
        {**BODY, "storage_path": "documents/abc/x.pdf"},  # not under incoming/
        {**BODY, "storage_path": "incoming/../secret.pdf"},
        {**BODY, "storage_path": "incoming/x.pdf"},  # no upload_id folder
    ],
)
def test_bad_request_uses_contract_error_shape(client, fake_db, fake_storage, body):
    response = client.post("/v1/documents", json=body, headers=headers())
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NWIS_BAD_REQUEST"


def test_malformed_json_is_bad_request(client, fake_db, fake_storage):
    response = client.post("/v1/documents", content=b"{oops", headers={**headers(), "Content-Type": "application/json"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NWIS_BAD_REQUEST"


def test_missing_incoming_file_is_not_found(client, fake_db, fake_storage):
    fake_storage["download_error"] = RuntimeError("Object not found")
    response = client.post("/v1/documents", json=BODY, headers=headers())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NWIS_NOT_FOUND"


def test_unknown_well_is_bad_request(client, fake_db, fake_storage, pipeline_runs):
    fake_db.fail_insert_document = psycopg.errors.ForeignKeyViolation()
    response = client.post("/v1/documents", json={**BODY, "well_id": str(uuid4())}, headers=headers())
    assert response.status_code == 400
    assert fake_storage["moves"] == [] and pipeline_runs == []


def test_failed_move_rolls_back_the_document(client, fake_db, fake_storage, pipeline_runs, monkeypatch):
    def move(*args):
        raise RuntimeError("storage down")

    monkeypatch.setattr(storage, "move", move)
    response = client.post("/v1/documents", json=BODY, headers=headers())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "NWIS_UPSTREAM"
    assert len(fake_db.params_of("delete from documents")) == 1
    assert fake_db.params_of("insert into jobs") == [] and pipeline_runs == []


# ---------------------------------------------------------------- reprocess

DOC_UUID = str(uuid4())


def test_reprocess_starts_a_new_job_for_a_stored_document(client, fake_db, pipeline_runs):
    response = client.post(f"/v1/documents/{DOC_UUID}/reprocess", headers=headers("reviewer"))

    assert response.status_code == 202
    body = response.json()
    assert body["document_id"] == DOC_UUID and body["job_id"]
    (job,) = fake_db.params_of("insert into jobs")
    assert job["id"] == body["job_id"] and job["doc_id"] == DOC_UUID and job["created_by"] == USER_ID
    assert fake_db.params_of("insert into audit_log")[0]["action"] == "doc.reprocess"
    assert pipeline_runs == [body["job_id"]]
    assert fake_db.params_of("insert into documents") == []  # the stored copy is reused


@pytest.mark.parametrize("role", ["reviewer", "office_engineer", "admin"])
def test_reprocess_is_allowed_for_the_upload_roles(client, fake_db, pipeline_runs, role):
    assert client.post(f"/v1/documents/{DOC_UUID}/reprocess", headers=headers(role)).status_code == 202


@pytest.mark.parametrize("role", ["rig_engineer", "rtoc_engineer"])
def test_reprocess_rejects_other_roles(client, fake_db, pipeline_runs, role):
    response = client.post(f"/v1/documents/{DOC_UUID}/reprocess", headers=headers(role))
    assert response.status_code == 403 and response.json()["error"]["code"] == "NWIS_FORBIDDEN"
    assert pipeline_runs == []


def test_reprocess_unknown_document_is_404(client, fake_db, pipeline_runs):
    fake_db.doc_exists = False
    response = client.post(f"/v1/documents/{DOC_UUID}/reprocess", headers=headers())
    assert response.status_code == 404 and response.json()["error"]["code"] == "NWIS_NOT_FOUND"
    assert pipeline_runs == []


def test_reprocess_while_a_job_is_active_is_409(client, fake_db, pipeline_runs):
    fake_db.active_job = str(uuid4())
    response = client.post(f"/v1/documents/{DOC_UUID}/reprocess", headers=headers())

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "NWIS_BAD_STATE" and error["details"]["job_id"] == fake_db.active_job
    assert fake_db.params_of("insert into jobs") == [] and pipeline_runs == []


def test_reprocess_with_a_non_uuid_id_is_400(client, fake_db, pipeline_runs):
    response = client.post("/v1/documents/not-a-uuid/reprocess", headers=headers())
    assert response.status_code == 400 and response.json()["error"]["code"] == "NWIS_BAD_REQUEST"


def test_reprocess_requires_the_service_token(client):
    assert client.post(f"/v1/documents/{DOC_UUID}/reprocess").status_code == 401


# ---------------------------------------------------------------- pipeline

JOB_ID = str(uuid4())
DOC = {
    "id": str(uuid4()),
    "title": "ddr_12.txt",
    "file_path": "x/ddr_12.txt",
    "doc_type": "other",
    "well_id": None,
    "wellbore_id": None,
    "provenance": "direct",
}
DDR_TEXT = b"DAILY DRILLING REPORT\nWell Name: SYN-DLJ-03\nDate: 2019-03-12\n"


@pytest.fixture
def stages(monkeypatch):
    order = []

    def stub(name, fail=None):
        async def fn(*args):
            order.append(name)
            if fail:
                raise fail

        return fn

    for name in ("ocr_or_parse", "extract", "validate", "index"):
        monkeypatch.setattr(pipeline, name, stub(name))
    # ocr_or_parse must return a list
    async def ocr(doc):
        order.append("ocr_or_parse")
        return []

    monkeypatch.setattr(pipeline, "ocr_or_parse", ocr)
    return order


@pytest.mark.asyncio
async def test_pipeline_runs_stages_in_order_and_finishes_done(fake_db, monkeypatch, stages):
    fake_db.job_doc = dict(DOC)
    fake_db.wells = [{"id": "well-1", "name": "SYN-DLJ-03"}, {"id": "well-2", "name": "SYN-NHK-01"}]
    monkeypatch.setattr(storage, "download", lambda bucket, path: DDR_TEXT)

    await pipeline.run_pipeline(JOB_ID)

    assert stages == ["ocr_or_parse", "extract", "validate", "index"]
    updates = fake_db.job_updates()
    assert [(u.get("stage"), u.get("progress")) for u in updates] == [
        ("classify", 0),
        ("ocr", 5),
        ("extract", 40),
        ("validate", 80),
        ("index", 90),
        ("done", 100),
    ]
    assert updates[0]["status"] == "running"
    assert updates[-1]["status"] == "done"
    # classified from the text and the well matched case-insensitively
    assert fake_db.params_of("update documents set doc_type")[0]["doc_type"] == "ddr"
    assert fake_db.params_of("update documents set well_id")[0]["well_id"] == "well-1"
    assert fake_db.params_of("insert into extracted_fields") == []


@pytest.mark.asyncio
async def test_unmatched_well_is_not_flagged_at_classification(fake_db, monkeypatch, stages):
    """A scan has no text at classify time; extraction may still read the well, so the flag waits."""
    seen = {}

    async def spy_extract(doc, pages):
        seen["well_name_guess"] = doc.get("well_name_guess")
        seen["well_id"] = doc["well_id"]

    monkeypatch.setattr(pipeline, "extract", spy_extract)
    fake_db.job_doc = dict(DOC)
    fake_db.wells = [{"id": "well-2", "name": "SYN-NHK-01"}]
    monkeypatch.setattr(storage, "download", lambda bucket, path: DDR_TEXT)

    await pipeline.run_pipeline(JOB_ID)

    assert fake_db.params_of("insert into extracted_fields") == []
    assert fake_db.params_of("update documents set well_id") == []
    assert seen == {"well_name_guess": "SYN-DLJ-03", "well_id": None}  # handed on to extract/validate


@pytest.mark.asyncio
async def test_requested_doc_type_is_kept_and_given_well_is_not_rematched(fake_db, monkeypatch, stages):
    fake_db.job_doc = {**DOC, "doc_type": "wcr", "well_id": "preset-well"}
    monkeypatch.setattr(storage, "download", lambda bucket, path: DDR_TEXT)

    await pipeline.run_pipeline(JOB_ID)

    assert fake_db.params_of("update documents") == []
    assert fake_db.params_of("insert into extracted_fields") == []
    assert fake_db.job_updates()[-1]["status"] == "done"


@pytest.mark.asyncio
async def test_stage_failure_marks_job_failed_and_does_not_raise(fake_db, monkeypatch, stages):
    fake_db.job_doc = dict(DOC, doc_type="wcr", well_id="w")
    monkeypatch.setattr(storage, "download", lambda bucket, path: DDR_TEXT)

    async def boom(doc, pages):
        raise RuntimeError("extractor exploded")

    monkeypatch.setattr(pipeline, "extract", boom)

    await pipeline.run_pipeline(JOB_ID)  # must not raise

    last = fake_db.job_updates()[-1]
    assert last["status"] == "failed"
    assert "extractor exploded" in last["error"]
    assert "validate" not in stages and "index" not in stages


@pytest.mark.asyncio
async def test_unknown_job_is_recorded_as_failure_not_raised(fake_db):
    fake_db.job_doc = None
    await pipeline.run_pipeline(JOB_ID)
    assert fake_db.job_updates()[-1]["status"] == "failed"


@pytest.mark.asyncio
async def test_match_well_threshold(fake_db):
    fake_db.wells = [{"id": "w1", "name": "SYN-DLJ-03"}]
    assert await pipeline.match_well("syn-dlj-03") == "w1"
    assert await pipeline.match_well("  SYN-DLJ-03 ") == "w1"
    assert await pipeline.match_well("SYN-DLJ-O3") == "w1"  # OCR read a zero as the letter O
    assert await pipeline.match_well("completely different") is None


@pytest.mark.asyncio
async def test_match_well_exact_beats_near_names_and_ties_are_not_guessed(fake_db):
    fake_db.wells = [
        {"id": "w3", "name": "SYN-DLJ-03"},
        {"id": "w5", "name": "SYN-DLJ-05"},
    ]
    assert await pipeline.match_well("SYN-DLJ-05") == "w5"  # exact, although 03 also scores 90
    assert await pipeline.match_well("SYN-DLJ-04") is None  # 03 and 05 tie at 90: ambiguous
