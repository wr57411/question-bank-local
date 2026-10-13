# 引擎-向量库一一绑定重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"所有引擎共享一份向量库、要求跨引擎空间严格一致"改为"每个引擎绑定一份由它自己构建的本地向量库，切换引擎时向量库同步切换"，把鲁棒性要求从**跨系统全局一致**降级为**单引擎局部自洽**。

**Architecture:** 引入 `EngineBinding`（引擎 + 库 + 状态的原子单元）与 `StoreManifest`（库的身份与自洽锚点）。库按引擎物理隔离存储；切换引擎 = 原子替换整个 binding 对象；每次绑定/切换跑一次**自洽校验**（用当前引擎编码固定探针，与 manifest 里建库时存下的探针向量比对，cos ≥ 0.99 才认为配对有效）。对齐闸门从"跨引擎比对基准库"改为"引擎 vs 自己的库"。

**Tech Stack:** TypeScript（客户端 services 层）、localForage（IndexedDB）、better-sqlite3（服务端）、Python + sentence-transformers（建库）、Vitest（单元）、Playwright（E2E）

**Spec:** `docs/plans/2026-09-22-semantic-module-abstraction.md`（v2 方案，本计划取代其 §3 来源定义与 §6 对齐闸门两节）
**配套:** `docs/wemm-embedding-fingerprint.md`（模型指纹与对齐清单）

---

## 0. 修订摘要（2026-09-23 决策落地）

| # | 决策 | 对计划的影响 |
|---|---|---|
| **D1** | 历史向量**不做服务端迁移**，在手机客户端重新建一次 | Task 2 的迁移改为**非破坏性保留**（旧行归 `legacy-default`，不被任何引擎引用）；客户端新增一次性清理旧 `embeddings` store 并重建（Task 11） |
| **D2** | `engineFingerprint` 字段集足够 | Task 4 不变（不加权重 sha256） |
| **D3** | **默认不淘汰任何库**；移除库做成设置页显式操作；容量防护交给 `navigator.storage.estimate()` + `persist()` | Task 6 的 `evict(keep)` **删除**，改为 `remove(engineId)`；新增 `src/services/semantic/storage.ts`（Task 6）。**不实现自制 LRU** |
| **D4** | 90 题规模下自动后台建库，但**不静默**；内联状态提示，不要确认卡片、不要取消机制 | Task 10 增加内联建库进度提示；删除"阻塞确认"与"取消"设计 |
| **D5** | **新增性能要求**：整库作为一块扁平 `Float32Array` 常驻内存 + 批量点乘，消除每次查询的 IndexedDB 游标扫描 | **新增 Task 7**（`FlatVectorIndex`）；Task 10 的 Ranker 改为使用它。这是本计划里唯一被正面处理的性能问题 |

**D5 的问题陈述**（用户指出，原计划未处理）：原设计的 `Corpus.iterate()` 每次搜索都要用游标把整库逐条从 IndexedDB 读出做点乘。5000 题 = 每次查询扫 40MB 磁盘读取，开销随题库**线性增长**，且**与内存无关，纯 I/O**。真正的优化是把整库物化为一整块连续内存，之后所有查询都是纯内存运算。

**执行方式**：subagent-driven-development（每个任务一个全新实现者 + 任务评审 + 最多 5 轮修复循环 + 全分支终审）。

---

## Global Constraints

以下为项目级硬约束，每个任务的要求隐含包含本节：

- 客户端源码必须为 TypeScript（`.ts`），不添加注释（除非用户要求）
- 新模块放 `src/services/` 层，`src/services/index.ts` 统一导出
- **新模块必须走 `main.ts` 的 `assignToWindow()`（强制覆盖），不得走 `assignIfMissing()`** —— 后者会让 `public/db.js` 里的同名旧 JS 静默胜出，TS 实现运行时永不生效（AGENTS.md 专节）
- 服务端不添加注释；新增路由放 `server/src/routes/`，遵循 `authMiddleware` + upsert 模式
- 测试产物一律输出到 `tmp/`；E2E 用 `--reporter=list --output=tmp/test-results-<新目录名>`
- WorkBuddy 会话内跑 node 命令加前缀 `NODE_OPTIONS= `
- 提交前 E2E 串行跑（`--workers=1`）
- 阈值常量 `SEMANTIC_MIN_SCORE = 0.25`（`src/ui/question-core.ts:145`）现状值，重构期间不得改变
- 模型 tag 现状值：`wemm-embedding-2b`（`server/src/routes/embed.ts:9`、`server/embed/build_index.py:11`）
- **不实现自制 LRU / 库淘汰策略**（D3）。容量压力只通过 `navigator.storage.estimate()` 观测并提示用户
- **移除向量库是显式用户操作**，不做自动淘汰
- **建库状态必须可见**（D4）：不得静默建库；不需要确认卡片，不需要取消机制
- **整库查询必须走内存扁平数组**（D5），不得在查询路径上使用 IndexedDB 游标扫描
- 性能基线（本项目实测，`docs/semantic-search-wemm2b.md`）：91 题建库 227s（MPS）、文本 query 编码 117ms、冷启动 17.3s
- 单库内存预算：`count × dim × 4` 字节（2048 维 × 5000 题 ≈ 40MB）

### 运行环境（2026-09-23 实测，Task 1 暴露）

- **本 worktree 没有自己的 `node_modules`**，已建**两个**符号链接指向主仓（均已 gitignore）：
  - `node_modules -> /Users/john/question-bank-local/node_modules`
  - `server/node_modules -> /Users/john/question-bank-local/server/node_modules`（服务端有独立依赖，`better-sqlite3` 是原生模块，主仓已编译好 `build/Release/better_sqlite3.node`）
  - 实测两边 `dependencies`/`devDependencies` **声明完全一致**（只差 `NODE_OPTIONS=` 脚本前缀），无版本错配风险。
- **客户端测试**：`NODE_OPTIONS= ./node_modules/.bin/vitest run <路径>`
- **服务端测试**：`cd server && NODE_OPTIONS= ../node_modules/.bin/vitest run test/<文件>`（`server/vitest.config.ts` 会自动被拾取：environment node、include `test/**/*.test.ts`、setupFiles `test/setup.ts`）
- **不要用 `npx vitest`**（会联网装 vitest@5 并卡死）。主仓 node_modules 里是 vitest 4.1.8。
- 注意：`server/node_modules/` 同时是 vite 的默认 `cacheDir`，跑服务端测试会通过符号链接把 `.vite` 缓存写进主仓那个目录（良性，可再生）。
- `--no-optional-locks` 是 **git 级**选项，必须写在子命令**之前**：`git --no-optional-locks status`，不是 `git status --no-optional-locks`。

### git 写操作协议（本仓库特有，强制）

```bash
bash tmp/gitlock-guard.sh && git add <明确文件列表> && git commit -m "..."
```

- **`bash tmp/gitlock-guard.sh` 清孤儿锁**：WorkBuddy 沙箱拒绝 `file-write-unlink`，git 建锁成功但清锁被拒 → 锁永久残留，后续写操作连环失败。
- **Bash 调用设 `dangerouslyDisableSandbox: true`**（提权以允许 unlink）。
- 清**四类**锁：`<worktree-gitdir>/{index,ORIG_HEAD,HEAD}.lock` + `<common-gitdir>/refs/**/*.lock`，删前 `lsof` 确认无持有者。
- **禁止 `git add -A` / `git add .`**（工作区有 `.workbuddy-ai/`、`node_modules` 等不该提交的未跟踪目录），只 add 明确文件。
- 只读查询用 `git --no-optional-locks status`（`--no-optional-locks` 是 **git 级**选项，必须写在子命令**之前**）。

> **Xcode 许可阻塞 —— 已随 Xcode 卸载消失（2026-09-23）**
> 曾出现：`xcode-select -p` 指向 `/Applications/Xcode.app/Contents/Developer` 而 Xcode 许可未接受，`/usr/bin/git` 经 `xcrun` 弹出**交互式**许可提示，把整条命令卡死（实测 SIGTERM 终止）。王先生卸载 Xcode 后 `xcode-select` 自动回到 `/Library/Developer/CommandLineTools`，裸 `git` 恢复正常，**不再需要任何前缀**。
> **若将来重装 Xcode 又出现同样症状**，在命令最前面加 `export DEVELOPER_DIR=/Library/Developer/CommandLineTools;` 即可绕过（无需 sudo、不改系统设置）。

## Review Focus

以下五类是 spec 隐含但没有任何任务的测试会覆盖、且最可能伤到真实使用者的输入/状态。每一条都已在下面的任务里指派了归属测试。

1. **引擎与库错配**：切换引擎时若库没跟着切（或切换中途失败回滚），会出现"A 引擎编码 query、B 库参与比较"。**不报错，只给错结果**。归属：Task 8。
2. **引擎静默升级**：对端换量化/升驱动/改精度后，库还是旧的。**不报错，分数整体漂移**。归属：Task 7。
3. **库未就绪时发起搜索**：新引擎的库还没建好，此时搜索必须**明确失败**，不能拿上一个引擎的库凑合。归属：Task 9。
4. **建库中途中断**：留下半个库。若 manifest 已写则被认为是完整的。归属：Task 5。
5. **两库维度不同**：引擎 A 用 2048 维、引擎 B 用 Matryoshka 截断到 256 维。当前 `cosineSimilarity` 会用 `Math.min` 静默截断做点乘。归属：Task 1。

---

## 一、设计思路（第一性原理）

### 1.1 先问：我们真正需要的不变量是什么？

不是"所有引擎产出一致的向量"，而是：

> **参与比较的两个向量，必须来自同一个空间。**

这两句话的区别是决定性的。前者是**跨系统的全局约束**；后者是**局部约束**。

### 1.2 为什么"全局约束"脆弱

要让全局约束成立，N 个系统必须在以下每一项上长期保持一致：

模型权重 · 权重精度 · 运行时与版本 · 注意力实现路径 · 图像预处理实现 · 库版本 · 量化位宽

- **任何一项发生单点变更，约束即被打破**（对端升级、换量化、装上一个加速库）
- **打破时不会报错**——本轮实测：同一模型、同一文本，仅输入格式不同，余弦从 0.9976 掉到 0.8870，而参照系里"两个同义句"的余弦只有 0.8206
- 维护责任**分散在 N 个系统**上，且需要**持续的外部维护**

结论：v2 的一致性不是鲁棒性，是**鲁棒性的假象**。它的失效不是"可能发生"，是"迟早发生"。

### 1.3 为什么"局部约束"鲁棒

每个引擎只与**自己构建的库**配对，于是：

- 要求从"跨系统一致"降级为"引擎自洽"——**更容易成立**
- 自洽性**可以在本地被验证**（引擎编码固定探针 vs 库里的探针向量）
- 任何引擎独立升级都**不影响其他引擎**——**故障域被隔离在单个引擎内**
- 升级后自洽校验失败 → 只影响该引擎 → 重建该引擎的库即可，其他引擎照常工作

### 1.4 这次转变的实质

**从「强一致性 + 弱隔离」→「弱一致性 + 强隔离」。**

| | v2（共享库） | v3（每引擎一库） |
|---|---|---|
| 需要成立的要求 | 跨 N 个系统全局一致 | 单引擎自洽 |
| 要求的可验证性 | 需跨机比对，难以持续 | 本地可验证 |
| 单点升级的影响面 | **全局失效**（静默） | 仅该引擎，且能被检测 |
| 存储 | 1 份 | N 份 |
| 建库 | 1 次 | N 次 |
| 换引擎后的结果 | 应当相同 | **不同（不可比）** |

代价是明确的：存储与构建成本 ×N，且"换引擎 = 换结果"。收益是故障域隔离——**用可度量的资源成本，换不可度量的静默失效风险**。

### 1.5 一个额外收益：跨引擎一致从"必须"降级为"可选优化"

既然不再要求全局一致，那么"两个引擎恰好空间一致"这件事就变成**可选的存储优化**（可共享一份库以省空间），而不是**前置约束**。探测手段不变（用同一个探针比对两个引擎的输出），但失败不再阻断系统，只是不做优化。这让设计严格更通用。

---

## 二、关键改动点

| # | 改动 | 现状 | 目标 | 证据位置 |
|---|---|---|---|---|
| **1** | **服务端表主键** | `question_id TEXT PRIMARY KEY` —— **每题只能存一份向量** | `PRIMARY KEY (engine_id, question_id)` | `server/src/db/schema.ts:279-285` |
| **2** | 服务端向量下发 | `WHERE model = ?` + 硬编码 `MODEL_TAG` | `WHERE engine_id = ?` | `server/src/routes/embed.ts:71-81` |
| **3** | 建库脚本 | `MODEL_TAG` 写死，无引擎概念 | `--engine-id` 参数，写入 `engine_id` | `server/embed/build_index.py:11,55-59` |
| **4** | 客户端库存储 | 单一 store `embeddings` | 每引擎一个 store `embeddings__<engineId>`（**物理隔离**） | `src/data/embeddings.ts:8-13` |
| **5** | 语料抽象 | 全局单例 `getAllVectors()` | `VectorStoreRegistry` + `StoreManifest` | `src/data/embeddings.ts:25-32` |
| **6** | 对齐闸门语义 | 跨引擎比对基准库 | **引擎 vs 自己的库**自洽校验 | `docs/plans/2026-09-22-…md` §6 |
| **7** | 阈值分桶键 | 全局 `SEMANTIC_MIN_SCORE` | 按 `engineId` 分桶 | `src/ui/question-core.ts:145` |
| **8** | 切换单元 | 无（只有单个端点） | `EngineBinding`（引擎+库+状态）原子替换 | 新增 |
| **9** | 相似度函数 | `Math.min(a.length, b.length)` **静默截断** | dim 不等即返回 `null` | `src/services/semantic.ts:10` |
| **10** | 语料刷新 | 先 `clear()` 再逐条 `set()`，**期间为空** | 版本化写入 + manifest 最后提交 | `src/data/embeddings.ts:18-21` |

> **第 1 项是整个重构的地基。** 现有 schema 把 `question_id` 设为主键，这个选择本身就编码了"单一共享空间"的假设——每题只可能有一份向量。不改成复合主键，多库架构在服务端就**存不下**。

---

## 三、向量库与引擎的绑定机制

"绑定"不能靠约定，必须**三层落实**，每一层都能独立拦住一种错配：

### L1 数据层：物理隔离

每个引擎一个独立的 IndexedDB store：

```ts
localforage.createInstance({ name: 'questionBank', storeName: `embeddings__${engineId}` })
```

**为什么用物理隔离而不是在同一个 store 里加 `engineId` 前缀字段**：物理隔离让"读错库"在结构上不可能发生——取错 store 名会得到空结果，而不是静默读到别的引擎的向量。逻辑隔离只能靠代码自律，而这里恰恰是最需要结构性保障的地方。

### L2 元数据层：`StoreManifest`（库的身份证）

```ts
interface StoreManifest {
  engineId: string;
  engineFingerprint: string;   // 引擎自报指纹：模型哈希 + 运行时 + 精度 + 量化 + 关键库版本
  spaceKey: string;            // 引擎自述空间：model:precision:dim:normalize:modalities
  dim: number;
  normalize: 'l2' | 'none';
  itemCount: number;
  sourceHash: string;          // 建库时题库内容哈希 → 判断是否需要增量重建
  probeText: string;           // 固定探针文本（默认「计算三角形的面积」）
  probeVector: number[];       // 建库时该引擎对探针的输出 → 自洽校验锚点
  builtAt: string;
  builtBy: string;             // 引擎 id + 版本
}
```

`probeVector` 是整个机制的支点：它是**建库那一刻该引擎的真实输出**。运行期重算同一个探针，就能判断"现在这个引擎还是不是当初建库的那个引擎"。

> **前置工作**：引擎的 `/health` 需要返回可哈希的指纹（模型路径哈希、torch/transformers 版本、精度、量化、device）。若引擎不提供，`engineFingerprint` 只能退化为"用户声明的 engineId"，此时**失去漂移检测能力**——所以推动编码服务暴露 `/health` 指纹是本重构的硬前置，已列入 Task 4。

### L3 运行时层：自洽校验

每次绑定/切换时执行：

```
probe = engine.encode(manifest.probeText)
cos(probe, manifest.probeVector)
  ≥ 0.99  → state = 'ready'
  <  0.99 → state = 'stale'（引擎已漂移，需重建该引擎的库）
```

这是**唯一**能发现"引擎静默升级"的手段。前两层都是静态的，只有这一层是活的。

### 绑定关系图

```
Engine(engineId=A) ───1:1─── VectorStore(storeName='embeddings__A') ─── StoreManifest(A)
Engine(engineId=B) ───1:1─── VectorStore(storeName='embeddings__B') ─── StoreManifest(B)
```

**约束**：库只能由绑定引擎构建。**禁止把 A 的库复制给 B**——那正是 v2 的强耦合，也是本重构要消除的东西。

---

## 四、切换机制

### 4.1 原子单元

```ts
interface ActiveBinding {
  generation: number;          // 每次切换自增，用于在途请求失效
  engineId: string;
  engine: Engine;
  store: VectorStore | null;
  manifest: StoreManifest | null;
  state: StoreState;           // 'absent' | 'building' | 'ready' | 'stale' | 'corrupt'
}
```

**原子性怎么保证**：整个 `ActiveBinding` 作为**单一引用**替换，不逐字段赋值。逐字段赋值会产生"A 引擎 + B 库"的中间态——那正是 Review Focus 第 1 条。

`generation` 把现有 UI 层的 `_semanticToken`（`src/ui/question-core.ts:136`）语义**下沉到模块层**：在途请求完成时比对 generation，不符则丢弃。

### 4.2 切换流程

```
switchTo(engineId):
  1. engine = registry.get(engineId)
  2. health = await engine.probe(signal)          // 可达性 + 指纹
     health 失败 → state='absent'（引擎不可达）
  3. manifest = await store.loadManifest(engineId)
     无 manifest        → state='absent'   （需建库）
     manifest 指纹不符   → state='stale'    （引擎已升级）
     正常               → 继续
  4. probe = await engine.encode(manifest.probeText)
     cos(probe, manifest.probeVector) ≥ 0.99 → state='ready'
     否则                                    → state='stale'
  5. 原子提交：active = { generation: gen+1, engineId, engine, store, manifest, state }
  6. state !== 'ready' → 后台触发 buildStore(engineId)，期间 search 返回 degraded
```

### 4.3 三种非 ready 状态的语义（必须区分，不能合并）

| state | 含义 | 用户可见行为 |
|---|---|---|
| `absent` | 引擎可达但库从未建过 | "该引擎尚未建库，预计 X 分钟"；后台建库；**可继续用旧引擎** |
| `stale` | 库存在，但引擎已漂移 | "该引擎已升级，向量库需重建"；后台重建 |
| `corrupt` | manifest 与库内容不一致（半库） | "向量库损坏，需重建" |

**关键**：`absent` / `stale` 都**不得降级使用旧库**。宁可没有语义结果（I6 显式降级），不可给错结果。

### 4.4 库就绪是"找相似题"的充要条件

| 场景 | 找相似题（纯本地） | 文字/图片搜 |
|---|---|---|
| 库 `ready` + 引擎可达 | 可用 | 可用 |
| 库 `ready` + 引擎离线 | **可用**（只需库） | 不可用（需编码 query） |
| 库 `absent`/`stale` | 不可用 | 不可用 |

> 相对 v2 的能力退步：v2 里库是共享的，找相似题永远可用；v3 里库没就绪就不可用。**这是隔离的代价，必须明说。**

---

## 五、约束条件

### A. 硬约束（违反 = 结果错，必须由代码强制）

| # | 约束 | 强制点 |
|---|---|---|
| A1 | **禁止跨引擎复制库**，库必须由绑定引擎自己构建 | 建库脚本只接受 `--engine-id` 指向的引擎 |
| A2 | 库必须携带 manifest；无 manifest 视为无效 | `loadManifest()` 返回 null 即 `absent` |
| A3 | **引擎与库必须原子切换**，禁止中间态 | 单一 `ActiveBinding` 引用替换 + generation |
| A4 | dim 不匹配必须**硬失败**，不得截断 | `cosineSimilarity` 改签名（Task 1） |
| A5 | 自洽校验不通过 → 标 `stale`，**拒绝服务** | `conformance.ts` 返回非 ready 即阻断 |
| A6 | 阈值必须与 `engineId` 绑定，新引擎必须单独校准 | `minScoreByEngine: Record<string, number>` |
| A7 | manifest **最后写入**（两阶段提交） | 先写向量、后写 manifest；中断则无 manifest → `absent` |

