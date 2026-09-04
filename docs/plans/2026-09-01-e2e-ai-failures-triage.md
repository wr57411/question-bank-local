# 3 个 E2E 既有失败排查 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 查明 `tests/app.spec.js:54`、`tests/ai-simulation.spec.js:4`、`tests/ai-pipeline-e2e.spec.js:166` 三个既有 E2E 失败的根因，判断是「测试陈旧」「产品缺陷」还是「环境依赖」，并给出各自的修复方案。

**Architecture:** 三条用例彼此独立，各自按「复现 → 定位契约差异 → 判定性质 → 修复 → 验证」推进。关键方法是把**测试断言的 UI/数据契约**与**当前源码实现**逐项对照，找出脱节点；不改动被测业务逻辑，除非判定为产品缺陷。

**Tech Stack:** Playwright E2E、Playwright config（baseURL `http://127.0.0.1:3000`，webServer 起 vite）、IndexedDB 种子 fixture、TypeScript 源码（src/ui/teaching-verify.ts、src/types/teaching.ts）。

---

## 一、排查结论（Task 0 已完成，只读调查）

### 纠正上一轮的错误定论

上一轮我把这 3 条统称为「AI 型用例」，**这个判断是错的**：三条里只有两条跟 AI 有关，`app.spec.js:54` 与 AI 完全无关，是纯离线主流程测试。

### 逐条结论

| 用例 | 测试目标 | 失败点 | 根因 | 性质 |
|---|---|---|---|---|
| `tests/app.spec.js:54` 可以完成离线主流程并支持调试 | 离线主流程 + XSS 防护回归：建标签 → 建题目 → 筛选/删标签 → 建试卷 → 导出备份 → 下载 PDF → 删题目 → 试卷计数归零，并断言恶意标签名/试卷名不被执行 | `locator('#question-image').setInputFiles` 等 60s 超时（app.spec.js:72） | 测试依赖的 6 个 UI 契约元素在 `src/index.html` 中**已全部不存在**：`#question-image`、`#answer-image`、`#tag-select`、`#status-message`、`#paper-name`、`#paper-tag-select`。添加题目表单已重构为「搜索标签 + 评价生成标签 + 文字笔记 + ✨ 添加题目」 | **测试陈旧**（UI 契约脱节），非产品 bug |
| `tests/ai-simulation.spec.js:4` Gemma 4 智能组卷全链路仿真 | 在 Web 端用 Mock AI 走通全链路：自动发现模型 → AI 状态「已就绪」→ 输入组卷需求 → AI 推荐 → 一键生成试卷 | 加载 `file://<repo>/www/index.html` 后找不到「自动发现模型」入口 | `www/` 是 **2026-08-15 的遗留构建产物**（内含 2026-07-22 的 `ai.js`），早于 TS 全盘迁移，与 `src/` 完全不同步；且项目已明确「端侧 AI(Gemma4) 首版不支持，Web 层隐藏入口」 | **测试陈旧 + 依赖过期构建产物** |
| `tests/ai-pipeline-e2e.spec.js:166` 校验通过流程 | 验证「人工校验通过」落库：AI教学 → 斜面模型分析 → 查看 → 通过 → 节点状态变为校验通过 | 断言 `dbGetTeachingNode('node-002').status === 'VERIFIED'`（:180）拿不到 VERIFIED | `verifyApprove()`（`src/ui/teaching-verify.ts:244-249`）写入的是 **version** 记录：`dbUpdateVersion(ver.id, { status: 'VERIFIED' })`，**不是 node**。node 状态枚举是 `src/types/teaching.ts:9` 的小写 `'pending' \| 'generating' \| 'done' \| 'error' \| 'approved'`，代码里从无 `VERIFIED`；种子 `tests/fixtures/question-bank-seed.json:126` 的 node-002 是 `'GENERATED'`（大写，也不在枚举内） | **测试断言错对象**为主；但 node 枚举里的 `approved` 无人写入，存在产品建模不一致（见存疑点 3） |

### 影响面：CI 是红的

`.github/workflows/ci.yml` 的 e2e job 执行 `npx playwright test`（**全量、无 exclude、无 secrets**）。上述三条失败均为**确定性**失败（`ai-pipeline-e2e` 用种子 fixture + 本地 mock，不调真实 API），因此**每次 push 的 CI e2e 都会红**，与 API key 无关。这一点此前被 `AGENTS.md` 里「ai-* 用例需要 API key」的说法掩盖了。

---

## 二、存疑点（需王先生先裁决，决定后续做什么）

1. **`tests/app.spec.js` 的处置**：重写（按当前 UI 契约，保留 XSS + 备份 + PDF 这三项高价值覆盖，工作量最大）/ 删除（若已有等价覆盖）/ 标 `skip` 待重写。**我倾向重写**：它覆盖的 XSS 防护和备份导出链路，其他 spec 没有等价覆盖。
2. **`www/` 遗留目录**：它仍是 Capacitor 的 web 资产目录（`capacitor.config.ts` 可能指向它）还是已废弃？若已废弃 → `ai-simulation.spec.js` 应直接删除；若仍是构建目标 → 需要重新同步并重写该 spec。
3. **教学节点状态建模（最关键）**：`src/types/teaching.ts:9` 声明 node 可为 `'approved'`，但 `verifyApprove()` 只写 version 的 `'VERIFIED'`，node 的 `approved` 是死值。二选一：
   - (a) **测试改**：断言改为校验 version.status === 'VERIFIED'（改动最小，承认当前产品行为）；
   - (b) **产品改**：`verifyApprove()` 同时把 node.status 置为 `'approved'`（补上死枚举，语义更完整，属产品行为变更）。
   顺带需决定种子数据 `'GENERATED'`/`'PENDING'`（大写）与小写枚举是否要统一。

