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
| 顶部条 | fixed 吸顶常驻，含缩略图＋交换 / 标签输入 / 组合 / 栏数 / 确认 |

## 交互流程

1. 点工具栏「⚡ 快速导入」→ 顶部悬浮条常驻（`body` 加 150px `padding-top` 避免遮挡）
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

- 单测：`unit-tests/quick-import.spec.ts`（24 个用例）覆盖组合 CRUD、配对算法、指纹去重与淘汰、栏数持久化、建题入参组装。
- E2E：`tests/ui-health.spec.js` 的「快速导入题目」describe（5 个用例）覆盖开关与降级提示、组合创建、标签输入与移除、栏数切换与持久化、设置不被清空。

**E2E 账号隔离**：这些用例只操作 localStorage 与本地 IndexedDB，不登录、不同步、不调服务端。若将来需要登录态，只能用 `.env` 的 `E2E_TEST_PHONE`，禁止用主账号（见 `docs/e2e-test-account.md`）。

## 已知限制

- **组合不随账号同步**，存在 localStorage（与 `appVersions` 一致）。需要跨设备时得扩展 sync payload。
- 只检测到 1 张新照片时不配对，提示补拍（避免建出错题）。
- 顶部条固定高度约 150px，设备差异大时调 `render()` 里的 `paddingTop`。
- Web 环境无原生相册插件，顶部条会提示「当前不是原生环境」，确认按钮禁用。
