# 平板题目列表显示优化 实施计划（v2：容器查询方案）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 平板双栏下题目图片按卡片实际宽度等比放大（清晰可读、不裁切不拉伸），两栏充分利用屏宽；手机竖屏与桌面布局不变。

**Architecture:** 采用**容器查询 + 视口上限组合**：`.question-card` 声明 `container-type:inline-size`，由 `@container (min-width:220px)` 按**卡片实际宽度**决定图片是否等比放大；外层再套 `@media(max-width:1023.98px)` 把桌面排除在外。这样判定依据是"卡片够不够宽"而非"视口断点数值"，不受设备 CSS 宽度推算误差影响。

**Tech Stack:** CSS Container Queries（Chrome 105+ / iOS 16+，本项目 WebView 均满足，不支持时安全降级为现状）、媒体查询；Playwright 多视口 E2E。

**项目硬规则：**
- **禁止 git commit/push**；node 命令加 `NODE_OPTIONS= `；测试产物只许落 `tmp/`
- UI 改动必须截图 + 实际 Read 人工确认；`captureForReview` 前先 `scrollIntoViewIfNeeded`
- 客户端源码不加注释；只动被点名位置

---

## 一、根因（2026-09-11 实测读码）

图片尺寸被**固定高度**钉死，与卡片宽度无关：

| 位置 | 规则 |
|---|---|
| `main.css:160` | `.question-card img{width:100%;height:130px;object-fit:contain;…}`（基类） |
| `main.css:272` | `@media(min-width:768px){ .question-card img{height:160px} }` |
| `main.css:264` | `@media(max-width:480px){ … height:110px }` |
| `main.css:156` | `.question-grid.grid-single .question-card img{height:auto;max-height:420px}`（**仅单栏模式**等比） |

容器：`:47 max-width:800px` / `:278 ≥768 max-width:900px` / `:283 ≥1024 max-width:1100px`。

故平板两栏卡片约 440px 宽时，图片仍只有 160px 高 → 竖版题目按高度缩成约 120×160px，清晰度不足且留白巨大。

## 二、关键设计决策

### 2.1 为什么用"容器查询 + 视口上限"而非纯容器查询

纯容器查询按卡片宽度判定 → **桌面双栏卡片（约 525px）也会命中**，违背"不影响桌面"。加外层 `@media(max-width:1023.98px)` 即可把桌面排除，同时保留"按卡片宽度判定"的核心优点。

### 2.2 阈值取 220px 的推导

| 场景 | 卡片宽度 | 是否命中 220px |
|---|---|---|
| 手机竖屏双栏（390 视口） | 约 175px | ✗ 不命中（保持现状）✓ |
| 大屏手机竖屏（430 视口） | 约 195px | ✗ 不命中 ✓ |
| **平板竖屏双栏**（推算 617 视口） | 约 276px | ✓ 命中 |
| 平板竖屏双栏（悲观推算 560 视口） | 约 248px | ✓ 命中（留余量） |
| 平板横屏双栏（推算 939 视口） | 约 440px | ✓ 命中 |
| 手机横屏双栏（844 视口） | 约 390px | ✓ 命中（已知取舍） |
| 桌面双栏（1280 视口） | 约 525px | 被外层 `max-width:1023.98px` 排除 ✓ |

阈值 220 的依据：**高于手机竖屏双栏的上限（约 195px）**、**低于平板竖屏双栏的悲观下限（约 248px）**，两侧都留出安全间距。

### 2.3 待实测的不确定量（诚实标注）

平板 CSS 视口宽度未能直接实测（adb 不可用，"已连接"为互联功能非调试桥）。由截图几何反推：横屏约 939px、竖屏约 617px（误差可能 ±10%）。容器查询方案对此不敏感（判定依据是卡片宽度），但仍以 Task 3 截图与用户真机复核为最终判据。

## 三、精确改动（`src/styles/main.css`，行号已按 2026-09-11 同步后的最新代码校正）

**改动 1**：在 `:157` 的 `.question-card` 规则内追加 `container-type:inline-size`：

```css
.question-card{position:relative;background:var(--surface);border-radius:var(--radius-md);overflow:visible;box-shadow:var(--shadow-md);cursor:pointer;transition:all .2s ease;border:none;container-type:inline-size}
```

