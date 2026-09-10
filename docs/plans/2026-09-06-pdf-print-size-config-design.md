# PDF 打印字号用户可配置（机制 A：绝对目标替换中位数归一化）

> **已被取代** —— 本文基于「照片有白边」的假设，提出了机制 B（横向去白边）。
> 王先生确认题目来源是**搜题 App 截图、无白边**，B 的前提不成立，已撤销。
> 且本文未包含「双栏栏宽 81mm 吃掉 23% 纸张」这个真正的元凶。
> 现行方案见：`docs/plans/2026-09-06-pdf-print-size-and-column-width.md`

日期：2026-09-06
状态：**已废弃**，保留作决策过程记录

---

## 0. 背景：原方案前提被实测推翻

原需求是「把打印字号从固定逻辑解耦，交给用户配置」。最初认定的解耦对象是
`targetTextMM`。**实测证明它是死参数，改它不改变任何输出。**

### 0.1 实测证据

探针：`tmp/probe/probe.mts`（node `--experimental-strip-types` 直跑真实模块）。

同一批图（`tH/w = [0.01, 0.02, 0.02, 0.02, 0.04]`，全部 single），
`targetTextMM` 取 **2 / 4 / 8**，输出的每个 cell 的 `[w, h]` **完全相同**：

```
>>> [w,h] 在 tgt=2 vs 4 完全相同? true
>>> [w,h] 在 tgt=4 vs 8 完全相同? true
```

### 0.2 原因

`pdf-layout-engine.ts:23-32`：

```
raw_i  = tgt / ((tH_i / w_i) * uw)
baseline = median(raw_i)
norm_i = clamp(raw_i / baseline, 0.35, 1)
rw_i   = uw * norm_i
```

`tgt` 在 `raw_i` 与 `baseline` 中同为一阶因子，**被约掉**，`norm_i` 与 `tgt` 无关。

### 0.3 真正决定打印字号的量

```
打印文字高度 = (tH_i / w_i) * 栏宽
```

即「照片里一行字相对照片有多宽」这个**纯几何量**，与任何配置参数无关。

### 0.4 现状的真实缺陷

同批图实测纸面文字高度：

| 图 | tH/w | 印出文字高度 | 说明 |
|---|---|---|---|
| s0 | 0.01 | **1.9mm** | 字小，且永远不会被放大 |
| s1–s3 | 0.02 | 3.8mm | 集合中位数 |
| s4 | 0.04 | 3.8mm | 被缩到 95mm 宽 |

`s0` 只有别人的一半大。根因是 `Math.min(1, ...)` 只允许缩小、不允许放大，
且参考点（中位数）随题目集合漂移。**这就是「打印出来大小不一」的来源。**

---

## 1. 功能目标

1. 题干打印字号成为**用户在 App 内可配置**的参数，单一旋钮。
2. 以题干字号为基准，题号 / 答案 / 标题 / 页码按内置固定比例系数跟随。
3. 参考点从「这批题的中位数」改为「用户设定的绝对值」，使打印字号**稳定不漂移**。
4. 导出弹窗回显实测结果，让「有多少题卡在纸宽上限」可见。

---

## 2. 核心机制

### 2.1 缩放公式

```
rw_i = clamp( w_i * stemMM / tH_i ,  0.35 * uw ,  uw )
```

- `uw` 单栏 190mm / 双栏 89mm（由 `marginMM`、`CGAP`、`CPAD` 推出，不变）
- 下限 `0.35 * uw` **必须保留**：防 `estimateTH` 估错导致图形被缩成蚂蚁。
  语义从「防过度缩小」变为「防错误估计」。
- 上限 `uw` 是物理天花板（纸宽）。

`stemMM = undefined` 时走现有中位数逻辑，**行为与现状完全一致**（见 2.4）。

### 2.2 stemMM 的语义

**题干印在纸上的目标字形高度（mm）**，即「题干字号的最大值，且尽量达到」。

- 调大 `stemMM` → `rw` 跟着涨，直到撞上 `uw` 天花板为止 → **设置真实生效**
- 撞上天花板的题（整页拍、留白多的照片）调大无效 —— 这是物理约束，回显会报告数量

### 2.3 单位与挡位

内部一律存 mm；UI 用标准中文字号挡位。

| 挡位 | pt | mm |
|---|---|---|
| 自动 | — | 走现状中位数逻辑 |
| 小五 | 9 | 3.175 |
| 五号 | 10.5 | 3.704 |
| 小四 | 12 | 4.234 |
| 四号 | 14 | 4.939 |
| 三号 | 16 | 5.645 |

