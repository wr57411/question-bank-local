# `www/` 删除时抢救出的 3 个文件归档（2026-09-12）

> 本目录是 **被 git 跟踪的安全副本（attic / 阁楼）**，不是临时草稿。
> 原因：原 `www/` 目录今天被删除，但删除时发现其中 **3 个文件在仓库其它地方没有任何副本**，
> 已从 git 抢救到 `tmp/www-orphans/`。而 `tmp/` 是 gitignored（不进版本控制），
> 把副本留在 `tmp/` 不安全——将来做决策时可能找不到这些说明。
> 故按用户要求，把它们原样安置到这个被 git 跟踪的目录，并写清历史背景。

**面向的读者**：几周后的你自己，或另一个 AI 会话——当你在犹豫「这 3 个文件能不能永久删掉」时，请先读这份说明。

---

## 0. TL;DR（先读这段）

- 这 3 个文件**今天已不在 `www/`、`www/` 也已从工作区删除**（删除处于「已暂存 / 未提交」状态，当前 HEAD `1c55b8a` 仍含它们）。
- **这 3 个文件本身没有任何代码 import / require / `<script src>` 引用**（见第 4 节）——即「无引用」成立。
- 但「无引用」**不等于「可以草率删」**。其中：
  - `gemma4-plugin.ts` 定义的 `Gemma4` 插件契约，正是端侧 AI 功能（`src/services/ai.ts`、`src/ui/ai-model-ui.ts`、`public/ai.js` 均完好）在运行时通过 `window.Capacitor.Plugins.Gemma4` 使用的接口；其 Web mock 还被 `public/app.js` 内联实现**重复**了一份。删掉它不会丢功能，但会丢一份「干净的独立插件模板」。
  - 两个 PDF 原型 HTML 的**引擎逻辑已集成进 `src/data/pdf-layout-engine.ts`**，PRD 是设计依据。删掉不会丢运行时代码，但会丢「为什么这样做」的历史理由。
- **端侧 AI 是项目明确保留的功能**，不是被移除项（见 `docs/plans/2026-09-04-feature-removal.md`、`docs/plans/2026-09-11-chapters-topics-tag-categories.md`）。所以 `gemma4-plugin.ts` 属于「暂时没找到引用」，而非「确认死代码」。
- 当前 HEAD 里这 3 个文件**仍然存在**，是本归档之外的权威副本。即使本目录或 `tmp/` 副本丢失，也能从 git 取回（见第 6 节）。

---

## 1. 它们是什么（逐个文件说明）

### 1.1 `gemma4-plugin.ts`（1943 字节）

一个 **Capacitor 插件注册源码（TypeScript）**，内容已打开确认：

- 引入 `@capacitor/core` 的 `registerPlugin`。
- 定义 `Gemma4Plugin` 接口，含 5 个方法：
  - `checkModelStatus()` → `{ ready, downloaded, path }`
  - `discoverModel()` → `{ found, ready, error? }`
  - `analyzeQuestion(options: { prompt? })` → `QuestionAnalysis`（含 `summary` / `difficulty` / `tags`）
  - `recommendQuestions(options: { requirement })` → `RecommendResult`（含 `reason`）
  - `unloadModel()` → `void`
- 用 `registerPlugin<Gemma4Plugin>('Gemma4', { web: () => ({ ... }) })` 注册，并提供一套 **Web 端 mock 实现**（打印 `[Gemma4 Web Mock] ...`，返回假数据）。
- 末尾把插件挂到 `window.Capacitor.Plugins.Gemma4`，并 `export default Gemma4`。

**性质判断**：这是端侧 AI（Gemma4）插件的「Web 端注册 + mock」源码。它的接口契约与 Android 原生实现 `android/app/src/main/java/com/questionbank/local/Gemma4Plugin.java`（`@CapacitorPlugin(name = "Gemma4")`）一一对应，也和所有调用方（`src/ui/ai-model-ui.ts`、`src/ui/tag-suggest.ts`、`src/ui/test-god-mode.ts`、`public/app.js` 等通过 `window.Capacitor.Plugins.Gemma4` 调用）一致。

**关键点**：本文件**从未被任何源码 `import`**（见第 4 节），而**同等的 Web mock 已经内联在 `public/app.js` 第 24 行起**（`if (!window.Capacitor.Plugins.Gemma4) { window.Capacitor.Plugins.Gemma4 = {...} }`）。因此本文件在 `www/` 里大概率是「早期独立模板」，运行时真正生效的 Web 兜底来自 `public/app.js`，原生实现来自 `Gemma4Plugin.java`。

