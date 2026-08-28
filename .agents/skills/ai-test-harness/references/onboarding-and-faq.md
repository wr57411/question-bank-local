# 新项目接入与 FAQ

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
