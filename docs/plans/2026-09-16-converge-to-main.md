# 语义检索收敛主仓计划（服务归位 + 真机验收 + 旧 worktree 退役）

> 前置：功能已在 worktree 完成（T1-T10），生产库已建向量（89/89），相似题 404 根因已修（旧 worktree 打补丁，路由在线 401 验证过）。
> 本计划目标：按王先生模型收敛——**主仓 = 代码的家 + 服务运行的源；worktree = 任务现场，merge 完即弃**。

## 前置事实（2026-09-16 18:30 探针实测）

| 项 | 状态 |
|---|---|
| embed :3002 | ✅ 王先生终端 PID 36254，health ok，模型懒加载待命（修复版代码：串行锁） |
| server :3001 | ✅ 守护者拉的旧 worktree 补丁版，`/api/embed/vectors` 401（路由在线） |
| 生产库 | ✅ 向量 89×2048；备份在 `backups/pre-semantic-index-20260915/`（含 md5） |
| 主仓 `/Users/john/question-bank-local` | main @ 8ae98a7（=origin/main）；**merge-base 恰为 main HEAD → 可 fast-forward**；server 有 tsx/node_modules，缺 `.env` |
| worktree 分支 | workbuddy/f640-main2-48bafe4f @ 3799d5a，领先 main 60 提交（含语义功能 + 未提交的防抖/锁修复） |
| 已知风险 | 守护者身份/配置位置未明（非 launchd/PM2/crontab）；守护者所用 node 版本未明——影响主仓 node_modules 的 better-sqlite3 ABI |

---

## Phase A：真机验证相似题（不依赖收敛，5 分钟，王先生操作）

1. **彻底杀掉 App 后重开**（向量拉取挂在 App 启动；点「同步」不触发）
2. 点任意题详情 →「🔍 找相似题」→ **预期**：弹「相似题」层，top-6 卡片带百分比
3. 回退：仍报错 → 把报错文案发我，回诊断（不进 Phase B）

## Phase B（2026-09-17 按王先生明确路径修订）

**王先生纠偏（原话要点）**：「我只需要你提交，然后 merge 到 f640 的 codex worktree，暂时进程还是用 codex 的进程」——**服务进程位置不动**（codex worktree 就是生产运行的源），不需要"守护者切主仓"。

**守护者身份已查明（王先生笔记）**：`com.questionbank.ts-server`（LaunchAgent，KeepAlive）——重启命令 `launchctl kickstart -k gui/501/com.questionbank.ts-server`（控制命令不受 provenance 限制；bootstrap 才受限，这解释了之前的 EIO）。

**修订后步骤**：
1. 当前 worktree 回归 + 统一 commit
2. codex worktree（`/Users/john/.codex/worktrees/f640/question-bank-local`，分支 `f640/main2`，**领先当前分支**）：
   - 工作区有未提交改动（app.ts/schema.ts = 语义补丁副本 + ensureColumn('question_notes','deleted_at')；sync-upsert.ts = 那边独立工作）→ **stash → merge → pop**（pop 若冲突：保留 ensureColumn 与 question_embeddings，去除重复段）
   - `git merge workbuddy/f640-main2-48bafe4f`（两边都有新提交 → 产生 merge commit）
3. 重启服务生效：`launchctl kickstart -k gui/501/com.questionbank.ts-server`
4. 验证：`/api/health` 200 + `/api/embed/vectors` 401
5. 主仓 main 分支**不动**（王先生未要求）

## Phase B（原方案，作废备查）
原设计"守护者切主仓 + 主仓 ff-merge"——基于误解（把 main 检出当作生产源）。王先生的实际模型：**codex worktree = 生产运行源**，新任务 worktree merge 过去即可，进程不迁移。

## Phase C：embed 服务落主仓

- merge 后 `server/embed/` 已在主仓（含串行锁修复）
- 停 worktree 的实例（王先生终端 `kill 36254`）→ 主仓同命令重启：
  `cd /Users/john/question-bank-local/server/embed && nohup ~/.workbuddy/binaries/python/envs/default/bin/uvicorn embed_service:app --host 127.0.0.1 --port 3002 > embed-service.log 2>&1 &`
- 或纳入自动程序托管（配置由王先生写，无 provenance 问题）
- 验证：health ok → curl encode-text 真编码 → 手机重开 App 试文字搜

## Phase D：真机全量验收（王先生）

1. 文字搜"游乐场里旋转的椅子"→「语义相关」区出对题（需 embed 在线）
2. 相似题 + **飞行模式相似题**（向量已在本地的证明）
3. 以图搜题（拍照）→「图片匹配」区
4. 飞行模式文字搜/以图搜 → 静默降级无崩溃
- ⚠️ 防抖修复需**王先生重新打包 APK**才完整进真机（`BUILD_SOURCE=current`；主仓收敛后直接在主仓打包即可）

## Phase E：清理

- 旧 codex worktree 退役（守护者已切走；含 60MB 孤儿 data.db 的处置由王先生定）
- push（按王先生指令）
- 项目 tmp/ 评测产物保留（`tmp/wemm-eval/`，gitignore 内）

## 验收通过后

统一 commit 已在 B1 完成；push 按王先生指令执行。
