# PDF 排版引擎 v5 集成（替换 src/data/pdf.ts）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的排版原型（`www/pdf-text-normalize-prototype.html` v4，含自动分组/组间翻页/长图切割）集成为 TypeScript 模块并替换 `src/data/pdf.ts`，使主项目 `generatePDF` 真正走引擎排版，同时保持 db.js 完整版对外契约不变。

**Architecture:** 排版核心重构为纯函数 `planLayout()`（输入图片尺寸/栏式数组，输出页结构，不触碰 DOM），像素检测与 canvas 切割隔离到 `pdf-image.ts`，中文字体加载隔离到 `pdf-font.ts`。`src/data/pdf.ts` 重写后兼容 db.js 版全部调用契约（single/double/separate/merged、spacingCm、noSave、原生端 DOCUMENTS 保存、中文字体、题号/答案标签、留空虚线），其中 `single` 与 `merged` 模式走引擎路径。通过 `main.ts` 的 `assignToWindow`（覆盖式）挂载，使 TS 版真正取代 db.js 旧版（旧版保留在 db.js 中作为回退）。

**Tech Stack:** TypeScript + Vitest(jsdom) + jsPDF(UMD 全局) + Canvas 2D（检测/切割）+ Capacitor Filesystem（原生保存）。

---

## 背景与关键事实（执行者必读）

1. **当前生产实现**：`public/db.js` L1571 `generatePDF(questions, options)`（约 230 行 JS），经 `src/index.html` L1280 `<script src="/db.js">` 先于 `main.ts` 加载，定义了 `window.generatePDF`。`main.ts` 数据层用 `assignIfMissing`（不覆盖已有），因此 `src/data/pdf.ts` 的 TS 版**从未生效（死代码）**。
2. **db.js 版契约**（必须完整兼容）：`options = { mode='single'|'double'|'separate', spacing='none'|'small'|'large', spacingCm=5, title='', noSave=false }`；`noSave:true` 返回 doc 实例（预览用，见 `src/ui/export-pdf-ui.ts` L62）；原生端保存到 `DOCUMENTS/<folder>/<fileName>` 并 `alert`，Web 端 `doc.save(fileName)`；加载 `fonts/NotoSansSC-Regular.ttf` 注册中文字体；标题两行居中；每题画"第 N 题"标签 + 题图 + "答案:"标签 + 答案图（宽 80%）；`spacing!=='none'` 时题后画虚线留空。
3. **现存 bug（本计划顺带修复）**：`db.js` 中 `generatePaperPDF()`（试卷导出）调用 `generatePDF(questions, { mode: 'merged', title: paper.name })`，但 `generatePDF` 只有 single/double/separate 三个分支，**没有 merged 分支** → 试卷导出的 PDF 只有标题、正文空白。本计划让 `merged` 与 `single` 同走引擎路径，修复此 bug。
4. **引擎来源**：`www/pdf-text-normalize-prototype.html` v4 `buildPages()`（L285-432），已通过浏览器实证：单栏组在前（上传顺序）、双栏组在后（上传顺序）、组间强制翻页、同页不混排、长图按 `MIN_SPLIT=25mm` 切割、切割碎片 unshift 回队首、双栏左栏切不动续右栏。本计划将其重构为纯函数（切割不再在布局期生成 dataURL，改为记录 `crop` 区域，绘制期再切）。
5. **栏式判定（lm）**：原型中"双栏版式"目前靠人工标注（OCR 自动判定是路线图 v4.2，不在本计划范围）。集成后默认全部 `single`；调用方可通过 `options.lmMap[questionId]` 指定 `'single'|'double'`。全 single 时引擎仍提供长图自动切割收益。
6. **项目规范**（AGENTS.md）：不加注释；全部 TypeScript；新代码入 `src/data`；完成后必须跑 `npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js`；git 提交必须先询问用户。
7. **测试环境**：vitest `environment: 'jsdom'`，jsdom 不解码图片、无 canvas 2D 实现 → 所有依赖像素的函数必须支持依赖注入（`_internals`）或抽成纯函数后再测。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/types/pdf.ts` | 排版引擎与导出选项类型 | 新建 |
| `src/types/index.ts` | re-export 新类型 | 修改（追加 1 行） |
| `src/data/pdf-layout-engine.ts` | 纯排版函数 planLayout（分组/翻页/切割/归一化） | 新建 |
| `src/data/pdf-image.ts` | 像素文字高度检测（纯函数+加载壳）、canvas 切割、尺寸读取 | 新建 |
| `src/data/pdf-font.ts` | NotoSansSC base64 加载（模块级缓存） | 新建 |
| `src/data/pdf.ts` | 重写 generatePDF（引擎路径 + double/separate 复刻 + 保存） | 重写 |
| `src/data/index.ts` | 已有 `export * from './pdf'`，无需改 | 不动 |
| `src/main.ts` | generatePDF 改为 assignToWindow 覆盖挂载 | 修改（+1 行） |
| `unit-tests/pdf-layout-engine.spec.js` | 引擎纯函数测试 | 新建 |
| `unit-tests/pdf-image.spec.js` | 检测纯函数测试 | 新建 |
| `unit-tests/pdf-generate.spec.js` | generatePDF 集成测试（mock jspdf + 注入） | 新建 |
| `docs/pdf-layout-engine-v5.md` | 开发文档 | 新建（Task 8） |
| `AGENTS.md` | 开发文档索引 | 修改（Task 8） |

---

### Task 1: 类型定义

**Files:**
- Create: `src/types/pdf.ts`
- Modify: `src/types/index.ts`（末尾追加）

- [ ] **Step 1: 创建 `src/types/pdf.ts`**

```ts
export type LayoutMode = 'single' | 'double';

