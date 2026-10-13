# 语义检索（WeMM-2B 混合搜索与相似题）

> 实施计划：`docs/plans/2026-09-15-semantic-search.md`（含评测依据与决策记录）
> 效果评测：`tmp/wemm-eval/report.md`（91 道真实题目盲测，WeMM-2B vs 现有字面匹配）

## 功能概述

在现有题库 App 中加入三层语义检索能力，全部建立在同一个向量空间（WeMM-Embedding-2B 多模态模型）上：

| 入口 | 交互 | 查询方式 | 联网 |
|---|---|---|---|
| 文字语义搜 | 现有搜索框直接输入 | 字面命中照旧 + 列表下方「语义相关 (N)」区块 | 需要编码服务 |
| 以图搜题 | 搜索框旁图片按钮 → 拍照/相册 | 「图片匹配 (N)」区块 | 需要（上传压缩图） |
| 找相似题 | 题目详情弹窗内「🔍 找相似题」按钮 | 「相似题」弹层 top-6 | **不需要，纯本地** |

降级原则：编码服务不可用时语义区块整体不出现，UI 与改动前完全一致；以图搜题失败弹「图片匹配服务不可用」错误提示（复用全局 error-modal）。

## 架构

```
[客户端]                              [Express :3001]                    [FastAPI :3002 (Python)]
 搜索框/图片按钮/详情按钮
   │ POST /api/embed/text|image  ──►  转发(带auth+校验)  ──►  WeMM-2B 编码（懒加载+空闲卸载）
   │ ◄── 向量(2048维) ──────────────┘
   │ GET /api/embed/vectors?engineId=<id> ──►  base64 向量全量下发（89题≈720KB）
   │
 本地余弦排序（暴力扫，91题毫秒级）→ 渲染语义卡片（相似度百分比角标）
```

- 题图向量在服务端批量预计算（`build_index.py`），随 `/api/embed/vectors?engineId=<id>` 分发，客户端 `initApp` 时 fire-and-forget 拉取存 localForage（`embeddings` store）
- **库与引擎一一绑定、每个引擎一份库**：`question_embeddings` 以 `(engine_id, question_id)` 为复合主键，同一张表可共存多个引擎的向量；建库与下发都按 `engineId` 过滤，每个引擎只与它自己构建的库配对，切换引擎即切换向量库（阈值也按引擎分别校准）；其中 `legacy-default` 是迁移遗留的引擎名（旧数据归属，不对应任何真实编码引擎），不参与 `/api/embed/engines` 的引擎列表，只可经 `/api/embed/vectors?engineId=legacy-default` 显式取回
- query（文字/图片）每次现场编码——必须与题图同一模型才能落在同一向量空间
- 离线时：详情页找相似题照常可用（向量在本地）；文字/以图搜静默降级为字面匹配

## 关键文件

| 文件 | 职责 |
|---|---|
| `server/embed/embed_service.py` | FastAPI 编码服务：懒加载 + 15 分钟空闲卸载 watchdog（`WEMM_IDLE_UNLOAD_SECONDS` 可调，0=常驻）+ `_busy` 引用计数防卸载竞态 |
| `server/embed/build_index.py` | 建库脚本：默认 diff 只编新题（无新题不加载模型），`--force` 全量 |
| `server/embed/tests/` | pytest：health / encode-text(2048维+归一化) / encode-images / 422 校验 |
| `server/src/routes/embed.ts` | Express 转发（auth + 参数校验 + 45s/60s 超时）+ `/vectors` 下发 |
| `server/src/db/schema.ts` | `question_embeddings` 表（`(engine_id, question_id)` 复合主键, model, dim, vector BLOB） |
| `src/services/semantic.ts` | 纯函数：decodeVector / cosineSimilarity / mergeRankings |
| `src/services/semantic-search.ts` | encodeQuery / encodeImage / searchSemantic |
| `src/data/embeddings.ts` | dbEmbeddings store + refreshEmbeddings + getAllVectors |
| `src/ui/question-core.ts` | enhanceWithSemantic / handleImageSearch / renderSemanticResults（`_semanticToken` 竞态保护） |
| `src/ui/question-detail.ts` | showSimilarQuestions / closeSimilarModal |
| `src/init-app.ts` | initRemoteSync 接线 + refreshEmbeddings fire-and-forget |
| `tests/semantic-search.spec.js` | E2E 5 用例（全 mock：3 个 API 路由 + Camera.getPhoto 注入） |

## 运维命令

```bash
# 启动编码服务（默认懒加载，空闲 15 分钟自动卸载）
server/embed/start.sh                    # :3002

# 建库/增量更新向量（对 DB_PATH 指向的库，默认 diff；--engine-id 必填，库按引擎隔离）
cd server/embed && PYTHONPATH= ~/.workbuddy/binaries/python/envs/default/bin/python build_index.py /path/to/data.db --engine-id mac

# 校准该引擎的语义阈值（同样按 --engine-id 过滤，阈值按引擎分桶）
cd server/embed && PYTHONPATH= ~/.workbuddy/binaries/python/envs/default/bin/python calibrate_threshold.py /path/to/data.db --engine-id mac

# 测试
PYTHONPATH= .../pytest server/embed/tests -v          # Python 侧 4 用例
NODE_OPTIONS= npx vitest run unit-tests               # 客户端单元（361+）
NODE_OPTIONS= npx playwright test tests/semantic-search.spec.js \
  --reporter=list --output=tmp/test-results-semantic  # E2E 5 用例
```

## 实测数据（Apple M4 / 16GB，MPS）

- 模型加载 17.3s（懒加载，首次搜索/建库时发生）；文本 query 编码 117ms；图片 2.2-2.6s/张
- 89 题全量建库 227s；向量表 89 行 × 2048 维 ≈ 720KB
- 检索效果（14 条盲测，Recall@5）：L2 同义改述 0.80（现有 0.20）、L3 生活场景 0.93（现有 0.00）；L1 字面查询现有方案 0.81 仍最强 → 字面与语义互补，不替换

## 设计约束与已知边界

- `WEMM_IDLE_UNLOAD_SECONDS=900`（15 分钟空闲卸载）：空闲后首次搜索有约 17s 冷启动，前端有「语义分析中…/图片匹配中…」加载态；需要常驻可设 0
- 向量拉取以 serverUrl/apiToken 已配置为前提（未配置时 remoteCall 抛错被 fire-and-forget 吞掉，静默）
- 以图搜题的选图用 `w.Camera.getPhoto(source:'prompt')`，与"拍照加题"共用 Camera 插件但入口独立；Web 端无原生 Camera 时点击无效果（静默），E2E 通过注入 mock Camera 覆盖
- E2E 全 mock，不起真实编码服务；`window.refreshEmbeddings` 挂载供测试确定性触发

## 回归与验证记录（2026-09-15）

- Python pytest 4 passed；vitest 全量 361 passed | 9 skipped；typecheck 0 errors；vite build 成功
- Playwright 全量：见 `tmp/test-results-full-0915/`
- 生产库建库：副本演练 89/89 后执行，`questions` 表 123 行零改动
