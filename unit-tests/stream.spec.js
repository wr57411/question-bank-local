/**
 * SSE 流式解析通用测试
 * 测试: parseSSELine, extractDelta, aggregateContent
 */
import { describe, it, expect } from 'vitest'
import { parseSSELine, extractDelta, aggregateContent } from './helpers/ai-test-lib.js'

describe('SSE 流式解析', () => {

  describe('parseSSELine', () => {
    it('正常 data 行', () => {
      const result = parseSSELine('data: {"choices":[{"delta":{"content":"hello"}}]}')
      expect(result.type).toBe('data')
      expect(result.data.choices[0].delta.content).toBe('hello')
    })

    it('[DONE] 信号', () => {
      expect(parseSSELine('data: [DONE]').type).toBe('done')
    })

    it('空行', () => {
      expect(parseSSELine('').type).toBe('empty')
      expect(parseSSELine('   ').type).toBe('empty')
    })

    it('非 data 行', () => {
      expect(parseSSELine(': keepalive').type).toBe('non-data')
      expect(parseSSELine('event: message').type).toBe('non-data')
    })

    it('JSON 解析错误行', () => {
      const result = parseSSELine('data: {broken json}')
      expect(result.type).toBe('parse-error')
      expect(result.error).toBeTruthy()
    })
  })

  describe('extractDelta', () => {
    it('正常 delta.content', () => {
      expect(extractDelta({ choices: [{ delta: { content: '你好' } }] })).toBe('你好')
    })

    it('choices[0].text 兼容', () => {
      expect(extractDelta({ choices: [{ text: '你好' }] })).toBe('你好')
    })

    it('空 choices', () => { expect(extractDelta({ choices: [] })).toBe('') })
    it('null data', () => { expect(extractDelta(null)).toBe('') })
    it('空 delta', () => { expect(extractDelta({ choices: [{ delta: {} }] })).toBe('') })
  })

  describe('aggregateContent', () => {
    it('正常多 chunk 拼接', () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"你"}}]}\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n',
        'data: {"choices":[{"delta":{"content":"世界"}}]}\n',
        'data: [DONE]\n'
      ]
      const result = aggregateContent(chunks)
      expect(result.fullText).toBe('你好世界')
      expect(result.chunkCount).toBe(3)
      expect(result.isDone).toBe(true)
    })

    it('多行合并在一个 chunk', () => {
      const chunks = ['data: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"choices":[{"delta":{"content":"B"}}]}\ndata: [DONE]\n']
      const result = aggregateContent(chunks)
      expect(result.fullText).toBe('AB')
      expect(result.isDone).toBe(true)
    })

    it('跨 chunk 的行分割', () => {
      const chunks = ['data: {"choices":[{"del', 'ta":{"content":"跨"}}]}\n', 'data: [DONE]\n']
      const result = aggregateContent(chunks)
      expect(result.fullText).toBe('跨')
    })

    it('JSON 解析错误行 -> 跳过继续', () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"前"}}]}\n',
        'data: {broken}\n',
        'data: {"choices":[{"delta":{"content":"后"}}]}\n',
        'data: [DONE]\n'
      ]
      const result = aggregateContent(chunks)
      expect(result.fullText).toBe('前后')
      expect(result.errors.length).toBe(1)
    })

    it('空 delta -> 不追加', () => {
      const chunks = [
        'data: {"choices":[{"delta":{}}]}\n',
        'data: {"choices":[{"delta":{"content":"有内容"}}]}\n',
        'data: [DONE]\n'
      ]
      const result = aggregateContent(chunks)
      expect(result.fullText).toBe('有内容')
      expect(result.chunkCount).toBe(1)
    })

    it('最终 buffer 残留 -> 正确处理', () => {
      const result = aggregateContent(['data: {"choices":[{"delta":{"content":"最后"}}]}'])
      expect(result.fullText).toBe('最后')
    })

    it('全部空行', () => {
      const result = aggregateContent(['\n', '\n', '\n'])
      expect(result.fullText).toBe('')
      expect(result.chunkCount).toBe(0)
    })
  })
})
