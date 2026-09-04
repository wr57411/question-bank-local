# 修复 modal-anchor-overlap 固有竞态 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 消除 `tests/modal-anchor-overlap.spec.js` 长尾用例在「弹窗 top 尚未由 rAF 写入」时就断言重叠的固有竞态（探针实测失败率约 40%），使该 spec 可稳定全绿。

**Architecture:** 不改任何产品代码。只改这一个测试文件：把现有 `waitModalSynced(page)` 泛化为 `waitModalSynced(page, modalId)`（收敛条件不变——`top ≈ bar.bottom` 且 `paddingTop === '12px'`，对所有非白名单 modal 成立，已核实 `modal-anchor.ts:99-103` 统一写入这两个属性），然后在 15 处「`classList.add('active')` 后立即断言」的断言点前插入等待。收敛条件与已验证有效的 B 版探针一致。

**Tech Stack:** Playwright（`page.waitForFunction` 条件等待，带 5s 显式超时）。

**背景（上一轮已实测确认的事实，直接采信，不必重新验证）:**

1. 竞态机制：`bindModalToAnchor`（`src/ui/modal-anchor.ts:131-145`）的 `sync()` 仅在 modal 有 `active` class 时执行，由 MutationObserver 监听 class 变化触发 → **rAF 下一帧**才写 `top`。测试在 `add('active')` 后立即读 rect，就是赌 rAF 已经跑完。
2. 探针对照（2026-09-01，探针已删）：复刻长尾形态（立即断言）10 次挂 4（失败随机分布）；等收敛后断言 10 次全过。
3. 该 spec 内部早有反证：baseline 用例（:60-71）与「边界处理」「同步更新」两个 describe 的用例全部自带等待（`waitForFunction` / `waitModalSynced`），注释明写「消除首测冷启动竞态」——**挂的只有没加等待的 :79-163 长尾**。
4. `applyModalPosition`（`src/ui/modal-anchor.ts:99-103`）对所有非白名单 modal 统一写 `top = anchorRect.bottom`、`paddingTop = '12px'`——泛化收敛条件安全，无「永不收敛」风险。
5. 失败报错均为真实重叠（`overlap expected false, received true`），与本次已完成的 app.spec.js 重写无关。

**明确不修的（最小改动边界）:**

- `baseline` 用例（:60-71）：已有 `waitModalSynced(page)`，泛化后保持原调用（默认参数兼容），行为不变。
- `quick-combo-panel` 用例（:126-136）：`openComboPanel`（`src/ui/quick-import.ts:422-427`）为同步定位，无竞态。
- `crop-modal` / `projection-overlay` 白名单用例（:164-173）：断言 `top === ''`（未被写入），白名单 modal 本就不被 `applyModalPosition` 触碰，无竞态。
- 「边界处理」（:176-228）与「同步更新」（:230-）describe：自带等待，且从未挂过。

---

## Task 1: 泛化 waitModalSynced 并给 15 处断言点加等待

**Files:**
- Modify: `tests/modal-anchor-overlap.spec.js`（唯一改动文件）

**Step 1: 泛化辅助函数（:33-45）**

现实现硬编码 `question-modal`：

```js
function waitModalSynced(page) {
  return page.waitForFunction(() => {
    const m = document.getElementById('question-modal');
    ...
  });
}
```

替换为（增加 `modalId` 参数与 5s 显式超时，收敛条件逐字保留）：

```js
function waitModalSynced(page, modalId = 'question-modal') {
  return page.waitForFunction((mid) => {
    const m = document.getElementById(mid);
    const bar = document.getElementById('quick-import-bar');
    if (!m || !bar || !m.classList.contains('active')) return false;
    const cs = getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && rect.height > 0;
    if (!visible) return m.style.top === '';
    const top = parseFloat(m.style.top);
    return !isNaN(top) && Math.abs(top - rect.bottom) < 1 && m.style.paddingTop === '12px';
  }, modalId, { timeout: 5000 });
}
```

> baseline（:67）与「同步更新」describe（:235/238/245/255）的无参调用走默认值 `'question-modal'`，行为完全不变。

**Step 2: 在 15 处断言点插入等待**

统一模式：`add('active')` 之后、`noOverlap()` 之前插一行。逐处清单：

| # | 行号（约） | 用例 | 插入的调用 |
|---|---|---|---|
| 1 | :80-81 | question-modal（核心弹窗） | `await waitModalSynced(page, 'question-modal');` |
| 2 | :86-87 | basket-modal | `await waitModalSynced(page, 'basket-modal');` |
| 3 | :91-92 | export-modal | `await waitModalSynced(page, 'export-modal');` |
| 4 | :103-104 | pdf-preview-modal | `await waitModalSynced(page, 'pdf-preview-modal');` |
| 5 | :120-121 | issue-feedback-modal | `await waitModalSynced(page, 'issue-feedback-modal');` |
| 6 | :139-140 | login-modal（第一条断言前） | `await waitModalSynced(page, 'login-modal');` |
| 7 | :145-146 | backup-modal（切换后第二条断言前） | `await waitModalSynced(page, 'backup-modal');` |
| 8 | :159-160 | REMAINING 循环（8 条用例） | `await waitModalSynced(page, id);`（循环变量直接传入，一处改动覆盖 8 条） |

