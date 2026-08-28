import type { WikiPage, WikiPageType } from '../types';

// ===== Wiki Schema 层 =====
// 约定每种页面的结构、合并规则、交叉引用规则
// 作为 LLM system prompt 的运行时模板

export interface PageTypeSchema {
  type: WikiPageType;
  label: string;
  color: string;
  description: string;
  required_fields: string[];
  content_template: string;
}

export const PAGE_SCHEMAS: Record<WikiPageType, PageTypeSchema> = {
  concept: {
    type: 'concept',
    label: '概念',
    color: '#3B82F6',
    description: '物理概念、定律、定理的定义和解释',
    required_fields: ['title', 'summary', 'content'],
    content_template: `## {title}

{summary}

## 定义
{content}

## 公式
{latex_formulas 逐行列出}

## 适用条件
{key_conditions 逐行列出}

## 常见误区
{common_mistakes 逐行列出}`,
  },
  method: {
    type: 'method',
    label: '方法',
    color: '#10B981',
    description: '解题方法、技巧、步骤',
    required_fields: ['title', 'summary', 'content'],
    content_template: `## {title}

{summary}

## 解题步骤
{content}

## 适用场景
{key_conditions 逐行列出}

## 注意事项
{common_mistakes 逐行列出}`,
  },
  model: {
    type: 'model',
    label: '模型',
    color: '#F59E0B',
    description: '物理模型、典型情境、图示',
    required_fields: ['title', 'summary', 'content'],
    content_template: `## {title}

{summary}

## 核心方程
{latex_formulas 逐行列出}

## 模型描述
{content}

## 常见变式
{key_conditions 逐行列出}

## 易错点
{common_mistakes 逐行列出}`,
  },
  fallacy: {
    type: 'fallacy',
    label: '误区',
    color: '#EF4444',
    description: '常见错误理解、易混淆概念',
    required_fields: ['title', 'summary', 'content'],
    content_template: `## {title}

## 错误表述
{title}

## 错因分析
{summary}

## 正确理解
{content}

## 典型情境
{key_conditions 逐行列出}`,
  },
};

// ===== 合并规则 =====

export const MERGE_RULES = `
## 合并规则
1. 标题相似度 > 0.9 → 判定为同一概念，必须合并
2. 标题不同但内容高度重叠 → 判定为别名，建立 alias 引用
3. 内容有矛盾 → 标记 review_status = 'needs_merge'，等人工确认
4. 合并策略：保留更详细的页面，追加 source_ids，更新 aliases
`.trim();

// ===== 交叉引用规则 =====

export const CROSS_REFERENCE_RULES = `
## 交叉引用规则
1. 新建/更新页面后，必须检查已有页面，建立关联
2. 概念页 → 方法页：relation = 'related'（该概念适用的方法）
3. 方法页 → 模型页：relation = 'extends'（该方法适用的模型）
4. 概念页 → 概念页：relation = 'prerequisite'（前置知识）
5. 概念页 → 误区页：relation = 'related'（该概念常见误区）
6. 每个页面至少应有 1 个交叉引用（孤立页面需要人工审核）
`.trim();

// ===== 命名规则 =====

export const NAMING_RULES = `
## 命名规则
1. canonical_title 使用教科书标准用语（如"牛顿第二定律"而非"牛二"）
2. aliases 包含常见简称、别名（如"牛二"、"F=ma 原理"）
3. 标题必须精确、无歧义（如"动能定理"而非"能量定理"）
4. 模型页标题格式："[对象]-[情境]模型"（如"滑块-木板模型"）
`.trim();

// ===== 生成完整的 System Prompt 片段 =====

export function buildWikiSystemPrompt(): string {
  const typeDescriptions = Object.values(PAGE_SCHEMAS).map(s =>
    `### ${s.label} (${s.type})\n${s.description}\n必填字段: ${s.required_fields.join(', ')}`
  ).join('\n\n');

  return `# Wiki 知识库维护规则

## 页面类型
${typeDescriptions}

${NAMING_RULES}

${MERGE_RULES}

${CROSS_REFERENCE_RULES}

## 质量要求
1. summary 不超过 100 字，概括核心内容
2. content 使用 Markdown 公式语法（$...$ 和 $$...$$）
3. source_ids 必须包含所有关联的题目 ID
4. 每个页面必须有至少 1 个交叉引用
5. 不确定时降低 confidence（< 0.6），让人工审核
`.trim();
}

// ===== 页面完整性校验 =====

export function validatePage(page: WikiPage): { valid: boolean; missing: string[] } {
  const schema = PAGE_SCHEMAS[page.type];
  const missing: string[] = [];

  for (const field of schema.required_fields) {
    const value = page[field as keyof WikiPage];
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }

  if (!page.source_ids.length) missing.push('source_ids (至少 1 个来源)');

  return { valid: missing.length === 0, missing };
}
