# 修复 UI 迁移回归：相册缩略图 + 原生门控全局缺失 + 双重初始化

## 问题摘要
UI 迁移后，用户报告「添加题目页相册缩略图」功能丢失（原先无需点击相册按钮，题目图片区下方即可显示近期相册图片直接选择）。进一步排查发现这不是单个功能丢失，而是一整片原生门控失效 + 加载架构双重绑定。

## 根因（由子 Agent 审查确认）

### 根因 1：window 原生标志从未赋值
`public/app.js`（经典 script）顶层 `const isNative`/`const MediaPlugin`/`const Camera` 声明不会挂到 `window`，而迁移后的 TS 模块（camera.ts/init-app.ts/question-core.ts/floating-window.ts/baidu-netdisk.ts）读的是 `window.isNative`/`window.MediaPlugin`，全代码树从未赋值 → 所有原生门控恒为假，相册缩略图/悬浮窗/原生相机/跨页拍摄全失效。

### 根因 2：initApp() 被注释
`src/main.ts` 把 `initApp()` 整段注释，导致 `initTagForm/initQuestionForm/initPaperForm/initTopicForm` 四个表单初始化器从未执行（含相册缩略图加载路径）。

### 根因 3：app.js + main.ts 双重绑定 submit
`app.js` 顶层无条件绑定 `#tag-form/#paper-form/#topic-form` 的 submit，`main.ts` 的 `initApp()` 又绑一次 → 一次提交创建两条记录（E2E `toHaveCount(1)` 失败，用户实际使用也会重复创建）。

### 根因 4：其他连带回归
- index.html 按钮重复 `class` 属性（浏览器只认第一个，工具类样式丢失）
- markdown.ts 引用不存在的 `verify-edit-preview`/`verify-edit-textarea`
- platform.ts selectLayout 硬编码颜色
- Playwright 复用真实 Chrome profile / 自动登录 → IndexedDB 数据污染

## 变更清单（13 个 commit）

| Commit | 内容 |
|--------|------|
| ca7bdf5 | main.ts 挂载 isNative/isIOS/Camera/MediaPlugin/FloatingWindow 到 window + 恢复 initApp() |
| 79d5346 | camera.ts 改用自算 nativeFlags 兜底 |
| 107eee4 | floating-window/question-core/baidu 门控改用 window.Capacitor 自算 |
| f0236ae | floating-window 外层门禁改自算 isNative（贯穿 toggleFloatingWindow/pickFromFloating） |
| f99e280 | 修复 index.html 重复 class 属性 |
| 6503a6c | 清理 markdown.ts 悬空 DOM id |
| b7b7181 | platform.ts selectLayout 颜色 token 化 |
| 4362a0d | 新增 initApp 恢复 E2E 断言 |
| 04bf114 | Playwright 配置隔离 userDataDir（修复数据污染） |
| a753c2c | 移植 app.js 备份弹窗函数到 TS 并在 main.ts 导出 |
| ac91774 | 移除 index.html 中 app.js 引用（消除双重初始化） |
| 5b304d5 | 补齐 doAutoBackup/buildBackupData 全局 |
| 3a8a4d4 | 补齐 stopAllPolling/restartAllPolling 全局 + 兜底 handleDiscoverModel |

## 影响范围
- `src/main.ts`（挂载原生标志、恢复 initApp、导出所有 window 全局）
- `src/ui/`：camera/question-core/floating-window/baidu-netdisk/markdown/platform/backup/test-god-mode/tag-suggest/topic-manage/paper-manage
- `src/init-app.ts`（initApp 现在被调用）
- `src/index.html`（移除 app.js、修复重复 class）
- `playwright.config.js`（隔离 userDataDir）
- `tests/ui-health.spec.js`（新增回归用例）

## 不涉及边界
- 未改动 server/、Android/iOS 原生代码
- 未改动 db.js / ai.js（它们继续提供 db* 与 AI 调用全局，属预期保留）

## 验证结果
- `npm run typecheck` ✓
- `npm run test`（vitest 单元测试）128 passed ✓
- `npm run build` ✓
- `npx playwright test tests/ui-health.spec.js` 21/21 ✓（含新增回归用例）

## 关键设计决策
1. **原生标志自算模式**：各 TS 模块从 `window.Capacitor` 重新计算 isNative/MediaPlugin，遵循 pending-link.ts/platform.ts 既有约定，不依赖脆弱 window 全局。
2. **移除 app.js**：main.ts 已通过 assignToWindow 全面接管 app.js 的 window 全局（352/379 个），补齐 5 个备份函数 + 轮询全局后安全移除，彻底根治双重初始化。
