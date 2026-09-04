# 项目协作规则

## 工作流程

1. **先出方案**：收到需求后，先写计划（做什么、怎么做、影响范围），不做实现
2. **等用户确认**：用户同意方案后，再开始编码
3. **遇到问题及时沟通**：实施过程中发现新问题，先暂停并告知用户

## 编码前置检查清单（强制）

**任何代码修改前，以下 5 步必须按序完成，不可跳步：**

- [ ] Step 1: 读取本文件（AGENTS.md），查询「开发文档索引」，锁定相关历史文档
- [ ] Step 2: 读取锁定的历史文档，了解已有操作记录
- [ ] Step 3: 生成开发计划（功能目标、影响模块、变更清单、不涉及边界）
- [ ] Step 4: 暂停，等待用户确认计划
- [ ] Step 5: 用户确认后，开始编码

**编码完成后，以下必须同步完成：**

- [ ] 生成开发文档（存入 `docs/` 目录，模板见 `~/.qoder-cn/skills/large-codebase-ai-dev/doc-templates.md`）
- [ ] 更新本文件的「开发文档索引」部分
- [ ] 执行本地 CI/CD 验证循环（按顺序全部通过）：
  - [ ] `npm run typecheck`（TypeScript 类型检查）
  - [ ] `npm run test`（单元测试）
  - [ ] `npm run build`（生产构建）
  - [ ] `npx playwright test`（E2E 全量测试；`ai-*` 端侧 AI 用例已由 `playwright.config.js` 的 `testIgnore` 排除，无需 API key。2026-09-01 起允许并建议跑全量——弹窗锚定竞态这类跨 spec 问题只有在全量串行时才会暴露）
  - [ ] **UI 改动必须通过「截图 + 可见性评估」，见下方专节**
  - 发现问题立即修复，修复后重跑，全部通过才告知用户可手动测试
- [ ] 执行 ship 打包验证

**违反检查清单 = 产出不可信。**

### Node 进程性能警告（2026-09-04 实测）

WorkBuddy 会话内派生的 node 进程被注入 `NODE_OPTIONS=--require=.../node-language-shim.cjs`（safe-delete 的
文件代理 shim），所有 fs 操作变为同步 IPC（约 15ms/次）。jsdom 的 require 树数千次文件操作 →
**每进程首载 jsdom 约 54s**，vitest 默认每 worker 一个进程 → 多 worker 直接超时崩溃、单 worker 全量 22 分钟。

- `npm run test` / `test:unit` / `test:all` 的 vitest 段已在 package.json 里清空 `NODE_OPTIONS`（**2.5 秒跑完 279 用例**）
- E2E/其它 node 命令在 WorkBuddy 会话内跑时手动加前缀：`NODE_OPTIONS= npx playwright test ...`
  （E2E 本就要求 `--reporter=list --output=tmp/...`，bypass shim 无删除保护风险；用户终端无此环境变量，不受影响）

## E2E 截图评估要求（强制，UI 改动必做）

**背景（真实事故）**：2026-08-29 快速导入顶部条上线后，组合按钮与栏数按钮在真机上**完全看不见**——
全局样式 `main.css:86` 的 `button{color:#fff}` 配上我在 HTML 里覆盖的 `background:var(--surface)` 白底，
变成白字白底。而当时的 E2E 用 `toContainText('组合一')` 断言**照样通过**，因为文本确实存在于 DOM，
只是肉眼不可见。**只断言 DOM 的测试抓不住"看得见的 bug"。**

**规则**：

1. **任何 UI 改动，E2E 必须截图**，不能只断言文本存在。
   - 用 `tests/helpers/visibility.js` 的 `captureForReview(page, name)`，截图落到 `test-results/screenshots/`。
