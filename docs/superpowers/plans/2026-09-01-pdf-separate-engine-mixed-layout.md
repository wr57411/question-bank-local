# separate 模式接入引擎自动单双栏混排 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导出弹窗「题目/答案分开」（separate）也按 `layout_type` 标注自动单双栏混排（当前走旧版逻辑整图全宽单栏），并同步更新弹窗小字说明。

**Architecture:** 重构 `src/data/pdf.ts`：把 `generateWithEngine` 内的"单元构建"与"页面绘制"抽为两个共用函数（`buildEngineUnits` / `renderEnginePages`），新增 `generateWithEngineSeparate`——题目段与答案段各自 `planLayout`（答案段首页带"参考答案"表头并预留顶部空间），页码全文连续编号；删除被取代的 `generateLegacySeparate`。separate 的留空行为对齐引擎（题后 afterGap 虚线）。

**Tech Stack:** TypeScript + Vitest(jsdom)，复用既有 FakeDoc/`_internals` 测试基建，引擎 `planLayout` 不改。

---

## 背景与关键事实（执行者必读）

1. **用户报告**：`layout_type=1`（双栏标注）题目在「题目跟答案挨着」模式下已正确混排（半宽双栏+组间翻页），但「题目/答案分开」模式导出仍是整图全宽单栏；弹窗小字也只有"挨着"项写了自动混排。
2. **根因（明确，无需调查）**：v5 集成时 `generatePDF` 仅 `single/merged` 走引擎；`separate` 走 `generateLegacySeparate`（逐题整图 `MAXW` 全宽、答案图 `MAXW*0.8`，无 lm 概念）[src/data/pdf.ts#L228](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/data/pdf.ts#L228)。
3. **现状引擎路径**（要抽取复用的代码）：
   - `generateWithEngine`（L82-153）：标题两行 → 构建 units（题图 label=`第 N 题` labelH=5 afterGap=spcMm；答案图 label=`答案:` labelH=4 afterGap=0；lm=`lmMap||layout_type===1?'double':'single'`）→ `planLayout(units,{targetTextMM,topReserveMM:title?35:0})` → truncated 告警 → 逐页渲染（页码 `— i/N —`、label、crop 绘制、黄色切割线、留空虚线）。
   - 几何常量：单栏 cell `x=MG=10`（marginMM 默认 10）、双栏左栏 `x=MG+CPAD=16`。
4. **separate 新语义**：题目段 = 全部题图 units（label=`第 N 题`）走引擎；`addPage` 后答案段首页画居中"参考答案"（size 16，y=M），答案段 units（label=`第 N 题`，labelH=5，afterGap=0）走引擎 `topReserveMM=25`（给表头让位）；页码全文连续（题目段 N 页 + 答案段 M 页 → 共 N+M 页）。**行为变化**：separate 题目段现在也有题后留空虚线（原逻辑只加空隙不画线）与长图切割——与"挨着"模式视觉统一，符合用户"两种布局都自动排版"的预期。
5. **`generateLegacyDouble` 保留不动**（UI 已无入口的死路径，向后兼容，本计划不触碰）；`generateLegacySeparate` 删除（被新实现取代）。
6. **规范**：不加注释；CI 四步循环 `npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js`；git 提交需用户确认后推送 origin f640/main2。
7. **测试基线**：unit-tests 当前 176 passed / 9 skipped（pdf-generate 7 条 + questions-normalize 10 条 + 引擎 19 + 图像 2）。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/data/pdf.ts` | 抽 buildEngineUnits/renderEnginePages + 新 generateWithEngineSeparate + 改分发 + 删 legacy separate | 重构 |
| `unit-tests/pdf-generate.spec.js` | 追加 separate 引擎测试 | 修改（追加） |
| `src/index.html` | separate 选项小字更新 | 修改（1 行） |
| `docs/pdf-layout-engine-v5.md` | 行为说明更新 | 修改 |

---

### Task 1: pdf.ts separate 引擎化（TDD）

**Files:**
- Test: `unit-tests/pdf-generate.spec.js`（追加）
- Modify: `src/data/pdf.ts`

- [ ] **Step 1: 追加失败测试**（到 `describe('generatePDF')` 末尾，不动现有测试）

```js
  it('separate 走引擎自动混排：双栏标注的题图与答案图均按双栏排版，题目段与答案段分页', async () => {
    const qs = [
      { ...q('s', true), layout_type: 0 },
      { ...q('d', true), layout_type: 1 },
    ]
    const doc = await generatePDF(qs, { mode: 'separate', noSave: true })
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBe(4)
    expect(imgs.find(c => c[1].endsWith('Qs'))[2]).toBe(10)
    expect(imgs.find(c => c[1].endsWith('Qd'))[2]).toBe(16)
    expect(imgs.find(c => c[1].endsWith('Ad'))[2]).toBe(16)
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('参考答案')
    expect(doc.pages).toBe(4)
  })
```

断言依据：mock dims 1000×400、tH=20 → 单栏 rw=190 rh=76 need=93；双栏 rw=81 rh=32.4 need=49.4。题目段：Qs 页1（yL 277→184）、Qd 组间翻页页2。答案段（topReserve 25，首页 yL=252）：As 页1、Ad 翻页页2。合计 2+2=4 页。旧 separate 全宽 → Qd x=15、Ad x=15 且不会 4 页，必红。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: 新测试 FAIL（`doc.pages` 现为 3 或断言 x 值不符），现有 7 条 PASS。

- [ ] **Step 3: 重构 `src/data/pdf.ts`**

3a. 在 `generateWithEngine` 之前新增两个共用函数：

```ts
async function buildEngineUnits(
  questions: Question[],
  kind: 'together' | 'questions' | 'answers',
  spcMm: number,
  lmMap?: Record<string, 'single' | 'double'>,
): Promise<LayoutImage[]> {
  const units: LayoutImage[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const lm = (lmMap && lmMap[q.id]) || (q.layout_type === 1 ? 'double' : 'single');
    if (kind !== 'answers' && q.question_image_url) {
      try {
        const dims = await _internals.loadImageDims(q.question_image_url);
        const tH = await _internals.estimateTH(q.question_image_url);
        units.push({ key: `q${i}`, src: q.question_image_url, w: dims.w, h: dims.h, tH, lm, label: `第 ${i + 1} 题`, labelH: 5, afterGap: spcMm });
      } catch (e) {
        console.warn('跳过无法读取的题目图片:', e);
      }
    }
    if (kind !== 'questions' && q.answer_image_url) {
      const isAnswerLabel = kind === 'together';
      try {
        const dims = await _internals.loadImageDims(q.answer_image_url);
        const tH = await _internals.estimateTH(q.answer_image_url);
        units.push({ key: `a${i}`, src: q.answer_image_url, w: dims.w, h: dims.h, tH, lm,
          label: isAnswerLabel ? '答案:' : `第 ${i + 1} 题`,
          labelH: isAnswerLabel ? 4 : 5,
          afterGap: isAnswerLabel ? 0 : spcMm });
      } catch (e) {
        console.warn('跳过无法读取的答案图片:', e);
      }
    }
  }
  return units;
}

async function renderEnginePages(
  doc: JsPDFInstance,
  cn: string,
  pages: LayoutPage[],
  pageOffset: number,
  totalPages: number,
  header?: string,
): Promise<void> {
  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0 || pageOffset > 0) doc.addPage();
    if (header) {
      drawCentered(doc, cn, header, M, 16);
    }
    doc.setFontSize(8);
    doc.setTextColor(180);
    doc.text(`— ${pageOffset + pi + 1}/${totalPages} —`, W / 2, H - 4, { align: 'center' });
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
```

注意 `header` 只在答案段首页绘制一次：把 header 绘制放循环内 `pi===0` 分支——修正：`if (header && pi === 0) { drawCentered(doc, cn, header, M, 16); }`（实现时用此版本）。

3b. `generateWithEngine` 改为调用共用函数（单元构建与渲染段替换，标题绘制与 truncated 告警保留原位）：

```ts
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

  const units = await buildEngineUnits(questions, 'together', spcMm, opts.lmMap);
  const { pages, truncated } = planLayout(units, { targetTextMM: opts.targetTextMM, topReserveMM: opts.title ? 35 : 0 });

  if (truncated) {
    console.warn('PDF 排版迭代上限，部分内容未排版');
    alert('部分题目未能完成排版，请减少单次导出数量');
  }

  await renderEnginePages(doc, cn, pages, 0, pages.length);
}
```

3c. 新增 separate 引擎实现（紧随 generateWithEngine 之后）：

```ts
async function generateWithEngineSeparate(
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

  const qUnits = await buildEngineUnits(questions, 'questions', spcMm, opts.lmMap);
  const aUnits = await buildEngineUnits(questions, 'answers', spcMm, opts.lmMap);
  const qPlan = planLayout(qUnits, { targetTextMM: opts.targetTextMM, topReserveMM: opts.title ? 35 : 0 });
  const aPlan = planLayout(aUnits, { targetTextMM: opts.targetTextMM, topReserveMM: 25 });

  if (qPlan.truncated || aPlan.truncated) {
    console.warn('PDF 排版迭代上限，部分内容未排版');
    alert('部分题目未能完成排版，请减少单次导出数量');
  }

  const total = qPlan.pages.length + aPlan.pages.length;
  await renderEnginePages(doc, cn, qPlan.pages, 0, total);
  await renderEnginePages(doc, cn, aPlan.pages, qPlan.pages.length, total, '参考答案');
}
```

3d. `generatePDF` 的 separate 分支改为：

```ts
  } else if (mode === 'separate') {
    await generateWithEngineSeparate(questions, doc, cn, {
      spacing, spacingCm, title,
      targetTextMM: options.targetTextMM ?? 4,
      lmMap: options.lmMap,
    });
  }
