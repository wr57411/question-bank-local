# 语义匹配模块化抽象与多来源路由 —— 设计方案（v2）

> 状态：**待确认**（本文档仅为方案，未改任何代码）
> v1 已按 2026-09-22 的 Q1–Q5 答复修订，本版为 **v2**
> 关联文档：`docs/wemm-embedding-fingerprint.md`（模型指纹与跨运行时对齐清单）
> 前置文档：`docs/semantic-search-wemm2b.md`（现状功能）、`docs/plans/2026-09-15-semantic-search.md`（原始实施计划与评测依据）

---

## 0. v2 修订摘要

| 项 | v1 的说法 | v2 的修订 | 依据 |
|---|---|---|---|
| 来源语义 | Source = (Encoder, Corpus) 绑定对 | **Source = 提供向量能力的服务端点**；Corpus 与 Source **解耦**，全局一份 | Q1：来源是"提供向量合成和向量匹配的服务" |
| 路由对象 | 可能换模型 | **只换端点，不换模型**；所有来源共享同一 `spaceKey` | 「他们只是系统不一样，用的仍然是同一个模型」 |
| 切换副作用 | 换来源 ⇒ 语料作废重建 | **语料永不作废**；来源与语料空间不一致 ⇒ **拒绝该来源**（配置错误） | 同上 |
| 云来源 | 保留但默认关 | **删除**，不做云端来源 | Q2：没有免费提供该模型的云服务 |
| 隐私闸门 | `uploadsData` 参与 L0 | 删除；L0 改为**可达性**（本机 / 局域网） | Q2 |
| 阈值分桶 | 按 `spaceKey` 分桶 | 按 `spaceKey` 分桶，**不叠加 `corpusId`** | Q5 |
| **对齐闸门** | 无 | **新增**：来源必须通过黄金向量对齐（cos ≥ 0.99）才准入 | 本轮实测：同一模型、同一文本，仅输入格式不同 → cos **0.8870** |
| 路由粒度 | 按来源 | **按 (来源 × 模态)** —— 同一空间内模态能力可能不对称 | 实测：LM Studio 的 `/v1/embeddings` 仅支持文本 |
| 阶段 0 | 纯重构、行为零变化 | 不变，**已接受** | Q4 |

---

## 1. 现状盘点（只读排查结论，附证据位置）

现有语义能力**已经在跑，但耦合在调用点里**，没有模块边界：

| 关注点 | 当前位置 | 问题 |
|---|---|---|
| 编码（文字/图片） | `src/services/semantic-search.ts:5,14` | 硬编码 `/api/embed/text`、`/api/embed/image`；失败 `catch → null` 静默 |
| 排序 | `src/services/semantic-search.ts:23-28` | 每次调用 `getAllVectors()` 全量解码 + 全量扫描 |
| 相似度 | `src/services/semantic.ts:8-14` | `Math.min(a.length, b.length)` **静默截断维度** |
| 语料存储 | `src/data/embeddings.ts:15-32` | `refreshEmbeddings` 先 `clear()` 再逐条 `set()`，**刷新期间语料为空** |
| 索引刷新 | `src/init-app.ts:55` | fire-and-forget，失败被吞 |
| 阈值 | `src/ui/question-core.ts:145` `SEMANTIC_MIN_SCORE = 0.25` | 业务常量硬编码在 UI 层 |
| 结果渲染 / 竞态 | `src/ui/question-core.ts:136-212` | token 机制在 UI 层，模块层无取消语义 |
| 「找相似题」 | `src/ui/question-detail.ts:138-147` | 绕过 `semantic-search`，自己 `getAllVectors` + `cosineSimilarity` |
| 服务端转发 | `server/src/routes/embed.ts:8-9` | `EMBED_BASE`、`MODEL_TAG` 写死在路由文件 |
| 建库 | `server/embed/build_index.py:11` | `MODEL_TAG` 与路由里的**是两处独立字面量**，靠人工保持一致 |

**结论**：不是"要抽象"，而是**已经在承受没有抽象的代价**——同一个 `MODEL_TAG` 两处各写一遍、相似度函数静默容错、索引刷新与查询之间没有一致性保护。多端点会把这些问题放大。

---

## 2. 第一性原理：语义匹配的构成与六条不变量

