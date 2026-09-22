# 题库语义检索落地实施计划（WeMM-2B 混合检索）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有题库 App 中落地"混合语义检索"——字面/标签召回保持不变，新增 WeMM-2B 向量语义召回（文字搜题 + 详情页找相似题），服务不可用时静默退化为现有匹配。

**Architecture:** Mac mini 上新增一个常驻 Python 编码微服务（FastAPI :3002，加载 WeMM-2B），Express (:3001) 增加带鉴权的转发与向量下发路由；建库脚本把 91 题图片批量编码写入 SQLite 新表；客户端经 `remoteCall` 拉取向量存 localForage，检索计算全部在客户端本地完成（余弦暴力排序，89 题毫秒级）。字面命中置顶、语义结果作为"语义相关"补充区块；详情页新增"找相似题"按钮（纯本地向量，离线可用）。

**Tech Stack:** Python 3.13（venv: `~/.workbuddy/binaries/python/envs/default`）+ FastAPI/uvicorn + sentence-transformers（MPS）；服务端 Express 5 (ESM, tsx) + better-sqlite3；客户端 TypeScript + localForage；测试 vitest + Playwright。

---

## 0. 评测依据（2026-09-15 实测，报告：`tmp/wemm-eval/report.md`）

| 事实 | 数据 |
|---|---|
| L1 字面查询 | 现有标签/字面匹配 Recall@5=0.81 **仍最强**，不替换 |
| L2 同义改述 | WeMM 0.80 vs 现有 0.20 |
| L3 生活场景 | WeMM 0.93 vs 现有 **0.00**（完全失效） |
| 文本 query 编码耗时 | **117ms/条**（M4, MPS） |
| 图片建库耗时 | **2.19s/张**，89 题全量 195s |
| 向量存储 | 89 题 × 2048 维 fp32 ≈ **720KB**（全维无压力，不做 MRL 截断） |

## 1. 关键决策（已按第一性原理定稿，执行前可推翻）

| # | 决策 | 理由 | 被否掉的备选 |
|---|---|---|---|
| D1 | 编码服务 = **独立 FastAPI 进程（:3002），模型懒加载 + 空闲自动卸载**（默认 15 分钟无请求释放内存并清 MPS 缓存，`WEMM_IDLE_UNLOAD_SECONDS` 可调，0=常驻）；建库脚本默认**只扫 diff 编码新题** | 2B 模型常驻约 4.7GB，16GB 机器压力过大（王先生 2026-09-15 提出）；懒加载后**默认内存占用≈0**，仅搜索/建库时临时加载。加载 17.3s、文本编码 117ms、图 2.19s/张——搜索多为连续动作，一次冷启动后全程秒回 | 完全常驻（内存账不过，已否）；Express 内 spawn python（每次冷启动 17s 无复用）；换 190M 级小模型（向量空间必须与题图一致，换模型需重做评测，列为后续可选项） |
| D2 | 向量存 **server SQLite 新表 + 客户端 localForage**，检索在客户端算 | 91 题 × 2048 维检索客户端毫秒级；复用 `remoteCall`；相似题纯离线 | server 端检索（每次搜索都依赖网络往返计算） |
| D3 | 混合排序 = **字面命中置顶（原序）+ 语义 top-10 补充区块** | L1 字面强、L2/L3 语义强，互补不替代 | 语义重排全部（会劣化 L1） |
| D4 | 相似题入口 = **详情页"找相似题"按钮 + 独立弹层**，逻辑全在 `renderDetailContent` 动态注入 | 不依赖 index.html 静态结构；与现有动态拼 HTML 惯例一致 | 恢复旧 similar_question_links 数据链路（表已空） |
| D5 | **不做**设置开关，编码失败**静默降级**为字面 | YAGNI；降级即开关 | 语义/字面手动切换开关 |
| D7 | **以图搜题**（A2：拍新题/选图 → 找库里同类题）入口 = 搜索框旁图片按钮，拍照/相册皆可（复用 `@capacitor/camera`），结果以「图片匹配 (N)」区块展示（样式复用语义卡片）；服务端复用 `/encode-images` 端点 | WeMM 图片输入是其本行，端点已在 T1；与"拍照加题"流程共用选图能力；这是王先生 2026-09-15 明确补齐的需求，评测已证明同模型跨模态空间有效（89 图索引即证据） | 独立搜索页（交互割裂）；粘贴图片（移动端不实际） |
| D6 | **AI 自验证驱动，仅 2 个用户确认点**（见 §1.5）；commit 在真机验收通过后统一执行 | 确认物必须是用户能判断的东西（运行效果/打包产物），而非代码 diff——王先生 2026-09-15 明确："没有打包的话，我确认我也确认不了" | 每个 Task 停下来等用户看代码（不可执行，已废弃） |

### 1.5 检查点与确认机制（2026-09-15 修订，取代"每 Task 等确认"）

**第一性原理**：检查点的价值 = 错误在哪个最便宜的时刻被发现。AI 写的代码由 AI 的测试验证（AGENTS.md 四连绿 + 截图可见性本就是 AI 的义务）；用户验证的是**只有用户能验证的东西**——真机上的行为是否符合预期。据此分两级：

