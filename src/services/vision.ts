const VISION_SYSTEM_PROMPT = `你是一位高中物理老师。请分析这张物理题图片，完成以下任务：

1. 识别并提取题目中的所有文字内容（包括公式）
2. 将物理公式转换为标准 LaTeX 格式（行内用$...$，块级用$$...$$）
3. 指出本题考查的物理概念和知识点
4. 列出题目中给出的已知条件
5. 指出要求的未知量

以 Markdown 格式输出：

## 题目原文
（OCR 识别的完整题目文本）

## 物理公式
（题目中涉及的所有公式，LaTeX 格式）

## 考查知识点
（列出涉及的概念）

## 已知条件
（逐一列出）

## 求解目标
（题目要求什么）`;

const FALLBACK_MODELS = [
  'openrouter/free',
  'google/gemini-3.5-flash-lite',
  'qwen/qwen3.7-flash',
];

export interface VisionResult {
  raw_text: string;
  latex_formulas: string[];
  key_concepts: string[];
  given_conditions: string[];
  solve_target: string;
  confidence: number;
  model_used: string;
  elapsed_ms: number;
  full_response: string;
  usage?: number;
}

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

export async function recognizePhysicsImage(
  imageDataUrl: string,
  options?: { signal?: AbortSignal; systemPrompt?: string }
): Promise<VisionResult> {
  const provider = getProvider();
  if (!provider) throw new Error('未配置 AI 服务商，请先在设置中添加 API Key');

  const imageUrl = imageDataUrl.startsWith('data:') ? imageDataUrl : 'data:image/jpeg;base64,' + imageDataUrl;
  const systemPrompt = options?.systemPrompt || VISION_SYSTEM_PROMPT;
  const startTime = Date.now();

  let lastError: Error | null = null;

  for (const model of [provider.model, ...FALLBACK_MODELS.filter(m => m !== provider.model)]) {
    try {
      const result = await callVisionAPI(provider, model, imageUrl, systemPrompt, options?.signal);
      result.elapsed_ms = Date.now() - startTime;
      result.model_used = model;
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof Error && err.name === 'AbortError') throw err;
      continue;
    }
  }

  throw lastError || new Error('所有视觉模型均失败');
}

async function callVisionAPI(
  provider: ProviderLike,
  model: string,
  imageUrl: string,
  systemPrompt: string,
  externalSignal?: AbortSignal
): Promise<VisionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const url = baseUrl.includes('openrouter')
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : baseUrl + '/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
    if (provider.baseUrl.includes('openrouter') || url.includes('openrouter')) {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'Question Bank Local - Vision';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请分析这张物理题：' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content || '(无返回)';
    const usage: number | undefined = data.usage?.total_tokens;

    const result = parseVisionResponse(content);
    if (usage) result.usage = usage;
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseVisionResponse(content: string): VisionResult {
  const formulas = extractLatexFormulas(content);
  const concepts = extractSection(content, '考查知识点');
  const conditions = extractSection(content, '已知条件');
  const target = extractSection(content, '求解目标');
  const rawText = extractSection(content, '题目原文');

  const confidence = estimateConfidence(content, formulas.length);

  return {
    raw_text: rawText.join('\n'),
    latex_formulas: formulas,
    key_concepts: concepts,
    given_conditions: conditions,
    solve_target: target.join('；'),
    confidence,
    model_used: '',
    elapsed_ms: 0,
    full_response: content,
  };
}

function extractLatexFormulas(content: string): string[] {
  const formulas: string[] = [];
  const blockPattern = /\$\$([\s\S]*?)\$\$/g;
  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    formulas.push(match[1].trim());
  }
  const inlinePattern = /\$([^$\n]+?)\$/g;
  while ((match = inlinePattern.exec(content)) !== null) {
    if (!formulas.includes(match[1].trim())) {
      formulas.push(match[1].trim());
    }
  }
  return formulas;
}

function extractSection(content: string, sectionName: string): string[] {
  const lines = content.split('\n');
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.includes(`## ${sectionName}`) || line.includes(`### ${sectionName}`)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('##')) {
      inSection = false;
      continue;
    }
    if (inSection && line.trim() && !line.startsWith('（')) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (cleaned) result.push(cleaned);
    }
  }
  return result;
}

function estimateConfidence(content: string, formulaCount: number): number {
  let confidence = 0.5;
  if (content.includes('## 题目原文') && content.includes('## 物理公式')) confidence += 0.2;
  if (formulaCount > 0) confidence += 0.1;
  if (content.includes('## 考查知识点')) confidence += 0.1;
  if (content.includes('## 已知条件')) confidence += 0.05;
  if (content.includes('## 求解目标')) confidence += 0.05;
  return Math.min(confidence, 1.0);
}
