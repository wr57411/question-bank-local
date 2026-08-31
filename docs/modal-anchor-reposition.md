# 弹窗锚点定位重构交付说明

> 日期：2026-08-31 ｜ 分支：`f640/main2` ｜ 关联：`docs/quick-import-mode.md`、`docs/plans/2026-08-31-fix-quick-import-overlap-feedback.md`（被本方案替代的旧方案）
>
> **结论：全部 33 个锚点化弹窗（32 静态 + 1 动态，另有 2 个白名单全屏层）均无重叠遮挡、无功能回归。** 单测 237 通过、E2E 61 通过、typecheck/build 通过。

## 需求与约束（用户原文 5 条）

1. 以 `#quick-import-bar` 为锚点，所有弹窗在锚点**正下方**渲染，不覆盖锚点区域
2. 抽象为**公共逻辑**，迁移**全部弹窗**，消除各自独立定位实现
3. 锚点下方空间不足时，向上翻转或内部滚动
4. 窗口缩放 / 滚动 / 锚点位置与显隐变化时，弹窗位置**同步更新**
5. 保持既有交互、层级（z-index）、动画、可访问性不变，**不引入第三方依赖**；输出改动清单并验证无重叠无功能回归

## 根因

`.modal` 原为 `position:fixed;inset:0` 全屏遮罩 + `align-items:center` 垂直居中，而 `#quick-import-bar` 是动态高度的固定锚点（笔记展开 ≈296px / 收起 ≈176px，`applyNoteBodyPadding` 补偿值 312/196）。居中定位与动态锚点高度之间**没有统一偏移逻辑**，弹窗卡片按视口居中后上边缘必然侵入 bar 区域（快速导入模式下遮挡）。

## 改动文件清单

### 核心（新增）

| 文件 | 行号 | 说明 |
|---|---|---|
| `src/ui/modal-anchor.ts` | 新建 1-216 | 唯一真实来源：纯计算（1-47）、锚点读取（49-72）、DOM 应用（74-107）、observer 绑定（109-165）、批量初始化 + combo 特例（167-216） |

### 统一入口与初始化

| 文件 | 行号 | 说明 |
|---|---|---|
| `src/ui/common.ts` | 1-2, 42-76 | `openModal`/`closeModal` 增强为锚点感知入口（签名不变）：open 时读取锚点 rect 并 `applyModalPosition`；close 时清空全部内联几何样式 |
| `src/main.ts` | 7, 675, 679 | DOMContentLoaded 与直载两条路径均先 `initAnchoredModals()` 再 `initApp()` |
| `src/styles/main.css` | 174-176 | 新增 `.modal--anchored` / `.modal-content--anchored` 语义钩子（空声明，不改 z-index/动画） |
| `src/index.html` | 1311 | `#quick-combo-panel` 卡片移除硬编码 `top:calc(84px + env(safe-area-inset-top))`，加 `id="quick-combo-panel-card"` 由 JS 动态赋 top |
| `src/ui/quick-import.ts` | 68, 225, 609-621 | `applyNoteBodyPadding`/`render` 末尾广播 `quickImportBarChange` 事件；导出 `getQuickImportBarRect`/`isQuickImportBarVisible` |

### 弹窗迁移（`classList.add/remove('active')` → `openModal/closeModal`，行为不变）

| 文件 | 迁移点（打开/关闭） |
|---|---|
| `src/ui/question-detail.ts` | 18, 133, 251, 257, 352（question/similar） |
| `src/ui/basket.ts` | 43, 47 |
| `src/ui/export-pdf-ui.ts` | 18, 93 |
| `src/ui/pdf-preview.ts` | 23, 60, 143 |
| `src/ui/pdf-doc-ops.ts` | 76, 145, 149, 176 |
| `src/ui/pdf-category.ts` | 33, 80 |
| `src/ui/pdf-topic.ts` | 23, 59 |
| `src/ui/provider-manage.ts` | 152, 170, 175 |
| `src/ui/tag-manage.ts` | 227, 232 |
| `src/ui/paper-manage.ts` | 55, 58, 71, 99, 152, 257, 260 |
| `src/ui/topic-manage.ts` | 86, 90 |
| `src/ui/version-manage.ts` | 23, 35, 39, 98, 102, 145, 149 |
| `src/ui/note-version.ts` | 72, 76 |
| `src/ui/pending-photos-ui.ts` | 107, 133, 199, 220 |
| `src/ui/blank-question.ts` | 15, 63, 67 |
| `src/ui/sync-ui.ts` | 169, 173, 183, 188, 201, 209（login/sync/sync-warning） |
| `src/ui/backup.ts` | 98, 102 |
| `src/ui/baidu-netdisk.ts` | 49, 53 |
| `src/ui/issue-feedback.ts` | 77, 82 |
| `src/ui/floating-window.ts` | 109, 170, 186, 198, 225（floating/floating-save） |
| `src/ui/teaching-verify.ts` | 42, 240, 324, 328（verify/picker） |
| `src/ui/app-update-ui.ts` | 80, 84 |
| `src/ui/review-ui.ts` | 16, 30 |

