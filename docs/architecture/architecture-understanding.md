# 本地题库 App 架构理解（当前状态）

> 由 Architecture Visualization 插件的 `system-modeler` + `c4model` + `graphviz` 工作流生成。
> 目的：以证据为基础回答「当前工作区系统是什么、由哪些部分组成、如何相互关联」。
> 受众：新加入的开发者、AI 智能体、架构评审者。

## 系统边界

工作区包含 4 个可独立运行/部署的软件系统：

| 系统 | 位置 | 技术栈 | 部署形态 |
| --- | --- | --- | --- |
| 本地题库 App（客户端） | `src/` + `public/` + `ios/` + `android/` | TypeScript / Vite / Capacitor 6 / localForage | iOS & Android 原生 App（WebView 内运行 Web 客户端） |
| 题库服务器 | `server/` | Express 5 / better-sqlite3 / JWT / multer | 本机或局域网服务器（默认端口 3001，`tsx` 直运） |
| 本地 OCR 服务 | `ocr-server/` | FastAPI / PaddleOCR / UniMERNet | 本机 Python 服务（默认 8000） |
| 备用服务器（可选） | 外部 | 同题库服务器 | Windows 服务器，服务器间周期同步 |

## 核心容器（L2）

**客户端（software system: 本地题库 App）**
- **Web 客户端**：`src/` 四层模块化（`data` 数据层 / `services` 服务层 / `ui` UI 层 / `types` 类型层），`main.ts` 将 600+ 函数挂载到 `window`，`public/app.js` 作为运行时 glue 读取调用。Vite 构建产物为 `dist/`。
- **原生外壳**：Capacitor 6，提供相机（`@capacitor/camera`）、文件系统（`@capacitor/filesystem`）、文件选择（`@hotend/capacitor-file-picker`）、分享/打开（`@capacitor-community/file-opener`）等能力。
- **本地 IndexedDB**：localForage 封装（`src/data/stores.ts`），存储题目、标签、试卷、版本、笔记、PDF 文档库、Wiki 页面与同步变更日志。本地优先，可完全离线使用。

**题库服务器**
- **API 服务**：Express 5，`/api/register|login|upload|questions|tags|papers|sync|version|recovery|pdfs|pdf-books|pdf-topics|wiki|health`，JWT 认证 + 限流 + multer 文件上传（10MB 上限）。
- **SQLite 数据库**：better-sqlite3（WAL），账号、题目、PDF 书库、Wiki 页面、同步数据。

**本地 OCR 服务**
- **OCR API**：FastAPI，`POST /ocr`（base64 图片 → 文字/公式 JSON）、`GET /health`。

## 关键关系（带证据与置信度）

| 关系 | 证据 | 置信度 |
| --- | --- | --- |
| Web 客户端 → 服务器：REST API | `src/ui/sync-ui.ts`（apiCall/apiHeaders）、`vite.config.ts` 开发代理 `/api` | high |
| Web 客户端 → 本地 IndexedDB | `src/data/stores.ts`、`src/data/*.ts` 全部基于 localForage | high |
| Web 客户端 → OpenRouter：流式 LLM | `src/services/ai.ts`（callCloudAIStream）、`src/services/vision.ts` | high |
| Web 客户端 → 本地 OCR 服务 | `src/services/local-ocr.ts`（base64 POST /ocr）、`ocr-server/main.py` | high |
| Web 客户端 → 百度网盘备份 | `src/ui/baidu-netdisk.ts`（OAuth 授权后上传） | high |
| 服务器 → SQLite | `server/src/db/connection.ts`、`server/src/routes/*.ts` | high |
| 服务器 → Supabase（可选） | `server/src/index.ts`（initSupabase，仅配置存在时启用）、`server/src/services/replicate.ts` | medium（配置驱动，默认不启用） |
| 服务器 ↔ 备用服务器 | `server/src/services/server-sync.ts`（initServerSync/startPeriodicSync 按配置启用） | medium（存在配置与代码，实际拓扑未验证） |
| 客户端 → Supabase（可选） | `src/ui/sync-ui.ts`（silentSupabaseSync） | medium |
| 端侧 AI（Gemma4）/ 悬浮窗 / 快捷拍摄 | iOS 首版不支持，Web 层隐藏入口并提示 | high（见 AGENTS.md 适配清单） |

## 视图工件

| 视图 | 文件 | 打开方式 |
| --- | --- | --- |
| C4 系统上下文 + 容器 | `docs/architecture/system-context.structurizr.dsl` | Qoder DSL 查看器 / Structurizr 兼容工具 |
| 客户端四层模块依赖图 | `docs/architecture/client-layers.dot` | Qoder DOT 查看器 / Graphviz |
| 同步业务流 | `docs/architecture/sync-flow.mmd` | Qoder Mermaid 查看器 / Markdown |

## 假设与未知项

- 备用服务器（Windows）的实际部署拓扑、网络可达性未验证，图中标注 `inferred`。
- Supabase 通道默认关闭（无配置时跳过初始化），其启用场景（账号级云同步）以 `.env` 配置为准。
- 端侧 AI（Gemma4 插件）在 iOS 上不可用，为平台降级设计而非缺陷。
- `public/app.js` 与 `src/main.ts` 通过 `window` 全局契约耦合（`assignToWindow`/`assignIfMissing`），是当前客户端最关键的非显式接口，重构或新增函数时必须保持两侧同步（见 AGENTS.md 与 `docs/ui-migration-bright-friendly.md`）。

## 阅读顺序

1. 先看 `system-context.structurizr.dsl` 的系统上下文视图：理解教师 → App → 服务器/OCR/外部依赖的整体边界。
2. 再看容器视图：理解客户端三容器与服务端两容器的技术选型。
3. 需要改客户端时看 `client-layers.dot`：四层依赖与 window 桥接边界。
4. 涉及同步问题时看 `sync-flow.mmd`：主流程、失败路径与备用服务器切换。
