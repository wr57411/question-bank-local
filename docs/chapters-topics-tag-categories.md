# 关联章节 + 专题 + 标签分类体系

## 基本信息

- **操作类型：** 功能开发（含一处同步链路地基重构与一处回归修复）
- **创建日期：** 2026-10-09
- **关联模块：** 标签分类, 章节/专题, 表达式求值, 同步链路, 服务端 schema, 备份, 题目列表, 快速导入, 标签管理 UI
- **影响文件（新增）：** `src/types/group.ts`、`src/data/expr.ts`、`src/data/groups.ts`、`src/data/tag-categories.ts`、`src/data/app-settings.ts`、`src/ui/group-manage.ts`
- **影响文件（修改）：** `src/data/{sync,questions,tags,stores,index,backup,papers}.ts`、`src/types/{tag,sync,backup,index}.ts`、`src/ui/{tag-manage,question-core,question-detail,quick-import,common,index}.ts`、`src/main.ts`、`src/init-app.ts`、`src/index.html`、`src/styles/main.css`、`server/src/db/schema.ts`、`server/src/services/sync-upsert.ts`
- **依据计划：** `docs/plans/2026-09-11-chapters-topics-tag-categories.md`（§零复议裁决优先）+ `docs/plans/2026-09-17-execution-runbook-chapters-topics.md`
- **状态：** 全部改动**未提交**；Phase 3（设备快照）按裁决**延后**

---

## 一、功能目标与最终形态

### 1.1 一句话目标

让"按章节 / 按专题 / 按标签分类"三种组织题目的方式**同源同构**：章节与专题都由**标签驱动**（同一个 `groups` store，用 `kind` 区分），标签本身先被**分类**，分类决定它能否成为章节 / 专题的素材。

### 1.2 三者关系

```
标签分类（tag_categories）
      │  给标签打 category_id
      ▼
   标签（tags） ──────┐
      │               │  被引用为叶子
      │               ▼
      │        表达式树（ExprNode）
      │               │  求值命中题集合
      │               ▼
      │      章节 / 专题（groups，kind 区分）
      │               │  再加「系统成员标签」= 破格通道（手动归入）
      └───────────────┘
                      ▼
              成员 = 表达式命中题 ∪ 带系统成员标签的题
```

### 1.3 交付形态（用户可见）

| 能力 | 入口 | 说明 |
|---|---|---|
| 标签分类 | 标签管理 Tab「类别」分区 | 六类默认种子（含必需的「系统」类）；可增删改名排序；系统类受保护 |
| 批量分类 | 标签管理 Tab | 对存量标签**关键词预填 + 逐项确认** |
| 强制选类别 | 三处新建标签入口 | `tag-manage.ts` 弹窗 / `quick-import.ts` 顶部条 / `question-core.ts` 题内联 |
| 类别可见性配置 | 标签管理 Tab | 章节 / 专题各一份勾选；未分类是否显示分别配置 |
| 未打标签的题 | 标签管理 Tab「未打标签的题（N）」 | 显示数量 → 点开 → 批量补标签（N1） |
| 章节 / 专题管理 | 标签管理 Tab 第三分区 | 列表 + 新建 + 编辑 + 删除（含级联清理） |
| 表达式编辑器 | 章节 / 专题编辑器 | 每个节点显示自身命中题数；底部可读回显 |
| 列表筛选层 | 题目列表「筛选」折叠区 | 章节行 / 专题行 / 标签 chips / 搜索框，**层间 AND**；选定专题回显表达式摘要 |
| 加入 / 移出专题 | 列表勾选批量 + 详情页单题 | 写入 / 移除该专题的**系统成员标签** |
| 快速导入专题匹配 | 快速导入栏圆钮「专」 | 点开内联面板，选中即绑定专题 |
| 系统标签 chip | 题目卡片 / 详情页 | 「📁 专题·X」带区分标记 |

---

## 二、数据模型

### 2.1 `Group`（章节与专题同构）

