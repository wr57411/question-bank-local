# 章节 + 专题 + 标签分类体系 · 实施计划

日期：2026-09-11（初稿）／**2026-09-16 grill 复议**
分支：`workbuddy/f640-main2-06c2f2a9`
状态：**待王先生审批** —— 审批时请一并答复 **§0.4 的三项待拍板**（P1 本轮范围 / P2 本地权威来源 / P3 生产库快照）
复议结论见 **§零**（优先于下文任何冲突处）
依据：2026-09-11 设计评审（grill）全部决策 + 生产库只读实测

---

## 零、2026-09-16 复议与裁决（**优先级高于下文任何冲突处**）

### 0.1 本次 grill 的裁决

| # | 决策点 | 裁决 | 依据 |
|---|---|---|---|
| **A1** | 一题可否同属多个章节 | **允许重叠**。标签驱动本身就意味着重叠；综合题跨章是常态，不该被排斥 | 王先生 2026-09-16：「希望他出现」 |
| **A2** | 章节是否需要「手动归入」通道 | **不需要**。`member_tag_id` 沿用原设计，**仍仅 topic 使用** | 王先生：每题都有核心标签表达归属 |
| **A3** | 「核心标签」是否升级为数据字段 | **不升级**，它只是打标签时的心智习惯，且**可能有两个**（综合题）<br>实测 `questions`/`tags`/`question_tags` 三表均无 core/primary/chapter 相关字段 | 与 A1 自洽：既然允许重叠，"哪个是核心"就没有下游用途 |
| **D1** | 是否新增「未打标签的题」入口 | **新增**（采用长期方案，王先生 2026-09-16 选定） | 实测：主账号 94 道有效题中 **6 道零标签**，其中 **4 道是真实题**（60–96KB 真图）会静默掉出所有章节 |
| **D2** | 主账号里的测试残留 `e2e-test-1` / `verify-test` | **列入计划删除**（非立即执行） | 二者无图、成本 0；且证明 E2E 隔离有漏洞 |
| **D3** | 4 道漏打标签的真实题 | **由王先生自行补标签**（列入待办，不由 AI 改数据） | 王先生 2026-09-16 |

### 0.2 对原文的三处修正（**原文说法已作废**）

1. **§六 边界第 6 条「`question_tags` 表结构不动（D6 留待独立改造）」作废。**
   它与 §2.3 / O5 / Phase 0 · P0-2 **直接冲突**——后三者要求给 `question_tags` 加 `updated_at` / `deleted_at`。
   实测 `question_tags` 目前仍只有 `question_id` / `tag_id` 两列。**不得再据该边界阻止 P0-2。**
2. **§2.2 末尾「「📤 导出」功能正常，是当前唯一可靠的本地留档手段」作废。**
   2026-09-12/14 已实测证伪（FF-1 使每个 store 只导出 1 条）；该功能其后已迁 TS、删遗留实现、
   落盘改应用外部目录、并转为分片写入。**目标 5 不得再以它为前提。**
3. **目标 5 / Phase 3.5 的「配置自动进备份」需按新的分片备份结构改写。**
   备份已改为**分片目录**（`Directory.External` 下 `question-bank-backup/`，每片 ≤2MB；数组型 store 进分片、
   **非数组值走 `others` 单独落文件**）。因此 localStorage 派生的配置（如 `quickFavoriteTags`）
   **不会"自动"进备份**，需按 `others` 机制显式接线。

### 0.3 本计划新增的任务

| # | 任务 | 归属 | 说明 |
|---|---|---|---|
| **N1** | 标签管理加「**未打标签的题（N）**」入口：显示数量 → 点进 → 批量补标签 | Phase 1（与 1.4 同区） | 数据层需一个「零标签题」查询；同时覆盖"未分类标签"与"无标签题"两类漏网 |
| **N2** | 删除主账号测试残留 `e2e-test-1` / `verify-test` | 执行前置（一次性） | 软删即可 |
| **N3** | 4 道漏标签真实题补标签（其中 3 道连答案图也没有） | 王先生手动 | 不由 AI 改数据 |
| **N4** | 排查 **E2E 隔离漏洞** | 独立待办 | 证据：主账号内存在 `e2e-test-1` / `verify-test`；另 E2E 账号内有 92 道真实照片题（来源未定，见下） |

> **N4 的补充证据**（2026-09-16 实测）：E2E 账号 `9d1413fa-26e6-4b6a-94ff-eb64e74153a3`
> （手机 `19000000001`，昵称「E2E专用-勿动」）含 **94 题（92 道真实图）+ 83 标签 + 205 关联**；
> E2E 的 fixture 只有 118 字节假图，**造不出真实照片** → 像是某台设备/构建用测试号登录并推了全库。
> 两账号 **id 交集为 0**（题目、标签都是）→ **不是账号泄漏，也不是复制**。
> 影响：库被撑到 75MB；**任何数据统计都会被它干扰**（2026-09-16 已干扰两次）。

### 0.5 grill 完成后补充的裁决（2026-09-16 晚）

**分支 A 补一项**：

