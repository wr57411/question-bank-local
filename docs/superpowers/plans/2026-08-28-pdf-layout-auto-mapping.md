# PDF 导出自动栏式映射（layout_type 快速映射 + 删除手动布局选项）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导出 PDF 时按题目已有标注 `layout_type` 自动判定单/双栏（0→单栏、1→双栏切割），引擎自动混排；导出弹窗删除"单栏排列/双栏排列"手动布局选项，仅保留"题目跟答案挨着"与"题目/答案分开"。

**Architecture:** 引擎侧一行映射：`lm = lmMap[q.id] || (q.layout_type === 1 ? 'double' : 'single')`，`lmMap` 保留为最高优先级扩展点；单栏组在前、双栏组（切半）在后、组间翻页的混排规则由 planLayout 已验证实现承担，本次仅接线。UI 侧将导出弹窗布局方式从三选（single/double/separate）改为二选（single 题目跟答案挨着 / separate 分开），`generatePDF` 的 `double` 分支保留但 UI 不可达（向后兼容，不删代码）。

**Tech Stack:** TypeScript + Vitest(jsdom) + 既有 planLayout 引擎（无引擎改动，仅调用侧映射）。

---

## 背景与关键事实（执行者必读）

1. **用户需求原话要点**：录题时已人工标注"排版适用性"（就是为了解决算法无法自动判定）；标注"单双栏均可"的题目**原本就是双栏版式**，应按双栏切割排版——整图放大成单栏会浪费 A4 纸。导出时不要手动指定布局，按标注自动混排；删除弹窗里的"单栏排列、双栏排列"选项。
2. **映射语义（用户已确认 + 真实数据验证）**：录题表单强制必填（radio `required`），实测全库 63 题 `layout_type` 分布：0（仅适合单栏）9 题、1（单双栏均可）54 题、**缺失/异常 0 题**——不存在未标注题目。`layout_type === 1` → 引擎 `lm='double'`（切半省纸）；`layout_type === 0` → `lm='single'`。表达式 `=== 1 ? 'double' : 'single'` 天然将一切非 1 值归 single（防御性，无需专门处理）。
3. **题目数据模型**：`Question.layout_type: number`（[src/types/question.ts#L6](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/types/question.ts#L6)），录题表单必填写入（0/1）。
4. **现状代码**：
   - [src/data/pdf.ts#L98](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/data/pdf.ts#L98)：`const lm = (opts.lmMap && opts.lmMap[q.id]) || 'single';` → 改这一行。
   - [src/index.html#L736-L746](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/index.html#L736) 导出弹窗"布局方式"区块：三个 `mode-option`（single selected / double / separate）。
   - [src/ui/export-pdf-ui.ts#L62,L112](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/ui/export-pdf-ui.ts)：`mode: w.exportMode`——`w.exportMode` 仅在用户点击选项后才有值，直连导出时为 `undefined`（现靠 generatePDF 默认 single 兜底），UI 改版后需显式兜底 `'single'`。
   - 试卷导出 `generatePaperPDF`（db.js）与专题导出（[topic-manage.ts#L101](file:///Users/john/.codex/worktrees/f640/question-bank-local/src/ui/topic-manage.ts#L101)）均为 `mode:'merged'` → 走引擎 → 自动获得混排，无需改动。
5. **E2E 安全**：tests/ 下无任何对"单栏排列/双栏排列/`selectExportMode`"的断言（已 grep 验证），删选项不破坏现有 E2E。
6. **引擎混排规则**（planLayout 已实现并验证，勿改）：单栏组在前保持顺序 → 双栏组在后保持顺序 → 组间强制翻页 → 同页不混排 → 双栏图切半可左切右续。几何常量：单栏图 `x = MG = 10`，双栏图（左栏）`x = MG + CPAD = 16`。
7. **项目规范**：不加注释；TypeScript；CI 循环 `npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js`；git 提交需用户确认（本计划与已完成的 v5 集成变更统一提交，最后询问用户）。
8. **测试环境**：vitest jsdom；`unit-tests/pdf-generate.spec.js` 已有 FakeDoc + `_internals` 注入基建，新测试直接追加该文件。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/data/pdf.ts` | generateWithEngine 的 lm 判定改为 layout_type 映射 | 修改（1 行） |
| `unit-tests/pdf-generate.spec.js` | 追加映射与混排测试 | 修改（追加） |
| `src/index.html` | 导出弹窗布局方式区块改为二选 | 修改 |
| `src/ui/export-pdf-ui.ts` | mode 兜底 `'single'` | 修改（2 处） |
| `docs/pdf-layout-engine-v5.md` | 栏式判定章节更新为"已接线" | 修改 |
| `AGENTS.md` | 无需新条目（更新既有 pdf-layout-engine-v5.md 内容） | 不动 |

---

### Task 1: 引擎映射 layout_type（TDD）

**Files:**
- Modify: `src/data/pdf.ts:98`
- Test: `unit-tests/pdf-generate.spec.js`（追加）

- [ ] **Step 1: 追加失败测试（追加到 `describe('generatePDF')` 末尾，不动现有 6 条）**

```js
  it('layout_type 快速映射：0→单栏组、1→双栏组，混合自动混排组间翻页', async () => {
    const qs = [
      { ...q('s1', false), layout_type: 0 },
      { ...q('s2', false), layout_type: 0 },
      { ...q('d1', false), layout_type: 1 },
    ]
    const doc = await generatePDF(qs, { mode: 'single', noSave: true })
    expect(doc.pages).toBe(2)
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    const d1 = imgs.find(c => c[1].endsWith('Qd1'))
    expect(d1).toBeTruthy()
    expect(d1[2]).toBe(16)
    const s1 = imgs.find(c => c[1].endsWith('Qs1'))
    expect(s1[2]).toBe(10)
  })
```

说明（断言依据）：无 title 时首页 `yL=277`；s1/s2 各 `need=76+5+12=93` → 首页剩余 91；d1（double）触发组间翻页 → 新页双栏左栏 `x = MG+CPAD = 16`；单栏图 `x = MG = 10`。双栏时 `normScale` 仍为 1（mock tH 全 20，clamp 上限 1），d1 图宽 81mm 但 x 断言已足以区分映射。实测全库无非 0/1 值，无需专门防御测试。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: FAIL（现状全 single → `doc.pages` 为 1、d1 x=10）。

- [ ] **Step 3: 实现映射（`src/data/pdf.ts` L98）**

将：

```ts
    const lm = (opts.lmMap && opts.lmMap[q.id]) || 'single';
```

替换为：

```ts
    const lm = (opts.lmMap && opts.lmMap[q.id]) || (q.layout_type === 1 ? 'double' : 'single');
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `npx vitest run unit-tests/pdf-generate.spec.js`
Expected: 7/7 PASS（6 条现有 + 1 条新增映射测试）。
Run: `npm run test`
Expected: 全部通过（基线 163+2=165 passed / 9 skipped）。
Run: `npm run typecheck`
Expected: 0 错误。

---

### Task 2: 导出弹窗删除手动布局选项

**Files:**
- Modify: `src/index.html`（导出弹窗布局区块）
- Modify: `src/ui/export-pdf-ui.ts`（mode 兜底）

- [ ] **Step 1: 替换 index.html 导出弹窗布局方式区块**

定位 `src/index.html` 导出弹窗（约 L735-746）三个 `mode-option`（single/double/separate），替换为两个：

```html
        <div style="margin-bottom:var(--space-md)">
            <label style="font-weight:600;font-size:14px;margin-bottom:8px;display:block;color:var(--text)">布局方式</label>
            <div class="mode-option selected" onclick="selectExportMode(this,'single')">
                <div><div class="mode-label">📄 单栏排列</div><div class="mode-desc">每道题全宽显示，题后紧跟答案</div></div>
            </div>
            <div class="mode-option" onclick="selectExportMode(this,'double')">
                <div><div class="mode-label">📋 双栏排列</div><div class="mode-desc">左右各一题，紧凑排列</div></div>
            </div>
            <div class="mode-option" onclick="selectExportMode(this,'separate')">
                <div><div class="mode-label">📑 题目/答案分开</div><div class="mode-desc">前面全部是题目，后面全部是答案</div></div>
            </div>
        </div>
```

替换为：

```html
        <div style="margin-bottom:var(--space-md)">
            <label style="font-weight:600;font-size:14px;margin-bottom:8px;display:block;color:var(--text)">布局方式</label>
            <div class="mode-option selected" onclick="selectExportMode(this,'single')">
                <div><div class="mode-label">📄 题目跟答案挨着</div><div class="mode-desc">按题目“排版适用性”标注自动单双栏混排，题后紧跟答案</div></div>
            </div>
            <div class="mode-option" onclick="selectExportMode(this,'separate')">
                <div><div class="mode-label">📑 题目/答案分开</div><div class="mode-desc">前面全部是题目，后面全部是答案</div></div>
            </div>
        </div>
```

- [ ] **Step 2: export-pdf-ui.ts mode 兜底（2 处）**

`src/ui/export-pdf-ui.ts` L62（previewExportPDF）：

```ts
  const doc = await w.generatePDF(qs, { mode: w.exportMode, spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName(), noSave: true });
```

替换为：

```ts
  const doc = await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName(), noSave: true });
```

L112（doExportPDF）：

```ts
  await w.generatePDF(qs, { mode: w.exportMode, spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName() });
```

替换为：

```ts
  await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName() });
```

`selectExportMode` 函数本身不变（'single'/'separate' 值仍由 HTML 传入；'double' 不再从 UI 出现）。

- [ ] **Step 3: 类型检查 + 构建 + E2E 回归**

Run: `npm run typecheck && npm run build`
Expected: 无错误。
Run: `npx playwright test tests/ui-health.spec.js`
Expected: 21 passed（已验证无布局选项文本依赖）。

---

### Task 3: 浏览器冒烟（混合标注自动混排）

- [ ] **Step 1: dev server + browser-use 验证**

```bash
npm run dev
```

browser-use 打开 `http://localhost:3000/`，`evaluate_script` 执行：

```js
async () => {
  await new Promise(r => setTimeout(r, 2000));
  const isTs = window.generatePDF.toString().includes('WithEngine');
  function makeImg(w, h, ts, label) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#333'; ctx.font = 'bold ' + ts + 'px sans-serif';
    ctx.fillText('【' + label + '】混排冒烟', 14, ts * 1.8);
    let y = ts * 3.2;
    ctx.font = ts + 'px sans-serif';
    for (let i = 0; i < 6; i++) { ctx.fillText('1. 测试行 ' + i, 18, y); y += ts * 1.8; }
    return c.toDataURL('image/jpeg', 0.9);
  }
  const qs = [
    { id: 'a', layout_type: 0, question_image_url: makeImg(1000, 500, 22, '单A'), answer_image_url: null },
    { id: 'b', layout_type: 0, question_image_url: makeImg(1000, 500, 22, '单B'), answer_image_url: null },
    { id: 'c', layout_type: 1, question_image_url: makeImg(1000, 500, 22, '双C'), answer_image_url: null },
  ];
  const doc = await window.generatePDF(qs, { mode: 'single', title: '混排冒烟', noSave: true });
  return { isTs, pages: doc ? doc.getNumberOfPages() : 0 };
}
```

Expected: `{ isTs: true, pages: 2 }`（单栏组页 1、双栏组页 2，组间翻页）。
另做 UI 冒烟：题目列表勾选题目 → 打开导出弹窗 → 确认布局方式只剩"题目跟答案挨着/题目答案分开"两项、默认选中挨着 → 点预览不报错。

- [ ] **Step 2: 重跑完整 CI 循环（任何失败先修再重跑）**

```bash
npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js
```

---

### Task 4: 文档更新 + 统一提交

**Files:**
- Modify: `docs/pdf-layout-engine-v5.md`

- [ ] **Step 1: 更新文档栏式判定章节**

将 `docs/pdf-layout-engine-v5.md` 中"栏式判定"相关表述（`lmMap 扩展点：options.lmMap[questionId] 指定 'single'|'double'（双栏自动判定待 OCR 接入，见原型路线图 v4.2）` 及"已知限制"中"双栏自动判定未接入（默认全 single）"）替换为：

```markdown
## 栏式判定（已接线：layout_type 快速映射）

- `lm = lmMap[q.id] || (q.layout_type === 1 ? 'double' : 'single')`
- `layout_type === 1`（录题标注"单双栏均可"，即双栏版式扫描件）→ 引擎双栏路径（切半排版，避免整图放大浪费 A4）
- `layout_type === 0`（仅适合单栏，全库 9 题）→ 单栏；`=== 1`（单双栏均可，全库 54 题）→ 双栏；无缺失值（实测 0 题）
- `lmMap` 保留为调用方最高优先级扩展点
- 导出弹窗布局方式已改为二选：「题目跟答案挨着」（single，引擎混排，题后紧跟答案）与「题目/答案分开」（separate）；`mode:'double'` 分支保留但 UI 不可达
- OCR 自动判定（原型路线图 v4.2）仍为可选增强，当前以人工标注为准
```

- [ ] **Step 2: 统一提交（先询问用户）**

本计划变更 + 之前已完成的 v5 集成变更（尚未提交）统一处理。向用户展示 `git status`，确认后：

```bash
git add src/types/pdf.ts src/types/index.ts src/data/pdf-layout-engine.ts src/data/pdf-image.ts src/data/pdf-font.ts src/data/pdf.ts src/main.ts src/index.html src/ui/export-pdf-ui.ts unit-tests/pdf-layout-engine.spec.js unit-tests/pdf-image.spec.js unit-tests/pdf-generate.spec.js docs/pdf-layout-engine-v5.md docs/superpowers/plans/ AGENTS.md
git commit -m "PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页"
```

不含无关改动：`ocr-server/ocr_core.py`。
提交后询问是否需要 `ship-feature` 打包 APK。

---

## Self-Review 结论

1. **Spec 覆盖**：快速映射（layout_type 0/1）→ Task 1；删弹窗单栏/双栏选项、自动混排为主路径 → Task 2；自动混排验证 → Task 1 测试 + Task 3 冒烟；文档 → Task 4。OCR 路线明确不做（用户已选快速映射）。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
3. **类型一致性**：`q.layout_type` 为 `Question` 必填 `number`（实测全库无非 0/1 值，`=== 1 ? 'double' : 'single'` 表达式天然将一切非 1 值归 single，无需额外分支）；`lmMap` 类型 `Record<string, LayoutMode>` 与映射结果一致；测试断言 x=16/10 与引擎常量 MG=10/CPAD=6 一致。
4. **风险确认**：现有 6 条 generatePDF 测试的 `q()` helper 无 `layout_type` 字段 → `undefined === 1` 为 false，走 single 分支，行为不变；ui-health 无布局选项断言，删除安全。
