# PDF 打印字号可配置 + 双栏版面修复 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让题干打印字号成为 App 内可配置的单一参数，并修掉双栏版面把 23% 纸张浪费在内边距上的问题。

**Architecture:** 两处正交修改。(1) 几何：双栏栏宽不再减 `CPAD`，栏缝回到真正的 `CGAP`。(2) 字号：排版引擎用「绝对目标」`rw = clamp(w × stemMM / tH, 0.35×栏宽, 栏宽)` 替换现有的「集合中位数」归一化，所有文字元素（题号/答案/标题/页码）由 `stemMM` 按固定比例推导。UI 层导出弹窗加 pt 挡位 + localStorage 持久化 + 实测回显。

**Tech Stack:** TypeScript、Vite、vitest（jsdom）、Playwright、jsPDF（mm 单位）

**提交约定：** 王先生规则——AI 不自动 commit/push，全部改完后由他检查统一提交。计划中每个 Task 末尾的"验证"不等于提交。

---

## 背景：为什么这么做（实测，非推测）

### 1. `targetTextMM` 是死参数

`tmp/probe/probe.mts` 实测：同批图取 `targetTextMM` = 2 / 4 / 8，所有 cell 的 `[w,h]` **完全相同**。
原因（`pdf-layout-engine.ts:23-32`）：`raw_i = tgt/((tH_i/w_i)*uw)`，`baseline = median(raw_i)`，
`norm_i = raw_i/baseline` —— `tgt` 分子分母同时出现，被约掉。

### 2. 双栏横向预算：48mm（23% 纸张）是空白

```
uwd = (uws - CGAP)/2 - 2*CPAD = (190-4)/2 - 12 = 81
x_L = MG + CPAD                  = 16
x_R = AW/2 + CGAP/2 + CPAD       = 113

外16 + 81 + 缝16 + 81 + 外16 = 210
内容 162mm（77%）   空白 48mm（23%）
```

**栏缝实际 16mm，不是 `CGAP` 声明的 4mm** —— 缝两侧各加了 `CPAD`。
`CPAD` 是垂直内边距语义（纵向 `need = rh + lh + pad*2`），却在横向被减了两次、缝边又加两次。

### 3. 1080 宽截图在两种模式下的实测输出

| | rw | 占页宽 | 纸面字高 |
|---|---|---|---|
| 单栏 | 190mm | 90% | 22.4pt（过大） |
| 双栏 | 81mm | 39% | **9.6pt（过小）** |

**没有中间档** —— 这就是"字太小"和"没占满版面"是同一个病的两面。

### 4. 机制 B（横向去白边）已撤销

王先生确认题目来源为**搜题 App 截图，无白边**，去白边前提不成立。

---

## 现状代码锚点

| 位置 | 内容 |
|---|---|
| `src/data/pdf-layout-engine.ts:3` | `const AW = 210, AH = 297, CGAP = 4, CPAD = 6, MIN_SPLIT = 25;` |
| `src/data/pdf-layout-engine.ts:14-15` | `uws = AW - 2*MG`；`uwd = (uws - CGAP)/2 - 2*CPAD` |
| `src/data/pdf-layout-engine.ts:23-32` | 中位数归一化（**要替换**） |
| `src/data/pdf-layout-engine.ts:138,163,169` | 双栏 x 坐标 `MG + CPAD` / `AW/2 + CGAP/2 + CPAD` |
| `src/data/pdf.ts:36` | `const W = 210, H = 297, M = 15, MAXW = W - M*2;` |
| `src/data/pdf.ts:91` | `const lm = (lmMap && lmMap[q.id]) \|\| (q.layout_type === 1 ? 'double' : 'single');` |
| `src/data/pdf.ts:96,108` | `labelH: 5` / `labelH: 4` 硬编码 |
| `src/data/pdf.ts:138` | `drawLabel(..., cell.label === '答案:' ? 9 : 11)` |
| `src/data/pdf.ts:129-133` | 页码 `setFontSize(8)` |
| `src/data/pdf.ts:167-168` | 标题 18pt @ `M+5`；副标题 11pt @ `M+13` |
| `src/data/pdf.ts:172,197-198` | `topReserveMM: opts.title ? 35 : 0` |
| `src/data/pdf.ts:207` | `参考答案` 页眉 16pt |

---

## Task 1：双栏栏宽修复（几何）

