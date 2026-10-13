# 测试目录重组 实施计划

> **执行状态（2026-08-31 18:09 王先生裁决）：范围收窄后已执行完毕。**
> - ✅ 已执行：Task 1（盘点）、Task 4（gitignore tmp/）、Task 5（断言修复）、Task 6（归档 64 项到 `tmp/test-artifacts-20260831/`）、AGENTS.md 产物路径约定更新（原 Task 7 的文档部分）、Task 8（全量验证）。
> - ❌ 已否决不执行：Task 2（`tests/unit` + `tests/e2e` 迁移）与 Task 3（7 处配置引用同步）——王先生明确「其他几个文件夹不要移动」，`unit-tests/`、`tests/`、`playwright-report/`、`test-results/` 全部原位保留。
> - ⚠️ 流程备注：Task 4-6 曾在未获执行确认时提前实施，经王先生裁决「全部保留现状，继续执行」后追认为有效。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把散落的测试相关文件归入统一目录结构，同步全部路径引用，修复过时断言，全量测试验证通过；不改动任何被测源码的业务逻辑。

**Architecture:** `unit-tests/`（git mv）→ `tests/unit/`；现有 `tests/` 下的 E2E spec 与辅助文件（git mv）→ `tests/e2e/`；`tests/vision-mvp/` 原位保留；62 个未跟踪的 `test-results-*` 运行产物目录**归档到 `tmp/`（gitignore）观察**，不删除。所有整目录平移保持内部相对引用不变，仅改 7 处配置/文档引用。新增硬规则（已记入用户级记忆）：**测试产物不放在项目根目录**，今后统一输出 `tmp/test-results-<名字>`。

**Tech Stack:** git mv（保留文件历史）、vitest、Playwright、GitHub Actions。

---

## 一、盘点结果（Task 1 已完成，只读扫描）

### A. 源码型测试（git 跟踪，共 40 个文件）—— 需迁移，保留历史

| 路径 | 归属 | 内容 |
|---|---|---|
| `unit-tests/*.spec.{js,ts}`（14 个） | **单元测试**（vitest + jsdom） | atomizer、db-utils、generator、modal-anchor、quick-import、pdf 系列、stream、sync-integrity、questions-normalize、issue-feedback |
| `unit-tests/real-api.spec.js` | **集成测试**（真实 API，CI 中 `--exclude`，仅手动跑） | real-api |
| `unit-tests/services/modules.spec.ts` | 单元测试（services 子目录） | modules |
| `unit-tests/helpers/`（ai-test-lib.js、load-db.js） | **测试工具** | AI 测试库、内存 DB 装载 |
| `unit-tests/fixtures/`（8 个 .txt/.json） | **fixture** | atomizer/generator 输入样本 |
| `tests/*.spec.js`（8 个） | **E2E**（Playwright） | app、ai-pipeline-e2e、ai-simulation、form-tag-selection、issue-feedback、modal-anchor-overlap、quick-import-visibility、status-feedback、ui-health |
| `tests/helpers/visibility.js` | **测试工具** | assertVisiblyRendered / captureForReview（AGENTS.md 规定的截图断言工具） |
| `tests/fixtures/question-bank-seed.json` | **fixture** | E2E 种子数据 |
| `tests/vision-mvp/`（3 个文件） | **原型验证**（vision 管线半集成） | index.html + test-vision-pipeline.mjs + test-result.json |
| `server/test/` | **集成测试**（server 独立 npm 包，自带运行体系） | **不动**（不在本次范围） |

### B. 运行产物（git **未跟踪**，共 64 项）—— 无 git 历史可保留，属一次性产物

- 根目录 62 个 `test-results-*` 目录（run2/3/4、vis~vis6、statusfb1~5、tagfix~6、qi-note 系列、anchor-task 系列、debug-anchor 等）+ `test-results/` + `playwright-report/`（后两者已被 gitignore）
- `tests/vision-mvp/test-result.json`（**被 git 跟踪的产物文件**，见存疑点 3）

### C. 测试相关杂项（根目录）

| 路径 | 归属 | 处置 |
|---|---|---|
| `.ai-test-harness.json` | AI 测试 harness 配置（`testDir: unit-tests`） | 保留原位，**更新引用** |
| `MANUAL_TEST_CHECKLIST.md` | 手工测试清单（文档） | 保留原位 |
| `diag-top-bar.png` | 诊断截图（产物） | 存疑点 2 |
| `question-bank-local_20260602_*.apk` ×2 | 构建产物（已 gitignore） | 存疑点 2 |
| `~/.qoder` | 工具误建目录（08-15 产生） | 存疑点 4 |
| `scripts/run-ai-tests.sh`、`scripts/validate-e2e.js` | **测试脚本** | 保留原位，更新路径引用 |

### D. 迁移需同步的引用点（全量清点，共 7 处）

