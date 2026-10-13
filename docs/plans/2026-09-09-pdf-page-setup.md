# PDF 页面设置可配置（页边距 + 标题区）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 PDF 导出的页边距（上/下/左右）与标题区（标题/副标题显隐）从硬编码变成用户在导出弹窗里可调的参数，并把默认版式紧凑化——纸顶到第一道题从现在的 ~50mm 压到 ~23mm。

**Architecture:** 三层改动。(1) 排版引擎支持独立边距 `marginTopMM/marginBottomMM/marginSideMM`（向后兼容现有 `marginMM`）；(2) 新建 `pdf-page-setup.ts` 纯函数模块管理页面设置的默认值/clamp/持久化，`deriveTopReserveMM` 重写标题区预留公式（消除 10mm slack 与 pad 双算）；(3) 导出弹窗加「页面设置」折叠区，localStorage 持久化。

**Tech Stack:** TypeScript、jsPDF（mm 坐标系）、vitest、Playwright

**提交约定：** 全部改完等王先生检查统一 commit，过程中不 commit。

---

## 0. 背景与空间账单（实测自当前代码，10.5pt 默认 + 标题开）

`derivePrintMetrics` 现行 topReserve 公式（`src/data/pdf-print-size.ts:82-84`）：

```
topReserve = 15(M) + titleTop 4.63 + subTitleGap 7.41 + descent 0.72
             − 10(MG) + 6(pad) + 10(SLACK) = 33.76mm
```

引擎首格 y = `marginBottom + topReserve + pad` = 10 + 33.76 + 6 = **49.76mm**（纸顶起算）。

| 组成 | mm | 性质 |
|---|---|---|
| 上页边距 MG | 10 | 合理 |
| 标题两行字（含行距） | ~13 | 内容 |
| TITLE_SLACK_MM | 10 | **纯保险空隙，无意义** |
| pad 在 M→MG 换算与首格 y 中重复计入 | 6 | **双算** |
| M=15 与 MG=10 两套边距的差 | 5 | **两套边距打架** |
| 其余余量 | ~5 | 冗余 |

**52mm 里只有 23mm 是真实内容，29mm 是公式病。** 页面高度浪费 18%。

用户诉求（原话）：标题不需要占这么多空间；上面的页边距干嘛占这么多位置；希望像 WPS 一样这些都可以调整。

## 0.1 现状代码锚点

| 位置 | 内容 |
|---|---|
| `src/data/pdf.ts:6` 附近 | `const W = 210, H = 297, M = 15`（pdf.ts 自己的页边距，只用于标题定位与 legacy double） |
| `src/data/pdf.ts:170-171, 194-195` | 标题/副标题基线 = `M + titleTopMM`、`M + titleTopMM + subTitleYOffset` |
| `src/data/pdf.ts:175, 200` | `topReserveMM: opts.title ? opts.metrics.topReserveMM : 0` |
| `src/data/pdf.ts:201` | aPlan 用 `topReserveMM * (25/35)`（答案段页眉较小） |
| `src/data/pdf-layout-engine.ts:14-20` | `MG = opts.marginMM ?? 10`；`uws = AW − 2*MG`；`uh = AH − 2*MG`；`MIN_SPLIT` |
| `src/data/pdf-layout-engine.ts`（多处） | x 坐标用 `MG`（单栏/双栏左）与 `AW/2 + CGAP/2`（双栏右）；y 用 `AH − MG − yL + pad` |
| `src/data/pdf.ts`（renderEnginePages 内） | 页码 `doc.text(…, H − 4)` 固定 |
| `src/data/pdf-print-size.ts:36-38` | `PDF_MARGIN_MM=15 / ENGINE_MARGIN_MM=10 / TITLE_SLACK_MM=10` |

---

## 1. 方案

### 1.1 页边距（3 个输入：上 / 下 / 左右）

- 左右合并为**一个**输入。理由：双栏版面物理上左右对称（栏宽由总宽推出），独立左右会破坏对称且需重写全部 x 公式，收益仅剩"装订线偏移"场景——列为将来可扩展，本期 YAGNI。
- 范围 0–30mm，step 1，默认 **10 / 10 / 10**（= 现状，行为不惊变）。
- 引擎 `PlanLayoutOptions` 新增 `marginTopMM / marginBottomMM / marginSideMM`，缺省回落 `marginMM ?? 10`（现有 12 条引擎单测与所有既有调用零改动）。
  - `uws = AW − 2×side`；`uh = AH − top − bottom`
  - y 公式 `AH − MG − yL + pad` → `AH − bottom − yL + pad`
  - x：单栏/双栏左 `side`；双栏右 `AW − side − uwd`（side=10 时 = 107，与现状 `AW/2+CGAP/2` 数值相同——对称下两式等价，已验算）
