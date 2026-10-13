# 标签关联同步修复（方案乙：客户端最小改动，服务端不动）

- 日期：2026-10-13（**v2**，已按子代理对抗性评审 + `AGENTS.md` 文档索引重写）
- 提议：WorkBuddy
- 状态：**待批准，未开工**
- 前置：`AGENTS.md` 编码前置检查清单 Step 1「查文档索引」已执行；Step 2 已读锁定文档（见 §2）

---

## 0. 修订记录：v1 被否决的三处（留档，避免重犯）

| v1 的结论 | 为什么错 | 后果 |
|---|---|---|
| F8：`dbAddTagToQuestion`/`dbRemoveTagFromQuestion`/`dbReplaceWithRemoteSnapshot` 在 `assignIfMissing`（旧 JS 赢） | **用了过期快照**。13:57 读文件，14:41 有提交 `f690879`，而我在 14:0x 据此写计划 | C1/C2/C3 打在 `public/db.js` 上，**改了不生效** |
| 客户端写入路径"没有时间戳、没有墓碑"，需要补 | 活实现（TS）**早就写好了**，连"跨设备复活"都预判了并写了注释 | 三处改动纯属多余 |
| 验证载体选 `unit-tests/question-tag-sync.spec.ts` | 它 import 的是 TS 模块，**测不到活的 `db.js`** | "先红后绿"会**假绿**，第一层验证失效 |

**根本教训**：写计划前必须先校验快照新鲜度（`ls -lT` + `git log -1` + `git status`）。已写入项目记忆为硬规则。

---

## 1. 现象与根因

**用户实测**（2026-10-13）：
1. 在手机 APP 上给题目打标签 → **同步不上去**
2. 一点「同步」 → **刚打的标签被删掉**

**数据实证**（生产库只读快照 `/tmp/qb-1013.db`，由 `.backup` 生成）：
- 关联 441 条，**墓碑 0** → 服务端从未删除过任何关联，它只是**一直收不到**
- `question_tags.created_at` 按日期分布：最后一条是 **2026-10-09**（用户自己那次），**10-10 ~ 10-13 全为 0**

**根因（一句话）**：标签关联的"带版本实体"契约**早已设计完、TS 侧实现完、单测全绿**，
但**运行时的 push / pull 跑的是 `public/db.js` 那一版老实现**，契约从未生效。

- **上行断**：活的 `dbBuildSyncPayload`（`db.js:1279`）return 里**没有 `question_tags` 字段**，
  关联只塞在 `questions[].tag_ids`；而服务端 push **只读** `req.body.question_tags[]`（`sync.ts:22,36-38`）→ 全丢。
- **下行擦**：活的 `dbApplyRemoteSnapshot`（`db.js:1397`）**无条件**用服务端的 `tag_ids` 走
  `_replaceQuestionTags`（先删光再重建）→ 服务端没有你刚打的标签 → 用空集覆盖 → 刚打的没了。

---

## 2. 契约来源（客户端必须对齐的权威文档）

| 文档 | 位置 | 关键内容 |
|---|---|---|
| 关联章节 + 专题 + 标签分类体系 | `docs/chapters-topics-tag-categories.md` **§3.1** | 同步链路全图：`payload.question_tags[]`（四字段）→ 服务端逐条 `upsertQuestionTag`（`isIncomingNewer`）→ pull 返回含墓碑与时间戳 → **客户端 `dbApplyRemoteSnapshot` 对关联做逐条时间戳合并** |
| 同上 §3.2 | | 客户端软删：`dbRemoveTagFromQuestion` 置 `deleted_at`；本地无记录**也写墓碑**；并**删除旧的 `replaceQuestionTags`（以 tag_ids 为准全量替换）** |
| 同上 §3.4 | | `runSync` 采用 **`pull → push`**；逐条合并语义下顺序不影响正确性 |
| 同上 §6.2 | | `unit-tests/question-tag-sync.spec.ts` 已覆盖：双向合并/逐条合并/软删传播/时间戳兜底/旧备份兼容/清空/buildTagIndex 跳过软删 |
| 同上 §7 第 1 条 | | **「多设备真实同步未联调、真机跨设备未验」** ← 本次踩的正是这条 |
| 修复题目标签形状契约回归 | `docs/fix-qtag-shape-regression.md`（`AGENTS.md` 索引行 **271**，2026-10-09） | `main.ts` 改强制覆盖后活层记录形状为**扁平** `{id,name,color}`；legacy `buildTagIndex` 是**嵌套** `{tags:{...}}`。形状不匹配曾导致 `undefined.color` 崩溃，潜伏 2 个多月 |
| 旧版 JS 退场方案 | `docs/plans/2026-09-14-legacy-js-retirement.md`（索引行 **301**） | 三个致命地雷之一是 **payload 子集** —— 本次改动正落在这颗雷上 |