| # | 决策点 | 裁决 |
|---|---|---|
| **A5** | 章节编辑器是否开放「且/或分组」 | **只允许"或"**。数据结构仍与专题同构（`expr` 递归不变），**限制只加在 UI 校验上**（与 E4「数据结构不限深、UI 限两层」同一思路）。理由：章节的语义是**范围**，"或"是它的自然形式；"第三章 且 较难"不是章节而是**筛选视图**，开放"且"会让界面允许造出语义混乱且不报错的东西 |

**分支 B —— 无需王先生决策，由我定并在此明示**：`groups` / `tag_categories` 以 **IndexedDB store 为本地唯一权威**；
同步时把 store 内容序列化进 `user_settings` 通道（沿用 `quickFavoriteTags` 已验范式：服务端 `mergeUserSettings` 合并、
下载时仅当本机无未推送改动才采用远端）；**备份走 store（自动进 `ALL_STORES`）**。
→ 让"同步"与"备份"读**同一份**数据，避免 §3.4 原文那种"store 与 settings 各一份"的漂移。

**分支 C —— 生产库安全（王先生 2026-09-16 批准）**：① **冷备我做**（含 `-wal`，落 `tmp/`）；
② **schema 变更我做，但先在生产库副本上演练**；③ **重启服务进程由王先生做**。
生产库 = `/Users/john/question-bank-local/server/data.db`（服务进程 cwd 在 Codex worktree 但 `DB_PATH` 指向此处）。

**分支 D 补一项**：

| # | 决策点 | 裁决 |
|---|---|---|
| **D-b** | 未分类标签是否出现在**章节选择器** | **不显示**，改用「还有 N 个未分类标签 → 去分类」提示；**专题选择器保留显示**未分类。<br>关键论证：§3.3 原文以"死循环"为由要求显示，但**该理由在引入 1.5「新建标签强制选类别」后已消失**；而显示未分类会让它**绕过类别过滤**（未分类的「较难」能当章节素材），与"章节素材只取知识点/模型"矛盾 |

> **D-b 推出的顺序含义**：Phase 1 交付后**王先生须先把存量标签分类完**，Phase 2 的章节才有素材；
> 否则章节打开是空的，容易被误判为功能故障。

**分支 E —— 结案（部分验过，含一处新缺陷）**：
王先生 2026-09-16 当天实测了「导出 → 恢复」，**恢复本身工作正常**。过程中发现：

| # | 新缺陷 | 说明 |
|---|---|---|
| **N5** | 恢复提示的**题数与列表不一致** | 提示「导入 **126** 题」，列表只有 **94** 题。实测：主账号 `questions` 共 **126** 行，其中 **94** 有效 + **32 已软删**（王先生自己删过的题，**数据没丢**，32 条墓碑也一并备份/恢复，是正确的）。<br>**问题是文案**：应改为「导入 126 条记录（94 道有效 + 32 条已删）」——否则每次都会让人**以为自己丢了 32 道题** |

> **E 的遗留未验证项（明示，不掩盖）**：**"空设备 / 重装后恢复"仍未验证**。
> 已验的是"同设备、同 IndexedDB 上的导出→恢复"，它证明不了"手机丢了还能救回来"。
> 建议排在 Phase 0 验收之后，在平板上做「清空 APP 数据 → 登录同步 → 从分片备份恢复」的完整演练
> （**必须 Phase 0 之后**：Phase 0 之前同步有 D1/D2/D3 缺陷，演练会真丢数据）。

**§0.4 的两项已定**：P2 → 见上「分支 B」；P3 → 见上「分支 C」。
**§0.4 仅余 P1（本轮范围）待王先生答复。**

---


### 0.4 待王先生拍板

> **2026-09-16 王先生答复：P1 / P2 / P3 三项全部按下列建议执行。**（P2、P3 的实现细节见 §0.5）

| # | 项 | 决议 |
|---|---|---|
| **P1** | **本轮范围** | ✅ **Phase 0+1+2 一起做，Phase 3（设备快照）延后**（理由：0 是地基、1 是 2 的前提、2 才是目标功能；Phase 3 与章节/专题无依赖，单独排期风险更小） |
| **P1** | **本轮范围**：Phase 0+1+2 一起做，**Phase 3（设备快照）延后** | 建议如此。0 是地基、1 是 2 的前提、2 才是你要的功能；Phase 3 解决的是"配置跨设备搬运"，与章节/专题**无依赖**，单独排期风险更小 |
| **P2** | `groups` / `tag_categories` 的**本地权威来源** | 建议：**IndexedDB store 为唯一权威**，同步时把 store 内容序列化进 `user_settings` 通道，备份走 store（自动进 `ALL_STORES`）。让"同步"与"备份"读**同一份**数据，避免 §3.4 原文那种"store 与 settings 各一份"的漂移 |
| **P3** | Phase 0 动同步链路前的**生产库快照措施** | 建议：改前对 `/Users/john/question-bank-local/server/data.db`（**含 `-wal`**）做一次冷备到 `tmp/`；每个 Phase 完成后跑一次双设备同步实测 |

---


## 一、功能目标

