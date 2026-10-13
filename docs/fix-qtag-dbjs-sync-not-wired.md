# 标签关联同步修复：契约早已实现，只是从未接线

- 日期：2026-10-13
- 计划：`docs/plans/2026-10-13-question-tags-sync-fix.md`（v2，方案乙）
- 契约来源：`docs/chapters-topics-tag-categories.md` §3.1 / §3.2 / §3.4
- 影响模块：`public/db.js`（活的同步实现）、`src/data/questions.ts`（活的写入实现）
- **服务端零改动**

---

## 一、现象

用户真机实测（2026-10-13）：

1. 在手机 APP 上给题目打标签 → **同步不上去**
2. 一点「同步」 → **刚打的标签被删掉**

## 二、根因：契约在 TS 里实现完整、单测全绿，但运行时跑的是 `db.js` 的老实现

标签关联的「带版本实体」契约（`created_at/updated_at/deleted_at` + 独立同步键 + 逐条 upsert + 软删墓碑）
**早已设计完、TS 侧实现完、单测全绿**，但 **push / pull 两个函数在运行时并非 TS 实现**：

| 函数 | 归属 | 谁生效 |
|---|---|---|
| `dbBuildSyncPayload` | **不在** `src/main.ts` 任何 assign 列表 → 只由 `public/db.js` 定义 | **db.js 赢** |
| `dbApplyRemoteSnapshot` | 同上 | **db.js 赢** |
| `dbAddTagToQuestion` / `dbRemoveTagFromQuestion` / `dbGetAllQuestions` / `dbReplaceWithRemoteSnapshot` | `src/main.ts:151` 起的 `assignToWindow`（强制覆盖） | **TS 赢** |

于是：

- **上行断**：活的 `dbBuildSyncPayload`（`db.js:1279`）return 里**没有 `question_tags`**，关联只塞在
  `questions[].tag_ids`；而服务端 push **只读** `req.body.question_tags[]`（`sync.ts:22,36-38`）→ 全丢。
- **下行擦**：活的 `dbApplyRemoteSnapshot`（`db.js:1397`）**无条件**用服务端 `tag_ids` 走
  `_replaceQuestionTags`（先删光再重建）→ 服务端没有你刚打的标签 → 用空集覆盖 → 刚打的没了。

**为什么以前没暴露**：同文档 §7「已知限制」第 1 条原文就写着
「**多设备真实同步未联调、真机跨设备未验**」。本次踩的正是这条。

---

## 三、数据实证

生产库只读快照（`.backup` 生成，**禁止 `cp`** —— WAL 模式会漏未落盘数据）：

- 关联 441 条，**墓碑 0** → 服务端从未删除过任何关联，它只是**一直收不到**
- `question_tags.created_at` 分布：最后一条是 **2026-10-09**（用户上次自己那次），**10-10 ~ 10-13 全为 0**
- 列表顶部（按 `created_at DESC`）9 道题的标签数为 0，第 10 道起为 3~4 → 与「打开 APP 第一眼看到没标签」吻合

**服务端时间戳兜底实测**（直接跑服务端真实代码）：

```
normalizeTimestamp(undefined) = 2026-10-13T07:13:01.578Z   ← 空值被填成「现在」
normalizeTimestamp("")        = 2026-10-13T07:13:01.578Z
normalizeTimestamp(null)      = 2026-10-13T07:13:01.578Z
```

这是 C1 必须补时间戳（且兜底用 1970 而非 now）的直接依据：**空值会被服务端当"现在"，反过来复活它自己的存量墓碑。**

---

## 四、变更清单（4 处，全部客户端）

### C1 `public/db.js` — push 补发 `question_tags`

在 `dbBuildSyncPayload` 的 return 里新增 `question_tags`：遍历 `dbQuestionTags`，原样取出全部记录
（**含墓碑**），每条保证四字段齐全。缺时间戳时的补值顺序：
`updated_at` → `created_at` → 该题目的 `created_at` → **兜底常量 `TAG_RELATION_EPOCH = '1970-01-01T00:00:00.000Z'`**。

- 为什么不能留空：见 §三 实测。
- 为什么兜底用 1970 而不是 now：宁可「很旧」也不要「很新」——旧时间戳在 LWW 里只会输，不会覆盖别人正确的更新。

`questions[].tag_ids` 保持原样（服务端不读，保留以兼容未升级的服务端）。

### C2 `public/db.js` — pull 改为逐条时间戳合并

**删除**原 `db.js:1397` 的整题替换调用，改为：

- `snapshot.question_tags` 非空 → 逐条按 `(question_id, tag_id)` 取本地同键记录，
  用 `_isRemoteNewer(qt, local)`（比较**关联自身**的时间戳）决定是否写入；
- **特例（保守策略）**：远端是墓碑、本地是活记录、且本地**无有效时间戳** → **保留本地不删**，
  并 `console.warn` 记录（不静默）；
- **兜底**：`snapshot.question_tags` 缺失或为空（旧服务端）→ 用 `question.tag_ids` **只增不删**，绝不删除本地任何关联；
- purged 题目仍照旧级联清理其关联，且本轮不会被 `question_tags` 复活（新增 `purgedQuestionIds` 守卫）。

`_replaceQuestionTags` 函数**保留**，仅供 purged 级联与「从云端重建」语义使用。