- pdf.ts 把 pageSetup 的三值传给引擎（single/merged/separate 全部调用点）。
- 页码 y 从固定 `H − 4` 改为 `H − max(4, marginBottom − 3)`（下边距 10 时 = H−7，比现状 H−4 上移 3mm，仍在边距带内；marginBottom=0 时页码不会被内容压住）。

### 1.2 标题区紧凑化 + 显隐

- 两个开关：**显示标题**（默认开）、**显示"共 N 题"副标题**（默认开，标题关时禁用）。关标题 = 标题+副标题都不画、topReserve 归零，内容直接从上边距开始。
- 标题基线从 `M(15)` 改挂 `marginTopMM`——消灭两套边距打架。
- `deriveTopReserveMM(setup, metrics)` 新公式取代 metrics.topReserveMM：

```
titleBlockBottom = 0                                          （无标题）
               = marginTop + titleTop + titleMM×1.0           （仅标题）
               + (showCount ? subTitleMM×1.2 : 0)             （+副标题）
topReserve = max(0, titleBlockBottom − marginBottom)          （无标题时 = 0；对称边距下无标题=0 与现状一致）
```

- **效果验算**（margin 全 10，10.5pt，标题+副标题开）：
  - 标题基线 = 10+4.63 = 14.63；字形底 = 14.63+1.18 = 15.81
  - 副标题基线 = 14.63+7.41 = 22.04；块底 = 22.04+0.72 = 22.76
  - topReserve = 22.76−10 = 12.76 → 首格顶 = 10+12.76+6 = **28.76mm**（现状 49.76，**省 21mm ≈ 7.6% 页高**）
  - 标题关：首格顶 = 10+0+6 = **16mm**（省 34mm ≈ 12% 页高）
  - 多页导出每页都省同样的量
- `TITLE_SLACK_MM`、`PDF_MARGIN_MM`、`ENGINE_MARGIN_MM` 三个常量随之删除（公式不再需要）。
- `metrics.topReserveMM` 字段从 `PrintMetrics` 移除（它的职责移交给 `deriveTopReserveMM`）。

### 1.3 UI

导出弹窗「打印字号」之后加 `<details>` 折叠区（默认收起，弹窗已经很高）：

```
▸ 页面设置
    上边距 [10] mm   下边距 [10] mm   左右边距 [10] mm
    ☑ 显示标题     ☑ 显示"共 N 题"（标题关闭时禁用）
```

- 持久化 localStorage `pdfPageSetup`（JSON），沿用 `loadStemPt/saveStemPt` 的密钥模式
- 修改立即保存；导出/预览时读取生效

### 1.4 不做（non-goals）

- 纸张尺寸/横向（WPS 还有这些，但本期只解决"占地方"，横向是另一个排版问题）
- 独立左/右边距（破坏双栏对称，装订线场景收益低）
- 标题独立字号（跟随打印字号的 1.59 倍已够，用户要的是空间不是字号）
- 页眉/页脚自定义、页码格式
- 副标题下那个孤立小点：照片上位于两栏之间居中处，代码里没有任何居中绘制调用能产生它，**大概率是纸面污点或照片噪点**——实施时先比对同参数二次导出，若仍出现再立案排查，不在本计划内修

## 2. 任务分解（TDD，每任务先失败测试后实现）

### Task 1：引擎独立边距
- Modify: `src/data/pdf-layout-engine.ts`（PlanLayoutOptions 解构与 uh/x/y 公式）
- Modify: `src/types/pdf.ts`（PlanLayoutOptions 加 3 个可选字段）
- Test: `unit-tests/pdf-layout-engine.spec.js` 新增：marginTop≠bottom 时首格 y 变化；side=15 时栏宽=90 且 x=15；缺省时行为与 marginMM 完全一致（回归锁定）
- 验证：`NODE_OPTIONS= npx vitest run unit-tests/pdf-layout-engine.spec.js`（现有 24 条必须全绿）

### Task 2：pdf-page-setup 模块
- Create: `src/data/pdf-page-setup.ts`；Modify: `src/types/pdf.ts`（PageSetup 类型）、`src/data/index.ts`
- Test: `unit-tests/pdf-page-setup.spec.js`（新建）：默认值、字段级 clamp（margin 0–30、布尔归一）、坏 JSON 容错、load/save 往返
- 接口：`DEFAULT_PAGE_SETUP` / `loadPageSetup()` / `savePageSetup(s)` / `clampPageSetup(s)`

