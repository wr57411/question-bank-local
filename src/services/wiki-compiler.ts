import { generateId, nowIso } from '../data/stores';
import type { WikiPage, WikiPageType } from '../types';
import type { VisionResult } from './vision';

const COMPILE_SYSTEM_PROMPT = `你是一位经验丰富的高中物理教研员。请根据以下物理题目信息（OCR 识别结果），提取其中的知识要素。

请输出严格的 JSON 格式，不要包含任何 markdown 代码块标记或解释文字：

{
  "concepts": [
    {
      "name": "牛顿第二定律",
      "definition": "物体加速度大小与合外力成正比，与质量成反比",
      "formula": "F=ma",
      "conditions": ["宏观低速", "惯性参考系"],
      "aliases": ["牛二", "F=ma原理"]
    }
  ],
  "methods": [
    {
      "name": "整体法与隔离法",
      "steps": ["选取研究对象","分析受力","列方程求解"],
      "applicable_when": "连接体问题",
      "aliases": []
    }
  ],
  "models": [
    {
      "name": "弹簧连接体模型",
      "core_equation": "kx - f = ma",
      "variants": ["水平型", "竖直型", "斜面型"],
      "aliases": []
    }
  ],
  "fallacies": [
    {
      "misconception": "速度大的物体惯性大",
      "correct_view": "惯性只与质量有关，与速度无关",
      "aliases": []
    }
  ],
  "suggested_tags": ["力学","牛顿定律"]
}

注意：
1. 只提取题目中明确涉及的知识点，不要过度延伸
2. name 必须使用教科书标准用语
3. 如果某类不存在，输出空数组
4. 每个 concept 至少包含 name 和 definition
5. 为每个知识点列出常见别名/简称（aliases），用于实体去重
6. 只输出 JSON，不要任何其他文字`;

export interface CompileInput {
  text: string;
  formulas: string[];
  concepts: string[];
  conditions: string[];
  target: string;
  tags?: string[];
  book_name?: string;
  chapter?: string;
}

export function visionResultToCompileInput(
  vr: VisionResult,
  ctx: { tags?: string[]; book_name?: string; chapter?: string } = {}
): CompileInput {
  return {
    text: vr.raw_text,
    formulas: vr.latex_formulas,
    concepts: vr.key_concepts,
    conditions: vr.given_conditions,
    target: vr.solve_target,
    tags: ctx.tags,
    book_name: ctx.book_name,
    chapter: ctx.chapter,
  };
}

export interface CompiledDraft {
  type: WikiPageType;
  title: string;
  canonical_title: string;
  aliases: string[];
  summary: string;
  content: string;
  latex_formulas: string[];
  key_conditions: string[];
  common_mistakes: string[];
  source_snippet: string;
}

export type LinkRelation = 'prerequisite' | 'related' | 'extends';

export interface CompileOutput {
  drafts: CompiledDraft[];
  suggested_tags: string[];
  link_pairs: Array<[number, number, LinkRelation]>;
  usage?: number;
  error?: string;
}

interface ProviderLike {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function getProvider(): ProviderLike | null {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.getCurrentProvider === 'function') {
    return (w.getCurrentProvider as () => ProviderLike | null)();
  }
  return null;
}

export async function compileWikiKnowledge(input: CompileInput): Promise<CompileOutput> {
  const provider = getProvider();
  if (!provider) throw new Error('未配置 AI 服务商');

  const userPrompt = buildUserPrompt(input);
  const { content, usage } = await callCompileAPI(provider, userPrompt);
  const parsed = parseCompileResponse(content, input);
  if (usage) parsed.usage = usage;
  return parsed;
}

function buildUserPrompt(input: CompileInput): string {
  const parts = [
    '## 题目原文',
    input.text || '(无文本)',
    '',
    '## 已识别的物理公式',
    input.formulas.length ? input.formulas.join('\n') : '(无)',
    '',
    '## 考查知识点（初步识别）',
    input.concepts.length ? input.concepts.join('、') : '(无)',
    '',
    '## 已知条件',
    input.conditions.length ? input.conditions.join('\n') : '(无)',
    '',
    '## 求解目标',
    input.target || '(无)',
  ];
  if (input.book_name) parts.push('', '## 来源教辅', input.book_name);
  if (input.chapter) parts.push('', '## 所属章节', input.chapter);
  if (input.tags && input.tags.length) parts.push('', '## 已有标签', input.tags.join('、'));
  return parts.join('\n');
}

