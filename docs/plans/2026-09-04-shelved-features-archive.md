# 搁置功能保留方案

日期：2026-09-04
分支：`f640/main2` @ f4c2029
状态：**待确认，未执行任何变更**

## 一、结论

**不为搁置功能新建永久 worktree。** 代码保留在主线，靠「文档清单 + 基线 tag + 远端备份」三层保留。

已确认的搁置语义：**只停止开发，不修改、不摘除代码**。

### 为什么不用 worktree

| 判断 | 依据（实测） |
|---|---|
| worktree 不提供持久性 | 提交与 blob 已存在于 `/Users/john/question-bank-local/.git`（438M）。worktree 只是磁盘 checkout，能被 `git worktree prune` 静默清除、能被 `rm -rf` |
| worktree 不提供隔离 | 现有 5 个 worktree 共享同一对象库，任一处 `gc --prune=now` 或强推都会影响全部 |
| worktree 解决不了本问题 | 待搁置功能的代码**已合入主线**，不在独立分支上。checkout 出来仍是主线，功能照旧运行 |
| 成本不合理 | 单个 worktree 工作区 5.1G（含 node_modules / server），且 worktree 间不共享 node_modules |

**这个结论不成立的情况**：若需要「两份可独立运行的代码」做对比或演示，worktree 才是对的。当前需求是减负，不是并跑，故不适用。

## 二、仓库现状（2026-09-04 实测）

| 项 | 值 |
|---|---|
| 共享对象库 | `/Users/john/question-bank-local/.git`，438M |
| worktree 数 | 5（其中 1 个 prunable，目录已不存在） |
| 本地分支 | 9 |
| 远端分支 | 3（`main` / `f640/main2` / `feedback-assets`） |
| `f640/main2` 未推送 | **14 个提交** |
| `codex/localbank` 独有提交 | 2 个（含 18.2MB APK 二进制） |
| 已完全合入 `origin/main` 的分支 | `f640/mail-fq`、`lake-weather`、`worktree-agent-a1932b2474d1c4d46`、`worktree-agent-a23a39593c447848a`、`worktree-agent-ae015c2d8d1b1fdce` |

**关键事实**：待搁置功能（相似题合并、AI 推荐、悬浮窗、云端 API 等）的代码已全部合入主线，**没有任何一个待搁置功能只存在于独立分支上**。因此「保留分支」这个动作本身无法达成搁置目的。

## 三、P0 止血（与搁置无关，但必须先做）

这 4 项的丢失风险远高于搁置功能本身。**当前唯一真实的数据丢失风险是第 1 项。**

### 3.1 推送 14 个未推送提交

`f640/main2` 领先 `origin/f640/main2` 14 个提交（整个 modal-anchor 重构），目前只存在于本机磁盘。

```bash
git push origin f640/main2
```

### 3.2 解除 `f640/mail-fq` 的 upstream 错配

该分支 upstream 被设为 `origin/main`，状态 `behind 56`。分支内容虽已合入 main（无独有代码），但在此分支上执行 `git pull` 会把 main 灌入特性分支。

```bash
git branch --unset-upstream f640/mail-fq
```

### 3.3 打基线 tag

在推送完成后，为「搁置决策时点」打一个 annotated tag，供半年后精确回溯。

```bash
git tag -a shelve-baseline-20260904 -m "功能搁置基线：见 docs/plans/2026-09-04-shelved-features-archive.md"
git push origin shelve-baseline-20260904
```

### 3.4 清理 prunable worktree

已验证 `45dc674` 被 `f640/main2` 包含，其 worktree 目录已不存在，prune 不会丢数据。

```bash
git worktree prune --verbose
```

### 3.5 APK 二进制（低优先级，可选）

`.gitignore` 第 20 行已排除 `*.apk`，当前无被跟踪的 apk 文件。历史 blob（18.2MB，来自 `codex/localbank` 的 `612b6fb`）仍留在对象库中。

- 建议：**不重写历史**。重写会改变所有 commit hash，导致 5 个 worktree 与远端全部失效，风险远大于 18MB 的收益。
- 若坚持清理：需全量重写 + 强制推送 + 重建所有 worktree，属于独立的高风险操作，另行评估。

## 四、防腐机制（针对「不动代码」的三个失效模式）

代码留在主线但停止维护，会产生三类问题。逐条给出对策。

### 失效模式 1：无人知道这段代码已搁置

**后果**：半年后人工或 AI 会去「优化」「重构」死代码；文档本身会腐烂。

**对策**：建立机器可校验的清单，而非纯文档。

- 新建 `docs/shelved/INDEX.md`，每个搁置功能一条，字段见第六节
- 新增 vitest 用例：断言清单中每个登记的入口文件路径**真实存在**
  - 文件被误删 → 测试变红
  - 清单与实际代码漂移 → 测试变红