先问：**语义匹配这个行为，最少由哪些不可再分的步骤组成？** 三步，缺一不可。

```
① Represent   f: Input → ℝ^d       把 query 和库项映射到同一个可比较空间
② Index       S: id → v            库项的表示被预先算好并持久化
③ Rank        r: (v_q, S, k, τ)    打分并取 top-k
```

由此推出**六条不变量**。模块的每个接口设计，都是为了**让违反不变量变得不可能，或者变得显式**：

| # | 不变量 | 违反后的现象 | v2 对策 |
|---|---|---|---|
| **I1** | **同空间性**：`r` 的两个输入必须来自同一个 `f` 及其同一版本 | 不报错，只给出「看起来合理」的垃圾分数 | `spaceKey` 断言 **+ 对齐闸门**（§6） |
| **I2** | **维度一致**：`dim` 不等必须硬失败 | 静默按短的截断做点乘（**当前已存在**，`semantic.ts:10`） | dim 不等即返回 `null`，由 Router 转 `degraded` |
| **I3** | **归一化口径一致**：cosine 与 dot 不可混用 | 分数系统性偏移，阈值失效 | 归一化方式写进 `spaceKey`；探针实测模长 |
| **I4** | **索引与编码器版本绑定** | 新 query 打旧向量，全库失真 | `spaceKey` 不一致的来源**拒绝准入**（v2 不再作废语料） |
| **I5** | **能力协商**：端点未必支持全部模态 | 用纯文本端点做「以图搜题」→ 必然失败 | 路由**先按模态过滤**（§5.2） |
| **I6** | **失败必须显式**：降级不是"没结果"，是"另一种结果" | 用户以为没搜到，其实是服务挂了（**当前已存在**） | 返回值携带 `degraded` 原因，调用方必须处理 |

> **v2 的关键认知升级**：v1 把 I1 当作"运行时断言"。本轮实测证明这不够——**同一个模型、同一份权重、同一个文本，仅因输入格式不同，余弦就从 0.9976 掉到 0.8870**，而两者末位 token 都是 `<embedding>`，光看池化方式根本看不出问题。
> 所以 I1 必须从"断言"升级为**准入验证**：来源必须先证明自己落在同一空间，才被允许进入候选集。

---

## 3. 来源的定义（v2）

```
Source（来源） ≜ 一个能提供向量能力的服务端点
  ├─ Encoder   必须实现 —— 向量合成
  ├─ Ranker    可选实现 —— 若端点自带匹配/ANN 检索，则用远端 Ranker；
  │             否则用本地 BruteForce（现状）
  └─ capabilities: 支持的模态、dim、归一化口径、是否需网络、实测延迟

Corpus（语料） ≜ 共享单例，与 Source 解耦（题库只有一份）
  └─ 所有 Source 必须声明与 Corpus 相同的 spaceKey，否则拒绝准入
```

**v2 与 v1 的结构差异**：v1 把 Corpus 绑在 Source 里，于是"换来源"必然牵连语料。v2 明确：**来源是"谁来算"，语料是"算什么"**，两者正交。来源可以换很多个，语料始终一份。

**来源清单（当前 + 规划）**：

| id | 位置 | 模态 | 状态 |
|---|---|---|---|
| `local-mac` | 本机 macOS，Python + sentence-transformers，`:3002` | text + image | 现有，生产在用 |
| `lan-lmstudio` | 局域网 Linux，LM Studio | **text only**（见 §5.2） | 规划中 |

---

## 4. 分层与目录结构

放在 `src/services/semantic/`，遵循项目既有分层约定（services 层，`index.ts` 统一导出）：

```
src/services/semantic/
  index.ts            # 只导出门面与类型，不导出内部实现
  types.ts            # 全部对外类型：SearchRequest / SearchResult / Hit / SpaceKey
  service.ts          # SemanticService 门面：唯一对外入口
  router.ts           # Router：L0 gate → L1 policy → L2 fallback chain
  registry.ts         # 显式注册表（source / corpus / ranker）
  conformance.ts      # 对齐闸门：黄金向量验证（§6）
  config.ts           # 四层配置合并 + localStorage 读写
  invariants.ts       # spaceKey 构造与断言、dim 校验、向量缓存（I1-I4 的落点）
  rankers/
    brute-force.ts    # 现有逻辑（余弦暴力扫），默认实现
  sources/
    local-mac/
      encoder.ts
      corpus.ts
    lan-lmstudio/     # 新增来源时目录即模板
      encoder.ts
```