async function callCompileAPI(
  provider: ProviderLike,
  userPrompt: string
): Promise<{ content: string; usage?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const url = baseUrl.includes('openrouter')
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : baseUrl + '/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
    if (url.includes('openrouter')) {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'Question Bank Local - Compiler';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: COMPILE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`编译 API 错误 ${response.status}`);
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content || '';
    const usage: number | undefined =
      data.usage?.total_tokens ?? data.usage?.total_completion_tokens;
    return { content, usage };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseCompileResponse(response: string, input: CompileInput): CompileOutput {
  const drafts: CompiledDraft[] = [];
  let suggested_tags: string[] = [];
  let link_pairs: CompileOutput['link_pairs'] = [];

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        drafts,
        suggested_tags: input.tags || [],
        link_pairs,
        error: 'AI 未返回有效 JSON（响应为空或不含 JSON 对象）',
      };
    }

    const data = JSON.parse(jsonMatch[0]);

    if (Array.isArray(data.concepts)) {
      for (const c of data.concepts) {
        if (!c.name) continue;
        drafts.push({
          type: 'concept',
          title: c.name,
          canonical_title: c.name,
          aliases: Array.isArray(c.aliases) ? c.aliases : [],
          summary: c.definition || c.name,
          content: buildConceptContent(c),
          latex_formulas: c.formula ? [c.formula] : [],
          key_conditions: c.conditions || [],
          common_mistakes: [],
          source_snippet: extractSnippet(input.text, c.name),
        });
      }
    }

    if (Array.isArray(data.methods)) {
      for (const m of data.methods) {
        if (!m.name) continue;
        drafts.push({
          type: 'method',
          title: m.name,
          canonical_title: m.name,
          aliases: Array.isArray(m.aliases) ? m.aliases : [],
          summary: m.name + '的解题方法',
          content: buildMethodContent(m),
          latex_formulas: [],
          key_conditions: m.applicable_when ? [`适用: ${m.applicable_when}`] : [],
          common_mistakes: [],
          source_snippet: extractSnippet(input.text, m.name),
        });
      }
    }

    if (Array.isArray(data.models)) {
      for (const m of data.models) {
        if (!m.name) continue;
        drafts.push({
          type: 'model',
          title: m.name,
          canonical_title: m.name,
          aliases: Array.isArray(m.aliases) ? m.aliases : [],
          summary: m.name + '的核心方程与变式',
          content: buildModelContent(m),
          latex_formulas: m.core_equation ? [m.core_equation] : [],
          key_conditions: m.variants?.length ? [`常见变式: ${m.variants.join('、')}`] : [],
          common_mistakes: [],
          source_snippet: extractSnippet(input.text, m.name),
        });
      }
    }

    if (Array.isArray(data.fallacies)) {
      for (const f of data.fallacies) {
        if (!f.misconception) continue;
        const title = f.misconception;
        drafts.push({
          type: 'fallacy',
          title,
          canonical_title: title,
          aliases: Array.isArray(f.aliases) ? f.aliases : [],
          summary: f.correct_view || title,
          content: buildFallacyContent(f),
          latex_formulas: [],
          key_conditions: [],
          common_mistakes: [f.misconception],
          source_snippet: extractSnippet(input.text, title),
        });
      }
    }

    if (Array.isArray(data.suggested_tags)) {
      suggested_tags = data.suggested_tags;
      if (input.tags) suggested_tags = [...new Set([...input.tags, ...suggested_tags])];
    } else if (input.tags) {
      suggested_tags = input.tags;
    }

    link_pairs = inferLinks(drafts);
  } catch (e) {
    console.warn('parseCompileResponse 解析失败:', e, '原始响应:', response.slice(0, 500));
    return {
      drafts: [],
      suggested_tags: input.tags || [],
      link_pairs: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return { drafts, suggested_tags, link_pairs };
}

function buildConceptContent(c: { name: string; definition?: string; formula?: string; conditions?: string[] }): string {
  const parts = ['## ' + c.name, ''];
  if (c.definition) { parts.push(c.definition, ''); }
  if (c.formula) { parts.push('**公式**: $' + c.formula + '$', ''); }
  if (c.conditions?.length) {
    parts.push('**适用条件**:');
    for (const cond of c.conditions) parts.push('- ' + cond);
  }
  return parts.join('\n');
}

function buildMethodContent(m: { name: string; steps?: string[]; applicable_when?: string }): string {
  const parts = ['## ' + m.name, ''];
  if (m.steps?.length) {
    parts.push('**步骤**:');
    m.steps.forEach((s, i) => parts.push((i + 1) + '. ' + s));
    parts.push('');
  }
  if (m.applicable_when) parts.push('**适用场景**: ' + m.applicable_when);
  return parts.join('\n');
}

function buildModelContent(m: { name: string; core_equation?: string; variants?: string[] }): string {
  const parts = ['## ' + m.name, ''];
  if (m.core_equation) { parts.push('**核心方程**: $' + m.core_equation + '$', ''); }
  if (m.variants?.length) {
    parts.push('**常见变式**:');
    for (const v of m.variants) parts.push('- ' + v);
  }
  return parts.join('\n');
}

function buildFallacyContent(f: { misconception: string; correct_view?: string }): string {
  const parts = ['**错误表述**: ' + f.misconception, ''];
  if (f.correct_view) { parts.push('**正确理解**: ' + f.correct_view, ''); }
  parts.push('**结论**: 此说法是错误的。');
  return parts.join('\n');
}

function extractSnippet(text: string, keyword: string): string {
  if (!text || !keyword) return text ? text.slice(0, 100) : '';
  const idx = text.indexOf(keyword);
  if (idx >= 0) {
    const start = Math.max(0, idx - 10);
    const end = Math.min(text.length, idx + keyword.length + 50);
    return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '...' : '');
  }
  const tokens = keyword.split(/[\s，。、；：]/).filter(t => t.length >= 2);
  for (const t of tokens) {
    const i = text.indexOf(t);
    if (i >= 0) {
      const start = Math.max(0, i - 10);
      const end = Math.min(text.length, i + t.length + 40);
      return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '...' : '');
    }
  }
  return text.slice(0, 100);
}

