/**
 * ai-test-harness/lib/stream-parser.js
 * SSE/OpenAI 兼容流式响应解析器
 * 解析 data: {...} 格式，拼接 choices[0].delta.content
 */

function parseSSELine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'empty' };
  if (!trimmed.startsWith('data:')) return { type: 'non-data', raw: trimmed };

  const dataStr = trimmed.slice(5).trim();
  if (dataStr === '[DONE]') return { type: 'done' };

  try {
    const data = JSON.parse(dataStr);
    return { type: 'data', data };
  } catch (e) {
    return { type: 'parse-error', raw: dataStr, error: e.message };
  }
}

function extractDelta(data) {
  if (!data || !data.choices || !data.choices[0]) return '';
  return data.choices[0].delta?.content || data.choices[0].text || '';
}

function aggregateContent(rawChunks) {
  let fullText = '';
  let buffer = '';
  const errors = [];
  let chunkCount = 0;
  let isDone = false;

  for (const rawChunk of rawChunks) {
    buffer += rawChunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const parsed = parseSSELine(line);

      if (parsed.type === 'done') {
        isDone = true;
        continue;
      }
      if (parsed.type === 'empty' || parsed.type === 'non-data') continue;
      if (parsed.type === 'parse-error') {
        errors.push({ line: parsed.raw?.substring(0, 100), error: parsed.error });
        continue;
      }
      if (parsed.type === 'data') {
        const delta = extractDelta(parsed.data);
        if (delta) {
          fullText += delta;
          chunkCount++;
        }
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseSSELine(buffer);
    if (parsed.type === 'data') {
      const delta = extractDelta(parsed.data);
      if (delta) {
        fullText += delta;
        chunkCount++;
      }
    } else if (parsed.type === 'parse-error') {
      errors.push({ line: parsed.raw?.substring(0, 100), error: parsed.error });
    }
  }

  return { fullText, chunkCount, isDone, errors };
}

function buildSSEResponse(chunks) {
  return chunks.map(c => `data: ${JSON.stringify(c)}\n`).join('') + 'data: [DONE]\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSSELine, extractDelta, aggregateContent, buildSSEResponse };
}
if (typeof window !== 'undefined') {
  window.AITestHarnessStreamParser = { parseSSELine, extractDelta, aggregateContent, buildSSEResponse };
}