export interface LayoutImage {
  key: string;
  src: string;
  w: number;
  h: number;
  tH: number;
  lm: LayoutMode;
  label?: string;
  labelH?: number;
  afterGap?: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  label?: string;
  labelH: number;
  afterGap: number;
  isSp: boolean;
  si: number;
  p: number | string;
  t: number | string;
  crop?: CropRect;
}

export interface LayoutPage {
  L: LayoutCell[];
  R: LayoutCell[];
}

export interface PlanLayoutOptions {
  targetTextMM?: number;
  topReserveMM?: number;
  marginMM?: number;
}

export interface PlanLayoutResult {
  pages: LayoutPage[];
  nSplit: number;
}

export interface PDFGenerateOptions {
  mode?: 'single' | 'double' | 'separate' | 'merged';
  spacing?: 'none' | 'small' | 'large';
  spacingCm?: number;
  title?: string;
  noSave?: boolean;
  targetTextMM?: number;
  lmMap?: Record<string, LayoutMode>;
}
```

- [ ] **Step 2: `src/types/index.ts` 末尾追加一行**

```ts
export * from './pdf';
```

- [ ] **Step 3: 类型检查确认无破坏**

Run: `npm run typecheck`
Expected: 无错误（纯新增类型）。

---

### Task 2: 排版引擎纯函数（TDD）

**Files:**
- Create: `src/data/pdf-layout-engine.ts`
- Test: `unit-tests/pdf-layout-engine.spec.js`

- [ ] **Step 1: 写失败测试 `unit-tests/pdf-layout-engine.spec.js`**

```js
import { describe, it, expect } from 'vitest'
import { planLayout } from '../src/data/pdf-layout-engine'

function mk(key, w, h, tH, lm = 'single', extra = {}) {
  return { key, src: 'data:image/jpeg;base64,' + key, w, h, tH, lm, labelH: 0, afterGap: 0, ...extra }
}

describe('planLayout 基础流', () => {
  it('全 single 短图同页顺序排列', () => {
    const r = planLayout([mk('a', 1000, 400, 20), mk('b', 1000, 400, 20), mk('c', 1000, 400, 20)])
    expect(r.pages.length).toBe(1)
    expect(r.pages[0].L.length).toBe(3)
    expect(r.pages[0].L.map(c => c.src.slice(-1))).toEqual(['a', 'b', 'c'])
    expect(r.nSplit).toBe(0)
  })

  it('单栏组在前、双栏组在后、组间强制翻页不混排', () => {
    const r = planLayout([mk('s1', 1000, 400, 20), mk('d1', 1000, 400, 20, 'double'), mk('s2', 1000, 400, 20), mk('d2', 1000, 400, 20, 'double')])
    expect(r.pages.length).toBe(2)
    const p1 = r.pages[0].L.concat(r.pages[0].R)
    const p2 = r.pages[1].L.concat(r.pages[1].R)
    expect(p1.map(c => c.src.slice(-2))).toEqual(['s1', 's2'])
    expect(p2.map(c => c.src.slice(-2))).toEqual(['d1', 'd2'])
  })
})

describe('planLayout 长图切割', () => {
  it('超高图被切割且碎片回队继续排版', () => {
    const r = planLayout([mk('long', 900, 4000, 18)])
    expect(r.pages.length).toBeGreaterThan(1)
    expect(r.nSplit).toBeGreaterThan(0)
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    expect(cells.some(c => c.isSp && c.crop && c.crop.sy === 0)).toBe(true)
    expect(cells.some(c => c.isSp && c.crop && c.crop.sy > 0)).toBe(true)
  })

  it('切割碎片保持源图顺序（后续图不插到碎片中间）', () => {
    const r = planLayout([mk('long', 900, 4000, 18), mk('after', 1000, 300, 20)])
    const flat = r.pages.flatMap(p => p.L.concat(p.R))
    const lastLongIdx = flat.map(c => c.src.slice(-1)).lastIndexOf('g')
    const afterIdx = flat.findIndex(c => c.src.endsWith('after'))
    expect(afterIdx).toBeGreaterThan(lastLongIdx)
  })
})

