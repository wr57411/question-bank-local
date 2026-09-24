import base64
import json
import os
import sqlite3
import subprocess
import sys

import numpy as np
import pytest

import build_index

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()
STUB_DIM = 4
STUB_VECTOR = [0.1, 0.2, 0.3, 0.4]
SERVICE_URL = "http://svc:3002"


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeService:
    """假 HTTP 编码服务：记录每次请求，按契约返回定长向量。"""

    def __init__(self, dim=STUB_DIM, status=200):
        self.calls = []
        self.dim = dim
        self.status = status

    def post(self, url, json=None, timeout=None):
        images = json["images"]
        self.calls.append({"url": url, "images": images, "timeout": timeout})
        if self.status != 200:
            return FakeResponse(self.status, {"detail": "engine boom"})
        return FakeResponse(
            200, {"dim": self.dim, "vectors": [list(STUB_VECTOR) for _ in images]}
        )


@pytest.fixture
def service(monkeypatch):
    fake = FakeService()
    monkeypatch.setattr(build_index.requests, "post", fake.post)
    return fake


def _db():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        """CREATE TABLE question_embeddings (
        engine_id TEXT NOT NULL, question_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, vector BLOB NOT NULL, updated_at TEXT,
        PRIMARY KEY (engine_id, question_id))"""
    )
    return conn


def _indexable_db(tmp_path, count, name="t.db"):
    db = tmp_path / name
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE questions (id TEXT PRIMARY KEY, question_image_url TEXT, deleted_at TEXT)")
    for i in range(count):
        conn.execute("INSERT INTO questions VALUES (?, ?, NULL)", (f"q-{i}", PNG_DATA_URI))
    conn.commit()
    conn.close()
    return db


def _embeddings(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute(
            "SELECT engine_id, question_id, dim, vector FROM question_embeddings ORDER BY question_id"
        ).fetchall()
    finally:
        conn.close()


def test_pending_rows_只返回该引擎缺失的题目():
    conn = _db()
    conn.execute("INSERT INTO question_embeddings VALUES ('mac','q-1','m',4,x'00','')")
    all_rows = [("q-1",), ("q-2",)]
    pending = build_index.pending_rows(conn, all_rows, "linux")
    assert pending == [("q-1",), ("q-2",)]


def test_pending_rows_不同引擎互不干扰():
    conn = _db()
    conn.execute("INSERT INTO question_embeddings VALUES ('mac','q-1','m',4,x'00','')")
    all_rows = [("q-1",)]
    assert build_index.pending_rows(conn, all_rows, "mac") == []


def test_缺少_engine_id_报错退出(tmp_path):
    db = tmp_path / "t.db"
    proc = subprocess.run(
        [sys.executable, "build_index.py", str(db)],
        cwd=build_index.__file__.rsplit("/", 1)[0],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": ""},
    )
    assert proc.returncode == 2
    assert "--engine-id" in proc.stdout
    assert not db.exists()


def test_parse_args_service_url_默认值(monkeypatch):
    monkeypatch.delenv("EMBED_SERVICE_URL", raising=False)
    _, service_url, engine_id, force = build_index.parse_args(["db.sqlite", "--engine-id", "linux"])
    assert service_url == "http://127.0.0.1:3002"
    assert engine_id == "linux"
    assert force is False


def test_parse_args_service_url_来自环境变量(monkeypatch):
    monkeypatch.setenv("EMBED_SERVICE_URL", "http://env:9")
    _, service_url, _, _ = build_index.parse_args(["db.sqlite", "--engine-id", "linux"])
    assert service_url == "http://env:9"


def test_parse_args_命令行覆盖环境变量(monkeypatch):
    monkeypatch.setenv("EMBED_SERVICE_URL", "http://env:9")
    db_path, service_url, _, _ = build_index.parse_args(
        ["db.sqlite", "--engine-id", "linux", "--service-url", "http://flag:8"]
    )
    assert db_path == "db.sqlite"
    assert service_url == "http://flag:8"


def test_parse_args_force():
    _, _, engine_id, force = build_index.parse_args(["db.sqlite", "--engine-id", "linux", "--force"])
    assert engine_id == "linux"
    assert force is True


def test_提交的是原样data_uri(tmp_path, service):
    db = _indexable_db(tmp_path, 2)
    build_index.main(str(db), SERVICE_URL, "linux")
    sent = [img for call in service.calls for img in call["images"]]
    assert sent == [PNG_DATA_URI, PNG_DATA_URI]
    assert all(s.startswith("data:") for s in sent)
    assert [call["url"] for call in service.calls] == [f"{SERVICE_URL}/encode-images"]


def test_每批不超过8张(tmp_path, service):
    db = _indexable_db(tmp_path, 20)
    build_index.main(str(db), SERVICE_URL, "linux")
    sizes = [len(call["images"]) for call in service.calls]
    assert sizes == [8, 8, 4]
    assert max(sizes) <= 8


def test_向量按engine_id落库(tmp_path, service):
    db = _indexable_db(tmp_path, 2)
    build_index.main(str(db), SERVICE_URL, "linux")
    rows = _embeddings(db)
    assert [r[0] for r in rows] == ["linux", "linux"]
    assert [r[1] for r in rows] == ["q-0", "q-1"]
    assert all(r[2] == STUB_DIM for r in rows)
    assert np.frombuffer(rows[0][3], dtype=np.float32).tolist() == pytest.approx(STUB_VECTOR)


def test_不同engine_id各自落库(tmp_path, service):
    db = _indexable_db(tmp_path, 1)
    build_index.main(str(db), SERVICE_URL, "mac")
    build_index.main(str(db), SERVICE_URL, "linux")
    rows = _embeddings(db)
    assert sorted(r[0] for r in rows) == ["linux", "mac"]
    assert len(service.calls) == 2


def test_增量diff不重复编码(tmp_path, service):
    db = _indexable_db(tmp_path, 2)
    build_index.main(str(db), SERVICE_URL, "linux")
    service.calls.clear()
    build_index.main(str(db), SERVICE_URL, "linux")
    assert service.calls == []


def test_force全量重编(tmp_path, service):
    db = _indexable_db(tmp_path, 2)
    build_index.main(str(db), SERVICE_URL, "linux")
    service.calls.clear()
    build_index.main(str(db), SERVICE_URL, "linux", force=True)
    assert [len(call["images"]) for call in service.calls] == [2]


def test_http非2xx时报错清晰且不落库(tmp_path, monkeypatch):
    db = _indexable_db(tmp_path, 20)
    fake = FakeService(status=500)
    monkeypatch.setattr(build_index.requests, "post", fake.post)
    with pytest.raises(RuntimeError) as excinfo:
        build_index.main(str(db), SERVICE_URL, "linux")
    message = str(excinfo.value)
    assert f"{SERVICE_URL}/encode-images" in message
    assert "HTTP 500" in message
    assert "批次 1/3" in message
    assert "8 张" in message
    assert _embeddings(db) == []


def test_服务不可达时报错清晰(tmp_path, monkeypatch):
    db = _indexable_db(tmp_path, 1)

    def boom(url, json=None, timeout=None):
        raise build_index.requests.ConnectionError("connection refused")

    monkeypatch.setattr(build_index.requests, "post", boom)
    with pytest.raises(RuntimeError) as excinfo:
        build_index.main(str(db), SERVICE_URL, "linux")
    message = str(excinfo.value)
    assert f"{SERVICE_URL}/encode-images" in message
    assert "批次 1/1" in message
    assert "connection refused" in message