| 级别 | 谁验证 | 验证物 | 频率 |
|---|---|---|---|
| **L1 AI 自验证**（不阻塞） | AI 自己 | 该 Task 的测试/typecheck/build/截图全绿；失败即停并报告，不往下走 | 每个 Task 结束 |
| **L1+ AI ego-browser 全链路验证**（不阻塞，2026-09-15 王先生批准引入） | AI 用 ego-browser 起真实服务链路（embed + Express + vite dev）亲手操作：搜语义、点相似题、断网降级 | 截图证据 + 一句话结论写入进度汇报，王先生扫一眼即可，发现问题随时叫停 | Task 8 完成后 |
| **L2 用户确认**（真正的停车点） | 王先生 | ① 一句话风险确认（写生产库前）；② **APK 真机验收**（最终，验收通过才统一 commit+push） | 全程仅 2 次 |

L1 结束时只给一句话进度汇报（做了什么、验证结果），不打断。AI 遇到自己解决不了的问题才停下询问（AGENTS.md「遇到问题及时沟通」）。

## 2. 架构与数据流

```
客户端(手机/浏览器)                Express :3001                    FastAPI :3002 (WeMM-2B 常驻)
 搜索框输入文字 ──①POST /api/embed/text──────────────► 转发(带auth) ──► encode-text (117ms)
 ◄──②向量(2048)──────────────────────────────────────────────────────────┘
 ③本地余弦排序(向量已提前同步到 localForage)
 ④渲染: 字面命中置顶 + "语义相关"补充区块
 详情页"找相似题" ──► 纯本地向量互排 ──► 弹层 top-6（零联网）

建库(离线一次性): build_index.py 读 data.db 图片 → 编码 → 写 question_embeddings 表
向量分发: GET /api/embed/vectors → 客户端 localForage（~730KB，随同步时机拉取）
离线兜底: ①/②失败 → 仅字面结果，UI 无感知（现状）
```

## 3. 环境前置（本机已就绪，2026-09-15 实测）

- 模型已下载：`~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95`（5.46GB）
- venv 就绪：`/Users/john/.workbuddy/binaries/python/envs/default`（torch 2.14.0 MPS ✓ / transformers 5.2.0 / sentence-transformers / qwen-vl-utils）
- **硬坑**：WorkBuddy 会话内所有 python 命令必须加 `PYTHONPATH=` 前缀（shim 会拦截 transformers 的文件扫描导致 PermissionError）；node 测试命令加 `NODE_OPTIONS=` 前缀（AGENTS.md 既有规则）
- 生产库：`/Users/john/question-bank-local/server/data.db`（54MB, WAL）。**T4 先在 tmp 副本演练，确认后才准碰生产库，且只 INSERT OR REPLACE 新表 `question_embeddings`**

---

### Task 1: Python 编码服务骨架 + 健康检查

**Files:**
- Create: `server/embed/requirements.txt`
- Create: `server/embed/embed_service.py`
- Create: `server/embed/start.sh`
- Create: `server/embed/tests/test_health.py`
- Create: `server/embed/tests/conftest.py`

**Step 1: 写失败测试** `server/embed/tests/conftest.py`

```python
import os, sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
import embed_service

@pytest.fixture(scope="session")
def client():
    embed_service.MODEL_PATH = os.environ.get(
        "WEMM_MODEL_PATH",
        os.path.expanduser("~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"),
    )
    with TestClient(embed_service.app) as c:
        yield c
```

`server/embed/tests/test_health.py`

```python
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["device"] in ("mps", "cpu")
```

**Step 2: 跑测试确认失败**

Run: `cd server/embed && PYTHONPATH= ../..//Users/john/.workbuddy/binaries/python/envs/default/bin/pytest tests/test_health.py -v 2>&1 | tail -5`
实际命令：`cd server/embed && PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/pytest tests/test_health.py -v`
Expected: FAIL（`ModuleNotFoundError: fastapi` 或 `embed_service` 不存在）

**Step 3: 最小实现** `server/embed/requirements.txt`

```
fastapi
uvicorn
sentence-transformers
torch
transformers==5.2.0
qwen-vl-utils
pillow
numpy
pytest
httpx
```

`server/embed/embed_service.py`

```python
import base64
import gc
import io
import os
import threading
import time

import torch
from fastapi import FastAPI
from pydantic import BaseModel

MODEL_PATH = os.environ.get(
    "WEMM_MODEL_PATH",
    os.path.expanduser("~/.cache/huggingface/hub/models--tencent--WeMM-Embedding-2B/snapshots/bbd6cd4bf52cfc6716f752a2df80b2706720bd95"),
)
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
IDLE_UNLOAD_SECONDS = int(os.environ.get("WEMM_IDLE_UNLOAD_SECONDS", "900"))  # 15 分钟空闲卸载；0=常驻

app = FastAPI()
_model = None
_model_lock = threading.Lock()
_busy = 0
_last_used = 0.0


def get_model():
    global _model, _last_used, _busy
    with _model_lock:
        _last_used = time.time()
        _busy += 1
        if _model is None:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(MODEL_PATH, trust_remote_code=True, device=DEVICE)
        return _model


def release_model():
    global _busy, _last_used
    with _model_lock:
        _busy = max(0, _busy - 1)
        _last_used = time.time()


def _unload_watchdog():
    global _model
    while True:
        time.sleep(60)
        if IDLE_UNLOAD_SECONDS <= 0:
            continue
        with _model_lock:
            if _model is not None and _busy == 0 and time.time() - _last_used > IDLE_UNLOAD_SECONDS:
                _model = None
                gc.collect()
                if DEVICE == "mps":
                    torch.mps.empty_cache()
                elif DEVICE == "cuda":
                    torch.cuda.empty_cache()


threading.Thread(target=_unload_watchdog, daemon=True).start()


class TextRequest(BaseModel):
    texts: list[str]


class ImagesRequest(BaseModel):
    images: list[str]


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "model_loaded": _model is not None,
            "idle_unload_seconds": IDLE_UNLOAD_SECONDS}


@app.post("/encode-text")
def encode_text(req: TextRequest):
    model = get_model()
    try:
        vectors = model.encode(req.texts, batch_size=8, normalize_embeddings=True, convert_to_numpy=True)
    finally:
        release_model()
    return {"device": DEVICE, "dim": int(vectors.shape[1]), "vectors": vectors.tolist()}


@app.post("/encode-images")
def encode_images(req: ImagesRequest):
    model = get_model()
    try:
        inputs = []
        for src in req.images:
            if src.startswith("data:"):
                b64 = src.split(",", 1)[1]
                inputs.append({"image": io.BytesIO(base64.b64decode(b64))})
            else:
                inputs.append({"image": src})
        vectors = model.encode(inputs, batch_size=1, normalize_embeddings=True, convert_to_numpy=True)
    finally:
        release_model()
    return {"device": DEVICE, "dim": int(vectors.shape[1]), "vectors": vectors.tolist()}
```

