# 架构证据索引（architecture model evidence）

> 配套 `system-context.structurizr.dsl` 与 `client-layers.dot` 使用。
> 置信度定义：high = 代码/配置/契约直接证实；medium = 多个间接信号一致；low = 推断；unknown = 待验证。

## 节点

| ID | 类型 | 状态 | 证据（sourceRefs） | 置信度 |
| --- | --- | --- | --- | --- |
| teacher | actor | current | `src/index.html`（登录/使用入口）、产品定位（README） | high |
| app.web | container | current | `src/main.ts`、`src/ui/index.ts`、`package.json`（vite/localforage） | high |
| app.shell | container | current | `capacitor.config.ts`、`package.json`（@capacitor/*）、`ios/`、`android/` | high |
| app.localdb | container | current | `src/data/stores.ts`、`src/data/*.ts` | high |
| server.api | container | current | `server/src/app.ts`（路由挂载）、`server/src/middleware/auth.ts` | high |
| server.sqlite | container | current | `server/src/db/connection.ts`、`server/src/db/schema.ts` | high |
| ocr.ocrApi | container | current | `ocr-server/main.py`（FastAPI /ocr /health） | high |
| openrouter | external-system | current | `src/services/ai.ts`、`src/services/vision.ts` | high |
| supabase | external-system | current | `server/src/index.ts`（initSupabase）、`src/ui/sync-ui.ts`（silentSupabaseSync） | medium |
| baidu | external-system | current | `src/ui/baidu-netdisk.ts` | high |
| backupServer | external-system | current | `server/src/services/server-sync.ts`、`docs/windows-backup-server.md` | medium |
| data.stores | module | current | `src/data/stores.ts` | high |
| services.ai | module | current | `src/services/ai.ts`（callCloudAIStream 流式） | high |
| services.vision | module | current | `src/services/vision.ts`（多模态） | high |
| services.local-ocr | module | current | `src/services/local-ocr.ts` | high |
| services.pdf-cloud | module | current | `src/services/pdf-cloud.ts`（uploadPdfToServer 等） | high |
| services.wiki-compiler | module | current | `src/services/wiki-compiler.ts` | high |
| ui.sync | module | current | `src/ui/sync-ui.ts`（apiCall/runSync/fullSyncToCloud） | high |

## 边

| ID | from → to | 类型 | 同步/协议 | 证据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| edge.web-server | app.web → server.api | calls | sync / HTTPS | `src/ui/sync-ui.ts` apiCall、`vite.config.ts` proxy `/api` | high |
| edge.web-localdb | app.web → app.localdb | reads/writes | sync / in-process | `src/data/stores.ts` | high |
| edge.web-ocr | app.web → ocr.ocrApi | calls | sync / HTTP | `src/services/local-ocr.ts`、`ocr-server/main.py` | high |
| edge.web-openrouter | app.web → openrouter | calls | sync/stream / HTTPS | `src/services/ai.ts` callCloudAIStream | high |
| edge.web-baidu | app.web → baidu | publishes | batch / HTTPS | `src/ui/baidu-netdisk.ts` | high |
| edge.server-sqlite | server.api → server.sqlite | reads/writes | sync / SQL | `server/src/db/connection.ts`、`server/src/routes/sync.ts` | high |
| edge.server-supabase | server.api → supabase | publishes | batch / HTTPS | `server/src/index.ts` initSupabase（配置驱动） | medium |
| edge.server-backup | server.api ↔ backupServer | calls | batch / HTTP | `server/src/services/server-sync.ts` startPeriodicSync | medium |
| edge.web-supabase | app.web → supabase | calls | batch / HTTPS | `src/ui/sync-ui.ts` silentSupabaseSync | medium |
| edge.ui-services | ui.* → services.* | depends-on | sync / in-process | `src/ui/*.ts` 静态导入（如 sync-ui → ai/pdf-cloud） | high |
| edge.services-data | services.* → data.* | depends-on | sync / in-process | 各 services 文件静态导入 | high |
| edge.data-localforage | data.stores → localforage | reads/writes | sync / in-process | `src/data/stores.ts` | high |
| edge.main-window | main.ts → window 挂载 | depends-on | sync / in-process | `src/main.ts` assignToWindow/assignIfMissing（600+ 函数） | high |
| edge.appjs-main | app.js → window 函数 | depends-on | sync / in-process | `public/app.js` 运行时读取 window | high |

## 验证任务（unknown / 待办）

1. 备用服务器 ↔ 主服务器的实际网络拓扑与部署形态未验证（docs/windows-backup-server.md 描述 vs 实际环境）。
2. Supabase 通道的启用条件与数据流（`.env` 配置项）未在本次分析中追踪。
3. 客户端 42 个 ui 文件与 window 全局契约的完整覆盖清单（600+ 函数）建议用脚本比对 `src/main.ts` 与 `public/app.js`，作为后续 living-architecture 检查项。
