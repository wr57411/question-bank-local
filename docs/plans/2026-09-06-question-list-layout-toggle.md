# 题目列表单栏/双栏切换 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 题目列表支持用户手动切换单栏/双栏（默认单栏），选择持久化到 localStorage，切换即时生效、刷新后保持。

**Architecture:** 列数不再由 CSS 媒体查询强制，改由 `#questions-list` 上的模式 class（`.grid-single`/`.grid-double`）控制；TS 侧三个函数负责读取缓存（非法值回退 `single`）、应用 class、切换并写缓存；HTML 在列表标题行放一个切换按钮，通过既有 window 导出模式挂载。

**Tech Stack:** 纯前端——CSS Grid + TypeScript（无框架）+ localStorage；E2E 用 Playwright（`@playwright/test`）。

**项目硬规则（覆盖 skill 默认行为，执行者必须遵守）：**
- **禁止 git commit/push**。AGENTS.md 规定 AI 完成全部改动后等用户检查、由用户统一提交。因此本计划所有 Task 末尾的收尾步骤都是「报告完成」，不是 commit。
- E2E 必须以 `NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-<新目录>` 运行，截图目录用 `E2E_SCREENSHOT_DIR` 指向 `tmp/`，测试产物一律不落项目根目录。
- 客户端源码不加注释；UI 改动必须截图并实际 Read 人工确认。

**背景（为什么改）：** 2026-09-06 用户反馈手机上双栏并排导致题目照片被压到约 85×110px 看不清。物理根源：`main.css:259` 强制两列 + `.question-card img` 固定高度 110px + `object-fit:contain`（竖图按高度缩放）。用户裁决：改为可切换，默认单栏。

**当前状态（2026-09-06）：** 防回归 spec 已写好于 `tests/question-list-single-column.spec.js`（5 用例），**尚未成功运行**（两次被会话中断 SIGTERM/exit 137，非代码问题）；实现代码一行未动。

---

### Task 1: 红灯——运行 spec 确认全部失败

**Files:**
- Test: `tests/question-list-single-column.spec.js`（已存在，勿改）

**Step 1: 运行 spec**

```bash
cd /Users/john/WorkBuddy/Worktrees/question-bank-local/f640-main2-de235076
E2E_SCREENSHOT_DIR="$PWD/tmp/screenshots-single-column" NODE_OPTIONS= \
  npx playwright test tests/question-list-single-column.spec.js \
  --reporter=list --output="$PWD/tmp/test-results-single-column-pre"
```

长耗时命令建议用 run_in_background + TaskOutput 拉取，避免会话中断杀进程（此前两次 exit 137 即此原因）。

**Step 2: 预期结果**

Expected: **5 failed**（`#grid-layout-toggle` 按钮不存在 → `toBeVisible` 失败；布局为双栏 → 单轨道断言失败）。这是「新增测试要能复现它要防的 bug」的强制验证。若有用例意外通过，停下分析，不许继续。

---

### Task 2: CSS——列数改由模式 class 控制

**Files:**
- Modify: `src/styles/main.css:153`（基础规则）、`:259`（≤480px）、`:267`（≥768px）、`:275`（≥768px 第二块）、`:281`（≥1024px）

**Step 1: 替换 `:153` 基础规则**

```css
/* 旧 */
.question-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--space-md)}
/* 新 */
.question-grid{display:grid;gap:var(--space-md)}
.question-grid.grid-single{grid-template-columns:1fr}
.question-grid.grid-double{grid-template-columns:repeat(2,1fr)}
.question-grid.grid-single .question-card img{height:auto;max-height:420px}
```

单栏图片 `height:auto` 让竖图按全宽自然比例展示（可读性的关键）；`max-height:420px` + 既有 `object-fit:contain` 保证超长图不裁切、居中留白。特异性 `.question-grid.grid-single .question-card img`(0,3,1) > 媒体查询里 `.question-card img`(0,1,1)，单栏大图在手机上能正确覆盖 110px。

**Step 2: 删除各断点里的列数声明（保留其余属性）**

- `:259` `@media(max-width:480px)` 内：`.question-grid{grid-template-columns:repeat(2,1fr);gap:var(--space-sm)}` → `.question-grid{gap:var(--space-sm)}`
- `:267` `@media(min-width:768px)` 内：`.question-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-md)}` → `.question-grid{gap:var(--space-md)}`
- `:275` 同块内：`.question-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}` → 整行删除
- `:281` `@media(min-width:1024px)` 内：`.question-grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}` → 整行删除

不动：`.similar-list`（详情页相似题两栏）、`.question-card img` 固定高度 130/110/160px（双栏模式的旧行为）、`:260/:268` 等其余属性。

**Step 3: 设计决策记录（已与用户确认）**

列数语义全视口一致：单栏=1 列、双栏=2 列（含桌面 ≥768px），保证切换按钮在任何视口都有效果；双栏保持旧紧凑图片高度（点详情看大图）。

**Step 4: 报告完成，不 commit。**

---

### Task 3: TS——布局状态三个函数 + renderQuestions 幂等应用

**Files:**
- Modify: `src/ui/question-core.ts`（文件顶部常量区 `:6-9` 附近 + `renderQuestions()` `:109`）

**Step 1: 在 `const w = window as any;` 之后添加（不加注释，遵循项目规范）**