**关键取舍：显式注册，不用自动扫描。** 理由三条：(1) 客户端 bundle 大小可控；(2) 避免 import 副作用引入循环依赖（本项目 `main.ts` 已有大量 `assignToWindow` 顺序依赖）；(3) 测试可注入 mock（现有 E2E 走全 mock 路线）。

---

## 5. 对外接口与路由机制

### 5.1 门面（唯一对外入口）

```ts
interface SemanticService {
  search(req: SearchRequest): Promise<SearchResult>;
  searchSimilar(id: string, opts?: SimilarOptions): Promise<SearchResult>;
  capabilities(req?: { modality?: Modality }): Promise<CapabilityReport>;
  refresh(signal?: AbortSignal): Promise<RefreshReport>;
  sources(): Promise<SourceStatus[]>;   // v2 新增：来源健康与对齐状态（供设置页/排障）
}

interface SearchRequest {
  query:
    | { kind: 'text'; text: string }
    | { kind: 'image'; dataUrl: string }
    | { kind: 'vector'; vector: Float32Array; spaceKey: SpaceKey };
  topK?: number;
  minScore?: number;
  timeoutMs?: number;
  signal?: AbortSignal;      // 调用方取消（替代 UI 层 token 的职责）
  sourceId?: string;         // 仅调试/测试：强制指定来源
}

interface SearchResult {
  hits: Hit[];                 // { id, score, source }
  spaceKey: SpaceKey;          // 本次实际使用的空间
  sourceId: string;            // 实际生效来源（排障与埋点）
  modality: Modality;          // v2：本次实际使用的模态路径
  degraded: DegradeInfo | null;// null = 正常；非 null = 已降级，含 reason
  timings: { probeMs: number; encodeMs: number; rankMs: number };
}
```

### 5.2 路由：按 (来源 × 模态) 决策

v2 的路由粒度变了。**同一空间内，不同端点的模态能力可能不对称**——实测 LM Studio 的 `/v1/embeddings` 官方定义为 "Generate embedding vectors from input text"，**只吃文本**。所以：

```
SearchRequest
   │
   ├─ L0  可行性闸门（capability gate）← 硬约束，不是优先级
   │      · 模态：image 查询 ⇒ 只保留 modalities ∋ 'image'
   │      · 空间：source.spaceKey === CORPUS.spaceKey（I1/I4），不一致直接剔除
   │      · 对齐：source.conformance === 'passed'（§6），未通过直接剔除
   │      · 可达：probe() 成功（本机 / 局域网）
   │      ↓ 得到「可行集合」
   ├─ L1  策略选择（policy）← 在可行集合里挑
   │      · pinned      ：配置锁死某个 sourceId（调试/测试）
   │      · local-first（默认）：就近优先，本机不可达再退局域网
   │      · fastest     ：按 probe 实测延迟选
   │      ↓ 得到「首选来源」
   └─ L2  降级链（fallback chain）← 首选失败时按序退
          · 每级独立超时预算，超时即视为失败
          · 链尾是 null ⇒ degraded.reason='no-source'
          · 每次降级都写进 SearchResult.degraded（I6）
```

**为什么 L0 必须在 L1 之前**：因为"用只支持文本的端点做以图搜题"不是**优先级问题**，是**可行性问题**。若先按优先级选、失败再降级，代价是一次注定失败的调用 + 一轮超时等待。

**`local-first` 不要写成拓扑假设**：v2 不预设"本机一定更快"。WeMM 冷启动 17.3s、文本 query 编码 117ms（MPS）、图片 2.2-2.6s/张。若 Linux 那台有独立显卡，局域网端点的稳态延迟可能更低。所以默认 `local-first` 的语义是**"就近优先"**，而 `fastest` 策略要基于 `probe()` 的**实测值**，不是"局域网一定慢"的直觉。

### 5.3 切换时机与防抖

