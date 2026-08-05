# 配置文件格式与核心模块

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

## 核心模块（lib/）

| 模块 | 职责 | 入口函数 |
|------|------|---------|
| `json-parser.js` | 脏 JSON 鲁棒解析 | `parse(text) → {data, errors, rawText}` |
| `schema-validator.js` | JSON Schema 校验 | `validate(data, schema) → {valid, errors}` |
| `stream-parser.js` | SSE/OpenAI 流式解析 | `aggregateContent(chunks) → {fullText, errors}` |
| `content-validator.js` | 文本内容质量校验 | `validate(text, config) → {valid, errors, sections}` |
| `env-manager.js` | 密钥检测与 .env 管理 | `check(config) → {hasKey, message}` |
| `fixture-generator.js` | Fixture 录制与管理 | `record(pipeline, apiKey) → fixtureFiles` |