describe('planLayout 归一化与参数', () => {
  it('normScale 按 baseline 中位数缩放并 clamp 到 [0.35,1]', () => {
    const r = planLayout([mk('big', 1000, 400, 10), mk('small', 1000, 400, 100)])
    const cells = r.pages[0].L
    const bigCell = cells.find(c => c.src.endsWith('g'))
    const smallCell = cells.find(c => c.src.endsWith('l'))
    expect(smallCell.w / bigCell.w).toBeCloseTo(0.35, 5)
  })

  it('topReserveMM 只压缩第一页可用高度', () => {
    const r = planLayout([mk('a', 1000, 400, 20)], { topReserveMM: 35 })
    expect(r.pages[0].L[0].y).toBeCloseTo(297 - 10 - (277 - 35) + 6, 5)
  })

  it('labelH 记录到 cell 供绘制层预算', () => {
    const withLabel = planLayout([mk('a', 1000, 400, 20, 'single', { label: '第 1 题', labelH: 5 })])
    expect(withLabel.pages[0].L[0].labelH).toBe(5)
  })

  it('marginMM 可配置', () => {
    const r = planLayout([mk('a', 1000, 400, 20)], { marginMM: 15 })
    expect(r.pages[0].L[0].x).toBe(15)
  })

  it('空输入与全零图返回空页', () => {
    expect(planLayout([]).pages.length).toBe(0)
    expect(planLayout([mk('z', 0, 0, 0)]).pages.length).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run unit-tests/pdf-layout-engine.spec.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/data/pdf-layout-engine.ts`**

```ts
import type { LayoutImage, LayoutCell, LayoutPage, PlanLayoutOptions, PlanLayoutResult } from '../types';

const AW = 210, AH = 297, CGAP = 4, CPAD = 6, MIN_SPLIT = 25;

interface QueueItem {
  key: string;
  cropY: number;
  cropH: number;
  lm: 'single' | 'double';
}

export function planLayout(images: LayoutImage[], opts: PlanLayoutOptions = {}): PlanLayoutResult {
  const MG = opts.marginMM ?? 10;
  const uws = AW - 2 * MG;
  const uwd = (uws - CGAP) / 2 - 2 * CPAD;
  const uh = AH - 2 * MG;
  const tgt = opts.targetTextMM ?? 4;
  const topReserve = opts.topReserveMM ?? 0;

  const valid = images.filter(im => im.tH > 0 && im.w > 0 && im.h > 0);
  if (!valid.length) return { pages: [], nSplit: 0 };

  const scales = valid.map(im => tgt / ((im.tH / im.w) * (im.lm === 'double' ? uwd : uws)));
  scales.sort((a, b) => a - b);
  const baseline = scales[Math.floor(scales.length / 2)] || 1;

  const norm = new Map<string, number>();
  for (const im of valid) {
    const uw = im.lm === 'double' ? uwd : uws;
    const raw = tgt / ((im.tH / im.w) * uw);
    norm.set(im.key, Math.max(0.35, Math.min(1, raw / baseline)));
  }

  const byKey = new Map(images.map(im => [im.key, im]));
  const queue: QueueItem[] = [];
  for (const want of ['single', 'double'] as const) {
    for (const im of images) {
      if (im.lm === want && im.tH > 0 && im.w > 0 && im.h > 0) {
        queue.push({ key: im.key, cropY: 0, cropH: im.h, lm: im.lm });
      }
    }
  }

  const pages: LayoutPage[] = [];
  let nSplit = 0;
  let page: LayoutPage = { L: [], R: [] };
  let yL = uh - topReserve;
  let yR = uh - topReserve;

  function newPage(): void {
    if (page.L.length || page.R.length) pages.push(page);
    page = { L: [], R: [] };
    yL = uh;
    yR = uh;
  }

  function addCell(col: 'L' | 'R', x: number, y: number, w: number, h: number, im: LayoutImage, q: QueueItem, partial: CropRect | undefined, si: number): void {
    const cell: LayoutCell = {
      x, y, w, h,
      src: im.src,
      label: im.label,
      labelH: im.labelH || 0,
      afterGap: q.cropY === 0 && q.cropH === im.h ? im.afterGap || 0 : 0,
      isSp: !!partial,
      si,
      p: partial ? 1 : '',
      t: partial ? 2 : '',
      crop: partial,
    };
    (col === 'L' ? page.L : page.R).push(cell);
  }

  let lastLm: string | undefined;
  let iter = 0;

  while (queue.length && iter < 300) {
    iter++;
    const q = queue.shift()!;
    const im = byKey.get(q.key);
    if (!im) continue;
    if (lastLm !== undefined && q.lm !== lastLm && (page.L.length || page.R.length)) newPage();
    lastLm = q.lm;

    const uw = q.lm === 'double' ? uwd : uws;
    const ns = norm.get(q.key)!;
    const rw = uw * ns;
    const rh = rw * (q.cropH / im.w);
    const lh = im.labelH || 0;
    const pad = CPAD;
    const isWhole = q.cropY === 0 && q.cropH === im.h;
    const gap = isWhole ? im.afterGap || 0 : 0;

    if (q.lm === 'single') {
      const need = rh + lh + pad * 2 + gap;
      if (need <= yL) {
        addCell('L', MG, AH - MG - yL + pad, rw, rh, im, q, undefined, nSplit);
        yL -= need;
      } else {
        const availImg = yL - pad * 2 - lh;
        if (availImg >= MIN_SPLIT) {
          const cropPx = Math.round(q.cropH * (availImg / rh));
          addCell('L', MG, AH - MG - yL + pad, rw, availImg, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx }, nSplit);
          nSplit++;
          yL = 0;
          const remH = q.cropH - cropPx;
          const startY = q.cropY + cropPx;
          newPage();
          if (remH > MIN_SPLIT) queue.unshift({ key: q.key, cropY: startY, cropH: remH, lm: q.lm });
        } else {
          newPage();
          const need2 = rh + lh + pad * 2 + gap;
          if (need2 <= uh) {
            addCell('L', MG, MG + pad, rw, rh, im, q, undefined, nSplit);
            yL = uh - need2;
          } else {
            const availImg2 = uh - pad * 2 - lh;
            const cropPx2 = Math.round(q.cropH * (availImg2 / rh));
            addCell('L', MG, MG + pad, rw, availImg2, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx2 }, nSplit);
            nSplit++;
            yL = 0;
            const remH2 = q.cropH - cropPx2;
            const sP = q.cropY + cropPx2;
            newPage();
            if (remH2 > MIN_SPLIT) queue.unshift({ key: q.key, cropY: sP, cropH: remH2, lm: q.lm });
          }
        }
      }
    } else {
      const need = rh + lh + pad * 2;
      let placed = false;

      if (need <= yL) {
        addCell('L', MG + CPAD, AH - MG - yL + pad, rw, rh, im, q, undefined, nSplit);
        yL -= need + gap;
        placed = true;
      } else if (yL - pad * 2 - lh >= MIN_SPLIT) {
        const availImg = yL - pad * 2 - lh;
        const cropPx = Math.round(q.cropH * (availImg / rh));
        addCell('L', MG + CPAD, AH - MG - yL + pad, rw, availImg, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx }, nSplit);
        nSplit++;
        yL = 0;
        const remHpx = q.cropH - cropPx;
        const startY2 = q.cropY + cropPx;
        const remHmm = rw * (remHpx / im.w);
        if (remHmm + lh + pad * 2 <= yR) {
          addCell('R', AW / 2 + CGAP / 2 + CPAD, AH - MG - yR + pad, rw, remHmm, im, { ...q, cropY: startY2, cropH: remHpx }, { sx: 0, sy: startY2, sw: im.w, sh: remHpx }, nSplit - 1);
          yR -= remHmm + lh + pad * 2;
          placed = true;
        } else {
          queue.unshift({ key: q.key, cropY: startY2, cropH: remHpx, lm: q.lm });
          placed = true;
        }
      }

      if (!placed) {
        if (need <= yR) {
          addCell('R', AW / 2 + CGAP / 2 + CPAD, AH - MG - yR + pad, rw, rh, im, q, undefined, nSplit);
          yR -= need + gap;
          placed = true;
        } else {
          newPage();
          if (need <= uh) {
            addCell('L', MG + CPAD, MG + pad, rw, rh, im, q, undefined, nSplit);
            yL = uh - need - gap;
            placed = true;
          } else {
            const availImg2 = uh - pad * 2 - lh;
            const cropPx2 = Math.round(q.cropH * (availImg2 / rh));
            addCell('L', MG + CPAD, MG + pad, rw, availImg2, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx2 }, nSplit);
            nSplit++;
            yL = 0;
            const remH2px = q.cropH - cropPx2;
            const sP2 = q.cropY + cropPx2;
            newPage();
            if (remH2px > MIN_SPLIT) queue.unshift({ key: q.key, cropY: sP2, cropH: remH2px, lm: q.lm });
            placed = true;
          }
        }
      }
    }
  }

  if (page.L.length || page.R.length) pages.push(page);
  return { pages, nSplit };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run unit-tests/pdf-layout-engine.spec.js`
Expected: 全部 PASS。

---

### Task 3: 图像工具（检测纯函数 + 切割）

**Files:**
- Create: `src/data/pdf-image.ts`
- Test: `unit-tests/pdf-image.spec.js`

- [ ] **Step 1: 写失败测试 `unit-tests/pdf-image.spec.js`**

```js
import { describe, it, expect } from 'vitest'
import { estimateTHFromPixels } from '../src/data/pdf-image'

function white(w, h) {
  return new Uint8ClampedArray(w * h * 4).fill(255)
}

function stripes(w, h, periodPx) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = Math.floor(periodPx / 2); y < h; y += periodPx) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = 40; d[i + 1] = 40; d[i + 2] = 40
    }
  }
  return d
}