```ts
// src/types/group.ts
export type ExprNode =
  | { op: 'and' | 'or'; children: ExprNode[] }   // 分组节点
  | { tag: string };                             // 叶子：标签 id

export interface Group {
  id: string;
  kind: 'chapter' | 'topic';       // 章节 / 专题
  name: string;
  expr: ExprNode;                  // 成员条件（表达式树）
  member_tag_id: string | null;    // 系统成员标签 id（仅 topic 用）
  order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

**成员口径**（`src/data/groups.ts:176` `getGroupMemberQuestionIds`）：

> 成员 = `evalExpr(expr)` 命中题 ∪ 带 `member_tag_id` 标签的题

系统成员标签是**破格通道**：手动"加入专题"归入的题不受表达式约束，否则会被表达式求值结果踢出去。

### 2.2 `ExprNode`（表达式树）

- 分组节点的 `op` 同时表达**条件内部**与**条件之间**的关系：一组标签的并集 = `{op:'or',children:[…]}`，交集 = `{op:'and',children:[…]}`。
- **数据结构递归不限深度**；**UI 限制两层**（根分组 + 一层子分组）。放开时只需改一处 UI 校验，不动存储 / 同步 / 求值。
- 空表达式（根分组无子节点）= **纯手工专题**，只收手动归入的题。**合法状态**，非错误态。
- 叶子是**单个标签**，不是标签集合；单标签分组等价单标签，不特判。

**每个节点必须显示自身命中题数**（`src/data/expr.ts` 的 `ExprCountNode`，自底向上）。表达式比"一组标签"难预测得多，没有分层题数就无法定位是哪一层把结果掐成 0——这是可观测性要求，不是装饰。

**求值模块的边界语义**（`src/data/expr.ts:30`）：

| 情形 | 语义 | 理由 |
|---|---|---|
| 根分组无子节点 / `children=[]` | **命中空集**（`count=0`） | **不采用** `and(∅)=全集` 的数学语义，否则"纯手工专题"会意外命中整库 |
| 未知标签 id | 视为空集，且计入**死引用报告** | 表达式里残留已删标签时，求值必须选一种语义；未知即空，同时报告出来避免静默 |
| `or` / `and` 任意嵌套 | 逐层集合运算 | 单测覆盖三层嵌套、重复标签去重 |

### 2.3 `Tag.category_id` 与 `TagCategory`

```ts
// src/types/tag.ts
export interface Tag {
  id: string; name: string; color: string;
  category_id: string | null;      // 新增；null = 未分类
  created_at: string; updated_at?: string; deleted_at: string | null;
}

export interface TagCategory {
  id: string; name: string; order: number;
  is_system?: boolean;             // 「系统」类受保护，不可改名/删除
  created_at: string; updated_at: string; deleted_at: string | null;
}
```

默认六类种子（`src/data/tag-categories.ts`）：`知识点/模型`、`题型/情境`、`错因`、`难度`、`学科`、**`系统`**（`is_system:true`）。

**「系统」类别是必需项**：专题的系统成员标签（`专题·<名称>`）挂在这里，默认在**所有选择器、标签筛选、章节选择器**中隐藏，避免污染。幂等种入（`ensureDefaultTagCategories`）：仅 store 为空时种入，重复启动不重复、不覆盖用户改动。

**可见性配置**（`DEFAULT_VISIBILITY`）：章节默认只显 `知识点/模型`、不显未分类；专题默认显 `知识点/模型`+`题型/情境`+`错因`+`难度`、显未分类。

### 2.4 `question_tags`：从纯 join 表升级为**带版本实体**

**改动前**：`question_tags(question_id, tag_id)` 两列，无时间戳、无墓碑。

**改动后**（`server/src/db/schema.ts` + `ensureColumn` 迁移）：

```sql
question_tags(
  question_id, tag_id,
  created_at TEXT,   -- 新增
  updated_at TEXT,   -- 新增
  deleted_at TEXT    -- 新增（软删墓碑）
)
```

### 2.5 为什么这样设计（第一性原理）

| 设计 | 第一性原理 |
|---|---|
| **为什么用表达式树**（而非"一组标签 OR"） | "成员 = 命中任一标签"过于宽松，专题范围需要更窄（如"较难的电磁感应题"）。表达式的**条件内部模式**与**条件间关系**统一为同一个 `op`，可增删条件、可且/或分组——用最少的类型（2 个节点）表达任意组合 |
| **为什么系统成员标签是"破格通道"** | 手动归入的题**不满足表达式**，若强行用表达式表达就会被求值剔除。破格通道让"手动"与"命中"**取并集**，二者互不干扰 |
| **为什么章节编辑器只给"或"（A5）** | 章节的语义是**范围**，"或"是它的自然形式。"第三章 且 较难"不是章节而是**筛选视图**；开放"且"会让界面允许造出语义混乱且**不报错**的东西。约束只加在 **UI 校验**上，数据结构仍与专题同构 |
| **为什么 `groups`/`tag_categories` 以 IndexedDB store 为唯一权威** | 让"同步"与"备份"读**同一份**数据，避免"store 与 settings 各一份"的漂移（见计划 §0.5 分支 B） |
| **为什么列表不解析表达式（E6）** | 列表只消费"预计算的专题成员集合"，表达式仅在设置界面编辑、成员计算时求值。这是控制**爆炸半径**的硬边界 |
| **死引用为什么物理移除**（而非求值时特殊对待） | 只要引用还留在树里，求值就必须选一种语义（忽略→专题静默变宽；永假→专题静默变空），两条都是**静默改变结果**。物理移除是唯一不引入静默语义的方案 |

---

## 三、同步链路

### 3.1 关联（`question_tags`）同步——**独立同步键 + 逐条合并 + 软删墓碑**

```
客户端 push ──► payload.question_tags[]（每条含 question_id/tag_id/created_at/updated_at/deleted_at）
                          │
                          ▼
