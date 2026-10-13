import os
import sqlite3
import sys
import time

import numpy as np
import requests

MODEL_TAG = "wemm-embedding-2b"
DEFAULT_SERVICE_URL = "http://127.0.0.1:3002"
BATCH_SIZE = 8
REQUEST_TIMEOUT_SECONDS = 600


def pending_rows(conn, all_rows, engine_id):
    existing = {r[0] for r in conn.execute(
        "SELECT question_id FROM question_embeddings WHERE engine_id = ?", (engine_id,)
    ).fetchall()}
    return [r for r in all_rows if r[0] not in existing]


def encode_images(service_url, images, batch_no, batch_total):
    url = service_url.rstrip("/") + "/encode-images"
    context = f"{url} 批次 {batch_no}/{batch_total}（{len(images)} 张）"
    try:
        response = requests.post(
            url, json={"images": images}, timeout=REQUEST_TIMEOUT_SECONDS
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"编码服务不可达：{context}：{exc}") from exc
    if response.status_code != 200:
        raise RuntimeError(
            f"编码服务返回 HTTP {response.status_code}：{context}，响应体：{response.text[:300]}"
        )
    return response.json()["vectors"]


def main(db_path: str, service_url: str, engine_id: str, force: bool = False) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS question_embeddings (
    engine_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (engine_id, question_id)
  )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_engine ON question_embeddings(engine_id)")
    all_rows = conn.execute(
        "SELECT id, question_image_url FROM questions WHERE deleted_at IS NULL AND question_image_url LIKE 'data:%'"
    ).fetchall()
    rows = all_rows if force else pending_rows(conn, all_rows, engine_id)
    print(f"questions: {len(all_rows)}, to index: {len(rows)}{' (force)' if force else ' (diff)'}")
    if not rows:
        print("nothing to index; service not called")
        return

    batch_total = (len(rows) + BATCH_SIZE - 1) // BATCH_SIZE
    t0 = time.time()
    vectors = []
    for index in range(batch_total):
        batch = rows[index * BATCH_SIZE:(index + 1) * BATCH_SIZE]
        vectors.extend(encode_images(service_url, [url for _, url in batch], index + 1, batch_total))
    elapsed = time.time() - t0

    if len(vectors) != len(rows):
        raise RuntimeError(f"编码服务返回向量数 {len(vectors)} 与题目数 {len(rows)} 不一致")

    for (qid, _), vec in zip(rows, vectors):
        array = np.asarray(vec, dtype=np.float32)
        conn.execute(
            "INSERT OR REPLACE INTO question_embeddings (engine_id, question_id, model, dim, vector, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
            (engine_id, qid, MODEL_TAG, int(array.shape[0]), array.tobytes()),
        )
    conn.commit()
    total = conn.execute(
        "SELECT COUNT(*) FROM question_embeddings WHERE engine_id = ? AND model = ?", (engine_id, MODEL_TAG)
    ).fetchone()[0]
    print(f"engine={engine_id} service={service_url} indexed={len(rows)} elapsed={elapsed:.1f}s avg={elapsed / max(len(rows), 1) * 1000:.0f}ms/img total_in_table={total}")


def parse_args(argv):
    engine_id = None
    service_url = None
    positional = []
    i = 0
    while i < len(argv):
        if argv[i] == "--engine-id" and i + 1 < len(argv):
            engine_id = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--service-url" and i + 1 < len(argv):
            service_url = argv[i + 1]
            i += 2
            continue
        positional.append(argv[i])
        i += 1
    if service_url is None:
        service_url = os.environ.get("EMBED_SERVICE_URL") or DEFAULT_SERVICE_URL
    force_flag = "--force" in argv
    rest = [a for a in positional if not a.startswith("--")]
    target_db = rest[0] if rest else os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data.db"))
    return target_db, service_url, engine_id, force_flag


if __name__ == "__main__":
    target_db, service_url, engine_id, force_flag = parse_args(sys.argv[1:])
    if not engine_id:
        print("必须指定 --engine-id（库与引擎一一绑定，不允许默认）")
        sys.exit(2)
    main(target_db, service_url, engine_id, force_flag)