---

## 三、实施任务（按存疑点裁决后执行）

### Task 1: 固化三条失败的复现证据

**Files:** 只读 + 产物落 `tmp/`

```bash
npx playwright test tests/app.spec.js --reporter=list --output=tmp/test-results-triage-app
npx playwright test tests/ai-simulation.spec.js --reporter=list --output=tmp/test-results-triage-sim
npx playwright test tests/ai-pipeline-e2e.spec.js --reporter=list --output=tmp/test-results-triage-pipeline
```

预期：`app.spec` 报 `#question-image` 超时；`ai-simulation` 报找不到「自动发现模型」；`ai-pipeline-e2e` 仅 `校验通过流程` 一条失败（同文件其余用例应全过，证明管线本身健康）。

### Task 2: 处置 `app.spec.js`（按存疑点 1 的裁决）

**Files:** Modify: `tests/app.spec.js`

先做 UI 契约调研（不改代码）：读取 `src/index.html` 的「添加题目」区与「试卷管理」区，列出当前可用的输入元素 id，产出「旧契约 → 新契约」映射表，例如：

| 旧契约 | 当前是否可用 | 替代 |
|---|---|---|
| `#question-image` / `#answer-image` | ❌ 不存在 | 待调研（当前表单走相册/拍照或拖拽？） |
| `#tag-select`（`<select multiple>`） | ❌ 不存在 | 搜索标签 + chip 选择区 |
| `#status-message .status` | ❌ 已被状态统一化移除 | `#toast-msg` |
| `#paper-name` / `#paper-tag-select` | ❌ 不存在 | 待调研 |

然后按裁决执行：重写（推荐）/ 删除 / 加 `test.skip` 并注明原因。

**Step（重写路线）**：按新契约重写用例 → 运行 → 确保其余断言（XSS `__tagXss`/`__paperXss` 为 false、备份 JSON 字段、PDF `%PDF` 魔数、删除后计数归零）全部通过。

验证：`npx playwright test tests/app.spec.js --reporter=list --output=tmp/test-results-triage-app2` → 全绿。

### Task 3: 处置 `ai-simulation.spec.js`（按存疑点 2 的裁决）

**Files:** Modify/Delete: `tests/ai-simulation.spec.js`

若 `www/` 已废弃：删除该 spec，并在计划文档记录删除理由。
若 `www/` 仍是 Capacitor web 资产目录：说明该 spec 依赖的 Mock AI 在新构建中是否还在（grep 新构建产物里是否有「自动发现模型」），再决定重写为 dev-server 版本还是删除。

验证：删除或重写后，`npx playwright test tests/ai-simulation.spec.js` 不再产生失败。

### Task 4: 修正 `ai-pipeline-e2e.spec.js:166` 的断言（按存疑点 3 的裁决）

**Files:** Modify: `tests/ai-pipeline-e2e.spec.js:166-181`（必要时 Modify: `src/ui/teaching-verify.ts:244-249`）

路线 (a)（测试改，最小改动）：把断言从 node 改为 version：

```js
const versionStatus = await page.evaluate(async () => {
  const node = await dbGetTeachingNode('node-002');
  const ver = await getCurrentVersion(node);
  return ver?.status;
});
expect(versionStatus).toBe('VERIFIED');
```

路线 (b)（产品改）：`verifyApprove()` 中在写 version 后补充 node 状态，同时断言改为 `'approved'`。

**Step 1**：先按路线写测试并跑，确认失败（未能复现要防的问题时说明原因）。
**Step 2**：实施对应改动。
**Step 3**：`npx playwright test tests/ai-pipeline-e2e.spec.js --reporter=list --output=tmp/test-results-triage-pipeline2` → 全绿。
**Step 4**：回归同文件其余 AI 管线用例（题库加载、节点渲染、校验 Modal、关联题目等）全部仍通过。

### Task 5: CI 影响处理

**Files:** 视裁决可能 Modify: `.github/workflows/ci.yml`

- 修完三条后，CI 的 `npx playwright test` 应全绿；
- 若某条用例短期内不修（如 `app.spec` 决定延后重写），需在 CI 中显式排除或标记为 quarantine，避免长期红灯掩盖真实回归。

### Task 6: 全量验证与汇报

```bash
npx tsc --noEmit
npx vitest run --exclude 'unit-tests/real-api.spec.js'   # 与 CI 对齐
npx playwright test --reporter=list --output=tmp/test-results-triage-final
```

预期全绿（`real-api.spec.js` 依赖外部 AI 接口，CI 本就排除，不计入）。汇报：三条用例各自的目标、根因、性质判定、处置结果、CI 状态变化。

---

## 四、对抗性自评（本结论在什么情况下不成立）

1. **`app.spec.js` 判定为「测试陈旧」的前提**是「当前 UI 真的没有这些元素且是有意重构」。若 `#question-image` 等是**被误删的回归**（产品缺陷），那结论就反了——需要确认添加题目表单是主动重构（有设计文档）还是误删。调研 Task 2 时须查 `docs/` 里是否有该表单重构的记录（如 `docs/fix-*`、`docs/plans/*`）。
2. **`ai-pipeline-e2e` 判定为「断言错对象」的前提**是「写入 version.status 就是产品预期」。若产品本意是 node 级校验态（类型里 `approved` 的存在暗示曾有意设计），则属产品漏写，路线 (a) 会掩盖真实缺陷。
3. **CI 红灯的结论**基于「失败是确定性的」。若 `ai-*` 在有 API key 的环境下行为不同（例如走真实模型而跳过 mock 分支），则该结论需要按有 key 环境复核——但从代码看 `ai-pipeline-e2e` 全程用本地 fixture，无网络调用，确定性成立。
