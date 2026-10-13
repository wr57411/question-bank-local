# 项目协作规则

## 工作流程

1. **先出方案**：收到需求后，先写计划（做什么、怎么做、影响范围），不做实现
2. **等用户确认**：用户同意方案后，再开始编码
3. **遇到问题及时沟通**：实施过程中发现新问题，先暂停并告知用户

### 硬规则：未经明确指令不得改代码（2026-09-12 王先生要求）

**触发条件**：用户没有说出「开始执行计划」或同等明确的开工指令时。

**允许**：出计划 / 写文档 / 只读排查（读代码、只读查库、跑只读诊断脚本）。
**禁止**：修改、新增、删除任何源码与配置；包括"顺手修一下""既然发现了就一起改"。

**必须等待的句式**：用户明确说出「开始执行计划」（或等价的明确批准）后，才可动代码。

> 事故记录（2026-09-12）：曾因"用户已批准方案方向与参数"而自行推定可以开工，
> 在计划未获正式批准前改动了 3 个文件。经王先生纠正后全部回退。
> 教训：**批准方案方向 ≠ 批准开工**。二者是两次独立的确认，不可合并推定。

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

### 数据层双实现警告（2026-09-14 实测，改数据层前必读）

**`src/` 不等于线上在跑的代码。** `src/index.html` 先加载**经典脚本** `/db.js`、`/ai.js`，再加载 `<script type="module" src="/main.ts">`（`dist/index.html:980-981` 相同）；而 `src/main.ts` 的 `assignIfMissing()` 只在 `typeof w[key] === 'undefined'` 时才挂载。经典脚本先执行、module 默认 defer 后执行 → **`db.js` 里定义过的名字，TS 实现运行时从不生效**。

- `assignToWindow()`（`main.ts:11-15`，强制覆盖 → TS 赢）：已接管 **271** 个名字
- `assignIfMissing()`（`main.ts:17-23`，让位 → 旧 JS 赢）：**62** 个，其中 **28** 个与旧 JS 重叠（= 待搬家清单）
- 因此 `src/data/sync.ts` 是影子层，`src/data/notes.ts` 几乎全影子（唯一活路径是 `src/init-app.ts:16-18` 的一次性 backfill）
- 要改同步/笔记行为 → 改 `public/db.js`，而它还有 `www/`、`dist/`、`android/app/src/main/assets/public/` 三份拷贝

**判定方法（别靠读代码猜）**：

```bash
NODE_OPTIONS= npx playwright test --config=tmp/probe.config.js --reporter=list --output=tmp/test-results-probe -g "线上实际生效"
```

迁移方案见 `docs/plans/2026-09-14-legacy-js-retirement.md`。

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
6. **本规则对所有新功能一视同仁（2026-09-17 补充）**：不只是"改动既有 UI"时适用——
   新增任何会产生可见结果的区域（结果区、弹层、状态提示），其用例**必须**对关键元素调用
   `assertVisiblyRendered`。
   > 事故记录（2026-09-17）：语义检索的以图搜/文字搜结果区 `#semantic-results` 渲染在 91 张题目卡片
   > **之后**（页面最底部）、而触发按钮在视口顶部，真机上用户"完全看不到结果，以为没反应"。
   > 当时 T9 的 E2E 用例只做 `toContainText` 断言**照样通过**——与 8-29 事故同构，规则没执行到位。
   > 修复：结果区移到搜索框正下方 + 渲染后 `scrollIntoView({block:'center'})` + 视口内断言。

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

**多 worktree 端口劫持（2026-09-14 实测，会静默测错代码）**：`playwright.config.js` 用的是
`reuseExistingServer: !process.env.CI`，而本机多个 worktree 并行时谁先起 vite 谁占 3000。
实测撞到过：`lsof -nP -iTCP:3000 -sTCP:LISTEN` 显示占用进程的 cwd 是**另一个 worktree**，
于是 E2E 读到的是别人的 `src/index.html`。