2. **每个关键控件必须过 `assertVisiblyRendered(page, selector, label)`**，它检查：
   - 非 `display:none` / `visibility:hidden` / 近乎透明
   - 宽高 > 0，且完整落在视口内
   - `scrollWidth <= clientWidth + 1`（文字没被 CSS 截断）
   - 中心点 `elementFromPoint` 命中自身（没被别的东西遮挡）
   - **文字/背景对比度 >= 3**（WCAG 对 UI 组件的最低要求），背景会向上冒泡找第一个不透明祖先
3. **遮罩层、纯容器跳过对比度**：`assertVisiblyRendered(..., { skipContrast: true })`，
   容器自身 `textContent` 含后代文本但文字其实渲染在内部卡片上，对它算对比度必然误报。
   改为对内部真正承载文字的元素（如 `#quick-combo-panel > div`）做完整检查。
4. **改完 UI 后，AI 必须实际 Read 截图确认**，不能只看测试变绿。
5. **新增测试要能复现它要防的 bug**：写完后临时把 bug 改回去，确认测试确实失败，再改回来。

**参考实现**：`tests/quick-import-visibility.spec.js`。

## E2E 运行方式（避免触发批量删除保护）

Playwright 启动时会清空 `test-results/` 与 `playwright-report/`，文件数超过 50 会被
WorkBuddy 的 safe-delete 拦截。用下面的方式绕开（不删除任何东西）：

```bash
npx playwright test --reporter=list --output=tmp/test-results-<新目录名>
```

`--reporter=list` 覆盖配置里的 html 报告器（它才是清理 `playwright-report` 的元凶）；
`--output` 指向全新目录。旧产物目录需要用户明确授权后才能清理。

**硬规则（2026-08-31 王先生确认）**：测试产物不放在项目根目录，一律输出到 `tmp/`
（已 gitignore）。根目录历史 `test-results-*` 已归档至 `tmp/test-artifacts-20260831/`。

## 项目信息

- **项目路径**: `/Users/john/.codex/worktrees/f640/question-bank-local`（当前 worktree）
- **类型**: 本地题库 App（iOS + Android，基于 Capacitor）
- **原项目参考**: `/Users/john/question-bank-app`

## 技术栈

### 客户端（本项目）

- 语言：TypeScript（已全盘迁移，无 JS 源码）
- 架构：模块化（src/data, src/services, src/ui, src/types 四层，各层 index.ts 统一导出，main.ts 挂载到 window）
- 本地存储：IndexedDB（localForage）
- 图片处理：Cropper.js + Canvas
- PDF 生成：jsPDF
- 备份：增量备份（format='incremental_v1'，基于 changelog）
- 原生打包：Capacitor 6
- 插件：@capacitor/camera, @capacitor/filesystem, @hotend/capacitor-file-picker, @capacitor-community/file-opener

### 服务端（server/，位于本仓库内）

- 语言：TypeScript（ESM，`tsx` 直运，启动命令 `npx tsx src/index.ts`）
- 框架：Express 5
- 数据库：better-sqlite3（WAL 模式）
- 认证：JWT（Bearer Token）
- 文件上传：multer
- 路由：routes/ 目录（questions, tags, papers, sync, version, recovery）
- 同步模式：push/pull 全量对比

## 适配清单

### iOS（Universal：iPhone + iPad）
- 工程：`ios/`（Capacitor 生成，已纳入 git；仅忽略 Pods/build/DerivedData）
- Info.plist 权限：Camera, PhotoLibrary, PhotoLibraryAdd（见 `scripts/ios-plist-patch.sh`，`cap sync` 后自动补）
- 方向：iPhone 竖屏+横屏；iPad 四向（含 UpsideDown）
- 备份目录：Documents（iCloud 自动同步）；备份文案按平台显示
- 端侧 AI（Gemma4）/ 悬浮窗 / 快捷拍摄：iOS 首版不支持，已在 Web 层隐藏入口并给出提示
- Clipboard 插件版本与 Capacitor 6 对齐（`^6.0.1`，原 ^8 与核心不兼容已降级）
- iPad 布局：见 `docs/ipad-ios-adaptation.md`
- 依赖 Xcode + CocoaPods：`pod install` 与 Archive 在装好 Xcode 后执行

