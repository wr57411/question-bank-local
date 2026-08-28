# 修复 LLM Wiki 知识编译流水线

## 问题摘要

LLM Wiki 模块设计文档（`docs/llm-wiki-design.md`）描述了完整的四步编译流水线，但实现与设计严重脱节：UI 层"从题目编译"入口根本未调用任何编译服务，只产出标题为"题目 xxxxxxxx"的空壳页；视觉识别、知识编译、实体去重、预算控制、离线队列、关系持久化等能力全是挂在 window 上的死代码。本次修复 12 项缺陷，使"从题目编译出结构化知识点"真正可用。

## 变更日期

2026-07-31

## 关联模块

客户端服务层、客户端数据层、客户端 UI 层、服务端路由

## 修复清单

### 1. 重写编译流水线 UI 入口（致命）

`src/ui/wiki.ts` 的 `runCompileFromQuestions` 原先只创建标题为"题目 xxxxxxxx"、content 为"此页面待 AI 编译补充"的空壳页。重写为真正串通四步流水线：

题目图片 → `recognizePhysicsImage`（vision OCR）→ `visionResultToCompileInput` 适配 → `compileWikiKnowledge` 生成草稿+关系 → 逐 draft `wikiSmartUpsertPage`（实体对齐+入库）→ 据 title→pageId 映射生成真实 `WikiLink` 并 `wikiPutLink` → `addTokenUsage` 回传 token → `wikiMarkJobCompleted` + `wikiLogAppend`。

无图题目回退用 `semantic_summary` 文本编译。新增 `wikiFlushPendingJobs` 处理离线入队任务。

### 2. 统一 vision/compiler 接口

`src/services/wiki-compiler.ts` 新增 `visionResultToCompileInput(vr, ctx)` 适配函数，消除 `VisionResult`（`raw_text/latex_formulas/key_concepts/given_conditions/solve_target`）与 `CompileInput`（`text/formulas/concepts/conditions/target`）字段名割裂。vision/compiler 的 fetch 响应均读 `data.usage.total_tokens` 并回传。

### 3. links 持久化

`inferLinks` 改为返回草稿索引对 `Array<[number, number, relation]>`，编译入口据 drafts 的 `canonical_title → pageId` 映射生成真实 `WikiLink`（ID 关联）并 `wikiPutLink`，解决"links 永远不写库、关系图永远空"。

### 4. 离线队列落地

编译入口检测 `navigator.onLine`，离线时 `wikiCreatePendingJob` 入队；`src/main.ts` 注册 `online` 事件触发 `wikiFlushPendingJobs` 重新处理 pending 任务。`CompileJob` 状态机（`wikiCreatePendingJob/wikiMarkJobCompleted/wikiMarkJobFailed`）真正被调用。

### 5. 预算控制落地

三个编译入口前置 `checkBudget()` 阻断，编译后 `addTokenUsage(visionUsage + compilerUsage)` 记录真实 token。`getBudgetStatusText` 从此显示真实数。

### 6. 实体对齐升级

`src/services/wiki-entity.ts`：`simpleSimilarity` 阈值 0.85→0.9 仅作初筛；新增 `llmConfirmSameConcept` 二次判定（复用现有 `getCurrentProvider` 通道，单轮"是否同一概念"判定，不引 Embedding SDK）；`resolveEntity` 接受可选 `pages` 内存索引避免每题全表 iterate；移除 `generateAliases` 硬编码三特例（改由 compiler LLM 直接输出 aliases）。

### 7. 图谱读真实边

`src/ui/wiki.ts` 的 `drawSimpleGraph` 原用 `Math.random()` 画边。改为 `drawGraph`，读 `wikiGetLinks()` 真实边，节点按关联题数排序取前 30，边过滤两端都在节点集。

### 8. JSON 解析容错

`parseCompileResponse` catch 块改为 `console.warn` + 返回 `{ error: e.message }`，UI 收 error 时提示；`max_tokens` 1500→3000 避免五段 JSON 截断；`extractSnippet` 对 fallacy 用 misconception 全文模糊匹配（含分词回退），不再恒退化为前 100 字。

### 9. 服务端 CRDT 合并

