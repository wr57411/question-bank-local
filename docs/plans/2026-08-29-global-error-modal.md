# 状态提示统一化：错误弹窗 + 操作反馈 Toast 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ① 所有错误提示改为全局弹窗（对话框，带关闭按钮），任何栏目触发都一致弹出；② 成功/信息提示改为固定定位悬浮 toast，在当前可视区域内显示、3 秒自动消失，滚动到任何位置都能立即看到。

**Architecture:** 全站所有提示已统一走 `src/ui/common.ts` 的 `showStatus(msg, type)`（`w.showStatus` + 各模块直接 import），因此在**唯一收口点**分流：`error` → 打开全局错误弹窗 `#error-modal`（手动关闭）；`success` / `info` → 顶部悬浮 toast `#toast`（固定定位、3 秒自动消失、pointer-events:none 不挡操作）。触发逻辑与文案完全不变。

**Tech Stack:** TypeScript、原生 DOM（复用 `.modal` / `.modal-content` CSS 与设计 token）、Playwright E2E（手机视口 + 截图可见性断言）。

---

## 根因（已排查确认）

`#status-message` 容器写在 `src/index.html:186`，位于题目管理 tab 的「添加题目」卡片**文档流内部**。任何栏目调用 `showStatus()` 都把文字写进这个 div：

- 用户在其他栏目 → 看不到错误（错误只在添加题目区域出现）；
- 用户已向下滚动 → 提示出现在视口外，操作反馈完全不可见；
- error 类型不会自动消失，一直挂在添加题目卡片顶部。

**收口点改造即可全站生效，无需逐个调用点修改。**

## 影响范围

- 修改：`src/ui/common.ts`（showStatus 分流 + 新增 showToast / showErrorModal / closeErrorModal）
- 修改：`src/index.html`（body 末尾追加错误弹窗 + toast 容器）
- 修改：`src/main.ts`（window 导出 closeErrorModal）
- 新增：`tests/status-feedback.spec.js`（错误弹窗 + toast 的 E2E 回归）
- 不涉及：任何业务逻辑、提示文案、服务端
- `#status-message` 容器保留在 HTML 中但不再写入（低风险；后续清理另议）

---

### Task 1: 写失败测试（TDD）

**Files:**
- Create: `tests/status-feedback.spec.js`

**Step 1: 写测试**

参考 `tests/form-tag-selection.spec.js` 结构，手机视口 390x844，用 `tests/helpers/visibility.js` 的 `assertVisiblyRendered` + `captureForReview`：

```js
const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

test.describe('状态提示统一化', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#question-form')).toBeVisible();
  });

  test('试卷管理 tab 触发错误 → 全局错误弹窗，可点按钮关闭', async ({ page }) => {
    await page.evaluate(() => window.showTab('papers'));
    await page.evaluate(() => { document.getElementById('ai-paper-requirement').value = ''; });
    await page.evaluate(() => window.startAIPaperGeneration());

    const modal = page.locator('#error-modal');
    await expect(modal).toHaveClass(/active/);
    await expect(page.locator('#error-modal-msg')).toContainText('请先输入您的组卷需求');
    await assertVisiblyRendered(page, '#error-modal .modal-content', '错误弹窗卡片');
    await assertVisiblyRendered(page, '#error-modal-close-btn', '错误弹窗关闭按钮');
    await captureForReview(page, 'error-modal-paper-tab');

    await page.click('#error-modal-close-btn');
    await expect(modal).not.toHaveClass(/active/);
  });

  test('回归：错误不再写入内嵌状态条，统一走弹窗', async ({ page }) => {
    await page.evaluate(() => window.showStatus('统一错误弹窗测试', 'error'));
    await expect(page.locator('#error-modal')).toHaveClass(/active/);
    await expect(page.locator('#status-message .status')).toHaveCount(0);
  });

  test('成功提示 toast：滚动到页面底部后触发，仍在当前视口内可见，3 秒后自动消失', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.showStatus('操作成功提示测试', 'success'));

    await assertVisiblyRendered(page, '#toast', '成功 toast');   // 内部含视口内 + 对比度检查
    await expect(page.locator('#toast')).toContainText('操作成功提示测试');
    await captureForReview(page, 'toast-scrolled-bottom');

    await page.waitForTimeout(3500);
    await expect(page.locator('#toast')).toBeHidden();
  });

  test('info 提示 toast 同样悬浮可见并自动消失', async ({ page }) => {
    await page.evaluate(() => window.showStatus('正在处理提示测试', 'info'));
    await assertVisiblyRendered(page, '#toast', '信息 toast');
    await page.waitForTimeout(3500);
    await expect(page.locator('#toast')).toBeHidden();
  });

  test('toast 容器 pointer-events:none，不遮挡页面点击', async ({ page }) => {
    await page.evaluate(() => window.showStatus('不挡点击测试', 'success'));
    const pe = await page.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents);
    expect(pe).toBe('none');
  });
});
```

**Step 2: 运行确认失败**

```bash
npx playwright test tests/status-feedback.spec.js --reporter=list --output=test-results-statusfb1
```

预期：FAIL（`#error-modal` / `#toast` 不存在）。

### Task 2: index.html 追加错误弹窗 + toast 容器

**Files:**
- Modify: `src/index.html`（body 末尾、最后一个现有 `.modal` 之后）

**Step 3: 添加 HTML**

错误弹窗放在所有现有 `.modal` 之后（DOM 靠后，同 z-index 时覆盖在上层）：