describe('estimateTHFromPixels', () => {
  it('纯白图走 fallback（约 h*0.025）', () => {
    expect(estimateTHFromPixels(white(200, 400), 200, 400)).toBe(10)
  })

  it('条纹图文字高度接近条宽', () => {
    const v = estimateTHFromPixels(stripes(400, 300, 20), 400, 300)
    expect(v).toBeGreaterThanOrEqual(5)
    expect(v).toBeLessThanOrEqual(30)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run unit-tests/pdf-image.spec.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/data/pdf-image.ts`**

```ts
import type { CropRect } from '../types';

export function estimateTHFromPixels(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  const N = w * h;
  for (let i = 0; i < N; i++) sum += data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const mean = sum / N;

  const proj = new Float32Array(h);
  const step = Math.max(1, Math.floor(w / 200));
  const thresh = mean * 0.88;
  for (let y = 0; y < h; y++) {
    let dark = 0, total = 0;
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const v = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      total++;
      if (v < thresh) dark++;
    }
    proj[y] = dark / total;
  }

  const sm = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const a0 = y > 0 ? proj[y - 1] : proj[y];
    const a1 = proj[y];
    const a2 = y < h - 1 ? proj[y + 1] : proj[y];
    sm[y] = (a0 + a1 + a2) / 3;
  }

  const heights: number[] = [];
  const minTh = 0.05;
  let inLine = false, lineStart = 0;
  for (let y = 0; y < h; y++) {
    if (sm[y] > minTh && !inLine) { inLine = true; lineStart = y; }
    else if (sm[y] <= minTh && inLine) {
      inLine = false;
      const lhh = y - lineStart;
      if (lhh >= 5 && lhh <= h * 0.22) heights.push(lhh);
    }
  }
  if (inLine) {
    const lhh = h - lineStart;
    if (lhh >= 5 && lhh <= h * 0.22) heights.push(lhh);
  }

  if (!heights.length) return Math.max(10, Math.round(h * 0.025));
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败: ' + String(src).slice(0, 60)));
    img.src = src;
  });
}

export async function loadImageDims(src: string): Promise<{ w: number; h: number }> {
  const img = await loadImage(src);
  return { w: img.naturalWidth, h: img.naturalHeight };
}

