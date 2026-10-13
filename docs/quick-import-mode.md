# 快速导入题目模式

日期：2026-08-28 ｜ 关联模块：快速导入, 相册, 版本组合, UI ｜ 计划：`docs/plans/2026-08-28-quick-import.md`

## 背景

手动录入一道题需要点很多次：选图、裁剪、勾版本、选栏数、输标签、提交。连拍一批题时这个成本被放大 N 倍。

快速导入模式把除标签外的所有字段都变成"一次设置、长期有效"的默认值，把交互压缩成：**拍两张 → 切回来 → 输标签 → 点确认**。

## 产品决策

| 项 | 结论 |
|---|---|
| 取图 | 相册最近两张，**第 1 张（最新）＝答案图，第 2 张（次新）＝题目图**（因为先拍题目、后拍答案） |
| 粒度 | 逐题，每对图各自输标签，确认一次建 1 道 |
| 下一组 | 确认后重新刷新相册，再取最新两张 |
| 版本组合 | 用户自建「组合一 / 组合二 / …」，在顶部条点组合徽标弹面板管理 |
| 单双栏 | 顶部条直接点切换，持久化，并同步表单原位置的 radio |
| 顶部条 | fixed 吸顶常驻，**三行**：缩略图＋交换 / 标签输入框（独占整行）/ 组合＋栏数＋确认 |

## 顶部条布局（三行）

```
行1  [题 56] [答 56] [⇄]  [已选标签 chips 横滚]
行2  [🏷 搜索或新建标签，回车确认]        ← 独占整行，高 44px、字号 15px
行3  [高三专用 ▾] [双]          [✅ 确认]
```

- **行 2 独占整行**：早期版本输入框和三个按钮挤在一行，只剩很窄一条、高 33px，手指很难一次点中。独占整行后宽度约 250px+、高度 44px。
- **行 3 的「xxx ▾」是组合显示名，由用户在组合面板里自定义**：存在 `VersionCombo.displayName`，
  在组合面板每个组合的输入框里填，留空则显示组合名本身。
  首字规则（`SHORT_NAME_RULES`）只在新建组合时给出一个默认建议值，用户可随意改动，
  代码不再强制决定显示内容。组合按钮的 `title` 仍显示完整组合名与版本列表。
- **行 3 的「双」是栏数**：只占一个字（`单` / `双`），点击切换；toast 提示用完整文案（`layoutFullLabel`）。
- 候选标签 chip 用小尺寸样式（`src/ui/quick-import.ts` 的 `tagCandidateChip`），具体像素以代码为准。

## 交互流程

1. 点工具栏「⚡ 快速导入」→ 顶部悬浮条常驻（`body` 加 196px `padding-top` 避免遮挡）
2. 切到相机拍两张：**先拍题目、再拍答案**
3. 切回 App → 自动读取相册最新两张，缩略图带「题」「答」角标
4. 顺序反了 → 点「⇄」交换
5. 在顶部输入标签（候选 chip / 回车创建 / ✕ 移除）
6. 点「✅ 确认」→ 建题 → 清空标签 → 重新刷新相册载入下一对
7. 没拍新照片就切回来 → 提示「相册没有新照片」，不重复导入

## 设置持久化策略（三者不同，别搞混）

| 设置 | 存储键 | 默认 | 确认提交后 |
|---|---|---|---|
| 版本组合 | `activeVersionComboId` | 首次自动建「组合一」（含全部版本） | **保留** |
| 单双栏 | `quickImportLayoutType` | `1`（单双栏均可） | **保留** |
| 标签 | 无（内存） | 空 | **清空** |

组合与栏数是"长期设置"，标签是"每题数据"。

## 模块结构

```
src/services/version-combo.ts   版本组合 CRUD（localStorage，纯函数可单测）
src/services/quick-import.ts    照片配对算法 / 已导入指纹 / 栏数持久化 / 建题入参组装
src/ui/quick-import.ts          悬浮条渲染 / 标签输入 / 组合面板 / 确认建题 / 前后台刷新
src/ui/camera.ts                新增 fetchLatestMedias / getGalleryImageDataUrl（被 galleryThumbClick 复用）
src/index.html                  #quick-import-bar 悬浮条 + #quick-combo-panel 组合面板
```

数据流：

