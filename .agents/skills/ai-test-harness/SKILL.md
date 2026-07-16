# AI Test Harness - 通用 AI 管线自动化测试基础设施

为任何包含 LLM API 调用的项目，一键生成分层自动化测试体系（unit / mock / real-api）。

## 触发条件

当用户说「生成 AI 测试」「初始化测试基础设施」「AI 测试 harness」「setup AI tests」时使用。
也可在编码 Agent 完成涉及 LLM 调用的代码后自动触发。

## 前置检查

1. 查找项目根目录的 `.ai-test-harness.json`
   - 不存在 → 交互式引导用户创建（询问技术栈、API 提供商、管线定义）
   - 存在 → 读取配置继续
2. 检测项目技术栈：`package.json` / `pubspec.yaml` / `build.gradle` / `requirements.txt`
3. 确认配置文件中的 `stack` 与检测结果一致

## 配置文件格式

`.ai-test-harness.json` 完整 Schema 见 `config-schema.json`。关键字段：

```json
{
  "stack": "vitest | jest | pytest | flutter",
  "source": {
    "aiFunctions": ["path/to/ai-module.js"],
    "extractFrom": "path/to/large-file.html",
    "functionsToExtract": ["funcName1", "funcName2"]
  },
  "api": {
    "provider": "openrouter | openai | anthropic | custom",
    "baseUrl": "https://api.example.com/v1",
    "keyEnvVar": "API_KEY_ENV_VAR_NAME",
    "testModel": "model-id",
    "authHeader": "Authorization",
    "authScheme": "Bearer",
    "extraHeaders": {}
  },
  "pipelines": [
    {
      "name": "pipeline-name",
      "input": { "type": "text", "sample": "test input" },
      "systemPrompt": "PROMPT_CONSTANT_NAME",
      "outputSchema": { "type": "array", "items": {...} },
      "outputValidation": { "type": "markdown", "requiredSections": [...] },
      "testFixtures": ["good", "bad", "edge_case"]
    }
  ],
  "testDir": "unit-tests",
  "fixtureDir": "unit-tests/fixtures"
}
```

## 执行流程

### Phase 1: 环境准备

1. 读取 `.ai-test-harness.json`
2. 运行 `lib/env-manager.js`：
   - 检查 `api.keyEnvVar` 是否存在于 `process.env` 或 `.env`
   - 缺失 → 生成 `.env.example`，打印：
     ```
     ⚠️  真实 API 测试需要密钥。请设置：
     export {keyEnvVar}=your_key
     或复制 .env.example 到 .env 并填写。
     将跳过 @api_real 测试，仅运行 unit + mock。
     ```
3. 如有 `source.extractFrom`，执行函数提取（将 AI 函数从大文件拆到独立模块）

### Phase 2: Fixture 生成

1. 创建 `fixtureDir` 目录
2. 对每个 pipeline，基于 `testFixtures` 列表生成标准 fixture 文件：
   - `good` → 合法标准输出
   - `markdown_wrapped` → ` ```json ... ``` ` 包裹
   - `extra_text` → 带前缀/后缀解释文字
   - `truncated` → 截断 JSON
   - `empty` → 空响应
   - 其他按 pipeline 自定义
3. 运行 `lib/fixture-generator.js` 可选从真实 API 录制

### Phase 3: 测试文件生成

根据 `stack` 选择 `templates/{stack}/` 下的模板，注入配置变量，生成：

| 文件 | 内容 |
|------|------|
| `{pipeline.name}-parser.spec.*` | safeParseJSON + schema 校验单元测试 |
| `{pipeline.name}-pipeline.spec.*` | mock fetch 集成测试 |
| `{pipeline.name}-real-api.spec.*` | 真实 API 烟雾测试（opt-in） |
| `stream.spec.*` | 流式解析通用测试 |

生成到 `testDir` 目录。

### Phase 4: 运行脚本生成

根据 stack 生成：

**JS/TS (vitest/jest)**:
- `scripts/run-ai-tests.sh` - 一键运行脚本
- 更新 `package.json` scripts:
  ```json
  "test:ai": "bash scripts/run-ai-tests.sh all",
  "test:ai:unit": "bash scripts/run-ai-tests.sh unit",
  "test:ai:mock": "bash scripts/run-ai-tests.sh mock",
  "test:ai:real": "bash scripts/run-ai-tests.sh api"
  ```