export async function estimateTH(src: string): Promise<number> {
  const img = await loadImage(src);
  const sc = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * sc);
  const h = Math.round(img.naturalHeight * sc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Math.max(10, Math.round(h * 0.025));
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return estimateTHFromPixels(data, w, h) / sc;
}

export async function cropImage(src: string, rect: CropRect): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = rect.sw; c.height = rect.sh;
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
  return c.toDataURL('image/jpeg', 0.92);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run unit-tests/pdf-image.spec.js`
Expected: PASS。

---

### Task 4: 中文字体加载

**Files:**
- Create: `src/data/pdf-font.ts`

- [ ] **Step 1: 实现（从 db.js `_loadFontBase64` 移植，模块级缓存）**

```ts
let cached: string | null = null;
let loading: Promise<string | null> | null = null;

export function loadCnFontBase64(): Promise<string | null> {
  if (cached !== null) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    for (const p of ['fonts/NotoSansSC-Regular.ttf', './fonts/NotoSansSC-Regular.ttf', '/public/fonts/NotoSansSC-Regular.ttf']) {
      try {
        const resp = await fetch(p);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          cached = btoa(binary);
          return cached;
        }
      } catch { /* try next */ }
    }
    return null;
  })();
  return loading;
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误。

### Task 5: 重写 src/data/pdf.ts（TDD）

**Files:**
- Rewrite: `src/data/pdf.ts`（完全替换现有 75 行）
- Test: `unit-tests/pdf-generate.spec.js`

- [ ] **Step 1: 写失败测试 `unit-tests/pdf-generate.spec.js`**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

class FakeDoc {
  constructor() {
    this.calls = []
    this.pages = 1
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
  }
  addImage(src, fmt, x, y, w, h) { this.calls.push(['addImage', String(src), x, y, w, h]) }
  addPage() { this.pages++; this.calls.push(['addPage']) }
  save(name) { this.calls.push(['save', name]) }
  output(kind) { return kind === 'blob' ? new Blob() : 'data:application/pdf;base64,FAKE' }
  text(t, x, y, o) { this.calls.push(['text', t, x, y]) }
  setFontSize() {} setTextColor() {} setFont() {}
  setDrawColor() {} setLineWidth() {} setLineDash() {}
  line(x1, y1, x2, y2) { this.calls.push(['line', x1, y1, x2, y2]) }
  addFileToVFS() {} addFont() {}
}

const q = (id, withAns = true) => ({
  id,
  question_image_url: 'data:image/jpeg;base64,Q' + id,
  answer_image_url: withAns ? 'data:image/jpeg;base64,A' + id : null,
})