### B. 软约束（违反 = 体验退化，需 UI/流程配合）

| # | 约束 |
|---|---|
| B1 | UI 必须显示当前引擎（否则用户无法解释结果变化） |
| B2 | 不得跨引擎比较分数或结果集 |
| B3 | 建库必须后台执行 + 进度可见 + 可取消 |
| B4 | 题库变更后需标记各库"待同步"并提示（`sourceHash` 比对） |
| B5 | 引擎列表变化（新增/下线）需刷新 registry 与设置页 |

### C. 必须接受的代价（否则设计与目标自相矛盾）

| # | 代价 | 量级 | 缓解 |
|---|---|---|---|
| C1 | 存储 = N × 单库 | 91 题 ≈ 720KB/库；5000 题 ≈ 40MB/库 | LRU 淘汰 + 容量预算，只保留活跃引擎的库 |
| C2 | 建库 = N × 时间 | 实测 91 题 227s（MPS）→ 2000 题 ≈ 83 分钟/引擎 | 后台建库 + 增量 diff（`build_index.py` 已有）+ 切换前预告 |
| C3 | 换引擎 = 换结果（不可比） | — | UI 明示引擎 + 不跨引擎比较 |
| C4 | 库未就绪时语义能力整体不可用 | — | 后台建库期间可继续用旧引擎 |

---

## 六、对抗性审查（新架构特有的失效场景）

| # | 攻击场景 | 后果 | 对策 |
|---|---|---|---|
| **A12** | **库引擎错配**：切引擎但库没跟着切 / 切换中途失败回滚 | A 引擎编码 + B 库比较，**不报错，全错** | 单一 `ActiveBinding` 原子替换 + generation + 每次切换必跑自洽校验（Task 8） |
| **A13** | **引擎静默升级**：换量化/升驱动/改精度 | 分数整体漂移，无报错 | L3 自洽校验（Task 7）；`/health` 指纹（Task 4） |
| **A14** | **存储膨胀**：N 引擎 × 大题库 | 磁盘占满 | LRU + 容量预算（Task 6 的 `evict()`） |
| **A15** | **建库等待不可接受**：切到没建过库的引擎要等 83 分钟 | 用户以为卡死 | 切换前**预告预计时长** + 后台建库 + 期间可继续用旧引擎（Task 9） |
| **A16** | **多库不同步**：新增 1 题需 N 个库都更新 | 各库条目数不一致 | `sourceHash` 比对 + "待同步"标记 + 增量更新 |
| **A17** | **结果跳变**：换引擎后同一查询给出不同 top-6 | 用户困惑，以为有 bug | UI 明示当前引擎；不跨引擎比较（B1/B2） |
| **A18** | **半库**：建库中断留下不完整的库 | 用不完整的库检索，漏结果 | 两阶段提交，manifest 最后写（A7，Task 5） |
| **A19** | **阈值沿用**：换引擎沿用旧 `minScore` | 全滤或全放（历史事故：0.35 过高） | 阈值按 `engineId` 分桶（A6） |
| **A20** | **`assignIfMissing` 双实现陷阱** | 新模块 TS 实现运行时永不生效，测试却全绿 | 走 `assignToWindow`（Global Constraints） |

**A12 / A13 / A18 是本架构新引入的风险**（v2 里不存在，因为只有一个库）；**A19 / A20 是既有坑在新场景下的重现**。

---

## 七、文件结构

**新增（客户端）**

| 文件 | 职责 |
|---|---|
| `src/services/semantic/types.ts` | `SpaceKey` / `EngineId` / `StoreManifest` / `StoreState` / `ActiveBinding` / `VectorIndex` / `SearchRequest` / `SearchResult` |
| `src/services/semantic/invariants.ts` | `cosineSimilarity`（dim 硬失败）、`makeSpaceKey`、`decodeVector` |
| `src/services/semantic/manifest.ts` | manifest 读写 + 两阶段提交 |
| `src/services/semantic/vector-store.ts` | `LocalVectorStore`：物理隔离的 per-engine 库 |
| `src/services/semantic/registry.ts` | `VectorStoreRegistry`：engineId → VectorStore，显式 `remove()` |
| `src/services/semantic/storage.ts` | 容量观测（`estimateStorage` / `ensurePersistent`），**不做淘汰** |
| `src/services/semantic/flat-index.ts` | **`FlatVectorIndex`：整库常驻内存 + 批量点乘（D5）** |
| `src/services/semantic/conformance.ts` | 自洽校验（引擎 vs 自己的库） |
| `src/services/semantic/binding.ts` | `EngineBinding`：原子切换 + generation + 构建 index |
| `src/services/semantic/router.ts` | L0 闸门 + 显式降级 + 内联建库提示 + `estimateBuildMinutes` |
| `src/services/semantic/service.ts` | `SemanticService` 门面 |
| `src/services/semantic/index.ts` | 只导出门面与类型 |
| `unit-tests/helpers/fake-localforage.js` | 内存版 localforage 桩（Task 1 建，Task 5/6/9/10 依赖） |

**修改**

| 文件 | 改动 |
|---|---|
| `src/services/semantic.ts` | `cosineSimilarity` 改 dim 硬失败；其余函数迁入 `semantic/` |
| `src/services/semantic-search.ts` | 改为经门面调用 |
| `src/services/index.ts` | 追加导出 `./semantic` |
| `src/data/embeddings.ts` | 迁为 `semantic/vector-store.ts` 的实现，`src/data/embeddings.ts` 保留薄转发 |
| `src/ui/question-core.ts` | 阈值改按 engineId 取；搜索经门面 |
| `src/ui/question-detail.ts` | `showSimilarQuestions` 收编为 `service.searchSimilar()` |
| `src/init-app.ts` | 初始化时绑定默认引擎 + 刷新当前引擎的库 |
| `src/main.ts` | 新模块加入 `assignToWindow()` 列表 |
| `server/src/db/schema.ts` | `question_embeddings` 主键改 `(engine_id, question_id)` + 迁移 |
| `server/src/routes/embed.ts` | `/vectors` 按 `engine_id` 查；新增 `/engines` |
| `server/embed/build_index.py` | 支持 `--engine-id`；写 `engine_id` |

**测试**

| 文件 | 覆盖 |
|---|---|
| `unit-tests/semantic-invariants.spec.js` | dim 硬失败、spaceKey 确定性 |
| `unit-tests/semantic-manifest.spec.js` | 两阶段提交、半库识别 |
| `unit-tests/semantic-binding.spec.js` | 原子切换、generation 失效、错配不可达 |
| `unit-tests/semantic-conformance.spec.js` | 自洽校验通过/失败/漂移 |
| `tests/engine-switch.spec.js` | E2E：切换引擎后结果与库同步切换 |

---

## 八、任务分解

### Task 1: 相似度硬失败 + 空间键 + 测试桩

**Files:**
- Create: `src/services/semantic/types.ts`
- Create: `src/services/semantic/invariants.ts`
- Create: `unit-tests/helpers/fake-localforage.js`
- Test: `unit-tests/semantic-invariants.spec.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type SpaceKey = string`
  - `makeSpaceKey(p: { model: string; precision: string; dim: number; normalize: 'l2' | 'none'; modalities: string[] }): SpaceKey`
  - `cosineSimilarity(a: Float32Array, b: Float32Array): number | null` —— **dim 不等返回 `null`**
  - `decodeVector(b64: string): Float32Array`
  - `installFakeLocalforage(): Map<string, Map<string, unknown>>` —— 共享测试桩，Task 5/6/9/10 依赖

- [ ] **Step 0: 建共享测试桩（后续任务依赖，必须先做）**

**为什么需要**：vitest 环境里 `localforage` **不是全局的**，且本项目有实测踩坑记录——`unit-tests/embeddings-lazy.spec.js:3-13` 明确写了"任何 import 本模块的测试都得先装 localforage 桩"。Task 5/6/9/10 的模块都会调 `localforage.createInstance`，必须各自打桩。这里建一个带真实读写语义的内存实现（不是 `vi.fn()` 空壳，否则 `iterate`/`count` 的断言无法成立）。

`unit-tests/helpers/fake-localforage.js`：

```javascript
import { vi } from 'vitest';

const stores = new Map();

function makeStore(storeName) {
  if (!stores.has(storeName)) stores.set(storeName, new Map());
  const m = stores.get(storeName);
  return {
    async setItem(k, v) { m.set(k, v); },
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async removeItem(k) { m.delete(k); },
    async clear() { m.clear(); },
    async length() { return m.size; },
    async iterate(cb) { for (const [k, v] of [...m.entries()]) cb(v, k); },
  };
}

export function installFakeLocalforage() {
  stores.clear();
  vi.stubGlobal('localforage', { createInstance: ({ storeName }) => makeStore(storeName) });
  return stores;
}
```

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, makeSpaceKey } from '../src/services/semantic/invariants.ts';

