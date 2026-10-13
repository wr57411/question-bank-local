# 编码引擎 HTTP 契约（唯一权威文档）

本文档钉死"编码引擎"对外暴露的 HTTP 接口形状。**调用层不认识背后是谁**：只要一个引擎满足本契约，它就能被 `server/src/routes/embed.ts` 及其上层透明替换。

现有实现：

| 引擎 | 位置 | 设备 |
|---|---|---|
| Mac 裸机 | `server/embed/embed_service.py` | `mps` / `cpu` |
| Linux Docker | 部署仓库 `deploy/wemm/app.py`（不在本仓库） | `cuda` |

契约一致性测试：`server/embed/tests/test_engine_contract.py`（见文末"如何验证"）。

---

## 1. 路由总览

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/health` | 引擎探活 + 指纹字段 |
| `POST` | `/encode-text` | 文本 → 向量 |
| `POST` | `/encode-images` | 图片 → 向量 |

三条路由必须存在。未定义的路由返回 `404`。

---

## 2. `GET /health`

成功返回 `200`，响应体为 JSON 对象。

### 2.1 必需字段

以下 7 个字段**每个引擎都必须提供**，缺一即为违约：

| 字段 | 类型 | 含义 |
|---|---|---|
| `ok` | `boolean` | 进程存活，恒为 `true` |
| `device` | `string` | 运行设备，如 `mps` / `cpu` / `cuda` |
| `model_loaded` | `boolean` | 模型当前是否驻留内存（受 idle-unload 影响，可能为 `false`） |
| `model_path` | `string` | 模型权重目录的绝对路径 |
| `dtype` | `string` | 模型数值精度，如 `bfloat16` / `float32` |
| `torch` | `string` | `torch` 版本号 |
| `transformers` | `string` | `transformers` 版本号 |

> `model_path` / `device` / `dtype` / `torch` / `transformers` 五项是**引擎指纹**的来源（`server/src/routes/embed.ts` 的 `buildFingerprint`）。指纹用于判断"库里的向量是否由同一个引擎产出"，因此这五项缺一不可。

### 2.2 可选字段

以下字段可以出现，也可以不出现；调用层**不得依赖**它们的存在：

| 字段 | 类型 | 含义 |
|---|---|---|
| `idle_unload_seconds` | `integer` | 空闲多久后卸载模型；`<= 0` 表示不卸载 |
| `dim` | `integer` | 本引擎输出向量维度 |
| `batch` | `integer` | 引擎内部批大小 |
| `image_dir` | `string` | 引擎侧图片目录（若实现使用） |
| `dtype_source` | `string` | `dtype` 的取值来源，如 `config` / `fallback` |

调用层如需读取可选字段，必须先判空。

---

## 3. `POST /encode-text`

### 3.1 请求体

```json
{ "texts": ["第一句", "第二句"] }
```

- `texts`：**必需**，字符串数组。
- 条数：**1–64**（含端点）。0 条或超过 64 条返回 `422`。
- 每个元素必须是字符串；否则 `422`。

### 3.2 响应体

成功返回 `200`：

```json
{ "dim": 2048, "vectors": [[0.01, -0.02, ...], [0.03, 0.04, ...]] }
```

- `dim`：`integer`，单个向量的长度。
- `vectors`：`number[][]`，`vectors.length` **必须等于**请求中 `texts` 的条数，且每个向量的长度等于 `dim`。
- `device`：`string`，**可选**字段。调用层不得依赖其存在。

---

## 4. `POST /encode-images`

### 4.1 请求体

```json
{ "images": ["data:image/png;base64,iVBORw0KGgo..."] }
```

- `images`：**必需**，字符串数组。
- 条数：**1–8**（含端点）。0 条或超过 8 条返回 `422`。
- 每个元素**必须是 `data:` URI**（形如 `data:image/<type>;base64,<payload>`）。
- **安全硬约束**：任何非 `data:` 的输入（尤其是文件路径、`http(s)://` URL）一律返回 `400`，消息需说明"只接受 `data:` URI"。引擎**不得**把调用方传来的字符串当作文件路径打开——那等于把"读取进程内任意文件"的能力交给调用方，并且 `200`/`500` 的差异还会变成文件存在性预言机。
- **校验必须先于模型加载**：`images` 的条数与 `data:` 校验要在引擎加载权重之前完成。这样坏请求不会白白触发一次昂贵的模型加载，**并且拒绝路径可以在不加载模型的前提下被测试**（`server/embed/tests/test_engine_validation.py` 正是靠这一点运行）。`/encode-text` 同理：条数校验由请求体模型承担，天然先于处理函数体内的加载。

### 4.2 响应体

与 `/encode-text` 完全同形：

```json
{ "dim": 2048, "vectors": [[...]] }
```

- `vectors.length` **必须等于**请求中 `images` 的条数。
- `device`：`string`，**可选**字段。

---

## 5. 错误码约定

| 状态码 | 语义 | 当前产生方 |
|---|---|---|
| `400` | 参数非法。例如 `images` 中出现非 `data:` URI 的输入 | 引擎 |
| `413` | 单张图片超过 10MB | 调用层（`server/src/routes/embed.ts:85` 在转发前拦截）；引擎侧为**约定保留码** |
| `422` | 请求体校验失败：数量越界、类型错误、缺字段、JSON 结构不合法 | 引擎 |
| `503` | 服务不可用：调用层探测不到引擎（连接失败/超时） | 调用层 |

补充说明：

- `400` 与 `422` 的边界是"结构对不对"与"值合不合法"的常见划分，但本契约只要求：**数量越界/类型错误/缺字段 → `422`；非 `data:` 的图片输入 → `400`**。契约测试只断言这两类。
- `413` 目前不由任何引擎产生：单图 10MB 上限在调用层拦截。引擎若自行加字节上限，必须使用 `413`。契约测试不断言此项（无法在不构造超大请求的前提下稳定触发）。
- 引擎在正常情况下不得返回 `5xx`（除不可恢复的内部错误）。

---

## 6. 维度（`dim`）

**`dim` 允许逐引擎不同。** 每个引擎有自己的向量库（`question_embeddings.engine_id`），建库与检索都绑定同一个 `engine_id`，因此不需要跨引擎对齐维度，也不需要对齐向量语义。

调用层的硬约束：**不得把 A 引擎的 query 向量与 B 引擎库里的向量做比较**（`server/src/routes/embed.ts` 的 `filterVectorsByEngine` 已按 `engine_id` 过滤）。跨引擎混用会静默产生无意义结果。

---

## 7. 如何验证

契约测试对**任意**引擎实例都能跑：

```bash
cd server/embed && PYTHONPATH= ~/.workbuddy/binaries/python/envs/default/bin/python -m pytest tests/test_engine_contract.py -v
```

- 目标地址从环境变量 `EMBED_SERVICE_URL` 读取，默认 `http://127.0.0.1:3002`。
- 引擎不可达时测试整体 `skip`，不会制造假失败。
- ⚠️ **先确认目标地址属于本 worktree**。本机多 worktree 并行时端口会被劫持（见 `AGENTS.md`），默认的 3002 很可能落在**另一个 worktree 的代码**上，此时测试结果不可采信。排查：`lsof -nP -iTCP:3002 -sTCP:LISTEN -t | xargs -I{} lsof -p {} | grep cwd`，cwd 必须指向本 worktree 的 `server/embed`。
- 对每个引擎实例各跑一遍，**都必须全绿**。
