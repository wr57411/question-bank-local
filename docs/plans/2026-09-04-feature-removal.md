# 功能移除计划（v2：移除，非搁置）

日期：2026-09-04
分支：`f640/main2` @ 02eafc2（14 个提交已于当日推送 origin）
状态：**已执行完成**（2026-09-04，含边界变更：相似题随后追加为移除项；4 个提交待推送）
取代：`docs/plans/2026-09-04-shelved-features-archive.md`（v1 搁置方案，已由王先生否决）

## 执行结果（2026-09-04）

| 项 | 结果 |
|---|---|
| 提交 | 033e196（ocr-server）/ a7981ba（Phase1 服务端）/ fb360c6（Phase2+3 客户端）/ 7271a2f（Phase4 测试），共 -8700+ 行 |
| typecheck | 客户端 0 错误；服务端 0 新增错误（存量 AuthRequest/PORT/isIncomingNewer 不在本次范围） |
| 单测 | 279/279 通过 |
| build | 通过，主 bundle 280.91 kB（gzip 84.96 kB） |
| E2E | 71/71 通过（修掉 13 个引用已删 UI 的死断言） |
| 截图评估 | 390×844 实机视口截图确认：4 Tab 正常、无残留入口、端侧 AI 完好；Tab 溢出为设计内横向滚动（溢出量由 ~650px 降至 18px） |
| 分支 | 已删 6 个（f640/mail-fq、codex/localbank、lake-weather、worktree-agent-* ×3）；prune 清理 2 个死 worktree 记录 |

## 执行中的边界变更与修正

1. **相似题由保留改为移除**（王先生 2026-09-04 追加指令）：similar-links.ts、question-detail 相似题模块群、服务端 similar 同步全部摘除；备份文件保留全部历史数据（数据资产原则）
2. **计划笔误修正**：pending_link_list 是待处理队列的服务端通道，随待处理移除（users 表列保留）
3. **dbClearAllData 摘除 topics/similar 的 clear**：同步下行不再回填这些 store，若保留 clear 会导致重建时丢遗留数据（零丢失原则）
4. **Phase 1 并行 Edit 丢失更新事故**：同文件并行 Edit 导致 sync.ts 解构行、server-sync PullResponse、sync-upsert upsertNodeQuestion 未生效且无编译错误；已在 Phase 2+3 阶段系统性复查修复。教训：同文件多 Edit 必须串行 + 逐行 diff review

## 决策记录（原计划内容）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 处置语义 | **移除**（删代码），非搁置、非隐藏入口 |
| 2 | 端侧 AI（Gemma4/LlamaBridge/llama.cpp/ai.ts/ai-model-ui.ts） | **全部保留**（不在移除列表，与 AI教学零耦合） |
| 3 | 待处理范围 | **pending-link + pending-blank 都删** |
| 4 | 相似题关联（similar-links.ts / similar_question_links） | **保留**（不在移除列表，题目详情相似题模块保留） |
| 5 | 服务端 SQL 表 | **全部保留，不 DROP**，只删客户端代码 + 服务端路由/同步分支 |
| 6 | 服务端表数据 | 保留（零数据丢失硬规则） |
| 7 | 在途未提交改动 | 王先生已自行提交（bf7430e / 02eafc2） |
| 8 | 待删本地分支 | `f640/mail-fq`、`codex/localbank`、`lake-weather`、`worktree-agent-*` ×3 |
| 9 | codex/localbank 的 2 个独有提交 | 放弃 |

## 一、移除功能清单（8 项）