### Task 3：deriveTopReserveMM 紧凑公式
- Modify: `src/data/pdf-print-size.ts`（新增 `deriveTopReserveMM(setup, metrics)`；删 `TITLE_SLACK_MM/PDF_MARGIN_MM/ENGINE_MARGIN_MM`；derivePrintMetrics 删 topReserveMM 字段）；Modify: `src/types/pdf.ts`
- Test: `unit-tests/pdf-print-size.spec.js`：无标题=0；标题+副标题在 margin 10/10/10、10.5pt 下 = 12.76（±0.01）；标题关副标题开 → 0 且副标题强制不画（由 pdf.ts 层保证）；单测锁定"省 21mm"这个数
- 注意：`pdf-print-size.spec.js` 现有 topReserve 两条断言（38mm/34.776）**删除**（字段已移除，语义移交新函数）

### Task 4：pdf.ts 接线
- Modify: `src/data/pdf.ts`：generatePDF 读 `loadPageSetup()`；标题/副标题基线挂 `setup.marginTopMM`；`topReserveMM` 传 `deriveTopReserveMM(...)`（separate 的 aPlan 仍用页眉较小系数，比例逻辑保留）；`planLayout` 传三个边距；页码 y 改 `H − max(4, setup.marginBottomMM − 3)`
- Test: `unit-tests/pdf-generate.spec.js` 追加：margin 上 20 → 首格 addImage y 变大；showTitle=false → 无标题文本且首格 y ≈ marginBottom+pad；页码 y 随下边距变化
- 风险点：现有用例断言的首格 y（如 `d1[2]===10`）不受影响（x 不变）；涉及 y 的断言需逐条核对

### Task 5：UI 页面设置区
- Modify: `src/index.html`（打印字号后加 details 折叠区）、`src/ui/export-pdf-ui.ts`（renderPageSetup/selectPageSetup handler/持久化）、`src/main.ts`（挂载）
- 复用 `.print-size-option` 的 CSS 思路：输入框内联样式对齐弹窗既有风格
- Test: 走 Task 6 的 E2E（纯 DOM 逻辑不强求单测）

### Task 6：E2E
- Create: `tests/pdf-page-setup.spec.js`（3 条）：折叠区展开后控件可见（`assertVisiblyRendered` + 截图 + 手机视口 390 不撑坏）；改边距 → localStorage 持久化 → 重开弹窗恢复；关标题开关 → 导出预览的 doc 无标题文本（用 `page.evaluate` 调 `generatePDF` 断言，或仅断言开关状态持久化——以实现成本定，报告说明）
- 运行：`E2E_SCREENSHOT_DIR=tmp/test-results-page-setup/screenshots NODE_OPTIONS= npx playwright test tests/pdf-page-setup.spec.js --reporter=list --output=tmp/test-results-page-setup`
- **截图必须实际 Read 确认**（AGENTS.md 强制）

### Task 7：CI 全量 + 复现性演练 + 文档
- `npm run typecheck` → `NODE_OPTIONS= npm run test` → `npm run build` → 全量 E2E（后台）
- 演练（每项临时改坏 → 测试须失败 → 还原）：
  a. 引擎 marginSide 不生效（x 仍用旧值）→ Task 1 新用例挂
  b. topReserve 恢复旧公式 → Task 3 的 12.76 断言挂
  c. UI 开关不持久化 → E2E 挂
- 文档：`docs/pdf-page-setup.md` + AGENTS.md 索引追加

## 3. 风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 边距改小后 MIN_SPLIT/切割行为变化（uh 变大→更少切割） | 引擎单测回归锁定；MIN_SPLIT 只跟字号走，与边距无关 |
| 2 | 双栏右栏 x 公式改写（AW−side−uwd）在对称下应与旧值全等 | Task 1 单测断言 side=10 时 x=107 与现状逐位相同 |
| 3 | aPlan 的 `×(25/35)` 系数在新公式下语义漂移 | 新公式下改为显式计算答案页页眉块高度，删魔法比例 |
| 4 | 默认值不惊变：默认 10/10/10 + 标题开，但紧凑化本身改变了版面（首格 49.8→28.8） | 这是本计划的**目的**（用户明确抱怨），在计划里显式声明而非隐瞒 |
| 5 | 弹窗高度再增 | details 默认收起；E2E 手机视口用例锁定 |

## 4. 待王先生确认

1. **默认边距**：上/下/左右 = 10/10/10（=现状，仅紧凑化生效）？还是直接给更激进的 8？
2. **标题默认**：显示（紧凑化后只占 ~13mm）还是默认隐藏（每次手动开）？我推荐**显示**——标题有辨识价值，紧凑化后已不碍事。
3. 左右合并为一个输入，接受吗？（独立左右=装订线场景，本期不做）
