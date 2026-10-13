# Phase 0 交接单（新会话从这里继续）

> **计划本体**：`docs/plans/2026-09-11-chapters-topics-tag-categories.md`
> **⚠️ 该文档的 §零「2026-09-16 复议与裁决」优先于其它任何冲突处，动手前必读。**
> 本文只记「执行到哪、下一步做什么、别碰什么」，不重复计划内容。
>
> 工作 worktree：`/Users/john/WorkBuddy/Worktrees/question-bank-local/f640-main2-06c2f2a9`
> 分支：`workbuddy/f640-main2-06c2f2a9`

---

## 一、一句话现状

Phase 0（同步链路地基）**代码 10 项里 9 项已落地**、**验证 6 项里 4 项通过**；
**全部改动未提交**、**生产库未动过**（冷备已做）。

---

## 二、已完成（**有证据，不要重做**）

| 项 | 证据 |
|---|---|
| P0-1 标签下行双向合并 | `src/data/sync.ts:12-14` 取最大时间戳判定 + 空时间戳兜底 0 |
| P0-2 `question_tags` 加版本列 | `server/src/db/schema.ts`（CREATE TABLE 含两列；**`ensureColumn('question_tags',…)` 在 :274/:275**） |
| P0-3 关联逐条 upsert（D3 病根移除） | `server/src/services/sync-upsert.ts:126 upsertQuestionTag`；**`replaceQuestionTags` 已删除**；`listQuestionTagIds` 加了 `qt.deleted_at IS NULL` |
| P0-4 关联独立同步键 | `server/src/routes/sync.ts:22` 接收 / `:108-112` pull 返回（含墓碑与时间戳） |
| P0-5 关联软删 + 墓碑 | `src/data/questions.ts` 的 `dbAddTagToQuestion` / `dbRemoveTagFromQuestion`（本地无记录也写墓碑） |
| P0-6 缓存失效 | `invalidateTagIndex()` 已在 `questions.ts` / `tags.ts` 调用 |
| P0-7 时间戳兜底 | 见 P0-1 的兜底注释 |
| P0-9 同步顺序 pull → push | `src/ui/sync-ui.ts` |
| P0-10 `dbClearAllData` 补清 `question_tags` | `src/data/sync.ts` 的 `dbQuestionTags.clear()` |

**已通过的四项验证**：
- 客户端 `npm run typecheck` → **0 错误**
- 客户端 `npm run test` → **374 passed / 4 skipped**（唯一失败文件 `unit-tests/real-api.spec.js` 是既有外部 API 用例，无网络，**属环境问题**）
- 新增 `unit-tests/question-tag-sync.spec.ts` → **8 passed**
- `npm run build` → **通过**

**已做的环境前置**：
- 生产库冷备：`tmp/db-backup-20260916/data.db`（`PRAGMA integrity_check = ok`，行数与源库一致）
- schema 变更副本演练：`tmp/db-backup-20260916/rehearsal.db`（加列成功、完整性 ok、行数不变）

---

## 三、待做（按此顺序）

### 1) 服务端测试（`server/test/question-tags-sync.test.ts`，尚未跑）

它用 **vitest + supertest**，但：
- `server/package.json` **没有 test 脚本**（只有 `start` / `dev`）
- 根 `vitest.config.js` 的 include 可能**不含 `server/test/**`** → 直接跑可能一个用例都不执行
- 需先确认 `supertest` 与 `server/test/helpers/auth.ts` 是否就位

**做法**：先探明 runner，再跑；把输出原文贴回。若缺依赖，**先报告再装**（装依赖是改环境）。

### 2) 全量 E2E

```bash
NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-phase0
```

> ⚠️ **Bash 工具可能报 "failed"，那是沙箱拦截 Chrome code-sign-clone 的噪音**（本机 `ps` 被禁、
> 相关临时文件写在 `/private/var/folders/...`）。**以 Playwright 自己的汇总输出与 exit code 为准**，
> 不要据此误判失败。约 5–11 分钟。

### 3) P0-8 备份兼容（计划的 Phase 0 倒数第二项）

