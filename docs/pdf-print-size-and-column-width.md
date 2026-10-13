# PDF 打印字号可配置 + 双栏版面修复

日期：2026-09-07
关联模块：PDF 生成, 排版引擎, 导出弹窗, 导出 PDF

## 问题

1. 题目打印字号完全由代码内部的"集合中位数"归一化决定，用户无法控制；不同批次导出的字号随题目集合漂移。
2. 双栏排版把 23% 的纸张（48mm）浪费在内边距上，每栏只有 81mm（页宽 39%），1080px 宽的搜题截图印出来只有 9.6pt。

## 根因（实测，非推测）

### 1. `targetTextMM` 是死参数

原引擎按"集合中位数"归一化：

```
raw_i  = tgt / ((tH_i/w_i) × 栏宽)
baseline = median(raw_i)
norm_i  = clamp(raw_i / baseline, 0.35, 1)
rw_i    = 栏宽 × norm_i
```

`tgt` 在分子分母同时出现，被约掉——**改它排版纹丝不动**。实测同批图取
`targetTextMM` = 2/4/8，所有 cell 的 `[w,h]` 完全相同。

真正决定打印字号的是纯几何量：`(tH/w) × 栏宽`，与任何配置无关。

### 2. 双栏栏宽公式误用纵向内边距

```
旧：uwd = (uws - CGAP)/2 - 2*CPAD = (190-4)/2 - 12 = 81
    x_L = MG + CPAD = 16,  x_R = AW/2 + CGAP/2 + CPAD = 113
    外16 + 81 + 缝16 + 81 + 外16 = 210（内容 77%，缝实际 16mm 而非 CGAP=4）
```

`CPAD` 是纵向内边距语义（`need = rh + lh + pad*2`），却在横向被减了两次、缝两侧又各加一次。

### 3. 单双栏没有中间档

1080px 宽截图实测：单栏 rw=190mm/90% 页宽/22.4pt（过大），双栏 rw=81mm/39%/9.6pt（过小）。

## 方案

### 双栏栏宽修复

```
新：uwd = (uws - CGAP)/2 = 93（+15%）
    x_L = MG = 10,  x_R = AW/2 + CGAP/2 = 107
    外10 + 93 + 缝4 + 93 + 外10 = 210（内容 89%，缝回到真正的 CGAP=4）
```

纵向 `CPAD` 用法不变（`pad*2` 仍参与 need 预算，常量保持 6）。

### 打印字号 = 用户可配置的绝对目标

```
rw = clamp(w × stemMM / tH, MIN_PRINT_SCALE × 栏宽, 栏宽)     MIN_PRINT_SCALE = 0.35
```

- 参考点从"集合中位数"换成"用户设定的字号"，调大真的变大，直到撞纸宽天花板
- 下限 `0.35×栏宽` 保留：防 `estimateTH` 估错把图缩成蚂蚁（语义从"防过度缩小"变为"防错误估计"）
- **尺寸感知栏位**：双栏下纸面字高 `< 0.75 × 目标`（`DOUBLE_MIN_RATIO`）的题强制回单栏。
  效果：选 10.5pt 及以下走双栏省纸，选 12pt 以上自动单栏保字号

### 比例系数表（由现状常量反推，stemMM=4mm 时与旧值吻合）

| 元素 | 现状 | 系数 | 派生 |
|---|---|---|---|
| 题干（图） | 4mm | 1.00 | 基准 |
| 题号 `第 N 题` | 11pt | 0.97 | `numLabelPt` |
| `答案:` | 9pt | 0.79 | `ansLabelPt` |
| 主标题 | 18pt | 1.59 | `titlePt` |
| 副标题 `共 N 题` | 11pt | 0.97 | `subTitlePt` |
| `参考答案` 页眉 | 16pt | 1.41 | `answerHeaderPt` |
| 页码 | 8pt | 0.71 | `pageNumPt` |
| 标签预留高 labelH | 5/4mm | ×1.28 | `numLabelH`/`ansLabelH` |
| 标签基线偏移 | +3mm | ×0.8 | `numLabelBaselineMM`（**防大字号标签冒出 cell 顶部**） |
| 最小切割高 MIN_SPLIT | 25mm | ×6.25 | `minSplitMM` |
| 标题区预留 topReserve | 35mm | 公式 | 4mm 时 ≈34.78，与旧值对齐 |