| # | 目标 | 验收标准 |
|---|---|---|
| 1 | **关联章节**：章节与标签建立关联，按章节选题 | 可配置各章节关联的标签；题目列表选定章节后，带该章节任一标签的题自动纳入 |
| 2 | **专题**：标签驱动的主题集合 | 可配置各专题关联的标签；题目列表可按专题检索；可把题目"匹配"进专题 |
| 3 | **标签分类体系**（新增，为 1/2 的必要底座） | 标签可分类；每个选择器可配置显示哪些类别；新建标签强制选类别 |
| 4 | **修复同步链路** | 标签变更（改名/改色/删除/分类）能跨设备下行；题目标签关联能下行到新设备 |
| 5 | **配置不再丢** | 配置进备份；localStorage 配置可按机型上传/在其他设备上下载 |

---

## 二、现状核查（全部已实测，非推断）

### 2.1 生产库实测（只读，`/Users/john/question-bank-local/server/data.db`）

| 事实 | 值 |
|---|---|
| 有效标签 / 题目 / 标签关联 | 83 / 123 / 216（平均每题 1.76 标签） |
| 软删标签行 | 37（含 数学×6、物理题×1、测试标签×10、流程测试标签×5，均为测试脚本产物，删除状态已同步） |
| 有效但从未使用的标签 | 4（`E2E表单标签`、`f=kv`、`加速度`、`动能定理`） |
| 使用量 TOP5 | 较难 28 · 较新 18 · 情境题 11 · 易错 10 · 板块模型 10 |
| 粗分类 | 知识点/模型 70、题型情境 5、难度 4、错因 4、学科 0 |
| 遗留专题行 | 5（`力学综合` 2026-01-15 + 4 个 8/27 测试产物）；`topic_questions` 仅 2 行 |

> 口径警示：**任何统计必须过滤 `deleted_at IS NULL`**。首轮统计未过滤，把 37 个已删标签算成用户的标签，得出「120 标签 / 41 未使用」的错误结论。已写入 `MEMORY.md`。

### 2.2 八个已确认缺陷（阻塞项）

| # | 缺陷 | 位置 | 后果 | 严重度 |
|---|---|---|---|---|
| D1 | 标签下行 insert-only（`if (!existing) setItem`） | `src/data/sync.ts:103-108` | 已存在标签的**任何变更都不下行**：A 改名/改色/删标签，B 永远看到旧值 | **阻塞**（分类无法跨设备） |
| D2 | 题目 `tag_ids` 未落成 `question_tags` | `src/data/sync.ts:94-102` | 服务端 pull 返回 `tag_ids`（`server/src/routes/sync.ts:86`），客户端从不消费 → **新设备/重装后所有题目标签为空** | **阻塞**（标签驱动全部失效） |
| D3 | 服务端 `replaceQuestionTags(id, [])` 清空关联 | `server/src/services/sync-upsert.ts:176` | 客户端 push 不带 `tag_ids`（`dbBuildSyncPayload` 只推原始记录）→ 题目一旦被判为"更新"，**服务端该题标签关联被清空** | **高**（数据丢失） |
| D4 | tags 无编辑能力 | `src/data/tags.ts`（仅 getAll/create/delete）、`src/ui/tag-manage.ts`（无入口） | 加 `category` 需从零建编辑链路 | 中 |
| D5 | localStorage 配置不在备份内 | `src/data/backup.ts:17-31` `ALL_STORES` | `quickFavoriteTags` 换机/恢复即丢 | 中 |
| D6 | `question_tags` 无时间戳 | `server/src/db/schema.ts:35-41`（纯 join 表） | 标签**取消关联**无法增量传播（无墓碑、无可比时间） | 中（需单独设计） |
| D7 | 两个 `dbClearAllData` 行为不一致 | 遗留 `public/db.js:1545` 清 `question_tags`；TS `src/data/sync.ts:138` **不清**（运行时执行 TS 版） | `doSyncDown`（重建本地缓存）后残留孤儿关联。D6 之后孤儿会被重新上行 | 低（D6 前）／中（D6 后） |
| **D8** | **增量备份链路从写入端就断了** | `recordChange`（`src/data/backup.ts:30`，changelog 唯一写入点）**全仓无调用者** | `dbChangelog` 永远为空 → `exportIncrementalBackup` 永远返回 `changes: []` → 「☁️ 备份」产出空壳；`restoreFromBackup` 会显示"恢复成功: 0 题, 0 标签"而**实际什么都没恢复**；UI 的"待同步变更: N 条"永远是 0 | **高**（虚假安全感，独立于本需求） |

> **D8 说明**：`smartBackup()` 仅在 `shouldForceFullSnapshot()`（无上次快照 或 距上次 ≥7 天）时才走真数据路径
> （`exportFullBackup`），其余时候都走空增量。即**只有每 7 天的那一次备份是真的**。
> 实证：2026-09-12 王先生导出的「备份」文件为 206 字节，`is_full:false`、`changes:[]`、无任何数据。
> 注：~~**「📤 导出」（`exportAllData`）功能正常**，它含全量数据，是当前唯一可靠的本地留档手段。~~
> **该说法已于 2026-09-12/14 被实测证伪并作废**（FF-1 使每个 store 只导出 1 条），
> 且该功能其后已迁到 TS 实现、删除遗留实现、落盘改应用外部目录、转为分片写入。详见 §0.2 第 2 条。
> D8 与本需求（章节/专题）无耦合，**已单独立项并插队优先修**：
> 见 `docs/plans/2026-09-12-d8-backup-fix.md`（含完整诊断、方案、验证与待确认参数）。