| 功能 | 中文入口 | 客户端 | 服务端 | 原生 |
|---|---|---|---|---|
| 1. AI教学 | teaching-tab、teaching-verify-modal | teaching.ts ×1、teaching-*.ts ×3 UI、types/teaching.ts | sync 分支 | 无 |
| 2. 书库 | pdf-library-tab | pdf-docs/pdf-cloud/8 个 pdf UI、types/pdf-doc.ts | routes/pdf-books.ts、pdf-topics.ts、pdfs.ts | 无 |
| 3. Wiki | wiki-tab | wiki.ts+wiki-mvp.ts+6 个 wiki-* services+2 UI+2 types | routes/wiki.ts | 无 |
| 4. 悬浮窗 | floating-toggle-btn | floating-window.ts | 无 | 无（当前 HEAD 无原生插件，已残缺） |
| 5. 待处理-pending-link | pending-link-tab、detail-pending-link-btn | pending-link.ts | sync 分支（similar 部分保留） | 无 |
| 6. 待处理-pending-blank | pending-blank-tab | blank-question.ts | 无 | 无 |
| 7. 待补拍 | pending-photos-tab | pending-photos.ts、pending-photos-ui.ts | sync 分支 | 无 |
| 8. 专题 | topics-tab | topics.ts、topic-manage.ts、types/topic.ts | sync 分支 | 无 |

> node_questions 表经查证**归属 AI教学**（schema.ts L164-172 外键 node_id → teaching_nodes），随 AI教学删客户端与同步分支，表保留。

## 二、保留项（防误伤清单，一律不动）

- PDF **导出**功能：`src/data/pdf.ts`、`pdf-layout-engine.ts`、`pdf-font.ts`、`pdf-image.ts`、`src/ui/export-pdf-ui.ts`、`unit-tests/pdf-*.spec.js`（名字含 pdf 但属导出）
- 相似题：`src/data/similar-links.ts`、`src/ui/question-detail.ts` 内 `renderSimilarQuestions`/`buildSimilarCandidates`/`confirmSimilarLinks`（L137/217/417，定义于 question-detail 自身）、`similar_question_links` 表与同步
- 端侧 AI：Gemma4Plugin.java、LlamaBridge.java、llama.cpp、`src/services/ai.ts`、`src/ui/ai-model-ui.ts`、ai-pipeline-e2e 的 AI 用例段
- 服务端全部 SQL 表结构与数据（pdf_* 6 张、teaching_*、node_questions、topics、topic_questions、wiki_pages、wiki_links、similar_question_links、pending_photos 若存在）

## 三、删除文件清单（源文件，git rm）

```
src/data/teaching.ts  src/data/topics.ts  src/data/pending-photos.ts
src/data/pdf-docs.ts  src/data/wiki.ts    src/data/wiki-mvp.ts
src/types/teaching.ts src/types/topic.ts  src/types/pdf-doc.ts
src/types/wiki.ts     src/types/wiki-mvp.ts
src/services/pdf-cloud.ts  src/services/wiki-compiler.ts  src/services/wiki-entity.ts
src/services/wiki-schema.ts src/services/wiki-budget.ts   src/services/wiki-diagnostic.ts
src/services/wiki-mvp.ts
src/ui/teaching-queue.ts  src/ui/teaching-ui.ts  src/ui/teaching-verify.ts
src/ui/topic-manage.ts    src/ui/pdf-category.ts src/ui/pdf-doc-ops.ts
src/ui/pdf-preview.ts     src/ui/pdf-render.ts   src/ui/pdf-topic.ts
src/ui/pdf-tree-state.ts  src/ui/floating-window.ts
src/ui/pending-link.ts    src/ui/blank-question.ts  src/ui/pending-photos-ui.ts
server/src/routes/pdf-books.ts  server/src/routes/pdf-topics.ts
server/src/routes/pdfs.ts       server/src/routes/wiki.ts
tests/vision-mvp/（整目录，测 wiki-mvp）
```

## 四、接线文件修改清单（关键，删引用才编译得过）