**改动 2**：在 `:289`（`@media(min-width:1024px)` 块结束）之后、`:290` 横屏注释之前插入新区块：

```css
/* 平板：按卡片宽度自适应（容器查询），桌面由外层 max-width 排除 */
@media(max-width:1023.98px){
    .container{max-width:none}
    @container (min-width:220px){
        .question-card img{height:auto;max-height:70vh}
    }
}
```

要点与理由：
- `container-type:inline-size` 加在 `.question-card`（被查询元素的祖先），`@container` 才能对 `img` 生效；卡片是 grid item、宽度由网格决定，inline-size containment 不影响其尺寸，`.q-checkbox` 的定位祖先仍是卡片（`position:relative` 未变）
- `height:auto` + 既有 `object-fit:contain` → 等比放大，**不裁切不拉伸**
- `max-height:70vh` 防超长截图霸屏
- 单栏模式不受影响：`:156` 特异性 (0,3,1) 高于本规则 (0,1,1)，仍保持 420px 上限
- `.container{max-width:none}` 仅在视口 >800px 时产生实际变化（800–1023 区间容器由 900 放开到视口宽），实现"两栏充分利用屏宽"
- **降级行为**：不支持 `@container` 的浏览器忽略该块 → 图片维持现状固定高，无破坏性副作用

## 四、任务分解（TDD）

### Task 1: 写防回归 spec（红灯）

**Files:** Create `tests/tablet-grid-layout.spec.js`

竖版 SVG（300×400）造题，逐视口断言：

| 视口 | 期望 |
|---|---|
| 390×844 手机竖屏 | **守卫**：img 高 = 固定值（110/130），不得等比（渲染高 ≤160） |
| 617×939 平板竖屏 | 双栏 2 轨；img 高 > 200px；**渲染高宽比 == 4:3（容差 2%）**，证明无拉伸/裁切 |
| 939×617 平板横屏 | 同上；且容器宽 ≈ 视口宽 |
| 1280×800 桌面 | **守卫**：img 高 = 160px 固定（容器查询被外层媒体查询排除） |

比对的比值来源：`naturalWidth/naturalHeight`（真实原图比例）vs 元素 boundingBox 比值，误差 ≤2%。

运行（预期红灯：平板仍为固定 160px 高、比值不符）：
```bash
NODE_OPTIONS= E2E_SCREENSHOT_DIR="$PWD/tmp/screenshots-tablet" \
  npx playwright test tests/tablet-grid-layout.spec.js \
  --reporter=list --output="$PWD/tmp/test-results-tablet-pre" 2>/dev/null
```

### Task 2: 改 CSS（上述改动 1 + 改动 2）

### Task 3: 绿灯 + 截图人工确认

重跑 spec（预期全绿）；**实际 Read** 平板横/竖屏截图，确认两栏铺满、图片明显变大、无变形。

### Task 4: CI 循环

```bash
NODE_OPTIONS= npm run typecheck
NODE_OPTIONS= npm run test
NODE_OPTIONS= npm run build
NODE_OPTIONS= npx playwright test --reporter=list --output="$PWD/tmp/test-results-tablet-full" 2>/dev/null
```
基线 83 passed；既有 `question-list-single-column.spec.js`（含 1280 桌面守卫）与 `question-checkbox-hit-area.spec.js` 必须仍全绿。

### Task 5: 文档 + 索引，不 commit

- `docs/question-list-layout-toggle.md` 追加「平板适配（容器查询）」一节
- 更新 `AGENTS.md` 索引行摘要

## 五、验收清单

- [ ] 平板横/竖屏：双栏铺满宽度、图片等比放大、比例误差 ≤2%（不裁切不拉伸）
- [ ] 手机竖屏与桌面守卫用例全绿（图片仍固定高）
- [ ] `container-type` 未破坏勾选框定位与卡片布局（既有 E2E 全绿）
- [ ] 截图经人工 Read 确认（横竖各一张）
- [ ] typecheck / test / build / 全量 E2E 全绿
- [ ] 文档与索引更新；未 commit

## 六、风险与失效边界