---

## 二·补 后续待办（本轮不做，已登记）

| # | 待办 | 价值 | 说明 |
|---|---|---|---|
| **B-1** | **题图从 base64 内联改为文件存储**（王先生 2026-09-12 要求登记） | 备份体积从 30–60 MB 降到几百 KB；同步载荷、渲染内存一并受益；D8 方案的体积约束随之消失 | 独立大工程：存储格式 + 89 张存量图迁移 + 同步 + PDF 导出 + 缩略图渲染适配 |

### 2.3 D3 与 D6 是同一个根因（2026-09-12 补充分析）

把 D3 的修复方案写细时发现：**D3 与 D6 不是两件事，是同一根因的两张脸——关联关系没有版本。**

第一性原理推导（决定了 Phase 0 的方案形状）：

| 方案 | 结果 |
|---|---|
| 不修 D6，push 带「本地 ∪ 记录 echo」并集 | **取消标签失效**：echo 里含已取消的标签，被并集推回服务端复活 |
| 不修 D6，`pull → push` + 推本地集合 | **消除数据丢失**（不再清空服务端），新设备的标签也能补齐 ✅<br>残留：多设备下"取消关联"仍可能被另一台设备的陈旧全量 push 复活 |
| 不修 D6，`push → pull` + 下行全量替换 | 本地未推送的取消改动会在 pull 阶段被远端旧视图覆盖 → 换一边丢 |
| **修 D6**（`question_tags` 带 `updated_at` / `deleted_at` + 独立同步键 + 逐条合并） | 唯一的彻底解：两侧的增、删都能无歧义合并 |

**结论**：不修 D6 时第 2 行是最优解，但仍留着"取消关联被复活"的缺口。
**2026-09-12 裁决：采纳最后一行（修 D6）**——`question_tags` 升级为带版本的实体，
`updated_at` / `deleted_at` 表达增删、独立同步键逐条合并，两侧不再互相覆盖。
原先为绕开 D6 设计的 P0-2/3/4 随之作废（见 §4 Phase 0 修订说明）。

---

## 三、数据模型

### 3.1 核心模型：标签驱动 + 表达式树

章节与专题**同构**，共用一个 store，用 `kind` 区分：

```
groups: {
  id, kind: 'chapter' | 'topic', name,
  expr: ExprNode,           // 成员条件（表达式树，见 3.1.1）
  member_tag_id: string,    // 系统成员标签 id（仅 topic 用）
  order: number,
  created_at, updated_at, deleted_at
}
```

**成员 = (表达式求值命中的题) ∪ (带 `member_tag_id` 的题)**

系统成员标签是**破格通道**：手动"匹配专题"归入的题不受表达式约束，否则会被系统踢出去。

#### 3.1.1 表达式树

```ts
type ExprNode =
  | { op: 'and' | 'or'; children: ExprNode[] }   // 分组节点
  | { tag: string }                              // 叶子：标签 id
```

- "条件内部模式"与"条件间关系"**统一为同一个 `op`**：一组标签的并集 = `{op:'or', children:[...]}`，交集 = `{op:'and', children:[...]}`
- **数据结构递归（不限深度），UI 限制两层**（根分组 + 一层子分组，子分组内不再嵌套）。将来放开只需改一处 UI 校验，不动存储/同步/求值
- 叶子是**标签**，不是标签集合；分组就是"条件"
- 空表达式（根分组无子节点）= 纯手工专题，只收手动归入的题。合法状态，非错误态
- 单标签分组等价于单标签，不特判

**示例**（用生产库真实题数演算）：

| 专题 | 表达式 | 结果 |
|---|---|---|
| 力学综合 | `(板块模型 或 传送带 或 单摆) 且 较难` | 19 ∩ 28 ≈ 5 题 |
| 电磁感应·易错 | `电磁感应 且 易错` | ≈ 2 题 |
| 期末冲刺 | `(圆周运动 或 平抛运动) 且 较难` | 6 ∩ 28 ≈ 4 题 |

**每个节点必须显示自身命中题数**（根、各子分组、各叶子）。表达式比"一组标签"难预测得多，没有分层题数就无法定位是哪一层把结果掐成 0。这是可观测性要求，不是装饰。

#### 3.1.2 死引用处理（标签被删）

**清理 = 从表达式树物理移除该成员**。不做"保留引用 + 求值时特殊对待"——只要引用还留在树里，求值就必须选一种语义（忽略 → 专题静默变宽；永假 → 专题静默变空），两条都是静默改变结果。

删标签流程：

1. 扫描所有专题表达式，找出引用该标签的专题
2. 若有引用，弹窗**逐个列出题数变化**：「期末冲刺：4 题 → 4 题」「电磁感应专项：2 题 → 28 题」
3. 用户确认后，一次性物理移除所有引用；清理后根分组为空 → 明确提示"该专题将变成仅含手动归入的题"
4. 无引用则直接删除，不打扰

**镜像规则（删专题）**：删除专题时一并清理它的系统成员标签（避免标签池堆积死标签），弹窗说明「该专题有 N 道手动归入的题，删除后这些归入关系解除（题目本身不受影响）」。