**先判断它是否"自动满足"再动手**（不要为了做而做）：
- 备份已改为**分片**结构（`src/services/backup-shards.ts` 的 `planShards`），落盘到 `Directory.External`
- 关联记录在 IndexedDB store 里，导出会自然带上 `updated_at` / `deleted_at`
- 导入走 `src/data/backup.ts` 的 `importStoreRecords`（内部 `setItem`，对字段缺失宽容）

**若已自动满足 → 不改实现代码**，只补测试证明它成立：
- 旧备份（关联记录**无**时间戳）导入 → 不抛错
- 新备份（带两字段）导入 → 两字段**被保留**
- 导出 → 导入 后 `created_at` / `updated_at` / `deleted_at` **与导出前一致**

### 4) 全绿之后才动生产库

生产库：`/Users/john/question-bank-local/server/data.db`（服务进程 cwd 在
`.codex/worktrees/f640/question-bank-local/server`，但 `DB_PATH` 指向此处；端口 **3001**）。

- **`ensureColumn('question_tags', …)` 已在代码里 → 服务重启即自动加列**，多半**不需要手工 ALTER**
- 若要手工执行：`ALTER TABLE question_tags ADD COLUMN updated_at TEXT;` 与 `… deleted_at TEXT;`
  —— **实测不幂等**（重复执行报 `duplicate column name`），必须先判列是否存在
- ⚠️ 不要在服务运行中随意改它的库：运行中的进程有预编译语句，schema 变化可能引起报错

### 5) **王先生重启服务**（这一步是人的动作，AI 不做）

### 6) 重启后验证 Phase 0 的真正验收

- 标签改名/改色 → 另一台设备能收到（P0-1）
- 题目**标签关联**能下到新设备（P0-4，此前完全不下行）
- **取消关联不被复活**（P0-5 + P0-3，此前会被陈旧全量 push 复活）
- 两端并发改同一 (题目, 标签) → 按 `updated_at` 新者胜，不丢不复活

### 7) Phase 0 通过 → 进 Phase 1（1.1–1.7 + **N1**「未打标签的题」入口）

---

## 四、红线

1. **生产库在 Phase 0 验证全绿之前不得改动**
2. **改动不提交**（本项目规则：AI 不 commit，等王先生统一提交）
3. **`grep` 必须用 `-E`**：本机 `grep -n "a\|b\|c"` 的交替写法**不生效**（返回假"无匹配"）
4. **不要在沙箱里跑 git**（共享 `.git` 在工作区外，会被中断并留下 `*.lock` 残留，且**不会自愈**）
5. **核对清单类信息不要用 `head` 截断**——今天因此差点误判两次（`ensureColumn` 列表、`ls` 输出）
6. **服务端 typecheck 的 ~158 个错误是既有的、不在本轮范围**：
   `server/tsconfig.json` 缺 `@types/node` / `@types/express` → `process` 未定义、
   所有 `req`/`res` 退化为隐式 any。只需保证**本次改动不新增**错误
7. 不要改计划 §六「不涉及边界」列出的东西（PDF 导出、端侧 AI、试卷云端链路、题目列表版式、遗留 `topics`）

---

## 五、今天踩过、值得复用的六个坑

| # | 坑 | 处置 |
|---|---|---|
| 1 | `grep \|` 假阴性 | 一律 `grep -E` |
| 2 | 沙箱中断 git 写锁 → `*.lock` 残留**不自愈** | 确认无持有者后清锁 + **非沙箱模式**执行 |
| 3 | "429 派发失败"其实子 Agent 已跑 | **用文件 mtime 取证**，别按经验外推 |
| 4 | 统计漏 `user_id` → 把"两个账号"误读成"标签重复" | 统计必须同时过滤 `deleted_at IS NULL` **和** `user_id` |
| 5 | 采样偏差（`ORDER BY … LIMIT 5` 抽到最老的残留） | 抽样必须说明方式，不能代表全局 |
| 6 | 为让测试变绿而想改生产语义 | 禁止；**改测试的错断言可以，改生产语义不行** |