| 触发 | 行为 |
|---|---|
| 用户改配置 | 立即生效（下次 `search` 生效，不打断在途请求） |
| `probe()` 失败 | 连续 **N=2** 次失败才降级（单次抖动不降级） |
| 降级后恢复探测 | 降级状态缓存 **TTL=60s**，避免每 400ms 一次失败探测 |
| 探测成功 | 回切（带回切冷却，避免抖动震荡） |
| **对齐状态变更** | 来源从 `passed` 变 `failed` ⇒ 立即移出候选集（见 §6） |

**v2 删除了 v1 的"语料作废"分支**：既然所有来源共享同一空间，切换端点**不影响语料**。这是 v2 相对 v1 最实质的简化。

### 5.4 运行期条件输入

| 类别 | 输入 |
|---|---|
| 配置 | `semanticSource`（pinned）、`semanticPolicy`、`semanticMinScore` |
| 环境 | 是否已配置 `serverUrl`/`apiToken`；局域网可达性（经服务端探测） |
| 查询 | 模态（text / image） |
| 健康 | `probe()` 结果（带 TTL 缓存）；`conformance` 状态 |

---

## 6. 对齐闸门（v2 新增，核心）

### 6.1 为什么必须有

本轮实测（详见 `docs/wemm-embedding-fingerprint.md` §3）：

| 路径 | 与基准的余弦 |
|---|---|
| 套 chat template（服务实际路径） | **0.9976** |
| 裸文本 | **0.8870** |

参照：本机**同义改述**之间的余弦只有 **0.8206**。也就是说，裸文本造成的偏移，**已经超过了两个同义句之间的差距**。而这个偏移**不报错、不崩溃、测试全绿**——只是检索质量静默退化。

**"同一个模型"不保证"同样的向量。** 跨运行时（PyTorch → llama.cpp/GGUF）差异还可能来自：池化方式、图像预处理、注意力实现（本机实测走 torch fallback，Linux 若装了 `flash-linear-attention` 会走 fast path）、量化位宽。**光靠读配置对不出来，必须实测。**

### 6.2 闸门设计

```
来源注册
   │
   ├─ 静态校验：spaceKey 格式合法、dim > 0、id 唯一
   │
   ├─ 对齐验证（conformance）
   │    用黄金向量探针（3 条文本 + 1 张图片）实测该端点：
   │      · 全部 cos ≥ 0.99  → 'passed'     准入
   │      · 落在 0.85–0.95  → 'systematic' 疑似输入格式/池化问题，拒绝
   │      · < 0.85           → 'failed'     空间不符，拒绝
   │      · 模态不支持       → 该模态标 'unsupported'（不阻断其他模态）
   │
   └─ 未通过的来源进入 quarantine：保留配置、不参与路由、在设置页可见原因
```

**闸门的两条硬规则**：
1. **未通过对齐的来源绝不参与路由**。宁可少一个来源，不可引入污染。
2. **对齐结论按模态分别记录**。文本通过、图片失败是合法状态（LM Studio 就是这个状态）——这直接驱动 §5.2 的模态级路由。

### 6.3 配套工具（本轮已产出并验证）

| 文件 | 作用 |
|---|---|
| `tmp/golden_vectors.json` | 黄金向量基准（3 文本 + 1 图，来自本机生产服务） |
| `tmp/probe-image.png` | 图片探针原图，sha256 `7c887af9…`（保证字节一致） |
| `tmp/verify_space_alignment.py` | 对齐验证脚本，已用两个 mock 场景验证过 |

脚本的**诊断能力已实测验证**（起 mock 服务模拟两种服务端）：

| 场景 | 脚本输出 |
|---|---|
| 服务端会套模板 | 第 1 轮三探针 cos **1.0000** → "裸文本即对齐" ✅ |
| 服务端不套模板 | 第 1 轮 cos **0.8868 / 0.8366 / 0.7914** → 判为「系统性偏移」→ 第 2 轮自动重试套模板 → cos **1.0000** → 结论「该服务不会自动套模板，接入时必须由调用方传入模板化文本」 ✅ |

它不只是报错，还会**自动尝试修复路径**——这正是拿到 Linux 上最需要的行为。

---

## 7. 配置方式

四层，后者覆盖前者：

| 层 | 载体 | 用途 |
|---|---|---|
| 1 编译期默认 | `config.ts` 的 `DEFAULTS` | 开箱可用 |
| 2 部署期 | 服务端 env（`EMBED_SERVICE_URL` → 改为来源列表） | 环境差异 |
| 3 运行期 | localStorage（沿用现有扁平 key 约定） | 用户可改 |
| 4 单次调用 | `SearchRequest.sourceId` / `minScore` | 测试与调试 |

