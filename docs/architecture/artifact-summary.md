# 架构工件清单（artifact summary）

> 由 Architecture Visualization 插件工作流（explore 路由 → system-modeler + c4model + graphviz）产出。

## 生成日期
2026-08-05

## 回答的问题
「当前工作区（question-bank-local）系统架构是什么：系统边界、核心容器、关键依赖、同步业务流」

## 工件

| 工件 | 回答什么 | 位置 |
| --- | --- | --- |
| `system-context.structurizr.dsl` | C4 系统上下文与容器视图：系统边界、容器、外部依赖 | `docs/architecture/system-context.structurizr.dsl` |
| `client-layers.dot` | 客户端四层模块依赖：ui→services→data 与 window 桥接边界 | `docs/architecture/client-layers.dot` |
| `sync-flow.mmd` | 同步业务流主路径与失败路径 | `docs/architecture/sync-flow.mmd` |
| `architecture-understanding.md` | 可读架构说明：边界、容器、关系证据、假设、阅读顺序 | `docs/architecture/architecture-understanding.md` |
| `architecture-model.evidence.md` | 节点/边证据索引与置信度、验证任务 | `docs/architecture/architecture-model.evidence.md` |

## 使用的技能
- `explore`（路由：当前架构理解）
- `system-modeler`（主场景技能：当前状态模型）
- `c4model`（基础技能：Structurizr DSL 源）
- `graphviz`（基础技能：客户端依赖 DOT 源）
- `flow-visualizer`（同步业务流 Mermaid 草图）

## 证据覆盖
- 覆盖：客户端四层、服务端路由/数据库、OCR 服务、外部依赖（OpenRouter/百度网盘/Supabase/备用服务器）
- 未覆盖（待验证）：备用服务器实际拓扑、Supabase 启用数据流、window 全局契约的完整脚本级校验

## 维护提示
- DSL/DOT/MMD 为可维护源文件；如需渲染 SVG/PNG，用 Graphviz/Structurizr 工具生成派生产物，勿手工编辑派生图。
- 架构变化后（新增路由、模块、外部依赖）需同步更新 DSL 与 DOT 源，保证 living architecture。
