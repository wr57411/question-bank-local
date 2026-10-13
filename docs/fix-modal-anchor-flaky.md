# modal-anchor-overlap.spec.js 固有竞态（rAF 收敛前断言重叠）

- **日期**: 2026-09-01
- **关联模块**: E2E（tests/modal-anchor-overlap.spec.js）、弹窗锚点定位（applyModalPosition）
- **状态**: ✅ **已修复并验证（2026-09-01）**——修复见文末「实施记录」，验证为该 spec 连续 3 次 27/27 全绿
- **计划**: docs/plans/2026-09-01-fix-modal-anchor-flaky.md

## 问题现象

全量跑 E2E 时 `modal-anchor-overlap.spec.js` 随机挂 4-7 条，且**失败集合每次漂移**（不是固定某几条）。三个特征全部吻合固有竞态：

- 单跑必过
- 串行全量随机挂
- 失败集合漂移

失败报错是**真实的重叠断言失败**（`overlap expected false, received true`），不是超时或环境错误。

## 排查过程与根因证据链

1. **代码层证据**：长尾用例（tests/modal-anchor-overlap.spec.js 全文件 20 条用例中，除 baseline :60-71 外的其余 19 条，主要分布在 :79-163）在 `classList.add('active')` 后**立即**断言 `noOverlap`。但 `applyModalPosition` 写入的 `top` 是 **requestAnimationFrame 异步调度**的——rAF 慢一步时，`.modal-content` 还停在 CSS 默认位置，就会压住 312px 高的快速导入栏。
2. **测试自身的反例**：baseline 用例（:60-71）加了 `waitModalSynced(page)` 防御，注释明写「先等收敛再断言（消除首测冷启动竞态）」，但长尾用例全部没加。
3. **探针实锤**（tests/_probe-flaky-tmp.spec.js，验证后已删除）：
   - A 版（复刻长尾形态：add active 后立即断言）：跑 10 次**挂 4 次**，失败随机分布 → 失败率约 40%
   - B 版（等收敛后再断言）：跑 10 次**全部通过**
4. **与本次改动无关的确认**：本次只改了 playwright.config.js 的 `testIgnore` 与 tests/app.spec.js，未碰 modal-anchor 相关任何代码；08-31 全量跑全过是侥幸（竞态未触发而已）。

## 根因结论

长尾用例在 `applyModalPosition` 的 rAF 异步写入收敛前就断言了 `noOverlap`，属于**用例自身的时序缺陷**，不是产品代码 bug。产品行为本身正确（等 rAF 执行完，位置就对）。

## 修复方案（已实施）

把 `waitModalSynced` 泛化（原先硬编码 `question-modal` 的 id），在长尾用例的 `add active` 之后、断言之前统一等待收敛。

### 关键代码草案

现定义（tests/modal-anchor-overlap.spec.js:33-45）硬编码 `question-modal`：

```js
function waitModalSynced(page) {
  return page.waitForFunction(() => {
    const m = document.getElementById('question-modal');   // ← 硬编码
    ...
  });
}
```

泛化为接收 modal id：

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
  }, modalId);
}
```

长尾用例统一改为：

```js
test(`${id} 无重叠`, async ({ page }) => {
  await page.evaluate((mid) => document.getElementById(mid)?.classList.add('active'), id);
  await waitModalSynced(page, id);        // ← 新增：等 rAF 收敛再断言
  const { overlap } = await noOverlap(page, `#${id} .modal-content`);
  expect(overlap).toBe(false);
});
```

同理覆盖「锚点定位迁移」各 describe 下的具名用例（question-modal / basket-modal / export-modal / pdf-preview-modal / issue-feedback-modal / login-modal / backup-modal 等）以及 :235-348 已有调用（改为传对应 id）。`quick-combo-panel` 特例不走 modal top 逻辑，按其自身 top 公式断言，不需此等待。

## 影响面

- 只改 tests/modal-anchor-overlap.spec.js 一个文件，产品代码零改动
- AGENTS.md 规定的标准 E2E 循环（ui-health + quick-import-visibility）不受影响，34/34 全绿

## 实施记录（2026-09-01）

改动只落在 `tests/modal-anchor-overlap.spec.js` 一个文件，产品代码 `src/` 零改动，未 commit。

**1. 泛化 `waitModalSynced`（:33-45）**

收敛条件逐字保留（active 检查 + bar 可见性三条件 + `Math.abs(top - rect.bottom) < 1` + `paddingTop === '12px'`，bar 不可见时回落为 `top === ''`），仅参数化 modalId 并加 `{ timeout: 5000 }`——真超时会以明确报错暴露，优于原先的静默随机红。

**2. 8 处插入点（覆盖 15 个断言点）**

| 位置（改后） | 覆盖 |
|---|---|
| :81 question-modal、:88 basket-modal、:94 export-modal、:107 pdf-preview-modal、:125 issue-feedback-modal | 5 条具名用例 |
| :145 login-modal、:152 backup-modal | 同一用例内两次切换，backup 在切换后**单独等待**（其 top 由另一次 observer→rAF 触发） |
| :167 REMAINING 循环 `waitModalSynced(page, id)` | 一处覆盖 8 条 |

**3. 明确未动（最小改动边界）**

- baseline（:60-71）、「边界处理」「同步更新」describe：原本自带等待
- `quick-combo-panel`：`openComboPanel`（`src/ui/quick-import.ts:422-427`）同步定位，无竞态
- crop-modal / projection-overlay 白名单：断言 `top === ''`（未被写入），本就不被 `applyModalPosition` 触碰
- :403 a11y 用例（`add('active')` 后有 `toBeVisible` + 3 次 evaluate 往返才到 `noOverlap`）：不在清单内且历史上未挂，保持不动

**4. 验证**

| 项 | 修复前 | 修复后 |
|---|---|---|
| 该 spec 连续 3 次 | 分别挂 4 / 4 / 7 条，集合漂移 | **27 passed × 3 全绿** |
| tests/app.spec.js | 4 passed | 4 passed（未受影响） |
| 标准循环（ui-health + quick-import-visibility） | 34 passed | 34 passed（未受影响） |

修复前单次失败率约 40%（探针 10 挂 4），连续 3 次全绿（0.6^3 侥幸概率已可忽略）足以排除偶然。

## 遗留风险

1. **:403 a11y 用例**是全文件仅剩的「`noOverlap` 前无 `waitModalSynced`」处，靠 `toBeVisible` + 多次 evaluate 往返兜底。历史未挂，但若未来出现长尾抖动，补一行 `await waitModalSynced(page, 'question-modal');` 即可。
2. **新增用例需遵守同一规则**：今后凡「打开弹窗 → 断言位置」的用例，必须在断言前条件等待（禁止 `waitForTimeout` 这类固定等待）。更彻底的做法是把「打开弹窗」封装成自带等待的辅助函数，本次未做（YAGNI）。
