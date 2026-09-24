import os
import sqlite3
import subprocess
import sys

import numpy as np

import calibrate_threshold


def _db(path):
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE question_embeddings (
        engine_id TEXT NOT NULL, question_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, vector BLOB NOT NULL, updated_at TEXT,
        PRIMARY KEY (engine_id, question_id))"""
    )
    return conn


def _vec():
    return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32).tobytes()


def test_load_index_vectors_只返回指定引擎(tmp_path):
    db = tmp_path / "t.db"
    conn = _db(db)
    conn.execute(
        "INSERT INTO question_embeddings VALUES ('mac','q-1',?,4,?,'')",
        (calibrate_threshold.MODEL_TAG, _vec()),
    )
    conn.execute(
        "INSERT INTO question_embeddings VALUES ('linux','q-1',?,4,?,'')",
        (calibrate_threshold.MODEL_TAG, _vec()),
    )
    conn.execute(
        "INSERT INTO question_embeddings VALUES ('linux','q-2',?,4,?,'')",
        (calibrate_threshold.MODEL_TAG, _vec()),
    )
    conn.commit()
    conn.close()

    ids, matrix = calibrate_threshold.load_index_vectors(str(db), "linux")
    assert sorted(ids) == ["q-1", "q-2"]
    assert matrix.shape == (2, 4)


def test_load_index_vectors_只取当前模型(tmp_path):
    db = tmp_path / "t.db"
    conn = _db(db)
    conn.execute(
        "INSERT INTO question_embeddings VALUES ('linux','q-1',?,4,?,'')",
        (calibrate_threshold.MODEL_TAG, _vec()),
    )
    conn.execute("INSERT INTO question_embeddings VALUES ('linux','q-2','other-model',4,?,'')", (_vec(),))
    conn.commit()
    conn.close()

    ids, matrix = calibrate_threshold.load_index_vectors(str(db), "linux")
    assert ids == ["q-1"]
    assert matrix.shape == (1, 4)


def test_缺少_engine_id_报错退出(tmp_path):
    db = tmp_path / "t.db"
    proc = subprocess.run(
        [sys.executable, "calibrate_threshold.py", str(db)],
        cwd=calibrate_threshold.__file__.rsplit("/", 1)[0],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": ""},
    )
    assert proc.returncode == 2
    assert "--engine-id" in proc.stderr
    assert not db.exists()