**核心原则**：关联是独立实体，**不再受题目 `updated_at` 守卫约束** —— 这正是原 bug 的成因之一。

### C3 `src/data/questions.ts` — `dbCreateQuestion` 写关联时补时间戳

原写法 `{ question_id, tag_id }`（无时间戳，且这是**活代码**）→ 补成
`{ question_id, tag_id, created_at: now, updated_at: now, deleted_at: null }`，与 `dbAddTagToQuestion` 一致。

### C4 `public/db.js` — `_collectQuestionTagIds` 过滤关联墓碑

原实现只过滤「标签」的墓碑（`tag.deleted_at`），**未过滤「关联」自身的墓碑** `qt.deleted_at`，
而该函数被活的 push 使用（`db.js:1190`）→ 会把已取消的关联当活关联带上行。已补。

### 传播

`public/db.js` 是唯一真源；`npm run build` → `npx cap sync android` 复制到另两份。
三份 SHA256 断言一致（见 §五）。未手工 cp。

---

## 五、验证证据（全部实测）

| 层 | 内容 | 结果 |
|---|---|---|
| L1 单元（新） | `unit-tests/qtag-dbjs-sync.spec.js`（7 例，走 `helpers/load-db.js` 加载**真** `public/db.js`） | **7 passed** |
| L1 单元（新） | `unit-tests/qtag-create-question.spec.ts`（2 例，C3） | **2 passed** |
| **先红后绿** | 临时回退 C1+C2 → **3 failed**（含「本地独有的关联在 pull 后仍然存在」本 bug 直接复现）；临时回退 C3+C4 → **2 failed**（对应两条用例精准变红）；恢复后全绿 | 已留原始输出 |
| L1 全量单测 | `npm run test` | **598 passed / 10 skipped / 0 failed** |
| 类型检查 | `npm run typecheck`（`tsc --noEmit`） | **0 错** |
| 构建 | `npm run build` | 成功 |
| L4 产物 | `shasum -a 256` 三份 `db.js` | 全部 `15a6cd82a2be907ce75d084aa225b416a7b13fb734b80e94d2ff6cb95cddaf5d`（三份一致） |
| L4 产物 | Android 资源引用新 bundle | `assets/index-B519BpGh.js`（本轮新产物） |
| E2E | 标签相关 5 个 spec（串行） | **40 passed** |
| E2E | **全量串行** `--workers=1` | **131 passed / 3 skipped / 0 failed**（3 skipped 为 `semantic-diag`，真实服务不可达时按规则 skip） |

### 测试载体为什么换

计划 v1 曾打算扩展 `unit-tests/question-tag-sync.spec.ts` —— 它 import 的是 **TS 模块**，
而 bug 在 **活的 `db.js`**，改回 bug 它**依然全绿**（假绿）。
新用例一律走 `unit-tests/helpers/load-db.js`（`new Function` 加载真 `public/db.js`，mock localforage）。

---

## 六、已知取舍（**不是遗漏**，是刻意选择）

| 场景 | 行为 | 理由 |
|---|---|---|
| 远端墓碑 vs 本地活记录、且本地**无有效时间戳** | **保留本地**（不删）+ `console.warn` | 对齐「零容忍静默数据丢失」：宁可留一个本该删的标签，也不冒删错的风险。代价是「取消标签」传不到持有无时间戳老记录的设备 |
| 两台设备并发改同一关联 | 按关联自身时间戳 LWW | 与项目既有题目/标签策略同级，本次不扩大改动 |
| 设备时钟错乱 | 墓碑对着时钟错乱是**单向放大器** | 本次不引入新等级；C1 的 1970 兜底已消除最常见的一种 |

---

## 七、本次明确不做

- 服务端一行不改（契约的服务端侧早已完成）
- 不把 TS 同步实现挂到 window（**已实测否决**：TS 版 `dbApplyRemoteSnapshot` 缺
  远程图片落地缓存 `_cacheImageIfRemote`、版本丢弃告警 `_checkVersionsDiscard`、purged 级联、
  `similar_links`/`topics`/`teaching_*` —— 挂上去会一次性砍掉 5 项功能）
- 不改 UI 结构、不改标签记录形状契约（活层为**扁平** `{id,name,color}`，见 `docs/fix-qtag-shape-regression.md`）
- 不写存量数据修复脚本 —— 服务端对顶部那批题**从来没有关联记录**（墓碑 0 佐证），无处可修

---

## 八、回滚

- `git checkout -- public/db.js src/data/questions.ts` → 重新 `npm run build` + `npx cap sync android`
- 服务端无改动，无需回滚

---

## 九、修好后仍需手工做的一件事

服务端对列表顶部那批题（创建于 2026-09-17 ~ 09-29）**从来没有关联记录**（墓碑 0 证明不是被删的）。
同步修好也**换不回来** —— 需要**手工重打一次标签**。

---

## 十、待办（留给后续）

1. **旧版 JS 退场**（`docs/plans/2026-09-14-legacy-js-retirement.md`）：本次把
   `dbBuildSyncPayload` / `dbApplyRemoteSnapshot` 的逐条合并语义补在了 legacy `db.js` 上。
   长期正确方向是把 TS 版补齐上述 5 项能力后正式接管，届时可删掉这两处 legacy 实现。
2. 真机跨设备联调（契约 §7 第 1 条仍未闭环）。