**Files:**
- Modify: `src/data/pdf-layout-engine.ts:14-15, 138, 163, 169`
- Test: `unit-tests/pdf-layout-engine.spec.js`（新增）、`unit-tests/pdf-generate.spec.js:100,114`（改断言）

**Step 1: 写失败测试**

`unit-tests/pdf-layout-engine.spec.js` 末尾追加：

```js
describe('双栏栏宽不含 CPAD', () => {
  it('双栏左右列 x 分别为 MG 与 AW/2+CGAP/2，栏缝恰为 CGAP', () => {
    const r = planLayout([mk('d1', 1000, 400, 100, 'double'), mk('d2', 1000, 400, 100, 'double')])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const xs = [...new Set(cells.map(c => c.x))].sort((a, b) => a - b)
    expect(xs[0]).toBe(10)
    expect(xs[1]).toBe(107)
    expect(xs[1] - (xs[0] + cells[0].w)).toBeCloseTo(4, 5)
    expect(cells[0].w).toBeCloseTo(93, 5)
  })
})
```

**Step 2: 运行确认失败**

```bash
NODE_OPTIONS= npx vitest run unit-tests/pdf-layout-engine.spec.js -t '双栏左右列'
```
预期 FAIL：`xs[0]` 实际 16，`w` 实际 81。

**Step 3: 实现**

`pdf-layout-engine.ts`：

```ts
const uwd = (uws - CGAP) / 2;
```

三处 x 坐标：`MG + CPAD` → `MG`；`AW / 2 + CGAP / 2 + CPAD` → `AW / 2 + CGAP / 2`。

**Step 4: 运行确认通过**

```bash
NODE_OPTIONS= npx vitest run unit-tests/pdf-layout-engine.spec.js
```

**Step 5: 修 `pdf-generate.spec.js` 的两处断言**

`unit-tests/pdf-generate.spec.js:100` 与 `:114` 的 `expect(d1[2]).toBe(16)` /
`expect(imgs.find(c => c[1].endsWith('Qd'))[2]).toBe(16)` 改为 `toBe(10)`。
（`d1` 双栏 x 由 16 变 10。这是本 Task 的**预期**行为变更，不是误改。）

---

## Task 2：`pdf-print-size` 纯函数模块

**Files:**
- Modify: `src/data/pdf-print-size.ts`（已建，需按本 Task 校正）
- Modify: `src/types/pdf.ts`（已加类型，需校正 `PrintMetrics`）
- Test: `unit-tests/pdf-print-size.spec.js`（新建）

**Step 1: 写失败测试**

```js
import { describe, it, expect } from 'vitest'
import { ptToMM, mmToPt, clampStemPt, parseStemPt, derivePrintMetrics, DEFAULT_STEM_PT, STEM_PT_PRESETS } from '../src/data/pdf-print-size'

describe('pt 与 mm 换算', () => {
  it('12pt ≈ 4.234mm', () => expect(ptToMM(12)).toBeCloseTo(4.2336, 4))
  it('往返一致', () => expect(mmToPt(ptToMM(14))).toBeCloseTo(14, 6))
})

describe('挡位表', () => {
  it('默认档为四号 14pt', () => expect(DEFAULT_STEM_PT).toBe(14))
  it('挡位按 pt 升序且含 5 档', () => {
    expect(STEM_PT_PRESETS.map(p => p.pt)).toEqual([9, 10.5, 12, 14, 16])
  })
  it('越界钳到表内', () => {
    expect(clampStemPt(99)).toBe(16)
    expect(clampStemPt(1)).toBe(9)
    expect(parseStemPt('garbage')).toBe(14)
  })
})

describe('derivePrintMetrics 在默认档 14pt', () => {
  const m = derivePrintMetrics(ptToMM(14))
  it('题干基准 = 输入 stemMM', () => expect(m.stemMM).toBeCloseTo(4.9392, 4))
  it('题号 0.97 倍、答案标签 0.79 倍', () => {
    expect(m.numLabelPt).toBeCloseTo(14 * 0.97, 4)
    expect(m.ansLabelPt).toBeCloseTo(14 * 0.79, 4)
  })
  it('标题 1.59 倍、页码 0.71 倍', () => {
    expect(m.titlePt).toBeCloseTo(14 * 1.59, 4)
    expect(m.pageNumPt).toBeCloseTo(14 * 0.71, 4)
  })
  it('labelH 随字号线性放大且不小于字形高', () => {
    expect(m.numLabelH).toBeGreaterThan(ptToMM(m.numLabelPt))
    expect(m.numLabelH / ptToMM(m.numLabelPt)).toBeCloseTo(1.28, 2)
  })
  it('topReserveMM 在 14pt 下约 38mm', () => expect(m.topReserveMM).toBeGreaterThan(34))
})

describe('derivePrintMetrics 单调性', () => {
  it('stemMM 变大 → 所有字号与预留高单调不减', () => {
    const a = derivePrintMetrics(ptToMM(9))
    const b = derivePrintMetrics(ptToMM(16))
    for (const k of ['numLabelPt', 'ansLabelPt', 'titlePt', 'pageNumPt', 'numLabelH', 'ansLabelH', 'minSplitMM', 'topReserveMM']) {
      expect(b[k]).toBeGreaterThan(a[k])
    }
  })
})
```