describe('generatePDF', () => {
  let generatePDF, _internals, lastDoc
  beforeEach(async () => {
    vi.resetModules()
    lastDoc = undefined
    window.jspdf = { jsPDF: class extends FakeDoc { constructor() { super(); lastDoc = this } } }
    window.Capacitor = undefined
    const mod = await import('../src/data/pdf')
    generatePDF = mod.generatePDF
    _internals = mod._internals
    _internals.estimateTH = async () => 20
    _internals.cropImage = async (src, rect) => src + '#crop' + rect.sy + '-' + rect.sh
    _internals.loadImageDims = async (src) => String(src).includes('LONG') ? { w: 900, h: 4000 } : { w: 1000, h: 400 }
    _internals.loadCnFontBase64 = async () => 'FAKE_FONT_B64'
  })

  it('noSave 返回 doc 且 merged 走引擎：2 题带答案画 4 张图', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'merged', title: '试卷A', noSave: true })
    expect(doc).toBeInstanceOf(FakeDoc)
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBe(4)
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('第 1 题')
    expect(texts.join('|')).toContain('答案:')
    expect(texts.join('|')).toContain('试卷A')
  })

  it('引擎路径长图触发切割并调用 cropImage', async () => {
    const doc = await generatePDF([q('LONG')], { mode: 'single', noSave: true })
    const crops = doc.calls.filter(c => c[0] === 'addImage' && c[1].includes('#crop'))
    expect(crops.length).toBeGreaterThan(0)
    expect(doc.pages).toBeGreaterThan(1)
  })

  it('Web 端保存走 doc.save(fileName)', async () => {
    await generatePDF([q('1')], { mode: 'single', title: '导出X' })
    expect(lastDoc.calls.some(c => c[0] === 'save' && c[1] === '导出X.pdf')).toBe(true)
  })

  it('separate 模式：题目页后跟参考答案页', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'separate', noSave: true })
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('参考答案')
    expect(doc.pages).toBeGreaterThanOrEqual(2)
  })

  it('double 模式：两题并排（第二题 x 大于页中线）', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'double', noSave: true })
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBeGreaterThanOrEqual(2)
    expect(imgs[1][2]).toBeGreaterThan(105)
  })

  it('spacing large + spacingCm 画留空虚线', async () => {
    const doc = await generatePDF([q('1')], { mode: 'single', spacing: 'large', spacingCm: 2, noSave: true })
    expect(doc.calls.some(c => c[0] === 'line')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: FAIL（现版无 `_internals` 导出、merged 无分支）。

- [ ] **Step 3: 重写 `src/data/pdf.ts`（完全替换文件内容）**

```ts
import type { Question, LayoutImage, LayoutCell, PDFGenerateOptions } from '../types';
import { planLayout } from './pdf-layout-engine';
import { estimateTH, cropImage, loadImageDims } from './pdf-image';
import { loadCnFontBase64 } from './pdf-font';

declare const jspdf: { jsPDF: new (opts?: Record<string, unknown>) => JsPDFInstance };

interface JsPDFInstance {
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  save(filename: string): void;
  output(kind: string): unknown;
  text(text: string, x: number, y: number, opts?: Record<string, unknown>): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g?: number, b?: number): void;
  setFont(name: string): void;
  setDrawColor(r: number, g?: number, b?: number): void;
  setLineWidth(w: number): void;
  setLineDash(segments: number[]): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  addFileToVFS(name: string, data: string): void;
  addFont(name: string, alias: string, style: string): void;
  getNumberOfPages(): number;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

export const _internals = { estimateTH, cropImage, loadImageDims, loadCnFontBase64 };

const W = 210, H = 297, M = 15, MAXW = W - M * 2;

async function registerCnFont(doc: JsPDFInstance): Promise<string> {
  const b64 = await _internals.loadCnFontBase64();
  if (b64) {
    doc.addFileToVFS('NotoSansSC-Regular.ttf', b64);
    doc.addFont('NotoSansSC-Regular.ttf', 'NotoSC', 'normal');
    return 'NotoSC';
  }
  return 'helvetica';
}

function drawCentered(doc: JsPDFInstance, cn: string, text: string, y: number, size: number): void {
  doc.setFont(cn);
  doc.setFontSize(size);
  doc.text(text, W / 2, y, { align: 'center' });
}

function drawLabel(doc: JsPDFInstance, cn: string, text: string, x: number, y: number, size: number): void {
  doc.setFont(cn);
  doc.setFontSize(size);
  doc.text(text, x, y);
}

async function placeImg(doc: JsPDFInstance, src: string, x: number, y: number, maxW: number, maxH?: number): Promise<number> {
  if (!src) return 0;
  try {
    const { w, h } = await _internals.loadImageDims(src);
    const height = (h / w) * maxW;
    const drawH = maxH && height > maxH ? maxH : height;
    doc.addImage(src, 'JPEG', x, y, maxW, drawH);
    return drawH;
  } catch (e) {
    console.warn('PDF 生成中图片添加失败:', e);
    return 0;
  }
}

async function estH(src: string, maxW: number): Promise<number> {
  if (!src) return 0;
  try {
    const { w, h } = await _internals.loadImageDims(src);
    return (h / w) * maxW;
  } catch { return 0; }
}

async function generateWithEngine(
  questions: Question[],
  doc: JsPDFInstance,
  cn: string,
  opts: { spacing: 'none' | 'small' | 'large'; spacingCm: number; title: string; targetTextMM: number; lmMap?: Record<string, 'single' | 'double'> },
): Promise<void> {
  const spcMm = opts.spacing !== 'none' ? opts.spacingCm * 10 : 0;

  if (opts.title) {
    drawCentered(doc, cn, opts.title, M + 5, 18);
    drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
  }

  const units: LayoutImage[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const lm = (opts.lmMap && opts.lmMap[q.id]) || 'single';
    if (q.question_image_url) {
      try {
        const dims = await _internals.loadImageDims(q.question_image_url);
        const tH = await _internals.estimateTH(q.question_image_url);
        units.push({ key: `q${i}`, src: q.question_image_url, w: dims.w, h: dims.h, tH, lm, label: `第 ${i + 1} 题`, labelH: 5, afterGap: spcMm });
      } catch (e) {
        console.warn('跳过无法读取的题目图片:', e);
      }
    }
    if (q.answer_image_url) {
      try {
        const dims = await _internals.loadImageDims(q.answer_image_url);
        const tH = await _internals.estimateTH(q.answer_image_url);
        units.push({ key: `a${i}`, src: q.answer_image_url, w: dims.w, h: dims.h, tH, lm, label: '答案:', labelH: 4, afterGap: 0 });
      } catch (e) {
        console.warn('跳过无法读取的答案图片:', e);
      }
    }
  }

  const { pages } = planLayout(units, { targetTextMM: opts.targetTextMM, topReserveMM: opts.title ? 35 : 0 });

  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0) doc.addPage();
    doc.setFontSize(8);
    doc.setTextColor(180);
    doc.text(`— ${pi + 1}/${pages.length} —`, W / 2, H - 4, { align: 'center' });
    doc.setTextColor(0);
    const cells: LayoutCell[] = pages[pi].L.concat(pages[pi].R);
    for (const cell of cells) {
      if (cell.label) {
        drawLabel(doc, cn, cell.label, cell.x, cell.y + 3, cell.label === '答案:' ? 9 : 11);
      }
      const src = cell.crop ? await _internals.cropImage(cell.src, cell.crop) : cell.src;
      doc.addImage(src, 'JPEG', cell.x, cell.y + cell.labelH, cell.w, cell.h);
      const bottomY = cell.y + cell.labelH + cell.h + 0.4;
      if (cell.isSp) {
        doc.setDrawColor(251, 191, 36);
        doc.setLineWidth(0.25);
        doc.line(cell.x, bottomY, cell.x + cell.w, bottomY);
      }
      if (cell.afterGap > 0) {
        doc.setDrawColor(200);
        doc.setLineDash([3, 3]);
        doc.line(cell.x, bottomY + 2, cell.x + cell.w, bottomY + 2);
        doc.setLineDash([]);
      }
    }
  }
}

async function generateLegacyDouble(questions: Question[], doc: JsPDFInstance, cn: string, y0: number, spcMm: number): Promise<void> {
  let y = y0;
  const halfW = (MAXW - 4) / 2;
  let i = 0;
  while (i < questions.length) {
    const q = questions[i];
    const nextQ = questions[i + 1];
    if (y > H - M - 30) { doc.addPage(); y = M; }
    if (nextQ) {
      const h1 = await estH(q.question_image_url, halfW);
      const h2 = await estH(nextQ.question_image_url, halfW);
      const labelH = 6;
      if (h1 > 0 && h2 > 0 && y + Math.max(h1, h2) + labelH + 2 <= H - M) {
        drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 10);
        drawLabel(doc, cn, `第 ${i + 2} 题`, M + halfW + 4, y + 4, 10);
        y += labelH;
        const usedH = Math.max(
          await placeImg(doc, q.question_image_url, M, y, halfW, H - M - y),
          await placeImg(doc, nextQ.question_image_url, M + halfW + 4, y, halfW, H - M - y),
        );
        y += usedH + 2;
        const a1 = q.answer_image_url, a2 = nextQ.answer_image_url;
        if (a1 || a2) {
          const ah1 = a1 ? await estH(a1, halfW) : 0;
          const ah2 = a2 ? await estH(a2, halfW) : 0;
          const ansNeedH = Math.max(ah1, ah2) + 8;
          if (y + ansNeedH <= H - M && ah1 > 0 && ah2 > 0) {
            drawLabel(doc, cn, '答案:', M, y + 4, 9);
            if (a2) drawLabel(doc, cn, '答案:', M + halfW + 4, y + 4, 9);
            y += 5;
            y += Math.max(
              a1 ? await placeImg(doc, a1, M, y, halfW, H - M - y) : 0,
              a2 ? await placeImg(doc, a2, M + halfW + 4, y, halfW, H - M - y) : 0,
            ) + 2;
          } else {
            if (a1) {
              if (y + ah1 + 7 > H - M) { doc.addPage(); y = M; }
              drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 5;
              y += await placeImg(doc, a1, M, y, halfW, H - M - y) + 2;
            }
            if (a2) {
              if (y + ah2 + 7 > H - M) { doc.addPage(); y = M; }
              drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 5;
              y += await placeImg(doc, a2, M, y, halfW, H - M - y) + 2;
            }
          }
        }
        if (spcMm > 0) {
          doc.setDrawColor(200); doc.setLineDash([3, 3]);
          doc.line(M, y, W - M, y); doc.setLineDash([]);
          y += spcMm;
        }
        i += 2;
        continue;
      }
    }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 11);
    y += 5;
    y += await placeImg(doc, q.question_image_url, M, y, MAXW) + 2;
    if (q.answer_image_url) {
      if (y + 15 > H - M) { doc.addPage(); y = M; }
      drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 4;
      y += await placeImg(doc, q.answer_image_url, M, y, MAXW * 0.8) + 2;
    }
    if (spcMm > 0) {
      doc.setDrawColor(200); doc.setLineDash([3, 3]);
      doc.line(M, y, W - M, y); doc.setLineDash([]);
      y += spcMm;
    }
    i++;
  }
}

async function generateLegacySeparate(questions: Question[], doc: JsPDFInstance, cn: string, y0: number, spcMm: number): Promise<void> {
  let y = y0;
  for (let i = 0; i < questions.length; i++) {
    if (y > H - M - 20) { doc.addPage(); y = M; }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 11);
    y += 5;
    y += await placeImg(doc, questions[i].question_image_url, M, y, MAXW) + 2;
    if (spcMm > 0) y += spcMm;
  }
  doc.addPage(); y = M;
  drawCentered(doc, cn, '参考答案', y, 16);
  y += 10;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.answer_image_url) continue;
    if (y + 15 > H - M) { doc.addPage(); y = M; }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 10);
    y += 5;
    y += await placeImg(doc, q.answer_image_url, M, y, MAXW * 0.8) + 3;
  }
}

export async function generatePDF(questions: Question[], options: PDFGenerateOptions = {}): Promise<JsPDFInstance | undefined> {
  const doc = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const cn = await registerCnFont(doc);
  const mode = options.mode || 'single';
  const spacing = options.spacing || 'none';
  const spacingCm = options.spacingCm ?? 5;
  const title = options.title || '';
  const spcMm = spacing !== 'none' ? spacingCm * 10 : 0;

  if (mode === 'single' || mode === 'merged') {
    await generateWithEngine(questions, doc, cn, {
      spacing, spacingCm, title,
      targetTextMM: options.targetTextMM ?? 4,
      lmMap: options.lmMap,
    });
  } else if (mode === 'double') {
    if (title) {
      drawCentered(doc, cn, title, M + 5, 18);
      drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
    }
    await generateLegacyDouble(questions, doc, cn, title ? M + 20 : M, spcMm);
  } else if (mode === 'separate') {
    if (title) {
      drawCentered(doc, cn, title, M + 5, 18);
      drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
    }
    await generateLegacySeparate(questions, doc, cn, title ? M + 20 : M, spcMm);
  }

  if (options.noSave) return doc;

  const fileName = `${title || '题库导出'}.pdf`;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative && window.Capacitor?.Plugins?.Filesystem) {
    const pdfBase64 = String(doc.output('dataurlstring')).split(',')[1];
    const folder = (typeof window.getExportFolder === 'function') ? window.getExportFolder() : '';
    const filePath = folder ? `${folder}/${fileName}` : fileName;
    try {
      await window.Capacitor.Plugins.Filesystem.writeFile({ path: filePath, data: pdfBase64, directory: 'DOCUMENTS' });
      alert('PDF 已保存: DOCUMENTS/' + filePath);
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    doc.save(fileName);
  }
  return undefined;
}
```

注意：`window.Capacitor` / `window.getExportFolder` 需在本文件顶部加类型声明（不加注释）：

```ts
declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Filesystem?: { writeFile(opts: Record<string, unknown>): Promise<unknown> } } };
    getExportFolder?: () => string;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: 全部 PASS。

- [ ] **Step 5: 全量单测回归**

Run: `npm run test`
Expected: 全部 PASS（新测试 + 存量 unit-tests/）。

---

### Task 6: main.ts 覆盖挂载（让 TS 版真正生效）

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 在 L274 起的 `assignToWindow({` 批次内追加一行**

定位锚点（批次末尾）：

```ts
  loadPapers: ui.loadPapers,
  loadTopics: ui.loadTopics,
});
```

替换为：

```ts
  loadPapers: ui.loadPapers,
  loadTopics: ui.loadTopics,
  generatePDF: data.generatePDF,
});
```

说明：`assignToWindow` 是覆盖式挂载，db.js 已先定义 `window.generatePDF`，此处覆盖后 UI 层（`export-pdf-ui.ts` 的 `w.generatePDF`）与 `generatePaperPDF`（db.js 内部引用 `window.generatePDF`）都会路由到 TS 新版。回退方式：删除该行即可恢复 db.js 版。

- [ ] **Step 2: 类型检查 + 构建**

Run: `npm run typecheck && npm run build`
Expected: 均无错误。

- [ ] **Step 3: 提交（先询问用户）**

```bash
git add src/types/pdf.ts src/types/index.ts src/data/pdf-layout-engine.ts src/data/pdf-image.ts src/data/pdf-font.ts src/data/pdf.ts src/main.ts unit-tests/pdf-layout-engine.spec.js unit-tests/pdf-image.spec.js unit-tests/pdf-generate.spec.js
git commit -m "PDF导出接入自动分组排版引擎 - planLayout纯函数+长图切割+修复试卷导出空白页"
```

先向用户展示 git status 并确认后再执行提交（AGENTS.md 规则）。

---

### Task 7: 本地 CI/CD 验证循环 + 浏览器冒烟

- [ ] **Step 1: 依次执行（任何一步失败先修复再重跑）**

```bash
npm run typecheck
npm run test
npm run build
npx playwright test tests/ui-health.spec.js
```

Expected: 全部通过。

- [ ] **Step 2: 浏览器冒烟（dev server + browser-use）**

```bash
npm run dev
```

用 browser-use 打开 `http://localhost:<vite端口>`：
1. 题库列表选中 ≥2 题（含一题有答案图）→ 点「导出 PDF」→ 选「单栏排列」→ 点「预览」→ 断言：弹出的预览 PDF 包含题号/答案标签、页码，长题图被切割且无重叠（对应 `noSave` 路径）。
2. 点「导出 PDF」→ Web 下载触发（对应 `doc.save` 路径）。
3. 截图存 `/tmp/evidence-pdf-engine-v5.png`。

Expected: 预览与导出均成功、无 console 报错。

---

### Task 8: 文档 + 索引 + 打包（可选）

- [ ] **Step 1: 新建 `docs/pdf-layout-engine-v5.md`**

内容须包含：背景（db.js 死代码/merged 空白 bug）、四模块架构图（types/pdf-layout-engine/pdf-image/pdf-font/pdf.ts）、引擎规则（分组/翻页/切割/normScale/topReserve）、契约表（options 字段与 db.js 版对照）、lmMap 扩展点与 OCR 自动判定（v4.2）后续路线、回退方式（删 main.ts 一行）、验证记录（CI 四步 + 截图）。

- [ ] **Step 2: 更新 `AGENTS.md` 开发文档索引（功能设计文档表追加一行）**

```markdown
| PDF 排版引擎 v5 集成 | planLayout 纯函数引擎替换 pdf.ts + 单双栏自动分组 + 长图切割 + 修复试卷导出空白 | docs/pdf-layout-engine-v5.md | 2026-08-28 | PDF 生成, 排版引擎, generatePDF, 试卷导出 |
```

- [ ] **Step 3: 询问用户是否打包**

如需 APK：先加载 `ship-feature` skill，按其步骤执行 `npm run ship -- "PDF导出接入自动分组排版引擎"`。

---

## Self-Review 结论

1. **Spec 覆盖**：原型引擎全部规则（分组 queue/组间翻页/切割 unshift/双栏左切右续/normScale clamp）→ Task 2；db.js 契约（四种 mode/spacingCm/noSave/原生保存/中文字体/标签/虚线）→ Task 5；挂载生效 → Task 6；merged 空白 bug 修复 → Task 5 引擎路径；CI/CD 与文档 → Task 7/8。OCR 自动判定（原型路线图 v4.2）明确不在本计划（lmMap 扩展点已留）。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
3. **类型一致性**：`LayoutImage.labelH/afterGap` 可选（Task 1）与引擎读取 `im.labelH || 0`（Task 2）一致；`planLayout` 返回 `{pages, nSplit}`（Task 2）与 Task 5 解构一致；`_internals` 四个注入点（estimateTH/cropImage/loadImageDims/loadCnFontBase64）在 Task 5 定义与测试注入一一对应；`LayoutCell.crop?` 与绘制层 `cell.crop ? cropImage(...)` 一致。