服务端 upsertQuestionTag（逐条，按 (question_id,tag_id) 定位；isIncomingNewer 判定）
   —— 存在则更新；不存在则插入；软删则写 deleted_at 墓碑
   —— 删除了旧的 replaceQuestionTags（"以 tag_ids 为准全量替换"）
                          │
pull ◄── 返回 question_tags（含墓碑与时间戳）；listQuestionTagIds 加 qt.deleted_at IS NULL
                          │
                          ▼
客户端 dbApplyRemoteSnapshot 对关联做逐条时间戳合并；dbRemoveTagFromQuestion 写软删+墓碑
```

### 3.2 为什么 `question_tags` 必须有版本（D3 与 D6 同一根因）

`D3`（服务端清空关联）与 `D6`（取消关联无法传播）**不是两件事，是同一根因的两张脸——关联关系没有版本**。推导（计划 §2.3）：

| 方案 | 结果 |
|---|---|
| 不修，push 带「本地 ∪ 记录 echo」并集 | **取消标签失效**：echo 里含已取消的标签，被并集推回服务端**复活** |
| 不修，`pull→push` + 推本地集合 | 消除数据丢失（不再清空服务端），但"取消关联"仍可能被另一台设备陈旧全量 push **复活** |
| 不修，`push→pull` + 下行全量替换 | 本地未推送的取消改动在 pull 时被远端旧视图覆盖 → **换一边丢** |
| **修**（带 `updated_at`/`deleted_at` + 独立同步键 + 逐条合并） | **唯一的彻底解**：两侧的增、删都能无歧义合并 |

**客户端软删**（`src/data/questions.ts:160`）：`dbRemoveTagFromQuestion` 不再 `removeItem`，而是置 `deleted_at`；本地无记录也**写墓碑**，确保"取消关联"能跨设备传播且不被复活。

**索引侧**（`src/data/tags.ts:44`）：`buildTagIndex` 跳过 `deleted_at` 的关联，软删墓碑不计入题目标签索引。

### 3.3 配置（`groups`/`tag_categories`/`app_settings`）同步——settings 通道

- `dbBuildSyncPayload` 把三者序列化进 `payload.settings`（`collectConfigSnapshot`）。
- 服务端 `mergeUserSettings` 是**浅合并（按顶层键整块替换）**→ **集合级 LWW**，不做逐条时间戳。
- 本机"无未推送改动"的判定：当前内容 `configSnapshotHash` 等于上次成功推送后记录的 hash（`configPushedHash`）。**推送成功后**才在 `dbFinalizeSuccessfulSync` 记录 hash；失败时保持"未推送"，避免下次同步误采用远端覆盖本地。
- `dbReplaceWithRemoteSnapshot`（doSyncDown 语义="以服务器为准"）**强制**采用远端配置（`forceConfig:true`）。

### 3.4 同步顺序

`runSync` 采用 `pull → push`（计划 P0-9）：逐条合并语义下顺序已不影响正确性；先 pull 可少一次往返，并让首次同步后本地视图即完整。

---

## 四、关键裁决清单

| # | 决策点 | 裁决 | 被否掉的方案 / 理由 |
|---|---|---|---|
| **A1** | 一题可否同属多个章节 | **允许重叠** | 标签驱动本身就意味着重叠；综合题跨章是常态 |
| **A2** | 章节是否需要"手动归入"通道 | **不需要** | `member_tag_id` 仅 topic 使用；每题都有核心标签表达归属 |
| **A3** | "核心标签"是否升级为数据字段 | **不升级** | 它只是打标签时的心智习惯，且可能有两个（综合题）；既然允许重叠，"哪个是核心"无下游用途 |
| **A5** | 章节编辑器是否开放"且/或分组" | **只给"或"** | 见 §2.5；限制只加在 UI 校验上 |
| **D1(入口)** | 是否新增"未打标签的题"入口 | **新增** | 实测主账号 94 道有效题中 6 道零标签（4 道真实题）会静默掉出所有章节 |
| **D-b** | 未分类标签是否进**章节选择器** | **不进**（改提示"还有 N 个未分类 → 去分类"）；**专题选择器保留显示**未分类 | 原以"死循环"为由要求显示，但引入"新建标签强制选类别"后该理由消失；显示未分类会让它**绕过类别过滤** |
| **E4** | 表达式嵌套深度 | 数据结构递归**不限深**；UI 限**两层** | 放开只需改一处 UI 校验 |
| **E6** | 题目列表是否解析表达式 | **不解析** | 列表只消费成员集合；控制爆炸半径 |
| **O1** | 遗留专题「力学综合」 | 不迁移，手动重建 | 保留 `topics` 表不动，零丢失 |
| **O3** | 系统成员标签是否在题目卡片显示 chip | **显示** | 带区分标记「📁」 |
| **O5** | D6 本轮是否修 | **一并修**（2026-09-12 改判） | D3 与 D6 同源、改同一批文件；不修会导致专题成员静默漂移 |
| **P1** | 本轮范围 | **Phase 0+1+2 一起做，Phase 3（设备快照）延后** | Phase 3 与章节/专题无依赖 |
| **P2** | `groups`/`tag_categories` 本地权威 | **IndexedDB store 为唯一权威** | 让同步与备份读同一份数据 |
| **分支 C** | 生产库安全 | 冷备我做（含 `-wal`）；schema 变更先在副本演练；重启服务由王先生做 | 不碰生产库业务数据 |

---

## 五、不涉及边界（防误伤，一律不动）

1. **遗留数据**：`topics` / `topic_questions` 表与数据保留，不 DROP / 不清空 / 不迁移；客户端 `dbTopics` / `dbTopicQuestions` store 保留（备份仍包含）。
2. **PDF 导出**：`src/data/pdf*.ts`、`src/ui/export-pdf-ui.ts`、`unit-tests/pdf-*.spec.js` 不动。
3. **端侧 AI**：`src/services/ai.ts`、`src/ui/ai-model-ui.ts`、Gemma4 / llama.cpp 相关不动。
4. **试卷云端链路**：`papers` / `paper_questions` / `pdf_url` / `upload-pdf` 不动（仅 `dbGetAllPapers` 的题数口径修正，见回归文档）。
5. **题目列表版式切换**（单双栏、勾选框热区）不动。
6. **不引入新 CSS token**，只用 `src/styles/main.css` 现有变量。
7. **不删除、不重命名**任何现有 store、路由、同步键。
8. **不在题目列表筛选区引入表达式编辑**（E6）。

---

## 六、验证证据

> 本机 CI 循环由本次收口任务实测（2026-10-09），命令与原始输出如下。E2E 采用 `NODE_OPTIONS= npx playwright test --reporter=list --workers=1 --output=tmp/test-results-r6`。

### 6.1 CI 四项

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **exit 0**（0 错误） |
| 单元测试 | `npm run test` | **437 passed / 9 skipped (446)**，31 passed + 1 skipped 文件（唯一 skipped 文件为 `unit-tests/real-api.spec.js`，8 tests skipped，外部 API 无网络，属环境问题） |
| 生产构建 | `npm run build` | **✓ built in 1.05s**（`dist/index.html 88.27 kB`、`index-B_SpUS_B.js 332.99 kB`；1 条 INEFFECTIVE_DYNAMIC_IMPORT 警告为既有） |
| 全量 E2E | 见上 | **126 tests / 1 worker → 124 passed / 2 failed**；2 条失败**全部**为 `tests/semantic-diag.spec.js`（语义服务不可达，环境问题，预先已知），**无其它红**（详见 §6.4） |

（原始输出原文见本文末「附录 A」。）

### 6.2 功能相关测试覆盖

| 层 | 文件 | 覆盖 |
|---|---|---|
| 单测 | `unit-tests/question-tag-sync.spec.ts` | P0-1 双向合并 / P0-4 逐条合并 / P0-5 软删传播 / P0-7 时间戳兜底 / P0-8 旧备份兼容 / P0-10 清空 / buildTagIndex 跳过软删 |
| 单测 | `unit-tests/group-membership.spec.ts` | 2.3 表达式求值（空/单标签/嵌套/死引用/去重/移除/回显）+ 2.1 groups 数据层 + 成员并集 |
| 单测 | `unit-tests/tag-categories-phase1.spec.ts` | 1.1 种子 / 1.2 `dbUpdateTag` / 1.7 category_id 传播 / N1 零标签查询 / 1.3 类别 CRUD + 系统类保护 / 1.6 可见性 |
| 单测 | `unit-tests/config-sync.spec.js` | 2.13 配置同步（hash 稳定、hasLocalUnpushed 判定、force 语义） |
| E2E | `tests/group-filter.spec.js` | 2.9 筛选层 AND / 2.10 加入移出专题 / 2.11 快速导入「专」圆钮 / 2.12 系统 chip |
| E2E | `tests/group-editor-visibility.spec.js` | 2.4 章节编辑器（只给或）/ 2.4/2.6 专题编辑器（且或+两层）/ 2.7 删标签级联 / 2.8 删专题级联 |
| E2E | `tests/tag-categories-phase1.spec.js` | 类别分区可见性 + 配置持久化 + 新增类别 |
| E2E | `tests/tag-categories-phase2.spec.js` | 1.4 批量分类 / 1.5 三处强制选类别 / N1 未打标签入口 |

### 6.3 复现演练（红 → 绿）

| 演练 | 红 | 绿 | 覆盖点 |
|---|---|---|---|
| shape 回归（本次收口前） | `tmp/test-results-drill-red`：`status=failed`，4 条 `tests/app.spec.js` 主流程用例失败（带图导出/HTML 转义/垃圾篓/PDF——均走标签渲染路径） | `tmp/test-results-drill-green`：`status=passed`，`failedTests=[]` | 详见 `docs/fix-qtag-shape-regression.md` |
| 强制选类别（R2） | `tmp/test-results-r2b-red`：`status=failed`，`tag-categories-phase2 …新建标签弹窗：未选类别被拦截` | `tmp/test-results-r2b-green`：`status=passed` | 1.5 三处入口 |
| 筛选层 AND（R4c） | `tmp/test-results-drill` / `drill2`：`status=failed`，`group-filter 2.9 …选定后回显表达式摘要并与标签层 AND` | 全量 E2E 中该用例现为 ✓ | 2.9 |

> 说明：`test-results-drill` / `drill2` 的红→绿证据链为：先出现失败（独立目录留证），修复后在全量 E2E 中转为通过。该用例在全量 r6 中已为 ✓。

### 6.4 全量 E2E 结果与截图

- **结果**：`126 tests using 1 worker` → **`124 passed`（2.6m） / `2 failed`**。
  - 2 条失败**全部**是 `tests/semantic-diag.spec.js`（`:16` 登录后自动拉取向量 + `:105` 长查询命中快照题），根因为**语义服务（`/api/embed/vectors`）不可达**，属环境问题（预先已知，非本次回归）。
  - **除该 2 条外无任何其它失败**（`semantic-diag.spec.js` 另有 2 条通过，属本 spec 内可达的部分）。
  - 全量日志原文：`tmp/e2e-r6-full.log`。
- **截图清单**（`test-results/screenshots/`，本功能相关 16 张）：

> **落盘位置说明（诚实记录）**：本次收口 E2E 运行中，`tests/semantic-search.spec.js:4` 在模块作用域执行了
> `process.env.E2E_SCREENSHOT_DIR = 'tmp/test-results-semantic/screenshots'`；因 `--workers=1` 复用同一 worker 进程，
> 该环境变量**泄漏**到其后所有 spec，导致本次截图实际落盘到 `tmp/test-results-semantic/screenshots/`（mtime 14:10–14:12，本次新鲜产物），
> 而 `test-results/screenshots/` 下的同名文件是**上一轮运行**的副本。两张目录中本功能截图文件名一致，内容为同名控件。
> （此为测试基建小瑕疵，**非本功能缺陷**，按「只验证不修」原则不改。）

| 截图文件 | 覆盖控件 |
|---|---|
| `gap1_batch_categorize.png` | 1.4 批量分类界面（关键词预填 + 逐项确认） |
| `gap2_force_category.png` | 1.5 新建标签弹窗强制选类别 |
| `gap2_inline_force_category.png` | 1.5 题内联新建标签强制选类别 |
| `gap3_untagged_entry.png` | N1「未打标签的题（N）」入口 |
| `tag_categories_partition.png` | 1.3 标签管理「类别」分区 |
| `tag_categories_add.png` | 1.3 新增类别 |
| `tag_categories_visibility_persist.png` | 1.6 选择器可见性配置持久化 |
| `r4b_chapter_picker_visibility.png` | 2.6 章节选择器按 D-b 隐藏未分类并给「去分类」提示 |
| `r4b_group_editor_chapter.png` | 2.4 章节编辑器（只给「或」+ 每节点题数） |
| `r4b_group_editor_topic.png` | 2.4/2.6 专题编辑器（且/或 + 两层 + 跨分组角标） |
| `r4b_tag_cascade_modal.png` | 2.7 删标签级联清理弹窗（列出题数变化） |
| `r4b_group_delete_modal.png` | 2.8 删专题级联清理弹窗（列出手动归入题数） |
| `r4c_filter_layers.png` | 2.9 列表筛选区（章节行/专题行/标签 chips，层间 AND） |
| `r4c_group_assign_modal.png` | 2.10 加入/移出专题 |
| `r4c_quick_topic_panel.png` | 2.11 快速导入「专」圆钮内联面板 |
| `r4c_system_tag_chip.png` | 2.12 系统成员标签 chip |

### 6.5 API 层双账号实测（历史，非本次收口）

Phase 0 的同步语义在**API 层双账号**做过实测（D2/D3/D6/D1 共六条断言全过）并有单测覆盖；该实测为历史证据，非本次收口新跑（见 §7 未验证项）。

---

## 七、已知限制与未验证项

> **诚实声明**：以下逐条区分「本次实测」与「仅推理 / 历史证据」。

| # | 未验证项 | 状态与说明 |
|---|---|---|
| 1 | **多设备真实同步未联调** | Phase 0/1/2 的同步语义只做过 **API 层双账号实测**（D2/D3/D6/D1 六条断言全过）与单测；**真机跨设备**未验。2.13 的配置同步**仅单测覆盖**（`unit-tests/config-sync.spec.js`）。**本次收口未做真机联调**。 |
| 2 | **灾难恢复（空设备 / 重装后恢复）仍未验证** | 至今只验过"**同设备、同 IndexedDB**"的导出→恢复（计划 §0.5 分支 E）。它**证明不了"手机丢了还能救回来"**。建议排在 Phase 0 验收之后，在平板上做「清空 APP 数据 → 登录同步 → 从分片备份恢复」完整演练（**必须 Phase 0 之后**）。**本次未做**。 |
| 3 | **`server/` 从来没有类型检查** | 无 typecheck 脚本；根 `tsconfig` 不含 `server`；`server/tsconfig.json` 缺 `@types/node` / `@types/express`。**装完依赖后仍有 9 个遗留错误**（在 `questions.ts` / `tags.ts`）。本次只保证**改动不新增**错误，未做全量类型检查。 |
| 4 | **E2E 的 `/api` 实际连生产后端** | 经 vite 代理指向 `:3001`（生产服务）。**本次 E2E 是在此前提下跑的**（测试数据落生产库测试账号），未改为独立后端。 |
| 5 | **本功能全部改动未提交** | 且本 worktree **落后 `f640/main2` 15 个提交**（含语义检索等）；合并时**有 7 个文件冲突面**。 |
| 6 | 章节素材依赖人工分类 | D-b 推论：Phase 1 交付后须先把存量标签分类完，Phase 2 的章节才有素材；否则章节打开为空（可能被误判为功能故障）。存量分类进度不由本功能保证。 |

---

## 八、架构影响

- **是否跨模块改动**：是。同时改客户端（data/services/ui/types 四层）、服务端（schema/sync-upsert）、备份链路。
- **是否新增依赖**：否（无新增 npm 依赖）。
- **是否影响已有功能**：是。同步链路（关联同步语义）、备份兼容（关联新增两字段）、题目卡片/详情渲染（扁平契约对齐）、建造 `dbGetAllPapers` 题数口径均受影响；已在 §6 用 CI + E2E 复核。
- **兼容性**：旧备份（关联记录无时间戳）导入不报错（P0-8）；存量关联记录无 `updated_at` 用 `created_at` 兜底（P0-7）；服务端存量行兜底 0，保证可写入。

---

## 附录 A：CI 原始输出

### A.1 `npm run typecheck`

```
> question-bank-local@1.0.0 typecheck
> tsc --noEmit
```
（无任何错误输出；进程 exit code = 0）

### A.2 `npm run test`（tail -12）

```
   请设置环境变量: export OPENROUTER_API_KEY=your_key
   或复制 .env.example 到 .env 并填写


 ↓ unit-tests/real-api.spec.js (8 tests | 8 skipped)
 ✓ unit-tests/backup-export-completeness.spec.ts (3 tests) 2ms

 Test Files  31 passed | 1 skipped (32)
      Tests  437 passed | 9 skipped (446)
   Start at  14:10:09
   Duration  3.87s (transform 1.55s, setup 0ms, import 2.50s, tests 821ms, environment 23.88s)