function inferLinks(drafts: CompiledDraft[]): CompileOutput['link_pairs'] {
  const pairs: CompileOutput['link_pairs'] = [];
  const conceptIdx: number[] = [];
  const methodIdx: number[] = [];
  const modelIdx: number[] = [];
  drafts.forEach((d, i) => {
    if (d.type === 'concept') conceptIdx.push(i);
    else if (d.type === 'method') methodIdx.push(i);
    else if (d.type === 'model') modelIdx.push(i);
  });
  for (const c of conceptIdx) {
    for (const m of methodIdx) pairs.push([c, m, 'related']);
    for (const m of modelIdx) pairs.push([c, m, 'related']);
  }
  for (const m of methodIdx) {
    for (const md of modelIdx) pairs.push([m, md, 'extends']);
  }
  return pairs;
}

export function createWikiPageFromDraft(
  draft: CompiledDraft,
  sourceId: string,
  pageId?: string
): WikiPage {
  const now = nowIso();
  return {
    id: pageId || generateId(),
    type: draft.type,
    title: draft.title,
    canonical_title: draft.canonical_title,
    aliases: draft.aliases,
    summary: draft.summary,
    content: draft.content,
    latex_formulas: draft.latex_formulas,
    key_conditions: draft.key_conditions,
    common_mistakes: draft.common_mistakes,
    related_page_ids: [],
    source_ids: [sourceId],
    source_snippets: [draft.source_snippet].filter(Boolean),
    confidence: 0.7,
    review_status: 'auto',
    generated_at: now,
    updated_at: now,
    version: 1,
    deleted_at: null,
  };
}