`server/embed/start.sh`

```bash
#!/bin/bash
cd "$(dirname "$0")"
exec /Users/john/.workbuddy/binaries/python/envs/default/bin/uvicorn embed_service:app --host 127.0.0.1 --port 3002
```

安装依赖并 `chmod +x start.sh`：
Run: `PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple fastapi uvicorn pytest httpx && chmod +x server/embed/start.sh`

**Step 4: 跑测试确认通过**

Run: `cd server/embed && PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/pytest tests/test_health.py -v`
Expected: PASS（首次触发模型加载约 17s，仅 health 端点不会真正加载模型）

**Step 5: L1 自验证后自动继续**（pytest 全绿 + `git status` 留档，一句话进度汇报，不等确认）

---

### Task 2: encode-text / encode-images 端点测试（TDD 补断言）

**Files:**
- Test: `server/embed/tests/test_encode.py`

**Step 1: 写测试**

```python
import base64

TEXT_DIM = 2048

# 1x1 红色 PNG（占位，仅验证链路与维度）
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_encode_text(client):
    r = client.post("/encode-text", json={"texts": ["斜面上滑块的摩擦力分析"]})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == TEXT_DIM
    vec = body["vectors"][0]
    assert len(vec) == TEXT_DIM
    norm = sum(x * x for x in vec) ** 0.5
    assert abs(norm - 1.0) < 1e-3


def test_encode_images(client):
    data_url = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()
    r = client.post("/encode-images", json={"images": [data_url, data_url]})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == TEXT_DIM
    assert len(body["vectors"]) == 2


def test_encode_text_rejects_bad_input(client):
    assert client.post("/encode-text", json={"texts": []}).status_code == 422
```

**Step 2: 跑** —— `PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/pytest tests/test_encode.py -v`
Expected: PASS（实现已在 Task 1 完成；此处是把行为锁进测试。若 422 未过则补 Pydantic `min_length=1`）

**Step 3: L1 自验证后自动继续**（提交规则同 D6）

---

### Task 3: 建库脚本 build_index.py（先在 tmp 副本演练）

**Files:**
- Create: `server/embed/build_index.py`

**Step 1: 实现**

```python
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
        print("nothing to index; model not loaded")  # 无新题时 17s 加载都不发生
        return

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = SentenceTransformer(model_path, trust_remote_code=True, device=device)

    inputs = [{"image": io.BytesIO(base64.b64decode(url.split(",", 1)[1]))} for _, url in rows]
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
```

**Step 2: 在 tmp 副本上演练（不碰生产库）**

Run: `cd server/embed && PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/python build_index.py ../../tmp/wemm-eval/data.db`
Expected: `indexed=89 ... avg≈2190ms/img total_in_table=89`

**Step 3: 校验副本向量**

Run: `sqlite3 ../../tmp/wemm-eval/data.db "SELECT COUNT(*), MIN(dim), MAX(dim) FROM question_embeddings;"`
Expected: `89|2048|2048`

**Step 4: L2 用户确认点 ①（唯一的数据风险停车点）** —— 用非代码语言汇报：「tmp 副本演练 89/89 成功、现有题目数据 0 改动、即将对生产库执行同样操作（只写新表，不碰任何现有数据）」，等王先生回复「可以」才执行 Step 5。

**Step 5: 对生产库执行**

Run: `cd server/embed && PYTHONPATH= /Users/john/.workbuddy/binaries/python/envs/default/bin/python build_index.py /Users/john/question-bank-local/server/data.db`
（只写新表，`INSERT OR REPLACE` 限 `question_embeddings`；现有表零改动。执行前 cp 一份生产库到 `tmp/` 留底。）

---

### Task 4: Express 路由 `/api/embed`（转发 + 向量下发）

**Files:**
- Create: `server/src/routes/embed.ts`
- Modify: `server/src/db/schema.ts`（末尾追加建表）
- Modify: `server/src/app.ts`（挂载路由）
- Test: `server/test/embed-route.test.ts`（先确认 `server/test/` 既有测试的运行方式再对齐）

**Step 1: 读既有模式**（执行者先做）：
`cat server/src/db/schema.ts | tail -30` 与 `ls server/test/`，确认 schema 收尾处与测试约定。