### 1.2 `pdf-text-normalize-prototype.html`（28903 字节）

已打开确认：一个**可交互的「PDF 排版原型 v4」**单文件 HTML（标题 `<title>PDF 排版原型 v4</title>`）。

- 左侧面板：上传题目图片、选检测方式（Canvas 启发式 / OCR）、设目标文字高度（mm）、全部单栏/双栏、分析+排版、导出 PDF、清空。
- 右侧面板：A4 实时预览、翻页、切割标记。
- 内嵌布局引擎（`buildPages()` 等，基于队列、纯迭代、O(n) 文字高度检测、`MIN_SPLIT=25mm` 长图切割）。
- 依赖 `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`（**注意：用了 CDN，离线打不开 jsPDF**）。

**性质判断**：这是 PDF 文字归一化 + 智能排版的**可运行原型**，用来在浏览器里实证「上传顺序单栏组在前 / 双栏组在后 / 组间强制翻页 / 同页不混排 / 长图按 25mm 切割」等排版规则。它的引擎已被集成进 `src/data/pdf-layout-engine.ts`（`MIN_SPLIT = 25`、单/双栏、组间翻页、长图切割逻辑一致）。即：**原型已完成使命，逻辑进了主代码**。

### 1.3 `pdf-text-normalize-prototype-PRD.html`（20498 字节）

已打开确认：这是上述功能的**产品需求文档（PRD）**单文件 HTML（标题含「产品需求文档 (PRD)」，元信息显示「创建日期：2026-08-14」「状态：原型验证中」「所属项目：question-bank-local」）。

- 含：产品概述（背景——`src/data/pdf.ts` 只做等比缩放、文字大小差异大）、目标用户与场景、产品目标（文字大小偏差 < ±15%、< 500ms/张）、功能需求表（R01 文字高度检测、R02 归一化缩放、R03 A4 实时预览、R04 PDF 导出……带优先级与状态）、以及后续的排版/切割/性能等非功能性需求。
- 同样**非可执行代码**，是设计依据文档。

**性质判断**：这是 PDF 文字归一化功能的**需求与设计说明**。它解释了「为什么 `src/data/pdf.ts` / `src/data/pdf-layout-engine.ts` 要做文字归一化」——这段理由在代码里看不到，删了就只剩「结论」。

---

## 2. 它们从哪来

- 原本位于仓库根的 **`www/`** 目录。
- `www/` 的性质：**历史遗留副本**。项目早已迁移到 `src/`（TypeScript 源码）+ `public/`（静态资产，Vite 拷贝到 `dist/`），Capacitor 的 `webDir` 是 `dist`。`www/` 不在打包链路里（`vite build` 产出 `dist/`，不会产出 `www/`）。
- 删除原因（见 `docs/plans/2026-09-12-d8-backup-fix.md` §7.2，方案 A，2026-09-12 采纳）：
  - `www/db.js` 与 `public/db.js` 已不一致；
  - 单测 helper `unit-tests/helpers/load-db.js` 原本读 `www/db.js`，本次改为读 `public/db.js`（让单测验证活代码）；
  - 既然 `www/` 不在打包链路且内容与活代码脱节，决定整体删除 `www/`。
- 删除时发现：**这 3 个文件在仓库其它地方没有副本**（其余 `www/` 文件要么是 `public/` 的陈旧拷贝、要么在别处有源），于是从 git 抢救到 `tmp/www-orphans/`，再转入本归档目录。

---

## 3. git 历史（原始查询输出）

### 3.1 `www/gemma4-plugin.ts`

```
--- full history (--follow --oneline) ---
27ad465 对抗式审查BUG修复 - 26个BUG全部修复：tokenize崩溃、JNI数据竞争、缓存失效补全、volatile修复、相机资源释放、progressListener泄漏、接口对齐、临时文件清理、try/finally资源释放
1ed0940 Gemma 4 集成：MediaPipe 真实推理引擎 + AI 分析 + 模型下载 + 更新功能修复

--- first added (diff-filter=A) ---
1ed0940 2026-04-20 Gemma 4 集成：MediaPipe 真实推理引擎 + AI 分析 + 模型下载 + 更新功能修复

--- last changed (most recent) ---
27ad465 2026-07-10 对抗式审查BUG修复 - 26个BUG全部修复：...
```

- **首次加入**：`1ed0940`，**2026-04-20**
- **最后改动**：`27ad465`，**2026-07-10**
- 共 2 个提交改动过它。

### 3.2 `www/pdf-text-normalize-prototype.html`