### Android
- AndroidManifest.xml 权限：Camera, Storage, Media
- 备份目录：EXTERNAL_STORAGE/Download（卸载不丢失）
- file_paths.xml 配置

## 代码规范

### 客户端
- 不添加注释（除非用户要求）
- 所有源码必须为 TypeScript（.ts）
- 新增功能必须按模块化结构放入对应层（data/services/ui/types）
- CSS 内联到 HTML
- UI 逻辑在 src/ui/ 中，通过 main.ts 导出到 window

### 服务端
- 不添加注释（除非用户要求）
- 当前为 TypeScript（ESM，`tsx` 直运），新增路由放 server/src/routes/ 目录
- 遵循现有 upsert + authMiddleware 模式

## Git 提交规则

1. **手动提交**：每次完成功能后，检查 git status 并询问用户是否提交
2. **提交信息格式**：`功能描述 - 简短说明`
3. **不自动提交**：禁用自动提交脚本，避免频繁提交

## 打包规则（重要）

1. **打包前必须先调用 `ship-feature` skill**：每次完成代码修改后，需要打包时必须先加载 `ship-feature` skill，按其中步骤执行
2. **构建命令**：`npm run ship -- "功能描述"`（源码在 worktree 但 APK 输出到原项目根目录，默认从 worktree 构建）
3. **APK 输出**：项目根目录得到 `question-bank-local_YYYYMMDD_HHMM.apk`
4. **更新记录**：`PROJECT_MEMORY.md` 会自动追加记录

## 开发文档索引

> 本索引是项目开发文档的目录。AI执行任何操作前必须先查询此文件，锁定相关历史文档路径。
> 新增文档后必须在此追加条目。

### Bug修复文档

