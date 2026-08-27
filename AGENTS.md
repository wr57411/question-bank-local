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
  - [ ] `npx playwright test tests/ui-health.spec.js`（E2E 测试）
  - 发现问题立即修复，修复后重跑，全部通过才告知用户可手动测试
- [ ] 执行 ship 打包验证

**违反检查清单 = 产出不可信。**

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

### 功能设计文档

| 文档名称 | 摘要 | 存储路径 | 创建日期 | 关联模块 |
|---------|------|---------|---------|--------|
| AI测试基础设施E2E扩展与加固 | 教学内容关联题库 + Web E2E测试 + Seed Fixture + CI模板 | docs/ai-test-harness-e2e-extension.md | 2026-07-16 | AI管线, 题库关联, E2E测试, Playwright |
| 可视化同步状态与操作模块（修订版） | 顶部状态条 + 复用已有接口 + 失败状态追踪 + 修复showSyncStatus缺失 | docs/visual-sync-status-module.md | 2026-07-19 | 同步, UI, 状态显示 |
| PDF云书库全栈实现 | 服务端TS迁移+模块化 + PDF上传/试读/下载 + 双维度类目 + 标签复用 + sync集成 | docs/pdf-cloud-library.md | 2026-07-25 | 服务端, PDF书库, 同步, UI |
| iPad/iPhone(Universal) iOS 版本开发 | iOS 骨架+Web降级+iPad布局+依赖Xcode说明 | docs/ipad-ios-adaptation.md | 2026-07-19 | iOS工程, 平台降级, iPad适配 |
| Windows备用服务器 | 服务器间同步 + PM2常驻 + canvas可选化 + 客户端切换UI | docs/windows-backup-server.md | 2026-07-27 | 服务端, Windows, 同步, 客户端 |
| Wiki最小MVP（重新构建） | 选题目→OpenRouter视觉模型→卡帕西原则结构化知识，旧wiki保留未动 | docs/wiki-mvp-design.md | 2026-08-01 | Wiki MVP, OpenRouter, 视觉模型, 知识结构 |
| 本地OCR服务备选方案 | PaddleOCR+UniMERNet本地识别文字/公式 → 免费纯文本LLM提取，与视觉模型模式并存 | docs/local-ocr-service.md | 2026-08-01 | OCR, PaddleOCR, UniMERNet, 纯文本LLM, 本地服务 |
| UI 整体迁移至明亮友好型风格 | DESIGN.md 契约+token 重写+组件层重构+42 个 TS 文件硬编码清理 | docs/ui-migration-bright-friendly.md | 2026-08-03 | UI, 设计系统, 视觉语言, 设计债 |
| 架构可视化模型（Architecture Visualization 插件） | C4 系统上下文/容器 DSL + 客户端四层依赖 DOT + 同步流程 Mermaid + 证据索引 | docs/architecture/artifact-summary.md | 2026-08-05 | 架构模型, C4, Graphviz, 证据索引 |
