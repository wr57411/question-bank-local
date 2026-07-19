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
- [ ] 执行 ship 打包验证

**违反检查清单 = 产出不可信。**

## 项目信息

- **项目路径**: `/Users/john/question-bank-local`
- **类型**: 本地题库 App（iOS + Android，基于 Capacitor）
- **原项目参考**: `/Users/john/question-bank-app`

## 技术栈

- 前端：HTML + JavaScript（无框架）
- 本地存储：IndexedDB（localForage）
- 图片处理：Cropper.js + Canvas
- PDF 生成：jsPDF
- 原生打包：Capacitor 6
- 插件：@capacitor/camera, @capacitor/filesystem

## 适配清单

### iOS
- Info.plist 权限：Camera, PhotoLibrary, PhotoLibraryAdd
- 备份目录：Documents（iCloud 自动同步）
- CocoaPods 依赖管理

### Android
- AndroidManifest.xml 权限：Camera, Storage, Media
- 备份目录：EXTERNAL_STORAGE/Download（卸载不丢失）
- file_paths.xml 配置

## 代码规范

- 不添加注释（除非用户要求）
- CSS 内联到 HTML
- JS 内联到 HTML 底部
- 单文件结构，方便维护

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

### 功能设计文档

| 文档名称 | 摘要 | 存储路径 | 创建日期 | 关联模块 |
|---------|------|---------|---------|--------|
| AI测试基础设施E2E扩展与加固 | 教学内容关联题库 + Web E2E测试 + Seed Fixture + CI模板 | docs/ai-test-harness-e2e-extension.md | 2026-07-16 | AI管线, 题库关联, E2E测试, Playwright |
| 可视化同步状态与操作模块（修订版） | 顶部状态条 + 复用已有接口 + 失败状态追踪 + 修复showSyncStatus缺失 | docs/visual-sync-status-module.md | 2026-07-19 | 同步, UI, 状态显示 |
