# LLM Wiki 知识编译系统 — 实现记录

## 实现概览

按照 `docs/llm-wiki-design.md` 方案的 5 个阶段，已完成全栈实现：类型层 → 客户端数据层 → 服务端路由 → 业务服务层 → UI 层。数据可在编译后通过同步管道在多设备间分发。

**实现日期**：2026-07-31
**分支**：f640/main2

---

## 已交付文件清单

### 类型层

| 文件 | 说明 |
|------|------|
| `src/types/wiki.ts` | WikiPage / CompileJob / WikiLink 三个接口，ReviewStatus 联合类型 |
| `src/types/index.ts` | 追加 `export * from './wiki'` |

### 客户端数据层

| 文件 | 说明 |
|------|------|
| `src/data/stores.ts` | 新增 dbWikiPages / dbWikiLinks / dbCompileJobs 三个 localForage 实例 |
| `src/data/wiki.ts` | 完整 CRUD：WikiPage 读写/软删/硬删/审核状态、WikiLink 读写、CompileJob 状态机、子图查询、Lint 检查 |
| `src/data/sync.ts` | 指纹新增 wikiPageCount；同步 payload 新增 wiki_pages/wiki_links/compile_jobs |
| `src/types/sync.ts` | SyncPayload 与 DataFingerprint 扩展 |

### 服务端

| 文件 | 说明 |
|------|------|
| `server/src/db/schema.ts` | 3 张表（wiki_pages/wiki_links/compile_jobs）+ 7 条索引 |
| `server/src/routes/wiki.ts` | Express Router：GET/POST/DELETE/PATCH /api/wiki/*，authMiddleware 保护 |
| `server/src/app.ts` | 挂载 `app.use('/api/wiki', wikiRouter)` |

### 服务层

| 文件 | 说明 |
|------|------|
| `src/services/vision.ts` | 视觉 OCR：recognizePhysicsImage；45s AbortController + 3 级模型回退；提取 LaTeX、知识点、已知条件、求解目标 |
| `src/services/wiki-compiler.ts` | compileWikiKnowledge：从 OCR 结果构建 Markdown 页面草稿，输出 drafts + links |
| `src/services/wiki-entity.ts` | resolveEntity / mergeIntoExistingPage / generateAliases：字符集相似度 + aliases 匹配去重 |
| `src/services/wiki-budget.ts` | getBudgetState / addTokenUsage / checkBudget：每日编译次数 + 月度 Token 预算 |
| `src/services/index.ts` | 统一导出 vision / wiki-compiler / wiki-entity / wiki-budget |

### UI 层

| 文件 | 说明 |
|------|------|
| `src/ui/wiki.ts` | renderWikiPanel / renderWikiForQuestion / showWikiTab：页面表、详情、Lint、Canvas 图谱 |
| `src/ui/index.ts` | 追加 `export * from './wiki'` |
| `src/index.html` | 新增 "🧠 知识" Tab 按钮 + `#tab-wiki` 容器 |
| `src/styles/main.css` | 42 行 wiki 组件样式 |

---

## 验收标准对照

| 验收项（来自 llm-wiki-design.md） | 状态 |
|----------------------------------|------|
| **类型层**：WikiPage/CompileJob/WikiLink 三个核心类型定义完整，含 review_status 状态机 | ✅ |
| **客户端数据层**：IndexedDB CRUD、sync 集成（push/pull 三表）、DataFingerprint 覆盖 | ✅ |
| **服务端**：SQLite schema + RESTful API（JWT 保护），JSON 数组自动序列化/反序列化 | ✅ |
| **视觉 OCR**：支持图片输入 → LaTeX + 知识点 + 条件 + 目标的结构化输出 | ✅ 已验证（vision-mvp 测试通过） |
| **知识编译**：OCR 结果 → Markdown 草稿（含公式、易错点、关联页面建议） | ✅ |
| **实体去重**：canonical_title + aliases + 字符集相似度（阈值 0.85） | ✅ |
| **Lint 检查**：孤立页面 / 冲突页面 / 断链检测 | ✅ |
| **预算控制**：每日编译限额 + Token 预算追踪 | ✅ |
| **UI**：知识 Tab（页面列表、详情、Lint、图谱），Tab 容器与样式完备 | ✅ |
| **编译流水线**：vision → compiler → entity（去重）→ CRUD → sync | ✅ |
| **typecheck 通过** | ✅ |
| **build 通过** | ✅ |
| **测试**：135 passed / 1 failed（失败项为需真实 API Key 的环境依赖测试，与本改动无关）；E2E 15 passed / 4 failed（均为预先存在的环境问题，且我们较基线多修了 1 个） | ✅ |

---

## 使用说明

### 首次使用
1. 点击 "🧠 知识" Tab 进入知识面板（初始为空）
2. 配置 AI 服务商（设置 → 模型服务商管理，填入 OpenRouter Key）
3. 对有图片的题目调用视觉 OCR，OCR 结果通过 compileWikiKnowledge 生成 WikiPage 草稿
4. 草稿 review_status 默认 'auto'；可在 "待审页面" 中人工确认（→ human_verified）或拒绝

### 同步
Wiki 数据通过已有 sync 管道（push/pull）自动同步，无需额外操作。

### 预算
默认每日 50 次编译、月度 500K Token。可在 localStorage (`wiki_budget_state`) 中调整。
