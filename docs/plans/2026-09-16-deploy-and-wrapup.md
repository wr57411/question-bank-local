# 服务端落地与收尾 实施计划（方案 A）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **状态：待用户确认。** 本计划只做「把已完成的改动落地 + 验证 + 收尾」，**不再新增功能**。
> 上游交付：`docs/note-image-compress-and-delete.md`（已交付，APK `question-bank-local_20260916_214647.apk`）

**Goal:** 把已完成的**服务端 4 行改动**放进服务进程实际加载的代码目录（方案 A），重启并验证墓碑列生效；补齐两处被配额中断的独立评审；收文档与交接清单。

**Architecture:** 服务端由 launchd 托管（`com.questionbank.ts-server`），其 `WorkingDirectory` = `/Users/john/.codex/worktrees/f640/question-bank-local/server`（**加载代码的目录**），`DB_PATH` 指向主仓 `data.db`（**数据与代码分离**）。因此落地 = 往那个目录精确插入 4 行 + `launchctl kickstart -k` 重启。

**Tech Stack:** TS/ESM（tsx 直运）、better-sqlite3、launchd、vitest。

---

## 0. 已核实的事实（本计划的全部依据）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 服务由 LaunchAgent `~/Library/LaunchAgents/com.questionbank.ts-server.plist` 托管，`WorkingDirectory=.codex/.../server`、`DB_PATH=/Users/john/question-bank-local/server/data.db`、`RunAtLoad`+`KeepAlive`=true | `launchctl print gui/501/com.questionbank.ts-server` |
| 2 | 重启命令：`launchctl kickstart -k gui/501/com.questionbank.ts-server`（用户已确认可用；`bootstrap` 在沙箱内会 EIO） | 用户提供 |
| 3 | `sync-upsert.ts` 两边**只差我的 3 处改动**（diff 已逐行核对） | `diff` 生产目录 vs 本 worktree |
| 4 | `schema.ts` 生产目录比我们**少**我那一行 `ensureColumn('question_notes','deleted_at','TEXT')`，**多**一段他人未提交的 `question_embeddings` 建表（7 行） | 同上 |
| 5 | 生产目录所在 worktree 分支 `f640/main2`（`054c612`），**有他人未提交改动**（`server/src/app.ts`、`server/src/db/schema.ts`） | `git -C … status --porcelain` |
| 6 | 生产库 `question_notes` **当前没有** `deleted_at` 列（迁移尚未执行） | `sed -n '118,128p'` 其 schema.ts |

**结论：4 行改动的插入位置与对方的 `question_embeddings` 改动**完全不重叠**，可安全精确插入。**

## 0.1 不涉及边界

- **不 commit** 生产目录的任何改动（那里有他人未提交的工作；git 操作由用户与那边 session 决定）
- 不碰 `.codex` 那条 worktree 的 `server/src/app.ts`、不改它的 `question_embeddings` 段
- 不改 plist（不调整服务拓扑；"改从本 worktree 启动"是另一次决策）
- 不做客户端任何改动（本计划不含代码功能开发）

---

## Task 1：把服务端 4 行改动插入生产代码目录

**Files:**
- Modify: `/Users/john/.codex/worktrees/f640/question-bank-local/server/src/db/schema.ts`（+1 行）
- Modify: `/Users/john/.codex/worktrees/f640/question-bank-local/server/src/services/sync-upsert.ts`（3 处）

**Step 1: 备份 + 记录基线（回滚与自检的依据）**

```bash
D=/Users/john/.codex/worktrees/f640/question-bank-local/server
mkdir -p /tmp/codex-server-backup
cp "$D/src/db/schema.ts" /tmp/codex-server-backup/schema.ts.bak
cp "$D/src/services/sync-upsert.ts" /tmp/codex-server-backup/sync-upsert.ts.bak
md5 -q "$D/src/db/schema.ts" "$D/src/services/sync-upsert.ts"
```
Expected: 打印两个 md5（schema.ts 期望 `ea155ab25f7aee0ec3d8e1bd2c20449f`、sync-upsert.ts 期望 `8158d88bbf2b7e9f4826f3387e3b0313`）。**不同则停下来问**——说明对方又改过，需重新核对。

**Step 2: 插入迁移行（`schema.ts`）**

锚点（该文件当前第 183 行）：
```ts
ensureColumn('questions', 'question_number', "TEXT DEFAULT ''");
```
在其**之后**插入一行：
```ts
ensureColumn('question_notes', 'deleted_at', 'TEXT');
```

**Step 3: 三处改动（`sync-upsert.ts`）**

