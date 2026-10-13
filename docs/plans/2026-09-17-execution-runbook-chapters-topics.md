# 章节/专题功能 · 操作执行清单（Runbook）

> **For Claude:** 执行本清单请用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 逐任务推进。
> **依据**：`docs/plans/2026-09-11-chapters-topics-tag-categories.md`（§零 复议裁决优先于一切冲突处）+ 王先生 2026-09-16/17 的历次批准。
> **用途**：① 让王先生**审计 AI 已对他环境做过的每一类操作**；② 剩余步骤**逐项可勾选**：谁执行、做什么、命令、怎么验证、失败怎么回退。

---

## 一、已执行操作清单（**审计区**，2026-09-14 ~ 09-17 实录）

### 1.1 对**生产库**做过的全部操作（仅此两件，均有验证）

| # | 操作 | 时间 | 语句/方式 | 验证 | 回退手段 |
|---|---|---|---|---|---|
| 1 | **冷备**（只读） | 09-16 20:56 | `sqlite3 "file:…?mode=ro" ".backup tmp/db-backup-20260916/data.db"` | `integrity_check=ok`；行数 tags203/questions220/question_tags433 与源一致 | —（纯新增文件） |
| 2 | **加列**（DDL，已获批） | 09-17 13:2x | `ALTER TABLE question_tags ADD COLUMN created_at/updated_at/deleted_at TEXT;`（共 3 条，先在副本 `rehearsal.db` 演练过） | `integrity_check=ok`；440 行完好、新列全 NULL | 冷备可整体还原；或 `DROP COLUMN`（SQLite 3.35+） |
| 3 | **冷备 2**（只读，验证前快照） | 09-17 14:0x | `.backup tmp/db-backup-20260917/data.db` | `integrity_check=ok`；行数 tags205/questions222/question_tags440 与源一致 | — |

**除此之外**：生产库**未执行过任何其他 DDL/DML/查询写入**；全部查询用 `mode=ro` 只读连接。

### 1.2 对**代码仓库**做过的操作

| # | 操作 | 位置 | 结果 |
|---|---|---|---|
| 1 | 备份链路修复（D8/FF-1/utf8/分片/预览） | 提交 `cf55aef` → 合并 `3799d5a` | 已同步 `f640/main2`（09-16，王先生批准） |
| 2 | **Phase 0 同步地基**（P0-1~10） | 提交 `600b240` | 12 文件，+626/−31 |
| 3 | **合并** f640/main2（语义检索 WeMM-2B） | 合并 `fe0e987` | `schema.ts` 冲突已解（两边保留） |
| 4 | `sync-upsert.ts` 3 处类型修正 | 提交 `8f5a359` | 服务端 tsc 在 schema/sync-upsert 上无报错 |
| 5 | **快进** `f640/main2` → `8f5a359` | 两个 worktree HEAD/tree 一致 | 六项验收全过 |

### 1.3 起过的**进程**

| 进程 | 端口 | 库 | 状态 |
|---|---|---|---|
| 测试服务（Phase 0 验证用） | 3009 | **副本** `tmp/db-backup-20260916/test-run.db` | **已停止**，端口已释放 |
| **生产服务**（王先生的，守护进程管理） | 3001 | `/Users/john/question-bank-local/server/data.db` | **未被 AI 触碰过**（AI 从未 kill/重启它） |

### 1.4 明确**没做过**的

❌ 未 push origin　❌ 未删除任何数据行　❌ 未跑除加列外的任何 DDL　❌ 未重启/kill 生产服务　❌ 未安装除 `server/` 内授权安装外的任何依赖

---

## 二、当前状态（一句话）

**Phase 0 ✅（代码+验证+已同步，`f640/main2` = `8f5a359`）；生产库已加列 ✅；生产服务仍在跑旧代码 ⚠️；Phase 1 未开始。**

---

## 三、剩余步骤（**逐项：谁 / 做什么 / 命令 / 验证 / 回退**）

### R0 · 【王先生】重启生产服务（**随时可做，是 R4/R5 验收的前提**）

- **做什么**：按你的守护进程方式重启（kill 让它自动拉起，或走守护进程接口）
- **AI 先行确认**（重启前由 AI 复核一遍，1 分钟）：
  ```bash
  sqlite3 "file:/Users/john/question-bank-local/server/data.db?mode=ro" "PRAGMA table_info(question_tags);"
  # 期望 5 列（question_id/tag_id/created_at/updated_at/deleted_at）
  ```
- **重启后验证**（他或 AI 看）：
  ```bash
  tail -20 /Users/john/.codex/worktrees/f640/question-bank-local/server/…（启动日志，无 SQL 报错）
  sqlite3 "…?mode=ro" "SELECT COUNT(*) FROM question_tags WHERE deleted_at IS NULL;"   # 正常返回数字
  ```
- **回退**：`git -C /Users/john/.codex/worktrees/f640/question-bank-local checkout 3799d5a -- server/src && 重启`
  （`3799d5a` 是 Phase 0 之前、且含语义检索的提交）

### R1 · 【AI 子代理】Phase 1 数据层（1.1 / 1.2 / 1.7 / N1-data）✅ **已完成（2026-09-17，全部验证通过）**

