# 旧版 JS 退场方案（public/db.js + public/ai.js）

> **状态：方案待确认（AGENTS.md 检查清单 Step 4）。本文件只是方案，未改任何代码。**
> 依据：2026-09-14 实测（探针见文末附录），不是读代码推测。

**目标：** 让 TS 实现真正生效，逐步卸掉 `public/db.js` / `public/ai.js`，最终从 `index.html` 摘掉这两个 `<script>` 并删除文件。

---

## 一、结论先行：机制已经存在，不需要发明

`src/main.ts` 里有两个挂载函数，语义相反：

```ts
function assignToWindow(exports) { for (const [k, v] of Object.entries(exports)) { w[k] = v; } }        // 强制覆盖 → TS 赢
function assignIfMissing(exports) { for (const [k, v] of Object.entries(exports)) { if (typeof w[k] === 'undefined') w[k] = v; } }  // 让位 → 旧 JS 赢
```

而 `index.html` 先加载经典脚本 `/db.js`、`/ai.js`，`<script type="module">` 默认 defer 后执行。所以：

- 走 `assignToWindow` 的名字 → **TS 已经生效**（第 170 行起，271 个）
- 走 `assignIfMissing` 的名字 → **旧 JS 仍然压着 TS**（第 99 行起，62 个）

**所以"迁移"就是一件事：把名字从 `assignIfMissing({...})`（99 行）搬到 `assignToWindow({...})`（170 行），一批一批搬，每批验证。** 项目从 Batch 3 起就是这么做的（第 157 行注释可证），只是 Batch 1/2 那 62 个一直留在原地。

## 二、实测现状（探针数字）

| 指标 | 数量 |
|---|---|
| 旧 JS（db.js + ai.js）往 window 挂的名字 | **144** |
| TS 已强制接管（assignToWindow） | **271** |
| 仍被旧 JS 压住的 TS 实现（= 搬家清单） | **28** |
| TS 独有、已生效（旧 JS 不定义） | 34 |
| 只有旧 JS 提供（删脚本前必须处理） | **116** |
| `index.html` 内联处理器依赖的名字 | 130 |
| 其中「只有旧 JS 提供」的 | **1**（`exportAllData`） |

明细：`tmp/shadow-report.json`（复现命令见文末附录）。

### 要把 116 个"旧独有"再分两类

扫 `src/**/*.ts` 里 `w.NAME` 的实际调用后：**只有 36 个是真被依赖的**，其余 ~80 个（wiki / topics / teaching_nodes / pending_photos / 相似题 等已下线功能）**无人调用，可以直接删**。

36 个依赖库存（`[压住]` = TS 有实现但被压住；`[旧独有]` = 只有旧 JS 有）：

```
dbCreateQuestion ◀ question-core.ts, quick-import.ts        dbBuildSyncPayload ◀ sync-ui.ts
dbApplyRemoteSnapshot ◀ sync-ui.ts                            dbFinalizeSuccessfulSync ◀ sync-ui.ts
dbAddQuestionNote ◀ note-version.ts, question-core.ts, quick-import.ts
dbGetQuestionNotes / dbUpdateQuestionNote / dbGetLastViewedNote / dbSetLastViewedNote ◀ note-version.ts
dbGetAllQuestions / dbGetTrashedQuestions / dbSoftDeleteQuestion / dbRestoreQuestion ◀ question-core.ts
dbPermanentDeleteQuestion ◀ question-core.ts                  dbUpdateQuestionVersions ◀ question-detail.ts
dbCreateTag / dbDeleteTag / dbGetAllTags ◀ tag-manage.ts, question-core.ts, quick-import.ts 等
dbAddTagToQuestion / dbRemoveTagFromQuestion ◀ question-core.ts, tag-suggest.ts
dbGetAllPapers / dbDeletePaper / dbGetPaperQuestions / generatePaperPDF ◀ paper-manage.ts
dbEnableReview / dbDisableReview / dbCompleteReview / dbGetPendingReviews ◀ review-ui.ts
dbUpdateVersion / dbRemoveVersionFromAllQuestions ◀ markdown.ts, version-manage.ts
_invalidateQuestionsCache ◀ question-core.ts, tag-suggest.ts, test-god-mode.ts
compressImage ◀ quick-import.ts                               callCloudAI ◀ provider-manage.ts, tag-suggest.ts
generatePDF ◀ export-pdf-ui.ts                                importAllData ◀ test-god-mode.ts
exportAllData ◀ index.html（唯一被 HTML 直接依赖的旧独有）
```

