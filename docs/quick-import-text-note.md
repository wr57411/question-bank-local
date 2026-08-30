# 快速导入栏「添加文字笔记」功能实现

- **日期**: 2026-08-30
- **关联计划**: `docs/plans/2026-08-30-quick-import-text-note.md`（已实施）
- **关联模块**: 快速导入, 题目笔记, UI
- **预览图**: `designs/quick-import-text-note-preview.png`

## 功能摘要

快速导入栏第三行（确认按钮左侧）设有「📝 笔记」切换按钮，点击可在收起/展开间切换。**输入区默认展开**（2026-08-30 用户确认：默认场景就是写文字笔记），≤500 字带字数统计。导入确认时，文字写入本题既有笔记（`question_notes` 的 `text_note` 字段，标签「笔记 v1」）；不填则维持原空笔记行为，不影响现有流程。确认成功后清空文字并保持展开，便于连续录入；用户手动收起后保持收起直到再次点开或重置。

## 关键设计决策（与原计划的差异）

原计划假定在题目记录上**新增 `note` 字段并修改同步链路**。实施前摸底发现项目已有完整的 `question_notes` 体系（`src/data/notes.ts`），且：

1. 快速导入确认时本就会创建一条空「笔记 v1」（原 `quick-import.ts:183` `text_note` 传空串）；
2. `question_notes` 已全量纳入同步（`src/data/sync.ts:70` push、`:134` apply snapshot）。

**经用户确认改为复用现有笔记体系**：文字直接写入 `text_note`，同步链路零改动，题目详情笔记区直接可见。此项为对原计划的最主要偏差，原因：避免重复建数据实体、消除同步丢字段风险、改动面最小。

## 变更清单

| 文件 | 变更 |
|------|------|
| `src/index.html` | 新增 `#qi-note-btn`（紫色虚线样式，含 `#qi-note-dot` 圆点标记）、`#qi-note-area`（标题 + `#qi-note-count` 字数 + `#qi-note-input` textarea(maxlength=500) + 说明文案），CSS 全内联，使用设计 token |
| `src/ui/quick-import.ts` | 新增 `toggleQuickNote` / `onQuickNoteInput` / `readQuickNoteText` / `resetQuickNote` / `isQuickNoteExpanded` / `applyNoteBodyPadding`；`confirmQuickImport` 读取笔记文本传入 `dbAddQuestionNote`，成功后重置；`toggleQuickImportMode` 关闭时重置；`render()` 末尾绑定 textarea input 事件 |
| `src/main.ts` | window 导出 `toggleQuickNote`、`onQuickNoteInput`（供 HTML onclick / 事件绑定） |
| `unit-tests/quick-import-note.spec.ts` | 新增 9 个单测（TDD 先行）：展开/收起/聚焦、字数统计、圆点标记、超 500 字截断、空白返回空串、DOM 缺失不抛异常、重置 |
| `tests/quick-import-visibility.spec.js` | 新增 3 个 E2E：按钮默认可见（390×844 + `assertVisiblyRendered`）、展开后输入区可见可交互、展开后 `padding-top` 补偿 ≥ 栏高 |

## 边界与异常处理

- 空白/未填笔记 → `readQuickNoteText()` 返回空串，`dbAddQuestionNote` 仍创建空「笔记 v1」（与原有行为一致），不产生额外数据
- 输入超 500 字 → `maxlength` 属性 + `onQuickNoteInput` 内 `slice(0,500)` 双重截断
- DOM 缺失（bar 未渲染等）→ 各函数直接返回/空串，不抛异常
- 导入失败 → 走既有 `catch` 提示「导入失败：…」，笔记输入不清空（便于重试）
- 退出快速导入模式 → 输入清空并收起
- 笔记展开增高顶栏 → `applyNoteBodyPadding()` 动态把 `body.paddingTop` 从 196px 提到 312px，正文不被遮挡（E2E 有断言）

## 实施中发现并修复的真实 bug（E2E 抓住）

1. **对比度不足**：字数统计原用 `--text-tertiary`，但版本皮肤（`version-skin.ts`）运行时把 `--accent-light` 替换为 #FEF3C7，对比度跌至 1.78。改为 `--accent-dark`（两种皮肤下 ≥4）。已做复现性演练：临时改回确认测试失败，再还原。
2. **事件漏绑**：textarea 的 `input` 监听初版未在 `render()` 绑定，字数/圆点不更新。补绑后通过。

## 验证记录

- `npm run typecheck` ✅
- `npx vitest run`（除 `real-api.spec.js`，需真实 API，沙箱内被资源限制 SIGKILL）14 文件 219 通过 ✅
- `npm run build` ✅（仅既有警告）
- `npx playwright test tests/ui-health.spec.js tests/quick-import-visibility.spec.js` 34/34 ✅
- 截图人工评估（收起态 + 展开态，390×844）✅

## 追加：默认展开（2026-08-30 晚，用户真机反馈后确认交互）

- 变更：`#qi-note-area` 默认展开（HTML 去 display:none）；`resetQuickNote` 重置后保持展开（清空文字便于连续录入）；手动收起则保持收起
- 单测 `unit-tests/quick-import-note.spec.ts` 断言翻转，9/9 ✅
- E2E 三用例改写为默认展开语义（默认态可见、收起/展开切换、padding 默认补偿且收起回落），34/34 ✅
- typecheck ✅、build ✅、默认展开态截图（390×844）人工评估 ✅；用户真机验证效果正常