> 完成记录：`category_id` 已贯通类型/客户端 store/服务端 CREATE TABLE **且** `ensureColumn`（:188）/**`TAG_COLUMNS` 传播**四层；
> 默认六类种子（含必需「系统」类）；`dbUpdateTag`；N1 零标签题查询（`questions.ts:223/239`）；
> 新增 `unit-tests/tag-categories-phase1.spec.ts`；typecheck 0 / 服务端 tsc 既有 9 错零新增 / 单测 396 passed / build ✓ / 复现演练红→绿。
> 有一处**超出清单字面但必要**的补充：`sync-upsert.ts` 的 `TAG_COLUMNS` 加入 `category_id`（否则服务端丢列、传播断链）。

- **做什么**：`Tag.category_id`；`src/data/tag-categories.ts`（默认六类种子，含必需的「系统」类）；`tag_categories` store 进 `ALL_STORES`；`dbUpdateTag`；`ensureColumn('tags','category_id','TEXT')` **且同步检查 `CREATE TABLE tags`**；sync 保留并传播 `category_id`；**零标签题查询**（N1 数据层）
- **口径**：`tag_categories` 以 IndexedDB store 为本地唯一权威；同步走 `user_settings` 通道（§0.5 分支 B）
- **验证**：typecheck 0；服务端 tsc 不新增错误（装依赖后既有错误仅 9 个，在 `questions.ts`/`tags.ts`）；单测（种子/`dbUpdateTag`/category_id 同步保留/零标签查询）；build；**复现演练红→绿**
- **回退**：单 commit `git revert`

### R2 · 【AI 子代理】Phase 1 UI（1.3 / 1.4 / 1.5 / 1.6 + N1 入口）

- **做什么**：标签管理 Tab 新增「类别」分区；**批量分类界面**（82 个标签，关键词预填+逐项确认）；**三处新建标签入口强制选类别**（`tag-manage.ts` / `quick-import.ts` / `question-core.ts`）；选择器类别可见性配置（§3.3 + D-b 裁决：**章节选择器不显示未分类**，改提示「还有 N 个未分类 → 去分类」）；**「未打标签的题（N）」入口**
- **验证**：typecheck/单测/build/全量 E2E（**`--workers=1`**，本机约定）+ **每屏截图 + `assertVisiblyRendered`** + AI 实际 Read 截图
- **复现演练**：把「强制选类别」临时去掉 → 确认测试变红 → 改回
- **回退**：单 commit revert

### R3 · 【王先生】把存量标签分类完（**Phase 2 素材的前提**）

- **为什么必须**：章节素材来自"已分类"的标签；82 个标签现在**全部未分类** → 不分类，Phase 2 的章节打开是空的（§0.5 推论）
- **怎么算完成**：标签管理里"未分类"为 0（或你明确接受某些标签保持未分类）
- **回退**：分类只是给标签补 `category_id`，可随时改

### R4 · 【AI 子代理】Phase 2 章节/专题本体（2.1 ~ 2.13）

- **做什么**：`groups` 数据层（kind 区分章节/专题）、`ExprNode` 求值模块（含每节点题数）、表达式编辑器（**章节只给"或"，专题两层且/或**——A5）、删标签/删专题级联清理、题目列表筛选区（章节/专题行）、加入/移出专题、快速导入专题匹配框、配置同步接线
- **关键裁决（已在 §零）**：允许一题同属多章（A1）；无手动归入通道（A2）；核心标签不升级（A3）；**列表不解析表达式**（E6）；`groups`/`tag_categories` 以 IndexedDB store 为唯一权威（分支 B）
- **验证**：typecheck（客户端+服务端）/单测（成员计算、死引用、合并）/build/全量 E2E（workers=1）/截图可见性评估/复现演练
- **回退**：按 Phase 单独 revert

### R5 · 【王先生】真机验证 Phase 2

- 手机 + 平板各验：按章节筛题（**含"一题两章都出现"**）、按专题筛题、表达式编辑器（改条件看题数变化）、**取消标签后在另一台设备看是否同步消失**（D6）、加入/移出专题

### R6 · 【AI 子代理】Phase 0/1/2 全量 CI 收口

- typecheck（客户端+服务端不新增错误）/ 单测 / build / **全量 E2E（workers=1）** / 截图评估汇总 / 复现演练汇总
- **产出**：开发文档（`docs/`）+ 更新 `AGENTS.md` 开发文档索引

### R7 · 【王先生 → AI】提交审核与同步

- 王先生检查 → 授权提交 → AI：提交 + 合并 `f640/main2` + 快进（流程同 09-16/17 已验证的做法）
- **不 push origin**（除非王先生要求）

### R8 · 【王先生，可选但强烈建议】灾难恢复演练（分支 E 的遗留项）

- **前置**：R0–R6 全部完成（同步可信之后才能演练，否则会真丢数据）
- 平板上：确认同步完整 → **清空 APP 数据** → 登录 → 看**同步下行**能否恢复全部题目+标签关联 → 再用**分片备份**「📂 加载备份」→ 两条路都能恢复 = **灾难恢复能力被证明**
- 回退：无（这是验证，不动代码）

**Phase 3（设备快照）延后** ✅（P1 裁决）

---

## 四、贯穿全程的红线（每一步都适用）

1. **生产库**：除已获批的加列外，AI 不做任何 DDL/DML；只读查询一律 `mode=ro`
2. **提交**：AI 不自动 commit/push；每个 R 步骤结束**汇报等确认**
3. **UI 改动**：必须截图 + `assertVisiblyRendered` + AI 实际 Read 截图
4. **新增测试**：必须先做复现性演练（把 bug 改回去确认变红）
5. **删除/迁移类操作**：先取得王先生确认
6. **本机跑 E2E**：一律 `NODE_OPTIONS= npx playwright test --reporter=list --workers=1 --output=tmp/test-results-<新目录>`
7. **grep 一律 `grep -E`**（`\|` 交替在本机不生效）
8. **git 一律非沙箱模式**；失败先 `lsof` 判锁、清孤儿锁后立刻重试

---

## 五、当前待办的第一项

**R0：王先生重启生产服务**（生产库的列已就位，重启后 Phase 0 的同步修复即生效）。
R1（Phase 1 数据层）**不依赖 R0**，可并行由 AI 先行——等王先生说「开始执行」即派发。