```

### A.3 `npm run build`

```
> question-bank-local@1.0.0 build
> vite build

vite v8.1.5 building client environment for production...
transforming...✓ 76 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                             88.27 kB │ gzip:  16.71 kB
dist/assets/pdf.worker.min-DEtVeC4l.mjs  1,255.06 kB
dist/assets/index-DhLOF1sc.css              35.67 kB │ gzip:   7.06 kB
dist/assets/index-B_SpUS_B.js              332.99 kB │ gzip: 100.80 kB
dist/assets/pdf-BMz2qUaN.js                425.24 kB │ gzip: 126.73 kB

[INEFFECTIVE_DYNAMIC_IMPORT] src/data/stores.ts is dynamically imported by ... dynamic import will not move module into another chunk.

✓ built in 1.05s
```

### A.4 全量 E2E（tail）

```
  2 failed
    tests/semantic-diag.spec.js:16:3 › 语义检索真实链路诊断（连真实 server，非 mock） › 登录后重开 App：自动拉取向量 + 相似题可用 ────
    tests/semantic-diag.spec.js:105:3 › 语义检索真实链路诊断（连真实 server，非 mock） › 登录后长查询命中测试账号快照题（阈值 0.25） ───
  124 passed (2.6m)
```

（`126 tests using 1 worker`；完整原文 `tmp/e2e-r6-full.log`）