改名 / 改色 / 改类别**不影响引用**（引用的是标签 id），无需处理。


### 3.2 标签分类

```
Tag: + category_id: string | null      // null = 未分类
tag_categories: { id, name, order, is_system?, created_at, updated_at, deleted_at }
```

默认类别（可在 APP 内增删改名）：`知识点/模型`、`题型/情境`、`错因`、`难度`、`学科`、`系统`。

**「系统」类别是必需项**：专题的系统成员标签（`专题·<名称>`）挂在这里，默认在所有选择器、标签筛选、章节选择器中隐藏，避免污染。

### 3.3 选择器显示规则（可在 APP 内配置）

| 类别 | 章节选择器 | 专题选择器 | 备注 |
|---|---|---|---|
| 知识点 / 模型 | 显示 | 显示 | 两者的主要素材 |
| 题型 / 情境 | 不显示 | 显示 | 章节是教材结构，题型不属结构 |
| 错因 | 不显示 | 显示 | 「易错题精选」是典型专题 |
| **难度** | **不显示** | **显示** | 难度是**条件**不是**范围**；只作为专题表达式里的限定项（表达"较难的电磁感应题"） |
| 学科 | 不显示 | 不显示 | 全局维度，对两者都无意义 |
| 系统 | 不显示 | 不显示 | 系统成员标签，任何选择器都不得出现 |
| **未分类** | **显示（排最后）** | **显示（排最后）** | 见下方死循环说明 |

> 可见性配置有两份：`章节可见类别` / `专题可见类别`。专题的表达式**任意节点**共用同一份配置，不需要按角色再拆。
> 未分类必须显示，否则新建标签（默认未分类）永远不出现在配置界面 → 死循环。

### 3.4 配置存储与同步通道

- **存储**：新增 IndexedDB store（`groups` / `tag_categories` / `app_settings`），自动进 `ALL_STORES` → 自动进备份
- **同步**：走 `user_settings` 的 settings 通道，**不动服务端表结构**
- **冲突策略**：`rev` 乐观锁 + **逐条时间戳合并**（不同条目各自生效，谁都不丢）；仅"同一条两边都改"才弹窗让用户选。沿用 `quickFavoriteTags` 已验证的范式（`server/src/routes/sync.ts:127-166` + `quick-fav-merge.ts`）
- **localStorage 保持权威的项**（如 `quickFavoriteTags`）不动，另由设备快照覆盖（见 Phase 3）

---

## 四、分阶段实施

### Phase 0 · 同步链路地基（必须先做，否则后续一切不可靠）

> **2026-09-12 修订**：采纳 D6 后，原先为绕开 D6 而设计的 P0-2 / P0-3 / P0-4（`tag_ids` 物化 / 并集推送 / 条件 replace）**全部作废**——它们的病根正是"以 `tag_ids` 为准全量替换"这个语义，而 D6 从根上取消了它。下表为简化后的方案，改动更少且更正确。

| 任务 | 文件 | 要点 |
|---|---|---|
| P0-1 标签下行双向合并 | `src/data/sync.ts` | `if (!existing)` → 按 `updated_at/deleted_at/created_at` 取最大值判定；写后 `invalidateTagIndex()` |
| P0-2 `question_tags` 加版本列 | `server/src/db/schema.ts` | 加 `updated_at TEXT` / `deleted_at TEXT`，走 `ensureColumn` 迁移（存量行为空，读取时兜底） |
| P0-3 关联改为逐条 upsert（**D3 病根在此移除**） | `server/src/services/sync-upsert.ts` | 新增 `upsertQuestionTag`（按 `isIncomingNewer` 判定）；**删掉 `upsertQuestion` 里的 `replaceQuestionTags` 调用**；`listQuestionTagIds` 加 `qt.deleted_at IS NULL`；purged 清理保留物理删除 |
| P0-4 关联独立同步键 | `server/src/routes/sync.ts`、`src/types/sync.ts`、`src/data/sync.ts` | push 接收 / pull 返回 `question_tags`（含时间戳）；客户端 `dbBuildSyncPayload` 推本地关联，**题目不再携带 `tag_ids`**；`dbApplyRemoteSnapshot` 对关联做逐条时间戳合并（替代此前的"只增不删"） |
| P0-5 客户端关联软删 + 时间戳（**D6 核心**） | `src/data/questions.ts` | `dbAddTagToQuestion` 写 `updated_at`；`dbRemoveTagFromQuestion` 改为**软删**（置 `deleted_at`），不再 `removeItem`。"取消关联"由此获得墓碑，可跨设备传播且不被复活 |
| P0-6 缓存失效补全 | `src/data/sync.ts` | 远端应用后调 `invalidateTagIndex()` / `invalidateQuestionsCache()` |
| P0-7 存量记录时间戳兜底 | 双端各处 | 客户端旧关联记录无 `updated_at` → 兜底 `created_at` 或当前时间；服务端存量行留空 → `isIncomingNewer` 兜底 0（可写入）。无需显式迁移脚本 |
| P0-8 备份兼容 | `src/data/backup.ts` | 关联记录新增两字段；旧备份导入时兜底，不报错 |
| P0-9 同步顺序 pull → push（建议，**非必需**） | `src/ui/sync-ui.ts`（`runSync`） | 逐条合并语义下顺序已不影响正确性；先 pull 可少一次往返、并让首次同步后本地视图即完整 |
| P0-10 **补 `dbClearAllData` 漏清的 `question_tags`**（D7） | `src/data/sync.ts` | 遗留 `public/db.js:1545` 会清，TS 版漏了；运行时执行的是 TS 版（main.ts 后加载覆盖 `window`）。`doSyncDown` 重建后残留孤儿关联。**D6 之后必须清**，否则孤儿关联会被重新上行 |

