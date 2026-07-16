# 教学内容关联题库 + E2E 测试扩展方案

## 背景

当前 AI 教学内容生成管线已完整实现（atomizer → generator → 校验 → 投屏），但存在两个问题：

1. **产品层面**：AI 生成的例题/练习不一定合适，用户需要从自己的题库中选择真实题目关联到知识点下（替换或追加），支持多对多关系
2. **测试层面**：缺少 Web E2E 测试覆盖（无 APK 也能在网页端验证全流程）、缺少题库 seed 数据、SKILL.md 缺少新项目接入指引

## 第一部分：教学内容关联题库（产品功能）

### 功能目标

在教学内容校验/编辑界面中，用户可以：
- 从题库中选择真实题目，关联到当前知识点的指定模块下（如模块三"配对练习"）
- 查看已关联的题目缩略图
- 删除已关联的题目
- 一道题可关联多个知识点（多对多）
- 投屏模式下展示关联的题目图片

### 数据层变更

**db.js 新增**：

```js
// 新增 IndexedDB store：知识点↔题目 多对多关联
const dbNodeQuestions = localforage.createInstance({ 
  name: 'questionBank', storeName: 'node_questions' 
});

// CRUD 函数
async function dbLinkQuestionToNode(nodeId, questionId, module, order)
async function dbUnlinkQuestionFromNode(nodeId, questionId)
async function dbGetNodeQuestions(nodeId)  // 返回 [{question_id, module, order, question_data}]
async function dbGetQuestionNodes(questionId)  // 反向查询
```

**数据模型**：
```json
{
  "id": "uuid",
  "node_id": "teaching-node-uuid",
  "question_id": "question-uuid", 
  "module": "模块三",           // 关联到哪个模块
  "order": 1,                   // 模块内排序
  "created_at": "ISO"
}
```

### UI 层变更

**校验/编辑模态框（verify modal）增加**：

1. 每个模块区域底部增加「+ 关联题库题目」按钮
2. 点击后弹出题目选择器（复用 `topic-question-picker` 模式）：
   - 列表展示所有题目（缩略图 + 标签/摘要）
   - checkbox 多选
   - 支持按标签筛选
   - 已关联的题目默认勾选
3. 确认后将关联题目以图片形式插入对应模块区域

**渲染层变更**：

在 `renderMarkdown()` 中，渲染完模块内容后，查询该知识点的关联题目，在对应模块末尾追加题目图片卡片：
```
[关联题目 #1 缩略图]  [关联题目 #2 缩略图]  [+ 添加更多]
```

**投屏模式**：关联题目图片在投屏时正常展示，支持手势翻页。

### 影响模块

| 文件 | 变更 |
|------|------|
| `www/db.js` | 新增 `dbNodeQuestions` store + 4 个 CRUD 函数 + 导入导出支持 |
| `www/index.html` | 校验 modal 加"关联题目"按钮 + 选择器弹窗 + 渲染逻辑 |

### 不涉及的边界

- 不修改 AI 生成逻辑（atomizer/generator prompt 不变）
- 不修改题目本身的 CRUD
- 不引入新的 npm 依赖

---

## 第二部分：E2E 测试扩展

### 变更 1：题库 Seed Fixture

**新增文件**：`tests/fixtures/question-bank-seed.json`

包含代表性数据：
- 5 道题目（含图片 base64、标签、版本、书本信息）
- 3 个标签
- 2 个 teaching_nodes（一个 PENDING，一个 GENERATED 带 content_markdown）
- 1 个专题 + 题目关联

**注入方式**：Playwright `beforeAll` 中通过 `page.evaluate()` + `importAllData()` 注入 IndexedDB。

### 变更 2：AI 管线 Web E2E 测试

**新增文件**：`tests/ai-pipeline-e2e.spec.js`

复用现有 `playwright.config.js`（webServer: `npx serve www -l 3000`），新增：

| 测试场景 | 方法 | 验证点 |
|---------|------|--------|
| Seed 数据加载 | beforeAll → importAllData | IndexedDB 有数据、题目列表渲染 |
| 教学内容页导航 | 点击 tab | 节点列表出现 |
| Atomizer（Mock） | `page.route('**/chat/completions')` 返回 fixture JSON | 知识点列表出现、状态 PENDING |
| Generator（Mock） | 拦截 API 返回 fixture Markdown | 状态 GENERATED、内容渲染 |
| 校验界面 | 点击 GENERATED 节点 | Modal 打开、内容渲染、可标记 VERIFIED |
| 关联题目 | 点击"关联题目"→ 选择 → 确认 | 题目图片出现在模块下 |
| 错误处理 | 拦截 API 返回 500 | 状态 ERROR、错误信息显示 |

**Mock 策略**：Playwright `page.route()` 拦截 `*/chat/completions`，返回 fixture 数据。无需 MSW。

### 变更 3：SKILL.md 补充

追加内容：
- 新项目 2 步接入示例
- FAQ（无 Key 怎么办、如何加 pipeline、是否需要后端）
- Phase 6: Web E2E 生成（检测 playwright.config.js → 生成 E2E 模板 + seed fixture 骨架）

### 变更 4：Structured Outputs 配置

config-schema.json 新增 `api.useStructuredOutputs` 字段，real-api 测试模板中自动附加 `response_format: { type: "json_schema", ... }`。

### 变更 5：GitHub Actions CI 模板

**新增文件**：`.agents/skills/ai-test-harness/templates/ci/github-actions.yml.ejs`

```yaml
name: AI Tests
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:ai:unit
  e2e-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

---

## 实施顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | db.js 新增 node_questions store + CRUD | 无 |
| 2 | index.html 校验 modal 加"关联题目" UI | Step 1 |
| 3 | 渲染层展示关联题目图片 | Step 1 |
| 4 | 创建 seed fixture JSON | 无 |
| 5 | 编写 Playwright E2E 测试 | Step 4 |
| 6 | 更新 SKILL.md（FAQ + Phase 6） | 无 |
| 7 | 更新 config-schema.json | 无 |
| 8 | 创建 CI 模板 | 无 |
| 9 | 运行验证：unit + E2E | Step 1-8 |

## 预期效果

- **产品**：用户可从题库选择真实题目关联到 AI 生成的知识点下，替换/补充 AI 生成的例题
- **测试**：`npx serve www` + Playwright 覆盖全流程（AI 生成 + 题库关联），无需 APK、无需真实后端
- **CI**：GitHub Actions 一键跑 unit + E2E
- **可迁移**：SKILL.md 含新项目接入指南 + FAQ
