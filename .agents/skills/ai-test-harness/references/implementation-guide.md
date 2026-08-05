# 实施指南（Phase 1-6）

## Phase 1: 环境准备

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

## Phase 2: Fixture 生成

1. 创建 `fixtureDir` 目录
2. 对每个 pipeline，基于 `testFixtures` 列表生成标准 fixture 文件：
   - `good` → 合法标准输出
   - `markdown_wrapped` → ` ```json ... ``` ` 包裹
   - `extra_text` → 带前缀/后缀解释文字
   - `truncated` → 截断 JSON
   - `empty` → 空响应
   - 其他按 pipeline 自定义
3. 运行 `lib/fixture-generator.js` 可选从真实 API 录制

## Phase 3: 测试文件生成

根据 `stack` 选择 `templates/{stack}/` 下的模板，注入配置变量，生成：

| 文件 | 内容 |
|------|------|
| `{pipeline.name}-parser.spec.*` | safeParseJSON + schema 校验单元测试 |
| `{pipeline.name}-pipeline.spec.*` | mock fetch 集成测试 |
| `{pipeline.name}-real-api.spec.*` | 真实 API 烟雾测试（opt-in） |
| `stream.spec.*` | 流式解析通用测试 |

生成到 `testDir` 目录。

## Phase 4: 运行脚本生成

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

## Phase 5: 验证运行

1. 运行 unit + mock 测试，确保全部通过
2. 如有 API Key，运行 real-api 烟雾测试
3. 打印结果摘要

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
