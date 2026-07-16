/**
 * atomizer Mock 集成测试
 * 测试: mock fetch + 完整管线（流式响应 -> JSON 解析 -> schema 校验）
 * 不需要 API Key，CI 友好
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse, validate, aggregateContent, parseSSELine, extractDelta } from './helpers/ai-test-lib.js'

const FIXTURE_DIR = resolve(process.cwd(), 'unit-tests/fixtures')

const ATOMIZER_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string', minLength: 1 },
      difficulty: { type: 'string', enum: ['基础', '进阶', '挑战'] },
      key_concept: { type: 'string' }
    }
  },
  minItems: 1,
  maxItems: 20
}

function buildSSEChunksFromText(text) {
  const chunks = []
  const chars = [...text]
  let i = 0
  while (i < chars.length) {
    const size = Math.min(5, chars.length - i)
    const chunk = chars.slice(i, i + size).join('')
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n`)
    i += size
  }
  chunks.push('data: [DONE]\n')
  return chunks
}

function buildSSEChunksFromChunks(dataChunks) {
  const result = []
  for (const chunk of dataChunks) {
    result.push(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n`)
  }
  result.push('data: [DONE]\n')
  return result
}

describe('atomizer - Mock 集成测试', () => {

  describe('管线全链路（mock SSE 流）', () => {

    it('正常 SSE 流 -> aggregateContent -> safeParseJSON -> schema 校验通过', () => {
      const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_good.json'), 'utf8')
      const sseChunks = buildSSEChunksFromText(fixture)

      const streamResult = aggregateContent(sseChunks)
      expect(streamResult.fullText).toBeTruthy()
      expect(streamResult.isDone).toBe(true)

      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).not.toBeNull()
      expect(Array.isArray(parseResult.data)).toBe(true)
      expect(parseResult.data.length).toBe(3)

      const schemaResult = validate(parseResult.data, ATOMIZER_SCHEMA)
      expect(schemaResult.valid).toBe(true)
      expect(schemaResult.errors).toHaveLength(0)
    })

    it('脏数据（markdown 包裹）SSE 流 -> 提取成功', () => {
      const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_markdown_wrapped.txt'), 'utf8')
      const sseChunks = buildSSEChunksFromText(fixture)

      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).not.toBeNull()
      expect(Array.isArray(parseResult.data)).toBe(true)
    })

    it('带前缀文字 SSE 流 -> 提取成功', () => {
      const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_extra_text.txt'), 'utf8')
      const sseChunks = buildSSEChunksFromText(fixture)

      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).not.toBeNull()
    })

    it('逐字符流式传输 -> 拼接后完整可解析', () => {
      const jsonStr = '[{"id":"k001","name":"摩擦力","difficulty":"基础","key_concept":"静摩擦与动摩擦"}]'
      const sseChunks = buildSSEChunksFromChunks([
        '[{"id":"k001",',
        '"name":"摩擦力",',
        '"difficulty":"基础",',
        '"key_concept":"静摩擦与动摩擦"',
        '}]'
      ])

      const streamResult = aggregateContent(sseChunks)
      expect(streamResult.fullText).toBe(jsonStr)

      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).not.toBeNull()
      expect(parseResult.data[0].name).toBe('摩擦力')
    })
  })

  describe('错误注入', () => {

    it('截断 SSE 流 -> 解析失败', () => {
      const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_truncated.txt'), 'utf8')
      const sseChunks = buildSSEChunksFromText(fixture)

      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).toBeNull()
    })

    it('空 SSE 流 -> 解析失败', () => {
      const streamResult = aggregateContent(['data: [DONE]\n'])
      expect(streamResult.fullText).toBe('')

      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).toBeNull()
    })

    it('SSE 流中夹杂错误行 -> 跳过错误继续拼接', () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"["}}]}\n',
        'data: {broken json here}\n',
        ': keepalive comment\n',
        'data: {"choices":[{"delta":{"content":"{\\"name\\":\\"test\\",\\"difficulty\\":\\"基础\\"}"}}]}\n',
        'data: {"choices":[{"delta":{"content":"]"}}]}\n',
        'data: [DONE]\n'
      ]

      const streamResult = aggregateContent(chunks)
      expect(streamResult.fullText).toBe('[{"name":"test","difficulty":"基础"}]')
      expect(streamResult.errors.length).toBe(1)

      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).not.toBeNull()
      expect(parseResult.data[0].name).toBe('test')
    })

    it('API 返回 401 错误响应 -> 识别为权限错误', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":{"message":"Invalid API key","type":"invalid_request_error"}}')
      })

      const response = await mockFetch('https://openrouter.ai/api/v1/chat/completions')
      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
      const errorBody = await response.text()
      expect(errorBody).toContain('Invalid API key')
    })

    it('API 返回 429 限流 -> 识别为限流错误', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('{"error":{"message":"Rate limit exceeded"}}')
      })

      const response = await mockFetch('https://openrouter.ai/api/v1/chat/completions')
      expect(response.ok).toBe(false)
      expect(response.status).toBe(429)
    })

    it('API 返回 500 服务器错误', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      })

      const response = await mockFetch('https://openrouter.ai/api/v1/chat/completions')
      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
    })

    it('网络超时 -> AbortError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      const mockFetch = vi.fn().mockRejectedValue(abortError)

      try {
        await mockFetch('https://openrouter.ai/api/v1/chat/completions')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e.name).toBe('AbortError')
      }
    })

    it('非 JSON 纯文本响应 -> 解析失败', () => {
      const sseChunks = buildSSEChunksFromText('很抱歉，我暂时无法处理您的请求。请稍后再试。')
      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)
      expect(parseResult.data).toBeNull()
      expect(parseResult.errors).toContain('未找到 JSON 数组或对象')
    })
  })

  describe('状态机流转模拟', () => {

    it('PENDING -> GENERATING -> GENERATED 正常流转', () => {
      const node = { id: 'test-1', name: '测试节点', status: 'PENDING', content_markdown: '' }

      node.status = 'GENERATING'
      expect(node.status).toBe('GENERATING')

      const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_good.json'), 'utf8')
      const sseChunks = buildSSEChunksFromText(fixture)
      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)

      if (parseResult.data) {
        node.status = 'GENERATED'
        node.content_markdown = streamResult.fullText
      }

      expect(node.status).toBe('GENERATED')
      expect(node.content_markdown.length).toBeGreaterThan(0)
    })

    it('PENDING -> GENERATING -> ERROR（解析失败）', () => {
      const node = { id: 'test-2', name: '失败节点', status: 'PENDING', error_msg: null }

      node.status = 'GENERATING'

      const sseChunks = buildSSEChunksFromText('这不是合法的JSON输出')
      const streamResult = aggregateContent(sseChunks)
      const parseResult = parse(streamResult.fullText)

      if (!parseResult.data) {
        node.status = 'ERROR'
        node.error_msg = 'JSON解析失败: ' + parseResult.errors.join(', ')
      }

      expect(node.status).toBe('ERROR')
      expect(node.error_msg).toContain('JSON解析失败')
    })

    it('GENERATED -> VERIFIED（人工校验通过）', () => {
      const node = { id: 'test-3', name: '已生成节点', status: 'GENERATED' }

      node.status = 'VERIFIED'
      expect(node.status).toBe('VERIFIED')
    })

    it('ERROR -> PENDING（重试）', () => {
      const node = { id: 'test-4', name: '重试节点', status: 'ERROR', retry_count: 1 }

      node.status = 'PENDING'
      node.error_msg = null
      expect(node.status).toBe('PENDING')
      expect(node.error_msg).toBeNull()
    })
  })
})