换算 `mm = pt * 0.3528`。

**pt 标注的依据**：`estimateTHFromPixels` 取暗像素占比 > 5% 的**连续行段**中位高度，
行距会打断行段，所以 `tH` 测的是**字形高度（em box）**而非行框高度，
`mm / 0.3528` 折算成 pt 成立。现有默认 4mm ≈ 11.3pt ≈ 五号，
与代码里题号 11pt 自洽。

**已知不确定性**：`tH` 从照片估算，绝对 pt 值有误差（估计 ±10%，**未实测**）。
挡位间距约 15%，大于误差，标称值不会被击穿。**相对调节效果是精确的**。

### 2.4 默认挡位（待确认）

推荐 **`自动`**，理由：与现状行为等价（见下表），零回归风险。

| 情形 | 现状 | stemMM = 中位数 |
|---|---|---|
| `natural_i > median` | 缩到 median | 缩到 median（**相同**） |
| `natural_i < median` | 保持满栏宽 | 保持满栏宽（**相同**） |
| `natural_i > 2.86 * median` | 保底 0.35，印得比 median 略大 | 缩到 median（差 <2%） |

备选：**默认小四 12pt** —— 多数人立刻受益（密集题约 +11%），
但留白少的批次（natural 7.6mm 那类）会被显著缩小（7.6 → 4.23mm）。

### 2.5 比例系数表（内置，不开放给用户）

由现状常量反推（`stemMM = 4mm` 时的比值）：

| 元素 | 现状 | ÷4mm | 采用系数 |
|---|---|---|---|
| 题干（图） | 4mm | 1.000 | 1.00 |
| 题号 `第 N 题` | 11pt | 0.970 | 0.97 |
| `答案:` | 9pt | 0.794 | 0.79 |
| 主标题 | 18pt | 1.588 | 1.59 |
| 副标题 `共 N 题` | 11pt | 0.970 | 0.97 |
| `参考答案` 页眉 | 16pt | 1.411 | 1.41 |
| 页码 | 8pt | 0.706 | 0.71 |

派生几何量（校验列 = 代入现状 4mm 的结果 vs 现状常量）：

| 量 | 现状 | 公式 | 校验 |
|---|---|---|---|
| 题号 labelH | 5mm | `numLabelMM * 1.29` | 5.01 ✓ |
| 答案 labelH | 4mm | `ansLabelMM * 1.26` | 4.00 ✓ |
| CPAD 单元格内边距 | 6mm | `stemMM * 1.5` | 6.00 ✓ |
| MIN_SPLIT 最小切割高 | 25mm | `stemMM * 6.25` | 25.00 ✓ |
| 标题 y | `M+5` | `M + stemMM*1.25` | 20 ✓ |
| 副标题 y | `M+13` | `y1 + stemMM*2.0` | 28 ✓ |
| topReserve（有标题） | 35mm | `y2 + subMM*0.2 + CPAD` | 34.78 ✓ |

**不随字号变化**（版面常量，非文字属性）：`MG = 10`（页边距）、`CGAP = 4`（栏间隙）、
页码 y（`H - 4`，在 10mm 底边距内始终够用）。

---

## 3. 影响模块与变更清单

| 文件 | 类型 | 变更 |
|---|---|---|
| `src/data/pdf-print-size.ts` | **新建** | 纯函数模块：pt↔mm、挡位表、比例系数表、`derivePrintMetrics(stemMM)`、localStorage 读写。无 DOM，可单测 |
| `src/types/pdf.ts` | 修改 | `PlanLayoutOptions` 增 `stemMM?` / `cellPadMM?` / `minSplitMM?`；`PDFGenerateOptions` 增 `stemMM?`；新增 `PrintMetrics` 类型 |
| `src/data/pdf-layout-engine.ts` | 修改 | `CPAD`/`MIN_SPLIT` 改为 options 传入（默认 6/25，向后兼容）；新增 stemMM 分支 |
| `src/data/pdf.ts` | 修改 | 读取 stemMM；用 `derivePrintMetrics` 替换全部硬编码字号、`labelH`、标题位置、`topReserveMM` |
| `src/ui/export-pdf-ui.ts` | 修改 | 挡位选择 / localStorage 持久化 / 抽样测量回显；`previewExportPDF`、`doExportPDF` 传 `stemMM` |
| `src/index.html` | 修改 | 导出弹窗加「打印字号」挡位组 + 回显行 |
| `src/main.ts` | 修改 | Batch 4 区挂载新函数 |
| `src/data/index.ts` | 修改 | 导出新模块 |