| 文档名称 | 问题摘要 | 存储路径 | 创建日期 | 关联模块 |
|---------|---------|---------|---------|--------|
| 修复版本勾选框点击不灵敏 | label包裹checkbox导致Android WebView双触发 | docs/fix-version-checkbox-double-toggle.md | 2026-07-13 | 版本勾选, 添加题目表单, 题目详情 |
| 修复版本勾选同步缺陷 | versions字段在同步时被丢弃，新设备无法获取版本信息 | docs/fix-version-sync-missing.md | 2026-07-16 | 同步, dbBuildSyncPayload, dbApplyRemoteSnapshot |
| 同步数据丢弃检测与UI风险提醒机制 | 数据指纹检测+版本信息丢弃检测+警告弹窗 | docs/sync-data-integrity-detection.md | 2026-07-16 | 同步, 数据完整性, UI警告 |
| 修复 PDF 书库同步、试读与下载问题 | 同步错误 JSON 化、浏览器试读回退与 Blob 下载 | docs/fix-pdf-library-three-issues.md | 2026-07-26 | 同步, PDF 书库, 服务端, UI |
| 修复 PDF 预览 Invalid PDF structure | Capacitor readFile 返回 base64 字符串被误作 ArrayBuffer 导致 Blob 构造错误 | docs/fix-pdf-preview-invalid-structure.md | 2026-07-26 | PDF 预览, Capacitor 文件系统 |
| 补齐 pdf-library 缺失的 topic 函数 | main.ts 引用了 showAddTopicModal 等 5 个函数但 pdf-library.ts 未实现 | docs/fix-pdf-preview-invalid-structure.md | 2026-07-26 | PDF 书库, 专题管理 |
| 本地 CI/CD 测试体系 | 代码修改后立即跑 typecheck+build+E2E，对齐 GitHub CI | docs/local-cicd-pre-push-testing.md | 2026-07-26 | CI/CD, 测试流程 |
| 服务端数据库迁移恢复 | 旧服务端数据安全合并到统一仓库服务端 | docs/server-database-migration-recovery.md | 2026-07-26 | 服务端, SQLite, 账号, PDF书库 |
| 修复 LLM Wiki 知识编译流水线 | UI编译入口未接通+接口割裂+links不持久化+预算/队列死代码+实体去重失真+图谱随机连线+JSON静默失败+服务端无CRDT等12项 | docs/fix-llm-wiki-pipeline.md | 2026-07-31 | LLM Wiki, 编译流水线, 视觉OCR, 实体对齐, 服务端合并 |
| 修复 UI 迁移回归（相册缩略图+原生门控+双重初始化） | window原生标志未赋值+initApp被注释+app.js/main.ts双重绑定submit导致一次创建两条+Playwright数据污染，13个commit修复 | docs/fix-migration-native-gating-regression.md | 2026-08-27 | 相册缩略图, 原生门控, 双重初始化, app.js移除, Playwright隔离 |
| 修复 Android 端输入框光标失效（文字总插入到末尾） | android.captureInput:true 使 WebView 返回 dummy BaseInputConnection，输入法拿不到光标位置，文字只能追加到末尾；移除该配置恢复 Chromium 真实输入连接 | docs/fix-android-cursor-jump-to-end.md | 2026-08-28 | Capacitor 配置, Android WebView, 输入框, IME |
| 修复后台恢复后已选标签不显示 | loadTags() 替换 allTags 引用后未刷新已选区+renderFormSelectedTags 静默失败无日志；loadTags 末尾同步刷新+防御性 warn+addFormTag 渲染后验证重试 | docs/fix-form-tag-selected-after-resume.md | 2026-08-29 | 添加题目表单, 标签选择, loadTags |
| 状态提示统一化（错误弹窗+操作反馈 toast） | showStatus 写入藏在添加题目卡片内的 #status-message，其他栏目/滚动后不可见且 error 不消失；收口点分流：error→#error-modal 全局弹窗（z-index 2000，手动关闭），success/info→#toast 顶部悬浮 3 秒自动消失 | docs/fix-status-feedback-unified.md | 2026-08-29 | showStatus, 全局弹窗, toast, UI 提示 |
| 重写 app.spec.js E2E | 图片 file input 移除+标签选择改搜索式+状态提示走 toast+导出按钮改名；改用数据层造带图题目并拆分 4 条独立用例 | docs/fix-app-spec-rewrite.md | 2026-09-01 | E2E, Playwright, 备份导出, PDF |
| modal-anchor-overlap 固有竞态 | 长尾用例在 applyModalPosition 的 rAF 写入 top 前断言重叠，失败率约 40% 且失败集合漂移；泛化 waitModalSynced 并补齐 8 处插入点后连续 3 次 27/27 全绿 | docs/fix-modal-anchor-flaky.md | 2026-09-01 | E2E, 弹窗锚定, 测试稳定性 |
| settings 整行替换抹字段风险修复 | `{ ...settings }` 改 `{ ...prev, ...settings }`（routes/sync.ts + server-sync.ts），删除 cloud_providers/appVersions 硬编码保护；副带修好「清空 cloud_providers 永远清不掉」 | docs/quick-import-favorite-tags.md 第五节 | 2026-09-04 | 服务端, user_settings, 同步 |

### 功能设计文档