优先级：**调用 override > 运行期 > 部署期 > 默认**。

**阈值分桶（Q5）**：

```ts
minScoreBySpaceKey: Record<SpaceKey, number>
// 例：{ 'wemm-embedding-2b:bf16:2048:l2:text+image': 0.25 }
```

按你的修正：**分桶键就是 `spaceKey` 本身，不叠加 `corpusId`**——因为来源是引擎轴、题库只有一份，`corpusId` 在这个分桶里没有区分度，加上去只会让人误以为存在多语料。

保留 `Record` 结构（而不是退回单个数字）的理由：将来若真的引入第二个模型/空间，无需改代码。**这是"结构留口子、当前只有一个键"的最小成本做法。**

两条必须遵守的约定：
- **不新增"配置中心"**。项目现有配置全是扁平 localStorage 字符串键（`serverUrl`、`apiToken`、`exportImgMode`、`backupPath`…），保持一致比引入抽象更划算。
- **`minScore` 与 `spaceKey` 绑定**：新空间上线必须重跑 `server/embed/calibrate_threshold.py`。历史事故记录在案——`SEMANTIC_MIN_SCORE=0.35` 过高导致全部结果被滤。

---

## 8. 新增一个来源的扩展流程（7 步，每步带验收）

| 步 | 动作 | 验收标准 |
|---|---|---|
| 1 | 新建 `sources/<id>/encoder.ts`，实现 `Encoder` | `probe()` 在服务不可达时返回失败而非抛异常 |
| 2 | 声明 `capabilities`（模态、dim、归一化口径、延迟画像） | 延迟有实测数据，不是估计 |
| 3 | **跑对齐验证**（`verify_space_alignment.py`） | 每个声称支持的模态 cos ≥ 0.99 |
| 4 | 在 `registry.ts` 集中注册 | 静态校验通过；对齐状态写入 |
| 5 | 配置可达（新配置项 → localStorage key + 设置页入口） | 设置页能看到该来源的健康与对齐状态 |
| 6 | 跑**契约测试**（同一套 conformance 用例打所有来源） | 见下 |
| 7 | 若引入**新空间**（非同一模型）：建库脚本 + 阈值校准 + 真实链路测试 | AGENTS.md 验证分层第 2/3 层 |

**契约测试**（`unit-tests/semantic-contract.spec.js`，对每个注册来源参数化跑）：
- 输出的 `dim === capabilities.dim`，且向量已按声明口径归一化（模长 ≈ 1）
- `spaceKey` 确定性：同一配置两次构造结果相同
- 维度不匹配时**硬失败**（不是静默截断）
- `probe()` 超时受 `signal` 控制
- 不可达时返回 `degraded`，不抛异常穿透到 UI
- 对齐状态为 `failed` 的来源**不会出现在可行集合里**

> 契约测试是这个设计能不能"真的可扩展"的唯一证据。没有它，"可扩展"只是接口好看。

---

## 9. 对抗性审查（假设设计已上线，主动找它失效的场景）