`server/src/routes/wiki.ts` 的 `POST /pages` 由 `INSERT OR REPLACE` 直接覆盖改为：先 SELECT 已有行，存在则合并（`source_ids/source_snippets/aliases/related_page_ids` 取并集；`content/summary` 冲突时 version 高者胜，version 相等则标 `needs_merge` 并保留更详细者）；`POST /links` 加幂等去重（同 source/target/relation 跳过）。

### 10. 诊断精确匹配

`src/services/wiki-diagnostic.ts` 的 `runDiagnostic` 弃用裸 `includes` 子串匹配，改用标准化精确相等 + `simpleSimilarity >= 0.95` 高阈值，避免"机械能守恒"误匹配"机械能守恒定律"。

### 11. 移除标签空壳版

`src/ui/wiki.ts` 移除"从标签生成"非 AI 版（只复制标签名为空壳页），仅保留 AI 分析标签生成版。

### 12. window 挂载补全

`src/main.ts` 补挂载 `wikiFlushPendingJobs/wikiPutLink/wikiCreatePendingJob/wikiMarkJobCompleted/wikiMarkJobFailed/wikiGetPendingJobs/wikiGetLinks/wikiGetAllPages/wikiGetPage/wikiLint/wikiLogAppend` 及 `db` 前缀别名，使 `renderWikiPanel` 的 `w.dbWikiGetAllPages` 等调用生效（此前 pages 永远空）。

## 变更文件

| 文件 | 变更 |
|------|------|
| `src/services/wiki-compiler.ts` | 重写：统一接口、max_tokens 3000、容错回传 error、inferLinks 返回索引对、extractSnippet 修复 fallacy、回传 usage、新增 visionResultToCompileInput |
| `src/services/vision.ts` | VisionResult 加 usage、callVisionAPI 透传 token |
| `src/services/wiki-entity.ts` | 阈值 0.9、新增 llmConfirmSameConcept、resolveEntity 加 pages 参数、导出 simpleSimilarity、清空 generateAliases 硬编码 |
| `src/services/wiki-diagnostic.ts` | runDiagnostic 改标准化精确匹配 + 高阈值相似度 |
| `src/data/wiki.ts` | wikiSmartUpsertPage 加 pages 参数、新建页 push 到内存索引 |
| `src/ui/wiki.ts` | 重写 runCompileFromQuestions 串通流水线、新增辅助函数与 wikiFlushPendingJobs、图谱读真实边、移除标签空壳版、renderWikiIndex/Log 改类型化调用 |
| `src/main.ts` | 补挂载 wiki 函数、注册 online 事件 flush |
| `server/src/routes/wiki.ts` | POST /pages CRDT 合并、POST /links 幂等去重 |

## 验证结果

| 验证项 | 结果 |
|--------|------|
| `npm run typecheck` | ✅ 通过（无错误） |
| `npm test`（vitest） | ✅ 132 passed / 1 failed（real-api.spec.js，需真实 API Key，环境依赖，与本改动无关）/ 4 skipped |
| `npm run build` | ✅ 通过（250ms，仅 2 条无害的动态 import 优化提示，其中 wiki-entity 动态 import wikiPutPage 系为规避 data↔services 循环依赖） |
| `npx playwright test tests/ui-health.spec.js` | ✅ 16 passed / 3 failed（均为预先存在的通用 UI 问题：题目管理按钮可见性、Tab 切换回归、pending-photos-tab，与 wiki 模块无关；基线为 4 failed，本次未恶化） |

## 使用说明

1. 在设置中配置 AI 服务商（OpenRouter Key）
2. 进入"🧠 知识"Tab → "⚡ 编译题目"
3. 勾选题目 → "开始编译"：有图走视觉 OCR + 知识编译，无图走语义摘要文本编译
4. 编译产出真实的概念/方法/模型/误区页面（含公式、适用条件、易错点、来源片段），并自动建立页面间关系
5. 预算超限自动阻断；离线自动入队，联网后自动 flush
6. 多设备同步同一概念页时，source_ids 自动并集合并，content 冲突标 needs_merge 待人工确认

## 不涉及边界

- 不引入新依赖（Embedding/d3-force 用 LLM 二次判定 + 现有 Canvas 替代）
- 不改服务端表结构（仅改 POST /pages、POST /links 逻辑）
- 不修预先存在的通用 UI 健康问题（pending-photos-tab 等，超出 wiki 修复范围）