**Step 2: 运行确认失败**（模块字段缺失）

**Step 3: 实现**

`src/data/pdf-print-size.ts` 关键常量与公式（保留已有骨架，按此校正）：

```ts
export const PT_TO_MM = 0.3528;
export const STEM_PT_PRESETS = [
  { pt: 9, label: '小五' }, { pt: 10.5, label: '五号' }, { pt: 12, label: '小四' },
  { pt: 14, label: '四号' }, { pt: 16, label: '三号' },
];
export const DEFAULT_STEM_PT = 14;
export const DEFAULT_STEM_MM = ptToMM(DEFAULT_STEM_PT);

const RATIO = { numLabel: 0.97, ansLabel: 0.79, title: 1.59, subTitle: 0.97, answerHeader: 1.41, pageNum: 0.71 };
const LABEL_H_FACTOR = 1.28;
const MIN_SPLIT_FACTOR = 6.25;
const TITLE_TOP_FACTOR = 1.25;
const TITLE_GAP_FACTOR = 2.0;
const BASELINE_DESCENT = 0.2;
const PDF_MARGIN_MM = 15;      // pdf.ts 的 M
const ENGINE_MARGIN_MM = 10;   // 引擎的 MG 默认
const CELL_PAD_MM = 6;         // 纵向内边距，恒定，不随字号
const TITLE_SLACK_MM = 10;     // 保现状观感

export function derivePrintMetrics(stemMM: number): PrintMetrics {
  const numLabelMM = stemMM * RATIO.numLabel;
  const ansLabelMM = stemMM * RATIO.ansLabel;
  const subTitleMM = stemMM * RATIO.subTitle;
  const titleTopMM = stemMM * TITLE_TOP_FACTOR;
  const subTitleYOffset = stemMM * TITLE_GAP_FACTOR;
  return {
    stemMM,
    numLabelPt: mmToPt(numLabelMM),
    ansLabelPt: mmToPt(ansLabelMM),
    titlePt: mmToPt(stemMM * RATIO.title),
    subTitlePt: mmToPt(subTitleMM),
    answerHeaderPt: mmToPt(stemMM * RATIO.answerHeader),
    pageNumPt: mmToPt(stemMM * RATIO.pageNum),
    numLabelH: numLabelMM * LABEL_H_FACTOR,
    ansLabelH: ansLabelMM * LABEL_H_FACTOR,
    cellPadMM: CELL_PAD_MM,
    minSplitMM: stemMM * MIN_SPLIT_FACTOR,
    titleTopMM,
    subTitleYOffset,
    topReserveMM:
      PDF_MARGIN_MM + titleTopMM + subTitleYOffset + subTitleMM * BASELINE_DESCENT
      - ENGINE_MARGIN_MM + CELL_PAD_MM + TITLE_SLACK_MM,
  };
}
```

`topReserveMM` 在 `stemMM = 4` 时代入得 `15+5+8+0.776-10+6+10 = 34.78 ≈ 现状 35`，
保证该公式在旧基准点与现状吻合。

`src/types/pdf.ts` 的 `PrintMetrics` 保留现有字段（`cellPadMM` 恒为 6）。

**Step 4: 运行确认通过**

---

## Task 3：引擎换绝对目标 + 尺寸感知栏位

**Files:**
- Modify: `src/data/pdf-layout-engine.ts:12-42`
- Test: `unit-tests/pdf-layout-engine.spec.js`（改 1 条 + 新增）

