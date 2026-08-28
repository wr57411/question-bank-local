# 本地 OCR 服务 + 免费纯文本 LLM 备选方案

## 背景与目标

视觉模型（qwen-2.5-vl 等免费档）生成的"高考难点"质量不达预期。本方案搭建**本地 OCR 服务**作为备选提取路径：题目图片先在本地完成文字与公式识别（PaddleOCR + UniMERNet），再交给**免费纯文本 LLM** 生成知识，规避免费视觉模型的多模态能力瓶颈。

**已确认决策**：PaddleOCR（PP-OCRv5 中文）+ UniMERNet（公式→LaTeX）组合；独立 Python FastAPI 服务（localhost:8766，8765 已被本机其它服务占用），与 Express 完全解耦。

## 影响模块

| 文件 | 类型 | 说明 |
|------|------|------|
| `ocr-server/main.py` | 新增 | FastAPI：`GET /health`（引擎状态秒回）+ `POST /ocr`（base64 JSON）；CORS `*` |
| `ocr-server/ocr_core.py` | 新增 | 懒加载 PaddleOCR + UniMERNet；公式启发式检测；阅读顺序混合 text/formulas/markdown |
| `ocr-server/requirements.txt` / `start.sh` / `README.md` | 新增 | Python 3.12 venv + 安装 + uvicorn 启动 |
| `src/types/local-ocr.ts` | 新增 | OcrResult / OcrHealth / WikiExtractMode |
| `src/services/local-ocr.ts` | 新增 | OCR 地址配置（localStorage `ocr_server_url`）+ 健康检查 + 逐图串行识别（压缩 2000px/0.85，首载 120s/常规 45s 超时） |
| `src/services/wiki-mvp.ts` | 修改 | `extractKnowledgeFromQuestions` options 加 `mode`/`ocrBaseUrl`；新增 `WIKI_MVP_OCR_MODELS` 免费文本模型 + `buildOcrUserContent` |
| `src/ui/wiki-mvp.ts` | 修改 | 步骤②新增模式切换（视觉模型 / 本地OCR+纯文本LLM）+ OCR 地址 + 测试连接 |
| `src/main.ts` | 修改 | 挂载 3 个新函数（wikiMvpChangeMode / wikiMvpSyncOcrInput / wikiMvpTestOcrConnection） |
| `.gitignore` | 修改 | Python 依赖忽略 |

**不涉及**：`src/data/wiki-mvp.ts`、`src/index.html`、`server/`（Express）、旧 wiki 代码、视觉模型路径（mode 默认 vision 时逐行不变）。

## 关键设计

### 调用链

```
选中题目 → mode='ocr' 时:
  有图题: compressImage(2000px,0.85) → 逐图 POST http://localhost:8766/ocr → 中文文本+$$LaTeX$$
  无图题: semantic_summary/user_comment 兜底
→ buildOcrUserContent（题目元信息 + OCR 内容按题组装，图片不再外发）
→ OpenRouter 免费纯文本模型（openrouter/free 优先，fallback 链）
→ 卡帕西 JSON → 复用现有概念卡片 UI 与历史记录
```

- 配置持久化：`wiki_mvp_mode`（'vision'|'ocr'）+ `ocr_server_url`（默认 http://localhost:8766），对齐 `serverUrl`/`atomize_mode` 惯例
- 向后兼容：不配置 OCR 地址 / mode 非 ocr 时，行为与之前完全一致
- 失败策略：OCR 全部失败抛结构化错误（含题号），提示手动切回视觉模型；部分失败降级（失败题在文本中标注）

### OCR 引擎

- PaddleOCR PP-OCRv5（`lang="ch"`）识别中文题干；UniMERNet 将疑似公式区域（含 `=`/数学符号 ≥2 的文本框启发式）裁剪后转 LaTeX
- 懒加载 + 线程锁：首次 `/ocr` 触发加载（10~30s），`/health` 返回 `not_loaded|loading|ready|error` 状态机
- 容错：UniMERNet 缺失/失败时自动降级为纯文字 OCR（`engines.unimer=false`）
- Python 版本：**必须 3.12**（paddlepaddle 不支持 3.13+；本机默认 3.14.5，start.sh 强制 python3.12）
- 安装注意：pip 使用阿里云镜像时缺 `poetry-core`（UniMERNet 构建依赖），start.sh 已从官方源预装 poetry-core 并以 `--no-build-isolation` 安装

## 验证

- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run test`：real-api.spec.js 为既有外部 API 依赖测试（不阻塞）
- `npx playwright test tests/ui-health.spec.js`（阶段 D 门禁）
- Python 侧：`curl /health` + 一次真实图片 `POST /ocr` 冒烟

## 已知边界（MVP）

- 公式区域检测采用文本框启发式（含 `=` 或数学符号），复杂版面（公式与文字混排密集）可能漏检或误检
- 纯文本 LLM 只能基于 OCR 文本，题目中的几何图/示意图信息会丢失（后续可考虑图描述或换更强 OCR）
- iOS 真机访问局域网 OCR 服务受 ATS 明文 HTTP 限制（桌面端优先，Android 已放行）
- 免费文本模型（openrouter/free）有每日限额，UI 支持自定义模型