```html
<!-- 全局错误提示弹窗 -->
<div id="error-modal" class="modal">
    <div class="modal-content" style="max-width:340px;text-align:center">
        <div style="font-size:44px;line-height:1;margin-bottom:8px">⚠️</div>
        <h3 style="margin-bottom:var(--space-sm)">操作失败</h3>
        <p id="error-modal-msg" style="color:var(--text-secondary);font-size:14px;margin-bottom:var(--space-lg);word-break:break-word"></p>
        <button id="error-modal-close-btn" onclick="closeErrorModal()" style="width:100%;padding:12px;font-size:15px;background:var(--danger);color:#fff;border:none;border-radius:var(--radius-md);font-weight:700">知道了</button>
    </div>
</div>

<!-- 操作反馈 toast（成功/信息） -->
<div id="toast" style="display:none;position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:50%;transform:translateX(-50%);z-index:1200;max-width:calc(100vw - 32px);pointer-events:none">
    <div id="toast-msg" style="padding:10px 18px;border-radius:var(--radius-xl);font-size:14px;font-weight:600;box-shadow:var(--shadow-lg);text-align:center;word-break:break-word"></div>
</div>
```

要点：
- 错误弹窗按钮显式指定 `background:var(--danger);color:#fff`，规避 `main.css` 全局 `button{color:#fff}` 的白字白底对比度事故。
- toast 固定在**视口顶部居中**（含 iPhone 安全区 `env(safe-area-inset-top)`），移动端/桌面端通用；`pointer-events:none` 保证不遮挡任何按钮；z-index 1200 高于弹窗 1000，模态中产生的成功提示（如「标签创建成功」）也能看到。
- toast 样式沿用现有 token（圆角/阴影/字号），成功=绿、信息=蓝，与界面风格一致。

### Task 3: common.ts 分流 showStatus

**Files:**
- Modify: `src/ui/common.ts:1-10`

**Step 4: 实现**

```ts
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, type: 'success' | 'info'): void {
  const wrap = document.getElementById('toast');
  const box = document.getElementById('toast-msg');
  if (!wrap || !box) return;
  box.textContent = msg;
  box.style.background = type === 'success' ? 'var(--mint-light)' : 'var(--sky-light, var(--primary-light))';
  box.style.color = type === 'success' ? 'var(--mint-dark)' : 'var(--sky-dark, var(--primary))';
  wrap.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { wrap.style.display = 'none'; }, 3000);
}

export function showErrorModal(msg: string): void {
  const m = document.getElementById('error-modal');
  const t = document.getElementById('error-modal-msg');
  if (!m || !t) return;
  t.textContent = msg;
  m.classList.add('active');
}

export function closeErrorModal(): void {
  document.getElementById('error-modal')?.classList.remove('active');
}

export function showStatus(msg: string, type: 'success' | 'error' | 'info'): void {
  if (type === 'error') { showErrorModal(msg); return; }
  showToast(msg, type);
}
```

注：实现时先确认 `--sky-light` / `--sky-dark` token 是否存在（`DESIGN.md` / `main.css`），不存在则用 fallback 值。

### Task 4: main.ts 导出 closeErrorModal

**Files:**
- Modify: `src/main.ts:156` 附近（`showStatus: ui.showStatus,` 所在导出对象）

**Step 5: 添加一行**

```ts
closeErrorModal: ui.closeErrorModal,
```

### Task 5: 跑测试验证通过（含「测试能复现 bug」验证）

**Step 6:** 运行 Task 1 测试 → 预期全部 PASS。

**Step 7（强制，AGENTS.md 规则 5）:** 临时把 `common.ts` 的分流逻辑改回旧内嵌行为 → 测试必须失败 → 改回来 → 再跑通过。

### Task 6: 本地 CI/CD 循环 + 截图评估

**Step 8:** 按序执行，全绿才算完成：

```bash
npm run typecheck
npm run test
npm run build
npx playwright test tests/ui-health.spec.js tests/quick-import-visibility.spec.js tests/status-feedback.spec.js tests/form-tag-selection.spec.js --reporter=list --output=test-results-statusfb-ci
```

（附带跑 form-tag-selection，因为它依赖 showStatus 行为路径。）

**Step 9:** 实际 Read `test-results-statusfb-ci/screenshots/` 下截图，肉眼确认：错误弹窗文字/按钮清晰、toast 在滚动到底部的手机视口内可见且对比度正常，不是只看测试变绿。

### Task 7: 文档与收尾

**Step 10:** 新建 `docs/fix-status-feedback-unified.md`（问题摘要、根因、方案、影响面）。

**Step 11:** 在 `AGENTS.md`「开发文档索引 → Bug修复文档」表追加一行。

**Step 12:** git status 检查，**询问用户是否提交**（项目规则：不自动提交）。

---

## 已知边界与风险

- `sync-ui.ts` 中 `if (!silent) showStatus(..., 'error')` 的 silent 守卫保持原语义：silent 场景仍不打扰用户。
- toast 3 秒自动消失（符合 3-5 秒要求）；连续触发时重置计时器、只显示最新一条（简单可靠）。
- 错误弹窗盖在其他业务弹窗上层（DOM 靠后），点「知道了」后回到原弹窗；toast z-index 更高但不可交互、面积小，不影响操作。
- `#status-message` 不再被写入，保留 DOM 不删（如需清理另行确认）。
