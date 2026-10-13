# PDF 页面设置可配置（边距 + 标题）

> 创建于 2026-09-09。基于 `docs/plans/2026-09-09-pdf-page-setup.md` 实施完成后的落地说明。

## 问题

PDF 导出弹窗只能选打印字号，**页边距和标题区都是硬编码**：
- 上/下/左右页边距：默认 10mm，写死
- 标题区两行字 + 保险空隙：10.5pt 下 `topReserve = 33.76mm`，纸顶到首题 ≈ **49.76mm**（纸顶起算）
- 标题/副标题显隐：无法关闭

用户场景：学校要求标题只显示一行、或不要"共 N 题"副标题、或边距更宽以批改，都改不动。

## 方案

三层改动：

1. **引擎层**（`src/data/pdf-layout-engine.ts`）—— `planLayout` 增加独立边距 `marginTopMM/marginBottomMM/marginSideMM`，向后兼容旧的 `marginMM`；双栏右栏 x 改成显式依赖 SIDE 的形式 `AW - SIDE - uwd`（与旧 `AW/2 + CGAP/2` 在数学上等价，但代码更直白）。
2. **数据层**（`src/data/pdf-page-setup.ts` + `src/data/pdf-print-size.ts`）—— 新建 `pdf-page-setup.ts` 管理默认值/clamp/localStorage 持久化（key=`pdfPageSetup`，JSON 五字段）；`deriveTopReserveMM` 重写为 `max(0, titleBlockBottom - marginBottom)`，消除 10mm slack 与 pad 双算。
3. **UI 层**（`src/index.html` + `src/ui/export-pdf-ui.ts`）—— 导出弹窗加 `<details id="page-setup-details">` 折叠区，默认收起；3 个 number input（0–30mm，默认 10）+ 2 个 checkbox（默认勾选，showCount 在 showTitle 取消勾选时 disabled）；空串守卫在 blur 时回退到已存值（避免 `Number('') === 0` 污染）；`savePageSetup` 在每次 `onchange` 落盘。

效果：默认下首格顶从 49.76mm → **28.76mm**（省 21mm ≈ 7.6% 页高）。

## 变更文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/data/pdf-page-setup.ts` | 新增 | 默认值/clamp/loadPageSetup/savePageSetup；localStorage key `pdfPageSetup` |
| `src/data/pdf-layout-engine.ts` | 修改 | `planLayout` 接受 `marginTopMM/marginBottomMM/marginSideMM`；双栏右栏 x 改 `AW - SIDE - uwd` |
| `src/data/pdf-print-size.ts` | 修改 | 新增 `deriveTopReserveMM(setup, metrics)` 紧凑公式；移除 `metrics.topReserveMM` 字段 |
| `src/types/pdf.ts` | 修改 | 新增 `PageSetup` 类型；移除 `topReserveMM` 字段 |
| `src/types/index.ts` | 修改 | 导出 `PageSetup` |
| `src/data/pdf.ts` | 修改 | `generatePDF` 读 `loadPageSetup()`；标题/副标题基线挂 `marginTopMM`；`topReserveMM` 改走 `deriveTopReserveMM`；页码 y 改 `H − max(4, marginBottom − 3)` |
| `src/index.html` | 修改 | 导出弹窗加 `<details id="page-setup-details">` 折叠区 |
| `src/ui/export-pdf-ui.ts` | 修改 | `renderPageSetupInputs` 渲染；`onPageSetupInputChanged` 处理空串守卫、showCount 联动、`ps-margin-side` 触发 `refreshPrintSizeHint`（side 影响单栏栏宽估算） |
| `src/data/pdf-image.ts` | 可能 | 已有 `analyzeImage` 返回 w/tH，配合 `singleColumnWidthMM(sideMM)` 估算实测字高 |
| `unit-tests/pdf-print-size.spec.js` | 修改 | 锁死默认 12.76 / 关副标题 5.81 / marginTop=30 时 32.76 |
| `unit-tests/pdf-layout-engine.spec.js` | 修改 | 新增 side=15 用例：单栏 x=15、宽 63；双栏右 x=107、栏缝 4 |
| `tests/pdf-page-setup.spec.js` | 新增 | E2E：折叠可见性（桌面）、持久化+空串守卫+重开恢复、手机视口 390×844 |

