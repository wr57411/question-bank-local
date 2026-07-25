export interface AIProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpoint?: string;
  authHeader?: string;
  authScheme?: string | null;
}

export interface StreamOptions {
  systemPrompt?: string | null;
  temperature?: number;
  timeout?: number;
}

export interface MultimodalResult {
  text: string;
  images: string[];
}

export const KNOWLEDGE_ATOMIZER_PROMPT = `你是高中物理知识点拆解专家。
你的任务是根据用户输入的章节名称，拆解出该章节包含的所有核心"原子化知识点"。

拆解原则：
1. 最小化原则：每个知识点应当是一个独立的、高考必考的最小模型（如："单体动态分析"、"连接体整体法"、"斜面模型"）。
2. 高考导向：结合高考考纲，识别高频考点。
3. 难度分级：对每个知识点标记难度（基础/进阶/挑战）。
4. 完整覆盖：确保章节内所有重要知识点均被拆解，不遗漏。

输出要求：
请务必输出合法的 JSON 数组，不要包含任何其他解释性文字或 markdown 代码块标记。
格式如下：
[
  {
    "id": "k001",
    "name": "知识点名称",
    "difficulty": "基础",
    "key_concept": "核心概念简述（一句话）"
  }
]

只输出 JSON 数组本身，不要有任何前缀或后缀文字。`;

export const KNOWLEDGE_ATOMIZER_PROMPT_MULTIMODAL = `你是高中物理知识点拆解专家，同时具备绘制物理示意图的能力。
你的任务是根据用户输入的章节名称，拆解出该章节包含的所有核心"原子化知识点"，并为每个知识点绘制一幅简洁的示意图。

拆解原则：
1. 最小化原则：每个知识点应当是一个独立的、高考必考的最小模型（如："单体动态分析"、"连接体整体法"、"斜面模型"）。
2. 高考导向：结合高考考纲，识别高频考点。
3. 难度分级：对每个知识点标记难度（基础/进阶/挑战）。
4. 完整覆盖：确保章节内所有重要知识点均被拆解，不遗漏。

示意图要求：
- 为每个知识点生成一幅简洁的物理示意图（受力分析图、运动轨迹图、电路图、光路图等）
- 图片格式：SVG 代码（放在 diagram 字段中）
- 风格：黑白线条为主，标注关键物理量（用 LaTeX 或文字），简洁清晰，适合教学
- 尺寸：viewBox 建议 200x150 或 200x200

输出要求：
请务必输出合法的 JSON 数组，不要包含任何其他解释性文字或 markdown 代码块标记。
格式如下：
[
  {
    "id": "k001",
    "name": "知识点名称",
    "difficulty": "基础",
    "key_concept": "核心概念简述（一句话）",
    "diagram": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 150'>...</svg>"
  }
]

只输出 JSON 数组本身，不要有任何前缀或后缀文字。diagram 字段为完整的 SVG 字符串。`;

export const TEACHING_GENERATOR_PROMPT = `你是认知物理教学设计师，专注帮助基础薄弱学生掌握高中物理。
核心理念：沉浸式重复、样例学习、降低认知负荷。

请根据用户输入的【物理知识点】，严格按照以下五个模块生成教学内容。每个模块必须完整，使用 Markdown 格式输出。

## 格式规范
- 物理公式必须使用 LaTeX 格式：
  - 行内公式用 \`$...$\`，如 \`$F = ma$\`
  - 块级公式用 \`$$...$$\`，如 \`$$E = \\frac{1}{2}mv^2$$\`
  - 希腊字母用 LaTeX 命令：\`$\\alpha$\`, \`$\\theta$\`, \`$\\mu$\`, \`$\\omega$\`
  - 向量用 \`$\\vec{F}$\`，分式用 \`$\\frac{a}{b}$\`
- 需要图示的地方，插入占位标记：[DRAW:id=<唯一英文ID>:<中文描述>]
  - 示例：[DRAW:id=fbd01:斜面上物体受力分析图，标出重力、支持力、摩擦力方向]
  - 示例：[DRAW:id=circuit01:串联电路图，包含电池、电阻R1和R2、开关]
  - ID 必须唯一且为英文+数字组合

## 模块一：概念原子化拆解
- 分析该知识点在高考中常见的考察形式。
- 将其拆解为3-5个"原子化"基础模型。
- 输出一个清晰的模型列表，指出哪个是入门首选。

## 模块二：沉浸式样例库
针对每一个"原子化模型"，设计一组（3-4个）不同场景的样例。每个样例必须包含：
1. 情境描述：生动的物理场景。如有需要可插入 [DRAW:...] 占位标记。
2. 解题思维支架：目标是什么？用什么核心规律？关键步骤是什么？
3. 设计意图：说明这个场景是为了让学生熟悉哪个特定的细节变化。

## 模块三：配对练习
为每个样例设计一个高度相似的"模仿题"，要求学生练习。

## 模块四：变式组题
将上述原子模型进行组合或变形，设计2-3道稍有难度的题目。

## 模块五：小循环复习包
设计一组适合一周后复习的快速检查题（3-5道选择题）。

请确保内容准确、条理清晰，适合高中物理教学使用。`;