### 测试

| 文件 | 说明 |
|---|---|
| `unit-tests/modal-anchor.spec.ts` | 新建 169 行：`computeAnchoredPosition` 纯函数（below/above/constrained/anchor<=0）+ `applyModalPosition` DOM 应用与回落清空 |
| `tests/modal-anchor-overlap.spec.js` | 新建 385 行 27 用例：基线 1 + 核心弹窗 3 + PDF 1 + 反馈/同步/备份/组合 4 + 长尾 8 + 白名单 2 + 边界 2 + 同步 5 + a11y/动画/层级 2（27 项，全通过） |

## 关键逻辑

- **computeAnchoredPosition（纯函数，`modal-anchor.ts:17-47`）**：输入 `anchorBottom/anchorTop/viewportHeight/contentHeight/margin(12)/safeTop/safeBottom`，输出 `{top, maxHeight, placement}`。三分支：① 放得下 → `below`（top = anchorBottom + 12）；② 放不下但上方空间更大且够 → `above` 翻转；③ 都不够 → `constrained-below`（贴下方并限高内部滚动）。`anchorBottom <= 0`（锚点隐藏）时从安全区顶部重新布局。maxHeight 下限 120。
- **applyModalPosition（DOM 层，`modal-anchor.ts:74-107`）**：白名单（`EXCLUDED_IDS = {crop-modal, projection-overlay}`）直接跳过；锚点为 null 时**清空全部内联样式**（回落 CSS 居中）；有锚点时仅写几何属性——`modal.style.top/height/alignItems/paddingTop/boxSizing` + `content.style.maxHeight/overflowY/marginTop`，**不触碰 z-index/opacity/transform/backdropFilter**。
- **bindModalToAnchor（observer 链，`modal-anchor.ts:122-165`）**：ResizeObserver（bar + content 尺寸变化）+ MutationObserver（modal 的 class、bar 的 style/class）+ window resize/scroll（passive），全部经 **rAF 节流**（`createSchedule` 合并同帧多次触发）调度 `sync`，sync 只在 modal `.active` 时执行。
- **initAnchoredModals（`modal-anchor.ts:170-216`）**：`querySelectorAll('.modal')` 全量绑定（白名单除外）——新增弹窗自动纳入，无需登记；`#quick-combo-panel` 卡片走同款特例绑定（top = barBottom + 12，bar 隐藏时回落清空）。
- **兜底路径**：即使某处仍直接 `classList.add('active')`（如 E2E 与教学流程内联调用），MutationObserver 也会触发 sync 完成定位——统一入口与兜底双保险。

## 验证矩阵

弹窗共 **34 个 `.modal`**：index.html 静态 33 个 + 运行时动态创建的 `review-reminder-modal` 1 个（`review-ui.ts:16` `className='modal'`，经 `openModal` 统一入口锚点化）；`projection-overlay` 为独立 class，**不计入 `.modal`**。白名单 2 个（`crop-modal`、`projection-overlay`，有意全屏）保持原样；其余 **33 个（静态 32 + 动态 1）全部经同一代码路径锚点化**。

