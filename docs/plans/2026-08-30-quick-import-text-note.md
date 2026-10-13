# 快速导入栏「添加文字笔记」实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **状态：已实施（2026-08-30）。** 预览图见 `designs/quick-import-text-note-preview.png`（HTML 源文件 `designs/quick-import-text-note-preview.html`）。
> **实施偏差（经用户确认）**：数据归属由「题目新增 note 字段 + 改同步链路」改为**复用既有 question_notes 体系（text_note）**——quick-import 确认时本就创建空「笔记 v1」，且 question_notes 已全量同步，复用后同步零改动。Task 3 相应以验证代替。详见 `docs/quick-import-text-note.md`。

**Goal:** 在快速导入栏中新增「添加文字笔记」入口，允许在导入题目的同时附一段文字笔记，与题目一起保存并同步。

**Architecture:** 复用快速导入栏现有三行结构，在第三行（组合/双栏/确认）插入「📝 笔记」切换按钮；点击展开第四行多行输入区。笔记文本作为 `note` 字段挂在本次导入生成的题目数据上，走现有 confirmQuickImport 保存链路与同步链路。

**Tech Stack:** TypeScript（src/ui/quick-import.ts）、src/index.html（内联 CSS）、IndexedDB（localForage）、服务端 sync（push/pull 全量对比）。

---

## 设计决策（依据预览图）

| 决策点 | 方案 |
|-------|------|
| 入口形态 | 「📝 笔记」切换按钮，位于确认按钮左侧；紫色虚线样式（`--accent`）与现有按钮区分 |
| 默认状态 | 收起；已有笔记时按钮显示圆点标记 |
| 输入区 | 展开态显示多行输入框（≤500 字），带字数统计与说明文案 |
| 数据归属 | 笔记绑定到本题（挂题目字段），非独立实体 |
| 空值处理 | 不填写则不产生 `note` 字段，不影响现有导入流程与老数据 |

## 变更清单

**Files:**
- Modify: `src/index.html`（快速导入栏 DOM：第三行加按钮 + 新增第四行输入区，内联 CSS，遵循现有内联样式风格）
- Modify: `src/ui/quick-import.ts`（按钮 toggle 逻辑、字数统计、confirmQuickImport 时把 note 写入题目数据、重置逻辑）
- Modify: 同步 payload 构建与远端应用函数（`dbBuildSyncPayload` / `dbApplyRemoteSnapshot` 所在模块）——**必须**把 `note` 字段纳入同步，避免重蹈 2026-07-16「versions 字段同步被丢弃」的覆辙（见 `docs/fix-version-sync-missing.md`）
- Modify: 题目详情/编辑表单（可选，第二期）：展示与编辑已有笔记
- Test: `tests/quick-import-visibility.spec.js` 扩展

### Task 1: DOM 与样式（纯结构，不含逻辑）

1. 在 `#qi-confirm-btn` 前插入 `#qi-note-btn`（📝 笔记，紫色虚线样式）。
2. 在第三行后插入 `#qi-note-area`（默认 `display:none`）：标题行（✏️ 文字笔记 + 字数）+ `textarea#qi-note-input`（maxLength=500）+ 说明文案。
3. CSS 全部内联，使用现有 CSS 变量（`--accent` / `--accent-light` / `--border`）。

### Task 2: 交互逻辑（TDD）

1. 先写失败测试：`tests/quick-import-note.spec.js`
   - 点击笔记按钮 → 输入区可见（`assertVisiblyRendered`）
   - 再点 → 收起
   - 输入文字后确认 → 题目数据含 `note` 字段；为空 → 无 `note` 字段
2. 运行确认失败 → 实现 toggle + confirm 集成 → 测试通过。
3. 状态重置：确认保存后、退出快速导入模式时清空输入区并收起。

### Task 3: 同步链路

1. `dbBuildSyncPayload` 包含 `note`；`dbApplyRemoteSnapshot` 应用 `note`。
2. 复用「同步数据丢弃检测」机制：若检测到 note 被丢弃给出警告（对齐 `docs/sync-data-integrity-detection.md`）。
3. 写单测覆盖 payload 含 note 往返。

### Task 4: E2E 可见性验证（强制）

1. 扩展 `tests/quick-import-visibility.spec.js`：手机视口（390×844）+ `assertVisiblyRendered` 断言笔记按钮与输入区（对比度 ≥3、无遮挡、无截断）。
2. 复现性验证：临时隐藏笔记按钮确认测试失败，再还原。
3. 运行命令（避免批量删除保护）：
   ```bash
   npx playwright test tests/quick-import-note.spec.js tests/quick-import-visibility.spec.js --reporter=list --output=test-results-qi-note
   ```
4. AI 实际 Read 截图确认，不能只看测试变绿。

### Task 5: CI 验证与文档

1. `npm run typecheck` → `npm run test` → `npm run build` → 指定 E2E 用例，全部通过。
2. 开发文档存入 `docs/`，更新 `AGENTS.md` 文档索引。
3. 打包验证：先加载 ship-feature skill，`npm run ship -- "快速导入支持文字笔记"`。

## 不涉及边界

- 不改动拍照/相册/裁剪流程
- 不做笔记的富文本/图片混排（纯文本 ≤500 字）
- 不做独立笔记管理列表页（第一期笔记只在题目详情可见）
- 不改服务端表结构（note 随题目 JSON 字段走）

## 风险

- 同步丢字段（历史已发生过 versions 丢字段）→ Task 3 单测 + 丢弃检测兜底
- 顶部栏高度增加遮挡内容 → 展开时正文区已有 padding-top 补偿逻辑需同步调整（实施时核对 `body paddingTop` 与 `qi-bar` 高度联动）
