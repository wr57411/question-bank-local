/**
 * AI Test Harness 测试辅助器
 * 重新导出 Skill lib 模块，供测试文件使用
 */
import { parse, stripMarkdownFences, extractJsonBlock, cleanControlChars, repairTrailingComma, repairSingleQuotes } from '../../.agents/skills/ai-test-harness/lib/json-parser.js'
import { validate, validateType } from '../../.agents/skills/ai-test-harness/lib/schema-validator.js'
import { parseSSELine, extractDelta, aggregateContent, buildSSEResponse } from '../../.agents/skills/ai-test-harness/lib/stream-parser.js'
import { validate as validateContent, validateSections, validateLatex, validateDrawPlaceholders } from '../../.agents/skills/ai-test-harness/lib/content-validator.js'

export {
  parse, stripMarkdownFences, extractJsonBlock, cleanControlChars, repairTrailingComma, repairSingleQuotes,
  validate, validateType,
  parseSSELine, extractDelta, aggregateContent, buildSSEResponse,
  validateContent, validateSections, validateLatex, validateDrawPlaceholders
}
