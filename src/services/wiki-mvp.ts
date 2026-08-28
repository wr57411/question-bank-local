import type { Question, WikiExtractMode, OcrResult } from '../types';
import type { WikiConcept, WikiExtractResult } from '../types';
import { ocrBatch } from './local-ocr';

export const WIKI_MVP_DEFAULT_MODELS = [
  'qwen/qwen-2.5-vl-72b-instruct',
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
];

export const WIKI_MVP_OCR_MODELS = [
  'openrouter/free',
  'google/gemini-3.5-flash-lite',
  'qwen/qwen3.7-flash',
];

const WIKI_PROMPT_KEY = 'wiki_mvp_prompt';
const WIKI_BASE_URL_KEY = 'wiki_mvp_base_url';

export function getWikiSystemPrompt(): string {
  return localStorage.getItem(WIKI_PROMPT_KEY)?.trim() || DEFAULT_WIKI_SYSTEM_PROMPT;
}

export function setWikiSystemPrompt(prompt: string): void {
  const value = prompt.trim();
  if (value) localStorage.setItem(WIKI_PROMPT_KEY, value);
  else localStorage.removeItem(WIKI_PROMPT_KEY);
}

export function getLlmBaseUrl(): string {
  return localStorage.getItem(WIKI_BASE_URL_KEY)?.trim() || '';
}

export function setLlmBaseUrl(url: string): void {
  const value = url.trim();
  if (value) localStorage.setItem(WIKI_BASE_URL_KEY, value);
  else localStorage.removeItem(WIKI_BASE_URL_KEY);
}

const DEFAULT_WIKI_SYSTEM_PROMPT = `你是资深高考物理命题研究专家兼一线教师，熟悉高考物理命题规律、常见陷阱与学生高频错误。你的任务是把用户提供的题目（原始来源）编译成面向高考物理的知识库，遵循 LLM Wiki 原则：一个概念一个页面，概念间互相链接，每个概念引用题目原文作为来源证据。

提取标准（按优先级，这是核心要求）：
1. 核心难点优先：优先提取题目中真正区分学生的难点——易错陷阱、隐含条件、容易误用的公式/模型、临界与边界条件、易混淆概念，而不是只列知识点名称。
2. 解题方法论：提取“怎么想到这个思路”的方法——模型选择依据（为什么用这个方法而不用另一个）、条件到结论的推理链、通用解题策略。
3. 综合与关联：提取跨章节的知识关联，指出本题综合了哪些考点、它们如何衔接。
4. 基础概念仅在支撑难点时才建页，且必须说明它在本题难点中的作用。
5. 每个难点概念必须从高考视角回答：高考为什么考它、怎么考、学生怎么错。

输出严格 JSON，不要 markdown 代码块，格式如下：
{
  "concepts": [
    {
      "title": "概念名称",
      "category": "核心难点 | 重要考点 | 解题方法 | 基础概念",
      "definition": "一句话定义",
      "explanation": "详细解释，含适用条件、在本题中的具体作用，公式用 $...$ 包裹",
      "exam_point": "高考命题视角：高考为什么考它、怎么设题、难在哪里",
      "pitfalls": ["易错点1（学生常见错误/陷阱）", "易错点2"],
      "analogy": "贴近生活的类比",
      "quotes": ["题目原文片段，证明来源"],
      "links": [{"target": "本批次另一个概念的精确title", "relation": "关系描述"}]
    }
  ]
}`;

interface ProviderLike {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function getProvider(): ProviderLike | null {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.getVisionProvider === 'function') {
    return (w.getVisionProvider as () => ProviderLike | null)();
  }
  if (typeof w.getCurrentProvider === 'function') {
    return (w.getCurrentProvider as () => ProviderLike | null)();
  }
  return null;
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('data:') ? url : 'data:image/jpeg;base64,' + url;
}

