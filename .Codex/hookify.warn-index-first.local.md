---
name: warn-index-first
enabled: true
event: file
action: warn
pattern: \.(js|ts|jsx|tsx|java|kt|py|go|rs|cpp|c|h|rb|php|swift|m|mm|html)$
---

## ⛔ 索引优先检查（编码前置门）

**你正在编辑代码文件。在执行编码操作前，以下步骤必须已完成：**

1. **已读取 AGENTS.md** — 读取项目根目录 AGENTS.md，查看「开发文档索引」部分，锁定与当前需求相关的历史文档路径
2. **已锁定历史文档** — 按索引指向的路径精准读取相关文档，了解历史操作记录
3. **已生成开发计划** — 包含模块指向、影响范围分析、变更清单
4. **用户已确认计划** — 计划阶段必须暂停等待用户确认，不可跳过

### 检查

如果以上 4 步未全部完成，**立即停止编码**，先完成前置步骤。

### 如何补救

- 如果索引文件不存在，参考 `~/.qoder-cn/skills/large-codebase-ai-dev/agents-index-template.md` 创建索引
- 避免全量扫描所有文件导致 Token 爆炸。精准指定路径，降低成本
- 完成编码后，同步生成开发文档并更新 AGENTS.md 索引
