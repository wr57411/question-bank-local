# 重写 app.spec.js E2E：修复 CI e2e 长期红灯

- **日期**: 2026-09-01
- **关联模块**: E2E（tests/app.spec.js）、Playwright 配置（playwright.config.js）、备份导出、PDF、数据层造数
- **配套改动**: playwright.config.js 增加 `testIgnore` 排除两个 AI 用例（端侧 AI 暂不维护，2026-08-31 王先生裁决）

## 问题摘要

CI 的 e2e 环节长期红灯，红灯源头是旧的 `tests/app.spec.js`：一条 90 行的「一条龙」用例依赖了多处已消失的 UI 元素，只要开头一步挂掉后面全部连坐。同时 `ai-simulation.spec.js` / `ai-pipeline-e2e.spec.js` 需要 API key，在 CI 上必然失败。

## 根因（旧用例逐项比对 src/ 当前实现）

逐项核对后确认：标签管理 / 试卷管理 / 题目列表三大块的契约完好（`#tag-name`、`#tag-form`、`#tags-list`、`#paper-name`、`#paper-tag-select`、`#paper-form`、`#papers-list`、`#questions-list`、`#filter-tags`、`#question-modal` 全部仍在 index.html:349-402 与 :677），真正失效的只有 4 处：

| # | 旧依赖 | 当前事实 | 证据位置 |
|---|--------|---------|---------|
| 1 | `#question-image` / `#answer-image` file input | 已移除，改为拍照/相册/跨页/悬浮窗四按钮走 Capacitor 原生；Web 端无法注入文件（直接死因：`setInputFiles` 60s 超时） | src/index.html:241-245、264-269 |
| 2 | `#tag-select`（题目表单 select multiple） | 改为搜索式 `#form-tag-search` → `#form-tag-results > span` → `#form-tag-selected` | src/ui/tag-manage.ts:85 |
| 3 | `#status-message .status` 的「题目添加成功」 | `showStatus` 的 success 分支已改走 `#toast-msg`（见 docs/fix-status-feedback-unified.md） | src/ui/common.ts:33-36 |
| 4 | 按钮「导出备份」 | 已改名「📤 导出」 | src/index.html:72 |

## 修复方案

### 1. playwright.config.js 排除 AI 用例

`testIgnore` 排除 `ai-simulation.spec.js` 与 `ai-pipeline-e2e.spec.js`，文件保留在 tests/ 以便日后恢复，仅从收集范围中排除。

### 2. app.spec.js 拆分为 4 条独立用例

- 标签名与试卷名中的 HTML 被转义，不会执行注入脚本（`__tagXss` / `__paperXss` 均为 false）
- 带图题目可以导出为完整备份 JSON（下载文件解析校验 questions/tags/question_tags 数量与图片字段）
- 试卷可以下载为合法 PDF（`%PDF` 魔数 + 字节数 > 1000）
- 移至垃圾篓后题目从列表移除，试卷「题目数量」归零

### 3. 造题方式：数据层 API + 页面内 canvas 生成图片

产品方向是「结构上不允许无图题目」，旧的「纯文字模式 UI 造题」只是短命通道；Web E2E 又没有 Capacitor 相机。因此采用：

- 页面内 `canvas.toDataURL("image/png")` 生成真实图片 → `window.dbCreateQuestion(dataUrl, ...)` 直写数据层，题目经 `compressImage` 转为 `data:image/jpeg`
- 该做法与项目既有范式一致：tests/ui-health.spec.js:352 注明 E2E「不登录、不同步、不调服务端」，:398 直接调 `window.dbCreateTag()`
- 辅助函数：`createQuestionWithImage` / `createTag` / `seedTaggedQuestion` / `selectOptionsByLabel`

## 实现细节与探针实测的坑

1. **硬编码 PNG base64 不可用**：public/db.js 的 `compressImage` 对 string 输入直接 `img.src = input`，无效图会 `onerror` reject（抛 Event）——图片必须用页面内 canvas 现场生成，不能贴死 base64。
2. **删题按钮选择器**：`#question-modal .danger` 当前唯一匹配「移至垃圾篓」（实测 count=1），但相似题「移除关联」按钮同为 `.danger`（src/ui/question-detail.ts:185），未来存在碰撞风险。最终代码用 `getByRole("button", { name: "移至垃圾篓" })` 按可访问名匹配，消除隐患。
3. **软删后数量联动**：软删题目后试卷卡片的「题目数量」实测归零，可作为断言依据。
4. **download 事件**：试卷卡片「下载 PDF」（jsPDF `doc.save`）与「📤 导出」（`a.click`）在 Web 端均触发 Playwright download 事件，`waitForEvent("download")` + `saveAs` 后读文件即可校验。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| tests/app.spec.js | 整体重写：1 条 90 行一条龙用例 → 4 条独立用例 + 4 个辅助函数 |
| playwright.config.js | 新增 `testIgnore` 排除两个 AI 用例 |

## 验证

- 4 条用例全部通过（4 passed）
- 防假绿验证 4 项全过：每条用例临时改坏断言/依赖，确认确实变红后再还原
- AGENTS.md 规定的标准 E2E 循环（ui-health + quick-import-visibility）不受影响，34/34 全绿

## 遗留风险

1. **混合架构风险备案**：4 条用例依赖的关键全局函数全部来自 legacy `public/db.js`（src/index.html:1341 加载）：`dbCreateQuestion`（public/db.js:423）、`generatePaperPDF`（:1799）、`exportAllData`（:1807）。**若清理 public/ 会同时断掉全部 4 条用例**，清理前必须先把造数/导出/PDF 能力迁移到 src/ 数据层。
2. 全量 E2E 中 modal-anchor-overlap.spec.js 存在与本次改动无关的固有竞态（失败率约 40%），已单独记录：docs/fix-modal-anchor-flaky.md。
