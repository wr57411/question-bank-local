# Wiki Schema 约定

本文档是 LLM 编译器与人类维护者之间的约定，编译器每次编译时必须遵守。

## 页面命名规范

| 类型 | canonical_title 规则 | 示例 |
|------|---------------------|------|
| concept | 教科书标准用语，不得使用口语化简称 | "牛顿第二定律" 而非 "牛二" |
| method | "[方法论] + 法/方法/思路" | "整体法与隔离法"、"等效电源法" |
| model | "[物理情境] + 模型" | "滑块-木板模型"、"电磁感应棒模型" |
| fallacy | 直接引用错误表述作为 title | "速度大的物体惯性大" |

**aliases** 字段记录所有等价说法（口语、简称、同义表述），用于实体去重：
- 标题: "牛顿第二定律"
- aliases: ["牛二", "F=ma原理", "牛顿第2定律"]

## 每种页面的最小字段集

### concept（概念页）
- [ ] title + canonical_title + aliases
- [ ] summary（一句话定义）
- [ ] content 包含：定义文字 + 公式段落（LaTeX）+ 适用条件
- [ ] latex_formulas: 所有独立公式
- [ ] key_conditions: 适用条件列表

### method（方法页）
- [ ] title + canonical_title + aliases
- [ ] summary（一句话描述方法作用）
- [ ] content 包含：解题步骤（有序列表）+ 适用场景 + 注意事项
- [ ] source_ids 至少关联 1 道例题

### model（模型页）
- [ ] title + canonical_title + aliases
- [ ] summary（一句话描述模型情境）
- [ ] content 包含：图示描述 + 核心方程 + 常见变式
- [ ] related_page_ids 关联涉及的概念页和方法页

### fallacy（误区页）
- [ ] title（直接使用错误表述）
- [ ] summary（一句话点明正确答案）
- [ ] content 包含：错误表述原文 + 错因分析 + 正确理解 + 辨错示例
- [ ] common_mistakes: 同类误区列表

## 实体去重规则

1. 候选页面标题 Embedding 余弦相似度 > 0.85 → 触发 LLM 是否同概念判断
2. LLM 确认为同一概念 → 合并：将新 source_ids / source_snippets 追加到现有页面，version + 1
3. LLM 确认为不同概念 → 创建新页面，双向添加 related_page_ids

## 矛盾判定

以下情况视为矛盾（review_status → needs_merge）：
- 同一 canonical_title 的两份内容中，formula 的数学表达式本质不同
- key_conditions 的适用条件互相排斥

以下**不**视为矛盾：
- 表述风格差异（一个白话一个严谨）
- 详略程度不同
- 补充了新的 source 信息

## 链接完整性

- WikiLink 必须对称：A.related_page_ids 包含 B 则 B.related_page_ids 必须包含 A
- WikiLink.relation 类型：
  - prerequisite: "A 是 B 的前置知识"
  - related: "A 和 B 主题相关"
  - contradicts: "A 和 B 互斥或对立"（如"位移 vs 路程"）
  - extends: "B 是 A 的延伸或推广"

## 来源追溯

每个 WikiPage 必须保留：
- source_ids: 触发创建了本页面的题目 ID 列表
- source_snippets: 对应每道题的原文片段（50-100 字）

片段提取规则：选取题目中直接提到本概念/使用本方法的那句话。

## 编译质量标准

单次编译输出后，检查以下指标：
- 至少创建或更新了 1 个 WikiPage
- 所有 extracted formulas 是合法 LaTeX
- summary 不超过 50 字
- 若不确定，降低 confidence 并标 review_status = 'auto'

## 不确定时的处理

当 LLM 对以下问题不确定时：
- 某概念是否应是独立概念页 → **创建**，低置信度 + auto review
- 某公式是否正确 → **输出并标记** `[待验证]` 后缀，不静默丢弃
- 某题目属于哪个知识域 → **输出 `domain: "uncertain"`** 不猜测

## 日志规范

每次编译操作需在 wiki-log 追加一行：
```
[ISO时间] COMPILE | question:{id} → pages:[{page_id1},{page_id2}] | created:{n} updated:{n} conflicts:{n}
```

每次 lint 操作记录：
```
[ISO时间] LINT | orphan:{n} conflict_pending:{n} missing:{n} broken_links:{n}
```