```
--- full history (--follow --oneline) ---
fa49568 PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页

--- first added (diff-filter=A) ---
fa49568 2026-08-29 PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页

--- last changed (most recent) ---
fa49568 2026-08-29 PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页
```

- **首次加入 = 最后改动**：`fa49568`，**2026-08-29**（仅一个提交，引入即定型）。

### 3.3 `www/pdf-text-normalize-prototype-PRD.html`

```
--- full history (--follow --oneline) ---
fa49568 PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页

--- first added (diff-filter=A) ---
fa49568 2026-08-29 PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页

--- last changed (most recent) ---
fa49568 2026-08-29 PDF导出接入自动分组排版引擎 - layout_type快速混合排版+长图切割+修复试卷导出空白页
```

- **首次加入 = 最后改动**：`fa49568`，**2026-08-29**（与排版原型同一次提交引入；PRD 元信息写「创建日期 2026-08-14」，是文档内自述，与 git 提交日不同，以 git 为准）。

### 3.4 `www/` 目录本身何时出现

```
=== www/ 目录首次出现（所有新增文件中最早的一次提交，按日期排序取前 5）===
8d678e9 2026-04-01 init: 本地题库 App - 离线题库管理，支持 iOS/Android
307e7b8 2026-04-02 restore: 恢复完整项目源码
1ed0940 2026-04-20 Gemma 4 集成：MediaPipe 真实推理引擎 + AI 分析 + 模型下载 + 更新功能修复
27ad465 2026-07-10 对抗式审查BUG修复 - 26个BUG全部修复
7f90e4b 2026-07-17 AI测试基础设施 - 通用Skill + 题库关联 + E2E测试
```

- `www/` 目录**最早出现于 `8d678e9`，2026-04-01**（init 提交）。也就是说 `www/` 是项目最早期的 Web 资产目录，后来被 `dist/`（`public/` + `src/`）取代。

### 3.5 删除状态说明（重要）

当前 `www/` 的删除是**工作区已暂存、尚未提交**（`git status` 显示 `D www/...`）。所以：
- **当前 HEAD（`1c55b8a`）仍包含这 3 个文件**——这是本归档之外的权威副本。
- 还没有「删除提交」。一旦删除被 commit，再用 `git log --diff-filter=D` 才能找到删除它的提交（见第 6 节）。

---

## 4. 当前有无引用（实际搜索结果）

搜索范围：全仓，排除 `node_modules/`、`.git/`、构建产物（`dist/`、`android/app/build/`、`android/app/src/main/assets/`、`android/build/`）。

### 4.1 这 3 个文件名 / 路径，是否有代码引用

- 对 `gemma4-plugin` 的全仓搜索，**唯一命中是文件自身**（`tmp/www-orphans/gemma4-plugin.ts`），**无任何 `import` / `require` / `<script src="...gemma4-plugin.ts">`** 指向它。
- 对 `pdf-text-normalize-prototype` 的全仓搜索，命中**仅限文档提及**（见下），**无代码引用**。
- 结论：**这 3 个文件本身「无引用」成立**。

### 4.2 间接 / 概念引用（关键，别被「无引用」误导）

`gemma4-plugin.ts` 定义的 `Gemma4` 接口，被大量代码在**运行时**通过 `window.Capacitor.Plugins.Gemma4` 使用（这些是「按名字用插件」，不是「按文件名引用本文件」）：

- `src/ui/ai-model-ui.ts`、`src/ui/tag-suggest.ts`、`src/ui/test-god-mode.ts`
- `public/app.js`（第 25 行起还内联了一份 Web mock，与本文件功能重叠）
- `android/app/src/main/java/com/questionbank/local/Gemma4Plugin.java`（`@CapacitorPlugin(name = "Gemma4")`，原生实现）
- `android/app/src/main/java/com/questionbank/local/MainActivity.java:16`（`registerPlugin(Gemma4Plugin.class)`）

→ 所以 `gemma4-plugin.ts` 是「**按接口被使用、按文件名未被引用**」。端侧 AI 功能完好，删本文件不丢功能，但丢一份独立模板。

两个 PDF 原型被文档引用（指向旧 `www/` 路径，现已删）：
- `docs/superpowers/plans/2026-08-28-pdf-layout-engine-v5.md`（称其为排版引擎来源，`buildPages()`）
- `docs/pdf-layout-engine-v5.md`（同样引用 `www/pdf-text-normalize-prototype.html` v4）

→ 这些文档引用现在已「悬空」（指向已删的 `www/` 文件）。属于历史文档，不影响构建，但说明原型曾是可追溯的来源。