- 排查：`lsof -p <PID> | grep cwd`，看是不是本 worktree
- 规避：用本 worktree 的独立端口配置（如 `tmp/e2e3100.config.js`：`--port 3100` + `reuseExistingServer: false`），或 `CI=1`（端口被占直接报错，比静默测错强）
- 少数 spec 硬编码了 `BASE_URL = "http://127.0.0.1:3000"`（如 `tests/tablet-grid-layout.spec.js:19`），换端口跑会把它们跑红——那是配置副作用，不是回归
- 跑完确认服务归属：3000 上的进程 cwd 应是本 worktree

## 测试分层与真实链路验证（2026-09-17 复盘结论，强制）

**背景**：语义检索功能 E2E 全绿（104 passed）后，真机阶段仍暴露 7 个问题——其中 5 个是测试体系缺口，
不是代码偶然失误。**E2E 绿 ≠ 真机可用**：现有 E2E 全部 `page.route` mock HTTP，是"mock 世界里的验证"。

**四层验证，缺一不可**：

| 层 | 覆盖什么 | 怎么做 | 拦住了什么（实例） |
|---|---|---|---|
| 1. 单元 / E2E（mock） | 逻辑正确性 | `npm run test`、`npx playwright test` | 渲染逻辑、弹层交互、回归 |
| 2. **真实链路**（连真实 server + 真实模型） | 部署态、配置传递、真实分数分布 | `tests/semantic-diag.spec.js`（真实登录/向量下发/编码接口；不可达时自动 skip） | 服务端跑旧代码 404、`init-app` 悬空引用拿不到凭据 |
| 3. **真实数据校准** | 与真实数据分布强相关的参数 | `server/embed/calibrate_threshold.py`（建库后跑，输出分数分布与建议阈值） | `SEMANTIC_MIN_SCORE=0.35` 过高导致全部结果被滤 |
| 4. **产物 / 部署态** | 打包产物内容、部署后接口可用性 | `scripts/verify-apk-assets.sh`、`scripts/verify-server-deploy.sh` | 手机包不含接线代码、服务进程跑旧目录代码 |

**硬规则**：
- 涉及外部服务/模型的**新增功能**，必须补第 2 层用例；不可达时以 `test.skip` 守卫，不得制造假失败。
- 调参类常量（阈值等）必须用第 3 层基于**真实数据**校准，禁止拍脑袋取值。
- 打包后跑第 4 层产物断言；服务改动部署后跑部署探针（health + 关键路由状态 + 进程 cwd）。
- **提交前 E2E 用串行跑**（`--workers=1`）：并发跑会产生资源竞争假阳性（2026-09-17 实测 8 例假失败，
  单独重跑全过），而串行才是能暴露跨 spec 竞态与真 bug 的权威口径（同日串行抓到"文字搜防抖覆盖图片搜结果"真竞态）。

## 项目信息

- **项目路径**: `/Users/john/question-bank-local`
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

1. **统一提交（2026-09-15 王先生修订）**：多任务流水线执行期间，AI 不逐任务询问提交；全部功能完成、本地四连绿通过、且用户真机验收通过后，统一一次 commit（附功能说明），再按用户指令 push。单点小修复仍可在完成后询问是否提交
2. **提交信息格式**：`功能描述 - 简短说明`
3. **不自动提交**：禁用自动提交脚本，避免频繁提交。用户不看代码 diff，验收对象是运行效果与打包产物（APK/真机行为），不是代码

## 打包规则（重要）

1. **打包前必须先调用 `ship-feature` skill**：每次完成代码修改后，需要打包时必须先加载 `ship-feature` skill，按其中步骤执行
   - ⚠️ 2026-09-15 实测：该 skill 已不在技能目录（`~/.workbuddy/skills/`）里，AGENTS.md 这一条与现状脱节；`npm run ship` 本身可用（脚本即 `scripts/ship-feature.sh`），但见下一条的 `BUILD_SOURCE` 陷阱
2. **构建命令**：`BUILD_SOURCE=current npm run ship -- "功能描述"`
   - ⚠️ **必须显式带 `BUILD_SOURCE=current`**：脚本默认 `BUILD_SOURCE=worktree` 指向 `/Users/john/.codex/worktrees/f640/question-bank-local`（**另一条路径且该目录确实存在**），不带就会打出不含本次改动的 APK