let _getProvider: (() => AIProvider | null) | null = null;

export function setProviderGetter(fn: () => AIProvider | null): void {
  _getProvider = fn;
}

function getCurrentProvider(): AIProvider | null {
  if (_getProvider) return _getProvider();
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.getCurrentProvider === 'function') return (w.getCurrentProvider as () => AIProvider | null)();
  return null;
}

function buildHeaders(provider: AIProvider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = provider.authHeader || 'Authorization';
  const authScheme = provider.authScheme != null ? provider.authScheme : 'Bearer';
  if (provider.apiKey) {
    headers[authHeader] = authScheme ? `${authScheme} ${provider.apiKey}` : provider.apiKey;
  }
  if (provider.baseUrl.includes('openrouter')) {
    headers['HTTP-Referer'] = 'http://localhost';
    headers['X-Title'] = 'Question Bank Local';
  }
  return headers;
}

function buildUrl(provider: AIProvider): string {
  if (provider.endpoint) return provider.endpoint;
  return provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

export async function callCloudAI(prompt: string, imageBase64?: string): Promise<string> {
  const provider = getCurrentProvider();
  if (!provider) throw new Error('请先添加并选择一个模型服务商');

  let content: unknown = prompt;
  if (imageBase64) {
    const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : 'data:image/jpeg;base64,' + imageBase64;
    content = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(buildUrl(provider), {
      method: 'POST',
      headers: buildHeaders(provider),
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content }], temperature: 0.7 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('API 请求失败: ' + response.status + ' - ' + errorText);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error('API 请求超时（60秒）');
    throw error;
  }
}

export async function callCloudAIStream(prompt: string, onChunk?: (delta: string, full: string) => void, options: StreamOptions = {}): Promise<string> {
  const provider = getCurrentProvider();
  if (!provider) throw new Error('请先添加并选择一个模型服务商');

  const messages: { role: string; content: string }[] = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const timeoutMs = options.timeout || 120000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(provider), {
      method: 'POST',
      headers: buildHeaders(provider),
      body: JSON.stringify({ model: provider.model, messages, temperature: options.temperature ?? 0.7, stream: true }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('API 请求失败: ' + response.status + ' - ' + errorText.substring(0, 200));
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr !== '[DONE]') {
              try {
                const data = JSON.parse(dataStr);
                const delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || '';
                if (delta) { fullText += delta; onChunk?.(delta, fullText); }
              } catch { /* skip */ }
            }
          }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || '';
          if (delta) { fullText += delta; onChunk?.(delta, fullText); }
        } catch { /* skip */ }
      }
    }
    return fullText;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`API 请求超时（${timeoutMs / 1000}秒）`);
    throw error;
  }
}

export async function callCloudAIMultimodal(prompt: string, options: StreamOptions = {}): Promise<MultimodalResult> {
  const provider = getCurrentProvider();
  if (!provider) throw new Error('请先添加并选择一个模型服务商');

  const messages: { role: string; content: string }[] = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const timeoutMs = options.timeout || 180000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(provider), {
      method: 'POST',
      headers: buildHeaders(provider),
      body: JSON.stringify({ model: provider.model, messages, temperature: options.temperature ?? 0.5 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('API 请求失败: ' + response.status + ' - ' + errorText.substring(0, 200));
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) return { text: '', images: [] };

    let text = '';
    const images: string[] = [];
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') text += part.text || '';
        else if (part.type === 'image_url' && part.image_url) images.push(part.image_url.url || '');
        else if (part.type === 'image' && part.image) images.push(part.image.url || part.image.data || '');
      }
    }
    return { text, images };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`API 请求超时（${timeoutMs / 1000}秒）`);
    throw error;
  }
}

export function safeParseJSON(text: string | null): unknown {
  if (!text) return null;
  let cleaned = text.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const startBracket = cleaned.indexOf('[');
  const startBrace = cleaned.indexOf('{');

  let start = -1, closeChar = '';
  if (startBracket !== -1 && (startBrace === -1 || startBracket < startBrace)) {
    start = startBracket; closeChar = ']';
  } else if (startBrace !== -1) {
    start = startBrace; closeChar = '}';
  } else {
    return null;
  }

  const end = cleaned.lastIndexOf(closeChar);
  if (end <= start) return null;
  cleaned = cleaned.substring(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(cleaned.replace(/[\x00-\x1f\x7f]/g, ''));
    } catch {
      return null;
    }
  }
}