---

## 3. 已核实事实（v2）

标注：**✅本人已读代码** / ⚠️**评审发现，实施前先复核**

| # | 事实 | 出处 | |
|---|---|---|---|
| F1 | 服务端 pull 已返回 `question_tags`（含三时间戳），注释写明"由客户端逐条合并" | `server/src/routes/sync.ts:108-125` | ✅ |
| F2 | 服务端 push 只读 `req.body.question_tags[]`；**不存在** `tag_ids` 兼容路径 | `sync.ts:22,36-38`；`sync-upsert.ts:152-196` | ✅ |
| F3 | 活的 push 无 `question_tags` | `public/db.js:1190`、`:1279` | ✅ |
| F4 | 活的 pull 为整题替换 | `public/db.js:1397` → `_replaceQuestionTags :1282-1291` | ✅ |
| F5 | **活代码判定**（当前 HEAD `f690879`，2026-10-13 14:41） | `src/main.ts:99,106` = `assignIfMissing`；`:151` = `assignToWindow` | ✅ |
| F5a | `dbGetAllQuestions`:154、`dbAddTagToQuestion`:159、`dbRemoveTagFromQuestion`:160、`dbGetAllTags`:168、`dbReplaceWithRemoteSnapshot`:186 → **均 `assignToWindow`（TS 赢）** | `src/main.ts` | ✅ |
| F5b | `dbBuildSyncPayload`、`dbApplyRemoteSnapshot` → **不在任何 assign 列表**，仅由 `db.js` 定义 → **db.js 赢** | `src/main.ts` 全文件无此二名 | ✅ |
| F6 | 活写入（TS）**已带时间戳与墓碑**，且注释预判跨设备复活 | `src/data/questions.ts:170-187` | ✅ |
| F7 | `dbCreateQuestion` 写关联**不带时间戳**（活代码里的真实缺口） | `src/data/questions.ts:138-140` | ✅ |
| F8 | TS `question_tags` 逐条合并用 `recNewer`（记录自身时间戳） | `src/data/sync.ts:190-196` | ✅ |
| F9 | 三份 `db.js` SHA256 一致；`public/` 是真源；传播链 `build → cap sync`（`webDir:'dist'`） | `shasum` 实测 + `vite.config`/`capacitor.config.ts` | ✅ |
| F10 | `_collectQuestionTagIds`（`db.js:1030`，被活的 `:1190` 调用）**只过滤 `tag.deleted_at`、不过滤关联墓碑** | 评审提出 | ⚠️ |
| F11 | `unit-tests/helpers/load-db.js` 用 `new Function` 加载真 `public/db.js` 并 mock localforage | 评审提出 | ⚠️ |
| F12 | TS 版 `dbApplyRemoteSnapshot` 缺 5 项能力（见 §5 对比表） | `src/data/sync.ts:175-208` vs `public/db.js:1329-1397` | ✅ |

---

## 4. 变更清单（方案乙：客户端 4 处，**服务端 0 处**）

### C1 —— push 补发 `question_tags`　`public/db.js:1279`（`dbBuildSyncPayload` 的 return）

- 在 return 对象里**新增 `question_tags`**：遍历 `dbQuestionTags` store，**原样取出全部记录（含墓碑）**，
  保证每条四字段齐全：`{ question_id, tag_id, created_at, updated_at, deleted_at }`
- **缺时间戳的补值规则（关键，不可省）**：
  `updated_at` ← 记录自身 `updated_at` → `created_at` → 该题目的 `created_at` → `'1970-01-01T00:00:00.000Z'`
  > **为什么不能留空**：服务端 `normalizeTimestamp(qt.updated_at || qt.deleted_at || qt.created_at)`
  > （`sync-upsert.ts:133` → `helpers.ts:5-6`）对空值会**填入 `now`**，
  > 从而把服务端的**存量墓碑复活**。
  > **为什么兜底用 1970 而不是 now**：宁可"很旧"也不要"很新" —— 旧时间戳在 LWW 里只会输，不会覆盖别人正确的更新。
- `questions[].tag_ids` 保持原样（服务端不读；保留以兼容未升级的服务端）。

### C2 —— pull 改成逐条时间戳合并　`public/db.js:1397`

