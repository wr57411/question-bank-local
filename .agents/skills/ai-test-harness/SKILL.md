---
name: ai-test-harness
description: 为含 LLM API 调用的项目一键生成分层自动化测试体系（unit/mock/real-api），当用户说「生成 AI 测试」「初始化测试基础设施」「AI 测试 harness」「setup AI tests」或编码 Agent 完成涉及 LLM 调用的代码后自动触发。
---

# AI Test Harness

为任何包含 LLM API 调用的项目，一键生成分层自动化测试体系（unit / mock / real-api）。

## 触发条件

当用户说「生成 AI 测试」「初始化测试基础设施」「AI 测试 harness」「setup AI tests」时使用。
也可在编码 Agent 完成涉及 LLM 调用的代码后自动触发。

## 快速开始

1. 检查项目根目录 `.ai-test-harness.json`（不存在则交互式引导用户创建，询问技术栈、API 提供商、管线定义）
2. 检测项目技术栈：`package.json` / `pubspec.yaml` / `build.gradle` / `requirements.txt`，确认配置文件中的 `stack` 与检测结果一致
3. 加载 Skill 后自动执行 Phase 1-5，输出测试体系与运行脚本

## 流程概览

| Phase | 内容 | 详见 |
|-------|------|------|
| 1 | 环境准备：密钥检测、`.env.example` 生成、函数提取 | [实施指南](references/implementation-guide.md) |
| 2 | Fixture 生成：按 `testFixtures` 列表生成标准 fixture 文件 | [实施指南](references/implementation-guide.md) |
| 3 | 测试文件生成：按 `stack` 选择模板生成 parser/pipeline/real-api/stream 测试 | [实施指南](references/implementation-guide.md) |
| 4 | 运行脚本生成：`run-ai-tests.sh` 与 `package.json` scripts | [实施指南](references/implementation-guide.md) |
| 5 | 验证运行：unit + mock 全过，有 Key 时跑 real-api 烟雾测试 | [实施指南](references/implementation-guide.md) |
| 6 | Web E2E 生成（可选，项目含 `playwright.config.js` 时） | [实施指南](references/implementation-guide.md) |

## 参考文档

- [配置文件格式与核心模块](references/config-guide.md)：`.ai-test-harness.json` 完整 Schema 与 `lib/` 模块职责
- [实施指南](references/implementation-guide.md)：Phase 1-6 详细执行步骤与注意事项
- [新项目接入与 FAQ](references/onboarding-and-faq.md)：两步接入、快速示例、常见问题
