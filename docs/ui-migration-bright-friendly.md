# UI 整体迁移至明亮友好型风格

## 问题摘要
原有 UI 存在严重设计债：配色混乱（4 种紫色漂移）、3D 硬投影、小圆角、硬编码 hex 遍布 45 个文件。用户选择 A 方案（明亮友好型）作为新视觉语言。

## 变更清单

### 设计契约
- 新增 `DESIGN.md`：珊瑚橙主色 `#FF7847`、糖果副色（mint/sky/sun/grape）、大圆角（18/26px）、软阴影

### Token 层（src/styles/main.css）
- `:root` 全量替换为 A 调色板
- 新增语义 token：`--mint`/`--sky`/`--sun`/`--grape` 及 soft/deep 变体
- 圆角体系：`--radius-sm:10px`/`--radius-md:18px`/`--radius-lg:26px`
- 阴影体系：紫调软阴影 `0 6px 20px rgba(120,90,220,.08)`

### 组件层（src/styles/main.css）
- header → 珊瑚橙渐变问候卡 + 橙色投影
- tabs → 胶囊 chips（激活态黑底白字）
- cards → 大圆角无硬边框 + 软阴影
- buttons → 圆角渐变 + scale(.97) 按压反馈
- FAB → 圆角方形渐变悬浮键
- badges → 糖果色 soft+deep 组合

### 骨架层（src/index.html）
- 清除约 458 处内联 `style=`
- 新增工具类：`.header-login-btn`/`.sync-bar`/`.btn-warn`/`.btn-grape`/`.btn-sky`/`.btn-mint`/`.btn-ghost`/`.btn-paste`/`.tab-badge`/`.ai-card`/`.crop-rotate-btn`
- 保留所有 `id` 与 `.tab` 类名（E2E 依赖）

### TS 模板层（src/ui/，42 个文件）
- 核心路径：question-detail/core、review-ui
- PDF 书库：pdf-doc-ops/render/topic/category
- 教学/Wiki/其他：wiki-mvp/wiki/teaching-ui/floating-window/paper-manage/tag-suggest/basket/sync-ui/tag-manage/blank-question/pending-link/markdown/ai-model-ui/app-update-ui/baidu-netdisk
- 替换模式：`#1B7A4E`→`#FF7847`、`#3B82F6`→`#4CC3FF`、`#ef4444`→`var(--danger)`、`#10b981`→`var(--mint)`、`#f59e0b`→`#F79009`、`#8b5cf6`→`var(--accent)`

## 影响范围
- 客户端 UI 层全量
- 不影响 data/services 逻辑
- 不影响 server/、Android/iOS 原生代码

## 验证结果
- `npm run typecheck` ✓
- `npm run build` ✓
- `npx playwright test tests/ui-health.spec.js` ✓ 19/19

## 后续建议
- 用 `design-system-capture` skill 从运行态 DOM 反推完整 token 覆盖率
- 考虑引入 stylelint 禁止功能代码硬编码 hex
