# 修复题目标签形状契约回归（`question_tags` 扁平 vs `{tags:{...}}`）

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-10-09
- **关联模块：** `main.ts` 全局导出策略, `data/tags.ts` `buildTagIndex`, 题目列表/详情/表单标签渲染, 遗留 `public/db.js`, E2E
- **影响文件：** `src/main.ts`、`src/ui/question-core.ts`、`src/ui/question-detail.ts`、`src/data/papers.ts`、`tests/ui-health.spec.js`

---

## 一、问题现象

「关联章节 + 专题 + 标签分类体系」实施过程中，把未提交的 `src/main.ts` 一起带上后，**全量 E2E 由 100 passed / 0 failed 变为 15 条红**。

失败集中在**所有走"题目标签渲染"路径**的用例——列表渲染、详情页标签、表单标签、试卷题数等。表现为运行时抛错（读取 `undefined` 的属性），页面渲染中断。

---

## 二、根因分析

### 2.1 触发条件

`src/main.ts` 的改动把数据层全局从 **`assignIfMissing`（缺失才赋值）** 改为 **`assignToWindow`（强制覆盖）**：

```diff
- assignIfMissing({
-   dbGetAllQuestions: data.dbGetAllQuestions,
-   dbGetAllTags: data.dbGetAllTags,
-   dbBuildSyncPayload: data.dbBuildSyncPayload,
-   // …（数据层 db* 全局）
- });
+ assignToWindow({
+   // 强制覆盖遗留 public/db.js 的过期 db* 全局
+   dbGetAllQuestions: data.dbGetAllQuestions,
+   dbGetAllTags: data.dbGetAllTags,
+   // …
+ });
```

### 2.2 根因链

```
1) 历史遗留：public/db.js 与模块版 src/data/tags.ts 各有一份 buildTagIndex，返回形状不同：
       legacy public/db.js  →  每条标签是 { tags: { id, name, color } }（嵌套）
       模块 src/data/tags.ts →  每条标签是 { id, name, color }（扁平）
   （见 src/data/tags.ts:27 buildTagIndex，返回 Map<questionId, {id,name,color}[]>）

2) 覆盖策略：main.ts 原用 assignIfMissing，数据层模块函数"缺失才赋值"。
   运行时 window 上先被 legacy public/db.js 占用 → 模块版从未真正生效
   → 实际走的是 legacy 的嵌套形状。

3) 触发改动：本次把 main.ts 改为 assignToWindow 强制覆盖
   → 运行时切换为模块版 buildTagIndex（扁平形状）。

4) 崩溃：UI 仍按 legacy 嵌套形状读取：
       q.question_tags.map(qt => qt.tags)      // 期望 {tags:{...}}
       q.question_tags.map(qt => qt.tags.id)   // → undefined.id / undefined.color
   → 读 undefined 的属性 → 运行时抛错，标签渲染中断。
```

### 2.3 为什么此前一直没暴露（**潜伏期自 2026-07-25 起**）

**形状不一致本身自 2026-07-25（模块版 `buildTagIndex` 引入时）就已存在**，但因为：

- 数据层模块全局此前用 `assignIfMissing`，**从未真正覆盖** legacy `public/db.js`；
- 于是**渲染路径实际从未走到模块版的扁平数据**——UI 读 `qt.tags.*` 时拿到的一直是 legacy 的嵌套结构，**正常**。

**这是一个典型的"休眠契约不一致"**：两份实现各自自洽，但契约不同；只要覆盖策略一直偏向 legacy 一方，错误契约就不会被激活。`main.ts` 的强制覆盖，等于把电源从 legacy 切到模块版，**第一次真正让扁平数据流经 UI**，潜伏已久的形状分歧才暴露。

**教训层面的关键**：这不是"新写坏了"，而是"**切换了被读取的那份实现**"。回归测试覆盖的是**行为**，当两份实现行为恰好一致时，覆盖不到契约差异；差异只在切换实现的那一刻显形。

---

## 三、修复方案

**统一契约为模块版扁平形状**（`{id, name, color}`），把 UI 的 7 处读取对齐扁平契约；并顺带修正被同一根覆盖行为暴露的两处数据口径问题。