**Step 1: 写失败测试**

```js
describe('绝对目标归一化', () => {
  it('stemMM 变大 → rw 变大，直到撞上栏宽天花板', () => {
    const mk1 = () => [mk('a', 1000, 400, 40)]
    const w4 = planLayout(mk1(), { stemMM: 4 }).pages[0].L[0].w
    const w8 = planLayout(mk1(), { stemMM: 8 }).pages[0].L[0].w
    const w40 = planLayout(mk1(), { stemMM: 40 }).pages[0].L[0].w
    expect(w8).toBeGreaterThan(w4)
    expect(w40).toBeCloseTo(190, 5)
  })

  it('下限 0.35×栏宽 防止 tH 估错把图缩成蚂蚁', () => {
    const r = planLayout([mk('a', 1000, 400, 100000)], { stemMM: 4 })
    expect(r.pages[0].L[0].w).toBeCloseTo(190 * 0.35, 5)
  })

  it('双栏下达不到 0.75×目标 的题被强制单栏', () => {
    const sparse = planLayout([mk('d', 1000, 400, 20, 'double')], { stemMM: 4 })
    expect(sparse.pages[0].L[0].w).toBeCloseTo(190, 5)
    const dense = planLayout([mk('d', 1000, 400, 100, 'double')], { stemMM: 4 })
    expect(dense.pages[0].L[0].w).toBeCloseTo(93, 5)
  })
})
```

**Step 2: 运行确认失败**

**Step 3: 实现**

替换 `planLayout` 头部归一化：

```ts
const stem = opts.stemMM ?? DEFAULT_STEM_MM;
const MIN_SPLIT = opts.minSplitMM ?? 25;

const valid = images.filter(im => im.tH > 0 && im.w > 0 && im.h > 0);
if (!valid.length) return { pages: [], nSplit: 0, truncated: false };

// 尺寸感知栏位：双栏下纸面字高不足 0.75×目标 的题强制单栏
const effLm = new Map<string, 'single' | 'double'>();
for (const im of valid) {
  const naturalInDouble = (im.tH / im.w) * uwd;
  effLm.set(im.key, im.lm === 'double' && naturalInDouble >= stem * DOUBLE_MIN_RATIO ? 'double' : 'single');
}

const norm = new Map<string, number>();
for (const im of valid) {
  const uw = effLm.get(im.key) === 'double' ? uwd : uws;
  const want = (im.w * stem) / im.tH;
  norm.set(im.key, Math.min(1, Math.max(0.35, want / uw)));
}
```

队列构建处 `if (im.lm === want && ...)` 改为 `if ((effLm.get(im.key) ?? 'single') === want && ...)`，
`queue.push({ ..., lm: effLm.get(im.key) ?? 'single' })`。

文件顶部加：`import { DEFAULT_STEM_MM } from './pdf-print-size';`
以及 `const DOUBLE_MIN_RATIO = 0.75;`

**Step 4: 运行**

现有 `:53` 那条 `normScale 按 baseline 中位数缩放并 clamp 到 [0.35,1]`
（`mk('big',1000,400,10)` 与 `mk('small',1000,400,100)`，比值断言 0.35）：
新公式下 `big` 撞天花板 190，`small` 撞下限 66.5，比值仍为 **0.35**，该条**应当继续通过**。
若未通过，先核对再改测试，禁止直接改数字掩盖。

`:18` 那条 `单栏组在前、双栏组在后` 会因强制单栏而失败（4 张全变单栏）→
改写为断言"稀疏题即使标了 double 也进单栏组"，并另用 `tH: 100` 的密集图补一条双栏组用例。

---

## Task 4：`pdf.ts` 用 metrics 替换全部硬编码字号

**Files:**
- Modify: `src/data/pdf.ts:48-58, 91-116, 118-208, 283-310`
- Test: `unit-tests/pdf-generate.spec.js`（改 + 新增）

**Step 1: 改 FakeDoc 记录字号**（`unit-tests/pdf-generate.spec.js:14`）

```js
setFontSize(s) { this.calls.push(['setFontSize', s]) } setTextColor() {} setFont() {}
```

追加测试：