**Step 2: 单测先行（纯函数部分）** `server/test/embed-route.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { validateTexts } from '../src/routes/embed.js';

describe('validateTexts', () => {
  it('接受 1-8 个 ≤200 字符字符串', () => {
    expect(validateTexts(['斜面摩擦'])).toEqual([]);
    expect(validateTexts(Array(8).fill('x'))).toEqual([]);
  });
  it('拒绝空数组/超量/超长/非字符串', () => {
    expect(validateTexts([])).toHaveLength(1);
    expect(validateTexts(Array(9).fill('x'))).toHaveLength(1);
    expect(validateTexts(['x'.repeat(201)])).toHaveLength(1);
    expect(validateTexts([42 as unknown as string])).toHaveLength(1);
  });
});
```

Run: `cd server && NODE_OPTIONS= npx vitest run test/embed-route.test.ts`
Expected: FAIL（`validateTexts` 不存在）

**Step 3: 实现** `server/src/routes/embed.ts`

```typescript
import { Router } from 'express';
import db from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const EMBED_BASE = process.env.EMBED_SERVICE_URL || 'http://127.0.0.1:3002';
const MODEL_TAG = 'wemm-embedding-2b';

export function validateTexts(texts: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 8) {
    errors.push('texts 必须为 1-8 个字符串');
    return errors;
  }
  if (texts.some((t) => typeof t !== 'string' || (t as string).length > 200)) {
    errors.push('每条文本必须是不超过 200 字的字符串');
  }
  return errors;
}

router.post('/text', async (req, res) => {
  const errors = validateTexts(req.body?.texts);
  if (errors.length) {
    res.status(400).json({ error: errors[0] });
    return;
  }
  try {
    const resp = await fetch(`${EMBED_BASE}/encode-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: req.body.texts }),
      signal: AbortSignal.timeout(45000),  // 45s：需覆盖懒加载冷启动 17s + 编码与排队余量
    });
    if (!resp.ok) {
      res.status(502).json({ error: `编码服务返回 ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { dim: number; vectors: number[][] };
    res.json(data);
  } catch {
    res.status(503).json({ error: '语义编码服务不可用' });
  }
});

router.post('/image', async (req, res) => {
  const image = req.body?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 10 * 1024 * 1024) {
    res.status(400).json({ error: 'image 必须是 10MB 内的图片 data URL' });
    return;
  }
  try {
    const resp = await fetch(`${EMBED_BASE}/encode-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [image] }),
      signal: AbortSignal.timeout(60000),  // 冷启动 17s + 上传 + 图片编码 2.2s 余量
    });
    if (!resp.ok) {
      res.status(502).json({ error: `编码服务返回 ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { dim: number; vectors: number[][] };
    res.json(data);
  } catch {
    res.status(503).json({ error: '语义编码服务不可用' });
  }
});

router.get('/vectors', (_req, res) => {
  const rows = db
    .prepare('SELECT question_id, dim, vector FROM question_embeddings WHERE model = ?')
    .all(MODEL_TAG) as { question_id: string; dim: number; vector: Buffer }[];
  const embeddings = rows.map((r) => ({
    question_id: r.question_id,
    dim: r.dim,
    vector: Buffer.from(r.vector).toString('base64'),
  }));
  res.json({ model: MODEL_TAG, count: embeddings.length, embeddings });
});

export default router;
```

`server/src/db/schema.ts` 末尾追加：

```typescript
db.exec(`CREATE TABLE IF NOT EXISTS question_embeddings (
  question_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
)`);
```

`server/src/app.ts` 追加两处（对齐既有挂载风格）：

```typescript
import embedRouter from './routes/embed.js';
// ...
app.use('/api/embed', embedRouter);
```

**Step 4: 单测转绿**

Run: `cd server && NODE_OPTIONS= npx vitest run test/embed-route.test.ts`
Expected: PASS

**Step 5: 冒烟（双服务起后手动验）**

```bash
server/embed/start.sh &          # :3002
cd server && npx tsx src/index.ts &   # :3001
curl -s http://127.0.0.1:3002/health
# 注册/登录拿 token 后：
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/embed/vectors | head -c 200
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"texts":["传送带"]}' http://127.0.0.1:3001/api/embed/text
```
Expected: health ok；vectors `count: 89`；text 返回 `dim: 2048`

**Step 6: L1 自验证后自动继续**（curl 冒烟输出留档作证）

---

### Task 5: 客户端语义服务 `semantic.ts`（TDD）

**Files:**
- Create: `src/services/semantic.ts`
- Modify: `src/services/index.ts`（追加导出）
- Test: `unit-tests/semantic.spec.js`（命名对齐 vitest include 的 `*.spec.{js,ts}` 模式，2026-09-15 修正：原规格 `semantic.test.js` 不会被 `npm test` 收集）

**Step 1: 写失败测试** `unit-tests/semantic.test.js`

```javascript
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, decodeVector, mergeRankings } from '../src/services/semantic';

function f32base64(arr) {
  const bytes = new Uint8Array(Float32Array.from(arr).buffer);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

describe('decodeVector', () => {
  it('base64 → Float32Array 往返一致', () => {
    const v = decodeVector(f32base64([0.5, -1.25, 2]));
    expect(Array.from(v)).toEqual([0.5, -1.25, 2]);
  });
});

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0，零向量保护', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe('mergeRankings', () => {
  it('字面置顶，语义去重后按分数取 top-K', () => {
    const out = mergeRankings(
      ['a', 'b'],
      [{ id: 'b', score: 0.99 }, { id: 'c', score: 0.9 }, { id: 'd', score: 0.8 }, { id: 'e', score: 0.7 }],
      2
    );
    expect(out.literal).toEqual(['a', 'b']);
    expect(out.semantic.map((s) => s.id)).toEqual(['c', 'd']);
  });
  it('语义为空时返回空补充区', () => {
    const out = mergeRankings(['a'], []);
    expect(out.semantic).toEqual([]);
  });
});
```

Run: `cd . && NODE_OPTIONS= npx vitest run unit-tests/semantic.test.js`
Expected: FAIL（模块不存在）

**Step 2: 实现** `src/services/semantic.ts`

```typescript
export function decodeVector(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SemanticHit { id: string; score: number }

export function mergeRankings(literalIds: string[], semanticScores: SemanticHit[], semanticTopK = 10): { literal: string[]; semantic: SemanticHit[] } {
  const literalSet = new Set(literalIds);
  const semantic = semanticScores
    .filter((s) => !literalSet.has(s.id))
    .sort((x, y) => y.score - x.score)
    .slice(0, semanticTopK);
  return { literal: literalIds, semantic };
}
```

`src/services/index.ts` 追加：`export * from './semantic';`

**Step 3: 跑测试转绿** —— 同上命令，Expected: PASS

**Step 4: L1 自验证后自动继续**（vitest 全绿留档）

---

### Task 6: 客户端向量数据层 + 类型

**Files:**
- Create: `src/data/embeddings.ts`
- Modify: `src/data/index.ts`（追加导出）
- Modify: `src/types/index.ts`（追加类型，或新建 `src/types/embedding.ts` 并在 index 导出）

**Step 1: 实现**

`src/types/index.ts` 追加：

```typescript
export interface QuestionEmbedding {
  question_id: string;
  dim: number;
  vector: string;
}
```

`src/data/embeddings.ts`：

```typescript
import localForage from 'localforage';
import { remoteCall, isSyncEnabled } from './sync';
import { decodeVector } from '../services/semantic';

export const dbEmbeddings = localForage.createInstance({ name: 'questionBank', storeName: 'embeddings' });

export async function refreshEmbeddings(): Promise<number> {
  if (!isSyncEnabled()) return 0;
  const res = (await remoteCall('/api/embed/vectors')) as { embeddings?: { question_id: string; dim: number; vector: string }[] };
  const items = res?.embeddings || [];
  await dbEmbeddings.clear();
  for (const it of items) {
    await dbEmbeddings.setItem(it.question_id, { question_id: it.question_id, dim: it.dim, vector: it.vector });
  }
  return items.length;
}

export async function getAllVectors(): Promise<Map<string, Float32Array>> {
  const map = new Map<string, Float32Array>();
  await dbEmbeddings.iterate((v: unknown) => {
    const item = v as { question_id: string; vector: string } | null;
    if (item?.vector) map.set(item.question_id, decodeVector(item.vector));
  });
  return map;
}
```

**Step 2: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

**Step 3: L1 自验证后自动继续**（typecheck 0 errors 留档）

---

### Task 7: 搜索集成（语义文字搜 + 以图搜题 + 离线静默降级）

**Files:**
- Create: `src/services/semantic-search.ts`（`encodeQuery` / `encodeImage` / `searchSemantic`）
- Modify: `src/ui/question-core.ts`（`filterQuestions` / 新增 `handleImageSearch` / `renderSemanticResults`）
- Modify: `src/index.html`（questions-list 后加 `<div id="semantic-results">`；搜索框行加图片按钮）
- Modify: `src/main.ts`（挂载新 window 函数）
- 参考: `src/ui/camera.ts` 与 `@capacitor/camera` 用法（选图模式对齐现有"拍照加题"链路）

**Step 1: E2E 先行（防回归，测试会失败）** —— 见 Task 9 的用例 A；此处先写用例 A 的骨架并确认失败。

**Step 2: 实现语义增强**（`question-core.ts` 追加/修改）：

```typescript
import { encodeText, searchSemantic } from '../services/semantic-search';
```

新建薄封装 `src/services/semantic-search.ts`（网络 + 状态，独立文件便于测试）：

```typescript
import { remoteCall } from '../data/sync';
import { getAllVectors } from '../data/embeddings';
import { cosineSimilarity } from './semantic';

export async function encodeQuery(text: string): Promise<Float32Array | null> {
  try {
    const res = (await remoteCall('/api/embed/text', 'POST', { texts: [text] })) as { vectors: number[][] };
    return new Float32Array(res.vectors[0]);
  } catch {
    return null;
  }
}

export async function encodeImage(dataUrl: string): Promise<Float32Array | null> {
  try {
    const res = (await remoteCall('/api/embed/image', 'POST', { image: dataUrl })) as { vectors: number[][] };
    return new Float32Array(res.vectors[0]);
  } catch {
    return null;
  }
}

export async function searchSemantic(queryVec: Float32Array, topK = 10): Promise<{ id: string; score: number }[]> {
  const vectors = await getAllVectors();
  const hits: { id: string; score: number }[] = [];
  vectors.forEach((vec, id) => hits.push({ id, score: cosineSimilarity(queryVec, vec) }));
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

`question-core.ts` 的 `filterQuestions()` 改为：

```typescript
export function filterQuestions(): void {
  showTagSuggestions();
  renderQuestions();
  void enhanceWithSemantic();
}

let _semanticToken = 0;

async function enhanceWithSemantic(): Promise<void> {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const text = input?.value?.trim() || '';
  const token = ++_semanticToken;
  const container = document.getElementById('semantic-results');
  if (!container) return;
  if (!text || text.length < 2) { container.replaceChildren(); return; }
  container.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'semantic-title';
  loading.textContent = '语义分析中…';
  container.appendChild(loading);
  const queryVec = await encodeQuery(text);
  if (token !== _semanticToken) return;
  if (!queryVec) { container.replaceChildren(); return; }
  const hits = await searchSemantic(queryVec);
  if (token !== _semanticToken) return;
  const literalIds = new Set(getFilteredQuestions().map((q: any) => q.id));
  const filtered = hits.filter((h) => !literalIds.has(h.id) && h.score > 0.35);
  renderSemanticResults(container, filtered);
}

function renderSemanticResults(container: HTMLElement, hits: { id: string; score: number }[], title: string = '语义相关'): void {
  container.replaceChildren();
  if (!hits.length) return;
  const titleEl = document.createElement('div');
  titleEl.className = 'semantic-title';
  titleEl.textContent = `${title} (${hits.length})`;
  container.appendChild(titleEl);
  const byId = new Map((w.allQuestions as any[]).map((q) => [q.id, q]));
  hits.forEach((h) => {
    const q = byId.get(h.id);
    if (!q || q.deleted_at) return;
    const card = document.createElement('div');
    card.className = 'semantic-card';
    card.innerHTML = `<img src="${q.question_image_url}" alt=""><span class="score">${Math.round(h.score * 100)}%</span>`;
    card.onclick = () => w.showQuestionDetail(q.id);
    container.appendChild(card);
  });
}

export async function handleImageSearch(): Promise<void> {
  const token = ++_semanticToken;
  let dataUrl: string;
  try {
    const photo = await w.Capacitor.Plugins.Camera.getPhoto({
      quality: 70, resultType: 'DataUrl', source: 'Prompt', width: 1200,
    });
    dataUrl = photo.dataUrl;
  } catch {
    return;  // 用户取消选图，静默
  }
  const container = document.getElementById('semantic-results');
  if (!container) return;
  container.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'semantic-title';
  loading.textContent = '图片匹配中…';
  container.appendChild(loading);
  const queryVec = await encodeImage(dataUrl);
  if (token !== _semanticToken) return;
  if (!queryVec) {
    container.replaceChildren();
    w.showStatus('图片匹配服务不可用', 'error');
    return;
  }
  const hits = await searchSemantic(queryVec, 12);
  if (token !== _semanticToken) return;
  const literalIds = new Set(getFilteredQuestions().map((q: any) => q.id));
  renderSemanticResults(container, hits.filter((h) => !literalIds.has(h.id)), '图片匹配');
}
```

`src/index.html` 在 `<div id="questions-list">` 之后追加：

```html
<div id="semantic-results" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-top:16px"></div>
```

搜索框所在行（`#search-input` 的父级 flex 行，执行时按实际 DOM 对齐）追加以图搜题按钮：

```html
<button id="btn-image-search" onclick="handleImageSearch()" title="以图搜题：拍照或从相册选图，找库里讲过的同类题" style="flex:0 0 auto;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--surface);cursor:pointer">
  <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="#8A87A0" stroke-width="1.3"/><circle cx="5.6" cy="6.4" r="1.3" fill="#8A87A0"/><path d="M2.5 11.5l3.2-3.2 2 2 2.6-2.6 3.2 3.8" fill="none" stroke="#8A87A0" stroke-width="1.3" stroke-linejoin="round"/></svg>
</button>
```

`src/styles/main.css` 追加（对齐 DESIGN.md token）：

```css
.semantic-title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin: 8px 0 4px; grid-column: 1 / -1; }
.semantic-card { position: relative; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; background: var(--surface); border: 0.5px solid var(--hairline); aspect-ratio: 3/4; }
.semantic-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.semantic-card .score { position: absolute; right: 6px; bottom: 6px; font-size: 11px; padding: 2px 8px; border-radius: var(--rounded-full, 999px); background: var(--grape-soft, #F0EBFF); color: var(--grape-deep, #7C58E8); }
```

**Step 3: typecheck + 单测 + 本地手测**

Run: `npm run typecheck && NODE_OPTIONS= npm run test:unit`
Expected: 全绿。浏览器手测：断网（或停 embed 服务）搜索 → 无语义区、无报错；起服务搜索"斜坡上拉货" → 语义区出现且首图为目标题。

**Step 4: L1 自验证后自动继续**（typecheck + 单测 + 本地手测截图留档）

---

### Task 8: 详情页"找相似题"（纯离线 A1 路径）

**Files:**
- Modify: `src/ui/question-detail.ts`（`renderDetailContent` 末尾注入按钮；新增 `showSimilarQuestions`）
- Modify: `src/index.html`（追加 `similar-modal` 骨架）
- Modify: `src/main.ts`（挂载 `showSimilarQuestions`）

**Step 1: E2E 先行** —— Task 9 用例 B 确认失败。

**Step 2: 实现**。`renderDetailContent(q)` 函数末尾追加：

```typescript
const tagsEl = document.getElementById('modal-tags');
if (tagsEl) {
  tagsEl.innerHTML += `<div style="margin-top:16px"><button onclick="showSimilarQuestions('${q.id}')" style="width:100%;padding:12px 20px;border:none;border-radius:var(--radius-md);background:linear-gradient(135deg,#9D7BFF,#7C58E8);color:#fff;font-size:14px;font-weight:700;cursor:pointer">🔍 找相似题</button></div>`;
}
```

`question-detail.ts` 追加：

```typescript
import { getAllVectors } from '../data/embeddings';
import { cosineSimilarity } from '../services/semantic';

export async function showSimilarQuestions(qId: string): Promise<void> {
  const vectors = await getAllVectors();
  const self = vectors.get(qId);
  if (!self) {
    w.showStatus('该题暂无语义索引（需在服务端执行一次建库）', 'error');
    return;
  }
  const hits: { id: string; score: number }[] = [];
  vectors.forEach((vec, id) => { if (id !== qId) hits.push({ id, score: cosineSimilarity(self, vec) }); });
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 6);
  const byId = new Map((w.allQuestions as any[]).map((q: any) => [q.id, q]));
  const list = document.getElementById('similar-list')!;
  list.replaceChildren();
  top.forEach((h) => {
    const q = byId.get(h.id);
    if (!q || q.deleted_at) return;
    const card = document.createElement('div');
    card.className = 'similar-card';
    card.innerHTML = `<img src="${q.question_image_url}" alt=""><span class="score">${Math.round(h.score * 100)}%</span>`;
    card.onclick = () => { w.closeModal('similar-modal'); w.showQuestionDetail(q.id); };
    list.appendChild(card);
  });
  w.openModal('similar-modal');
}
```

`src/index.html` 的 modal 区域（对齐既有 question-modal 写法）追加：

```html
<div id="similar-modal" class="modal">
  <div class="modal-content">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0;font-size:17px;font-weight:800">相似题</h2>
      <button class="modal-close" onclick="closeModal('similar-modal')">✕</button>
    </div>
    <div id="similar-list" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
  </div>
</div>
```

`src/styles/main.css` 追加：

```css
.similar-card { position: relative; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; background: var(--surface); border: 0.5px solid var(--hairline); aspect-ratio: 3/4; }
.similar-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.similar-card .score { position: absolute; right: 4px; bottom: 4px; font-size: 11px; padding: 2px 6px; border-radius: 999px; background: var(--grape-soft, #F0EBFF); color: var(--grape-deep, #7C58E8); }
```

（执行时先 `grep -n "class=\"modal" src/index.html | head -3` 核对 modal 的实际 class/结构，若与既有 modal 写法不一致，以既有写法为准。）

**Step 3: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

**Step 4: L1+ AI ego-browser 全链路验证（不停车，2026-09-15 王先生批准以 AI 验证替代本人试用）** —— 起真实服务链路（`server/embed/start.sh` + `npx tsx server/src/index.ts` + `npm run dev`），用 ego-browser 亲手操作三件事并截图：① 搜索"游乐场里旋转的椅子"看语义相关区是否出对题；② 点开一题按"找相似题"看弹层；③ 断网（停 embed 服务）再搜确认静默降级不炸。截图 + 结论写入进度汇报，王先生扫一眼即可，发现问题随时叫停，默认通过则进 Task 9。

---

### Task 9: E2E（mock 网络层，含 AGENTS.md 强制的截图可见性断言）

**Files:**
- Create: `tests/semantic-search.spec.js`

**前置阅读**：`playwright.config.js` 的 webServer 配置 + `tests/helpers/visibility.js` 的 `captureForReview` / `assertVisiblyRendered` 签名 + `tests/app.spec.js` 的初始化/隔离模式（E2E_TEST_PHONE）。

**Mock 策略**（不依赖真模型，E2E 稳定快速）：
- `page.route('**/api/embed/vectors')` → 返回 3 个伪向量（8 维：目标题 `[1,0,0,...]`、干扰题 `[0,1,0,...]`、自身）
- `page.route('**/api/embed/text')` → query"斜坡拉货"返回 `[1,0,0,...]`（与目标题同向），其余返回正交向量
- 失败兜底用例：`route.abort()` 模拟编码服务宕机

**用例**：

```javascript
// A. 字面零命中 + 语义命中 → "语义相关" 区块出现且目标题可见
test('语义搜索: 零字面命中时展示语义相关区块', async ({ page }) => {
  // ...mock routes + 按既有 spec 的方式进入题目页
  await page.fill('#search-input', '斜坡上把货物慢慢往上拽');
  const target = page.locator('#semantic-results .semantic-card').first();
  await expect(target).toBeVisible();
  await assertVisiblyRendered(page, '#semantic-results .semantic-card', '语义推荐卡片');
  await captureForReview(page, 'semantic-results');
});

// B. 编码服务不可用 → 静默降级，无语义区、无错误弹窗
test('语义服务宕机时静默降级', async ({ page }) => {
  // mock: /api/embed/text abort
  await page.fill('#search-input', '斜面上拉货');
  await expect(page.locator('#semantic-results .semantic-card')).toHaveCount(0);
  await expect(page.locator('#error-modal')).not.toBeVisible();
});

// C. 详情页"找相似题"按钮可见且可打开弹层
test('详情页找相似题按钮与弹层', async ({ page }) => {
  // 进入某题详情（沿用既有 spec 的详情打开路径）
  const btn = page.locator('#modal-tags button', { hasText: '找相似题' });
  await expect(btn).toBeVisible();
  await assertVisiblyRendered(page, '#modal-tags button', '找相似题按钮');
  await btn.click();
  await expect(page.locator('#similar-modal')).toBeVisible();
  await expect(page.locator('#similar-list .similar-card').first()).toBeVisible();
  await captureForReview(page, 'similar-modal');
});

// D. 以图搜题：点击图片按钮 → mock /api/embed/image → "图片匹配"区块出现
test('以图搜题结果区块', async ({ page }) => {
  // mock: /api/embed/image 返回与题 A 同向的伪向量（同用例 A 的向量设计）
  await page.click('#btn-image-search');
  await expect(page.locator('#semantic-results .semantic-title')).toHaveText(/图片匹配/);
  await expect(page.locator('#semantic-results .semantic-card').first()).toBeVisible();
  await assertVisiblyRendered(page, '#btn-image-search', '以图搜题按钮');
  await captureForReview(page, 'image-search-results');
});

// E. 以图搜题服务不可用 → 报错 toast、无残留 loading
test('以图搜题降级', async ({ page }) => {
  // mock: /api/embed/image abort
  await page.click('#btn-image-search');
  await expect(page.locator('#semantic-results .semantic-card')).toHaveCount(0);
  await expect(page.locator('#semantic-results .semantic-title')).toHaveCount(0);
});
```

**Step 1: 先写用例 → 跑失败**（Task 7/8 完成前必须红，验证测试确实抓住缺失）
**Step 2: 全部实现后跑绿**

Run: `NODE_OPTIONS= npx playwright test tests/semantic-search.spec.js --reporter=list --output=tmp/test-results-semantic`
Expected: 3 passed
**Step 3: AI 实际 Read 截图**（`tmp/test-results-semantic/screenshots/`），肉眼确认按钮/卡片可见、对比度正常（AGENTS.md 硬规则，白字白底事故教训）

**Step 4: L1 自验证后自动继续**（5 用例全绿 + 截图亲验留档；其中用例 A/B 必须在 Task 7/8 实现前先跑出失败，验证测试抓得住缺失）

---

### Task 10: 全量 CI/CD 验证 + 文档 + 打包

**Step 1: 全量本地 CI（按 AGENTS.md 顺序，全过才算完）**

```bash
npm run typecheck
npm run test
npm run build
NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-full
```

**Step 2: 生成开发文档** `docs/semantic-search-wemm2b.md`（功能、架构图、建库/启动命令、降级行为、评测摘要），并更新 `AGENTS.md` 的「开发文档索引」。

**Step 3: ship 打包**（先加载 ship-feature skill）：

```bash
npm run ship -- "语义检索: WeMM-2B 混合搜索与相似题（离线降级兜底）"
```

**Step 4: L2 用户确认点 ②（最终验收，你唯一需要"看懂"的东西就是它跑起来的样子）** —— APK 装上真机后验收清单：
1. 联网搜索"游乐场里旋转的椅子被绳子拉着绕圈飞"→ 出现"语义相关"区且首图为雪地转椅题
2. 飞行模式搜索 → 正常出字面结果，无报错弹窗
3. 详情页"找相似题"→ 飞行模式下也能出相似题卡片
4. 以图搜题：拍一张卷子上的题 → 出现"图片匹配"区且同类题靠前（联网时）；飞行模式点按钮 → toast 提示服务不可用，无崩溃
你说"可以"之后，AI 才执行统一 commit（一次提交全部改动，附功能说明），再按你的指令 push。验收不过 → 报 bug 回炉，重走 T10。

---

## 4. 验收清单

- [ ] `PYTHONPATH= pytest server/embed/tests -v` 全绿（含 2048 维与归一化断言）
- [ ] 建库：tmp 副本 89/89 → 用户确认后生产库 89/89，现有表行数与内容不变（`SELECT COUNT(*) FROM questions` 前后一致）
- [ ] `npm run typecheck` / `npm run test` / `npm run build` / playwright 全量 4 连绿
- [ ] E2E 截图 AI 亲验可见性（含对比度）
- [ ] 停掉 :3002 后搜索/详情完全正常（静默降级），无 console error
- [ ] 相似题在飞行模式下可用（向量在本地）

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| 写生产库 | 先 tmp 副本演练（T3 Step 2）；执行前 cp 留底；只 INSERT OR REPLACE 新表 |
| MPS 推理崩溃 | embed 服务崩溃只影响语义层，Express/客户端照常；`/health` 探活 + 503 降级路径已内建 |
| base64 图经 encode-images 全量传输过大 | 建库走本地脚本读库文件，不走 HTTP；HTTP 端点仅供测试与未来增量 |
| 向量表与题目删除不同步 | 客户端渲染时按 `deleted_at` 过滤（已实现）；server 建库脚本只取未删题；后续可加每日重建（不在本期） |
| test 环境端口冲突 | embed 服务端口可由 `EMBED_SERVICE_URL` 覆盖；E2E 全程 mock 不起真服务 |
| 懒加载冷启动 17s 出现在首次搜索 | 前端「语义分析中…」加载态（状态可见性原则）；Express 超时放宽 45s；连续搜索命中已加载模型无感；`WEMM_IDLE_UNLOAD_SECONDS` 可调（0=常驻） |
| 空闲卸载与编码请求竞态 | `_busy` 引用计数 + 互斥锁：编码期间禁止卸载（T1 代码内置）；watchdog 仅在 `_busy==0` 且超时才卸载 |

## 6. 明确不做（YAGNI）

- 多设备向量增量同步（全量 730KB 拉取已够用）
- 语义/字面手动开关（静默降级即开关）
- 相似题数据入库/同步（纯计算，无需持久化）
- HNSW/FAISS 向量索引（91 题暴力扫即可）
- 音视频模态、9B/4B 模型