第 110 行 `NOTE_COLUMNS` 末尾追加 `'deleted_at'`：
```ts
const NOTE_COLUMNS = ['id', 'user_id', 'question_id', 'note_image_url', 'label', 'text_note', 'created_at', 'updated_at', 'deleted_at'];
```

`upsertQuestionNote`（第 122-129 行）改 `hasDeletedAt` 并新增 `serialize`：
```ts
export function upsertQuestionNote(userId: string, note: Record): boolean {
  return upsertRecord(userId, note, {
    table: 'question_notes',
    requiredFields: [],
    columns: NOTE_COLUMNS,
    hasDeletedAt: true,
    serialize: (r) => (r.deleted_at ? { ...r, note_image_url: null } : r),
  });
}
```

**Step 4: 自检——证明"只多了我的 4 行"**

```bash
D=/Users/john/.codex/worktrees/f640/question-bank-local/server
B=/Users/john/WorkBuddy/Worktrees/question-bank-local/f640-main2-de235076/server
echo "--- 与备份的差异（应恰好是新增的 4 行）---"
diff /tmp/codex-server-backup/schema.ts.bak "$D/src/db/schema.ts"
diff /tmp/codex-server-backup/sync-upsert.ts.bak "$D/src/services/sync-upsert.ts"
echo "--- 与该 worktree 的 git 基线对照（应只多 deleted_at 相关行，且 question_embeddings 段原样）---"
git -C /Users/john/.codex/worktrees/f640/question-bank-local diff -- server/src/db/schema.ts server/src/services/sync-upsert.ts | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)"
```
Expected：`diff` 输出仅含 Step 2/3 的 4 行新增；`git diff` 中 `question_embeddings` 段**不出现任何 `-` 行**（未被改动）。

**Step 5: 加载与类型自检（**不碰生产库**）**

```bash
cd /Users/john/.codex/worktrees/f640/question-bank-local/server
NODE_OPTIONS= DB_PATH=':memory:' npx tsx -e "import('./src/db/schema.js').then(()=>console.log('schema 加载 OK'))"
NODE_OPTIONS= npx tsc --noEmit 2>&1 | tail -5
NODE_OPTIONS= npx vitest run test/sync.test.ts 2>&1 | tail -8
```
Expected：schema 加载 OK（`:memory:` 上执行 ensureColumn 无异常）；`tsc` 无错；`sync.test.ts` 全过。
**若测试因对方未提交的 embed 改动而红**：如实报告，不修别人的东西。

**Step 6: 报告并等待重启（不 commit）**

输出：4 行改动的最终 diff、md5 变化、Step 5 结果、以及"待用户执行 kickstart"。

---

## Task 2：重启 + 验证墓碑列生效（用户执行重启，我验证）

**Step 1: 用户执行**
```bash
launchctl kickstart -k gui/501/com.questionbank.ts-server
```

**Step 2: 我验证（全部只读）**
```bash
sqlite3 -readonly /Users/john/question-bank-local/server/data.db "PRAGMA table_info(question_notes);" | grep deleted_at
tail -20 /Users/john/.codex/worktrees/f640/question-bank-local/server/server-error.log
lsof -nP -iTCP:3001 -sTCP:LISTEN | head -3
```
Expected：出现 `deleted_at` 列；error 日志无新异常；3001 重新在听（KeepAlive 生效）。

**Step 3: 失败则回滚**
```bash
D=/Users/john/.codex/worktrees/f640/question-bank-local/server
cp /tmp/codex-server-backup/schema.ts.bak "$D/src/db/schema.ts"
cp /tmp/codex-server-backup/sync-upsert.ts.bak "$D/src/services/sync-upsert.ts"
launchctl kickstart -k gui/501/com.questionbank.ts-server
```

---

## Task 3：客户端手工验证（用户）

**Step 1:** 装 `/Users/john/question-bank-local/question-bank-local_20260916_214647.apk`（**必须在 Task 2 之后**）
**Step 2:** 逐项验证（写进交付文档的清单）：
1. 快速导入拍两张 → 题目详情看图片清晰度（应为 1600 长边，明显优于旧的 800）
2. 详情页「+ 添加版本」拍一张 → 「🗑 删除此版本」→ 下拉消失；把版本删光 → 自动重建「笔记 v1」
3. 跨设备：另一台设备（或清数据重装）看删除是否同步过来（**两台都要升级**）
**Step 3:** 把结果反馈；若有异常，提供：现象 + 哪一步 + 是否已同步过

---