```js
it('stemMM 变大 → 题号/答案/页码字号同步变大', async () => {
  const small = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 3 })
  const big = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 6 })
  const sizes = d => d.calls.filter(c => c[0] === 'setFontSize').map(c => c[1])
  expect(Math.max(...sizes(big))).toBeGreaterThan(Math.max(...sizes(small)))
})

it('stemMM 变大 → 标签预留高 labelH 同步变大', async () => {
  const a = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 3 })
  const b = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 6 })
  const lh = d => d.calls.filter(c => c[0] === 'addImage').map(c => c[4])
  expect(Math.max(...lh(b))).toBeGreaterThan(Math.max(...lh(a)))
})
```

**Step 2: 运行确认失败**

**Step 3: 实现**

- `generatePDF` 开头：`const metrics = derivePrintMetrics(options.stemMM ?? loadStemPtAsMM());`
- `buildEngineUnits` 增 `metrics` 参数，`labelH` 用 `metrics.numLabelH` / `metrics.ansLabelH`
- `renderEnginePages` 增 `metrics` 参数：`drawLabel(..., metrics.ansLabelPt / numLabelPt)`；页码 `setFontSize(metrics.pageNumPt)`
- `generateWithEngine*` 增 `metrics`：标题 `drawCentered(..., M + metrics.titleTopMM, metrics.titlePt)`；
  副标题 `drawCentered(..., M + metrics.titleTopMM + metrics.subTitleYOffset, metrics.subTitlePt)`
- `参考答案` 页眉用 `metrics.answerHeaderPt`
- `topReserveMM` 改用 `metrics.topReserveMM`
- 传给 `planLayout`：`{ stemMM: metrics.stemMM, minSplitMM: metrics.minSplitMM, topReserveMM }`

**Step 4: 运行**

```bash
NODE_OPTIONS= npx vitest run unit-tests/pdf-generate.spec.js
```

---

## Task 5：导出弹窗 pt 挡位 + 持久化

**Files:**
- Modify: `src/index.html:492-499`（题后留空之后插入）
- Modify: `src/ui/export-pdf-ui.ts`（新增 3 个导出函数）
- Modify: `src/main.ts:295-306`（Batch 4 区挂载）
- Modify: `src/data/index.ts`（导出新模块）

**Step 1: HTML**

在「题后留空」块之后、「保存文件夹」之前插入：

```html
<div style="margin-bottom:var(--space-md)">
    <label style="font-weight:600;font-size:14px;margin-bottom:8px;display:block;color:var(--text)">打印字号</label>
    <div id="print-size-options" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    <div id="print-size-hint" style="margin-top:6px;font-size:12px;color:var(--text-tertiary)">测量中…</div>
</div>
```

挡位由 JS 从 `STEM_PT_PRESETS` 生成，**不写死在 HTML**。

**Step 2: `export-pdf-ui.ts`**

```ts
import { STEM_PT_PRESETS, loadStemPt, saveStemPt, mmToPt } from '../data/pdf-print-size';
import { analyzeImage } from '../data/pdf-image';

export function renderPrintSizeOptions(): void { /* 生成挡位按钮，标记选中项 */ }
export function selectPrintSize(el: HTMLElement, pt: number): void { saveStemPt(pt); renderPrintSizeOptions(); refreshPrintSizeHint(); }
export function getPrintStemMM(): number { return ptToMM(loadStemPt()); }
export async function refreshPrintSizeHint(): Promise<void> { /* 见 Task 6 */ }
```

`showExportModal` 末尾调用 `renderPrintSizeOptions()` 与 `refreshPrintSizeHint()`。
`previewExportPDF` / `doExportPDF` 的 `generatePDF` 调用补 `stemMM: getPrintStemMM()`。

**Step 3: `main.ts`** 在 Batch 4 区加：

```ts
renderPrintSizeOptions: ui.renderPrintSizeOptions,
selectPrintSize: ui.selectPrintSize,
getPrintStemMM: ui.getPrintStemMM,
```

**Step 4: 验证**

`npm run typecheck`

---

## Task 6：实测回显

**Files:**
- Modify: `src/data/pdf-image.ts`（新增 `analyzeImage`）
- Modify: `src/data/pdf.ts`（`_internals` 增 `analyzeImage`）
- Modify: `src/ui/export-pdf-ui.ts`（`refreshPrintSizeHint`）

**说明：** 本 Task 只需 `tH` 与 `w`，**不需要** Task 3 的裁剪逻辑（机制 B 已撤销）。
`analyzeImage` 是一次解码同时返回 dims 与 tH，顺带消除 AGENTS.md 记录的「每图 2 次解码」问题。