## 三、分批方案（按风险从低到高，每批一个 commit）

| 批 | 内容 | 为什么这个顺序 | 该批的验收 |
|---|---|---|---|
| **A** | 纯函数：`generateId`、`safeParseJSON`、`dataURLtoBlob`、`setProviderGetter` | 无状态、无 IO、不被 HTML 依赖 | 单测 + 哈希门禁 |
| **B** | 只读查询：`dbGetAllQuestions`、`dbGetAllTags`、`dbGetQuestionNotes`、`dbGetAllPapers`、`dbGetPaperQuestions`、`dbGetTrashedQuestions` | 只读，出问题不会毁数据 | 单测（**形状必须逐字段对齐**）+ E2E 全量 |
| **C** | 工具类：`compressImage`、`callCloudAI*`、`KNOWLEDGE_ATOMIZER_PROMPT*` | AI 那几个端侧已不维护，**大概率直接删而不是迁** | 先判断迁/删，再决定验收 |
| **D** | 写操作：`dbAddQuestionNote`、`dbCreateTag`、`dbDeleteTag`、`dbAddTagToQuestion`、`dbRemoveTagFromQuestion`、`dbUpdateQuestionVersions`、`dbUpdateQuestionBookInfo`、`dbSoftDeleteQuestion`、`dbRestoreQuestion`、`dbPermanentDeleteQuestion` | 会写数据，形状不一致就会写出"半新半旧"的记录 | 形状单测 + 双跑对比 + E2E 全量 |
| **E** | 同步与新建题目：`dbReplaceWithRemoteSnapshot`、`dbBuildSyncPayload`、`dbApplyRemoteSnapshot`、`dbFinalizeSuccessfulSync`、`dbCreateQuestion`、`generatePDF`、`generatePaperPDF`、`exportAllData`、`importAllData` | 最高风险，见第四节三个地雷 | 必须先把地雷解掉才允许搬 |

## 四、三个致命地雷（不解决就别搬 E 批）

**地雷 1：同步载荷是子集 —— 换手会静默丢字段**

- 旧版 `dbBuildSyncPayload` 返回 **11 个字段**（`public/db.js:1275`）：`tags, questions, papers, similar_links, pending_link_list, topics, question_notes, teaching_nodes, teaching_versions, node_questions, settings`
- TS `SyncPayload` 类型只有 **6 个**（`src/types/sync.ts:5-12`：questions / tags / question_tags / papers / paper_questions / question_notes）

直接搬 `dbBuildSyncPayload` → `similar_links`、`settings`（含常见标签配置）、`pending_link_list` 等**全部不再上传**。这是静默数据丢失，而且不会报错。

**地雷 2：旧版题目同步链路含图片资产上传，TS 版没有**

旧独有里有 `_uploadImage`、`_cacheImageIfRemote`、`_needsAssetUpload`、`_normalizeServerAssetUrl`、`_prepareQuestionForSync`。换手后图片不再上传到服务器 / 不再缓存远端资产 → 新设备拿到题目看不到图。

**地雷 3：缓存失效职责**

旧版内部 `_invalidateQuestionsCache` / `_invalidateTagIndex` 管缓存，TS 侧是以 `w._invalidateQuestionsCache()` 调它的。换手后若新实现不自己失效缓存，UI 会读到陈旧数据（这类 bug 表现为"改了没反应"，很难查）。