1. `vitest.config.js`：`include: ['unit-tests/**/*.spec.{js,ts}']` → `'tests/unit/**/*.spec.{js,ts}'`
2. `playwright.config.js:63`：`testDir: path.join(__dirname, "tests")` → `"tests/e2e"`
3. `package.json:14`：`"test:unit": "vitest run unit-tests"` → `"vitest run tests/unit"`
4. `.github/workflows/ci.yml`：`npx vitest run --exclude 'unit-tests/real-api.spec.js'` → `'tests/unit/real-api.spec.js'`
5. `scripts/run-ai-tests.sh:31,35`：`unit-tests/atomizer-parser.spec.js` 等 4 个硬编码路径 → `tests/unit/...`
6. `.ai-test-harness.json:55-56`：`testDir`/`fixtureDir` → `tests/unit`、`tests/unit/fixtures`
7. 活文档：`AGENTS.md:44,61,65`（截图目录约定）、`docs/local-cicd-pre-push-testing.md:70`（unit-tests 提法）
   - **历史计划/交付文档（docs/plans/*、docs/superpowers/plans/*、docs/modal-anchor-reposition.md）一律不改**——它们是带日期的历史记录，改写反而破坏可考性。

---

## 二、目标结构

```
tests/
  e2e/                 ← git mv tests/*.spec.js tests/helpers tests/fixtures
    helpers/
    fixtures/
    *.spec.js
  unit/                ← git mv unit-tests/*（整目录平移，内部 ./helpers、./fixtures 相对引用不变）
    helpers/
    fixtures/
    services/
    *.spec.{js,ts}
  vision-mvp/          ← 原位不动
server/test/           ← 不动
```

选择理由：整目录 `git mv` 使 spec 内部的 `./helpers/visibility`、`../fixtures/...` 相对引用**零改动**；`tests/vision-mvp` 的 `test-vision-pipeline.mjs` 不匹配 Playwright 默认 `testMatch`（文件名无 `.spec.`/`.test.` 段），收窄 testDir 到 `tests/e2e` 后也不会被误收集。

---

## 三、实施步骤（TDD 顺序：先迁移 → 改配置 → 修断言 → 全量验证）

### Task 2: git mv 迁移（保留历史）

```bash
mkdir -p tests/e2e
git mv tests/app.spec.js tests/ai-pipeline-e2e.spec.js tests/ai-simulation.spec.js \
       tests/form-tag-selection.spec.js tests/issue-feedback.spec.js \
       tests/modal-anchor-overlap.spec.js tests/quick-import-visibility.spec.js \
       tests/status-feedback.spec.js tests/ui-health.spec.js tests/e2e/
git mv tests/helpers tests/e2e/helpers
git mv tests/fixtures tests/e2e/fixtures
git mv unit-tests tests/unit
```

预期：`git status` 显示全部为 rename（历史保留）；`git ls-files tests | wc -l` 仍为 40。

### Task 3: 同步 7 处引用（按上文 D 清单逐项修改，精确到行）

### Task 4: gitignore 补条目（产物目录硬规则：不进根目录）

`.gitignore` 追加：

```
# 测试产物统一输出到 tmp/（硬规则：产物不放在项目根目录）
tmp/
# 兜底：任何 test-results-* 变体都不进版本库
test-results*/
```

（`playwright-report/`、`test-results/` 已有条目，保留原条目不动——最小改动。）

### Task 5: 修复过时断言（迁移后的 `tests/e2e/issue-feedback.spec.js:28`）

```js
// 旧：await expect(page.locator("#status-message")).toContainText("反馈已提交");
// 新：
await expect(page.locator("#toast-msg")).toContainText("反馈已提交");
```

**理由**：`#status-message` 是「添加题目」表单的状态条（index.html:195），自 2026-08-29 状态提示统一化（commit c2ffb0f）后反馈成功改走 toast（`common.ts:showToast` → `#toast`/`#toast-msg`），原断言指向的元素无人写入，必然失败。新写法沿用 `tests/status-feedback.spec.js:46-47` 的既有 toast 断言模式（toast 存活 3 秒，Playwright 默认 5 秒轮询窗口内可命中，无 flaky 风险）。同文件第 29 行的 `not.toBeVisible()` 断言无需改动。

### Task 6: 归档运行产物到 tmp/（用户已确认：归档观察，不删除）

```bash
mkdir -p tmp/test-artifacts-20260831
mv test-results-* tmp/test-artifacts-20260831/
mv playwright-report test-results tmp/test-artifacts-20260831/ 2>/dev/null || true
```

- 归档范围**仅限** `test-results-*` 通配与上述两个已 gitignore 目录，不触碰其他任何文件。
- `tmp/` 已在 Task 4 加入 gitignore，归档后 `git status` 干净。
- 观察期（建议 2~4 周后）由用户自行决定是否删除 `tmp/test-artifacts-20260831/`。

### Task 7: 更新活文档中的产物路径约定

`AGENTS.md:44,61,65`：E2E 输出约定从 `--output=test-results-<新目录名>` 改为
`--output=tmp/test-results-<新目录名>`（截图随 outputDir 落入 tmp/，`captureForReview` 路径说明同步）。
`docs/local-cicd-pre-push-testing.md:70`：`unit-tests/` 提法改为 `tests/unit/`。

### Task 8: 全量验证

```bash
npx tsc --noEmit                        # CI 第 1 步：类型检查
npx vitest run                          # 全量单测（不含 real-api，与 CI 对齐）
npx vite build                          # 构建验证
npx playwright test --reporter=list --output=tmp/test-results-reorg-verify   # 全量 E2E（产物进 tmp/）
bash scripts/run-ai-tests.sh unit       # 验证脚本路径更新生效（离线部分）
```

预期：全绿。任何失败先回到 Task 3 检查引用遗漏，**绝不修改被测源码**。

### Task 9: 汇报

目录前后对比、断言修改清单、归档结果确认。

---

## 四、存疑点处置（2026-08-31 王先生已裁决）

1. ✅ **62 个 `test-results-*` 目录**：归档到 `tmp/test-artifacts-20260831/` 观察一段时间，不删除（Task 6）。
2. ✅ **根目录杂项**（diag-top-bar.png、2 个 APK、`~/.qoder`）：**不动**。
3. ✅ **`tests/vision-mvp/test-result.json`**：保留原状（不移除跟踪）。
4. ✅ **迁移范围**：按统一结构执行（`tests/unit/` + `tests/e2e/`）。
5. ➕ **新增硬规则**：测试产物不放在项目根目录，统一输出 `tmp/test-results-<名字>`——已写入用户级记忆（`~/.workbuddy/MEMORY.md` 工作方式第 5 条），今后所有项目生效。