**Step 1: 写失败测试**（`unit-tests/pdf-image.spec.js` 追加）

```js
it('analyzeImage 一次解码返回 w/h/tH', async () => { /* 注入 _internals 后断言 */ })
```

**Step 2: 实现 `analyzeImage`**

```ts
export async function analyzeImage(src: string): Promise<{ w: number; h: number; tH: number }> {
  const img = await loadImage(src);
  const sc = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * sc);
  const h = Math.round(img.naturalHeight * sc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { w: img.naturalWidth, h: img.naturalHeight, tH: Math.max(10, Math.round(img.naturalHeight * 0.025)) };
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { w: img.naturalWidth, h: img.naturalHeight, tH: estimateTHFromPixels(data, w, h) / sc };
}
```

**Step 3: 回显逻辑**

抽样最多 8 张题图，`printed_i = clamp(natural_i, 0.35*natural_i_at_floor, stemMM)`，
显示：`实测题干 ≈ X pt · N 题受纸宽上限`。
（`natural_i = (tH_i/w_i) * 190`；`X = 中位数(printed_i) / 0.3528`）

**Step 4: 运行**

---

## Task 7：E2E 可见性 + 持久化

**Files:**
- Create: `tests/pdf-print-size.spec.js`

按 AGENTS.md 强制项：截图 + `assertVisiblyRendered`（`tests/helpers/visibility.js`）。

```js
test('打印字号挡位可见且可持久化', async ({ page }) => {
  // 打开导出弹窗 → 断言 5 个挡位 assertVisiblyRendered → captureForReview
  // 点 四号 → 关弹窗 → 重开 → 断言选中态仍为 四号
  // 断言 localStorage.printStemPt === '14'
})
```

运行（避开 safe-delete 拦截）：

```bash
NODE_OPTIONS= npx playwright test tests/pdf-print-size.spec.js --reporter=list --output=tmp/test-results-print-size
```

---

## Task 8：全量 CI + 复现性演练

```bash
npm run typecheck
NODE_OPTIONS= npm run test
npm run build
NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-print-size-full
```

**复现性演练（AGENTS.md 硬规则，必做）：**
写完后临时把改动改回去，确认新测试确实失败，再改回来。至少覆盖：
- Task 1 双栏 x = 10（改回 `MG + CPAD` → 测试须失败）
- Task 3 绝对目标（改回中位数归一化 → `stemMM` 变大而 `rw` 不变 → 测试须失败）
- Task 3 下限（去掉 `Math.max(0.35, …)` → 测试须失败）

清理：`tmp/probe/` 下的探针脚本确认已无用途后删除。

---

## Task 9：文档

- 新建 `docs/pdf-print-size-and-column-width.md`
- 更新 `AGENTS.md`「开发文档索引」追加条目
- 更新本计划文档中的"待确认"为最终结论

---

## 不涉及边界（non-goals）

- **不做横向去白边**（题目为搜题截图，无白边，前提不成立）
- 不动 `mode: 'double'` 的 `generateLegacyDouble`（UI 无入口）
- 不云端同步该配置（仅 localStorage `printStemPt`）
- 不改 `estimateTHFromPixels` 算法
- 不改 `MG = 10`、`CGAP = 4`、`uws = 190`
- 纵向 `CPAD` 保持 6 不变（改动会牵动 MIN_SPLIT 相关分页断言，收益 <5%，不划算）

## 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 尺寸感知栏位会让默认 14pt 下多数题走单栏，页数上升 | 这正是"字要够大"的物理代价；用户降到 10.5pt 即可回双栏。回显展示实测值辅助决策 |
| 2 | `pdf-generate.spec.js` 两处 `x === 16` 断言需改 10 | 已列为 Task 1 Step 5 的**预期**变更 |
| 3 | `pdf-layout-engine.spec.js:18` 分组断言因强制单栏失败 | Task 3 Step 4 明确改写方式，禁止只改数字 |
| 4 | 默认 14pt 是拍的，不是测的（本机无题图、无 JPEG 解码器） | 回显提供实测；挡位可随时改且持久化 |
| 5 | `topReserveMM` 变大（35→38）会压缩首页可用高度 | 有 10mm slack 保底，且单测覆盖首页 y 坐标 |