3. **APK 输出**：原项目根目录（`/Users/john/question-bank-local`）得到 `question-bank-local_YYYYMMDD_HHMM.apk`
4. **更新记录**：该目录的 `PROJECT_MEMORY.md` 会自动追加记录

## 服务端部署路径（2026-09-17 实测，改服务端代码必读）

服务端由 **launchd** 托管，且**代码与数据分离**：

| 项 | 值 |
|---|---|
| LaunchAgent | `~/Library/LaunchAgents/com.questionbank.ts-server.plist` |
| **加载代码的目录** | `/Users/john/.codex/worktrees/f640/question-bank-local/server`（plist 的 `WorkingDirectory`） |
| 数据文件 | `/Users/john/question-bank-local/server/data.db`（`DB_PATH`）→ **主仓只放数据文件** |
| 日志 | 该 worktree 的 `server.log` / `server-error.log` |
| 重启 | `launchctl kickstart -k gui/501/com.questionbank.ts-server` |
| 查看配置 | `launchctl print gui/501/com.questionbank.ts-server` |

- **部署 = 把新代码放进上表那个目录 + kickstart 重启。** "合并进主仓"对服务端代码**没有任何作用**（主仓只有数据文件）。
- Node **不热加载**：改完必须重启；`ensureColumn` 之类的启动期迁移只在重启时执行一次。
- 改 plist 后需 `launchctl bootout` + `bootstrap`（在沙箱 agent 里 bootstrap 会 EIO，需人工执行）。
- 那条 worktree 可能**同时有他人未提交改动**（如嵌入服务的 `question_embeddings`）→ 落地前先记录目标文件 `md5`，落地后用 `diff` 自检"只多了预期行"。
- 另有 `com.questionbank.embed`（uvicorn，`127.0.0.1:3002`）= 嵌入/语义搜索服务。

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
| 修复题目标签形状契约回归 | main.ts 数据层全局由 assignIfMissing 改强制覆盖后，app 从 legacy public/db.js 的 buildTagIndex（`{tags:{...}}`）切到模块版扁平 `{id,name,color}`，而 UI 仍按 `qt.tags.*` 读取 → `undefined.color` 崩溃；形状不一致自 2026-07-25 潜伏、因渲染路径从未走到而未暴露；修复：UI 7 处对齐扁平契约 + dbGetAllPapers 题数 + 级联后刷新 + ui-health 用例 | docs/fix-qtag-shape-regression.md | 2026-10-09 | main.ts, buildTagIndex, question-core, question-detail, papers, E2E |
| 笔记图片字段名与版本展示顺序修复 | TS 写端 `image_url` 改 `note_image_url`（对齐旧实现/服务端列名/已有数据，唯一活路径是 init-app 的一次性 backfill）；同毫秒写入多条笔记导致详情页默认显示的可能不是题图 → 展示层新增 `sortNoteVersions`（撞车时 笔记 v1 恒首、手写笔记按序号、id 兜底） | docs/quick-import-handwritten-note.md 第五、七节 | 2026-09-15 | question_notes, 排序, 题目详情, 多图片版本 |
| 修复标签关联同步（契约在 TS、运行时跑 db.js） | 关联的「带版本实体」契约在 TS 侧实现完整、单测全绿，但 `dbBuildSyncPayload`/`dbApplyRemoteSnapshot` **从未挂到 window**，运行时跑的是 `public/db.js` 老实现 → push 不发 `question_tags`（上行 100% 丢）+ pull 用服务端 `tag_ids` 整题替换（本地独有关联被静默抹掉）。修：push 补发 `question_tags`（缺时间戳兜底 **1970 而非 now**，因服务端 `normalizeTimestamp` 会把空值填成 now 从而复活存量墓碑）+ pull 改逐条时间戳合并且「关联不受题目 updated_at 守卫约束」+ `_collectQuestionTagIds` 过滤墓碑 + `dbCreateQuestion` 补四字段。**服务端零改动**。含先红后绿证据 | docs/fix-qtag-dbjs-sync-not-wired.md | 2026-10-13 | 同步, question_tags, 影子数据层, 服务端 push, 标签, 数据安全 |

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
| 语义检索（WeMM-2B 混合搜索与相似题） | 文字语义搜/以图搜题/详情页找相似题；Python 编码微服务(懒加载+空闲卸载) + question_embeddings 向量表 + 客户端本地余弦检索 + 静默降级；91 题盲测 L3 Recall@5 0.93 vs 现有 0.00；实施计划 docs/plans/2026-09-15-semantic-search.md，评测 tmp/wemm-eval/report.md | docs/semantic-search-wemm2b.md | 2026-09-15 | 语义检索, WeMM-Embedding, FastAPI, Express, E2E |
| 一键问题反馈与 GitHub Issues 自动提交 | 截图监听（Android 插件+iOS 通知桥接）+ 反馈表单 + 服务端中转 + 图片存 feedback-assets 分支 + 离线重试队列 | docs/auto-issue-feedback.md | 2026-08-27 | 问题反馈, GitHub Issues, 服务端, 原生插件 |
| E2E 隔离测试账号与数据快照 | 专用测试账号 + 主账号标签/题目快照复制脚本 + 测试数据与真实账号隔离 | docs/e2e-test-account.md | 2026-08-28 | 测试基建, 数据隔离, 服务端 |
| PDF 排版引擎 v5 集成 | planLayout 纯函数引擎替换 pdf.ts + 单双栏自动分组 + 长图切割 + 修复试卷导出空白 | docs/pdf-layout-engine-v5.md | 2026-08-28 | PDF 生成, 排版引擎, generatePDF, 试卷导出 |
| 快速导入题目模式 | 顶部悬浮确认条 + 相册最新两张自动配对（第1张=答案/第2张=题目）+ 版本组合 + 栏数切换 + 切回前台自动刷新 | docs/quick-import-mode.md | 2026-08-28 | 快速导入, 相册, 版本组合, UI |
| 快速导入「添加文字笔记」 | 确认左侧「📝 笔记」按钮展开输入区（≤500字），文字写入既有 question_notes.text_note（复用笔记体系，同步零改动）；含版本皮肤下对比度修复与展开态 padding 补偿 | docs/quick-import-text-note.md | 2026-08-30 | 快速导入, 题目笔记, UI, 可见性测试 |
| 弹窗锚点定位重构 | 以 quick-import-bar 为锚点正下方渲染的统一锚点定位，翻转/限高滚动，resize/scroll/显隐同步 | docs/modal-anchor-reposition.md | 2026-08-31 | 弹窗, 锚点定位, quick-import, 可见性 |
| 功能移除（8 项 + 相似题 + ocr-server） | 移除 AI教学/书库/Wiki/悬浮窗/待处理/待补拍/专题/相似题/ocr-server；SQL 表全保留；同步键摘除；删 6 个废弃分支；-8700 行 | docs/plans/2026-09-04-feature-removal.md | 2026-09-04 | 功能移除, 同步, 服务端路由, E2E, 分支清理 |
| PDF 打印字号可配置 + 双栏版面修复 | targetTextMM 实测为死参数（分子分母约掉）改绝对目标 rw=clamp(w×stemMM/tH,0.35×栏宽,栏宽)+尺寸感知栏位；双栏栏宽去横向 CPAD 81→93mm；导出弹窗 pt 挡位+localStorage+实测回显 | docs/pdf-print-size-and-column-width.md | 2026-09-07 | PDF 生成, 排版引擎, 导出弹窗, 打印字号 |
| PDF 导出页面设置（边距 + 标题） | 导出弹窗加「页面设置」折叠区（上/下/左右 0–30mm + 标题/副标题显隐）；`deriveTopReserveMM` 紧凑公式省 21mm ≈ 7.6% 页高；localStorage `pdfPageSetup` 持久化；空串守卫防 `Number('')===0` 污染；右侧栏 x `AW−SIDE−uwd` 与旧 `AW/2+CGAP/2` 代数恒等（仅形式化重写） | docs/pdf-page-setup.md | 2026-09-09 | PDF 生成, 排版引擎, 导出弹窗, 页面设置 |
| 题目列表单栏/双栏切换布局 | 列数改由 .grid-single/.grid-double 模式 class 接管（删除各断点列数强制）；localStorage 持久化（key question-grid-layout，默认单栏）；列表标题行切换按钮（文案=目标模式）；单栏竖图 height:auto+max-height:420px 全宽可读，双栏保持旧行为；TDD 红灯复现 85×110px bug。附：勾选框缩至 24×24+padding:0（全局 button padding 在 border-box 下撑到 48 的陷阱）+::after 热区 44×44，夹逼断言钉住尺寸；平板适配用容器查询（.question-card container-type:inline-size + @container 220px 阈值 + 外层 max-width:1023.98px 排除桌面），阈值判定依据卡片宽度而非视口断点 | docs/question-list-layout-toggle.md | 2026-09-06 | 题目列表, UI 布局, localStorage, 容器查询, E2E |
| 关联章节 + 专题 + 标签分类体系 | 三者同源同构：标签分类（category_id）→ 标签 → 表达式树（ExprNode 求值+每节点命中题数+死引用）→ 章节/专题（groups kind 区分，成员=表达式命中 ∪ 系统成员标签破格通道）；question_tags 升级为带版本实体（created_at/updated_at/deleted_at + 独立同步键 + 逐条 upsert + 软删墓碑）修 D1/D2/D3/D6；关键裁决 A1/A2/A3/A5/D-b/E6 与 Phase 3 延后 | docs/chapters-topics-tag-categories.md | 2026-10-09 | 标签分类, 章节专题, 表达式求值, 同步链路, 服务端 schema, 备份, 题目列表, 标签管理 UI |
| 快速导入栏手写笔记照片 | 「📝 笔记」改「📎 附加」，展开区内新增拍照/相册最多 5 张手写照片（1600px/0.85），确认时逐张挂成该题的额外图片版本（复用 question_notes，服务端零改动）；含 TS 写端字段名对齐 note_image_url、同毫秒写入导致的展示顺序不确定修复（sortNoteVersions）、退出前未保存确认、影子数据层判定方法 | docs/quick-import-handwritten-note.md | 2026-09-15 | 快速导入, question_notes, 多图片版本, 排序, 影子数据层, E2E |
| 旧版 JS 退场方案 | 实测：数据层双实现并存、`public/db.js` 静默获胜（assignToWindow 已接管 271 个 / assignIfMissing 让位 62 个、其中 28 个重叠）；用 w.NAME 静态扫描得出 116 个旧独有里仅 36 个真被依赖；A–E 五批搬迁顺序 + 四道门禁 + 三个致命地雷（payload 子集/资产上传/缓存失效） | docs/plans/2026-09-14-legacy-js-retirement.md | 2026-09-15 | 架构, 影子数据层, 迁移方案, 同步 |
| 笔记图片压缩统一 + 笔记版本删除 | 补上两条未压缩的笔记图路径（详情页「+ 添加版本」、表单「额外版本」）统一 1600/0.85；题图/答图压缩真闸门在 `public/db.js:427/429/431`（原是默认 800/0.7 → 显式 1600/0.85），快速导入撤销本地预压缩以消除双代 JPEG 损失；笔记版本删除采用**墓碑机制**（服务端 `question_notes.deleted_at` 列 + `hasDeletedAt` + serialize 清图兜底；活数据层写墓碑/过滤/透传；详情页「🗑 删除」按钮）。**部署顺序硬前提：服务端先升级重启，再装新 APK**。附：断言必须能区分新旧值（首次写成 ≤1600 时撤掉修正仍通过） | docs/note-image-compress-and-delete.md | 2026-09-16 | question_notes, 图片压缩, 墓碑删除, 同步协议, 服务端迁移, 活数据层 |