| # | 攻击场景 | 后果 | 对策 |
|---|---|---|---|
| **A1** | 两端 dim 不同（2048 vs 1024） | `cosineSimilarity` 的 `Math.min` 静默截断，产出**看起来正常**的分数 | dim 不等即返回 `null`，转 `degraded`（I2） |
| **A2** | **输入格式不一致（模板没套）** | cos 0.887，比同义句差距（0.8206）还大；**不报错、测试全绿** | **对齐闸门**（§6）——本轮实测发现，v1 未覆盖 |
| **A3** | 冷启动 17.3s 被当成"没反应" | 用户重复点击，产生并发请求 | `probe()` 暴露 `cold` 状态；`signal` 支持取消；`timings` 回传让 UI 能说"首次加载模型" |
| **A4** | 降级静默 | 现有 `encodeQuery` catch → `null` → `container.replaceChildren()`，用户零反馈 | `SearchResult.degraded` 强制调用方处理（I6） |
| **A5** | **数据层双实现陷阱** | 新模块若被 `main.ts:17-23` 的 `assignIfMissing` 挂载，且旧 JS 有同名 ⇒ **TS 实现运行时永不生效，测试却全绿** | 新模块名走 `assignToWindow`（`main.ts:11-15`）。**本项目特有坑，AGENTS.md 有专节警告** |
| **A6** | 多 worktree 端口劫持 | E2E 静默测到别人的代码（AGENTS.md 已记录） | 契约测试用本 worktree 独立端口 + `reuseExistingServer: false` |
| **A7** | 索引刷新与查询竞态 | `refreshEmbeddings` 先 `clear()` 再逐条 `set()`，期间读到空语料 ⇒ 结果忽有忽无 | 版本化写入 + 原子切换；查询只读已提交版本 |
| **A8** | 解码成本 × 查询频率 | 每次按键全量解码（400ms 防抖），题量增长后线性恶化 | `Corpus` 内部缓存已解码向量 + `version()` 判失效 |
| **A9** | **跨空间阈值误用** | 沿用旧 `minScore` ⇒ 全滤或全放（历史事故：0.35 过高） | 阈值按 `spaceKey` 分桶（§7）；新空间必须重校准 |
| **A10** | **对齐状态过期** | 来源通过验证后，对端升级/换量化 ⇒ 悄悄漂移出空间 | 对齐结论带 TTL + 服务端版本指纹（`/health` 加模型哈希）；版本变则重验 |
| **A11** | **模态能力错判** | 把 image 请求发给只支持文本的端点 | L0 按模态过滤；`capabilities.modalities` 必须实测而非照抄文档 |

**A2、A5、A9 都是本项目已踩过的坑的同类**（A5 对应 AGENTS.md 双实现警告；A9 对应阈值校准事故；A2 是本轮新发现的实测事实）。不是理论风险。

---

## 10. 各部分协作关系

```
 ┌──────────────────────────────────────────────────────────────┐
 │ 调用方（question-core / question-detail）                     │
 │  · 防抖、token/竞态、渲染、滚动、是否显示区块                    │
 └───────────────┬──────────────────────────────────────────────┘
                 │ search({kind:'text'|'image', text|dataUrl, signal})
 ┌───────────────▼──────────────────────────────────────────────┐
 │ SemanticService（门面）                                       │
 │  · 参数默认值合并 ← config.ts（四层配置，阈值按 spaceKey 分桶） │
 └───────────────┬──────────────────────────────────────────────┘
                 │
 ┌───────────────▼──────────────────────────────────────────────┐
 │ Router                                                        │
 │  L0 gate（模态 / 空间一致 / 对齐状态 / 可达性）→ 可行集合       │
 │  L1 policy（pinned / local-first / fastest）→ 首选来源          │
 │  L2 chain（逐级超时 + 显式 degraded）→ 实际来源                  │
 └───┬───────────────────────────┬──────────────────┬───────────┘
     │                           │                  │
 ┌───▼──────────┐        ┌───────▼────────┐  ┌──────▼─────────┐
 │ Encoder      │        │ Corpus         │  │ Ranker         │
 │ probe/encode │        │ 共享单例        │  │ rank(topK,τ)   │
 │ → vector     │        │ version/iterate│  │ → Hit[]        │
 │ + spaceKey   │        │ + spaceKey     │  │                │
 └───┬──────────┘        └───────┬────────┘  └──────┬─────────┘
     │                           │                  │
 ┌───▼───────────────────────────▼──────────────────▼───────────┐
 │ invariants.ts：spaceKey 断言 · dim 校验 · 向量缓存（I1-I4）    │
 │ conformance.ts：黄金向量对齐闸门（来源准入，按模态分别记录）    │
 └──────────────────────────────────────────────────────────────┘
                 │
                 ▼  SearchResult { hits, spaceKey, sourceId, modality, degraded, timings }
         调用方据此决定：渲染 / 提示降级 / 退回字面匹配
```

**关键协作规则**：
1. **只有门面被导出**（`services/semantic/index.ts`），内部三层不对外暴露——调用方无法绕过 `spaceKey` 断言与对齐闸门。
2. **`invariants.ts` + `conformance.ts` 是横切层**，被 Encoder / Corpus / Ranker 共同依赖，保证 I1-I4 不依赖各实现的自律。
3. **`degraded` 是唯一合法的"我降级了"通道**——不靠日志、不靠异常、不靠返回值 null。
4. 「找相似题」（`searchSimilar`）**不经过 Encoder**（query 向量直接取自语料），但**仍必须过 spaceKey 断言与 L0 闸门**。这是现有 `question-detail.ts:138-147` 绕路实现必须收编的原因。

