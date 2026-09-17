import base64
import io
import os
import sqlite3
import sys
import time

import numpy as np
import torch

MODEL_TAG = "wemm-embedding-2b"
DEFAULT_MODEL = os.path.expanduser(
    "~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"
)


def main(db_path: str, model_path: str, force: bool = False) -> None:
    from sentence_transformers import SentenceTransformer

    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS question_embeddings (
            question_id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            dim INTEGER NOT NULL,
            vector BLOB NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )"""
    )
    all_rows = conn.execute(
        "SELECT id, question_image_url FROM questions WHERE deleted_at IS NULL AND question_image_url LIKE 'data:%'"
    ).fetchall()
    if force:
        rows = all_rows
    else:
        existing = {r[0] for r in conn.execute(
            "SELECT question_id FROM question_embeddings WHERE model = ?", (MODEL_TAG,)
        ).fetchall()}
        rows = [r for r in all_rows if r[0] not in existing]
    print(f"questions: {len(all_rows)}, to index: {len(rows)}{' (force)' if force else ' (diff)'}")
    if not rows:
        print("nothing to index; model not loaded")
        return

    from PIL import Image

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = SentenceTransformer(model_path, trust_remote_code=True, device=device)

    inputs = [{"image": Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))} for _, url in rows]
    t0 = time.time()
    vectors = model.encode(inputs, batch_size=1, normalize_embeddings=True, convert_to_numpy=True)
    elapsed = time.time() - t0

    for (qid, _), vec in zip(rows, vectors):
        conn.execute(
            "INSERT OR REPLACE INTO question_embeddings (question_id, model, dim, vector, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
            (qid, MODEL_TAG, int(vec.shape[0]), np.asarray(vec, dtype=np.float32).tobytes()),
        )
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM question_embeddings WHERE model = ?", (MODEL_TAG,)).fetchone()[0]
    print(f"indexed={len(rows)} elapsed={elapsed:.1f}s avg={elapsed / max(len(rows), 1) * 1000:.0f}ms/img total_in_table={total}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force_flag = "--force" in sys.argv
    target_db = args[0] if args else os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data.db"))
    main(target_db, os.environ.get("WEMM_MODEL_PATH", DEFAULT_MODEL), force_flag)