- **删除**这一行：`if (question.tag_ids !== undefined) await _replaceQuestionTags(question.id, question.tag_ids);`
- 改为：若 `snapshot.question_tags` 是**非空数组** → 逐条合并：
  ```
  对每条 qt：key = `${qt.question_id}_${qt.tag_id}`
            与本地同键记录比较，按 _isRemoteNewer(qt, local)（db.js:165，取值顺序沿用现实现，不另造）决定是否写入
  特例：remote 是墓碑、local 是活记录、且 local 无有效时间戳 → 保留 local（不删），并记日志
  ```
- **兜底**：若 `snapshot.question_tags` 缺失或为空（旧服务端）→ 退化为用 `question.tag_ids`
  **只增不删**地补齐本地，**绝不删除任何本地关联**。
- 合并期间/结束后沿用 `db.js:1330-1331` 的 `_invalidateQuestionsCache()` + `_invalidateTagIndex()`。
- `_replaceQuestionTags` 函数本身**保留**，仅供 purged 题目级联（`db.js:1387`）使用。

### C3 —— 新建题目时补时间戳　`src/data/questions.ts:138-140`（活代码）

```
现状：{ question_id: id, tag_id: tagId }
目标：{ question_id: id, tag_id: tagId, created_at: now, updated_at: now, deleted_at: null }
```
与 `dbAddTagToQuestion`（`:172`）保持完全一致。

### C4 —— `_collectQuestionTagIds` 过滤墓碑　`public/db.js:1030`

收集 `questions[].tag_ids` 时跳过 `qt.deleted_at` 非空的关联，避免上行带上已取消的关联。
（若复核发现该函数已在别处兜住，则本项取消 —— 见 F10）

### C5 —— 传播

`public/db.js` 是唯一真源（F9）。改完执行 `npm run build` → `npx cap sync android`，
并断言 `public/db.js`、`dist/db.js`、`android/app/src/main/assets/public/db.js` 三份 **SHA256 一致**。
**不手工 cp**；`android/app/build/intermediates/**` 是构建中间产物，不纳入断言。

---

## 5. 为什么不用"甲方案"（把 TS 的同步函数挂上去）

评审提过一个更"优雅"的方案：在 `assignToWindow` 里补两行，把 `src/data/sync.ts` 的
`dbBuildSyncPayload` / `dbApplyRemoteSnapshot` 挂上去，零 `db.js` 改动。

**已实测否决** —— 两版能力对比：

| 能力 | `db.js`（现活） | TS 版 |
|---|---|---|
| 关联逐条合并 | ❌ 整题替换 | ✅ |
| 远程图片落地缓存 `_cacheImageIfRemote` | ✅ `db.js:1355` | ❌ 无 |
| 版本丢弃告警 `_checkVersionsDiscard` | ✅ `db.js:1382` | ❌ 无 |
| purged 题目级联（关联/相似链接/试卷成员） | ✅ `db.js:1385-1394` | ❌ 无 |
| `similar_links` / `topics` / `teaching_*` | ✅ | ❌ 无 |
| 试卷 `pdf_local_path` 保留 | ✅ | 部分 |

**挂上去 = 一次性砍掉 5 项功能。** 甲方案只有在补齐上述能力后才可行，那是"旧版 JS 退场方案"的正式迁移步骤，不应夹带在本次 bug 修复里。

**采用乙的额外好处**：TS 那段逐条合并（`src/data/sync.ts:190-196`）可作为 `db.js` 里要补逻辑的**现成参照**，降低自创风险。

---

## 6. 对抗性自检（v2）

| 攻击 | 是否成立 | 处理 |
|---|---|---|
| 改了 v1 那三处（db.js 写入路径） | **成立，v1 已犯** | 已删除；写入路径由 TS 负责（F5a/F6），不动 |
| 改 `db.js` 却因 TS 覆盖而不生效 | **可能**（F5a） | C1/C2 只动 `dbBuildSyncPayload`/`dbApplyRemoteSnapshot`，已实证二者**未挂载**（F5b） |
| 服务端把无时间戳入站关联填成 `now` → 复活墓碑 | **成立** | C1 的补值规则（1970 兜底）+ C3 消灭新增的无时间戳记录 |
| 缺时间戳的存量记录导致"取消标签"传不到该设备 | **成立，且无法两全** | 明确取舍：**宁可留一个本该删的标签，也不冒删错的风险**（对齐"零容忍静默丢失"）。该组合发生时**必须记日志**，不静默 |
| 两台设备并发改同一关联 | 可能 | 按关联自身时间戳 LWW；与题目/标签既有策略一致，本次不扩大改动 |
| 设备时钟错乱 | 可能 | 墓碑对时钟错乱是**单向放大器**（快 1 天的墓碑会长期压过别人的真实编辑）。本次不引入新等级，记入已知取舍；C1 的 1970 兜底已消除最常见的一种 |
| `runSync` 改为 `pull → push`（契约 §3.4）后顺序敏感 | 不成立 | 逐条合并语义下与顺序无关 |
| `_buildTagIndex` 需补墓碑过滤 | **不成立** | 活读路径是 TS 的 `buildTagIndex`（`src/data/tags.ts:44`，已过滤）；不改 `db.js` 的 `_buildTagIndex` |
| 三份 `db.js` 传播失败 | 可能 | C5 的 SHA 断言 |
| 记录形状契约（扁平 vs 嵌套）被破坏 | **可能** | C1/C2 **只改 store 里的关联记录**（`{question_id, tag_id, ...}`），**不产出** `q.question_tags` 聚合，不触碰该契约 |