---

## 11. 落地路径（分阶段，每阶段可独立验收）

| 阶段 | 内容 | 验收口径 |
|---|---|---|
| **0** | 抽接口 + 把现有 macOS 服务包成**唯一**来源。纯重构，**行为零变化** | 现有 `tests/semantic-search.spec.js` 5 用例 + 全量 E2E 通过（重构基线）；`question-core`/`question-detail` 改为只调门面 |
| **1** | 引入 Router + 对齐闸门（此时只有 1 个来源） | 单测覆盖：空间不匹配必须硬失败；对齐 `failed` 的来源不进可行集合；`degraded` 语义正确 |
| **2** | 接入 Linux LM Studio 来源 | 对齐脚本在真机跑通；文本模态通过、图片模态标 `unsupported`；模态级路由正确 |
| **3** | 策略（`local-first` / `fastest`）+ 设置页来源状态展示 | 真实链路测试（AGENTS.md 第 2 层）；延迟画像基于实测 |

**阶段 2 的前置条件（不是代码问题，是环境问题）**：
1. 在 Linux 上装 GGUF 模型（建议 **Q8_0**，Emb Cosine 0.9997 / 2.55GB）
2. 跑 `verify_space_alignment.py`，确认 cos ≥ 0.99
3. 若文本对齐但需要图片能力 → 额外下载 `mmproj-WeMM-Embedding-2B-BF16.gguf`，改用 `llama-server --mmproj`（LM Studio 的 embeddings 端点不支持图片）

详见 `docs/wemm-embedding-fingerprint.md`。

---

## 12. 待确认决策

| # | 问题 | 我的倾向 | 影响 |
|---|---|---|---|
| **Q6** | **Router 放在客户端还是服务端？** | 决策逻辑在客户端模块（可测试、可配置），把"端点可达性"抽象为可注入的 `HealthProbe`，生产实现走 Express 的探测端点 | 决定模块是否需要跨端复用 |
| **Q7** | 对齐闸门在**运行期**还是**构建期**执行？ | 首次注册时执行 + 结果带 TTL 缓存；设置页可手动重验 | 决定冷启动开销与漂移防护 |
| **Q8** | 图片能力是否保留在局域网来源？ | 先不保留（LM Studio 走文本），图片继续由本机服务承担；将来需要再加 `llama-server --mmproj` | 决定 `lan-lmstudio` 的 capabilities |
| **Q9** | `spaceKey` 的具体字符串格式？ | `wemm-embedding-2b:bf16:2048:l2:text+image` | 决定阈值分桶的键与对齐日志可读性 |

---

## 13. 影响范围与不涉及的边界

**涉及（阶段 0）**：
- 新增 `src/services/semantic/`（9 个文件）
- 改：`src/services/semantic.ts`、`src/services/semantic-search.ts`、`src/services/index.ts`、`src/data/embeddings.ts`、`src/ui/question-core.ts`、`src/ui/question-detail.ts`、`src/init-app.ts`、`src/main.ts`
- 测试：新增 `unit-tests/semantic-contract.spec.js`；现有 `tests/semantic-search.spec.js` 保持通过

**不涉及**：
- `server/embed/*` 的模型加载逻辑（阶段 0 不动）
- `public/db.js` 及三份拷贝（不触碰数据层双实现，只在 `main.ts` 显式挂载新模块）
- 题库数据、同步协议、备份格式
- 现有 UI 文案与样式（除降级提示外）

---

## 14. 待你确认

本方案**仅为设计**，未修改任何代码。请确认：

1. §12 的 Q6–Q9（尤其 **Q6 Router 的位置**，它是架构分叉点）
2. 是否批准按 §11 阶段 0 开始实施

> 依据 AGENTS.md 的硬规则：**方案批准 ≠ 开工批准**。需要你说出「开始执行计划」后我才动代码。
> 你上一轮的「继续完成计划」我按"继续完善方案"执行——补全了模型指纹、对齐清单、修订方案，并对验证脚本做了双场景实测。若你的意思是"开始实施阶段 0"，请明确告知。