### 4.3 与「`www/` 能否整体删除」相关的其它悬空引用（影响判断，但与本 3 文件无关）

`www/` 删除后，仓库里**仍有指向其它已删 `www/` 文件**的引用，需注意：

1. **`tests/ai-simulation.spec.js:6`**
   `await page.goto('file://' + path.resolve(__dirname, '../www/index.html'));`
   → 指向已删的 `www/index.html`（**不是**本归档的 3 个文件）。
   → 该 spec 已被 `playwright.config.js` 的 `testIgnore`（第 67–70 行，同时排除 `ai-simulation.spec.js` 与 `ai-pipeline-e2e.spec.js`）移出收集范围，**当前不进 CI**，所以删除 `www/` 不会让 CI 红。
   → 风险：若将来有人重新启用该 spec，它会因 `www/index.html` 不存在而 404。

2. **`.ai-test-harness.json:4-5`**
   `"aiFunctions": ["www/ai.js"]`、`"extractFrom": "www/index.html"`
   → 指向已删的 `www/ai.js`、`www/index.html`（**不是**本归档的 3 个文件）。
   → 这是 AI 测试 harness 的配置，同样不在 CI 常规范围。

3. **配置类**
   - `eslint.config.js:25`：`ignores: ['dist/', 'www/', 'node_modules/']`——忽略 `www/`，无害。
   - `design.qa.yaml:18`：`- www/**` 在 `exclude` 列表——设计 QA 不扫 `www/`，无害。

4. **大量历史文档**（`docs/*.md`、`docs/plans/*.md`、`memory-bank/*.md`）提及 `www/index.html` / `www/db.js` / `www/ai.js`——纯文档，不影响构建。

> 注意：按本次任务约束，我**没有修改** `tests/ai-simulation.spec.js`、`.ai-test-harness.json`，仅在本文记录。是否把它们的引用改指向 `public/index.html` + `public/ai.js` 或删除这些 spec，是**另一项独立决策**，建议另开任务处理（见第 7 节）。

---

## 5. 为什么不能草率删掉

「无引用」有两种可能，必须区分：

| 可能 | 含义 | 本 3 文件属于哪种 |
|------|------|-------------------|
| A. 确实是死代码 | 功能已移除 / 已被更好实现取代，永不恢复 | 两个 PDF 原型偏近 A（引擎已进 `src/data/pdf-layout-engine.ts`，PRD 是历史理由） |
| B. 暂时没找到引用 | 功能仍保留，只是本文件未被接好线 / 是早期模板 | `gemma4-plugin.ts` 偏近 B（端侧 AI 保留，本文件是未接线的独立模板） |

用户判断正确：**「没有引用」≠「可以删」**，也可能是 B（暂时没找到原因）。

额外依据——**端侧 AI 是明确保留功能**：
- `src/services/ai.ts`、`src/ui/ai-model-ui.ts`、`public/ai.js` 均完好；
- `docs/plans/2026-09-04-feature-removal.md` 明确把「端侧 AI（Gemma4/LlamaBridge/llama.cpp/ai.ts/ai-model-ui.ts）」列为**全部保留**；
- `docs/plans/2026-09-11-chapters-topics-tag-categories.md` 同样写「端侧 AI … 全部不动」；
- `docs/ios-execution-spec.md` 说明 Gemma4 在 iOS 上明确降级（非缺陷），Android 上可用原生实现。

因此 `gemma4-plugin.ts` 不是「被放弃的功能的残渣」，而是「一个仍被需要、但当前没被接到构建链上的插件模板」。即便决定最终不要它，也应先确认 `public/app.js` 的内联 mock 已足够、且原生 `Gemma4Plugin.java` 不受影响，再删。

---

## 6. 如果需要复活，怎么恢复

### 6.1 现在就能取回（当前 HEAD 仍含这些文件）

```bash
# 直接看内容
git show HEAD:www/gemma4-plugin.ts
git show HEAD:www/pdf-text-normalize-prototype.html
git show HEAD:www/pdf-text-normalize-prototype-PRD.html

# 取回成文件
git show HEAD:www/gemma4-plugin.ts > /tmp/gemma4-plugin.ts.rescued
```

> 因为删除目前还没 commit，上面命令现在就有效。本归档目录 `docs/attic/www-removed-20260912/` 也是可用副本。

### 6.2 若删除已 commit 后取回

先找「删除提交」：

```bash
git log --diff-filter=D --oneline -- www/gemma4-plugin.ts
git log --diff-filter=D --oneline -- www/pdf-text-normalize-prototype.html
git log --diff-filter=D --oneline -- www/pdf-text-normalize-prototype-PRD.html
```