> 已写好并**已回退**的 4 处改动存于 `tmp/pending-20260911-sync-fix.patch`（130 行 / 2 文件）。
> ⚠️ 该补丁实现的是**已作废的旧方案**（`tag_ids` 版本），仅可作为 P0-1 的参考，**不要直接应用**。
> **D6 已并入本轮**（2026-09-12 裁决），原先"缺口记入遗留清单"的说法作废。

### Phase 1 · 标签分类体系

| 任务 | 文件（新建/修改） |
|---|---|
| 1.1 `Tag.category_id` + 默认类别种子数据 | `src/types/tag.ts`、`src/data/tag-categories.ts`（新）、`src/data/stores.ts` |
| 1.2 标签编辑能力（update） | `src/data/tags.ts`（新增 `dbUpdateTag`） |
| 1.3 标签管理 Tab 内新增「类别」分区（增删改名、排序、是否系统类别） | `src/ui/tag-manage.ts`、`src/index.html` |
| 1.4 批量分类界面（83 个标签，含关键词预填 + 逐项确认） | `src/ui/tag-manage.ts`（新分区） |
| 1.5 **新建标签强制选类别** | `src/ui/tag-manage.ts`、`src/ui/quick-import.ts`（快速导入新建标签路径）、`src/ui/question-core.ts`（题内联新建标签路径）—— **三处入口都要过** |
| 1.6 选择器类别可见性配置（章节/专题各一份勾选） | `src/ui/tag-manage.ts`、`app_settings` |
| 1.7 分类字段的同步与备份 | `src/data/sync.ts`、`src/data/backup.ts`、`server/src/db/schema.ts`（`ensureColumn`） |

> 1.5 是硬要求（你明确要求"现在就增加这个摩擦"）：三处新建标签入口必须选类别，否则新建入口会绕过分类，选择器逐渐退化。

### Phase 2 · 章节 / 专题本体

| 任务 | 文件 |
|---|---|
| 2.1 `groups` 数据层（增删改查、系统成员标签自动创建、成员集合查询） | `src/data/groups.ts`（新）、`src/data/stores.ts`、`src/data/index.ts` |
| 2.2 类型（`Group` / `ExprNode`） | `src/types/group.ts`（新）、`src/types/index.ts` |
| 2.3 **表达式求值模块**：任意 `ExprNode` × 题目标签集 → 命中题集合；并返回**每个节点的命中题数**（自底向上）；含空表达式、单标签退化、未知标签 id（视为空集且计入死引用报告） | `src/data/expr.ts`（新） |
| 2.4 表达式**编辑器** UI：根分组 + 一层子分组；节点 op 切换（且/或）；成员可增删；每个节点显示自身命中题数；底部显示最终题数与**可读回显**「（圆周运动 或 平抛运动）且 较难」；UI 强制两层上限 | `src/ui/group-manage.ts`（新）、`src/ui/tag-manage.ts`、`src/index.html` |
| 2.5 设置界面落点：标签管理 Tab 第三分区「章节 · 专题」（列表 + 新建 + 编辑） | `src/ui/tag-manage.ts`、`src/index.html` |
| 2.6 标签选择器（编辑器内）：实时搜索 + 默认隐藏未使用 + 显示题数 + 跨分组角标「已用于 第X章」+ 按 3.3 的类别可见性过滤 | `src/ui/group-manage.ts`、`src/ui/tag-manage.ts` |
| 2.7 **删标签级联清理**：扫描所有表达式 → 弹窗逐个列出「清理前 N 题 → 清理后 M 题」→ 确认后物理移除引用；无引用则不打扰 | `src/ui/tag-manage.ts`、`src/data/expr.ts`、`src/data/tags.ts` |
| 2.8 **删专题级联清理**：一并移除其系统成员标签；弹窗说明手动归入的题数 | `src/ui/group-manage.ts`、`src/data/groups.ts` |
| 2.9 题目列表筛选区改版：现有「标签筛选」折叠区扩为「筛选」区，展开后含**章节行 / 专题行** / 标签 chips / 搜索框，**层间 AND**；选定专题时回显其表达式摘要 | `src/ui/tag-manage.ts`（`renderFilterTags`）、`src/ui/question-core.ts`（`getFilteredQuestions`）、`src/index.html` |
| 2.10 「加入专题 / 移出专题」入口：列表勾选批量 + 详情页单题；写入系统成员标签 | `src/ui/question-core.ts`、`src/ui/question-detail.ts`、`src/index.html` |
| 2.11 快速导入栏专题匹配框：行 3 尾部贴 `＋` 并列 22–26px 圆钮「专」，点开内联面板；常态 0 高度 | `src/ui/quick-import.ts`、`src/index.html` |
| 2.12 系统标签在题目卡片显示 chip | `src/ui/question-core.ts`、`src/ui/question-detail.ts` |
| 2.13 配置同步与备份接线（**含 `user_settings` 同步 `cloud_providers`**，见开放项 O2） | `src/data/sync.ts`、`src/data/backup.ts`、`src/main.ts`（window 导出） |