export function buildUserContent(questions: Question[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  questions.forEach((q, index) => {
    let text = `【题目 ${index + 1}】${buildMetaText(q)}`;
    if (q.question_image_url) text += '\n（本题包含题目图片，见下方图片）';
    parts.push({ type: 'text', text });
    const imageUrl = normalizeImageUrl(q.question_image_url);
    if (imageUrl) parts.push({ type: 'image_url', image_url: { url: imageUrl } });
  });
  return parts;
}

function buildMetaText(q: Question): string {
  const meta: string[] = [];
  if (q.book_name) meta.push(`书本：${q.book_name}`);
  if (q.page_number) meta.push(`页码：${q.page_number}`);
  if (q.question_number) meta.push(`题号：${q.question_number}`);
  if (q.question_tags?.length) meta.push(`标签：${q.question_tags.map(t => t.name).join('、')}`);
  if (q.semantic_summary) meta.push(`摘要：${q.semantic_summary}`);
  if (q.user_comment) meta.push(`备注：${q.user_comment}`);
  return meta.length ? meta.join('；') : '';
}

export function buildOcrUserContent(
  questions: Question[],
  ocrMap: Map<string, OcrResult | { error: string }>
): string {
  return questions
    .map((q, index) => {
      let text = `【题目 ${index + 1}】${buildMetaText(q)}`;
      const ocr = q.question_image_url ? ocrMap.get(q.id) : undefined;
      if (ocr && 'text' in ocr && (ocr.markdown || ocr.text)) {
        text += '\n【OCR 识别内容】\n' + (ocr.markdown || ocr.text);
        if (ocr.formulas.length) {
          text += '\n【识别公式】\n' + ocr.formulas.map(f => `$$${f}$$`).join('\n');
        }
      } else if (ocr && 'error' in ocr) {
        text += `\n（本题图片 OCR 失败：${ocr.error}，以下为已有文本信息）`;
      } else {
        text += '\n（本题无图片，基于已有文本信息）';
      }
      return text;
    })
    .join('\n\n');
}

function parseConcepts(raw: string): WikiConcept[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('模型未返回有效 JSON');
    parsed = JSON.parse(text.slice(start, end + 1));
  }

  const concepts = (parsed as { concepts?: unknown })?.concepts;
  if (!Array.isArray(concepts)) throw new Error('JSON 中缺少 concepts 数组');

  return concepts
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(c => ({
      title: String(c.title ?? '').trim() || '未命名概念',
      category: String(c.category ?? '').trim() || '重要考点',
      definition: String(c.definition ?? '').trim(),
      explanation: String(c.explanation ?? '').trim(),
      exam_point: String(c.exam_point ?? '').trim(),
      pitfalls: Array.isArray(c.pitfalls) ? c.pitfalls.map(p => String(p).trim()).filter(Boolean) : [],
      analogy: String(c.analogy ?? '').trim(),
      quotes: Array.isArray(c.quotes) ? c.quotes.map(q => String(q).trim()).filter(Boolean) : [],
      links: Array.isArray(c.links)
        ? c.links
            .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
            .map(l => ({
              target: String(l.target ?? '').trim(),
              relation: String(l.relation ?? '相关').trim(),
            }))
            .filter(l => l.target)
        : [],
    }))
    .filter(c => c.title && (c.definition || c.explanation));
}

async function callOpenRouter(
  provider: ProviderLike,
  model: string,
  questions: Question[],
  signal?: AbortSignal,
  ocrUserContent?: string,
  onToken?: (text: string) => void
): Promise<{ content: string; usage?: number }> {
  const controller = new AbortController();
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
  };
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), 60000);
  };
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const baseUrl = (getLlmBaseUrl() || provider.baseUrl).replace(/\/+$/, '');
    const url = baseUrl.includes('openrouter')
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : baseUrl + '/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
    if (url.includes('openrouter')) {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'Question Bank - Wiki MVP';
    }

    const payload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: getWikiSystemPrompt() },
        { role: 'user', content: ocrUserContent ?? buildUserContent(questions) },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      stream: true,
      response_format: { type: 'json_object' },
    };

    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok && response.status === 400) {
      delete payload.response_format;
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API ${response.status}: ${errText.slice(0, 300)}`);
    }

    firstByteTimer = setTimeout(() => controller.abort(), 90000);
    totalTimer = setTimeout(() => controller.abort(), 600000);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('模型响应无法读取');
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    resetIdle();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = undefined;
      }
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
          if (delta) {
            content += delta;
            onToken?.(content);
          }
        } catch {
          // 忽略无法解析的流片段
        }
      }
    }

    if (!content) throw new Error('模型返回空内容');
    return { content };
  } finally {
    clearTimers();
  }
}

export async function extractKnowledgeFromQuestions(
  questions: Question[],
  model: string,
  options?: {
    signal?: AbortSignal;
    mode?: WikiExtractMode;
    ocrBaseUrl?: string;
    onToken?: (text: string) => void;
  }
): Promise<WikiExtractResult> {
  const provider = getProvider();
  if (!provider) throw new Error('未配置 AI 服务商，请先在「设置」中添加 API Key');

  const mode: WikiExtractMode = options?.mode === 'ocr' && !!options?.ocrBaseUrl ? 'ocr' : 'vision';
  let ocrUserContent: string | undefined;

  if (mode === 'ocr') {
    const imageQuestions = questions.filter(q => !!q.question_image_url);
    if (imageQuestions.length > 0) {
      const results = await ocrBatch(
        imageQuestions.map(q => q.question_image_url as string),
        options!.ocrBaseUrl!,
        options?.signal
      );
      const ocrMap = new Map<string, OcrResult | { error: string }>();
      const failures: string[] = [];
      imageQuestions.forEach((q, i) => {
        const r = results[i];
        ocrMap.set(q.id, r ?? { error: 'OCR 无返回' });
        if (r && 'error' in r) failures.push(q.question_number ? `#${q.question_number}` : q.id);
      });
      if (failures.length === imageQuestions.length) {
        throw new Error(`本地 OCR 服务识别失败（${failures.join('、')}），请确认 ocr-server 已启动且地址正确，或切换到视觉模型`);
      }
      ocrUserContent = buildOcrUserContent(questions, ocrMap);
    } else {
      ocrUserContent = buildOcrUserContent(questions, new Map());
    }
  }

  const startTime = Date.now();

  try {
    const { content } = await callOpenRouter(provider, model, questions, options?.signal, ocrUserContent, options?.onToken);
    const concepts = parseConcepts(content);
    if (concepts.length === 0) throw new Error('解析出的概念为空');
    return {
      concepts,
      raw_response: content,
      model_used: model,
      elapsed_ms: Date.now() - startTime,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('模型响应超时（排队超过 90 秒或生成中断 60 秒以上），免费档大模型较慢，请稍后重试或换用更快的模型');
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