### 3.1 变更清单

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `src/ui/question-core.ts` | 修改 | 7 处读取中的 6 处：`getFilteredQuestions`（`t.tags.id`→`t.id`、`t.tags.name`→`t.name`）、`renderQuestions`（`qt.tags`→`qt`）、`onInlineTagSearch`（`qt.tags.id`→`qt.id`）、`showAddedTag`（`push({tags:tag})`→`push(tag)`）、`onFormTagSearch`（`qt.tags && qt.tags.id`→`qt.id`） |
| `src/ui/question-detail.ts` | 修改 | 第 7 处：`renderDetailContent` 的 `q.question_tags.map(qt => qt.tags)`→`q.question_tags` |
| `src/data/papers.ts` | 修改 | 修 `dbGetAllPapers` 题数：只计**存在且未软删/未彻底删除**的题目（软删题仍保留 join 行，不可直接按关联行计数） |
| `src/ui/*`（级联后） | 修改 | 删除标签/专题后**补刷新**（避免级联后列表残留） |
| `tests/ui-health.spec.js` | 修改 | 按设计变更更新用例：新建标签路径增加"先选类别再回车创建" |

> 说明：`question-core.ts` 与 `question-detail.ts` 合计 7 处 legacy 形状读取，与本次收口观察到的"UI 7 处对齐扁平契约"一致。

### 3.2 扁平契约对齐示例

```diff
- const tags = q.question_tags.map((qt: any) => qt.tags);
+ const tags = q.question_tags;                      // 已是扁平 {id,name,color}

- const qt = q.question_tags.map((t: any) => t.tags.id);
+ const qt = q.question_tags.map((t: any) => t.id);

- question.question_tags.push({ tags: tag });
+ question.question_tags.push(tag);
```

---

## 四、验证结果

### 4.1 复现演练（红 → 绿）

| 阶段 | 目录 | `status` | 失败集合 |
|---|---|---|---|
| 红 | `tmp/test-results-drill-red` | `failed` | 4 条 `tests/app.spec.js` 主流程用例（带图题目导出备份 / HTML 转义 / 垃圾篓移除 / 试卷 PDF——均走标签渲染路径） |
| 绿 | `tmp/test-results-drill-green` | `passed` | `failedTests: []` |

> 全量回归现象（15 红）由本阶段诊断记录给出；上表是收敛到"最小可复现集"后的定向演练证据（`app.spec.js` 4 条）。

### 4.2 本次收口全量 E2E

- 全量 E2E（`--workers=1`）**除既有环境问题外无红**：唯一失败为 `tests/semantic-diag.spec.js` 的 2 条（语义服务不可达，环境问题，预先已知）。
- 该项修复涉及的 `app.spec.js`、`question-detail` / 列表渲染相关用例现为**全绿**。

### 4.3 检查清单

- [x] 原问题已修复（扁平契约对齐后标签渲染不再读 `undefined`）
- [x] 未引入新问题（全量 E2E 无新增红；`npm run typecheck` 0 错；`npm run test` 437 passed）
- [x] 边界场景已测试（列表筛选、详情页标签、内联新建、表单搜索、试卷题数）

---

## 五、经验总结

1. **覆盖策略的改动会"激活"休眠的契约分歧**：`assignIfMissing → assignToWindow` 看似只是导出方式变更，实际切换了"哪一份实现生效"，从而把自 2026-07-25 潜伏的形状不一致第一次送进渲染路径。**改动全局覆盖策略时，必须假设"此前未生效的那份实现从未被行为测试覆盖过"。**
2. **双实现的同名函数是契约地雷**：legacy `public/db.js` 与模块 `src/data/tags.ts` 的 `buildTagIndex` 返回形状不同，却共享同名全局。删遗留实现或统一形状应作为独立任务显式登记，不能靠覆盖策略"碰巧选中正确的那份"。
3. **形状契约要单向钉死**：修复后以模块版**扁平形状**为唯一契约，并让所有读取点集中对齐；后续若再引入第二份实现，必须先删旧契约。
4. **回归测试要能复现它要防的 bug**：本次演练通过"把生效实现切回/切走"复现红、再转绿，验证了测试确实覆盖到该路径（见 §4.1）。