pt↔mm 换算依据：`estimateTHFromPixels` 测的是字形高度（行距会打断行段），`mm / 0.3528 → pt` 成立。

## UI

导出弹窗新增「打印字号」挡位（`.print-size-option`，**不复用** `.spacing-option`——`selectSpacing`
会 `querySelectorAll('.spacing-option')` 清全部 selected，复用会互相抹掉高亮）：

- 挡位：小五 9 / 五号 10.5 / 小四 12 / 四号 14 / 三号 16 pt，默认**五号 10.5pt**（王先生指定：默认必须走双栏）
- 持久化：localStorage `printStemPt`（`loadStemPt`/`saveStemPt`，越界钳到表内）
- 实测回显 `#print-size-hint`：抽样最多 8 张题图，`printed = min(natural, max(0.35*natural, stemMM))`，
  显示中位数等效 pt + 受纸宽上限题数，文案注明"按单栏栏宽估算"
- 颜色用 `--text-secondary`（对比度 3.3:1 达标），**不用** `--text-tertiary`（1.98:1，E2E 对比度断言会拦）

## 变更文件

| 文件 | 变更 |
|---|---|
| `src/data/pdf-print-size.ts` | 新建：pt↔mm、挡位表、比例系数表、`derivePrintMetrics`、localStorage 读写、`DOUBLE_MIN_RATIO` |
| `src/data/pdf-layout-engine.ts` | 双栏栏宽去横向 CPAD；中位数归一化 → 绝对目标；尺寸感知栏位 `effLm`；`MIN_SPLIT` 可配；导出 `MIN_PRINT_SCALE`/`DEFAULT_SINGLE_COLUMN_MM` |
| `src/data/pdf.ts` | 全部硬编码字号/labelH/基线偏移/标题位置/topReserve 改由 metrics 推导；`generatePDF` 接 `options.stemMM ?? loadStemMM()`；删除 `targetTextMM` |
| `src/data/pdf-image.ts` | 新增 `analyzeImage`（一次解码返回 w/h/tH）；`estimateTH` 委托它 |
| `src/ui/export-pdf-ui.ts` | 挡位渲染/选择/持久化、实测回显（重入 token 保护）、preview 与 export 传 `stemMM` |
| `src/index.html` | 导出弹窗加「打印字号」区块 |
| `src/styles/main.css` | 新增 `.print-size-option` 三条样式 |
| `src/types/pdf.ts` | `PrintMetrics`/`StemPtPreset` 类型；`PlanLayoutOptions` 加 stemMM/cellPadMM/minSplitMM；删 `targetTextMM` |
| `src/main.ts` | 挂载 4 个新 UI 函数 |
| `src/data/index.ts` | 追加 `export * from './pdf-print-size'` |

## 验证

- 单测 306 passed（新增 pdf-print-size 18 条、引擎 3 条、pdf-generate 3 条、pdf-image 1 条）
- typecheck、build 通过
- E2E 4 条（`tests/pdf-print-size.spec.js`）：挡位可见性（含对比度≥3）、持久化、手机视口不撑坏弹窗、回显文案
- 复现性演练（把改动临时改回去验证测试能抓住）：下限保护 → 2 条单测挂；尺寸感知栏位 → 2 条单测挂；回显对比度 → E2E 挂

## 已知限制 / 注意事项

1. **默认 10.5pt 下典型截图走双栏**（1080 宽 tH=45：natural 3.88mm ≥ 阈值 2.78mm）。字号无论单双栏都精确命中目标值，栏位自动适配；调大到 12pt 以上会逐步转单栏（字号不变、页数上升）
2. 铺满栏宽仍达不到目标字号的题（极宽照片）印不到目标值——回显会给出"受纸宽上限"题数
3. `mode:'double'` 旧路径 `generateLegacyDouble` 未改造（UI 无入口，字号仍硬编码 10/9/11pt）
4. 打印字号配置仅存本机 localStorage，**不进云端同步**
5. 双栏测试用例的 tH 阈值：`tH/w ≥ 0.75×stemMM/93` 才能留在双栏，写双栏机制测试时图要足够"密"（现行用例用 tH=40）