- 这符合项目 TDD 风格，且标记数据放在文档里，不违反「源码不写注释」的规范

### 失效模式 2：死代码继续收租

**后果**：构建体积、E2E 全量时间、typecheck 时间；**最阴的是锁死 package.json 依赖版本**，拖住后续大版本升级。

**对策**：在清单中记录每个搁置功能依赖的第三方包与当前版本。当未来依赖升级受阻时，可据此判断是否直接摘除该功能。

**不适用**：本期不做摘除、不做特性开关（已确认「不动代码」）。

### 失效模式 3：typecheck 抓不到 schema 漂移

**后果**：搁置功能若依赖 SQLite 表，半年后 `server/` 重构改表，该代码类型检查全绿、编译通过、运行崩溃。

**对策**：清单中必须记录「依赖的服务端路由 / 数据表」。后续 `server/` 涉及这些表的改动，需在 PR 描述中显式确认是否影响搁置功能。

## 五、分支处置决策表

| 分支 | 独有代码 | 建议处置 | 依据 |
|---|---|---|---|
| `f640/main2` | 14 个未推送提交 | **先推送**，保留为开发主线 | 唯一活跃开发分支 |
| `codex/localbank` | 有（2 个提交，含 18MB APK） | **待定**：推送到归档分支 / 打 tag / 或删除 | 唯一含独有代码的分支，需人工确认这 2 个提交是否还要 |
| `f640/mail-fq` | 无（已合入 origin/main） | 解绑 upstream 后保留；确认后可删 | 内容已在 main，删除无损失 |
| `lake-weather` | 无 | 同上，可删 | 已合入 |
| `worktree-agent-*` ×3 | 无 | 同上，可删 | 三个分支指向同一 commit `2a29ad9` |
| `workbuddy/f640-main2-267b480b` | 无（与 f640/main2 同 commit） | 保留，WorkBuddy 工具托管 | 由工具管理，勿手动删 |

**删除分支的安全前提**：先完成 3.1 推送 + 3.3 打 tag。打 tag 后，即使分支被删，提交仍被 tag 引用，不会被 gc 回收。

## 六、搁置功能登记表模板

每个搁置功能填一份，存 `docs/shelved/<feature>.md`，并在 `docs/shelved/INDEX.md` 汇总。

```markdown
## <功能名>

- 搁置日期：2026-09-04
- 处置类型：暂时搁置 / 放弃（二选一）
- 搁置原因：
- 恢复前置条件：

### 代码位置（4 层，逐层填，漏一层就是假搁置）
- 前端 `src/`：
- 服务端 `server/src/routes/`：
- 数据库表 / schema：
- 原生层 `android/`、`ios/`、`capacitor.config.ts`：

### 入口文件路径（供 vitest 断言存在性）
- src/xxx/yyy.ts

### 依赖的第三方包 + 当前锁定版本
- 包名 @ 版本

### 相关文档
- docs/xxx.md
```

**四层都必须填**。本项目是 Capacitor + Express 全栈应用，只填 `src/` 等于没填——原生插件（如 `FloatingWindowService.java` 669 行）与服务端 schema 是最容易漏、也最难恢复的两层。

## 七、备份与版本策略

| 手段 | 适用 | 建议 |
|---|---|---|
| 推送到 `origin` | 日常 | **必须**，当前最大缺口 |
| Annotated tag | 标记里程碑 | 搁置基线、发版节点各打一个 |
| `git bundle` 离线归档 | 防 GitHub 不可用 / 账号问题 | 每季度一次：`git bundle create <备份盘>/qb-<日期>.bundle --all` |
| 第二 remote | 异地冗余 | 可选，成本高于收益时跳过 |
| release 分支 | 新版本维护 | 新版本出库时从 `f640/main2` 切 `release/<version>` |

**不采纳**：Git LFS 迁移（438M 主要是历史 blob，LFS 只对新文件生效，迁移需重写历史，同 3.5 的风险）。

## 八、不涉及范围

- 不修改、不摘除、不移动任何功能代码（已确认）
- 不新建 worktree
- 不重写 git 历史（含 LFS 迁移、APK blob 清理）
- 不删除任何分支（除非另行确认）
- 不修改 `.gitignore`（已正确排除 `*.apk`）
- 不改动 MCP 配置、不改动依赖版本

## 九、待确认

1. **具体搁置哪些功能？** 本计划未列功能清单，需填入第六节模板。这是唯一阻塞项。
2. `codex/localbank` 的 2 个独有提交（含 18MB APK 提交）是否仍需保留？
3. 4 个已合入 main 的旧分支（`f640/mail-fq`、`lake-weather`、`worktree-agent-*`）是否删除？建议保留，成本几乎为零。
4. 是否接受新增一个 vitest 用例用于校验搁置清单（约 20 行，纯断言，不改产品代码）？
