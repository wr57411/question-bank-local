# 修复「快速导入」浮层遮挡反馈提交页面 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让「快速导入」浮层不再拦截反馈提交页（`#issue-feedback-modal`）的文字输入与提交按钮；进入提交流程时隐藏浮层，关闭弹窗后恢复；补充 Esc 键关闭能力；不改变快速导入原有功能与入口。

**Architecture:** 反馈弹窗打开时通过一个「抑制开关」隐藏快速导入栏（不改 z-index、不改入口逻辑），关闭弹窗后由快速导入模块自身的 `render()` 恢复；Esc 处理拆成两个互不耦合的全局 keydown 监听（反馈弹窗一个、快速导入一个，用「弹窗是否 active」做互斥判断）。

**Tech Stack:** 原生 DOM + TypeScript（无框架、无 Portal）；vitest + jsdom 单测；Playwright E2E（手机视口 390×844 + 桌面视口）。

---

## 一、勘察结论（Task 0 已完成，仅记录）

### 1. 快速导入浮层的渲染与定位

| 项 | 结论 |
|---|---|
| 渲染位置 | `src/index.html:19`，`<div id="quick-import-bar">` 直接写在页面顶层（原生 DOM，**无框架、无 Portal 挂载**） |
| 定位方式 | 内联样式 `position:fixed; top:0; left:0; right:0; z-index:1200` |
| 显示时机 | 由 `src/ui/quick-import.ts` 的 `render()`（第 184 行）控制：`el.style.display = quickMode ? '' : 'none'` |
| 状态来源 | `quickMode` 由 `initQuickImportMode()`（第 587 行）从 `localStorage.quickImportMode` 恢复，**开启后跨会话保留** |
| 高度 | 笔记输入区 `#qi-note-area` **默认展开**（2026-08-30 确认的交互），`applyNoteBodyPadding()` 用 `body padding-top 312px` 补偿 → 浮层实际高度约 312px |
| 关闭时机 | 仅用户点击「⚡ 快速导入」按钮 `toggleQuickImportMode()`；**没有任何与其他弹窗联动的隐藏逻辑，无 Esc 关闭** |

### 2. 反馈弹层的定位

| 项 | 结论 |
|---|---|
| 渲染位置 | `src/index.html:1084`，`<div id="issue-feedback-modal" class="modal" style="z-index:1001">` |
| 定位方式 | `.modal` 类（`src/styles/main.css:171`）：`position:fixed; inset:0; z-index:1000`，内联覆盖为 `z-index:1001`，内容垂直居中 |

### 3. 根因（排除法）

- ✅ **层级过高（主因）**：`1200 > 1001`，浮层悬浮在反馈弹窗**之上**。两者都是 `position:fixed` 挂在 `body` 下，**不存在容器 overflow 裁剪问题**（排除容器定位/overflow）。
- ✅ **触发后未收起（次因）**：`quickMode` 持久化在 localStorage，用户开启过快速导入后，即使当前在写反馈，浮层依然展开着（笔记区默认展开，遮挡高达 312px）。手机视口 390×844 下弹窗内容垂直居中，`#feedback-title` 输入框正好落在被遮挡区域 → 点击被浮层拦截（排除「缺少点击外部关闭」——弹窗本身有点击遮罩关闭）。
- ✅ **无 Esc 关闭**：全站仅 `src/ui/projection.ts:58` 有 Esc 处理，反馈弹窗与快速导入浮层均无。

**结论：根因 = 层级过高 + 反馈提交流程与浮层状态无联动。** 不修改 z-index（最小改动：抑制后两者互斥显示，无重叠时机；z-index 属于原有设计，不动）。

---

## 二、实施任务

### Task 1: E2E 复现测试（先证明 Bug 存在）

**Files:**
- Create: `tests/quick-import-feedback-overlap.spec.js`

**Step 1: 写复现测试**（完整代码；`assertVisiblyRendered`/`captureForReview` 来自 `tests/helpers/visibility.js`，符合 AGENTS.md 截图评估要求）