假设找到删除提交 `<DEL>`，取回删除前那一版（`^` 或 `~1`）：

```bash
git show <DEL>^:www/gemma4-plugin.ts > gemma4-plugin.ts
```

或用 reflog 回到删除前：

```bash
git show <删除前commit>:"www/gemma4-plugin.ts"
```

### 6.3 复活后应该放哪里（判断依据）

- **`gemma4-plugin.ts`（Capacitor 插件注册）**：
  - 若只是想让 Web 端也有一份「独立、可被 import 的插件注册模块」，应放到 **`src/` 下合适的插件目录**（例如 `src/plugins/gemma4.ts`），并由 `src/main.ts` 或对应入口 `import`，替换掉 `public/app.js` 里那段内联 mock（避免两份 mock 逻辑漂移）。
  - **注意**：原生实现 `Gemma4Plugin.java` 不受此文件影响；本文件只管 Web 端注册与 mock。
  - 判断依据：当前 `src/` 中**没有任何 `registerPlugin(...)` 调用**（已确认），Web 端 Gemma4 完全靠 `public/app.js` 内联兜底。所以「复用本文件」=「把 Web mock 从内联提升为正式模块」，是代码整理，不是功能恢复。
- **两个 PDF 原型 HTML**：
  - 引擎逻辑已在 `src/data/pdf-layout-engine.ts`，**无需复活代码**。
  - 若复活，建议留在 `docs/` 下作为设计史料（例如 `docs/attic/` 或 `docs/architecture/`），不要放回 `www/`（因为 `www/` 已不在打包链路）。
  - 若想在浏览器里重新跑原型做对比验证，可放到 `public/` 下临时目录或本地临时路径，跑完即删。

---

## 7. 决策建议（待决策选项）

| 选项 | 内容 | 适用判据 | 风险 |
|------|------|----------|------|
| **A. 永久删除** | 确认这 3 个文件确实不再需要，从 git 与归档中删除 | 需先确认：①端侧 AI 的 Web mock 已由 `public/app.js` 覆盖且不再打算抽成独立模块；②PDF 引擎已稳定集成、PRD 不再被引用；③未来不会因 iOS/跨平台需要回看插件契约 | 低风险（功能不依赖本文件），但**会永久丢失接口契约模板与设计理由**；建议先留 1~2 个版本周期再删 |
| **B. 迁到某处复用** | `gemma4-plugin.ts` → `src/plugins/gemma4.ts` 并解除 `public/app.js` 内联 mock；两个 HTML → `docs/architecture/` 作为史料 | 想把 Web 端 Gemma4 注册正规化、消除两份 mock 漂移；或想保留可点击的 PRD/原型供后人参考 | 中工作量（需改 `public/app.js` + 加 import）；先做更值 |
| **C. 保留归档（本目录现状）** | 维持 `docs/attic/www-removed-20260912/` 作为 git 跟踪的安全副本 | 暂不确定、想给未来留决策空间（**当前最稳妥**） | 近乎零风险；只是仓库多一小目录 |

**当前推荐**：**C（保留归档）**。理由——端侧 AI 是保留功能、`gemma4-plugin.ts` 属于「暂时没找到引用」而非死代码；PDF 原型/PRD 是设计依据，留着成本低、丢了难补。等确认 `public/app.js` 内联 mock 长期够用、且 PDF 引擎稳定后，再考虑 A 或 B。

**附带的独立待办（不在本任务范围，未改动）**：`tests/ai-simulation.spec.js` 与 `.ai-test-harness.json` 仍指向已删的 `www/index.html` / `www/ai.js`。建议另开任务决定：要么把它们改指向 `public/index.html` + `public/ai.js`，要么在确认端侧 AI 暂不维护的情况下删除这两个 spec / 更新 harness 配置。当前因 `playwright.config.js` 的 `testIgnore` 已排除 `ai-simulation.spec.js`，不影响 CI。

---

## 附：本归档与 `tmp/www-orphans/` 的关系

- 抢救链：`www/`（git，HEAD 仍含） → `tmp/www-orphans/`（gitignored 临时副本，用户手救） → `docs/attic/www-removed-20260912/`（**本目录，git 跟踪**）。
- `tmp/www-orphans/` 下的 3 个副本，在确认与本目录文件**字节一致**（`diff` 比对通过）后应可删除；`tmp/` 不进版本控制，留着反而误导。
- 文件完整性校验：3 个文件在 `tmp/www-orphans/` 与本目录的字节数一致（1943 / 28903 / 20498），`diff` 无差异。