### 4.1 各层 index.ts 摘除行（行号以实施时为准）
- `src/data/index.ts`：摘 `./topics`、`./teaching`、`./pdf-docs`、`./wiki`、`./wiki-mvp`、`./pending-photos`；**保留 `./similar-links`、`./pdf`**
- `src/types/index.ts`：摘 `./topic`、`./teaching`、`./pdf-doc`、`./wiki`、`./wiki-mvp`；**保留 `./pdf`**
- `src/services/index.ts`：摘 `./pdf-cloud`、wiki-* 6 行；**保留 quick-fav-tags 等**
- `src/ui/index.ts`：摘 `pdf-render/pdf-category/pdf-doc-ops/pdf-preview/pdf-topic`、`wiki`、`wiki-mvp`、`topic-manage`、`teaching-ui/queue/verify`、`pending-link`、`blank-question`、`floating-window`、`pending-photos-ui`；pdf-tree-state 不入 barrel 无需摘

### 4.2 src/main.ts window 导出（约 13 个 Batch 块）
摘除（含各块首行注释）：teaching 数据块、topic 数据块、topic UI 块（Batch 4 topic-manage，含 exportTopicPDF/exportTopicPDFForId；**export-pdf-ui 块保留**）、teaching UI 块、书库块（L166-190）、wiki 块（L191-221，含 wikiFlushPendingJobs）、wiki-mvp 块（L222-242）、pdf-cloud 块（L243-248，**pdf-data 块 L249-260 中导出功能保留**）、pending-link 批、blank-question 批、floating-window 批、pending-photos-ui 批、dbGetPendingPhotos（保留 dbGetAllSimilarLinks/dbAddSimilarQuestionLinks）。
另：L692 `ui.wikiFlushPendingJobs?.()`（online 监听）、L667 `ui.initFloatingPoll()`、L551-552/L626 floating 轮询、L659 importPendingPhotos 别名。

### 4.3 src/index.html
摘 UI 入口与面板：L91 floating-toggle-btn、L98 topics-tab、L103 teaching-tab、L104 pdf-library-tab、L105 wiki-tab、L100-102 pending 三 tab、L421-433 topics 面板、L462-466 pending-link 面板、L471-475 pending-photos 面板、L480-542 teaching 面板、L553-584 书库 4 面板、L587-597 teaching-verify-modal、L865 topic-detail-modal、L949-999 pending modals、L1288-1307 floating modals、L697/767 详情页待处理按钮。
> **注意**：删除 tab 按钮后检查 tab 切换逻辑（是否有 tab 数组/索引写死），避免留空 tab 或错位。

### 4.4 连带修改（保留模块里的引用，逐个摘）
- `src/init-app.ts` L58-59：refreshAll 后 updatePendingLinkBadge/updatePendingPhotosBadge 调用 → 摘（并查这两个 badge 函数定义处）
- `src/ui/platform.ts` L10-12：web 隐藏 floating-toggle-btn / pending-blank-tab / pending-photos-tab → 摘（确认无其余保留 tab 依赖此行逻辑）
- `src/data/backup.ts` L143-170：备份恢复处理 pending_photos（删）+ similar_question_links（**保留**）→ 只摘 pending_photos 分支
- `src/ui/question-detail.ts`（**高风险精细手术区**）：L19 import 自 pending-link；L66/L137-192/L217-424 混合 pending 与 similar 逻辑。原则：摘 `getPendingLinkList/isPendingLink/removeFromPendingLink/loadPendingLinkCandidates/togglePendingLinkInDetail/updatePendingLinkBtnStyle`（候选队列，来自 pending-link 或为其服务）；**保留** `renderSimilarQuestions/buildSimilarCandidates/confirmSimilarLinks`（已确认关联展示）。实施时逐行核对每个函数体用到的数据源，宁可多留一次 review 也别误删

