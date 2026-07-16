/**
 * ai-test-harness/lib/json-parser.js
 * 通用脏 JSON 解析器 - 从 LLM 输出中鲁棒提取 JSON
 * 框架无关，可在任何 JS 环境运行
 */

function stripMarkdownFences(text) {
  if (!text) return text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text;
}

function extractJsonBlock(text) {
  if (!text) return null;
  const startBracket = text.indexOf('[');
  const startBrace = text.indexOf('{');

  let start = -1, closeChar = '';
  if (startBracket !== -1 && (startBrace === -1 || startBracket < startBrace)) {
    start = startBracket;
    closeChar = ']';
  } else if (startBrace !== -1) {
    start = startBrace;
    closeChar = '}';
  } else {
    return null;
  }

  const end = text.lastIndexOf(closeChar);
  if (end <= start) return null;
  return text.substring(start, end + 1);
}

function cleanControlChars(text) {
  if (!text) return text;
  return text.replace(/[\x00-\x1f\x7f]/g, '');
}

function repairTrailingComma(text) {
  if (!text) return text;
  return text.replace(/,\s*([\]}])/g, '$1');
}

function repairSingleQuotes(text) {
  if (!text) return text;
  return text
    .replace(/(?<=[\[{,]\s*)'([^']*?)'(?=\s*[,}\]])/g, '"$1"')
    .replace(/'([^']*?)'\s*:/g, '"$1":');
}

function parse(text) {
  const errors = [];
  const rawText = text;

  if (!text || typeof text !== 'string') {
    return { data: null, errors: ['输入为空或非字符串'], rawText: text };
  }

  let cleaned = text.trim();

  cleaned = stripMarkdownFences(cleaned);

  const extracted = extractJsonBlock(cleaned);
  if (!extracted) {
    return { data: null, errors: ['未找到 JSON 数组或对象'], rawText };
  }
  cleaned = extracted;

  let result = null;

  try {
    result = JSON.parse(cleaned);
    return { data: result, errors: [], rawText };
  } catch (e1) {
    errors.push('首次解析失败: ' + e1.message);
  }

  let repaired = cleanControlChars(cleaned);
  try {
    result = JSON.parse(repaired);
    return { data: result, errors, rawText };
  } catch (e2) {
    errors.push('清理控制字符后仍失败: ' + e2.message);
  }

  repaired = repairTrailingComma(repaired);
  try {
    result = JSON.parse(repaired);
    errors.push('通过修复尾逗号成功解析');
    return { data: result, errors, rawText };
  } catch (e3) {
    errors.push('修复尾逗号后仍失败: ' + e3.message);
  }

  repaired = repairSingleQuotes(repaired);
  try {
    result = JSON.parse(repaired);
    errors.push('通过修复单引号成功解析');
    return { data: result, errors, rawText };
  } catch (e4) {
    errors.push('修复单引号后仍失败: ' + e4.message);
  }

  return { data: null, errors, rawText };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parse, stripMarkdownFences, extractJsonBlock, cleanControlChars, repairTrailingComma, repairSingleQuotes };
}
if (typeof window !== 'undefined') {
  window.AITestHarnessJsonParser = { parse, stripMarkdownFences, extractJsonBlock, cleanControlChars, repairTrailingComma, repairSingleQuotes };
}