```js
const { test, expect } = require("@playwright/test");
const { captureForReview } = require("./helpers/visibility");

async function setupFeedbackWithQuickMode(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    localStorage.setItem("serverUrl", "http://127.0.0.1:3000");
    localStorage.setItem("apiToken", "e2e-token");
    localStorage.setItem("quickImportMode", "1"); // 模拟用户曾开启快速导入
  });
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, issue_number: 1, issue_url: "https://example.com/issues/1" }),
    })
  );
  await page.goto("/");
  await page.locator("#quick-import-toggle").click(); // 开启快速导入（浮层展开，笔记区默认展开）
  await page.locator("#open-feedback-btn").click();   // 打开反馈弹窗
  await expect(page.locator("#issue-feedback-modal")).toBeVisible();
}

// 几何断言：浮层是否与标题输入框相交（修复前为 true → 测试失败）
async function expectNoOverlap(page) {
  const overlap = await page.evaluate(() => {
    const bar = document.getElementById("quick-import-bar");
    const title = document.getElementById("feedback-title");
    if (!bar || getComputedStyle(bar).display === "none") return false;
    const b = bar.getBoundingClientRect(), t = title.getBoundingClientRect();
    return b.bottom > t.top && b.top < t.bottom && b.right > t.left && b.left < t.right;
  });
  expect(overlap).toBe(false);
}

test.describe("快速导入不遮挡反馈提交", () => {
  test("手机视口：打开反馈弹窗后浮层隐藏，可输入并提交", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // 手机视口（AGENTS.md 要求）
    await setupFeedbackWithQuickMode(page);
    await expect(page.locator("#quick-import-bar")).toBeHidden(); // 进入提交流程时浮层收起
    await expectNoOverlap(page);
    await page.locator("#feedback-title").click(); // 修复前：点击被浮层拦截 → 超时失败
    await page.locator("#feedback-title").fill("浮层遮挡回归测试");
    await page.locator("#feedback-description").fill("快速导入开启时反馈仍可提交");
    await page.locator("#feedback-submit-btn").click();
    await expect(page.locator("#issue-feedback-modal")).not.toBeVisible();
    await captureForReview(page, "qi-feedback-mobile-submit");
  });

  test("手机视口：关闭反馈弹窗后浮层恢复", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupFeedbackWithQuickMode(page);
    await page.locator("#issue-feedback-modal .modal-content .btn-group .secondary").click(); // 取消
    await expect(page.locator("#issue-feedback-modal")).not.toBeVisible();
    await expect(page.locator("#quick-import-bar")).toBeVisible(); // 原有功能不变
  });

  test("手机视口：Esc 关闭反馈弹窗并恢复浮层；Esc 关闭快速导入浮层", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupFeedbackWithQuickMode(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#issue-feedback-modal")).not.toBeVisible();
    await expect(page.locator("#quick-import-bar")).toBeVisible(); // 恢复
    await page.keyboard.press("Escape");
    await expect(page.locator("#quick-import-bar")).toBeHidden(); // Esc 收起快速导入浮层
    await expect(page.locator("#quick-import-toggle")).not.toHaveCSS("background-color", "rgb(124, 58, 237)"); // 退出快速导入模式
  });

  test("桌面视口：同流程可提交", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupFeedbackWithQuickMode(page);
    await expect(page.locator("#quick-import-bar")).toBeHidden();
    await expectNoOverlap(page);
    await page.locator("#feedback-title").fill("桌面端回归测试");
    await page.locator("#feedback-submit-btn").click();
    await expect(page.locator("#issue-feedback-modal")).not.toBeVisible();
  });
});
```

注意：桌面视口 1280×800 下浮层（312px）与居中弹窗的输入框**也可能相交**，该用例在修复前同样应失败。

**Step 2: 运行确认失败（复现 Bug）**

```bash
npx playwright test tests/quick-import-feedback-overlap.spec.js --reporter=list --output=test-results-qi-feedback-fix
```