```

（原分支内的标题两行绘制删除——已移入 `generateWithEngineSeparate`。）

3e. 删除整个 `generateLegacySeparate` 函数（约 L228-250）。确认 import：`LayoutPage` 若未在用需从 `'../types'` import 列表补充（renderEnginePages 参数用到）。

- [ ] **Step 4: 绿灯 + 回归**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: 8/8 PASS（含既有 separate 测试「参考答案」文本断言仍成立）。
Run: `npm run typecheck && npm run test`
Expected: 0 错误；177 passed / 9 skipped。

---

### Task 2: 弹窗小字更新

**Files:**
- Modify: `src/index.html`（导出弹窗 separate 选项）

- [ ] **Step 1: 更新 mode-desc**

定位：

```html
                <div><div class="mode-label">📑 题目/答案分开</div><div class="mode-desc">前面全部是题目，后面全部是答案</div></div>
```

替换为：

```html
                <div><div class="mode-label">📑 题目/答案分开</div><div class="mode-desc">前面全部是题目，后面全部是答案；同样按"排版适用性"标注自动单双栏混排</div></div>
```

- [ ] **Step 2: 构建校验**

Run: `npm run build`
Expected: 通过。

---

### Task 3: CI 循环 + 浏览器验证

- [ ] **Step 1: 完整 CI 四步**

```bash
npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js
```

Expected: 全绿（21 E2E）。

- [ ] **Step 2: 浏览器验证（chrome-devtools / vite preview）**

`npx vite preview --port 4173` 后在页面执行（页面已有登录态数据；若无数据按既有中转流程重登）：

```js
async () => {
  const qs = (window.allQuestions || []).filter(q => q.layout_type === 1).slice(0, 3);
  if (!qs.length) return { error: 'no double-layout questions' };
  const doc = await window.generatePDF(qs, { mode: 'separate', noSave: true });
  return { count: qs.length, pages: doc.getNumberOfPages() };
}
```

Expected: `pages >= 2`（题目段+答案段至少分页），无异常抛出。

---

### Task 4: 文档更新 + 提交推送

- [ ] **Step 1: 更新 `docs/pdf-layout-engine-v5.md`**

行为变更小节中"导出弹窗布局方式已改为二选"一行补充：

```markdown
- separate（题目/答案分开）同样走引擎：题目段、答案段分别自动混排（答案段首页"参考答案"表头，页码全文连续）；题后留空在 separate 下也画虚线（与挨着模式统一）
```

- [ ] **Step 2: 提交并推送（先向用户确认范围）**

```bash
git add src/data/pdf.ts unit-tests/pdf-generate.spec.js src/index.html docs/pdf-layout-engine-v5.md docs/superpowers/plans/2026-09-01-pdf-separate-engine-mixed-layout.md
git commit -m "题目答案分开模式接入引擎自动混排 - separate按layout_type单双栏排版+弹窗说明更新"
git push origin f640/main2
```

---

## Self-Review 结论

1. **Spec 覆盖**：separate 自动混排（用户核心诉求）→ Task 1（题目段/答案段/表头/页码）；弹窗小字未体现自动 → Task 2；双栏标注在两种模式下都生效 → Task 1 测试断言 Qd/Ad x=16。
2. **占位符扫描**：无 TBD；重构函数给出完整代码。
3. **类型一致性**：`buildEngineUnits` 的 kind 三分支与两个调用点（'together' / 'questions'+'answers'）一致；`renderEnginePages(doc, cn, pages, pageOffset, totalPages, header?)` 与两处调用参数一致；`LayoutPage` import 补充已在 3e 提示；`aUnits` 的 afterGap=spcMm 与测试期望（mock spacing none → 0）一致。