| 文档名称 | 摘要 | 存储路径 | 创建日期 | 关联模块 |
|---------|------|---------|---------|--------|
| AI测试基础设施E2E扩展与加固 | 教学内容关联题库 + Web E2E测试 + Seed Fixture + CI模板 | docs/ai-test-harness-e2e-extension.md | 2026-07-16 | AI管线, 题库关联, E2E测试, Playwright |
| 可视化同步状态与操作模块（修订版） | 顶部状态条 + 复用已有接口 + 失败状态追踪 + 修复showSyncStatus缺失 | docs/visual-sync-status-module.md | 2026-07-19 | 同步, UI, 状态显示 |
| PDF云书库全栈实现 | 服务端TS迁移+模块化 + PDF上传/试读/下载 + 双维度类目 + 标签复用 + sync集成 | docs/pdf-cloud-library.md | 2026-07-25 | 服务端, PDF书库, 同步, UI |
| 快速导入栏常见标签列表 | 逐项状态合并+rev判知情+按标签粒度冲突弹窗（v3）；离线可改永不静默丢弃；栏高补偿改 rAF 动态测量；settings 整行替换风险一并修复 | docs/quick-import-favorite-tags.md | 2026-09-04 | 快速导入, 标签, user_settings, 服务端, E2E |
| iPad/iPhone(Universal) iOS 版本开发 | iOS 骨架+Web降级+iPad布局+依赖Xcode说明 | docs/ipad-ios-adaptation.md | 2026-07-19 | iOS工程, 平台降级, iPad适配 |
| Windows备用服务器 | 服务器间同步 + PM2常驻 + canvas可选化 + 客户端切换UI | docs/windows-backup-server.md | 2026-07-27 | 服务端, Windows, 同步, 客户端 |
| Wiki最小MVP（重新构建） | 选题目→OpenRouter视觉模型→卡帕西原则结构化知识，旧wiki保留未动 | docs/wiki-mvp-design.md | 2026-08-01 | Wiki MVP, OpenRouter, 视觉模型, 知识结构 |
| 本地OCR服务备选方案 | PaddleOCR+UniMERNet本地识别文字/公式 → 免费纯文本LLM提取，与视觉模型模式并存 | docs/local-ocr-service.md | 2026-08-01 | OCR, PaddleOCR, UniMERNet, 纯文本LLM, 本地服务 |
| UI 整体迁移至明亮友好型风格 | DESIGN.md 契约+token 重写+组件层重构+42 个 TS 文件硬编码清理 | docs/ui-migration-bright-friendly.md | 2026-08-03 | UI, 设计系统, 视觉语言, 设计债 |
| 架构可视化模型（Architecture Visualization 插件） | C4 系统上下文/容器 DSL + 客户端四层依赖 DOT + 同步流程 Mermaid + 证据索引 | docs/architecture/artifact-summary.md | 2026-08-05 | 架构模型, C4, Graphviz, 证据索引 |
| 一键问题反馈与 GitHub Issues 自动提交 | 截图监听（Android 插件+iOS 通知桥接）+ 反馈表单 + 服务端中转 + 图片存 feedback-assets 分支 + 离线重试队列 | docs/auto-issue-feedback.md | 2026-08-27 | 问题反馈, GitHub Issues, 服务端, 原生插件 |
| E2E 隔离测试账号与数据快照 | 专用测试账号 + 主账号标签/题目快照复制脚本 + 测试数据与真实账号隔离 | docs/e2e-test-account.md | 2026-08-28 | 测试基建, 数据隔离, 服务端 |
| PDF 排版引擎 v5 集成 | planLayout 纯函数引擎替换 pdf.ts + 单双栏自动分组 + 长图切割 + 修复试卷导出空白 | docs/pdf-layout-engine-v5.md | 2026-08-28 | PDF 生成, 排版引擎, generatePDF, 试卷导出 |
| 快速导入题目模式 | 顶部悬浮确认条 + 相册最新两张自动配对（第1张=答案/第2张=题目）+ 版本组合 + 栏数切换 + 切回前台自动刷新 | docs/quick-import-mode.md | 2026-08-28 | 快速导入, 相册, 版本组合, UI |
| 快速导入「添加文字笔记」 | 确认左侧「📝 笔记」按钮展开输入区（≤500字），文字写入既有 question_notes.text_note（复用笔记体系，同步零改动）；含版本皮肤下对比度修复与展开态 padding 补偿 | docs/quick-import-text-note.md | 2026-08-30 | 快速导入, 题目笔记, UI, 可见性测试 |
| 弹窗锚点定位重构 | 以 quick-import-bar 为锚点正下方渲染的统一锚点定位，翻转/限高滚动，resize/scroll/显隐同步 | docs/modal-anchor-reposition.md | 2026-08-31 | 弹窗, 锚点定位, quick-import, 可见性 |