**另外两个次级坑**

- **形状差异实例（笔记）**：旧版写 7 个键、**不带 `deleted_at`**（`public/db.js:900-910`）；TS 写 8 个键、带 `deleted_at: null`。而旧版 `dbGetQuestionNotes` **不过滤** `deleted_at`、TS 版**过滤**。搬 B 批时不做语义对齐，会出现"软删的笔记突然消失/冒出来"。
  - **补充（2026-09-14 Task 1 评审结论）**：`deleted_at` 这一条差异本身是**向后兼容**的——读路径 `!note.deleted_at` 把 `undefined`（旧记录缺字段）与 `null`（TS 写入）**统一视作"未删除"**，软删置时间戳时两者都为 truthy 被过滤。所以切到 TS 写端不会因这个字段出问题；记录下来是为了避免后人把"旧记录缺 `deleted_at`"误判成 bug。真正需要对齐的是**过滤语义**（旧版不过滤 vs TS 过滤），不是字段本身。
- **HTML 内联处理器**：130 个名字被 `onclick="..."` 直接调用，重名替换时**签名、同步/异步、返回值**必须完全一致，否则是运行时静默失败。

## 五、每批的门禁（可自动化）

**门禁 1：哈希突变法（证明"接管真的生效了"）**

搬家前后各取一次目标函数 `toString()` 的 SHA-256，**哈希变了才算生效**（旧 JS 与 TS 实现体必然不同）。这个判据与函数名无关、不依赖任何标记代码：

```js
// tmp/verify-live-impl.spec.js 思路：对每个目标名字记录/比对哈希
const hash = await page.evaluate((names) => names.map(n => {
  const h = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return String(x); };
  return [n, typeof window[n], typeof window[n] === 'function' ? h(window[n].toString()) : null];
}), NAMES);
// 与 tmp/live-hash-before.json 比对：搬走的名字哈希必须变，未搬的必须不变
```

**门禁 2：形状对照单测**（B/D 批强制）：对每个"写"函数，断言 `Object.keys(记录).sort()` 与旧实现一致，关键语义（是否过滤 `deleted_at`、是否补默认值）逐条对齐。

**门禁 3：E2E 全量**（每批）：`NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-<批次>`。第三类地雷（缓存）只有全量跑才暴露。

**门禁 4（E 批强制）：双跑对比**。同一操作分别用旧/新实现执行，比对落库记录。实现方式建议轻量：搬 E 批时**先不删旧实现**，用一个 `localStorage.__legacyImpl = '1'` 开关决定用哪边，比对一致后再删开关。

## 六、收尾（当 62 个名字都搬完、116 个旧独有都迁或删之后）

1. 从 `src/index.html:978-979` 摘掉 `<script src="/db.js">`、`<script src="/ai.js">`
2. 删 `public/db.js`、`public/ai.js`、`public/app.js`（app.js 已经不再被任何 HTML 引用）
3. 清 `www/`：它是 **git 追踪的陈旧副本**（79,591 字节 vs `public/db.js` 的 83,581），而 `capacitor.config.ts` 的 `webDir` 已经是 `dist` → www 不再参与打包。**删之前先确认没有脚本引用**（`package.json` 里 `cap:init` 的 `--web-dir www` 是陈旧参数，要一并清）
4. 清 `package.json` 里过期的 cap 脚本
5. 把「改数据层前先验谁在跑」写进 `AGENTS.md`

## 七、与本次「手写笔记照片」功能的关系（顺序建议）

**顺带建议：把「版本删除」也挂到本项目的 E 批。**

背景：`question_notes` 目前**删不掉**——服务端表没有 `deleted_at` 列（`server/src/db/schema.ts:118-129`），`upsertQuestionNote` 是 `hasDeletedAt: false`（`sync-upsert.ts:110,122-129`），而客户端 pull 的 `_isRemoteNewer` 在本地缺失时返回 `true`（`public/db.js:165-170`）→ 本地删了会被下一次同步复活。题目有墓碑机制（`purged_at` + `purged_question_ids`），笔记没有。