describe('cosineSimilarity', () => {
  it('同维向量返回余弦', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('维度不等返回 null，而不是静默截断', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeNull();
  });

  it('零向量返回 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('makeSpaceKey', () => {
  it('同配置两次构造结果相同', () => {
    const p = { model: 'wemm-embedding-2b', precision: 'bf16', dim: 2048, normalize: 'l2', modalities: ['text', 'image'] };
    expect(makeSpaceKey(p)).toBe(makeSpaceKey(p));
  });

  it('模态顺序不影响结果', () => {
    const base = { model: 'm', precision: 'bf16', dim: 2048, normalize: 'l2' };
    expect(makeSpaceKey({ ...base, modalities: ['text', 'image'] }))
      .toBe(makeSpaceKey({ ...base, modalities: ['image', 'text'] }));
  });

  it('维度不同则键不同', () => {
    const base = { model: 'm', precision: 'bf16', normalize: 'l2', modalities: ['text'] };
    expect(makeSpaceKey({ ...base, dim: 2048 })).not.toBe(makeSpaceKey({ ...base, dim: 256 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-invariants.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/invariants.ts"`

- [ ] **Step 3: Write minimal implementation**

`src/services/semantic/types.ts`:

```typescript
export type SpaceKey = string;
export type EngineId = string;

export type Modality = 'text' | 'image';

export type StoreState = 'absent' | 'building' | 'ready' | 'stale' | 'corrupt';

export interface StoreManifest {
  engineId: EngineId;
  engineFingerprint: string;
  spaceKey: SpaceKey;
  dim: number;
  normalize: 'l2' | 'none';
  itemCount: number;
  sourceHash: string;
  probeText: string;
  probeVector: number[];
  builtAt: string;
  builtBy: string;
}

export interface VectorIndex {
  readonly size: number;
  readonly bytes: number;
  get(id: string): Float32Array | null;
  rank(q: Float32Array, topK: number, minScore: number): { id: string; score: number }[];
}

export interface ActiveBinding {
  generation: number;
  engineId: EngineId;
  engine: Engine;
  store: VectorStore | null;
  manifest: StoreManifest | null;
  index: VectorIndex | null;
  state: StoreState;
}

export interface Engine {
  readonly id: EngineId;
  readonly fingerprint: string;
  readonly modalities: Modality[];
  probe(signal?: AbortSignal): Promise<{ ok: boolean; fingerprint: string }>;
  encode(input: { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string }, signal?: AbortSignal): Promise<Float32Array>;
}

export interface VectorStore {
  readonly engineId: EngineId;
  loadManifest(): Promise<StoreManifest | null>;
  putVector(id: string, v: Float32Array): Promise<void>;
  getVector(id: string): Promise<Float32Array | null>;
  iterate(cb: (id: string, v: Float32Array) => void): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
  writeManifest(m: StoreManifest): Promise<void>;
}

export interface Hit { id: string; score: number; source: EngineId }

export interface DegradeInfo { reason: 'no-engine' | 'store-absent' | 'store-stale' | 'store-corrupt' | 'encode-failed'; detail?: string }

export interface SearchRequest {
  query: { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string };
  topK?: number;
  minScore?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  engineId?: EngineId;
}

export interface SearchResult {
  hits: Hit[];
  spaceKey: SpaceKey;
  engineId: EngineId;
  modality: Modality;
  degraded: DegradeInfo | null;
  timings: { probeMs: number; encodeMs: number; rankMs: number };
}
```

`src/services/semantic/invariants.ts`:

```typescript
import type { SpaceKey } from './types';

export function decodeVector(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number | null {
  if (a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function makeSpaceKey(p: {
  model: string;
  precision: string;
  dim: number;
  normalize: 'l2' | 'none';
  modalities: string[];
}): SpaceKey {
  return `${p.model}:${p.precision}:${p.dim}:${p.normalize}:${[...p.modalities].sort().join('+')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-invariants.spec.js`
Expected: PASS — 6 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/types.ts src/services/semantic/invariants.ts unit-tests/semantic-invariants.spec.js
git commit -m "feat(semantic): cosineSimilarity 维度不等硬失败 + spaceKey 构造"
```

---

### Task 2: 服务端表改复合主键（地基）

**Files:**
- Modify: `server/src/db/schema.ts:279-285`
- Test: `server/test/embeddings-schema.test.ts`（**目录是单数 `test/`**；服务端配置 `server/vitest.config.ts` 的 include 为 `test/**/*.test.ts`，运行方式 `cd server && NODE_OPTIONS= ./node_modules/.bin/vitest run`）

**Interfaces:**
- Consumes: 无
- Produces: 表 `question_embeddings` 主键为 `(engine_id, question_id)`；索引 `idx_embeddings_engine(engine_id)`；`export function ensureEmbeddingsTable(database: Database.Database): void`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureEmbeddingsTable } from '../src/db/schema.js';

describe('question_embeddings 复合主键', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE questions (id TEXT PRIMARY KEY, question_image_url TEXT, deleted_at TEXT)');
    ensureEmbeddingsTable(db);
  });

  it('同一题可为两个引擎各存一份向量', () => {
    db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)')
      .run('mac', 'q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)')
      .run('linux', 'q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    const n = db.prepare('SELECT COUNT(*) AS c FROM question_embeddings WHERE question_id = ?').get('q-001') as { c: number };
    expect(n.c).toBe(2);
  });

  it('同引擎同题重复写入被主键拒绝', () => {
    const ins = db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)');
    ins.run('mac', 'q-001', 'm', 2048, Buffer.alloc(8192));
    expect(() => ins.run('mac', 'q-001', 'm', 2048, Buffer.alloc(8192))).toThrow(/UNIQUE/);
  });
});

describe('旧库迁移（复现并守护顺序缺陷）', () => {
  const LEGACY_DDL = `CREATE TABLE question_embeddings (
    question_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`;

  function legacyDb() {
    const d = new Database(':memory:');
    d.exec(LEGACY_DDL);
    d.prepare('INSERT INTO question_embeddings (question_id, model, dim, vector) VALUES (?,?,?,?)')
      .run('q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    return d;
  }

  it('旧库（无 engine_id 列）迁移不抛异常 —— 建索引必须在迁移之后', () => {
    const d = legacyDb();
    expect(() => ensureEmbeddingsTable(d)).not.toThrow();
  });

  it('旧行全部归入 legacy-default，向量逐字节不变', () => {
    const d = legacyDb();
    const before = d.prepare('SELECT vector FROM question_embeddings WHERE question_id = ?').get('q-001') as { vector: Buffer };
    ensureEmbeddingsTable(d);
    const rows = d.prepare('SELECT engine_id, question_id, vector FROM question_embeddings').all() as { engine_id: string; question_id: string; vector: Buffer }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].engine_id).toBe('legacy-default');
    expect(Buffer.compare(rows[0].vector, before.vector)).toBe(0);
  });

  it('迁移后索引存在，且无 _old 残留表', () => {
    const d = legacyDb();
    ensureEmbeddingsTable(d);
    expect(d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_embeddings_engine'").all()).toHaveLength(1);
    expect(d.prepare("SELECT name FROM sqlite_master WHERE name='question_embeddings_old'").all()).toHaveLength(0);
  });

  it('重复执行幂等', () => {
    const d = legacyDb();
    ensureEmbeddingsTable(d);
    expect(() => ensureEmbeddingsTable(d)).not.toThrow();
    const n = d.prepare('SELECT COUNT(*) AS c FROM question_embeddings').get() as { c: number };
    expect(n.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && NODE_OPTIONS= ../node_modules/.bin/vitest run test/embeddings-schema.test.ts`
Expected: FAIL — `ensureEmbeddingsTable is not a function`，且插入报 `table question_embeddings has no column named engine_id`

- [ ] **Step 3: Write minimal implementation**

把 `server/src/db/schema.ts:279-285` 的内联 `db.exec` 抽成可测试函数，并改主键：

```typescript
function createEmbeddingsTableIfMissing(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS question_embeddings (
    engine_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (engine_id, question_id)
  )`);
}

function ensureEmbeddingsIndex(database: Database.Database): void {
  database.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_engine ON question_embeddings(engine_id)`);
}

export function ensureEmbeddingsTable(database: Database.Database): void {
  createEmbeddingsTableIfMissing(database);
  migrateEmbeddingsToCompositeKey(database);
  ensureEmbeddingsIndex(database);
}

function migrateEmbeddingsToCompositeKey(database: Database.Database): void {
  const cols = database.prepare('PRAGMA table_info(question_embeddings)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'engine_id')) return;
  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE question_embeddings RENAME TO question_embeddings_old');
    createEmbeddingsTableIfMissing(database);
    database.exec(`INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector, updated_at)
                   SELECT 'legacy-default', question_id, model, dim, vector, updated_at FROM question_embeddings_old`);
    database.exec('DROP TABLE question_embeddings_old');
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}
```

> **⚠️ 部署顺序前置条件（Task 2 评审发现，2026-09-23）**
> 本迁移一旦落到**生产库**，`server/embed/build_index.py:57` 的 `INSERT OR REPLACE INTO question_embeddings (question_id, model, dim, vector, updated_at)` 会立刻失败——它不写 `engine_id`，而新表该列是 `NOT NULL`（失败是**响亮的** `NOT NULL constraint failed`，不是静默污染）。同文件 `:22` 的 `CREATE TABLE IF NOT EXISTS` 在已迁移的库上是静默 no-op，帮不上忙。
> 同时 `server/embed/calibrate_threshold.py:28` 与 `server/src/routes/embed.ts:73` 仍按 `WHERE model = ?` 读，会把 `legacy-default` 与真实引擎的向量**混在一起**。
> **硬要求：本迁移不得早于 Task 3（建库脚本支持 `--engine-id`）与 Task 4（按引擎下发）部署到生产。** 这是部署顺序约束，不是代码缺陷——本地开发与测试不受影响（`server/data.db` 在本 worktree 不存在）。
>
> **⚠️ 事务回滚（Task 2 评审 Important 项，已采纳）**
> 初稿的 `BEGIN`…`COMMIT` 无 `try/catch` + `ROLLBACK`。当前调用点是模块加载，抛异常会终止进程、由 SQLite journal 恢复兜底，所以现在不致命；但 `ensureEmbeddingsTable` 是**导出函数**、且这个函数会随 schema 演进被反复调用——一旦将来在长连接上被会捕获异常的调用方调用，悬挂事务会阻塞后续所有写入且失败信息不可读。已补 `ROLLBACK` 并重新抛出。

> **⚠️ 顺序缺陷修正（2026-09-23，Task 2 实现者在真实库副本演练中发现）**
> 本计划初稿把建索引放在「建表」步骤里，与建表同一个函数。这在**旧库**上会直接崩：
> 旧库已有 `question_embeddings` 表但没有 `engine_id` 列 → `CREATE TABLE IF NOT EXISTS` 是**静默 no-op** → 紧接着的 `CREATE INDEX ... ON question_embeddings(engine_id)` **抛 `no such column: engine_id`**，异常先于迁移抛出，**迁移代码一行都执行不到**。
> 而「旧库 + 无 engine_id 列」恰好是迁移存在的**唯一理由**；新库完全不受影响。所以初稿的单测（表完全不存在）100% 绿，**结构上测不出这个缺陷**。
> **正确顺序：建表（if missing）→ 迁移 → 建索引。** 建索引必须放在迁移之后。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && NODE_OPTIONS= ../node_modules/.bin/vitest run test/embeddings-schema.test.ts`
Expected: PASS — 6 tests passed（其中 4 条守护旧库迁移的顺序缺陷）

- [ ] **Step 5: 迁移演练（真实旧库结构副本，全程只动 tmp/）**

本 worktree **没有 `server/data.db`**（生产库在主仓/服务器上），所以用等价演练：造一个**旧结构**的库（旧 DDL + 若干真实行），跑生产代码路径迁移，逐字节比对。

```bash
cd server && NODE_OPTIONS= ../node_modules/.bin/vitest run test/embeddings-schema.test.ts -t "旧库迁移"
```
Expected: 4 条全绿 —— ①不抛异常 ②旧行全部归 `legacy-default` 且向量**逐字节不变** ③`idx_embeddings_engine` 存在且无 `question_embeddings_old` 残留 ④重复执行幂等

> **生产库的真实演练由用户在服务器上执行**（本次重构不触碰生产库）。届时先 `cp` 一份副本再跑。
> 注意：`server/data.db` 不存在时**不要**去创建或连接生产库路径。

- [ ] **Step 6: Commit**

```bash
bash tmp/gitlock-guard.sh && git add server/src/db/schema.ts server/test/embeddings-schema.test.ts && git commit -m "feat(server): question_embeddings 改复合主键 (engine_id, question_id) + 非破坏迁移"
```
（`git add` 用明确路径；路径是 `server/test/`（单数）。提权执行见 Global Constraints 的 git 协议。）

---

### Task 3: 建库脚本支持 --engine-id

**Files:**
- Modify: `server/embed/build_index.py:11,17,30-40,55-62`
- Test: `server/embed/tests/test_build_index.py`

**Interfaces:**
- Consumes: Task 2 的表结构
- Produces: CLI `python build_index.py <db_path> --engine-id <id> [--force]`

- [ ] **Step 1: Write the failing test**

```python
import sqlite3
import build_index

def _db():
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE question_embeddings (
        engine_id TEXT NOT NULL, question_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, vector BLOB NOT NULL, updated_at TEXT,
        PRIMARY KEY (engine_id, question_id))""")
    return conn

def test_pending_rows_只返回该引擎缺失的题目():
    conn = _db()
    conn.execute("INSERT INTO question_embeddings VALUES ('mac','q-1','m',4,x'00','')")
    all_rows = [("q-1",), ("q-2",)]
    pending = build_index.pending_rows(conn, all_rows, "linux")
    assert pending == [("q-1",), ("q-2",)]

def test_pending_rows_不同引擎互不干扰():
    conn = _db()
    conn.execute("INSERT INTO question_embeddings VALUES ('mac','q-1','m',4,x'00','')")
    all_rows = [("q-1",)]
    assert build_index.pending_rows(conn, all_rows, "mac") == []
```

> **⚠️ 断言笔误修正（2026-09-23，Task 3 实现者发现）**
> 初稿测试 1 的断言写成 `assert pending == [("q-2",)]`，与实现（`WHERE engine_id = ?`）**数学上不可同时成立**：向引擎 `linux` 查询时，库里只有 `mac` 的 `q-1`，`linux` 视角下 `q-1` 与 `q-2` **都缺**，所以正确断言是 `[("q-1",), ("q-2",)]`。
> `[("q-2",)]` 对应的是**全局去重**语义（任一引擎有过就跳过），那会让"库与引擎一一绑定"退化——某引擎从没建过库，却因为别的引擎建过而被跳过，结果该引擎的库永远空着。
> **正确语义：pending 只在该引擎范围内判断。** 这也正是 Task 3 存在的理由。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/embed && PYTHONPATH= ~/.workbuddy/binaries/python/envs/default/bin/python -m pytest tests/test_build_index.py -v`
Expected: FAIL — `module 'build_index' has no attribute 'pending_rows'`

- [ ] **Step 3: Write minimal implementation**

在 `build_index.py` 抽出 diff 逻辑并加参数：

```python
def pending_rows(conn, all_rows, engine_id):
    existing = {r[0] for r in conn.execute(
        "SELECT question_id FROM question_embeddings WHERE engine_id = ?", (engine_id,)
    ).fetchall()}
    return [r for r in all_rows if r[0] not in existing]
```

`main()` 签名改为 `main(db_path, model_path, engine_id, force=False)`，建表语句改为带 `engine_id` 的复合主键版本，写入语句改为：

```python
conn.execute(
    "INSERT OR REPLACE INTO question_embeddings (engine_id, question_id, model, dim, vector, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    (engine_id, qid, MODEL_TAG, int(vec.shape[0]), np.asarray(vec, dtype=np.float32).tobytes()),
)
```

`__main__` 段解析 `--engine-id`，缺失则报错退出（**不允许默认值**，避免误建到错误引擎名下）：

```python
engine_id = None
for i, a in enumerate(sys.argv):
    if a == "--engine-id" and i + 1 < len(sys.argv):
        engine_id = sys.argv[i + 1]
if not engine_id:
    print("必须指定 --engine-id（库与引擎一一绑定，不允许默认）")
    sys.exit(2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/embed && PYTHONPATH= ~/.workbuddy/binaries/python/envs/default/bin/python -m pytest tests/test_build_index.py -v`
Expected: PASS — 2 passed

- [ ] **Step 5: Commit**

```bash
git add server/embed/build_index.py server/embed/tests/test_build_index.py
git commit -m "feat(embed): build_index 支持 --engine-id，库按引擎隔离"
```

---

### Task 4: 服务端按引擎下发 + 引擎列表与指纹

**Files:**
- Modify: `server/src/routes/embed.ts:8-9,71-81`
- Modify: `server/embed/embed_service.py`（`health()` 补指纹字段）
- Modify: `server/embed/calibrate_threshold.py:28`（**Task 3 评审发现的计划漏洞**：该行 `SELECT question_id, dim, vector FROM question_embeddings WHERE model = ?` 无 `engine_id` 过滤，表里一旦有两个引擎就会**静默混算**、把重复 `question_id` 行错配。必须加 `engine_id` 维度——建议加 `--engine-id` 参数并在 SQL 里 `WHERE engine_id = ?`；阈值本就该按引擎分别校准，这也正好落地计划里"阈值按 spaceKey/engineId 分桶"的要求）
- Modify: `docs/semantic-search-wemm2b.md:58`（**Task 3 评审发现**：该处文档写的建库命令 `build_index.py /path/to/data.db` 在 Task 3 后缺少 `--engine-id` 会直接退出码 2，已过期）
- Test: `server/test/embed-route.test.ts`（**追加到已有文件**，不要新建——该文件已存在且已在测 `validateTexts`，是同一模块的测试归属）

**Interfaces:**
- Consumes: Task 2 的表
- Produces:
  - `GET /api/embed/vectors?engineId=<id>` → `{ engineId, model, count, embeddings: [{ question_id, dim, vector }] }`（缺 `engineId` 返 400；**不过滤 `legacy-default`**——调用方显式指定引擎名，过滤会让迁移数据取不到）
  - `GET /api/embed/engines` → `[{ id, fingerprint, reachable }]`（**排除 `legacy-default`**——它是迁移遗留、不对应任何真实引擎，列出会让客户端出现可选中的伪引擎）
  - `GET /api/embed/health?engineId=<id>` → 扁平 `{ ...health, engineId, fingerprint }`（缺 `engineId` 返 400；编码服务不可达返 503）
  - `buildFingerprint(h: Record<string, unknown>): string`
  - `filterVectorsByEngine(rows, engineId)`
  - `calibrate_threshold.py --engine-id`（required，无默认值）

> **⚠️ 指纹的 `dtype` / `quant` 必须是活的（Task 4 评审 Important，2026-09-23）**
> 初版实现里 `embed_service.py` 的 `DTYPE = str(torch.get_default_dtype())` 是**进程全局默认值**（`float32`，因为该服务从不调 `set_default_dtype`），与模型实际加载精度无关；`quant` 更是从未产出，`buildFingerprint` 永远渲染成 `quant=`。
> 后果：**同一 `MODEL_PATH` 下若发生真实精度变更（改加载精度标志、原地重量化同一个 snapshot 目录），embedding 会变而指纹逐字节不变** —— 客户端继续用陈旧向量，且没有任何漂移信号。这正是指纹存在的意义（对应 A13 引擎静默升级）。
> **要求**：
> - `dtype` 改为反映**模型实际配置精度**：从 snapshot 的 `config.json` 的 `dtype` 字段读取（无需加载权重、跨空闲卸载稳定）。若读 `config.json` 不可行，**说明原因**并给出替代的稳定来源。
> - `quant`：若确实不存在量化概念，**从 `buildFingerprint` 的键列表里删掉**（一个永远为空的键是噪音，还会让人误以为已检测量化）。
> - **不得**改用「读已加载模型实例的 dtype」——空闲卸载后 `_model is None`，会造成加载/未加载两态指纹不同 → 误判漂移 → 客户端无谓重建。

> **⚠️ 部署顺序前置条件 —— 已于 2026-09-23 标记为「已消解」**
> 原本记录两条：① Task 2 的迁移不得早于 Task 3/4 上生产（`build_index.py` 不写 `engine_id` 会 `NOT NULL` 失败）；② `/vectors` 现在强制要求 `engineId`，而客户端 `src/data/embeddings.ts:16` 还没传 → 真机上语义检索会静默降级为字面匹配。
> **王先生确认：本分支在全部任务完成前不会部署，整条分支一起交付。** 因此这两条中间态约束不再需要逐任务传递，也不再是阻塞项。
> **但下面的接口事实必须保留**（将来读代码的人需要知道）：`/vectors` 缺 `engineId` 返 400；`/engines` 排除 `legacy-default`；`/health` 缺 `engineId` 返 400、编码服务不可达返 503。
> 已核查的旁证：`scripts/verify-server-deploy.sh:13-21` 不受影响（它不带 auth 头，`authMiddleware` 在新增的 400 之前先返回 401，仍落在 `401|403)` 分支）。

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterVectorsByEngine, buildFingerprint } from '../src/routes/embed.js';

describe('filterVectorsByEngine', () => {
  it('只返回指定引擎的向量', () => {
    const rows = [
      { engine_id: 'mac', question_id: 'q-1', dim: 4, vector: Buffer.alloc(16) },
      { engine_id: 'linux', question_id: 'q-1', dim: 4, vector: Buffer.alloc(16) },
    ];
    const out = filterVectorsByEngine(rows, 'linux');
    expect(out).toHaveLength(1);
    expect(out[0].question_id).toBe('q-1');
  });
});

describe('buildFingerprint', () => {
  it('相同 health 产出相同指纹', () => {
    const h = { device: 'mps', model_loaded: true, model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).toBe(buildFingerprint({ ...h }));
  });

  it('device 变化则指纹变化', () => {
    const h = { device: 'mps', model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).not.toBe(buildFingerprint({ ...h, device: 'cuda' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && NODE_OPTIONS= ./node_modules/.bin/vitest run test/embed-route.test.ts`
Expected: FAIL — `filterVectorsByEngine is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `server/src/routes/embed.ts` 加两个导出纯函数，并把 `/vectors` 改为按 `engineId` 查：

```typescript
export function filterVectorsByEngine(
  rows: { engine_id: string; question_id: string; dim: number; vector: Buffer }[],
  engineId: string,
) {
  return rows
    .filter((r) => r.engine_id === engineId)
    .map((r) => ({ question_id: r.question_id, dim: r.dim, vector: Buffer.from(r.vector).toString('base64') }));
}

export function buildFingerprint(h: Record<string, unknown>): string {
  const keys = ['model_path', 'device', 'dtype', 'torch', 'transformers'];
  return keys.map((k) => `${k}=${String(h[k] ?? '')}`).join('|');
}
```

> **注（2026-09-23 更新）**：键列表已去掉 `quant`（见上方裁定框）。`dtype` 的来源在 Task 4 修复轮 2 中改为读模型 snapshot 的 `config.json`（带缓存与 `dtype_source` 回退标记），不再是进程全局默认值。上面的代码块是**最终形态**。

`/vectors` 路由改为：

```typescript
router.get('/vectors', (req, res) => {
  const engineId = String(req.query.engineId || '');
  if (!engineId) { res.status(400).json({ error: '缺少 engineId' }); return; }
  const rows = db.prepare(
    'SELECT engine_id, question_id, dim, vector FROM question_embeddings WHERE engine_id = ?'
  ).all(engineId) as { engine_id: string; question_id: string; dim: number; vector: Buffer }[];
  const embeddings = filterVectorsByEngine(rows, engineId);
  res.json({ engineId, model: MODEL_TAG, count: embeddings.length, embeddings });
});
```

`/engines` 与 `/health` 路由：`/engines` 从 `SELECT DISTINCT engine_id` 取本地已知引擎列表；`/health` 转发 `${EMBED_BASE}/health` 并用 `buildFingerprint` 计算指纹。

编码服务 `server/embed/embed_service.py` 的 `health()` 需补返回 `model_path` / `torch` / `transformers` / `dtype` 字段（当前只返回 `device` / `model_loaded` / `idle_unload_seconds`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && NODE_OPTIONS= ./node_modules/.bin/vitest run test/embed-route.test.ts`
Expected: PASS — 5 passed（原有 `validateTexts` 2 条 + 新增 3 条）

- [ ] **Step 5: 真实链路探针（第 2 层验证）**

```bash
curl -s "http://127.0.0.1:3002/health" | python3 -m json.tool
```
Expected: 含 `model_path`、`torch`、`transformers`、`dtype`、`device` —— 指纹所需字段齐备

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/embed.ts server/embed/embed_service.py server/tests/embed-routes.test.ts
git commit -m "feat(server): 向量按 engineId 下发 + 引擎列表与 health 指纹"
```

---

### Task 5: StoreManifest 与两阶段提交

**Files:**
- Create: `src/services/semantic/manifest.ts`
- Test: `unit-tests/semantic-manifest.spec.js`

**Interfaces:**
- Consumes: Task 1 的 `types.ts`
- Produces:
  - `PROBE_TEXT: string` = `'计算三角形的面积'`
  - `readManifest(storeName: string): Promise<StoreManifest | null>`
  - `beginBuild(storeName: string): Promise<void>` —— 清空向量区，删除 manifest
  - `commitBuild(storeName: string, m: StoreManifest): Promise<void>` —— **最后一步**写 manifest

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { readManifest, beginBuild, commitBuild, PROBE_TEXT } from '../src/services/semantic/manifest.ts';

const mkManifest = (over = {}) => ({
  engineId: 'mac', engineFingerprint: 'fp-1',
  spaceKey: 'wemm-embedding-2b:bf16:2048:l2:text+image',
  dim: 2048, normalize: 'l2', itemCount: 91, sourceHash: 'h1',
  probeText: PROBE_TEXT, probeVector: [0.1, 0.2], builtAt: '2026-09-22T00:00:00Z', builtBy: 'mac@1',
  ...over,
});

describe('两阶段提交', () => {
  beforeEach(async () => {
    installFakeLocalforage();
    await beginBuild('embeddings__test');
  });

  it('beginBuild 后、commitBuild 前读不到 manifest（半库被识别为 absent）', async () => {
    expect(await readManifest('embeddings__test')).toBeNull();
  });

  it('commitBuild 后可读到完整 manifest', async () => {
    await commitBuild('embeddings__test', mkManifest());
    const m = await readManifest('embeddings__test');
    expect(m.engineId).toBe('mac');
    expect(m.probeVector).toEqual([0.1, 0.2]);
  });

  it('再次 beginBuild 会清掉旧 manifest', async () => {
    await commitBuild('embeddings__test', mkManifest());
    await beginBuild('embeddings__test');
    expect(await readManifest('embeddings__test')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-manifest.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/manifest.ts"`

- [ ] **Step 3: Write minimal implementation**

```typescript
declare const localforage: typeof import('localforage');

import type { StoreManifest } from './types';

export const PROBE_TEXT = '计算三角形的面积';
const MANIFEST_KEY = '__manifest__';

function store(storeName: string) {
  return localforage.createInstance({ name: 'questionBank', storeName });
}

export async function readManifest(storeName: string): Promise<StoreManifest | null> {
  return (await store(storeName).getItem(MANIFEST_KEY)) as StoreManifest | null;
}

export async function beginBuild(storeName: string): Promise<void> {
  await store(storeName).clear();
}

export async function commitBuild(storeName: string, m: StoreManifest): Promise<void> {
  await store(storeName).setItem(MANIFEST_KEY, m);
}
```

`beginBuild` 先 `clear()` 会连 manifest 一起删掉 —— **这正是我们要的**：中断的建库留下的是"有向量、无 manifest"的状态，`readManifest` 返回 `null`，被判定为 `absent`，不会被误当成完整库。

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-manifest.spec.js`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/manifest.ts unit-tests/semantic-manifest.spec.js
git commit -m "feat(semantic): StoreManifest 两阶段提交，半库可识别"
```

---

### Task 6: VectorStore 物理隔离 + Registry + 容量观测

**Files:**
- Create: `src/services/semantic/vector-store.ts`
- Create: `src/services/semantic/registry.ts`
- Create: `src/services/semantic/storage.ts`
- Test: `unit-tests/semantic-store-registry.spec.js`

**Interfaces:**
- Consumes: Task 5 的 `readManifest` / `commitBuild`
- Produces:
  - `storeNameFor(engineId: string): string` → `` `embeddings__${engineId}` ``
  - `class LocalVectorStore implements VectorStore`
  - `class VectorStoreRegistry { get(engineId): VectorStore; list(): EngineId[]; remove(engineId): Promise<boolean> }`
  - `estimateStorage(): Promise<{ usage: number; quota: number; ratio: number }>`
  - `ensurePersistent(): Promise<boolean>`
  - `STORAGE_WARN_RATIO = 0.8`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { storeNameFor } from '../src/services/semantic/vector-store.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';
import { estimateStorage, ensurePersistent, STORAGE_WARN_RATIO } from '../src/services/semantic/storage.ts';

beforeEach(() => { installFakeLocalforage(); });

describe('物理隔离', () => {
  it('不同引擎映射到不同 store 名', () => {
    expect(storeNameFor('mac')).toBe('embeddings__mac');
    expect(storeNameFor('linux')).not.toBe(storeNameFor('mac'));
  });
});

describe('VectorStoreRegistry', () => {
  it('每个引擎拿到自己的 store 实例', () => {
    const r = new VectorStoreRegistry();
    expect(r.get('mac').engineId).toBe('mac');
    expect(r.get('linux').engineId).toBe('linux');
    expect(r.get('mac')).toBe(r.get('mac'));
  });

  it('默认不淘汰：get 过的引擎都留在 list 中', () => {
    const r = new VectorStoreRegistry();
    r.get('mac'); r.get('linux'); r.get('win');
    expect(r.list().sort()).toEqual(['linux', 'mac', 'win']);
  });

  it('remove 是显式操作，只删指定引擎的库', async () => {
    const r = new VectorStoreRegistry();
    r.get('mac'); r.get('linux');
    expect(await r.remove('linux')).toBe(true);
    expect(r.list()).toEqual(['mac']);
  });

  it('remove 不存在的引擎返回 false，不抛异常', async () => {
    const r = new VectorStoreRegistry();
    expect(await r.remove('nope')).toBe(false);
  });
});

describe('容量观测（不做自制 LRU）', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 400 * 1024 * 1024, quota: 1000 * 1024 * 1024 }),
        persist: async () => true,
        persisted: async () => false,
      },
    });
  });

  it('estimateStorage 返回 usage/quota/ratio', async () => {
    const s = await estimateStorage();
    expect(s.usage).toBe(419430400);
    expect(s.quota).toBe(1048576000);
    expect(s.ratio).toBeCloseTo(0.4, 5);
  });

  it('navigator.storage 缺失时返回零值而非抛异常', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    const s = await estimateStorage();
    expect(s).toEqual({ usage: 0, quota: 0, ratio: 0 });
  });

  it('ensurePersistent 在未持久化时申请 persist', async () => {
    expect(await ensurePersistent()).toBe(true);
  });

  it('告警阈值为 0.8', () => {
    expect(STORAGE_WARN_RATIO).toBe(0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-store-registry.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/vector-store.ts"`

- [ ] **Step 3: Write minimal implementation**

`src/services/semantic/vector-store.ts`:

```typescript
declare const localforage: typeof import('localforage');

import type { EngineId, StoreManifest, VectorStore } from './types';
import { readManifest, commitBuild, MANIFEST_KEY } from './manifest';

export function storeNameFor(engineId: EngineId): string {
  return `embeddings__${engineId}`;
}

export class LocalVectorStore implements VectorStore {
  readonly engineId: EngineId;
  private inst: ReturnType<typeof localforage.createInstance>;

  constructor(engineId: EngineId) {
    this.engineId = engineId;
    this.inst = localforage.createInstance({ name: 'questionBank', storeName: storeNameFor(engineId) });
  }

  loadManifest(): Promise<StoreManifest | null> { return readManifest(storeNameFor(this.engineId)); }
  async putVector(id: string, v: Float32Array): Promise<void> { await this.inst.setItem(id, v.buffer); }
  async getVector(id: string): Promise<Float32Array | null> {
    const buf = (await this.inst.getItem(id)) as ArrayBuffer | null;
    return buf ? new Float32Array(buf) : null;
  }
  async iterate(cb: (id: string, v: Float32Array) => void): Promise<void> {
    await this.inst.iterate((v: unknown, k: string) => {
      if (k === MANIFEST_KEY) return;
      if (v instanceof ArrayBuffer) cb(k, new Float32Array(v));
    });
  }
  async count(): Promise<number> {
    let n = 0;
    await this.inst.iterate((_v: unknown, k: string) => { if (k !== MANIFEST_KEY) n++; });
    return n;
  }
  async clear(): Promise<void> { await this.inst.clear(); }
  writeManifest(m: StoreManifest): Promise<void> { return commitBuild(storeNameFor(this.engineId), m); }
}
```

> **⚠️ 两处必须遵守（Task 5 的实测教训）**
> 1. **`declare const localforage: typeof import('localforage');` 必须在文件顶部**。`localforage` 包无 `types` 字段、`@types` 下也无声明；漏了这行会让 `tsc --noEmit` 报 `TS2552: Cannot find name 'localforage'`，**把 `npm run typecheck` 门禁打红**（Task 5 已经踩过一次）。仓库既有范式见 `src/data/stores.ts:1`。
> 2. **`MANIFEST_KEY` 必须从 `manifest.ts` 导出后 import，不得在 `vector-store.ts` 里硬编码 `'__manifest__'`**。Task 5 的实现者明确警告过：两处各写一份会出现「写进去读不到」。因此 Task 6 需要给 `manifest.ts` 的 `const MANIFEST_KEY` **加上 `export`**（这是本任务唯一允许触碰 Task 5 已交付文件的地方，纯加 `export`，零行为变化）。
>
> **另注（参数顺序陷阱）**：`VectorStore.iterate(cb: (id, v) => void)` 的参数顺序是 **`(id, v)`**，而真实 localforage 的 `iterate` 回调是 **`(value, key)`**。适配责任在本类内部（上面的实现已用 `(v, k)` 接 localforage、再以 `cb(k, ...)` 转出）。Task 7 的 `FlatVectorIndex.build` 消费的是 `VectorStore` 接口，即 `(id, v)`。

`src/services/semantic/registry.ts`：

```typescript
import type { EngineId, VectorStore } from './types';
import { LocalVectorStore } from './vector-store';

export class VectorStoreRegistry {
  private stores = new Map<EngineId, VectorStore>();

  get(engineId: EngineId): VectorStore {
    let s = this.stores.get(engineId);
    if (!s) { s = new LocalVectorStore(engineId); this.stores.set(engineId, s); }
    return s;
  }

  list(): EngineId[] { return [...this.stores.keys()]; }

  async remove(engineId: EngineId): Promise<boolean> {
    const s = this.stores.get(engineId);
    if (!s) return false;
    await s.clear();
    this.stores.delete(engineId);
    return true;
  }
}
```

`src/services/semantic/storage.ts`：

```typescript
export const STORAGE_WARN_RATIO = 0.8;

export async function estimateStorage(): Promise<{ usage: number; quota: number; ratio: number }> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.storage?.estimate) return { usage: 0, quota: 0, ratio: 0 };
  const e = await nav.storage.estimate();
  const usage = e.usage ?? 0;
  const quota = e.quota ?? 0;
  return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
}

export async function ensurePersistent(): Promise<boolean> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.storage?.persist) return false;
  if (nav.storage.persisted && (await nav.storage.persisted())) return true;
  return nav.storage.persist();
}
```

**设计说明（D3）**：这里**只有观测，没有淘汰**。库的移除是设置页里的显式用户操作（调用 `registry.remove(engineId)`），不做任何自动 LRU。理由：自动淘汰会在用户不知情的情况下删掉一个引擎的库，而重建代价（91 题 227s）远高于它省下的空间；配额压力交给浏览器自己的 `estimate()` 观测，只在真的逼近 `STORAGE_WARN_RATIO` 时提示用户，由用户决定删哪个。

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-store-registry.spec.js`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/vector-store.ts src/services/semantic/registry.ts src/services/semantic/storage.ts unit-tests/semantic-store-registry.spec.js
git commit -m "feat(semantic): VectorStore 物理隔离 + Registry 显式移除 + 容量观测（不做 LRU）"
```

---

### Task 7: FlatVectorIndex 常驻内存 + 批量点乘

**Files:**
- Create: `src/services/semantic/flat-index.ts`
- Test: `unit-tests/semantic-flat-index.spec.js`

**Interfaces:**
- Consumes: Task 6 的 `VectorStore`（`iterate` / `count`）
- Produces:
  - `FLAT_INDEX_MAX_BYTES = 256 * 1024 * 1024`
  - `class FlatVectorIndex { static build(store: VectorStore, dim: number): Promise<FlatVectorIndex>; get(id: string): Float32Array | null; rank(q: Float32Array, topK: number, minScore: number): { id: string; score: number }[]; get size(): number; get bytes(): number }`

**背景（为什么有这个任务）**：原设计让 Ranker 每次查询都通过 `store.iterate()` 用 IndexedDB 游标扫全库。5000 题 × 2048 维 × 4B = **每次查询 40MB 磁盘读取**，开销随题库线性增长，且与内存无关——纯 I/O。本任务把整库物化成一整块连续 `Float32Array` 常驻内存，之后所有查询都是纯内存运算，磁盘只在构建时读一次。

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { FlatVectorIndex, FLAT_INDEX_MAX_BYTES } from '../src/services/semantic/flat-index.ts';
import { cosineSimilarity } from '../src/services/semantic/invariants.ts';

const DIM = 8;
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };

function fakeStore(rows) {
  return {
    engineId: 'mac',
    async iterate(cb) { for (const [id, v] of rows) cb(id, v); },
    async count() { return rows.length; },
  };
}

const rows = [
  ['q-1', norm([1, 0, 0, 0, 0, 0, 0, 0])],
  ['q-2', norm([0, 1, 0, 0, 0, 0, 0, 0])],
  ['q-3', norm([1, 1, 0, 0, 0, 0, 0, 0])],
];

describe('FlatVectorIndex', () => {
  it('build 后 size 与 bytes 正确，且内存是一块连续数组', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.size).toBe(3);
    expect(idx.bytes).toBe(3 * DIM * 4);
  });

  it('get 按 id 取回向量', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const v = idx.get('q-1');
    expect(v).not.toBeNull();
    expect(v[0]).toBeCloseTo(1, 6);
  });

  it('get 不存在的 id 返回 null', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.get('nope')).toBeNull();
  });

  it('rank 按余弦降序', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 1, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits.map((h) => h.id)).toEqual(['q-3', 'q-1', 'q-2']);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it('与 invariants.cosineSimilarity 结果一致（防止两处实现漂移）', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 2, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits).toHaveLength(3);
    for (const h of hits) {
      const v = idx.get(h.id);
      expect(h.score).toBeCloseTo(cosineSimilarity(q, v), 6);
    }
  });

  it('零向量上两处实现仍一致（norms 的 `|| 1` 是唯一对齐点）', async () => {
    const idx = await FlatVectorIndex.build(fakeStore([['z-1', new Float32Array(DIM)]]), DIM);
    const q = norm([1, 0, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeCloseTo(cosineSimilarity(q, new Float32Array(DIM)), 6);
  });

  it('get 返回拷贝：改它不污染内部索引', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const v = idx.get('q-1');
    v[0] = 999;
    expect(idx.get('q-1')[0]).toBeCloseTo(1, 6);
  });

  it('未归一化向量必须按余弦而非点乘排序（norms/qn 除法必须生效）', async () => {
    const big = new Float32Array(DIM); big[0] = 10;
    const small = new Float32Array(DIM); small[0] = 1; small[1] = 1;
    const idx = await FlatVectorIndex.build(fakeStore([['big', big], ['small', small]]), DIM);
    const q = norm([1, 1, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 2, 0);
    expect(hits.map((h) => h.id)).toEqual(['small', 'big']);
    expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('dim 不符时 build 必须 reject，而不是在异步迭代下挂起', async () => {
    const asyncStore = {
      engineId: 'mac',
      async count() { return 1; },
      async iterate(cb) {
        return new Promise((resolve) => {
          setTimeout(() => {
            cb('bad', new Float32Array(DIM + 1));
            resolve();
          }, 0);
        });
      },
    };
    await expect(FlatVectorIndex.build(asyncStore, DIM)).rejects.toThrow(/dim/);
  });

  it('rank 只读内存：构建后不再触碰 store', async () => {
    let reads = 0;
    const store = fakeStore(rows);
    const origIterate = store.iterate;
    store.iterate = async (cb) => { reads++; return origIterate(cb); };
    const idx = await FlatVectorIndex.build(store, DIM);
    expect(reads).toBe(1);
    idx.rank(norm([1, 0, 0, 0, 0, 0, 0, 0]), 3, 0);
    idx.rank(norm([0, 1, 0, 0, 0, 0, 0, 0]), 3, 0);
    expect(reads).toBe(1);
  });

  it('minScore 过滤生效', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(idx.rank(q, 10, 0.5).map((h) => h.id)).toEqual(['q-1', 'q-3']);
  });

  it('维度不符的库拒绝构建', async () => {
    await expect(FlatVectorIndex.build(fakeStore([['q-1', new Float32Array(4)]]), DIM)).rejects.toThrow(/dim/);
  });

  it('query 维度不符返回空结果，不静默截断', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.rank(new Float32Array(4), 3, 0)).toEqual([]);
  });

  it('内存预算常量为 256MB', () => {
    expect(FLAT_INDEX_MAX_BYTES).toBe(268435456);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-flat-index.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/flat-index.ts"`

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { VectorStore } from './types';

export const FLAT_INDEX_MAX_BYTES = 256 * 1024 * 1024;

export class FlatVectorIndex {
  private constructor(
    private data: Float32Array,
    private norms: Float32Array,
    private ids: string[],
    private idToRow: Map<string, number>,
    private dim: number,
  ) {}

  static async build(store: VectorStore, dim: number): Promise<FlatVectorIndex> {
    const count = await store.count();
    const bytes = count * dim * 4;
    if (bytes > FLAT_INDEX_MAX_BYTES) {
      throw new Error(`向量库超出内存预算：${bytes} > ${FLAT_INDEX_MAX_BYTES}`);
    }
    const data = new Float32Array(count * dim);
    const norms = new Float32Array(count);
    const ids: string[] = [];
    const idToRow = new Map<string, number>();
    let r = 0;
    let dimError: string | null = null;
    await store.iterate((id, v) => {
      if (dimError) return;
      if (v.length !== dim) {
        dimError = `dim 不符：${id} 为 ${v.length}，期望 ${dim}`;
        return;
      }
      const off = r * dim;
      data.set(v, off);
      let s = 0;
      for (let i = 0; i < dim; i++) s += v[i] * v[i];
      norms[r] = Math.sqrt(s) || 1;
      ids.push(id);
      idToRow.set(id, r);
      r++;
    });
    if (dimError) throw new Error(dimError);
    return new FlatVectorIndex(data, norms, ids, idToRow, dim);
  }

  get size(): number { return this.ids.length; }
  get bytes(): number { return this.data.byteLength; }

  get(id: string): Float32Array | null {
    const r = this.idToRow.get(id);
    if (r === undefined) return null;
    return this.data.slice(r * this.dim, (r + 1) * this.dim);
  }

  rank(q: Float32Array, topK: number, minScore: number): { id: string; score: number }[] {
    const { data, norms, ids, dim } = this;
    const n = ids.length;
    if (q.length !== dim) return [];
    let qn = 0;
    for (let i = 0; i < dim; i++) qn += q[i] * q[i];
    qn = Math.sqrt(qn) || 1;
    const scores = new Float32Array(n);
    for (let r = 0; r < n; r++) {
      const off = r * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += q[i] * data[off + i];
      scores[r] = dot / (qn * norms[r]);
    }
    const order: number[] = [];
    for (let r = 0; r < n; r++) if (scores[r] >= minScore) order.push(r);
    order.sort((a, b) => scores[b] - scores[a]);
    return order.slice(0, topK).map((r) => ({ id: ids[r], score: scores[r] }));
  }
}
```

> **⚠️ 回调内 `throw` 会变成静默卡死（Task 7 实现者发现，2026-09-23，必读）**
> 初稿把 dim 校验写成**在 `iterate` 回调里直接 `throw`**。它在测试里能过，**只因为仓库的 `fakeStore` 与 `helpers/fake-localforage.js` 都是同步迭代**。
> 而真实 localforage 的 IndexedDB 驱动把迭代回调放在 `h.onsuccess` 事件处理器内、**在 try/catch 之外** —— 异步派发下这个异常既不 reject 也不 resolve，只变成未捕获异常。
> **后果：真实 `LocalVectorStore` 下一个维度不符的向量会让 `build()` 的 `await store.iterate(...)` 永久 PENDING（静默卡死），而不是期望的"拒绝构建"。** 实现者用逐字复刻该骨架的最小复现验证了三点：Promise 永远 PENDING、外层 try/catch 不捕获、异常未捕获。
> **正确写法：回调内只记录错误标志，`await` 之后统一抛出。** 接口与全部用例语义不变。
> **推广规则（对后续任务同样适用）**：任何在**异步回调内**抛出的异常都可能被驱动吞掉或导致悬挂。回调内只做记录，错误一律在 `await` 之后抛出。

> **`get()` 返回拷贝而非视图（Task 7 实现者发现）**：初稿用 `subarray`，返回的是**指向内部整块数组的视图** —— 调用方误改一个元素会静默污染整个索引。改为 `slice()` 返回拷贝。调用点（`searchSimilar`）每次只调一次，开销可忽略。

> **⚠️ 两条"测试不判别"的缺陷（Task 7 评审 Important，2026-09-23）**
> **① 等价性测试守不住 `norms` 除法。** 初稿夹具里的向量**全部是 L2 归一化的**，于是 `rank()` 里 `dot / (qn * norms[r])` 恒等于 `dot` —— 评审者数值验证：**把除法整个删掉，12 条测试依然全绿**。所以那条"防止两处实现漂移"的测试**根本守不住** `flat-index.ts` 的那行除法。修法：加一条**含非归一化向量**的用例（`big` 模长 10、`small` 模长 √2，方向分别与 `q` 成 45°、0°），断言排序为 `['small','big']` —— 只做点乘时 `big`（分数 ≈7.07）会排第一，断言必失败。
> **② 同步 `fakeStore` 让头号修复自己没有护栏。** 初稿的 `fakeStore` 是**同步**迭代，所以"回调内 throw"在修复前后都能通过 —— 实现者报告 R5.3 实证：**修复缺失时 12 条全绿、`tsc` 0 错误**。修法：加一条**异步派发**的用例。
> **复现"悬挂"的关键细节**：回调必须从**事件/定时器上下文**调用（形如 `setTimeout(() => { cb(...); resolve(); }, 0)`），**不能**从 async 函数体内直接调用 —— 后者抛错会 reject 该 async 函数返回的 promise，`await` 照常失败，**复现不出悬挂**。真实 localforage 的驱动正是把回调放在 `onsuccess` 处理器里，所以要用定时器模拟那个"不在 promise 链上"的上下文。

**为什么预分配而不是先收集再拼接**：`count()` + 一次 `iterate` 预分配，峰值内存 = 1 × 40MB；先 push 到数组再拼接，峰值 = 2 × 40MB（chunks + data）。移动端上这 40MB 的差别是实际的。

**为什么 `norms` 单独存**：manifest 声明 `normalize: 'l2'` 时 norms 全为 1，除法几乎免费；但若某个引擎声明 `normalize: 'none'`，同一份代码仍然正确。用一个 `Float32Array` 换掉正确性分支，比信任声明划算。

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-flat-index.spec.js`
Expected: PASS — 14 passed（含非归一化排序与异步派发两条判别力用例）

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/flat-index.ts unit-tests/semantic-flat-index.spec.js
git commit -m "perf(semantic): FlatVectorIndex 常驻内存 + 批量点乘，消除查询路径的游标扫描"
```

---

### Task 8: 自洽校验（引擎 vs 自己的库）

**Files:**
- Create: `src/services/semantic/conformance.ts`
- Test: `unit-tests/semantic-conformance.spec.js`

**Interfaces:**
- Consumes: Task 1 的 `cosineSimilarity`、Task 5 的 `PROBE_TEXT`
- Produces:
  - `CONFORMANCE_THRESHOLD = 0.99`
  - `checkSelfConsistency(engine: Engine, manifest: StoreManifest, signal?): Promise<{ ok: boolean; score: number | null; reason?: 'dim-mismatch' | 'drifted' }>`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { checkSelfConsistency, CONFORMANCE_THRESHOLD } from '../src/services/semantic/conformance.ts';

const v = (n, seed = 0) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (i + seed) % 7 + 1; return a; };
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };

const engine = (vec) => ({ id: 'mac', fingerprint: 'fp', modalities: ['text'], probe: async () => ({ ok: true, fingerprint: 'fp' }), encode: async () => vec });

const manifest = (vec) => ({ engineId: 'mac', engineFingerprint: 'fp', spaceKey: 'k', dim: vec.length, normalize: 'l2', itemCount: 1, sourceHash: 'h', probeText: 'x', probeVector: Array.from(vec), builtAt: '', builtBy: '' });

describe('自洽校验', () => {
  it('引擎输出与库锚点一致 → ok', async () => {
    const p = norm(v(2048));
    const r = await checkSelfConsistency(engine(p), manifest(p));
    expect(r.ok).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('引擎输出按比例缩放 → 仍判 ok（余弦对尺度不变）', async () => {
    const p = norm(v(2048));
    const scaled = Float32Array.from(p, (x) => x * 7.5);
    const r = await checkSelfConsistency(engine(scaled), manifest(p));
    expect(r.ok).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('引擎已漂移（余弦 0.887）→ 判 drifted', async () => {
    const p = norm(v(2048));
    const drifted = norm(Float32Array.from(p, (x, i) => (i % 3 === 0 ? x * 0.2 : x)));
    const r = await checkSelfConsistency(engine(drifted), manifest(p));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('drifted');
  });

  it('维度不同 → 判 dim-mismatch，不静默截断', async () => {
    const r = await checkSelfConsistency(engine(norm(v(256))), manifest(norm(v(2048))));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dim-mismatch');
  });

  it('阈值常量为 0.99', () => {
    expect(CONFORMANCE_THRESHOLD).toBe(0.99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-conformance.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/conformance.ts"`

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Engine, StoreManifest } from './types';
import { cosineSimilarity } from './invariants';

export const CONFORMANCE_THRESHOLD = 0.99;

export async function checkSelfConsistency(
  engine: Engine,
  manifest: StoreManifest,
  signal?: AbortSignal,
): Promise<{ ok: boolean; score: number | null; reason?: 'dim-mismatch' | 'drifted' }> {
  const probe = await engine.encode({ kind: 'text', text: manifest.probeText }, signal);
  const anchor = Float32Array.from(manifest.probeVector);
  const score = cosineSimilarity(probe, anchor);
  if (score === null) return { ok: false, score: null, reason: 'dim-mismatch' };
  if (score < CONFORMANCE_THRESHOLD) return { ok: false, score, reason: 'drifted' };
  return { ok: true, score };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-conformance.spec.js`
Expected: PASS — 5 passed

> **⚠️ 尺度不变性用例是必须的（王先生指出，2026-09-23）**
> 初稿 4 条里，「引擎输出与库锚点一致 → ok」用的是**同一个**向量，因此它**不经过归一化路径**——把 `checkSelfConsistency` 改成用点乘而非余弦，它照样通过。
> 新加的「引擎输出按比例缩放 → 仍判 ok」才是那条守卫：`scaled = p * 7.5`，余弦对尺度不变故 `score ≈ 1`；若实现退化为点乘，`score` 会变成 **7.5**，`toBeCloseTo(1, 5)` 必失败。
> 这条与 Task 7 的 `qn` 用例属**同一类**：纯内存、确定性、几分钟成本，但守的是"实现退化为点乘"这一整类错误。**不应以「需求清单没写」为由 defer。**

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/conformance.ts unit-tests/semantic-conformance.spec.js
git commit -m "feat(semantic): 自洽校验（引擎 vs 自己的库），0.99 阈值"
```

---

### Task 9: EngineBinding 原子切换

**Files:**
- Create: `src/services/semantic/binding.ts`
- Test: `unit-tests/semantic-binding.spec.js`

**Interfaces:**
- Consumes: Task 6 的 Registry、Task 8 的 `checkSelfConsistency`、Task 7 的 `FlatVectorIndex`
- Produces:
  - `class EngineBinding { get active(): ActiveBinding | null; switchTo(engineId, opts?): Promise<ActiveBinding> }`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { EngineBinding } from '../src/services/semantic/binding.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';

const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };
const vec = (seed) => norm(Float32Array.from({ length: 2048 }, (_, i) => ((i + seed) % 7) + 1));
const mkEngine = (id, v) => ({ id, fingerprint: `fp-${id}`, modalities: ['text'], probe: async () => ({ ok: true, fingerprint: `fp-${id}` }), encode: async () => v });

async function seedStore(registry, engineId, m) {
  const s = registry.get(engineId);
  await s.clear();
  await s.writeManifest(m);
}

const manifest = (engineId, v) => ({ engineId, engineFingerprint: `fp-${engineId}`, spaceKey: 'k', dim: v.length, normalize: 'l2', itemCount: 1, sourceHash: 'h', probeText: 'x', probeVector: Array.from(v), builtAt: '', builtBy: engineId });

describe('EngineBinding 原子切换', () => {
  it('库与引擎配对 → ready', async () => {
    const reg = new VectorStoreRegistry();
    const v = vec(0);
    await seedStore(reg, 'mac', manifest('mac', v));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', v) });
    expect(a.state).toBe('ready');
    expect(a.engineId).toBe('mac');
  });

  it('无 manifest → absent，不拿旧库凑合', async () => {
    const reg = new VectorStoreRegistry();
    await seedStore(reg, 'mac', manifest('mac', vec(0)));
    const b = new EngineBinding(reg);
    await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    const a = await b.switchTo('linux', { engine: mkEngine('linux', vec(1)) });
    expect(a.state).toBe('absent');
    expect(a.store).not.toBeNull();
    expect(a.manifest).toBeNull();
  });

  it('引擎漂移 → stale', async () => {
    const reg = new VectorStoreRegistry();
    const anchor = vec(0);
    await seedStore(reg, 'mac', manifest('mac', anchor));
    const drifted = norm(Float32Array.from(anchor, (x, i) => (i % 3 === 0 ? x * 0.2 : x)));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', drifted) });
    expect(a.state).toBe('stale');
  });

  it('每次切换 generation 自增', async () => {
    const reg = new VectorStoreRegistry();
    await seedStore(reg, 'mac', manifest('mac', vec(0)));
    const b = new EngineBinding(reg);
    const a1 = await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    const a2 = await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    expect(a2.generation).toBe(a1.generation + 1);
    expect(b.active.generation).toBe(a2.generation);
    expect(a1.generation).not.toBe(b.active.generation);
  });

  it('索引构建失败（库里有维度不符的向量）→ corrupt，异常不穿透', async () => {
    const reg = new VectorStoreRegistry();
    const anchor4 = norm(Float32Array.from([1, 2, 3, 4]));
    await seedStore(reg, 'mac', manifest('mac', anchor4));
    await reg.get('mac').putVector('bad', new Float32Array(8));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', anchor4) });
    expect(a.state).toBe('corrupt');
    expect(a.index).toBeNull();
    expect(a.manifest).not.toBeNull();
  });

  it('引擎不可达 → absent', async () => {
    const reg = new VectorStoreRegistry();
    const down = { id: 'linux', fingerprint: 'x', modalities: ['text'], probe: async () => ({ ok: false, fingerprint: '' }), encode: async () => vec(1) };
    const b = new EngineBinding(reg);
    const a = await b.switchTo('linux', { engine: down });
    expect(a.state).toBe('absent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-binding.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/binding.ts"`

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ActiveBinding, Engine, EngineId, StoreManifest, VectorIndex, VectorStore } from './types';
import type { VectorStoreRegistry } from './registry';
import { checkSelfConsistency } from './conformance';
import { FlatVectorIndex } from './flat-index';

export class EngineBinding {
  private _active: ActiveBinding | null = null;
  private _gen = 0;

  constructor(private registry: VectorStoreRegistry) {}

  get active(): ActiveBinding | null { return this._active; }

  async switchTo(engineId: EngineId, opts: { engine: Engine; signal?: AbortSignal }): Promise<ActiveBinding> {
    const { engine, signal } = opts;
    const store: VectorStore = this.registry.get(engineId);
    const frame = (manifest: StoreManifest | null, index: VectorIndex | null) => ({ engineId, engine, store, manifest, index });

    const health = await engine.probe(signal).catch(() => ({ ok: false, fingerprint: '' }));
    if (!health.ok) return this.commit({ ...frame(null, null), state: 'absent' });

    const manifest = await store.loadManifest();
    if (!manifest) return this.commit({ ...frame(null, null), state: 'absent' });

    if (manifest.engineFingerprint !== engine.fingerprint) {
      return this.commit({ ...frame(manifest, null), state: 'stale' });
    }

    const c = await checkSelfConsistency(engine, manifest, signal);
    if (!c.ok) return this.commit({ ...frame(manifest, null), state: 'stale' });

    let index: VectorIndex;
    try {
      index = await FlatVectorIndex.build(store, manifest.dim);
    } catch {
      return this.commit({ ...frame(manifest, null), state: 'corrupt' });
    }
    return this.commit({ ...frame(manifest, index), state: 'ready' });
  }

  private commit(p: Omit<ActiveBinding, 'generation'>): ActiveBinding {
    const next: ActiveBinding = { generation: ++this._gen, ...p };
    this._active = next;
    return next;
  }
}
```

**D5 落实**：`index` 在 `switchTo` 里构建一次，随 binding 原子替换。**查询路径不再碰磁盘**——这就是消除"每次查询扫 40MB"的落点。构建失败（超内存预算/维度不符）→ `corrupt`，不静默降级。

`commit` 是整个机制的原子点：**单一对象引用替换**，调用方拿到的 `generation` 可用于在途请求失效判断。

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-binding.spec.js`
Expected: PASS — 6 passed（初稿 5 条 + 新增 corrupt 1 条；generation 那条是**扩展**既有用例的断言，不是新增一条 —— 控制器曾误写为 7，2026-09-23 更正）

> **⚠️ `corrupt` 与 generation 失效必须有用例（Task 9 实现者顾虑 + 控制器裁定，2026-09-23）**
> 初稿的 5 条用例**没覆盖 `corrupt`** —— 而它是「索引构建失败」的**唯一出口**，且 Task 10 的 Router 要把它作为 `degraded.reason` 消费。实现者只用临时文件实证过（dim 不符 → `index === null`、`manifest !== null`、异常未穿透），临时文件已删。按 Task 7 评审确立的先例（**未被判别力用例覆盖的分支 = Important**），控制器裁定把该实证提升为常驻用例。
> 另把 generation 用例扩展为断言**旧 binding 已失效**（`a1.generation !== b.active.generation`）—— 这正是 `generation` 存在的理由（在途请求据此丢弃）。
> 为支持 `corrupt` 用例，`manifest()` 助手的 `dim` 从硬编码 `2048` 改为 `v.length`（既有用例喂的都是 2048 维向量，故行为不变）。

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/binding.ts unit-tests/semantic-binding.spec.js
git commit -m "feat(semantic): EngineBinding 原子切换 + generation 失效"
```

---

### Task 10: Router L0 闸门 + 显式降级 + 内联建库提示

**Files:**
- Create: `src/services/semantic/router.ts`
- Create: `src/services/semantic/service.ts`
- Create: `src/services/semantic/index.ts`
- Test: `unit-tests/semantic-router.spec.js`

> **⚠️ 模块解析陷阱（Task 1 实测发现，必读）**
> `src/services/semantic.ts`（旧文件）与 `src/services/semantic/`（新目录）**同名并存**。模块解析规则是**文件优先于目录**，所以 `import ... from './semantic'` 在 `semantic/index.ts` 存在后**仍然解析到旧文件 `semantic.ts`** —— 新模块会**永远不可达**，而且**不报错**。
>
> **本任务的硬要求**：`src/services/index.ts` 必须改成显式路径 `export * from './semantic/index'`，**不得**依赖 `'./semantic'` 的自动解析。
> **并加一条断言测试**钉住解析目标（在 `unit-tests/semantic-router.spec.js` 里）：
> ```javascript
> it('services 门面导出的是新模块，不是旧的 semantic.ts', async () => {
>   const svc = await import('../src/services/index.ts');
>   expect(typeof svc.SemanticService).toBe('function');
>   expect(svc.SemanticService.name).toBe('SemanticRouter');
> });
> ```
> 旧文件 `semantic.ts` 的删除与剩余导出（`mergeRankings` / `SemanticHit`）的归置在 Task 11 完成。

> **⚠️ 裁定①与③的冲突及修法（Task 10 评审 Important，2026-09-23）**
> 评审指出：裁定①把 `switchTo` 的异常吞成 `state: 'absent'` 后，**「切换失败」与「库从未建过」塌缩成同一个状态** —— Router 返回 `ok:true, degraded:null`，随后 `search()` 看到 `absent` 就给出**假的**提示「正在为该引擎建库，约 4 分钟」，而真相是切换过程中出错了（例如读 manifest 时 I/O 失败）。同时裁定③加的 `'switch-failed'` **在真实路径上不可达**，成了死代码。
> **修法（区分二者，不新增 StoreState）**：
> 1. `types.ts` 的 `ActiveBinding` 增加**可选**字段 `switchError?: string`；
> 2. `binding.ts` 的 `switchTo` catch 分支 commit `{ ...frame(null, null), state: 'absent', switchError: <消息> }`；
> 3. Router：`active.switchError` 存在 → `degraded: { reason: 'switch-failed', detail: <消息> }`；否则才用 `'store-absent'` + 建库时长文案。
> 理由：`degraded.detail` 是用户看到的唯一解释，说"正在建库、约 4 分钟"而实际是出错，会把用户引向"等一会儿"这个错误动作。
>
> **同时（同类，一并修）**：
> - `router.ts` 的 `rank()` 调用**必须包 try/catch** —— 否则排序抛错会绕过 `degraded` 通道逃成 rejection（与裁定①同源：异常不该穿透到调用方）。
> - `router.ts` 里「引擎在请求中途被切换」的分支**不得复用 `'no-engine'`**（它的语义是"没有可用引擎"），改用 `'switch-failed'`。
> - **补齐分支测试**：`router.ts` 的四个未覆盖分支（含唯一未被 pin 的 `encode-failed`）都要有用例。
>
> **明确 deferred（本轮不动）**：`searchSimilar` 对"库里没有这道题"复用 `'store-absent'`（语义失真，但 `DegradeInfo.reason` 无合适值，加新码需单独论证）；`SearchRequest.engineId` / `timeoutMs` 被静默忽略（实现者已自曝）。
> **⚠️ 三条裁定（Task 9 评审 Minor + Task 10 实现者顾虑，2026-09-23）**
> **① `switchTo` 不得 reject，失败要落成状态**（王先生要求把 Task 9 那条 Minor 在 Task 10 交代）
> Task 9 评审指出：`binding.ts` 的 `loadManifest` / `encode` 抛错未被捕获 → `switchTo` 会 reject，**且 `binding.active` 仍指向旧引擎**。Router 加 try/catch 只能让调用方知道失败，**不能修正 `active`** —— 下一次 `search()` 会静默用旧引擎，而用户选的是新引擎。
> **裁定：在 `binding.ts` 的 `switchTo` 内包 try/catch，出错时 commit `{ ...frame(null, null), state: 'absent' }` 并正常返回，不再 reject。** 理由：`switchTo` 的契约是"确立一个 binding 状态"；做不到时应当**把失败表达为一个状态**，而不是一个被拒绝的 promise —— 后者会让 `active` 描述另一个引擎。Router 的防御性 catch 保留（双保险）。
> **② `searchSimilar` 的 `corrupt` 必须与 `search` 对齐**（实现者顾虑 4）
> 初稿把 `corrupt` 折成 `store-absent`，而 `search` 报 `store-corrupt`。**裁定：两边都报 `store-corrupt`。** 理由：把"库损坏"说成"库不存在"，会把用户引向错误的补救动作（重建 vs 排查损坏）。
> **③ 切换失败的 `degraded.reason` 必须真实**（实现者顾虑 2）
> 初稿就近取 `'no-engine'`，而它的语义是"没有可用引擎"，不是"切换失败"。**裁定：在 `types.ts` 的 `DegradeInfo.reason` 增加 `'switch-failed'`**（1 行类型扩展），并在 Router 的切换失败路径使用它。理由：`degraded.reason` 是 UI 与排障的唯一依据，语义不真会误导。

**Interfaces:**
- Consumes: Task 9 的 `EngineBinding`、Task 7 的 `FlatVectorIndex`
- Produces:
  - `class SemanticRouter { constructor(binding: EngineBinding); search(req: SearchRequest): Promise<SearchResult>; searchSimilar(id, opts?): Promise<SearchResult> }`
  - `estimateBuildMinutes(itemCount: number): number` —— 按实测 227s/91 题折算
  - `SemanticService` 门面（`index.ts` 只导出它与 `types`）

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { SemanticRouter, estimateBuildMinutes } from '../src/services/semantic/router.ts';
import { EngineBinding } from '../src/services/semantic/binding.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';

const DIM = 4;
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };
const mkEngine = (id, v, modalities = ['text']) => ({
  id, fingerprint: `fp-${id}`, modalities,
  probe: async () => ({ ok: true, fingerprint: `fp-${id}` }),
  encode: async () => v,
});
const manifest = (engineId, v) => ({
  engineId, engineFingerprint: `fp-${engineId}`, spaceKey: 'k', dim: DIM, normalize: 'l2',
  itemCount: 2, sourceHash: 'h', probeText: 'x', probeVector: Array.from(v), builtAt: '', builtBy: engineId,
});

const ANCHOR = norm([1, 0, 0, 0]);
const DRIFTED = norm([0.2, 1, 0, 0]);

async function setup(state) {
  const reg = new VectorStoreRegistry();
  const s = reg.get('mac');
  await s.clear();
  if (state !== 'absent') await s.writeManifest(manifest('mac', ANCHOR));
  await s.putVector('q-1', norm([1, 0, 0, 0]));
  await s.putVector('q-2', norm([0, 1, 0, 0]));
  const engine = state === 'stale' ? mkEngine('mac', DRIFTED) : mkEngine('mac', ANCHOR);
  const binding = new EngineBinding(reg);
  await binding.switchTo('mac', { engine });
  return new SemanticRouter(binding);
}

beforeEach(() => { installFakeLocalforage(); });

describe('Router L0 闸门', () => {
  it('ready → 返回真实排序结果，degraded 为 null', async () => {
    const r = await setup('ready');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded).toBeNull();
    expect(res.hits[0].id).toBe('q-1');
    expect(res.hits[0].score).toBeCloseTo(1, 5);
    expect(res.engineId).toBe('mac');
  });

  it('absent → degraded=store-absent，带可读的建库提示，且不返回 hits', async () => {
    const r = await setup('absent');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-absent');
    expect(res.degraded.detail).toMatch(/建库/);
    expect(res.hits).toEqual([]);
  });

  it('stale → degraded=store-stale，且不返回 hits', async () => {
    const r = await setup('stale');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-stale');
    expect(res.hits).toEqual([]);
  });

  it('模态不支持 → degraded=no-engine', async () => {
    const r = await setup('ready');
    const res = await r.search({ query: { kind: 'image', dataUrl: 'data:image/png;base64,AA==' } });
    expect(res.degraded.reason).toBe('no-engine');
  });

  it('searchSimilar 在 ready 下返回其它题，且不调用 encode', async () => {
    const r = await setup('ready');
    const res = await r.searchSimilar('q-1');
    expect(res.degraded).toBeNull();
    expect(res.hits.map((h) => h.id)).toEqual(['q-2']);
  });

  it('searchSimilar 对库中不存在的题返回 degraded', async () => {
    const r = await setup('ready');
    const res = await r.searchSimilar('nope');
    expect(res.degraded.reason).toBe('store-absent');
  });
});

describe('建库时长估算（内联提示用）', () => {
  it('按实测 227s/91 题折算', () => {
    expect(estimateBuildMinutes(91)).toBe(4);
    expect(estimateBuildMinutes(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-router.spec.js`
Expected: FAIL — `Failed to resolve import "../src/services/semantic/router.ts"`

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { SearchRequest, SearchResult } from './types';
import type { EngineBinding } from './binding';

const SECONDS_PER_ITEM = 227 / 91;

export function estimateBuildMinutes(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(1, Math.round((itemCount * SECONDS_PER_ITEM) / 60));
}

export class SemanticRouter {
  constructor(private binding: EngineBinding) {}

  private head(modality: 'text' | 'image') {
    const active = this.binding.active;
    return {
      spaceKey: active?.manifest?.spaceKey ?? '',
      engineId: active?.engineId ?? '',
      modality,
      timings: { probeMs: 0, encodeMs: 0, rankMs: 0 },
    };
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const t0 = Date.now();
    const base = this.head(req.query.kind);
    const active = this.binding.active;
    if (!active) return { ...base, hits: [], degraded: { reason: 'no-engine' } };
    if (!active.engine.modalities.includes(req.query.kind)) {
      return { ...base, hits: [], degraded: { reason: 'no-engine', detail: `${active.engineId} 不支持 ${req.query.kind}` } };
    }
    if (active.state === 'absent') {
      const minutes = estimateBuildMinutes(active.manifest?.itemCount ?? 0) || 4;
      return { ...base, hits: [], degraded: { reason: 'store-absent', detail: `正在为该引擎建库，约 ${minutes} 分钟` } };
    }
    if (active.state === 'stale') {
      return { ...base, hits: [], degraded: { reason: 'store-stale', detail: '该引擎已升级，向量库需重建' } };
    }
    if (active.state === 'corrupt') {
      return { ...base, hits: [], degraded: { reason: 'store-corrupt', detail: '向量库损坏，需重建' } };
    }
    if (!active.index) return { ...base, hits: [], degraded: { reason: 'store-absent', detail: '向量索引未就绪' } };

    const gen = active.generation;
    let q: Float32Array;
    try {
      q = await active.engine.encode(req.query as never, req.signal);
    } catch {
      return { ...base, hits: [], degraded: { reason: 'encode-failed' } };
    }
    if (this.binding.active?.generation !== gen) {
      return { ...base, hits: [], degraded: { reason: 'no-engine', detail: '引擎已切换' } };
    }

    const t1 = Date.now();
    const hits = active.index
      .rank(q, req.topK ?? 10, req.minScore ?? 0.25)
      .map((h) => ({ ...h, source: active.engineId }));
    return { ...base, hits, degraded: null, timings: { probeMs: 0, encodeMs: t1 - t0, rankMs: Date.now() - t1 } };
  }

  async searchSimilar(id: string, opts?: { topK?: number }): Promise<SearchResult> {
    const base = this.head('text');
    const active = this.binding.active;
    if (!active || active.state !== 'ready' || !active.index) {
      const reason = active?.state === 'stale' ? 'store-stale' : 'store-absent';
      return { ...base, hits: [], degraded: { reason } };
    }
    const self = active.index.get(id);
    if (!self) return { ...base, hits: [], degraded: { reason: 'store-absent', detail: '该题不在当前引擎的库中' } };
    const topK = opts?.topK ?? 6;
    const t0 = Date.now();
    const hits = active.index
      .rank(self, topK + 1, 0)
      .filter((h) => h.id !== id)
      .slice(0, topK)
      .map((h) => ({ ...h, source: active.engineId }));
    return { ...base, hits, degraded: null, timings: { probeMs: 0, encodeMs: 0, rankMs: Date.now() - t0 } };
  }
}
```

**D4 落实**：`store-absent` / `store-stale` 的 `degraded.detail` 就是给用户看的**内联状态提示**文案（"正在为该引擎建库，约 4 分钟"），由调用方直接渲染。**不弹确认卡片，不做取消机制**——90 题规模下建库是自动后台完成的，用户只需要知道"为什么现在没结果、还要多久"。

**D5 落实**：`rank()` 直接打在 `active.index` 这块常驻内存上，查询路径**不触碰 IndexedDB**。`index` 与 `store`/`manifest` 同属 `ActiveBinding`，随引擎原子切换。

`index.ts`：

```typescript
export * from './types';
export { SemanticRouter as SemanticService } from './router';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS= ./node_modules/.bin/vitest run unit-tests/semantic-router.spec.js`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add src/services/semantic/router.ts src/services/semantic/service.ts src/services/semantic/index.ts unit-tests/semantic-router.spec.js
git commit -m "feat(semantic): Router L0 闸门 + 显式 degraded 语义"
```

---

### Task 11: 运行时接线（**新增，2026-09-23 由 Task 11 实现者 BLOCKED 诊断催生**）

> **🔴 第二个引擎的接入阻塞（2026-09-23/24 核实，王先生提问后实测）**
>
> **0. 先纠正一个环境误解：没有 Docker（2026-09-24 实测）**
> - 全仓库**无** `Dockerfile` / `docker-compose*` / `.dockerignore`（`find` 已确认）；`docs/` 与 `AGENTS.md` 里**无任何 "docker" 字样**（grep 已确认）
> - 编码服务是**裸机直跑**：`server/embed/start.sh` → `exec <managed-venv>/uvicorn embed_service:app --host 127.0.0.1 --port 3002`
> - `lsof` 实测：`python3.1` PID 1386 监听 `127.0.0.1:3002`（**loopback only**）
> - 依赖见 `server/embed/requirements.txt`（fastapi / uvicorn / sentence-transformers / torch / transformers==5.2.0 / qwen-vl-utils）
> ⇒ **"引擎在 Docker 里"这个印象不成立**；它是本机的一个 uvicorn 进程，且**只绑回环**。
>
> **1. 更关键：服务端只绑了「一个」编码服务（这才是真正的架构缺口）**
> `server/src/routes/embed.ts:8`：`const EMBED_BASE = process.env.EMBED_SERVICE_URL || 'http://127.0.0.1:3002';` —— **单一 URL，没有 `engineId → 编码服务` 的映射**。
> 后果（`/engines` 的实现，`embed.ts:108-117`）：它拿 `SELECT DISTINCT engine_id` 列出所有引擎，却**只探这一个编码服务**，然后把**同一个指纹盖给每一个 id**。
> Task 4 评审曾把这点记为 Minor（"`/engines` 给每个引擎同一个指纹"）——**它其实是这个缺口的症状，不是装饰性问题**。
> ⇒ **加第二个引擎不只是"为它建库"，服务端还需要 `engineId → 编码服务地址` 的映射**（例如 `EMBED_SERVICE_URL__<engineId>` 或一张引擎注册表）。
>
> **2. 方案 (a)「llama-server --mmproj」已作废（2026-09-24，控制器先读王先生部署文档后更正）**
> 王先生的部署项目（`~/Documents/Qoder/2026-09-20/9d57a4e9/docs/runbook.md`）**早已实测并否决该路线**：
> > **图片 → 向量只能走 WeMM。** 2026-09-20 实测：Ollama 的 `ollama show` 在目录形式 `FROM .` 下**确实**会多出 `vision` 能力（mmproj 挂上了），但**仍然拿不到可用的图片向量**；llama-server / SGLang 同样不行。四个栈里只有 Transformers / Sentence-Transformers 能（账本 R50/R51/R54；官方 issue #2 亦承认服务端示例不完整）。
> > ⇒ 任务只要涉及"图搜图 / 图搜文"，就**没有可选项**。
>
> **控制器提 (a) 之前没有先读该部署文档，这是判断失误。** 路线作废，不再讨论 llama.cpp / Ollama / SGLang。
>
> **3. 真正的第二个引擎 = 王先生 Linux（fnOS）上的 Docker WeMM 服务**
> 注意与第 0 条的**区分**：**Mac 这台** worktree 里的编码服务是裸机 uvicorn + 回环；**Linux 那台**是 Docker 部署、绑 `0.0.0.0:3002`、经 `make enable-lan` 开 `DOCKER-USER` 白名单（只放行 `LAN_ALLOW_CIDRS`，末条兜底 DROP）。**两者不矛盾，是两台机器。**
> - 栈：**PyTorch + sentence-transformers**（`transformers==5.2.0` / `sentence-transformers==6.1.0`，基镜像 `lmsysorg/sglang:v0.5.9`，torch 2.9.1+cu129），BF16 权重，暴露 `/health`、`/encode-text`、`/encode-images`
> - **与本机 Mac 的 `embed_service.py` 同族**（都是 sentence-transformers）⇒ **能编码图片** —— 这是它与 LM Studio 的根本差别，也是它可行的原因
> - 王先生实测的硬约束：**显存 8188 MiB、WeMM 常驻峰值 5828 MiB ⇒ 剩余约 2.3 GB，两个模型不能同时跑**；文本路径 **25–38 ms/条**（比 Mac 快 3–4 倍）
>
> **⚠️ 「同族」不等于「同向量」——三个具体的、可验证的分歧源，对齐必须实测**
> 1. **`use_fp32_patch_embed()` 只在 Linux 端有**（`deploy/wemm/app.py:74`）：把视觉塔 `Conv3d(1024,3,2,16,16)` 的 patch-embedding 改成 **fp32** 计算（其余保持 bf16），换来该层 0.944s → 0.037s、端到端 11.161 → 0.985 s/张。**本机 Mac 的 `server/embed/embed_service.py` 没有这个补丁**（已 grep 确认）⇒ 两端 patch-embedding **一个 fp32、一个 bf16**。
> 2. **MPS vs CUDA** 后端不同（Mac `DEVICE = "mps" if torch.backends.mps.is_available()`；Linux 是 cuda）⇒ 内核实现与舍入不同。
> 3. OS / 驱动 / cuDNN 版本层面的数值差异。
> ⇒ **跑 `tmp/verify_space_alignment.py` 是必须的**，而且**不是盲试**——针对上述三个已知嫌疑点验证。判据 cos ≥ 0.99 视为同空间。
> **两种结果的后果不同**：**对齐** ⇒ 它是**真正的第二引擎**（可被路由选择，文本快 3–4 倍）；**不对齐** ⇒ 它是**另一个向量空间**，需**自己的一份库**（架构已支持，`engineId` 隔离），阈值也需单独校准（`calibrate_threshold.py --engine-id` 已支持）。
>
> **4. 服务端仍需 `engineId → 编码服务地址` 的映射（真正的架构缺口，见第 1 条）**
> 即使对齐通过，`embed.ts:8` 的单一 `EMBED_SERVICE_URL` 也**无法同时指向两台机器的编码服务**。加第二个引擎必须补这张映射表（`EMBED_SERVICE_URL__<engineId>` 或引擎注册表），并让 `build_index.py` 能按引擎选编码后端。
>
> **5. 引擎选择策略尚未设计**：`runtime.ts` 目前是「取 `/engines` 第一个」（控制器裁定④的临时做法）。两个引擎并存时"用哪个"需要真正的策略（本机优先？实测延迟？），这一步还没有设计。
>
> **6. ✅ 2026-09-24 王先生决定：所有系统统一部署 Debian 那套 Docker 引擎 ⇒ 对齐风险从根上消失**
> 三个分歧源里**有两个是"两端不同栈"造成的**（`use_fp32_patch_embed()` 只在 Linux 有、MPS vs CUDA）。全部系统用**同一个 Docker 镜像** ⇒ 同一份代码、同一份权重、同一个 CUDA 栈 ⇒ **同空间**。
> **⇒ `verify_space_alignment.py` 从"必须实测的未知"降级为"可选的冒烟检查"。**
> **⚠️ 前提（2026-09-24 细化）**：**Mac 不要跑 Docker，而是「指向 Linux 那台」** —— 见下方 6c。原措辞"Mac 也必须改成指向 Docker 引擎"应理解为"Mac 不再跑自己那份编码服务"，**不是**"Mac 上也跑容器"。
>
> **6c. 🔴 Mac 上跑 Docker 会更差，不要做（2026-09-24 分析）**
> 两条轴都更差：
> - **速度**：macOS 上 Docker 是 Linux VM，**没有 Apple GPU 直通** ⇒ 容器内 `app.py:35` 的 `DEVICE = "cuda" if torch.cuda.is_available() else "cpu"` 会落到 **`cpu`**。而裸机版 `embed_service.py:20` 是 **`mps`**（Apple GPU）。**2B 多模态模型跑 CPU 远慢于 MPS。**
> - **内存**：裸机版是**统一内存**里约 **5.8 GB**（Linux 实测常驻峰值 5828 MiB，Mac 同量级），且 `IDLE_UNLOAD_SECONDS=900` ⇒ **空闲 15 分钟自动卸载**（`embed_service.py:78-86`，含 MPS 缓存清理）。Docker 版 **`app.py:4` 明确"③ 去掉 idle-unload"** ⇒ 模型**常驻永不释放**，而且那 5.8 GB 是**关在 Docker Desktop 的 VM 里**——VM 的内存是从宿主**预留**的固定额度（不像原生进程那样可被系统压缩/回收），还要额外付 Linux 内核 + docker daemon + containerd 的开销。
> ⇒ **Mac 上 Docker 在速度与内存两条轴上都劣于现状。**
>
> **6e. 🔴 「两个引擎收敛到统一调用契约」的逐项差异（2026-09-24 实测核对）**
> 王先生决定：**Mac 保留裸机 MPS**，且**两个引擎都只与调用层打交道**（调用层不需要知道背后是谁）。为此两者必须收敛到同一契约。实测差异：
>
> | 项 | Mac `embed_service.py` | Linux `app.py` | 判定 |
> |---|---|---|---|
> | 路由 `/health` `/encode-text` `/encode-images` | ✓ | ✓ | ✅ 一致 |
> | encode 响应体 | `{dim, vectors}` | `{dim, vectors}` | ✅ 一致（`embed.ts` 只读这两个） |
> | **`/health` 字段** | 9 个：`ok/device/model_loaded/idle_unload_seconds/model_path/dtype/dtype_source/torch/transformers` | 6 个：`ok/device/model_loaded/dim/batch/image_dir` | ❌ **Linux 缺 4 个指纹字段** ⇒ 指纹退化（见 6a） |
> | **image 输入来源** | `data:` URI ✓，**否则把原字符串当路径直传**（`:132-133`） | **只接受 `data:` URI**，除非配 `WEMM_IMAGE_DIR`（`app.py:155-162`） | ❌ **Mac 有任意文件读取**（见下） |
> | text 请求上限 | 无 | `min_length=1, max_length=64` | ⚠️ 同一请求行为不同 |
> | image 请求上限 | 无 | `min_length=1, max_length=8` | ⚠️ 同上 |
> | encode-images 响应 | `{device, dim, vectors}` | `{dim, vectors}` | ⚠️ Mac 多 `device`，无害但要记录 |
> | MRL 降维 | ✗ | ✓ `WEMM_DIM` | ✅ **允许不同**（见下方更正） |
> | idle-unload | ✓ 900s | ✗ | 行为差异，不影响契约 |
> | fp32 补丁 | ✗ | ✓ | 性能差异（见 6d） |
>
> **🔴 安全问题：Mac 版带着 Linux 版已经修掉的同一个漏洞。**
> Linux `app.py:150-162` 的注释写明：原始设计（即 Mac 版这份 `embed_service.py`）是 `Image.open(src)` 直开，**等于给调用方一个"读取进程内任意文件"的能力，且 200/500 还能当文件存在性预言机**（实测传 `/usr/share/pixmaps/debian-logo.png` 得 200、传不存在路径得 500）。Linux 版已收口为"只接受 `data:` URI"。
> **Mac 版 `embed_service.py:132-133` 仍是 `else: inputs.append({"image": src})`** —— 漏洞**仍在**。
> **修法**：Mac 版比照 Linux 收紧为只接受 `data:` URI（或配一个专用的 `WEMM_IMAGE_DIR` 白名单）。
>
> **收敛要做的事**：
> 1. Linux `/health` 补 `model_path`/`dtype`/`torch`/`transformers`（部署项目唯一必要改动）
> 2. Mac `/encode-images` 收紧为只接受 `data:` URI（**顺带修掉上面的安全问题**）
> 3. 请求上限向 Linux 看齐（更严的那个），或两端都显式写明
> 4. ~~`WEMM_DIM` 两端固定 2048~~ **—— 该条作废（王先生 2026-09-24 指出控制器混淆）**
>
> **⚠️ 更正：收敛的是「调用契约」，不是「向量空间」（控制器原判断有误）**
> 控制器曾写"两端必须同为 2048，否则 dim 不同、库不通用"，**这是错的**。它把两件本质不同的事混成了一件：
> | | 内容 | 是否必须一致 |
> |---|---|---|
> | **调用契约** | HTTP 接口形状（`/health` 字段、`/encode-*` 请求/响应、错误码） | ✅ **必须一致** —— 否则调用层要为每个引擎分支 |
> | **向量空间** | model / 精度 / dim / normalize / 模态 | ❌ **必须允许不同** —— 这正是「库与引擎一一绑定」的前提 |
>
> **「不同的引擎用不同的库」不是妥协，是设计目标**（Review-Focus 第 4 条、以及防"A 引擎编码 + B 库比较"的静默错配）。所以 dim 不同**完全没问题**，架构本来就按引擎隔离：
> - `manifest.dim` 是**每个引擎自己的**，`FlatVectorIndex.build(store, manifest.dim)` 用的是本引擎的 dim
> - `storeNameFor(engineId)` ⇒ 每个引擎一个物理 store
> - `spaceKey` 里含 `dim` ⇒ dim 不同的两个引擎**本来就是两个空间**，阈值也各按 `engineId` 分桶（`calibrate_threshold.py --engine-id`）
> - **越界有硬保护**：`cosineSimilarity` 在 dim 不等时返回 **`null`**（Task 1 的核心改动）⇒ 万一真发生跨空间比较，是**响亮失败**而非静默错分
>
> **MRL 是个特性，不是约束**：`WEMM_DIM` 让每个引擎可以独立权衡——2048 维时 5000 题的常驻索引约 40MB，512 维只要约 10MB。低配设备用小 dim 是完全合法的选择。
> ⇒ **调用层需要知道的只有一件事：向哪个 engineId 要向量，就用哪个引擎的库。** 这与 dim 无关。
> 5. **建议：把「引擎 HTTP 契约」写成一份文档 + 一个契约一致性测试，两个引擎各自跑同一个测试** ⇒ 这样"统一调用层"才是**可验证**的，而不是靠约定。这也让将来加第三个引擎变成"跑通契约测试"即可。
>
> **调用层侧（question-bank）**：`embed.ts:8` 单一 `EMBED_SERVICE_URL` → `engineId → URL` 映射；`build_index.py` 改走 HTTP（解耦第三份副本，见 6b）。
> **6d. 当前 Mac「卡顿」的真因是两条，且都不需要 Docker 就能治**
> 1. **算力**（主因，**但仅在 Linux/CUDA 上已证实；Mac/MPS 上只是假设**）：Mac 的 `embed_service.py` **没有** `use_fp32_patch_embed()` 那个补丁 ⇒ 视觉塔 `Conv3d` 在 bf16 下走 `aten::slow_conv_dilated3d`（单次前向 262173 次设备内小拷贝、占该层 98.5%）⇒ 端到端 ~11 s/张。**Linux 上加了这个补丁后是 0.985 s/张（11.3×）**。修法：把 `app.py:74-97` 那段（约 25 行）**移植到 Mac 的 `embed_service.py`**。
>
> **⚠️ 为什么「移植到 Mac」只是假设而不是结论（2026-09-24 第一性原理复核）**
> 那个补丁的**因果链是 cudnn 专属的**：PyTorch 的 CUDA 后端在 cudnn 找不到该 conv3d 的 bf16 内核时退化到朴素实现；**cudnn 对 fp32 有这个卷积的高效 implicit-GEMM 内核**，所以改 fp32 就换到了真内核。瓶颈**不是 FLOPs**（输入只有 3 通道，算术量很小），而是**内核效率**（26 万次小拷贝）。fp32 几乎不增加算术，所以净赚。
> **但 MPS 根本不用 cudnn。** 所以整条推理**在 Mac 上不成立**——问题变成两个完全不同的、未测量的问题：
> - MPS 对该 conv3d 的 **bf16** 路径是什么？（有 Metal 内核？还是也退化？）
> - MPS 的 **fp32** 路径比 bf16 快还是慢？
> 两种可能都存在：**若 MPS 的 bf16 路径本来就不差，这个补丁在 Mac 上可能毫无收益甚至变慢**（fp32 显存翻倍 + MPS 的 fp32 未必有专门内核）。
> **⇒ 「Mac 卡顿的真因是缺这个补丁」目前是假设，不是结论。** 需先用**微基准**判定（见 6f），再决定是否移植。
> **另外还有两个未测项**：① 该补丁改变了**第一层**的数值（fp32 vs bf16），误差会向后传播 ⇒ 端到端向量是否仍在 cos ≥ 0.99 内**未测**；② Mac 的卡顿也可能**主因是内存压力**（5.8 GB 常驻统一内存）而非算力——需用 profiler 区分。
>
> **6f. 判定 Mac 卡顿真因的最小实测（约 30 行，不动服务）**
> 1. **微基准**：在 MPS 上对那个确切的卷积形状 `Conv3d(1024, 3, 2, 16, 16)` 分别用 **bf16 / fp32** 计时 ⇒ 直接回答"移植有没有用"。
> 2. **profiler**：对**一张真实题图**跑一次 encode，看时间落在哪个 op、以及是否出现 CPU fallback ⇒ 区分"算力"与"内存压力"两条假设。
> 3. 若 1 显示 fp32 不更快 ⇒ **不要移植**，转向查内存（idle-unload 参数、`WEMM_DIM` 降维）。
> ⇒ **先测再改**：在拿到 (1) 的数据之前，不应把"移植补丁"当成 Mac 卡顿的解法。
> 2. **内存**：5.8 GB 常驻统一内存造成压力/压缩。已被 15 分钟 idle-unload 缓解；**指向 Linux 后归零**。
> ⇒ **推荐：Mac 只当客户端**（编码在 Linux 的 GPU 上，0.985 s/张）；若要保留本机兜底，**保留裸机 MPS + 移植那个 fp32 补丁**，而不是换成 Docker。
>
> **6a. 🔴 部署项目唯一需要适配的地方：`/health` 缺 3 个指纹字段**
> | 服务 | `/health` 返回 |
> |---|---|
> | Docker `deploy/wemm/app.py:127-131` | `{ok, device, model_loaded, dim, batch, image_dir}` |
> | Mac `server/embed/embed_service.py:99-104` | `{ok, device, model_loaded, idle_unload_seconds, model_path, dtype, dtype_source, torch, transformers}` |
>
> Task 4 的 `buildFingerprint` 要的是 `['model_path','device','dtype','torch','transformers']`。对着 Docker 服务会得到
> `model_path=|device=cuda|dtype=|torch=|transformers=` —— **5 段里 3 段空** ⇒ **检测不到 torch/transformers 版本升级、也检测不到精度变化**，而这正是指纹存在的理由。
> **修法**：给 Docker 的 `/health` 补 `model_path` / `dtype` / `torch` / `transformers`（与 Mac 同形）。**这是部署项目唯一必要的改动，其余不用动。**
>
> **6b. 🔴 解耦：主体工作在 question-bank 这边，不在部署项目那边**
> 部署项目**已经是一个干净的 HTTP 模块**（`/health` / `/encode-text` / `/encode-images`）✓。
> **真正的耦合是：question-bank 仓库里塞了它自己的一份编码器副本（三处）**：
> 1. `server/embed/embed_service.py` —— 服务的**第二份实现**（+ `requirements.txt` / `start.sh`）
> 2. `server/embed/build_index.py:25,52,56` —— **在进程内加载模型**（`from sentence_transformers import SentenceTransformer` / `model.encode(...)`），是**第三份**
> 3. `server/src/routes/embed.ts:8` —— `EMBED_SERVICE_URL`，**唯一干净的集成点** ✓
>
> **解耦要做的**：
> - `build_index.py` 改为**调 HTTP**（`POST {EMBED_SERVICE_URL}/encode-images`），删掉进程内 `SentenceTransformer` ⇒ 它不再需要 `torch` / `transformers` / `PIL`，只留 `numpy` + `sqlite3` + `base64`。**这同时解决了第 1 条里"没有为第二个引擎建库的路径"**（脚本变成"对任意编码服务建库"）。
> - `embed_service.py` / `requirements.txt` / `start.sh` **退休**，或降级为"可选的本地开发回退"。
> - `embed.ts:8` 的 `EMBED_SERVICE_URL` 保持唯一集成点，并补 `engineId → URL` 映射（第 1 条缺口）。
>
> **⚠️ 一个兼容点**：Docker 的 `/encode-images` **只接受 `data:` URI**（除非配 `WEMM_IMAGE_DIR`，而 runbook 明确"局域网暴露时应留空"）。`embed.ts` 的 `/image` 路由正好传 data URL ✓；但 `build_index.py` 现在是**直接读本地文件**（`Image.open`），改 HTTP 后**必须转成 data URI 再发**。
>
> **附**：Docker 服务支持 MRL 降维（`WEMM_DIM` ∈ 64/128/256/512/1024/2048），是一个可用的显存/精度权衡旋钮。

> **⚠️ 为什么必须新增这个任务**
> Tasks 1–10 交付了 `src/services/semantic/*` 的**全部模块**，但**没有任何生产代码在用它们**。实测（Task 11 实现者的探针输出）：
> - `window.SemanticService` 是 **`undefined`**（根本没挂载）
> - `putVector` / `writeManifest` / `switchTo` / `new SemanticRouter` 在**生产代码里调用点全为 0**（只有单测）
> - `refreshEmbeddings` 仍写旧的**单库** `embeddings` → `loadManifest()` 恒为 `null` → `state` 恒为 `absent` → **语义结果恒为空**
> - `service.ts:1` 导出的是**类**，而 Task 10 的测试钉死了 `SemanticService.name === 'SemanticRouter'` —— 单例实例无法与类同名共存，**挂载键必须另定**
>
> 原 Task 11 假定"门面已是绑定好引擎的单例并挂在 window 上"，该前提**不存在**。原 Step 2/3 照做会让基线 E2E 的 #1/#3 **必红**，与"5 条保持通过"的硬验收**自相矛盾**。故拆为两个任务：**本任务负责接线，Task 12 负责收编调用方**。

**Files:**
- Create: `src/services/semantic/engine-http.ts` —— `Engine` 的 HTTP 适配器（`probe` → `GET /api/embed/health?engineId=`，`encode` → `POST /api/embed/text` / `/image`）
- Create: `src/services/semantic/runtime.ts` —— 门面单例 + 挂载 + 引擎选择
- Modify: `src/data/embeddings.ts` —— `refreshEmbeddings` 改为**按引擎**拉向量并落库 + 提交 manifest（走两阶段提交）
- Modify: `src/main.ts` —— 把新模块加入 `assignToWindow()` 列表（**不是** `assignIfMissing`）
- Test: `unit-tests/semantic-runtime.spec.js`

**Interfaces:**
- Consumes: Task 4 的 `/api/embed/{vectors,engines,health,text,image}`、Task 6 的 `VectorStoreRegistry` / `storeNameFor`、Task 5 的 `beginBuild` / `commitBuild` / `PROBE_TEXT`、Task 9 的 `EngineBinding`、Task 10 的 `SemanticRouter`
- Produces:
  - `class HttpEngine implements Engine`
  - `createSemanticService(deps): SemanticRouter`
  - `initSemanticRuntime(): Promise<void>`
  - `w.SemanticService`（门面**实例**）、`w.semanticEngineId`（当前引擎 id）

> **⚠️ 四个设计参数的控制台裁定（2026-09-23，实现者按"不要自行改设计"停下是对的）**
> **① 挂载键**：`w.SemanticService` 必须是**门面实例**（`SemanticRouter` 的实例），**不是类**。类名 `SemanticService` 与 Task 10 的 `service.ts` 别名不冲突——后者是模块内部导出，前者是 window 上的实例。**不要**为了挂实例去改 `service.ts`。
> **② `spaceKey` 的客户端来源**：`/health` 提供 `dtype`（精度），`/vectors` 提供 `dim`。故客户端按固定格式拼：
> `${MODEL_TAG}:${dtype}:${dim}:l2:text+image`
> 其中 `l2` 与 `text+image` 是 **WeMM 服务的既定属性**（`embed_service.py` 恒做 L2 归一化、支持 text+image），作为本项目的**约定常量**写在 `runtime.ts` 里。理由：客户端拿不到"归一化口径"与"模态"的自述，硬编码这两个值是当前唯一可行且**可验证**的做法（Task 8 的自洽校验会独立确认空间未漂移）。
> **③ `sourceHash`**：本任务取 `hash(count + ':' + dim + ':' + engineFingerprint)`（简单确定性哈希即可，如 FNV-1a）。
> **明确边界**：这**检测不到**"题目数不变但内容被编辑"的情况——那需要服务端在 `/vectors` 里返回 `updated_at`。**在报告里如实标注这个边界**，不要假装它覆盖了。理由：宁可要一个边界清晰的弱保证，不要一个假装很强的弱保证。
> **④ 默认引擎 id**：`w.semanticEngineId` 取 `/engines` 返回的**第一个** id（该接口已排除 `legacy-default`）；用户切换后写入 `localStorage['semanticEngineId']`，下次启动优先读它。若 `/engines` 为空 → 不挂门面、不报错（静默降级为字面匹配，与现状一致）。
> **⑤ 建库时机与两阶段提交**：`refreshEmbeddings` 的顺序是
> **先拉后清**：`GET /engines` → `GET /vectors?engineId=X` → `encode(PROBE_TEXT)` → **然后才** `beginBuild(storeName)` → 逐条 `putVector` → `commitBuild(storeName, manifest)`。
> **manifest 必须最后写**——这正是两阶段提交的意义（中断留下"有向量无 manifest"，被判为库不存在而非误用）。
> **⚠️ 顺序修正（Task 11 实现者暴露，2026-09-23）**：初稿把 `beginBuild` 排在**拉取之前**。那样一旦网络失败，会**先把已有库清空、再留下一个空库** —— 把"刷新失败"从"旧库继续可用"退化成"库没了"。**先拉后清**让失败落在 `beginBuild` 之前，旧库完好。
> **失败语义**：`refreshEmbeddings` 在服务不可达时**不抛异常**，返回 0 并保留旧库（它是启动期的后台刷新，抛错会迫使每个调用方自己包 try/catch）。这与 `init-app.ts` 现在 fire-and-forget 的写法一致。

- [ ] **Step 1: 写失败测试**（`HttpEngine` 的 probe/encode 契约、`spaceKey` 拼接、`sourceHash` 确定性、`/engines` 为空时不挂门面）
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现上述 3 个文件 + 改 `embeddings.ts` / `main.ts`**
- [ ] **Step 4: 跑通单测 + `tsc` 0 错误**
- [ ] **Step 5: 真实链路探针**（AGENTS.md 第 2 层）：连真实 server 跑一次 `initSemanticRuntime()`，确认 manifest 真的落库、`switchTo` 得到 `ready`。不可达时 `test.skip` 守卫，**不得制造假失败**。
- [ ] **Step 6: 提交**

---

### Task 12: 收编调用方 + 旧库清理 + E2E 回归（原 Task 11）

**Files:**
- Modify: `src/ui/question-core.ts:145,147-212`
- Modify: `src/ui/question-detail.ts:138-160`
- Modify: `src/init-app.ts:55`
- Modify: `src/main.ts`（加入 `assignToWindow`）
- **Delete: `src/services/semantic.ts`** —— 消除与 `src/services/semantic/` 的同名歧义。
- Modify: `src/services/index.ts`（确认是 `export * from './semantic/index'` 显式路径）
- Test: `tests/engine-switch.spec.js`

> **⚠️ 影响面实测清单（2026-09-23，控制器用 ripgrep 逐条核实）**
> 旧文件 `semantic.ts` 导出 4 个符号，**实际消费方只有 3 个文件**（计划初稿只列了 2 个）：
> | 消费方 | 引用 | 处置 |
> |---|---|---|
> | `src/services/semantic-search.ts:3` | `{ cosineSimilarity, SemanticHit }` | 改指 `./semantic/invariants`（`cosineSimilarity`）与 `./semantic/types`（`Hit`） |
> | `src/data/embeddings.ts:4` | `{ decodeVector }` | 改指 `../services/semantic/invariants` |
> | `src/ui/question-detail.ts:4` | `{ cosineSimilarity }` | 该文件整体改为经门面（`service.searchSimilar`），不再直接算相似度 |
>
> **`mergeRankings` 是死代码 → 直接删除，不要迁入新模块。** 实测全仓库**零消费方**（只有定义处）。理由：把死代码搬进新模块只会被评审判为缺陷（YAGNI）。
>
> **⚠️ 一处计划初稿未提到的类型断裂**：`cosineSimilarity` 的签名在 Task 1 已从 `number` 改为 **`number | null`**（dim 不等返回 `null`）。上述两处直接调用它的代码（`semantic-search.ts:26`、`question-detail.ts:147`）**现在会类型报错**，必须显式处理 `null`（丢弃该条或按 0 分处理，并在报告里说明选择）。**不要用 `!` 断言绕过**——那正是 Task 1 要消灭的静默截断。
>
> **⚠️ 浏览器级验收项（Task 7 修复轮的遗留债）**：E2E 里必须有一条断言**「库里存在维度不符的向量时，应用降级而非挂起」**。Task 7 的对照实验证明的是**驱动控制流语义**（同进程、异步派发），**不是真实浏览器 + IndexedDB 端到端**；真实路径需在这里确认一次。

**Interfaces:**
- Consumes: Task 10 的 `SemanticService`
- Produces: 无新接口；调用方只依赖门面

> **⚠️ Task 11 必须保留的显式验收项（Task 7 修复轮建议，2026-09-23）**
> 1. **「dim 不符 → `build()` 应 reject 而非挂起」** —— Task 7 的对照实验证明的是**驱动控制流语义**（同进程、异步派发、抛错不推进游标 → Promise 悬挂），**不是真实 IndexedDB 端到端复现**。真实浏览器路径需在第 2 层（真实链路）或人工验收里确认一次。
> 2. **`count()` 少报导致的 `data.set` 越界仍走同一条悬挂路径** —— Task 7 只收口了 dim 校验这一个触发源；越界写入仍发生在回调内。要等 Task 6 的 `count()`/`iterate()` 口径统一（Task 6 的 deferred minor）。**验收时若 `count()` 与 `iterate()` 口径已统一，此路径自然消失；若未统一，必须显式验证。**

**D1 落实**：历史向量不做服务端迁移，客户端一次性清掉旧 `embeddings` store（v2 的单库结构），按新架构（`embeddings__<engineId>`）重新拉取。用一个 localStorage 标志位做一次性迁移，**不清空 `questions`/`notes` 等其他 store**。

- [ ] **Step 0: 一次性清理旧向量库**

在 `src/init-app.ts` 的初始化流程开头加：

```typescript
async function _dropLegacyEmbeddingStore(): Promise<void> {
  if (localStorage.getItem('embeddingsMigratedV3') === '1') return;
  const legacy = localforage.createInstance({ name: 'questionBank', storeName: 'embeddings' });
  await legacy.clear();
  localStorage.setItem('embeddingsMigratedV3', '1');
}
```

在 `initApp()` 中于 `void data.refreshEmbeddings()` 之前 `await _dropLegacyEmbeddingStore()`。

- [ ] **Step 1: 把新模块挂到 `assignToWindow`**

在 `src/main.ts` 中确认新模块的导出名走 `assignToWindow`（`main.ts:11-15`），**不得**落入 `assignIfMissing`（`main.ts:17-23`）。

- [ ] **Step 2: 收编 `question-detail.ts` 的绕路实现**

`showSimilarQuestions` 改为：

```typescript
export async function showSimilarQuestions(qId: string): Promise<void> {
  const res = await w.SemanticService.searchSimilar(qId, { topK: 6 });
  if (res.degraded) {
    w.showStatus(res.degraded.reason === 'store-absent' ? '该题在当前引擎的向量库中不存在' : '当前引擎的向量库未就绪', 'error');
    return;
  }
  renderSimilarList(res.hits);
}
```

- [ ] **Step 3: 阈值改为按引擎取**

`src/ui/question-core.ts:145` 的 `const SEMANTIC_MIN_SCORE = 0.25;` 改为从配置读：

```typescript
const minScoreFor = (engineId: string): number => {
  const raw = localStorage.getItem('semanticMinScoreByEngine');
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[engineId] ?? 0.25;
};
```

`enhanceWithSemantic` 内 `searchSemantic(queryVec)` 调用点改为经门面，并把 `degraded` 反映到 UI：

```typescript
const res = await w.SemanticService.search({ query: { kind: 'text', text }, minScore: minScoreFor(w.semanticEngineId) });
if (token !== _semanticToken) return;
if (res.degraded) { container.replaceChildren(); return; }
renderSemanticResults(container, res.hits, '语义相关');
```

- [ ] **Step 4: 写 E2E 用例（含可见性断言）**

```javascript
test('切换引擎后向量库同步切换，结果区可见', async ({ page }) => {
  await page.route('**/api/embed/vectors**', async (route) => {
    const url = new URL(route.request().url());
    const engineId = url.searchParams.get('engineId');
    await route.fulfill({ json: { engineId, model: 'wemm-embedding-2b', count: 1, embeddings: [
      { question_id: 'q-001', dim: 2048, vector: Buffer.from(new Float32Array(2048).fill(0.01)).toString('base64') },
    ] } });
  });
  await page.goto('/');
  await page.evaluate(() => window.SemanticService.search({ query: { kind: 'text', text: '三角形的面积' } }));
  await assertVisiblyRendered(page, '#semantic-results', '语义结果区');
});
```

- [ ] **Step 5: 跑本地验证循环**

```bash
NODE_OPTIONS= npm run typecheck
NODE_OPTIONS= npm run test
NODE_OPTIONS= npm run build
NODE_OPTIONS= npx playwright test --workers=1 --reporter=list --output=tmp/test-results-engine-switch
```
Expected: 四项全绿；现有 `tests/semantic-search.spec.js` 5 用例保持通过（**重构基线**）

- [ ] **Step 6: Read 截图确认**

打开 `tmp/test-results-engine-switch/` 下的截图，**实际目视确认**语义结果区可见、无白字白底。不得只看测试变绿（AGENTS.md E2E 截图评估要求）。

- [ ] **Step 7: Commit**

```bash
git add src/ui/question-core.ts src/ui/question-detail.ts src/init-app.ts src/main.ts src/services/index.ts tests/engine-switch.spec.js
git commit -m "refactor(semantic): 调用方收编为门面，阈值按引擎分桶"
```

---

## 八·补. 重新制定的后续计划（2026-09-24 王先生要求）

> **🔴 优先级重排（2026-09-24 王先生：「我想立刻用上语义检索」）**
> **关键路径 = Task 14 → Task 12**，其余任务**都不在这条路上**：
> | 要用上语义检索，需要 | 由哪个任务提供 | 状态 |
> |---|---|---|
> | 一个能用的引擎 | Linux Docker WeMM（已部署、已开 LAN） | ✅ 用户侧已就绪 |
> | **为它建库** | **Task 14**（`build_index.py` 改走 HTTP） | ⏳ **下一站** |
> | 服务端按引擎分流 | Task 15 | ✅ 已完成 |
> | **客户端真的用起来** | **Task 12**（收编调用方 + 删旧文件 + E2E） | ⏳ 最后 |
> | Mac 那台的内存门槛 | Task 17 | 与"用上检索"**无关**（走 Linux 就不需要） |
> ⇒ **执行顺序：14 → 12 → 17。** Task 17 是 Mac 侧的独立改进，可后置。

> **触发**：王先生明确两件事——① **Mac 保留裸机 MPS，Linux/Fedora 用 Docker 引擎**；② **两个引擎都只与调用层打交道**（调用层不需要知道背后是谁）。
>
> **🔴 一条重要更正：两个引擎不需要「对齐」**
> 控制器先前反复说"对齐必须实测"，**在多引擎架构下这个要求不成立**。因为「库与引擎一一绑定」意味着：
> - `engineId = 'mac-mps'` ⇒ **自己的**一份库（用 Mac 服务建）
> - `engineId = 'linux-cuda'` ⇒ **自己的**一份库（用 Linux 服务建）
> - Router 每次只用一个引擎 + **它自己那份库**，**永不跨空间比较**
> ⇒ **两个栈（MPS vs CUDA、有无 fp32 补丁）并存完全没问题**，代价只是**建两次库、存两份**（2048 维各约 40MB）。
> `verify_space_alignment.py` **仅在一种情况下才需要**：想**共享**同一份库给两个引擎（本设计不做）。⇒ **默认不做。**
>
> **⚠️ 内存事实（2026-09-24 实测，决定 Mac 的定位）**
> 本机 Mac 是 **16 GB M4**，而**在模型未加载时**就已 `swap used 4.19GB / 5.12GB`、空闲页仅 84 MB、累计 Swapouts ≈ 75 GB。**即：机器本来就处在内存超配状态**（开发栈压出来的），模型那 ~5.7 GB 是**压垮的最后一根稻草** ⇒ 彩球。
> **两个防误判**：**`WEMM_DIM` 不解决内存**（只缩向量库 40MB→10MB，4GB 权重不动）；**fp32 补丁不解决内存**（是算力修复，且让该层占用翻倍）。
> **能治内存的只有两件**：① 模型不在这台机器上跑（→0）；② 缩短 `WEMM_IDLE_UNLOAD_SECONDS`（决定 5.7GB 何时归还）。

---

### Task 13: 引擎调用契约收敛 + 契约一致性测试

**为什么需要**：调用层要"不认识背后是谁"，两个引擎就必须**接口形状完全一致**。实测差异（见 Task 11 的 6e 表）：Linux `/health` 缺 4 个指纹字段、Mac `/encode-images` 接受任意路径（Linux 已收口）、请求上限不一致。

**Files:**
- Create: `docs/engine-http-contract.md` —— **引擎 HTTP 契约的唯一权威文档**
- Create: `server/embed/tests/test_engine_contract.py` —— **契约一致性测试**（对任意 `EMBED_SERVICE_URL` 都能跑）
- Modify: `server/embed/embed_service.py`（Mac 侧）—— `/encode-images` 收紧为只接受 `data:` URI（**顺带修掉任意文件读取**）；请求上限与 Linux 对齐
- Test: `server/embed/tests/test_engine_contract.py` 自身即验证手段

**Interfaces:**
- Consumes: 无
- Produces: 契约文档 + 可对任意引擎实例执行的契约测试

**步骤**
- [ ] **Step 1**: 写契约文档，钉死：三条路由、`/health` 的**必需字段集**（`ok` / `device` / `model_loaded` / `model_path` / `dtype` / `torch` / `transformers`）、`/encode-*` 的请求体（`{texts: string[]}` / `{images: string[]}`）与响应体（`{dim, vectors}`）、错误码（400 参数 / 413 过大 / 422 校验 / 503 不可用）
- [ ] **Step 2**: 写 `test_engine_contract.py`：读 `EMBED_SERVICE_URL`（默认 `http://127.0.0.1:3002`），**不可达则 `skip`**；断言上述每一条。**两个引擎各自跑一遍都必须全绿。**
- [ ] **Step 3**: 对 Mac 服务跑一次 → 记录红项
- [ ] **Step 4**: 改 `embed_service.py` 让红项变绿（`/encode-images` 只接受 `data:` URI；补请求上限）
- [ ] **Step 5**: 重跑至全绿
- [ ] **Step 6**: 提交

> **⚠️ 用户侧前置（不在本仓库）**：Linux `deploy/wemm/app.py` 的 `/health` 补 `model_path` / `dtype` / `torch` / `transformers`。**改完对 Linux 跑同一份 `test_engine_contract.py` 必须全绿。** 这是部署项目唯一必要的改动。

---

### Task 14: `build_index.py` 改走 HTTP（解耦第三份编码器副本）

**为什么需要**：`build_index.py:25,52,56` **在进程内加载模型**（`from sentence_transformers import SentenceTransformer`），是编码器的**第三份副本**。它同时造成两个问题：① 与"引擎是可替换的外部服务"这一目标矛盾；② **没有为第二个引擎建库的路径**（`MODEL_PATH` 写死本机）。

**Files:**
- Modify: `server/embed/build_index.py`
- Modify: `server/embed/tests/test_build_index.py`
- Modify: `server/embed/requirements.txt`（删 `torch` / `transformers` / `sentence-transformers` / `PIL`；留 `numpy` / `requests`）

**Interfaces:**
- Consumes: Task 13 的契约（`POST {EMBED_SERVICE_URL}/encode-images`）
- Produces: CLI `python build_index.py <db_path> --engine-id <id> [--service-url <url>] [--force]` —— **对任意编码服务建库**

**步骤**
- [ ] **Step 1**: 写失败测试（mock 一个 HTTP 编码服务，断言脚本按 `data:` URI 提交、并把返回向量按 `engine_id` 落库）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：删掉 `SentenceTransformer` 与 `PIL` 依赖；把每张 `question_image_url`（本来就是 `data:` URI，见 `build_index.py:31`）直接 POST 给 `/encode-images`；批量/重试策略按简报
- [ ] **Step 4**: 跑通单测 + 全量
- [ ] **Step 5**: 提交

> **注意**：`question_image_url` 已经是 `data:` URI（`build_index.py:31` 就是按这个过滤的）⇒ **不需要做路径→data URI 的转换**，直接转发即可。这消掉了控制器先前担心的那个兼容点。

---

### Task 15: 服务端 `engineId → 编码服务地址` 映射

**为什么需要**：这是"两个引擎"能否成立的关键。现状 `server/src/routes/embed.ts:8` 是**单一** `EMBED_SERVICE_URL`，后果在 `/engines` 上很直观：它 `SELECT DISTINCT engine_id` 列出所有引擎，却**只探这一个服务**，然后把**同一个指纹盖给每个 id**（Task 4 评审曾记为 Minor，实为这个缺口的症状）。

**Files:**
- Modify: `server/src/routes/embed.ts:8`（+ `/text` `/image` `/engines` `/health` 四个路由）
- Modify: `src/services/semantic/engine-http.ts`（`/text` `/image` 带上自己的 engineId）
- Modify: `server/.env.example` 或 `docs/`（记录配置形式）
- Test: `server/test/embed-route.test.ts`

**Interfaces:**
- Consumes: 各引擎的编码服务 URL
- Produces:
  - 配置形式 `EMBED_SERVICE_URL__<ENGINE_ID>`（例：`EMBED_SERVICE_URL__MAC_MPS`），回退到 `EMBED_SERVICE_URL`
  - `embedBaseFor(engineId): string`
  - `GET /api/embed/engines` → **每个引擎各自探活、各自指纹**（不再一个指纹盖全部）
  - `GET /api/embed/health?engineId=X` → 探 **X 自己的**服务
  - **`POST /api/embed/text?engineId=X`** 与 **`POST /api/embed/image?engineId=X`** → 转发到 **X 自己的**编码服务（缺 `engineId` 时回退到 `EMBED_SERVICE_URL`，保持向后兼容）
  - `GET /api/embed/vectors?engineId=X` → 不变（读表，与 URL 无关）

> **⚠️ 范围修正（控制器 2026-09-24 发现）**：初稿只写了 `/engines` 与 `/health` 要按引擎分流，**漏了 `/text` 与 `/image`**。
> 但客户端 `engine-http.ts` 是**每个引擎各建一个 `HttpEngine`**（`makeEngine(info)`），而它 `encode()` 打的 `/api/embed/text` **不带 engineId** ⇒ 服务端只能用那唯一的 `EMBED_BASE` ⇒ **`linux-cuda` 的文本查询会打到 Mac 那台**，拿回来的向量属于**另一个空间**。
> 这正是整套「库与引擎一一绑定」要防的**静默跨空间**，且**不会报错**（两边都是合法向量，只是空间不同）。**必须一并修。**

**步骤**
- [ ] **Step 1**: 写失败测试（两个 engineId 配两个不同 URL 的桩服务，断言 ①`/engines` 返回**两个不同指纹** ②`/health?engineId=X` 打到 X 的服务 ③**`/text?engineId=X` 打到 X 的服务** ④缺 `engineId` 时回退到默认 URL）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现 `embedBaseFor` 与四个路由的分流；`fetchEngineHealth(engineId)` 加参数
- [ ] **Step 4**: 改 `engine-http.ts` 的 `encode()`，在 `/api/embed/text` 与 `/api/embed/image` 上带 `?engineId=${encodeURIComponent(this.id)}`；同步补客户端单测
- [ ] **Step 5**: 跑通 + `tsc` 0 错误
- [ ] **Step 6**: 提交

> **📋 配置方式（王先生部署时要照着填）**
> 引擎 id **转大写、非字母数字一律换成 `_`**，前缀 `EMBED_SERVICE_URL__`：
> | engineId | 环境变量 |
> |---|---|
> | `mac-mps` | `EMBED_SERVICE_URL__MAC_MPS` |
> | `linux-cuda` | `EMBED_SERVICE_URL__LINUX_CUDA` |
> 未配专属变量时**回退**到 `EMBED_SERVICE_URL`（单引擎部署的向后兼容）。
>
> **⚠️ 两条配置陷阱（Task 15 评审 Minor，已登记）**
> 1. **该命名不是单射**：`mac-mps` / `mac_mps` / `mac.mps` 会**映射到同一个变量名**。⇒ **engineId 必须在该规范化下唯一**；否则两个引擎静默共用同一个 URL。**建议 id 只用小写字母 + 连字符。**
> 2. **专属变量缺失时静默回退默认**（plan-mandated，为向后兼容）⇒ 两个引擎时**忘配一个**，该引擎的请求会打到默认服务 ⇒ 拿到**另一个空间**的向量。
> **部分安全网**：Task 8 的自洽校验会拦——引擎探针向量与 `manifest.probeVector` 的 cos < 0.99 ⇒ 判 `stale` ⇒ 拒绝服务。**但这只在"建库时路由正确、查询时路由错误"时有效**；若两端**一致地**错，则不会报错，只是引擎被贴错标签。
> **未来改进建议**：改用**显式 JSON 映射**（`EMBED_SERVICE_URLS={"mac-mps":"http://…","linux-cuda":"http://…"}`）——**构造上单射**，无规范化歧义，也更好文档化。
>
> Task 15: minor (deferred): `embed.ts:59` 的 `embedBaseFor` 被 `export` 但无消费者。

---

### Task 16: Mac 引擎「启动即死机」的内存保护（**新增，2026-09-24 王先生提出**）

> **🔴 问题**：Mac 上**一启动引擎就死机**（不是"慢"，是整机无响应）。控制器先前在对话里提过 `torch.mps.set_per_process_memory_fraction(...)`，但**从未写进计划**——这是控制器的遗漏，现补上。

**已核实的事实（2026-09-24 实测，非推测）**

| 项 | 值 |
|---|---|
| torch 版本 | **2.14.0**，`torch.backends.mps.is_available()` = True |
| **API 存在性** | `torch.mps.set_per_process_memory_fraction` / `recommended_max_memory` / `empty_cache` / `current_allocated_memory` / `driver_allocated_memory` **全部存在** ✅ |
| `recommended_max_memory()` | **11.84 GiB**（12124 MiB）—— 16 GiB 机器的 ~74% |
| fraction → 上限 | 0.5 → 5.92 GiB｜0.6 → 7.10｜0.7 → 8.29｜0.8 → 9.47 |
| 模型常驻需求 | 约 **5.7 GiB**（Linux 实测峰值 5828 MiB） |
| 整机 | 16 GiB，空闲页仅 84 MB，swap 已在用（曾达 4.19 GB） |
| 现有保护 | `embed_service.py:84-85` **已有** idle-unload 时的 `torch.mps.empty_cache()` ✅ |
| **缺的** | **加载那一瞬间没有任何上限** ⇒ 默认 11.84 GiB 的上限高得毫无保护作用 |

**为什么"启动就死机"（第一性原理）**
加载 = 读 ~4 GB 权重 → 构建模型 → 搬到 MPS。在**已超配**（空闲 84 MB、swap 已用数 GB）的 16 GiB 机器上，这一步要**新增 ~5.7 GiB 常驻**，macOS 必须**驱逐**差不多同样多的其它常驻页 ⇒ 压缩器 + swap I/O 同时饱和 ⇒ **整机阻塞**。
**待验证的假设（必须实测，不要当成结论）**：加载过程可能**瞬时需要约 2×**（CPU 暂存副本 + MPS 副本）。若成立，峰值 ~11 GB，**这解释了"启动即死机"而不仅仅是"变慢"**。

**设计（三步，顺序不能反）**

**① 先加可观测性** —— `/health` 增加三个字段（**这是选阈值的唯一依据，必须先有**）：
- `mps_recommended` = `torch.mps.recommended_max_memory()`
- `mps_driver_allocated` = `torch.mps.driver_allocated_memory()`
- `mps_current_allocated` = `torch.mps.current_allocated_memory()`
（非 MPS 设备时三者为 `null`）

**② 加可配置上限** —— `WEMM_MPS_MEMORY_FRACTION`（默认**不设**，保持 PyTorch 默认行为；**在 MPS 上、加载模型之前**调用 `torch.mps.set_per_process_memory_fraction(f)`；并在加载前先 `empty_cache()`）。

**③ 用测量结果定阈值** —— 步骤：
1. 先设一个**故意偏低**的 fraction（如 0.5）→ 观察加载**是否报错**（报错=上限生效）还是**成功**
2. 若成功，读 `/health` 的 `mps_driver_allocated` 看**真实峰值**
3. 把 fraction 设到**略高于实测峰值**（留 ~15% 余量）
4. 若即使 0.5 也不够 ⇒ **说明这台机器跑不动这个模型**，不要靠调参硬上

> **⚠️ 上述"读 `/health` 取峰值"的方法有缺陷（控制器 2026-09-24 复核实现者的步骤后指出）**
> 读 `/health` 只能在**加载完成之后**读，拿到的是**稳态占用**；而**冻结发生在加载那一瞬间的峰值**。若加载瞬时真的接近 2×（本任务标注的待验证假设），**稳态读数会系统性低估峰值** ⇒ 阈值设低了 ⇒ 加载直接失败。
> **更可靠的方法：对 fraction 做二分，找"仍能加载成功的最小值"。**
> 理由：它直接测的正是你在意的那个问题（**这次加载放得下吗**），**不需要捕捉瞬时峰值**，也不依赖 `/health` 的读取时机。
> 做法：0.5 失败 → 试 0.6 → 试 0.7 …… 找到**第一个能成功加载**的值，那就是峰值所在的比例（略低一档即为下界）；最终值取它**再留 ~15% 余量**。
> 另可用 `sudo footprint -p <PID>` 或 `vmmap` 在加载期间观测进程 RSS，作为交叉验证（含非 MPS 部分，比 `/health` 更全面）。
> **测试期间 Mac 引擎不可用**（要先停掉 3002 那个别的 worktree 的进程——那正是冻结的触发条件）。

> **⚠️ 必须诚实区分两件事（控制器提醒）**
> - **「防死机」（机器存活）** ⇒ 上限**能做到**：超限时进程**报错**，而不是让 OS 把整机拖进 swap。**这正是王先生问的那个"办法"。**
> - **「让引擎在这台机器上可用」** ⇒ 上限**做不到**。峰值超了就是超了，引擎会**加载失败**。要让它可用必须**降低峰值**（或**不在这台机器上跑**）。
> 不要把"防死机"说成"解决了卡顿"——它们是两件事。

**Files:**
- Modify: `server/embed/embed_service.py`
- Test: `server/embed/tests/test_mps_guard.py`（**不得加载真实模型** —— 用 monkeypatch 断言 `set_per_process_memory_fraction` 被以正确参数调用、`/health` 字段形状正确）

**步骤**
- [ ] **Step 1**: 写失败测试（monkeypatch `torch.mps`，断言 ①设了 `WEMM_MPS_MEMORY_FRACTION` 时该 API 被以对应 fraction 调用 ②非 MPS 设备时**不调用** ③`/health` 三个字段存在且非 MPS 时为 null）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现三步设计
- [ ] **Step 4**: 跑通 + 全量 pytest
- [ ] **Step 5**: **不要重启 3002**（那是别的 worktree 的进程）；报告里给出**用户侧实测步骤**（怎么设 fraction、怎么看 `/health` 取峰值、怎么定最终值）
- [ ] **Step 6**: 提交

> **⚠️ 不要在本机启动第二个服务实例来验证**（本机已有模型在内存里、正在 swap；再加 5.7 GiB 会直接触发你要修的那个问题）。验证靠**单元测试 + monkeypatch**，真实峰值由用户在方便时自测。

---

### Task 17: 加载前内存门槛 + 确认按钮 + UI 可调阈值（**新增，2026-09-24 王先生设计**）

> **为什么这个设计比 Task 16 的"阈值标定"更对**：标定是**一次性猜一个数**，而机器状态**每时每刻在变**。王先生要的是**每次加载前看当前状态**——这才能真的防住。

**🔴 北极星指标 = `Compressed`（压缩内存占用），不是"内存占用"**

**本机实测（2026-09-24，模型未加载时）**：

| 分量 | 值 | 占物理内存 |
|---|---|---|
| 物理内存 | 16.0 GiB | — |
| **Free** | **0.07 GiB** | 0.4% |
| File-backed（**可回收**） | 1.93 GiB | 12% |
| Anonymous | 3.66 GiB | 23% |
| **Compressed** | **7.03 GiB** | **44%** |
| Wired（不可换出） | 2.79 GiB | 17% |
| Swap 已用 | 2.67 GiB | — |

**关键细节**：压缩器里装的是 **8.62 GiB 数据压到 7.03 GiB —— 压缩比仅 1.23:1**。压缩比这么差意味着**压缩器在拼命干活却收效甚微**，那正是 CPU 被烧掉、彩球转起来的直接原因。

**为什么选它**：它直接度量**"系统已经在为内存受苦的程度"**。
**为什么"内存占用"会误导**：Activity Monitor 的 `Memory Used` **含 Cached Files**，而那部分**可回收、让出去几乎无代价**（只是以后重新读盘）⇒ 用它判断会**高估**压力。
**`Swap Used` 是升级信号**：出现换页说明压缩已不够用。

**门槛（三条，本机当前全部不过 ⇒ 这就是"启动即死机"的确切机制：不是加载慢，是系统无处可腾）**

| 条件 | 阈值 | 本机当前 |
|---|---|---|
| **硬**：Swap Used | ≈ 0 | 2.67 GiB ❌ |
| **软**：Free + File-backed | ≥ 模型需求 × 1.5 ≈ 8.6 GiB | 2.00 GiB ❌ |
| **北极星**：Compressed 占比 | < 25% of 物理内存 | **44%** ❌ |

**机制（关键点：不能"点一下就绕过"）**
- 服务在 `GET /` 提供**自包含状态页**：实时显示上述指标 + 模型需求 + 当前门槛
- **确认按钮仅在指标达标时可点** ⇒ "确认"是**确认你已腾出内存**，而不是**覆盖检查**
- 门槛值**页面上可改、即时生效**，持久化到本地文件（重启不丢）
- 点过确认后**允许一次加载**（一次性放行）
- 加载尝试时门槛不达标 ⇒ **拒绝加载并返回 503**，附"还差多少、该关什么"
- **边界**：该门槛**只在统一内存（MPS / CPU）上生效**；Linux 是 CUDA + 独立显存，不适用

**Files:**
- Modify: `server/embed/embed_service.py`（`GET /` 状态页 + `POST /memory/allow` + `POST /memory/threshold` + 加载前门槛检查）
- Test: `server/embed/tests/test_memory_gate.py`（**不得加载真实模型**，monkeypatch 内存指标）

**步骤**
- [ ] **Step 1**: 写失败测试（门槛不过 ⇒ 拒绝加载且返回 503 带指标；指标达标但**未点确认** ⇒ 仍拒绝；达标 + 已确认 ⇒ 放行一次；非统一内存设备 ⇒ 不启用门槛）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现状态页 + 两个端点 + 门槛检查
- [ ] **Step 4**: 跑通 + 全量 pytest
- [ ] **Step 5**: 提交

> **⚠️ 与 Task 16 的关系**：Task 16 交付的 `WEMM_MPS_MEMORY_FRACTION`（硬上限）与本任务是**互补的两层**——门槛是**事前预防**（别在没余量时加载），上限是**事后兜底**（万一还是超了，报错而不是拖死整机）。**两层都要保留。**

---

## 九、自检

**1. Spec 覆盖**

| Spec 要求 | 归属任务 |
|---|---|
| 每引擎一库、一一绑定 | Task 3（建库）、Task 6（存储） |
| 库按引擎物理隔离 | Task 6 |
| 切换引擎时库同步切换 | Task 9 |
| 绑定不靠约定（provenance） | Task 5（manifest）、Task 8（自洽校验） |
| 引擎指纹可获取 | Task 4 |
| 服务端能存多引擎向量 | Task 2 |
| 阈值按引擎分桶（A6） | Task 11 |
| 维度硬失败（A4 / Review Focus 5） | Task 1、Task 7（query 维度不符返回空） |
| 半库识别（A7 / Review Focus 4） | Task 5 |
| 库引擎错配防护（Review Focus 1） | Task 9 |
| 引擎静默升级检测（Review Focus 2） | Task 8 |
| 库未就绪显式降级（Review Focus 3） | Task 10 |
| **D1** 历史向量不迁移、客户端重建 | Task 2（非破坏保留）、Task 11 Step 0（旧 store 清理） |
| **D3** 不做自制 LRU；显式移除；容量观测 | Task 6（`remove` + `storage.ts`） |
| **D4** 建库不静默、内联提示 | Task 10（`degraded.detail` + `estimateBuildMinutes`） |
| **D5** 整库常驻内存、消除游标扫描 | Task 7（`FlatVectorIndex`）、Task 9（binding 构建 index）、Task 10（rank 打内存） |
| 增量建库（C2 / A16） | Task 3 |
| 容量压力提示（C1，替代 LRU） | Task 6（`STORAGE_WARN_RATIO`），UI 接入留待设置页任务 |

**2. Placeholder 扫描**：已扫，无 TBD / TODO / "类似 Task N" / 无代码的代码步骤。Task 2 的 `ensureEmbeddingsTableShape` 与 Task 9 的 `service.ts` 为明确的一行转发，已给出内容。

**3. 类型一致性**：`StoreManifest` / `ActiveBinding` / `StoreState` / `Engine` / `VectorStore` / `SearchResult` 全部在 Task 1 的 `types.ts` 定义，后续任务只引用不重定义。`cosineSimilarity` 返回 `number | null` 的签名在 Task 1 定义、Task 7 使用，一致。`storeNameFor()` 在 Task 6 定义，命名在 Task 5/6/8 一致。

**4. Review Focus**：五条已在 §Review Focus 列出，且各自指派到 Task 1 / 5 / 7 / 8 / 9 的测试。

---

## 十、待确认

1. **Task 2 的迁移策略**：历史向量归到 `engine_id = 'legacy-default'` 是否可接受？还是直接清空重建成当前引擎的库（更干净，但需重跑一次建库）？
2. **`engineFingerprint` 的字段集**：`model_path | device | dtype | torch | transformers | quant` 是否够？是否要加入模型权重的 sha256（更准但需读取 4.79GB）？
3. **LRU 淘汰的容量预算**：默认保留几个引擎的库？触发淘汰的阈值（按条数还是字节）？
4. **切换 UX**：切到 `absent` 引擎时，是"自动后台建库并继续用旧引擎"，还是"阻塞提示并让用户选择"？
5. **是否批准开工**：依据 AGENTS.md，**方案批准 ≠ 开工批准**。需要你说出「开始执行计划」我才动代码。