```ts
type QuestionGridLayout = 'single' | 'double';
const GRID_LAYOUT_STORAGE_KEY = 'question-grid-layout';

export function getQuestionGridLayout(): QuestionGridLayout {
  try {
    return localStorage.getItem(GRID_LAYOUT_STORAGE_KEY) === 'double' ? 'double' : 'single';
  } catch { return 'single'; }
}

export function applyQuestionGridLayout(layout: QuestionGridLayout = getQuestionGridLayout()): void {
  const list = document.getElementById('questions-list');
  if (!list) return;
  list.classList.toggle('grid-single', layout === 'single');
  list.classList.toggle('grid-double', layout === 'double');
  const btn = document.getElementById('grid-layout-toggle');
  if (btn) btn.textContent = layout === 'single' ? '▤ 双栏' : '▦ 单栏';
}

export function toggleQuestionGridLayout(): void {
  const next: QuestionGridLayout = getQuestionGridLayout() === 'single' ? 'double' : 'single';
  try { localStorage.setItem(GRID_LAYOUT_STORAGE_KEY, next); } catch {}
  applyQuestionGridLayout(next);
}
```

要点：读取仅认 `'double'`，null/非法值/隐私模式异常一律回退 `'single'`（默认值处理）；`applyQuestionGridLayout` 检查元素存在，页面初始 HTML 即有 `#questions-list` 与按钮，不会空转。

**Step 2: `renderQuestions()`（`:109`）函数体首行插入**

```ts
applyQuestionGridLayout();
```

幂等（toggle class 等价操作），保证任何初始化/重渲染路径下容器 class 与按钮文案都正确。

**Step 3: 确认导出链路**

读 `src/ui/index.ts`：若为 `export * from './question-core'` 则新函数自动导出，无需改动；若为逐个具名导出，追加三行。

**Step 4: 报告完成，不 commit。**

---

### Task 4: HTML 切换按钮 + main.ts 挂载 window

**Files:**
- Modify: `src/index.html:314-317`（列表标题行右侧按钮组）
- Modify: `src/main.ts:241-254`（Batch 3: question-core 导出区块）

**Step 1: `index.html` 在 `#selected-count` 与「导出 PDF」按钮之间插入**

```html
<button id="grid-layout-toggle" onclick="toggleQuestionGridLayout()" style="padding:10px 14px;font-size:13px;border-radius:var(--radius-md)">▤ 双栏</button>
```

按钮文案显示**目标模式**（单栏时显示「▤ 双栏」= 点击切到双栏），运行时由 `applyQuestionGridLayout` 同步，HTML 初始文案仅为禁 JS 兜底。

**Step 2: `main.ts` Batch 3 区块（`:251` `toggleQuestionSelect` 附近）追加**

```ts
getQuestionGridLayout: ui.getQuestionGridLayout,
applyQuestionGridLayout: ui.applyQuestionGridLayout,
toggleQuestionGridLayout: ui.toggleQuestionGridLayout,
```

HTML `onclick` 需要 window 上的函数，漏导出则点击报 `ReferenceError`。

**Step 3: 报告完成，不 commit。**

---

### Task 5: 绿灯——spec 全部通过 + 截图人工确认

**Files:**
- Test: `tests/question-list-single-column.spec.js`（5 用例：默认单栏单轨道、点击切双栏+写缓存、刷新持久化双向、单栏图片渲染高>200px、双栏图片<200px）

**Step 1: 重跑 spec**

```bash
E2E_SCREENSHOT_DIR="$PWD/tmp/screenshots-single-column" NODE_OPTIONS= \
  npx playwright test tests/question-list-single-column.spec.js \
  --reporter=list --output="$PWD/tmp/test-results-single-column-post"
```

Expected: **5 passed**。

**Step 2: 实际 Read 截图（强制，不许只看测试变绿）**

- `tmp/screenshots-single-column/默认单栏-手机视口.png` → 确认单栏、卡片独占整行、题目图片明显变大
- `tmp/screenshots-single-column/切换后双栏-手机视口.png` → 确认两列并排、图片紧凑
- `tmp/screenshots-single-column/单栏图片可读性.png` → 确认竖图完整可读、无裁切

---

### Task 6: 本地 CI 循环（全绿才交付）

**Step 1: 按序执行，任一失败立即修复并重跑**

```bash
npm run typecheck        # Expected: 无错误
npm run test             # Expected: 全部通过（vitest 已清 NODE_OPTIONS，约 2.5s）
npm run build            # Expected: 构建成功
NODE_OPTIONS= npx playwright test --reporter=list --output="$PWD/tmp/test-results-single-column-full"   # 全量 E2E
```

**Step 2: 全量 E2E 风险预案**

已检索 `tests/`：现有断言只查 `.question-card` 数量/点击，无列数断言，预期安全。若出现意外失败，先判定是否本改动引起，再按 AGENTS.md「发现问题立即修复」处理。

---

### Task 7: 文档收尾

**Files:**
- Create: `docs/fix-question-list-layout-toggle.md`（按 AGENTS.md 模板：问题摘要/根因/改动清单/验证记录）
- Modify: `AGENTS.md` 开发文档索引（追加一行）

**Step 1: 写开发文档、更新索引。**
**Step 2: 汇总「功能完成清单 + 偏离设计稿说明」，等用户检查后由用户统一 commit/push。**

---

## 验收清单

- [ ] 红灯：Task 1 五用例全 failed（复现 bug）
- [ ] 绿灯：Task 5 五用例全 passed
- [ ] 截图经人工 Read 确认（单栏大图可读、双栏紧凑、按钮存在）
- [ ] typecheck / test / build / 全量 E2E 全绿
- [ ] 默认单栏；切双栏写 `localStorage['question-grid-layout']='double'`；刷新保持
- [ ] 未 commit，等待用户检查