### 4.5 服务端同步分支摘除（最细活，表保留）
- `server/src/routes/sync.ts`：L24 解构、L41-54（topics/teaching 三表/node_questions upsert）、L148-166（拉取）、L206 响应字段；**similar/pending_link_list 相关 L133-146 保留**（相似题）→ 摘 teaching/topics/pdf_* 键，留 similar
- `server/src/services/sync-upsert.ts`：L142-150（upsertTopic/topic_questions）、L168-178（teaching 两表）、L313-315（node_questions）、AppliedResult 类型 L15/19/28 → 摘；upsertSimilarLink L293-309 保留
- `server/src/services/server-sync.ts`：L166-169、L184-205、类型 L87/91/282/287/292 → 摘
- `server/src/services/replicate.ts` L96-101、`server/src/routes/questions.ts` L67（删题清理 similar，**保留**；确认不含待删表清理）
- `server/src/app.ts` L18-21 import、L95-98 mount 四路由 → 摘
> 依据 2026-09-03 同步审查：teaching_*/pdf_* 同步本就"推得出去拉不回来"（apply 忽略 9 类 key），摘除属顺水推舟，风险低。实施时跑 sync 单测兜底。

## 五、测试文件处理

| 文件 | 处理 |
|---|---|
| `tests/ui-health.spec.js` | 摘 L24/26/40 的 floating/pending tab 断言、L71-322 topic 段、L327 floating |
| `tests/modal-anchor-overlap.spec.js` | 摘 L105-111（pdf-preview-modal）、L163（teaching-verify / pending modals） |
| `tests/ai-pipeline-e2e.spec.js` | **保留文件**，仅摘 teaching/node_questions 用例段 L83-249，AI 用例保留 |
| `unit-tests/sync-integrity.fq.spec.js` | 摘 teachingNodes L20-93（topic/teaching 段） |
| `tests/fixtures/question-bank-seed.json` | 摘 similar_question_links 中的 **pending 队列数据**（确认哪些是待确认、哪些已确认；已确认关联保留）→ 此点实施时细看 |
| `unit-tests/pdf-*.spec.js` | **保留**（测导出） |
| `tests/quick-import-fav-tags.spec.js` 等 4 个未跟踪 spec | 见 P0，随补提交入库 |

## 六、执行顺序与验证（每步跑 `npm run typecheck`）

- **P0 前置**：补提交 7 个未跟踪文件（修复 bf7430e 坏引用），验证 typecheck 通过 → 基线完整
- Phase 1：服务端（4.5）→ typecheck + sync 单测
- Phase 2：删源文件 + 各 index.ts 摘除（四、4.1）→ typecheck（会报 main.ts 断引用，预期）
- Phase 3：main.ts / index.html / init-app / platform / backup / question-detail 接线（4.2-4.4）→ typecheck 绿
- Phase 4：测试文件更新（五）→ `npm run test`
- Phase 5：`npm run build`
- Phase 6：E2E 全量（`NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-feature-removal`）；**UI 改动过截图 + assertVisiblyRendered 评估**（AGENTS.md 强制）
- Phase 7：ship 打包验证（如需）
- Phase 8：删除 6 个本地分支（用户已确认放弃；`git branch -D` + `git worktree prune`）

## 七、风险与回退

1. **question-detail.ts 相似题/待处理边界**（最高风险）：误删会把保留的相似题打残。回退：改动前先单独 commit 该文件或 `git diff` 备份
2. **tab 切换错位**：index.html 删 tab 后若 tab 数组写死，后续 tab 会错位。回退：全量 E2E 抓
3. **ai-pipeline-e2e 拆分误删 AI 用例**：改前先确认用例标题归属
4. **整体回退**：每个 Phase 独立 commit（Phase 间不挤压），出问题 `git revert` 单个 Phase
5. 全程不动表结构/数据、不动 capacitor.config.ts、不动 AndroidManifest（已确认无待删功能残留声明）

## 八、待确认项

1. P0 补提交是否由我执行（git add + commit 7 个文件）？
2. Phase 8 分支删除在功能移除完成后统一做，还是现在先删？（建议：代码合并后统一，避免误删仍在用的历史引用）
3. 每次 Phase 后是否需要逐段汇报，还是全部完成后一次性验证汇报？