```
切回前台
  → refreshGalleryPair()
  → fetchLatestMedias(6)              [原生 MediaGallery，DATE_ADDED DESC]
  → pickQuestionAnswerPair(medias, importedIds)
      跳过已导入 → fresh[0]=answer, fresh[1]=question
  → 渲染缩略图（用 media.data 缩略图，不加载原图）

点确认
  → getGalleryImageDataUrl(identifier) × 2   [加载原图]
  → compressImage(1200, 0.8)
  → buildQuickCreateArgs(q, a, tags, combo.versionIds, loadQuickLayoutType())
  → dbCreateQuestion(...)
  → markImportedIds([questionId, answerId])  [旧→新，见下方坑 3]
```

## 三个必须知道的实现细节

**1. 已导入指纹防重复**

`confirmQuickImport` 后会把这对图的 identifier 记进 `quickImportImportedIds`（上限 200，最新在前，超出淘汰最旧）。下次取图时跳过。没有这个机制，没拍新照片切回来会反复导入同一对图。

**2. 原生门控现场自算**

`nativeFlags()` 每次从 `window.Capacitor.isNativePlatform()` 重新判断，不读 `w.isNative` 缓存。历史事故见 `docs/fix-migration-native-gating-regression.md`。

**3. `markImportedIds(idsOldestFirst)` 的入参顺序**

必须按时间正序（旧→新）传，即 `[pair.question.identifier, pair.answer.identifier]`。函数内部 reverse 成"最新在前"再存。传反不会报错，但淘汰策略会先丢新图。参数名已用 `idsOldestFirst` 固化这个约定。

## 其他约束

- 组合面板的版本勾选用 `div` + 手动 click，**不能用 `<label>` 包 checkbox**（Android WebView 双触发，见 `docs/fix-version-checkbox-double-toggle.md`）。
- 标签输入保留 150ms 轮询补偿（Android WebView 的 `oninput` 不可靠，见 `docs/fix-android-cursor-jump-to-end.md`）。

## 测试

- 单测：`unit-tests/quick-import.spec.ts`（34 个用例）覆盖组合 CRUD、配对算法、指纹去重与淘汰、栏数持久化、版本简称默认值、建题入参组装。
- E2E：`tests/ui-health.spec.js`（共 27 个用例）的「快速导入题目」describe（6 个用例）覆盖开关与降级提示、组合创建、标签输入与移除、栏数切换与持久化、设置不被清空、组合按钮显示自定义名称。
- **可见性 E2E**：`tests/quick-import-visibility.spec.js`（4 个用例）+ 公共工具 `tests/helpers/visibility.js`。
  这是 2026-08-29 白字白底事故后补的——普通 E2E 用 `toContainText` 断言 DOM，抓不住"文字存在但肉眼看不见"。
  该套件对每个控件截图并检查：非隐藏/透明、宽高 > 0、在视口内、未被遮挡、文字没被 CSS 截断、
  **文字/背景对比度 >= 3**。详见 `AGENTS.md` 的「E2E 截图评估要求」。
  可见性 E2E 必须使用**手机视口**（如 390×844）才能发现真机布局问题，Playwright 默认 1280px 宽测不出按钮截断或溢出；
  其中包含组合按钮宽度随名称动态伸缩的用例，验证超长自定义名正确省略、普通长度不被截断。

## 白字白底事故（2026-08-29）

顶部条的组合、栏数、交换三个按钮在真机上完全看不见。原因：

- 全局 `main.css:86` 有 `button{background:linear-gradient(...);color:#fff}`
- 我在 `index.html` 里给这三个按钮覆盖了 `background:var(--surface)`（白底），但**没覆盖 `color`**
- 结果白字叠白底，对比度 1.00

修复：三个按钮都补 `color:var(--text)`。
**教训**：覆盖 `background` 时务必同时覆盖 `color`，UI 改动必须过可见性 E2E。

**E2E 账号隔离**：这些用例只操作 localStorage 与本地 IndexedDB，不登录、不同步、不调服务端。若将来需要登录态，只能用 `.env` 的 `E2E_TEST_PHONE`，禁止用主账号（见 `docs/e2e-test-account.md`）。

## 已知限制

- **组合不随账号同步**，存在 localStorage（与 `appVersions` 一致）。需要跨设备时得扩展 sync payload。
- 只检测到 1 张新照片时不配对，提示补拍（避免建出错题）。
- 顶部条固定高度约 196px（三行布局），设备差异大时调 `render()` 里的 `paddingTop`。
- Web 环境无原生相册插件，顶部条会提示「当前不是原生环境」，确认按钮禁用。