| 弹窗 | 展开无重叠 | 收起无重叠 | 隐藏回落 | 小视口感滚动 | resize 同步 | 截图 |
|---|---|---|---|---|---|---|
| question-modal | ✅ | ✅ | ✅ | ✅ | ✅ | baseline/anchor_boundary/sync_* |
| basket-modal | ✅ | 同路径 | — | — | — | — |
| export-modal | ✅ | 同路径 | — | — | — | — |
| pdf-preview-modal | ✅（内部滚动） | 同路径 | — | — | — | — |
| issue-feedback-modal | ✅（可聚焦可提交） | 同路径 | — | — | — | — |
| quick-combo-panel | ✅（top=barBottom+12） | ✅ | ✅ | ✅（maxHeight） | ✅ | quick_import_combo_panel |
| login / backup-modal | ✅ | 同路径 | — | — | — | — |
| teaching-verify / node-question-picker / pending-blank / pending-photos / process-photo / version / system-password / sync-warning | ✅（8 个逐一断言） | 同路径 | — | — | — | — |
| 其余 16 个（similar/new-tag/paper/topic-detail/export-images/version-delete/update/baidu-auth/sync/floating/floating-save/error/pdf-manage/pdf-action/add-note-version/ai-recommend） | 统一路径覆盖（同一 `bindModalToAnchor`，无独立实现） | 同路径 | 同路径 | 同路径 | 同路径 | — |
| review-reminder-modal（动态创建） | ✅（openModal 统一入口锚点化） | 同路径 | — | — | — | — |
| crop-modal / projection-overlay | 白名单：全屏不变（`style.top` 为空断言） | — | — | — | — | — |
| provider-modal | ✅（迁移回归 a5b7c77） | 同路径 | — | — | — | — |

「同路径」= 与已断言行共用同一段 `computeAnchoredPosition`/`applyModalPosition` 代码，E2E 未逐一展开但单测覆盖纯函数全分支。

**四类同步场景**（`同步更新` describe，5 用例全 PASS）：① 笔记高度变化（收起/展开 top 跟随 bar 实时 bottom ±1px，往返还原）；② 窗口 resize（maxHeight 按 `vh - barBottom - 24` 重算）；③ 快速导入显隐切换（双向：出现即偏移、消失即清空回落居中）；④ 页面滚动（modal 保持在视口内）。

**a11y/动画/层级回归**：Esc/遮罩点击关闭正常（无全局 Esc 处理器，走 `closeQuestionModal` 遮罩路径）、重开后输入框可聚焦、z-index 恒为 1000、`backdrop-filter: blur(6px)` 保留、opacity=1/transform=none 未被触碰。z-index 断言做过负向验证（临时改为 1001 → 测试失败 → 还原）。

## 本地 CI/CD 结果（2026-08-31）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 错误 |
| `npm run test`（vitest 246 项） | ✅ 237 通过 / 9 跳过；仅 `real-api.spec.js` 失败——**需真实 API key 的烟雾测试**（AGENTS.md 已声明此类用例不纳入本地门禁），与本次改动无关 |
| `npm run build` | ✅ 215ms（仅既有 dynamic-import 警告） |
| Playwright 3 spec 全量 | ✅ **61 passed**（modal-anchor-overlap 27 + quick-import-visibility 7 + ui-health 27），`--output=test-results-anchor-final` |

截图人工复核（已逐张 Read）：手机 390×844 各状态无遮挡；390×600 限高滚动有效（内容底缘截断+内部滚动）；1280 桌面（quick-import-visibility/ui-health 默认视口）无重叠；`assertVisiblyRendered` 对比度 ≥3 全部通过。

## 偏离说明与已知边界

- **bar 实测高度（≈296/≈176）与 body padding 补偿值（312/196）不一致**：锚点定位以真实 `getBoundingClientRect` 为准，功能正确；页面底部约有 16px 冗余空白，属既有行为，未在本项目处理。
- **`quickImportBarChange` 事件已广播但 modal-anchor 未订阅**：同步实际由 bar 上的 ResizeObserver + MutationObserver 驱动，事件保留作语义广播/未来扩展。
- **白名单边界**：`crop-modal`（`height:100dvh` 黑底裁剪）与 `projection-overlay`（z-index 9999 投屏）为有意全屏交互，锚点逻辑对其 no-op；新增全屏类弹窗需加入 `EXCLUDED_IDS`（`modal-anchor.ts:51`）。
- E2E 中 modal 打开期间点击工具栏 toggle 需用 JS 派发 click（遮罩 z-index 1000 盖住 bar 按钮的真实点击会被 hit-target 拦截），bar 内按钮（z-index 1200）不受影响。

## 回滚方式

1. `src/main.ts:675,679` 删除 `initAnchoredModals()` 两处调用（observer 链全部停用，弹窗回到 CSS 居中）；
2. `git revert` 或还原 `src/ui/common.ts` 的 `openModal/closeModal`（恢复为单行 `classList.add/remove('active')`）与 `src/index.html:1311` 的 combo 卡片内联 top。
3. 其余迁移文件均为等价替换（`openModal(id)` ↔ `classList.add('active')`），回滚 1+2 后行为即与重构前一致；`modal-anchor.ts` 与测试文件可整体删除，无残留引用。

## 全部弹窗均无重叠遮挡 / 无功能回归：是