预期：4 个用例中至少「可输入并提交」「Esc」两条 FAIL（浮层遮挡拦截点击 / 浮层未隐藏）。`--reporter=list` + 新 `--output` 目录是项目约定（避免触发 WorkBuddy 批量删除保护，见工作记忆）。

**不做任何修复，先进入 Task 2。**

---

### Task 2: 快速导入「抑制开关」+ 接入反馈弹窗（TDD）

**Files:**
- Test: `unit-tests/quick-import-suppress.spec.ts`（新建）
- Modify: `src/ui/quick-import.ts`
- Modify: `src/ui/issue-feedback.ts`

**Step 1: 写失败的单测**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initQuickImportMode,
  toggleQuickImportMode,
  setQuickImportSuppressed,
} from '../src/ui/quick-import';

function bar(): HTMLElement {
  return document.getElementById('quick-import-bar')!;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <div id="quick-import-bar" style="display:none">
      <div id="qi-note-area" style="display:block"></div>
      <div id="qi-hint"></div>
      <div id="qi-tags"></div>
      <div id="qi-combo-btn"></div>
      <div id="qi-layout-btn"></div>
      <button id="qi-confirm-btn"></button>
    </div>
    <button id="quick-import-toggle"></button>`;
  (window as any).Capacitor = undefined; // 非原生环境，refreshGalleryPair 安全返回
});

describe('quick-import 抑制开关（反馈提交流程联动）', () => {
  it('快速导入开启时浮层显示（原有行为）', () => {
    localStorage.setItem('quickImportMode', '1');
    initQuickImportMode();
    expect(bar().style.display).toBe('');
  });

  it('setQuickImportSuppressed(true) 隐藏浮层并清掉 body padding-top', () => {
    localStorage.setItem('quickImportMode', '1');
    initQuickImportMode();
    setQuickImportSuppressed(true);
    expect(bar().style.display).toBe('none');
    expect(document.body.style.paddingTop).toBe('');
  });

  it('setQuickImportSuppressed(false) 恢复浮层显示（原状态不丢失）', () => {
    localStorage.setItem('quickImportMode', '1');
    initQuickImportMode();
    setQuickImportSuppressed(true);
    setQuickImportSuppressed(false);
    expect(bar().style.display).toBe('');
    expect(document.body.style.paddingTop).not.toBe(''); // 笔记区展开的补偿恢复
  });

  it('quickMode 关闭时抑制开关不影响隐藏（幂等）', () => {
    initQuickImportMode(); // quickMode=false
    setQuickImportSuppressed(true);
    expect(bar().style.display).toBe('none');
    setQuickImportSuppressed(false);
    expect(bar().style.display).toBe('none');
  });
});
```

**Step 2: 运行确认失败**

```bash
npx vitest run unit-tests/quick-import-suppress.spec.ts
```

预期 FAIL：`setQuickImportSuppressed is not a function`。

**Step 3: 实现抑制开关** — `src/ui/quick-import.ts`

3a. 在模块顶部状态区（第 45 行 `let lastTagInputValue = '';` 之后）新增：

```ts
// 反馈提交流程联动：弹窗打开期间抑制浮层显示（docs/plans/2026-08-31-fix-quick-import-overlap-feedback.md）
let suppressed = false;

export function setQuickImportSuppressed(value: boolean): void {
  suppressed = value;
  render();
}
```

3b. `render()`（第 184 行）改为：

```ts
el.style.display = quickMode && !suppressed ? '' : 'none';
```

3c. `applyNoteBodyPadding()`（第 67 行）改为：

```ts
document.body.style.paddingTop = quickMode && !suppressed ? (isQuickNoteExpanded() ? '312px' : '196px') : '';
```

**Step 4: 接入反馈弹窗** — `src/ui/issue-feedback.ts`

4a. import 区新增：

```ts
import { setQuickImportSuppressed } from './quick-import';
```

（依赖方向 issue-feedback → quick-import，quick-import 不 import issue-feedback，**无循环依赖**。）

4b. `openIssueFeedbackModal`（第 67 行）函数体第一行新增：

```ts
setQuickImportSuppressed(true); // 进入提交流程：隐藏快速导入浮层
```

4c. `closeIssueFeedbackModal`（第 80 行）改为：

```ts
export function closeIssueFeedbackModal(): void {
  setQuickImportSuppressed(false); // 退出提交流程：恢复浮层（quickMode 状态不丢失）
  document.getElementById('issue-feedback-modal')!.classList.remove('active');
}
```

**Step 5: 运行单测确认通过**

```bash
npx vitest run unit-tests/quick-import-suppress.spec.ts
```

预期：4 条 PASS。

**Step 6: 回归已有单测**

```bash
npx vitest run
```

预期：全绿（含 `quick-import.spec.ts`、`quick-import-note.spec.ts`、`issue-feedback.spec.js`）。

---

### Task 3: Esc 键关闭能力（TDD）

**Files:**
- Test: `unit-tests/quick-import-suppress.spec.ts`（追加用例）
- Modify: `src/ui/quick-import.ts`（`initQuickImportMode`）
- Modify: `src/ui/issue-feedback.ts`（`initIssueFeedbackListener`）

**Step 1: 追加失败的单测**

```ts
function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('Esc 键关闭', () => {
  it('反馈弹窗打开时 Esc 关闭弹窗（并解除抑制、恢复浮层）', () => {
    localStorage.setItem('quickImportMode', '1');
    document.body.innerHTML += `
      <div id="issue-feedback-modal" class="modal active"></div>`;
    initQuickImportMode();
    setQuickImportSuppressed(true); // 模拟 openIssueFeedbackModal 的效果
    expect(bar().style.display).toBe('none');
    pressEscape();
    expect(document.getElementById('issue-feedback-modal')!.classList.contains('active')).toBe(false);
    expect(bar().style.display).toBe(''); // 抑制解除
  });

  it('浮层显示时 Esc 退出快速导入模式（关闭浮层）', () => {
    localStorage.setItem('quickImportMode', '1');
    document.body.innerHTML += `<div id="quick-combo-panel" style="display:none"></div>`;
    initQuickImportMode();
    expect(bar().style.display).toBe('');
    pressEscape();
    expect(bar().style.display).toBe('none'); // 浮层收起
    expect(localStorage.getItem('quickImportMode')).toBe('0'); // 状态一致
  });

  it('组合面板打开时 Esc 先关组合面板（不退出快速导入）', () => {
    localStorage.setItem('quickImportMode', '1');
    document.body.innerHTML += `<div id="quick-combo-panel"></div>`; // 无 display:none = 打开
    initQuickImportMode();
    pressEscape();
    expect(document.getElementById('quick-combo-panel')!.style.display).toBe('none');
    expect(bar().style.display).toBe(''); // 快速导入仍开启
  });
});
```

（`beforeEach` 已重建 DOM，追加 `document.body.innerHTML +=` 在各自用例内做。）

**Step 2: 运行确认失败**

```bash
npx vitest run unit-tests/quick-import-suppress.spec.ts
```

预期：Esc 相关 3 条 FAIL。

**Step 3: 实现**

3a. `src/ui/quick-import.ts` 的 `initQuickImportMode()`（第 605 行 `if (quickMode) void refreshGalleryPair();` 之前）追加：

```ts
  // Esc 关闭能力：反馈弹窗开着时交给反馈模块处理；否则优先关组合面板，再退出快速导入模式
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (suppressed) return;
    const feedbackModal = document.getElementById('issue-feedback-modal');
    if (feedbackModal?.classList.contains('active')) return;
    const panel = document.getElementById('quick-combo-panel');
    if (panel && panel.style.display !== 'none') {
      closeComboPanel();
      return;
    }
    if (quickMode) toggleQuickImportMode();
  });
```

3b. `src/ui/issue-feedback.ts` 的 `initIssueFeedbackListener()`（`window.addEventListener('appScreenshotTaken', ...)` 之后）追加：

```ts
  // Esc 关闭反馈弹窗（closeIssueFeedbackModal 内部会解除快速导入抑制）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('issue-feedback-modal');
    if (modal?.classList.contains('active')) closeIssueFeedbackModal();
  });
```

互斥说明：两个监听都在 `document` 上，但 quick-import 的 handler 遇到「弹窗 active」直接 return，不会双触发。

**Step 4: 运行单测确认通过**

```bash
npx vitest run unit-tests/quick-import-suppress.spec.ts
```

预期：7 条全部 PASS。

---

### Task 4: E2E 全绿 + 截图评估

**Step 1: 运行 Task 1 的 E2E**

```bash
npx playwright test tests/quick-import-feedback-overlap.spec.js --reporter=list --output=test-results-qi-feedback-fix2
```

预期：4 条 PASS。

**Step 2: 实际 Read 截图**（AGENTS.md 要求，不能只看变绿）

Read `test-results-qi-feedback-fix2/` 下 `captureForReview` 产出的截图，确认：
- 手机视口下弹窗输入框完整可见、无浮层残影；
- 关闭弹窗后浮层恢复且位置正常（body padding-top 恢复 312px，正文无异常位移）。

**Step 3: 回归相关既有 E2E**（确认未破坏原有功能）

```bash
npx playwright test tests/issue-feedback.spec.js tests/quick-import-visibility.spec.js tests/ui-health.spec.js --reporter=list --output=test-results-qi-feedback-regress
```

预期：全绿。

---

### Task 5: 构建验证 + 交付清单

**Step 1:** `npx vite build`（或项目既有 build 命令）确认无编译错误。

**Step 2:** 输出交付清单：根因说明、改动文件与行号、修复前后行为对比表、以及任何偏离本计划的说明。

**提交：不自动提交。** 按项目约定（工作记忆 2026-08-29）：功能完成后等王先生确认完整性，再由用户决定提交时机。

---

## 三、修复前后行为对比（预期结论）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| quickMode 开启 + 打开反馈弹窗 | 浮层（z-index 1200）盖在弹窗（1001）上，标题输入框被遮挡，点击/输入被拦截 | 浮层 `display:none`，弹窗完整可交互，可正常提交 |
| 关闭反馈弹窗 | 浮层保持显示（无变化） | 浮层恢复显示，quickMode 状态不丢失（原有功能不变） |
| Esc 键 | 反馈弹窗、快速导入浮层均无响应 | 弹窗开着 → 关弹窗并恢复浮层；浮层开着 → 优先关组合面板，再退出快速导入（收起浮层） |
| 入口/功能 | — | 完全不变：「⚡ 快速导入」按钮位置、导入流程、笔记区默认展开、组合面板、跨导入记忆均不动 |

## 四、约束与边界（对抗性评审）

1. **不改 z-index**：抑制后两者互斥，无重叠时机；z-index 属原有设计，最小改动原则下不动。
2. **已知边界（本次不修）**：其他 `.modal`（如备份弹窗 z-index 1000）在 quickMode 开启时同样会被浮层遮挡——这是**原有行为**，超出本次需求（反馈页），不顺手扩大改动。如需统一处理，另行立计划。
3. **浏览器端 E2E 覆盖**：非原生环境 `refreshGalleryPair` 走「当前不是原生环境」分支，浮层结构照常渲染，不影响本修复的可测性；真机（Capacitor）行为由同一 `render()` 路径保证一致。
4. **Esc 与现有 Esc 处理的冲突**：投影模式（`projection.ts`）有自己的 Esc 逻辑，且其全屏遮罩 `#projection-overlay` active 时 `showFeedbackPromptBar` 本就跳过；两者监听互不干扰（投影 Esc 只处理投影退出）。`initIssueFeedbackListener` / `initQuickImportMode` 各只调用一次（已有 `listenerInitialized` 幂等；quick-import 的监听随 init 执行一次）。
5. **不引入新依赖**：全部用原生 DOM API 与既有测试设施。
