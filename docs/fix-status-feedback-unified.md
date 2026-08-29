# 状态提示统一化：全局错误弹窗 + 操作反馈 Toast

- **日期**: 2026-08-29
- **关联模块**: showStatus 收口（src/ui/common.ts）、全局弹窗与 toast（src/index.html）、window 导出（src/main.ts）
- **计划文档**: docs/plans/2026-08-29-global-error-modal.md
- **新增测试**: tests/status-feedback.spec.js

## 问题摘要

1. **错误提示只在「添加题目」栏目出现**：全站所有提示都走 `showStatus()`，写入的 `#status-message` 容器位于题目管理 tab 的「添加题目」卡片内部（原 index.html:186）。其他栏目触发错误时文字被写进这个隐藏 div，肉眼不可见。
2. **错误提示不是弹窗**：错误只是塞一个 `.status.error` 的 div 到容器里，无关闭交互，且 error 类型不自动消失。
3. **滚动后操作反馈不可见**：成功/信息提示同样写在该卡片文档流内，用户向下滚动后提示出现在视口外。

## 根因

`showStatus()`（src/ui/common.ts）是全站提示唯一出口（`w.showStatus` + 各模块直接 import），但渲染目标是文档流内的局部容器，而非视口级 UI。

## 修复方案（收口点一处分流）

`showStatus(msg, type)` 保持签名与调用点不变：

- `error` → `showErrorModal(msg)`：打开 `#error-modal`（fixed 覆盖层，⚠️ 图标 + 错误文案 + 「知道了」按钮，z-index 2000 置顶于所有业务弹层），手动关闭。
- `success` / `info` → `showToast(msg, type)`：`#toast` fixed 视口顶部居中（含 `safe-area-inset-top` 适配），3 秒（`TOAST_DURATION_MS`）自动消失，`pointer-events:none` 不挡点击；success=浅绿底、info=浅蓝底，全部使用设计 token。

## 影响范围

- `src/ui/common.ts`：showToast / showErrorModal / closeErrorModal 新增，showStatus 分流
- `src/index.html`：body 末尾新增 `#error-modal`（z-index:2000）与 `#toast`（z-index:1200）
- `src/main.ts`：window 导出 `closeErrorModal`（供 HTML onclick 使用）
- `#status-message` 容器保留但不再写入
- 业务调用点零改动：触发逻辑与文案全站不变；sync-ui 的 silent 静默守卫语义保持

## 实现细节与取舍

- toast 内层 `#toast-msg` 设 `pointer-events:auto`：外层 none 会被继承，导致可见性检测（elementFromPoint）判定"被遮挡"；仅 toast 显示的 3 秒内其自身小区域可拦截点击。
- `showToast` 给外层 `#toast` 同步设置背景 tint 与 `color:var(--text)`：可见性 helper 测量外层，需保证对比度 ≥ 3。
- `#error-modal` 放在 body 最后一个弹窗之后 + 显式 z-index:2000，避免被 `#quick-combo-panel`(1300) 等弹层压住。

## 验证

- `npm run typecheck` / `npm run build` 通过
- `npm run test`：213 passed / 6 skipped；`real-api.spec.js` 1 例失败为环境性基线（真实 AI API 烟雾测试，需 API key），与本次改动无关（该文件未修改）
- E2E（手机视口 390×844，`--reporter=list --output=test-results-statusfb-ci`）：ui-health + quick-import-visibility + status-feedback + form-tag-selection 共 39 例全绿
- TDD 全流程：先写 5 用例确认红灯（元素不存在）→ 实现 → 绿灯；临时回退旧实现确认测试确实失败（防回归有效）
- 评审：规格合规评审通过；代码质量评审 APPROVED 后修复 z-index 层级、提取 `TOAST_DURATION_MS`、复用 openModal/closeModal、测试硬等待优化