要支持"删除某个图片版本"（手写笔记或题图版本都受影响），最小改动就是给笔记补一套墓碑机制。它**恰好落在 E 批的射程内**——E 批本来就要动同步协议与 `dbApplyRemoteSnapshot`，两件事共享同一轮形状对齐、双跑对比与全量 E2E 的验证成本，一起做比分开做便宜。

**建议：先做手写笔记功能，再单独立项做本次迁移。**

理由：

1. 手写笔记是纯新增，走的是已经在跑的 `w.dbAddQuestionNote`（旧实现），**零依赖本次迁移**——我在计划里已经验证过它在旧实现下字段是对的
2. 迁移是**纯重构，零用户可见收益，风险却覆盖全局**（同步、题目创建、PDF 生成全在里面）
3. 两件事混在一起，任何回归都分不清是谁引入的，验证成本翻倍

**反过来，什么情况下该先迁移**：如果你近期打算大改题目/同步逻辑（比如把试卷云同步做深），那先迁移更划算——否则你会在影子层上再写一轮白工。

## 八、不涉及边界

- 本次不实现任何一批，只出方案
- 不改服务端
- 不在迁移中顺手改功能行为（除地雷 1/2/3 必须对齐的部分）

## 九、对抗性评审：这套方案什么情况下是错的

| 风险/反例 | 判据 | 我的处理 |
|---|---|---|
| **`w.NAME` 静态扫描漏掉动态访问** | 代码里若存在 `w[name]` / `window[name]` 形式 | 方案里已注明：扫的是 `w.NAME` 字面量；开工前先 grep `w\[` 和 `window\[` 确认没有动态访问 |
| 哈希门禁被误判 | TS 实现与旧实现**恰好函数体相同**（抄过来没改） | 这种情况哈希不变 → 门禁报"未生效"。此时改用"调用计数"法（在 TS 实现里临时插 `window.__tsCalls.push(name)`，验证后移除） |
| 搬迁顺序被跳批 | 有人直接从 A 跳到 E | 每批的 commit 独立、门禁独立；E 批额外要求先落地地雷 1/2/3 的对齐与单测 |
| 迁完后旧 JS 仍有隐藏依赖 | 只在真机（Capacitor 原生插件路径）才走的代码 | 收尾前必须跑一次真机验收（拍照/相册/PDF/同步/备份），不能只靠浏览器 E2E |
| 工作量被低估 | 116 个旧独有里 80 个要判断"删还是迁" | 这 80 个的判断是纯粹的读代码+搜索工作，可以批量做，但要留出时间；建议单独出一个"废弃清单"再动手删 |

**这套方案最可能错的地方**：把"搬名字"当成机械操作。真正花时间的是**形状与语义对齐**（地雷 1/2/3 和笔记那类字段差异）——搬之前必须逐个读出旧实现的完整行为，否则就是把一个能跑的旧实现换成"看起来一样、细节不同"的新实现。

## 附录：探针使用

```bash
# 1) 现行实现判定（哪个名字跑的是 TS、哪个是旧 JS）
NODE_OPTIONS= npx playwright test --config=tmp/probe.config.js --reporter=list --output=tmp/test-results-probe -g "线上实际生效"

# 2) 影子层全量盘点（生成 tmp/shadow-report.json）
NODE_OPTIONS= npx playwright test --config=tmp/probe.config.js --reporter=list --output=tmp/test-results-shadow -g "shadow report"
```

脚本：`tmp/probe-notes.spec.js`、`tmp/probe-shadow.spec.js`、`tmp/probe.config.js`。
（`tmp/` 已 gitignore。若日后要长期用，应挪进 `scripts/` 并纳入版本控制。）