### Phase 3 · 设备快照（localStorage 按机型上传 / 跨设备下载）

| 任务 | 文件 |
|---|---|
| 3.1 设备标识（机型 + 平台，Capacitor Device 优先，Web 兜底 UA） | `src/services/device-id.ts`（新） |
| 3.2 localStorage 白名单（**排除凭据类**） | 同上 |
| 3.3 上传：每次同步时把本机白名单配置写成"本机槽位"快照 | `src/data/sync.ts`、`server/src/routes/sync.ts`（新增 devices 端点） |
| 3.4 下载：列出各设备快照（机型 + 时间 + 条目数），选择任一台应用到本机，**覆盖前明确确认** | `src/ui/sync-ui.ts`、`src/index.html` |
| 3.5 `quickFavoriteTags` 纳入备份 | `src/data/backup.ts`、`src/services/quick-fav-tags.ts`（新增 restore 归一化函数） |
| 3.6 被纳入备份与快照的配置 | `quickFavoriteTags`；**明确排除** `apiToken` / `currentUser` / `serverUrl` / `systemPassword` / `baidu_token` / `cloud_providers`（含 API Key）/ `syncCursor` / `lastSyncTime` / `lastBackupTime` / `skip_version_code` / `backupPath` 等设备本地状态 |

> 3.6 是**必须你拍板的清单**：白名单决定"哪些配置跨设备搬运"。默认把含密钥的 `cloud_providers` 排除在外（上传 API Key 到服务器有安全含义）。

### Phase 4 · 验证（按 AGENTS.md 强制）

1. `npm run typecheck`（客户端 + 服务端）
2. `npm run test`（单测，新增：标签合并、tag_ids 物化、成员计算、类别过滤）
3. `npm run build`
4. `NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-<新目录>`（全量）
5. **UI 改动必须截图 + `assertVisiblyRendered`**（新增控件逐个过对比度/遮挡/截断检查），并实际 Read 截图确认
6. **防回归复现演练**：把 D1/D2/D3 的 bug 改回去，确认新增测试确实失败，再改回
7. `npm run ship` 打包验证（如需）

---

## 五、变更清单汇总

**新增文件（约 7）**：`src/data/groups.ts`、`src/data/expr.ts`（表达式求值）、`src/data/tag-categories.ts`、`src/ui/group-manage.ts`、`src/services/device-id.ts`、`src/types/group.ts`、`docs/plans/2026-09-11-*.md`

**修改文件（约 16）**：
`src/data/sync.ts`、`src/data/tags.ts`、`src/data/backup.ts`、`src/data/stores.ts`、`src/data/index.ts`、`src/data/questions.ts`、`src/types/tag.ts`、`src/types/sync.ts`、`src/types/backup.ts`、`src/types/index.ts`、`src/ui/tag-manage.ts`、`src/ui/question-core.ts`、`src/ui/question-detail.ts`、`src/ui/quick-import.ts`、`src/ui/sync-ui.ts`、`src/main.ts`、`src/index.html`、`src/styles/main.css`

**服务端（约 3）**：`server/src/services/sync-upsert.ts`、`server/src/routes/sync.ts`、`server/src/db/schema.ts`

**测试（新增）**：`unit-tests/tag-merge.spec.js`、`unit-tests/group-membership.spec.js`、`tests/group-filter.spec.js`（含截图 + 可见性评估）

---

## 六、不涉及边界（防误伤，一律不动）

1. **遗留数据**：`topics` / `topic_questions` 表与数据保留，不 DROP、不清空、不迁移。客户端 `dbTopics` / `dbTopicQuestions` store 保留（备份仍包含它们，零丢失）
2. **PDF 导出**：`src/data/pdf*.ts`、`src/ui/export-pdf-ui.ts`、`unit-tests/pdf-*.spec.js` 全部不动
3. **端侧 AI**：`src/services/ai.ts`、`src/ui/ai-model-ui.ts`、Gemma4 / llama.cpp 相关全部不动
4. **试卷云端链路**：`papers` / `paper_questions` / `pdf_url` / `upload-pdf` 不动
5. **题目列表版式切换**（单双栏、勾选框热区）不动
6. ~~**`question_tags` 表结构不动**（D6 留待独立改造）~~ → **作废（见 §0.2 第 1 条）**：
   本计划 Phase 0 · P0-2 明确要给 `question_tags` 加 `updated_at` / `deleted_at`。原边界与 D6 裁决冲突，已删。
7. **不引入新 CSS token**，只用 `src/styles/main.css` 现有变量
8. **不删除、不重命名**任何现有 store、路由、同步键
9. **不在题目列表筛选区引入表达式编辑**：列表只消费"专题成员集合"，表达式仅存在于专题设置界面（决策 E6）。这是控制爆炸半径的硬边界

---

## 七、风险与回退