1. **`@container` 兼容性**：不支持时整块被忽略 → 降级为现状（无破坏）。需在真机确认 vivo Pad 的 WebView 版本 ≥105（Android 15 设备远高于此）
2. **容器查询改变包含块**：若真机出现勾选框定位异常或卡片高度异常，回滚点很清晰——只需删掉 `container-type` 与 `@container` 块
3. **阈值 220 依赖卡片宽度推算**：若真机竖屏卡片宽 <220（即视口 <约 536px），竖屏不会放大 → 届时把阈值下调至 200 并重跑守卫（手机竖屏上限 195 仍有余量）
4. **手机横屏会命中**（卡片约 390px）：已确认的取舍

---

## 七、质量评审裁决记录（2026-09-11，code-reviewer-1）

### 已采纳的修正项

| 编号 | 问题 | 修正 |
|---|---|---|
| **I-3** | 测试的 content 尺寸断言是恒等式（`contentW/contentH ≡ nw/nh` 由推导必然成立），「不裁切不拉伸」实为零覆盖；`object-fit` 被采集却从未断言，改成 `cover`/`fill` 仍全绿 | ① 新增 `expect(m.fit).toBe('contain')` 直接锁语义；② 未触发钳制时断言 box 比例 == 原图比例；③ 触发钳制时断言 `boxH ≈ 0.7 * viewportH`（顺带把 `max-height` 纳入覆盖） |
| **I-4** | 注释/describe 标题残留「预期红灯」「修复前」等红灯期措辞，与已落地状态矛盾 | 注释改为描述不变量；describe 去掉「预期红灯」；截图名改为中性（`平板竖屏双栏`/`平板横屏双栏`） |
| **I-1** | `container-type:inline-size` ⇒ `contain:layout`，使 `.question-card` 新增 stacking context 与包含块（现行无回归，但属静默语义变化） | 在 CSS 处加注释说明「卡内勿放需跨卡片浮层的 fixed 元素」+ 补一条平板视口下的勾选框可见性/可点击断言 |
| **M-2** | `70vh` 与同文件 `88dvh`（:299）风格不一致 | 改 `70dvh` |
| **M-3** | 阈值 220 在 480px 视口存在**误命中尖峰**（≤480 分支 padding 12/gap 8 ⇒ 卡片 224 > 220），非单调 | 阈值 **220 → 225**：排除 480 尖峰（224），仍覆盖悲观平板竖屏值（236–248） |
| **M-4** | 手机守卫 `≤160` 过松（实际 110）；容器宽断言对滚动条敏感；截图在断言之后（红灯时无证据） | 手机守卫改断言确值；容器宽改与 `documentElement.clientWidth` 比较；`captureForReview` 前置 |
| **M-1** | `.container{max-width:none}` 是全应用级改动（`.container` 包所有 tab）；不支持 `@container` 的浏览器会「容器变宽但图片不放大」 | 用 `@supports (container-type:inline-size){ … }` 包住整个块，使「变宽」与「放大」同生共死 |

### 经评估后不采纳的项

**I-2（1024 边界排除 iPad 横屏/Pro 竖屏）**：维持 `max-width:1023.98px`，理由：
1. 需求方原话限定范围为「宽度约 **768px–1024px**」，iPad Air/Pro 横屏（1180/1194/1280）超出该范围
2. 放宽到 1365.98 会让 **1280 桌面窗口**命中 → 违反「不影响桌面端现有布局」这一硬约束（桌面双栏卡片约 525px > 阈值）
3. 改用 `@media (pointer:coarse)` 可区分触屏，但触屏笔记本（Surface 类）会误判，且用户未提出该需求
4. 已知副作用：窗口宽度跨 1024 拖动时图片高度有硬跳变（640px ↔ 160px）——平板设备旋转是 617↔939 均落在区间内，不受影响；桌面跨断点跳变恰是「桌面不放大」的正确表现

**M-3 补充结论**（供后续参考）：阈值是纯宽度启发式，无法区分 480px 宽的手机与小平板；若将来 `.question-card` 增加 padding/border、或 `.container` padding / `.question-grid` gap 调整，临界点会整体平移；若卡片被移入无显式宽度的 flex 容器或改为 3 列，inline-size containment 会使其固有尺寸归零导致卡片塌陷——**该写法要求卡片始终处于显式宽度的 grid 中**（已在 CSS 注释中锁定）。
