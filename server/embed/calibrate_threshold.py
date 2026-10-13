import os
import sqlite3
import sys
import time

import numpy as np

# reuse model loading + vector normalization from the embed service in this directory
import embed_service
from embed_service import get_model, _l2_normalize

MODEL_TAG = "wemm-embedding-2b"

# built-in Chinese physics-scene text queries (text -> image cross-modal matching)
DEFAULT_QUERIES = [
    "游乐场里游客坐在转椅上被绳子拉着绕圈飞",  # (a) 长描述句, 强信号
    "游乐场",                                  # (b) 短词, 弱信号
    "传送带上的划痕",                          # (c) 中长描述
]

# threshold tiers to inspect against the real distribution
THRESHOLDS = [0.35, 0.30, 0.25, 0.22, 0.20]


def load_index_vectors(db_path, engine_id):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT question_id, dim, vector FROM question_embeddings WHERE engine_id = ? AND model = ?",
        (engine_id, MODEL_TAG),
    ).fetchall()
    conn.close()
    ids = []
    matrix = []
    for qid, dim, blob in rows:
        vec = np.frombuffer(blob, dtype=np.float32).reshape(int(dim))
        ids.append(qid)
        matrix.append(vec)
    if not matrix:
        return ids, np.zeros((0, 0), dtype=np.float32)
    return ids, np.asarray(matrix, dtype=np.float32)


def main(db_path: str, engine_id: str, queries: list[str], top_n: int) -> None:
    qids, matrix = load_index_vectors(db_path, engine_id)
    print(f"loaded vectors: {len(qids)} (engine={engine_id}, model={MODEL_TAG})")
    if len(qids) == 0:
        print("no vectors found; abort")
        return

    model = get_model()
    t0 = time.time()
    qvecs = model.encode(queries, batch_size=1, normalize_embeddings=True, convert_to_numpy=True)
    qvecs = _l2_normalize(qvecs)
    print(f"model loaded + text encoded in {time.time() - t0:.1f}s")

    for qi, qtext in enumerate(queries):
        sims = matrix @ qvecs[qi]  # both sides L2-normalized -> dot == cosine
        order = np.argsort(-sims)
        print(f"\n=== query: {qtext!r} ===")
        for rank in range(min(top_n, len(order))):
            idx = int(order[rank])
            print(f"  #{rank + 1}  score={sims[idx]:.4f}  qid={qids[idx][:8]}")
        print("  threshold passes (题数 >= 阈值):")
        for th in THRESHOLDS:
            cnt = int(np.sum(sims >= th))
            print(f"    >={th:.2f} : {cnt} 题")

    print("\n=== 校准原则与实测参考 ===")
    print("跨模态匹配: 文字 query 向量 × 题目图片向量 的余弦相似度(向量已 L2 归一化, 点积即余弦)。")
    print("值域: 跨模态余弦绝对值域约 0.20~0.35, 信号越强 top1 越高, 短词/弱信号 top1 明显偏低。")
    print("历史事故: 阈值拍脑袋定为 0.35 时几乎滤掉全部结果, 真机排查很久才发现 -> 阈值切勿过高。")
    print("实测参考: 长句 top1≈0.35, 短词 top1≈0.28, 推荐 SEMANTIC_MIN_SCORE = 0.25。")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="calibrate SEMANTIC_MIN_SCORE via real cross-modal cosine scores")
    parser.add_argument("db_path", help="path to the SQLite question bank")
    parser.add_argument("--engine-id", required=True, help="engine id this index belongs to（库与引擎一一绑定，不允许默认）")
    parser.add_argument("--queries", default=None, help="pipe-separated text queries; defaults to 3 built-in physics scenes")
    parser.add_argument("--top", type=int, default=5, help="how many top results to print per query")
    args = parser.parse_args()

    queries = args.queries.split("|") if args.queries else DEFAULT_QUERIES
    main(args.db_path, args.engine_id, queries, args.top)