## Task 4：补两处被配额中断的独立评审（配额恢复后）

**范围（两项，可分别派子代理）**：
1. **Task 4b**：`public/db.js:427/429/431` 改 1600/0.85 + `quick-import.ts` 撤销预压缩 + `compress` 默认值回退
   - 重点核验：没有改 `compressImage` 默认参数；最小 diff；`dbCreateQuestion` 三处都改；quick-import 的两处预压缩确实摘除
2. **Task 5**：`tests/quick-import-visibility.spec.js` 新增 2 例 + 演练
   - 重点核验：题/答尺寸断言**有区分力**（`toBe(1600)` 而非 `≤1600`）；删除流程用例的等待条件不会在删除前就满足（竞态）；演练是否真能 FAIL

**若发现真问题**：按 subagent-driven-development 的流程让实施者修 → 重审。

---

## Task 5：文档收尾

**Files:**
- Modify: `docs/plans/2026-09-16-note-compress-and-delete.md`（风险表里"题/答图片变大…超限前有'图片文件化'待办"一行 → 指向交付文档 §4 的更正）
- Modify: `AGENTS.md`（在「打包规则」附近补一节「服务端部署路径」，写明 launchd / WorkingDirectory / DB_PATH / kickstart 命令 / 本计划 §0 的事实）
- Modify: `docs/quick-import-handwritten-note.md`（已在上一轮加了"后续更新"指引 ✓ 复核无需再改）

**Step 1:** 三处编辑
**Step 2:** `git diff --stat AGENTS.md docs/` 复核只有预期文件变化

---

## Task 6：交接清单（不提交，等用户检查）

**Step 1: 列出本 worktree 的未提交改动（29 项）并给建议提交信息**

```bash
git status --porcelain
```
建议提交信息（供用户参考，不由 AI 执行）：
```
快速导入手写笔记照片 + 笔记图片压缩统一 + 笔记版本删除 - 1600/0.85 闸门；墓碑机制跨设备删除；题/答清晰度提升
```

**Step 2: 输出待办清单**（供用户排期）
| 待办 | 来源 |
|---|---|
| 旧版 JS 退场 A–E 批（含把 quick-import 也切到 services 版 compressImage） | `docs/plans/2026-09-14-legacy-js-retirement.md` |
| `tests/helpers/visibility.js` 增加渐变背景采样（消除假阴性） | 交付文档 §六 |
| 清理 `www/` 陈旧死拷贝（与 `public/` 已分叉） | 交付文档 §六 |
| 服务端测试进 CI（`.github/workflows/ci.yml` 目前只跑客户端 vitest） | 交付文档 §七 |
| `AGENTS.md` 第 207 行合并冲突残留标记 `>>>>>>> f640/main2`（历史提交带进来的） | 会话记录 |
| `ship-feature` skill 缺失但 AGENTS.md 仍要求调用（已标注脱节） | 会话记录 |

---

## 风险与对抗性评审

| 风险 | 判据 | 处理 |
|---|---|---|
| 生产目录在我动手前又被改 | Step 1 的 md5 与 §0 表格不符 | **停下并重新核对 diff**，不硬插 |
| 误碰他人未提交改动 | Step 4 的 `git diff` 出现 `question_embeddings` 段的 `-` 行 | 立即用备份还原 + 报告 |
| 重启后服务起不来 | `server-error.log` 有新异常 / 3001 无监听 | Task 2 Step 3 备份回滚 + 再 kickstart |
| 新 APK 早于服务端升级装上 | 删除被 pull"复活" | Task 2 完成前不装 APK（Task 3 Step 1 已写明顺序） |
| 迁移在真实库上失败 | `PRAGMA table_info` 无 `deleted_at` | `ensureColumn` 是幂等 `ALTER TABLE`，失败会在日志暴露；回滚代码即可 |

**这个计划什么情况下是错的：**
1. **如果那条 worktree 的 `f640/main2` 分支其实是"更超前"的版本**（含我们这条没有的功能）——那么"往它插入 4 行"仍成立，但**客户端代码也要以它为准**做后续演进，否则两条分支会持续分叉。这个判断需要用户确认（我只核实了两文件的事实差异，没判断分支策略）。
2. **如果你打算把服务改成从本 worktree 启动**（plist 改 `WorkingDirectory`），Task 1/2 就应改为"在本 worktree 落地 + 改 plist + bootout/bootstrap"，而不是往 `.codex` 插代码。
3. **如果嵌入服务（`question_embeddings`）那条线即将大改 schema**，那么这次插入应等它先落定，避免在同一文件上反复叠加。