第 7 处注意：`login-modal` 收起与 `backup-modal` 展开在同一个 `evaluate` 里完成，backup 的 top 写入由另一次 MutationObserver → rAF 触发，所以 backup 断言前**必须**单独等待。

REMAINING 循环改后的形态：

```js
  for (const id of REMAINING) {
    test(`${id} 无重叠`, async ({ page }) => {
      await page.evaluate((mid) => document.getElementById(mid)?.classList.add('active'), id);
      await waitModalSynced(page, id);
      const { overlap } = await noOverlap(page, `#${id} .modal-content`);
      expect(overlap).toBe(false);
    });
  }
```

**Step 3: 自查**

- `grep -n "noOverlap(page" tests/modal-anchor-overlap.spec.js` 应有 11 处调用；其中 10 处前面有对应 `waitModalSynced`（baseline 的 `noOverlap` 在 `waitModalSynced` 之后，算已覆盖；「边界处理」2 处自带 waitForFunction 也算已覆盖——实施时逐处确认，凡 `add('active')` 与 `noOverlap` 之间无任何等待的必须补上）
- 文件内不新增注释（现有注释保留不动）
- 只改这一个文件

---

## Task 2: 稳定性验证

**Step 1: 该 spec 连续跑 3 次全绿**

```bash
for i in 1 2 3; do
  npx playwright test tests/modal-anchor-overlap.spec.js --reporter=list --output=tmp/test-results-anchor-fix-$i 2>&1 | tail -2
done
```

Expected: 三次均 `28 passed`（或全绿无 failed 字样）。修复前失败率约 40%/条，连续 3 次全绿基本排除侥幸（若仍有失败，回到 Task 1 检查遗漏的断言点，禁止加 `waitForTimeout` 类固定等待）。

**Step 2: 不破坏其它测试**

```bash
npx playwright test tests/app.spec.js --reporter=list --output=tmp/test-results-anchor-fix-app 2>&1 | tail -2
npx playwright test tests/ui-health.spec.js tests/quick-import-visibility.spec.js --reporter=list --output=tmp/test-results-anchor-fix-agents 2>&1 | tail -2
```

Expected: app 4 passed；标准循环 34 passed。

**Step 3: 防假绿说明（无需重复演练）**

「等待必须有、等待条件必须对」这两点已由上一轮 A/B 探针证明（A 版 10 挂 4 / B 版 10 全过）。本次改动是把 B 版形态落到生产测试文件，不新增断言逻辑，故不重复防假绿演练；但 Step 1 的连续 3 次全绿 + 修复前基线（三次运行分别挂 4/4/7 条）构成前后对照。

---

## Task 3: 更新文档状态

**Files:**
- Modify: `docs/fix-modal-anchor-flaky.md`
- Modify: `AGENTS.md`（仅「modal-anchor-overlap 固有竞态」那一行）

**Step 1:** `docs/fix-modal-anchor-flaky.md` 头部状态从「⚠️ 未实施，待用户裁决」改为「✅ 已修复（2026-09-01）」，并在文末追加「实施记录」小节：改动内容（泛化 + 15 处等待）、验证结果（3 次全绿 + app/标准循环不受影响）。

**Step 2:** `AGENTS.md` 该行问题摘要更新为「长尾用例 rAF 收敛前断言重叠致随机失败（失败率约 40%）；已泛化 waitModalSynced 并补齐 15 处等待，3 次全绿验证」，其余列不动。

---

## 对抗性自评（什么情况下这个方案不成立）

| 假设 | 失效条件 | 兜底 |
|---|---|---|
| 收敛条件 `top ≈ bar.bottom < 1` 对所有 modal 可达 | 某个长尾 modal 不在 `initAnchoredModals` 绑定范围（例如 JS 动态创建、未走 `.modal` 选择器），top 永不写入 → waitForFunction 5s 超时 | 超时会以明确报错暴露（好于现在的静默随机红）；届时把该 modal 加入白名单用例或单独处理 |
| 5s 超时足够 | CI 慢机上 rAF + observer 链路超过 5s | rAF 正常为 16ms 量级，5s 已是 300 倍余量；真超时说明产品代码有更深问题，应当红 |
| 挂的只有 :79-163 | 未来有人新增「add active → 立即断言」的用例 | Task 1 Step 3 的 grep 自查给出规则；长期方案是把「打开弹窗」封装成带等待的辅助函数（本次不做，YAGNI） |
| 与待办事项冲突 | 用户尚未提交 app.spec.js 重写，工作树叠加改动会让 diff 变大 | 本计划只新增一个文件的改动，与既有改动无交集；提交仍由用户统一决定 |
| 探针结论失真 | B 版 10/10 是小样本侥幸 | 失败率若真是 0%（而非 40%），加等待也无害——等待条件满足即刻返回，不引入固定延迟 |

## 边界与约束

- 不改产品代码（`src/` 零改动）
- 无 commit 步骤——全部改动留工作树，提交时机由王先生决定
- 测试产物一律进 `tmp/`（硬规则）
- `quick-combo-panel` / 白名单用例 / 「边界处理」「同步更新」describe 不碰