**Python (pytest)**:
- `scripts/run_ai_tests.sh`
- `pytest.ini` 中注册 markers

**Flutter**:
- `scripts/run_ai_tests.sh`
- `pubspec.yaml` test deps

### Phase 5: 验证运行

1. 运行 unit + mock 测试，确保全部通过
2. 如有 API Key，运行 real-api 烟雾测试
3. 打印结果摘要

## 核心模块（lib/）

| 模块 | 职责 | 入口函数 |
|------|------|---------|
| `json-parser.js` | 脏 JSON 鲁棒解析 | `parse(text) → {data, errors, rawText}` |
| `schema-validator.js` | JSON Schema 校验 | `validate(data, schema) → {valid, errors}` |
| `stream-parser.js` | SSE/OpenAI 流式解析 | `aggregateContent(chunks) → {fullText, errors}` |
| `content-validator.js` | 文本内容质量校验 | `validate(text, config) → {valid, errors, sections}` |
| `env-manager.js` | 密钥检测与 .env 管理 | `check(config) → {hasKey, message}` |
| `fixture-generator.js` | Fixture 录制与管理 | `record(pipeline, apiKey) → fixtureFiles` |

## 在新项目中接入

只需两步：

1. 创建 `.ai-test-harness.json`（可让 Agent 交互式引导生成）
2. 加载 `ai-test-harness` Skill

Skill 会自动完成：函数提取（如需要）、fixture 生成、测试文件生成、脚本生成、验证运行。

### 快速示例

```bash
# 1. 复制 Skill 到新项目
cp -r .agents/skills/ai-test-harness /path/to/new-project/.agents/skills/

# 2. 创建配置（最小示例）
cat > /path/to/new-project/.ai-test-harness.json << 'EOF'
{
  "stack": "vitest",
  "api": {
    "provider": "openrouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "keyEnvVar": "OPENROUTER_API_KEY",
    "testModel": "google/gemini-flash-1.5"
  },
  "pipelines": [{
    "name": "my-pipeline",
    "input": { "type": "text", "sample": "test input" },
    "outputSchema": { "type": "array", "items": { "type": "object", "required": ["name"] } },
    "testFixtures": ["good", "empty", "truncated"]
  }],
  "testDir": "tests",
  "fixtureDir": "tests/fixtures"
}
EOF

# 3. 加载 Skill，自动执行 Phase 1-5
```

## FAQ

### 没有 API Key 怎么办？
unit + mock 测试完全不需要 Key，可正常运行。real-api 测试会自动跳过并打印清晰提示。建议复制 `.env.example` 到 `.env` 并填写 Key。

### 如何添加新 pipeline？
在 `.ai-test-harness.json` 的 `pipelines` 数组中追加配置，重新加载 Skill 即可自动生成对应测试文件。

### 如何扩展到新栈？
在 `templates/` 下新增对应目录（如 `pytest/`），创建模板文件。Skill 会根据 `stack` 字段自动选择模板。

### 需要后端/题库吗？
AI 管线测试不需要后端。管线测试只依赖 LLM API Key。如需测试数据依赖功能，可通过 seed fixture 注入测试数据。

### Structured Outputs 怎么用？
在 `api` 配置中加 `"useStructuredOutputs": true`，生成的测试会自动在请求中附加 `response_format: { type: "json_schema" }`，显著降低脏 JSON 概率。

## Phase 6: Web E2E 生成（可选）

当项目包含 `playwright.config.js` 时，Skill 可额外生成：

1. `tests/fixtures/` 下的 seed fixture JSON（用于数据注入）
2. `tests/ai-pipeline-e2e.spec.js`（Playwright E2E 测试模板）
3. 使用 `page.route()` 拦截 API 请求，返回 fixture 数据
4. 使用 `page.evaluate()` + `importAllData()` 注入题库 seed 数据

## 注意事项

- API Key **绝不**进 git（自动添加到 `.gitignore`）
- 真实 API 测试使用便宜/免费模型 + `temperature=0`
- 生产环境建议后端代理 Key，不直接暴露在前端
- fixture 文件从真实调用脱敏后固化，覆盖好/坏/边界情况
- 推荐使用 OpenAI Structured Outputs 从源头降低脏 JSON 概率