| 风险 | 触发条件 | 回退 |
|---|---|---|
| R1 标签合并误判 | 本地无 `updated_at`（历史记录）时以 `created_at` 兜底，可能与远端同值 → 跳过 | 已按"不新即跳过"处理，最坏是延迟一次同步；不会丢数据 |
| R2 关联同步冲突 | 两台设备并发增删同一道题的标签 | D6 逐条合并：不同 (题目,标签) 组合各不干扰；同一条两边都改时以 `updated_at` 新者为准。仍需实测验证 |
| R2b 存量关联记录无时间戳 | 首次上行时旧记录缺 `updated_at` | 兜底用 `created_at` 或当前时间（P0-7）；服务端存量行兜底 0，保证可写入、不阻塞 |
| R3 类别过滤把标签藏没了 | 用户忘分类 | 未分类一律显示 + 新建强制选类别，双保险 |
| R4 系统成员标签污染 | 类别过滤失效 | 「系统」类别默认在所有选择器隐藏；单测覆盖 |
| R5 设置界面信息密度失控 | 标签管理 Tab 塞入 3 个分区 | **上 impeccable `critique` 评审**（见下） |
| R6 同步改造影响存量数据 | P0 系列动到 pull 应用逻辑 | 每个 Phase 独立 commit，出问题按 Phase `git revert`；改前对生产库做一次快照备份 |
| R7 表达式求值错误导致专题结果错 | 任意 `op` 组合、空表达式、单标签退化、未知标签 id | `src/data/expr.ts` 纯函数 + 单测覆盖全部边界；每个节点题数可肉眼核对；保存前预览 |
| R8 表达式的同步与合并 | 专题为单条记录，表达式整体替换 | 逐条时间戳合并；同一条两边都改 → 冲突弹窗让用户选（沿用 quickFavoriteTags 范式） |
| R9 表达式编辑器在手机上过挤 | 两层嵌套 + 每层操作按钮 | 上 impeccable `critique` 评信息密度；实测截图 + `assertVisiblyRendered` 逐个控件检查 |
| R10 删标签级联清理误伤 | 弹窗显示题数变化后用户仍确认 | 清理前把受影响的 `groups` 全量存一份到 `tmp/` 或提示可撤销；无引用时不弹窗 |

---

## 八、impeccable 使用决策

**用，限定两个环节，并加硬约束：**

1. 动手前用 `critique` 评审「三个分区塞进标签管理 Tab」「筛选折叠区塞两行」的信息密度与层级
2. UI 实现后、跑 E2E 前用 `audit` / `polish` 做一致性与层级检查
3. **硬约束**：只允许在现有 CSS 变量与间距体系内打磨，**禁止引入新 token 或新间距体系**（防风格漂移）
4. **它不替代** AGENTS.md 的截图可见性评估（`assertVisiblyRendered` + 实测截图 Read）——后者防"控件不可见"，是完全不同类的问题

---

## 九、开放项裁决（2026-09-12 王先生）

| # | 项 | 裁决 |
|---|---|---|
| O1 | 遗留专题「力学综合」（含 2 行挂载）不迁移、由你手动重建 | **接受** |
| O2 | `cloud_providers`（含 API Key）纳入跨设备搬运 | **纳入**（理由：单用户自用 APP）<br>⚠️ 已知事实：密钥将以明文进入服务端 `user_settings`，并经 `replicateToSupabase` / `/api/recovery/sync-to-supabase` **进一步复制到 Supabase**。已告知，确认纳入 |
| O3 | 系统成员标签在题目卡片上显示 chip | **接受**（显示） |
| O4 | Phase 顺序 0 → 1 → 2 → 3 | **接受** |
| O5 | D6（取消关联不传播）本轮是否修 | **改判：一并修**（2026-09-12）。理由：D3 与 D6 同源，要改的是同一批文件与同一函数；且章节/专题 100% 建立在标签关联上，取消关联被复活会导致专题成员**静默漂移**。见 §2.3 与 Phase 0 修订 |

### 需求变更追加：专题改用表达式（2026-09-12）

原"成员 = 命中任一标签（OR）"过于宽松，专题范围需要更窄。已收敛为**表达式树**模型（见 §3.1.1 / §3.1.2），含 6 项子决策：

| # | 决策点 | 结论 |
|---|---|---|
| E1 | 组合语义 | **表达式树**（可增删条件、含且/或分组） |
| E2 | 条件内部与条件间的关系 | **统一为同一个 `op`**：分组节点 `{op:'and'\|'or', children}`，叶子为标签 |
| E3 | 条件间关系 | **可选且/或 + 分组**（非固定交集） |
| E4 | 嵌套深度 | **数据结构递归不限深；UI 限制两层**（根 + 一层子分组） |
| E5 | 死引用处理 | **物理移除 + 事前显示每个受影响专题的题数变化**；另加删专题的镜像清理 |
| E6 | 题目列表是否解析表达式 | **不解析**。列表只消费"专题成员集合"，表达式仅在设置界面编辑、成员计算时求值 |

---

## 十、执行方式

按 Phase 串行，每个 Phase 结束：`typecheck` → 单测 → 汇报 → 你确认再进下一个 Phase。
全部完成后跑完整 CI 循环 + 截图评估，**不自动 commit**，等你检查后统一提交。
