# 测试体系加固（测试前移）实施计划

> **For agentic workers:** 本计划大部分任务已完成（✅）。剩余任务见文末"未完成"。
> 复盘背景见对话（2026-09-17）：语义检索 E2E 全绿后真机仍暴露 7 个问题，归因为测试体系三层缺口。

**Goal:** 把真机阶段才发现的问题前移到测试体系——补齐"真实链路 / 真实数据校准 / 产物·部署态"三层验证，并固化流程规则。

**Architecture:** 在现有"单元 + mock E2E"两层之上，新增三层：① 真实链路诊断 E2E（连真实 server + 真实模型，不可达自动 skip）；② 阈值校准脚本（建库后跑，基于真实分数分布定参）；③ 产物断言 + 部署探针脚本（打包/部署后各一行命令）。流程规则写入 AGENTS.md 强制。

**Tech Stack:** Playwright（真实链路）、Python（复用 embed_service 模型加载）、bash（curl/lsof/unzip 探针）。

**Spec:** 本文即 spec；问题归因表见对话复盘（7 个真机问题 → 5 个可前移 / 2 个真机专属）。

## Global Constraints

- 测试产物一律输出 `tmp/`（AGENTS.md 既有规则）
- 新增外部依赖类测试必须带不可达/缺凭据的 `test.skip` 守卫，不得假失败
- 提交前 E2E 用 `--workers=1` 串行跑（并发跑产生资源竞争假阳性，2026-09-17 实测 8 例假失败）
- `addInitScript` 内的代码运行在**浏览器上下文**——Node 常量必须经第二参数传入，禁止直接引用（教训：`BACKEND` 引用导致 addInitScript 静默失败）
- bash 脚本中 `$VAR` 后紧跟全角字符时需写 `${VAR}`（bash 会把 UTF-8 字节并入变量名）

---

## 已完成 ✅

### Task 1: 真实链路诊断 E2E 固化 ✅

**Files:**
- Modify: `tests/semantic-diag.spec.js`

**内容**：4 用例（①登录重开自动拉取向量 184+ ②未登录静默 ③以图搜结果区视口可见[mock] ④长查询语义命中数>0）。

**加固（三项）**：
- server 不可达 → `test.skip`（beforeAll 探 `/api/health`，3s 超时）
- token 自愈：E2E_TOKEN 失效（401）时用 E2E_TEST_PHONE/PASSWORD 登录换新（**最多一次**，服务端限流 15min/10 次）
- 缺凭据 → skip

**验证**：`--workers=1` 串行 4 passed × 2 遍稳定。

**踩坑记录（重要）**：
- 子代理曾在 `addInitScript` 里引用 Node 常量 `BACKEND` → 浏览器上下文 ReferenceError → addInitScript 静默失败 → localStorage 全空 → "同步未配置"。**修复后 4 passed**。
- 排查方法沉淀：页面状态探针（`localStorage` 内容 + `typeof window.refreshAll`）比推理快；`refreshEmbeddings` 抛"同步未配置" vs 401 的区别直接指向 `initRemoteSync` 是否执行。

### Task 2: 产物断言脚本 ✅

**Files:**
- Create: `scripts/verify-apk-assets.sh`（可执行）

**验证**：对最新 APK 断言 4 个标记（`btn-image-search` / `semantic-results` 在 index.html；`refreshEmbeddings` / `semantic-results` 在 JS）。拦得住"包不含接线代码"。

### Task 3: 部署探针脚本 ✅

**Files:**
- Create: `scripts/verify-server-deploy.sh`（可执行）

**验证**：health 200、`/api/embed/vectors` 401（404 = 跑旧代码，提示 kickstart 重启）、打印服务 PID + cwd（codex worktree = 预期）。已实测通过。
（修过一个 bash 坑：`$V（全角` → `${V}（`。）

### Task 4: 阈值校准脚本 ✅

**Files:**
- Create: `server/embed/calibrate_threshold.py`

**验证**（真实跑，184 条向量）：
- 长句"游乐场里游客坐在转椅上被绳子拉着绕圈飞" top1=0.3455，>0.25 = 24 题
- 短词"游乐场" top1=0.2756，>0.25 = 4 题
- "传送带上的划痕" top1=0.4383，>0.35 = 14 题（强信号查询可以过 0.35，但长/短描述句不行——印证 0.35 阈值缺陷）
- 推荐值 0.25 成立

### Task 5: AGENTS.md 规则固化 ✅

**Files:**
- Modify: `AGENTS.md`

**内容**：① visibility 规则第 6 条（新功能的可见结果区域用例必须过 `assertVisiblyRendered`，附 9-17 事故记录）；② 新增"测试分层与真实链路验证"章节（四层表格 + 四条硬规则，含串行全量）。

### Task 6: 顺带修复的真竞态 ✅

**Files:**
- Modify: `src/ui/question-core.ts`、`tests/semantic-search.spec.js`

**内容**：图片搜开始时取消挂起的文字搜防抖（`clearTimeout(_semanticDebounce)` + `_semanticToken++`）——填字后点图片按钮时，文字搜结果不再覆盖图片搜结果。用例 D 的按钮可见性断言移到点击前。

**验证**：串行全量 108 passed。

---

## 未完成 ☐

### Task 7: merge 到 f640/main2 并同步生产 worktree ☐

**Files:**
- Modify: `/Users/john/.codex/worktrees/f640/question-bank-local`（分支 `f640/main2`）

**步骤**：
- [ ] 当前 worktree commit（本计划的全部改动；注意 git 写操作需提权执行 + 清孤儿锁，见 syncing-git-worktree skill）
- [ ] codex worktree：`stash push`（保护 WIP：笔记软删除）→ `git merge workbuddy/f640-main2-48bafe4f` → `stash pop`（核对双方改动并存）
- [ ] 本批改动**不含服务端运行代码变化**（server/embed/calibrate_threshold.py 为新增脚本，服务进程无需重启；如需重启：`launchctl kickstart -k gui/501/com.questionbank.ts-server`）
- [ ] 验证：`git log --oneline -2`、`./scripts/verify-server-deploy.sh`

### Task 8: push（等王先生指令）☐

- `f640/main2` 领先 origin 7+ 提交后按王先生指令 push。

---

## 自评（Self-Review）

- 覆盖：复盘提出的 4 项落地建议全部对应 Task 1-5；串行全量与可见性规则进 AGENTS.md。
- 无占位符；所有验证均为实测记录。
- 类型一致性：不适用（无接口变更）。