### 3.1 回显规格

弹窗打开时**抽样最多 8 张题图**（大批量导出时避免卡 UI），跑 `estimateTH` +
`loadImageDims`，对每张算：

```
natural_i = (tH_i / w_i) * 190
printed_i = clamp(natural_i, 0.35 * 190 * (tH_i/w_i), stemMM)   // 换算为 pt 显示
```

显示内容：

- `实测题干 ≈ X pt`（printed 的中位数）
- `N 题受纸宽上限，印不到目标值`（`natural_i < stemMM` 的题数）
- 测量中显示占位文案，异步完成后替换

### 3.2 持久化

localStorage key `printStemPt`，值 `'auto' | '9' | '10.5' | '12' | '14' | '16'`。
沿用 `paper-manage.ts:85-86` 的 `getX()` / `setX()` 成对模式。
导出弹窗打开时恢复上次选择。

---

## 4. 不涉及边界（non-goals）

- **不做横向去白边**（机制 B）。因此留白多的题仍印不大 —— 回显会诚实报告受限题数。
- **不动 `mode: 'double'`**（`generateLegacyDouble`）。UI 已无入口，且其不走 `targetTextMM`。
- **不云端同步**该配置（不进 `/api/sync/settings` payload）。仅本机 localStorage。
- **不改 `estimateTH` 算法**，只做测量与标定提示。
- **不改图片裁剪/压缩逻辑**（`cropImage` 的纵向切割行为保持不变）。

---

## 5. 风险与失效边界

| # | 风险 | 缓解 |
|---|---|---|
| 1 | `unit-tests/pdf-layout-engine.spec.js:53` 断言的正是中位数归一化语义，切换后比值从 0.35 变 0.21 | 该用例在 `stemMM === undefined` 路径下**保留原样**；新语义另写用例。两条路径并存 |
| 2 | 默认挡位选 12pt 会让留白少的批次显著缩小 | 推荐默认 `auto`（等价现状）；若选 12pt 需接受此变更 |
| 3 | `tH` 估错导致图形缩到极小 | 保留下限 `0.35 * uw` |
| 4 | pt 绝对映射未标定（±10% 估计误差，未实测） | 挡位间距 15% > 误差；回显提供验证手段；若标定后偏差大，**只改挡位标签文案，不动逻辑** |
| 5 | 导出弹窗变高，小屏溢出 | E2E 截图 + `assertVisiblyRendered` 验证（AGENTS.md 强制项） |
| 6 | **本 worktree 无 `node_modules`**，`npm run typecheck/test/build` 跑不起来 | 需先解决，见第 7 节 |

---

## 6. 测试计划

- **新建** `unit-tests/pdf-print-size.spec.js`：pt↔mm 换算、比例系数表、
  `derivePrintMetrics` 各档输出、下限/上限 clamp、`auto` 解析。
- **修改** `unit-tests/pdf-layout-engine.spec.js`：现有 12 条**不动**（走 undefined 路径）；
  新增 `stemMM` 模式用例（放大 → `rw` 变大；撞天花板 → 停在 `uw`；下限生效）。
- **修改** `unit-tests/pdf-generate.spec.js`：`FakeDoc.setFontSize` 记录 size；
  新增「stemMM 放大 → 绘制尺寸与字号同步变大」。
- **新建** E2E `tests/pdf-print-size.spec.js`：挡位可见性（截图 +
  `assertVisiblyRendered`）+ 持久化（改选 → 关弹窗 → 重开 → 值还在）。
- **复现性演练**（AGENTS.md 硬规则）：新测试写完后临时把 bug 改回去，确认测试确实失败，再改回来。

运行方式遵循 AGENTS.md：`npx playwright test --reporter=list --output=tmp/test-results-<新目录名>`，
vitest 段用 `NODE_OPTIONS=` 前缀。

---

## 7. 待王先生确认

1. **默认挡位**：`auto`（等价现状，零回归）还是 `小四 12pt`（多数人立刻受益，但版面会变）？
2. **node_modules**：本 worktree 缺失，是软链到 `/Users/john/.codex/worktrees/f640/question-bank-local/node_modules`，
   还是在这边重新 `npm install`，或者实施时切到有依赖的 worktree？