**本方案在什么情况下会失败**：见上表"缺时间戳的存量记录"与"时钟错乱"两条 —— 均为**已声明的已知取舍**，不是遗漏。

---

## 7. 明确不做的边界

- 服务端**一行不改**（契约的服务端侧早已完成：逐条 `upsertQuestionTag`、无 `tag_ids` 兼容路径、pull 含墓碑）
- 不把 TS 同步实现挂到 window（甲方案，见 §5）
- 不改 `db.js` 的 `_buildTagIndex`（活读路径不经它）
- 不改 UI 结构、不改标签记录形状契约
- 不写存量数据修复脚本 —— 服务端对顶部那批题**从来没有关联记录**（墓碑 0 佐证），无处可修
- 不打包 APK、不 commit、不 push

---

## 8. 验证计划

- **L1 单元**：**载体必须是 `unit-tests/helpers/load-db.js`**（加载真 `public/db.js`，mock localforage），
  **不是** `unit-tests/question-tag-sync.spec.ts`（它 import TS 模块，测不到活路径）。用例：
  1. push payload 含 `question_tags`，且缺时间戳的记录被补成**稳定旧值（不是 now）**
  2. 本地独有、服务端没有的关联，经 pull **不被删**（本 bug 直接复现）
  3. 服务端墓碑能覆盖本地同键活记录
  4. `snapshot.question_tags` 缺失时退化为**只增不删**
  5. `dbCreateQuestion` 写出的关联带完整四字段
  **写完先把 bug 改回去确认用例变红，再改回来**（项目硬规则）
- **L2 真实链路**：备份库副本 + 独立端口起临时服务端（`DB_PATH=/tmp/... PORT=3999 NODE_ENV=test`），
  打真实 HTTP：新格式 push（含墓碑）→ 服务端标记删除；
  `question_tags` 缺时间戳的入站 → **断言不被填成 now**。**不碰生产库**。
- **L3 真实数据校准**：本次无阈值/参数，**不需要**。
- **L4 产物**：`npm run build` + `npx cap sync android` 后断言三份 `db.js` SHA256 一致。
- **UI**：本次不改 UI 结构，但标签芯片增删路径按项目规则跑 `assertVisiblyRendered` + 手机视口（390×844）截图，并实际 Read 截图。
- 全程 `NODE_OPTIONS=` 前缀 + `--reporter=list` + `--output=tmp/test-results-<新目录>`；提交前 E2E 串行 `--workers=1`。

---

## 9. 回滚

- 客户端：改前把 `public/db.js`、`src/data/questions.ts` 备份到 `/tmp/`；出问题 cp 回 → 重新 build + cap sync
- 服务端：**本次无改动，无需回滚**
- 数据库：预计零写入风险（不改表、不迁移）；仍按惯例改前做 `.backup` 快照（**必须 `.backup`，禁止 `cp`** —— WAL 模式）

---

## 10. 分工

| 谁 | 做什么 |
|---|---|
| 我 | 改 4 处 / 补测试 / 跑四层验证 / 出开发文档 / 更新 `AGENTS.md` 索引 |
| 王先生 | 真机验证（打标签→同步→还在；取消标签→同步→不回来）、**打包 APK**、最终提交 |

---

## 11. 修好后仍需你手工做的一件事

服务端对列表顶部那批题（创建于 2026-09-17 ~ 09-29）**从来没有关联记录**（墓碑 0 佐证，不是被删的）。
同步修好也**换不回来** —— 需要你**手工重打一次标签**。

---

## 12. 待确认

1. 本方案（v2）是否批准？
2. 实施第一步是**复核 §3 里两条标注 ⚠️ 的项**（F10 `_collectQuestionTagIds`、F11 `load-db.js`）——
   若不成立会相应调整 C4 与 L1 载体，届时先回报再继续。
