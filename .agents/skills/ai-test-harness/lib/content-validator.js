/**
 * ai-test-harness/lib/content-validator.js
 * LLM 输出内容质量校验器
 * 支持: 章节标记检查、最小长度、LaTeX 配对、DRAW 占位符
 */

function validateSections(text, requiredSections) {
  if (!requiredSections || !Array.isArray(requiredSections)) return { found: [], missing: [] };
  const found = requiredSections.filter(s => text.includes(s));
  const missing = requiredSections.filter(s => !text.includes(s));
  return { found, missing };
}

function validateLatex(text) {
  const errors = [];
  const inlineMatches = text.match(/\$[^$\n]+?\$/g) || [];
  for (const m of inlineMatches) {
    if (m === '$$') errors.push('发现空行内公式 $$');
  }
  const blockOpen = (text.match(/\$\$/g) || []).length;
  if (blockOpen % 2 !== 0) {
    errors.push(`块级公式 $$ 数量为奇数 (${blockOpen})，可能未闭合`);
  }
  return errors;
}

function validateDrawPlaceholders(text) {
  const draws = text.match(/\[DRAW:id=[\w]+:[^\]]+\]/g) || [];
  return { count: draws.length, placeholders: draws };
}

function validate(text, config) {
  const errors = [];
  const warnings = [];

  if (!text || typeof text !== 'string') {
    return { valid: false, errors: ['内容为空或非字符串'], sections_found: [], wordCount: 0 };
  }

  const wordCount = text.length;
  const charCount = text.replace(/\s/g, '').length;

  if (config.minLength && charCount < config.minLength) {
    errors.push(`内容过短: ${charCount} 字 < 要求 ${config.minLength} 字`);
  }

  let sections_found = [];
  let sections_missing = [];
  if (config.requiredSections) {
    const sectionResult = validateSections(text, config.requiredSections);
    sections_found = sectionResult.found;
    sections_missing = sectionResult.missing;
    if (sections_missing.length > 0) {
      errors.push(`缺少模块: ${sections_missing.join(', ')}`);
    }
  }

  if (config.latexCheck) {
    const latexErrors = validateLatex(text);
    warnings.push(...latexErrors);
  }

  const drawInfo = validateDrawPlaceholders(text);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sections_found,
    sections_missing,
    wordCount,
    charCount,
    drawPlaceholders: drawInfo.count
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validate, validateSections, validateLatex, validateDrawPlaceholders };
}
if (typeof window !== 'undefined') {
  window.AITestHarnessContentValidator = { validate, validateSections, validateLatex, validateDrawPlaceholders };
}