## 验证结果

### 单元测试（`NODE_OPTIONS= npm run test`）

```
Test Files  20 passed | 1 skipped (21)
     Tests  334 passed | 9 skipped (343)
  Duration  3.30s
```

### TypeScript / Build

```
✓ tsc --noEmit
✓ vite build → dist/assets/index-BAiO1JyU.js 280.46 kB
```

### E2E 新增用例（`pdf-page-setup.spec.js`）

| 用例 | 结果 |
|---|---|
| 用例1 折叠区可见性（桌面）| ✓ 1.2s |
| 用例2 持久化 + 空串守卫 + 标题勾选联动 + 重开恢复 | ✓ 1.1s |
| 用例3 手机视口 390×844 展开且后续控件可达 | ✓ 1.1s |

截图复核：`tmp/test-results-page-setup/screenshots/page_setup_expanded.png` 与 `page_setup_mobile.png` 均显示 3 个 number input（上/下/左右 10mm）+ 2 个 checkbox（均勾选），文字/背景对比清晰，无白字白底/被遮挡/被截断。

### 复现性演练（3 场）

| 场 | 注入 | 目标测试 | 结果 |
|---|---|---|---|
| a | 双栏右栏 `AW - SIDE - uwd` → `AW/2 + CGAP/2` | side=15 单测 | **未失败**（代数恒等，diff=0）|
| b | `deriveTopReserveMM` 返回 `+ 10` | pdf-print-size 12.76 | 失败（22.76 vs 12.76）|
| c | 注释 `savePageSetup(next)` | 用例2 持久化断言 | 失败（localStorage 仍 null）|

**演练 a 补充说明**：因为 `uwd = (uws - CGAP)/2` 且 `uws = AW - 2*SIDE`，代数上 `AW - SIDE - uwd ≡ AW/2 + CGAP/2`（所有 SIDE 值 diff=0），右栏 x 不随 SIDE 变化——这是"side 改的是左栏 x 与栏宽，不是右栏位置"。用替代注入 `uws = AW - 2 * DEFAULT_MARGIN_MM`（uws 不依赖 SIDE）验证 side=15 单测**确有判别力**：单栏宽 66.5 ≠ 63，挂。三个演练 b/c + 补充验证还原后均恢复绿。

### 已知限制

1. **左右合并为一个输入**：UI 只暴露一个"左右" input，写入 `marginSideMM`，引擎推导 `uws = AW - 2*SIDE`。理由：99% 场景对称；左/右独立需要再加两个 input，复杂度/收益不划算。后续若需要非对称页眉/装订线，再拆。
2. **`Number('')` 坑在 UI 层拦截**：HTML number input `min=0 max=30` 仍允许用户清空（变为 `''`），`Number('')` 是 0。`onPageSetupInputChanged` 在 UI 层用 `=== ''` 守卫并恢复已存值，**不依赖** `clampPageSetup` 兜底（clamp 会把 `''` 视为 0 然后落盘——这是设计上的取舍，UI 体验优先）。
3. **legacy double 模式不支持页面设置**：`mode==='double'`（`generateLegacyDouble`，UI 已无入口）不读 PageSetup，标题/边距仍是旧硬编码（M=15）。注意 **separate 模式不受此限**：其 qPlan 用 `deriveTopReserveMM`、aPlan（答案段）用 `deriveHeaderReserveMM`，且三个边距都传给了 `planLayout`——试卷导出（merged）与题目/答案分开导出均尊重页面设置。

## 复现 / 回退

- 关闭折叠区：用户点 summary；状态不入 localStorage。
- 清空持久化：浏览器 DevTools → Application → Local Storage → 删 `pdfPageSetup` key。
- 引擎回退旧公式：`src/data/pdf-print-size.ts:89` 的 `deriveTopReserveMM` 返回值改成 `Math.max(0, blockBottom - marginBottom) + 10`，会立即被单测 12.76 断言捕获。