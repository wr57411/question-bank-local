/**
 * atomizer 解析器 + schema 校验单元测试
 * 测试: safeParseJSON 脏数据解析 + JSON Schema 校验
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse, validate } from './helpers/ai-test-lib.js'

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

describe('atomizer - JSON 解析', () => {

  it('合法 JSON 数组 -> 正确解析', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_good.json'), 'utf8')
    const result = parse(fixture)
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.length).toBe(3)
    expect(result.errors).toHaveLength(0)
  })

  it('markdown 代码块包裹 -> 提取后正确解析', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_markdown_wrapped.txt'), 'utf8')
    const result = parse(fixture)
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.length).toBe(2)
  })

  it('带前缀文字 -> 正确提取 JSON', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_extra_text.txt'), 'utf8')
    const result = parse(fixture)
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('截断 JSON -> 返回 null', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_truncated.txt'), 'utf8')
    const result = parse(fixture)
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('空响应 -> 返回 null', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_empty.txt'), 'utf8')
    const result = parse(fixture)
    expect(result.data).toBeNull()
  })

  it('null 输入 -> 返回 null', () => {
    expect(parse(null).data).toBeNull()
    expect(parse(undefined).data).toBeNull()
    expect(parse('').data).toBeNull()
  })

  it('纯文本无 JSON -> 返回 null', () => {
    const result = parse('这是一段没有JSON的纯文本回复。')
    expect(result.data).toBeNull()
    expect(result.errors).toContain('未找到 JSON 数组或对象')
  })

  it('尾逗号 -> 修复后解析成功', () => {
    const result = parse('[{"name":"A","difficulty":"基础",},{"name":"B","difficulty":"进阶",}]')
    expect(result.data).not.toBeNull()
    expect(result.data.length).toBe(2)
  })

  it('控制字符 -> 清理后解析成功', () => {
    const result = parse('[{"name":"测试\u0000数据","difficulty":"基础"}]')
    expect(result.data).not.toBeNull()
  })
})

describe('atomizer - Schema 校验', () => {

  it('合法输出通过校验', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'atomizer_good.json'), 'utf8')
    const parsed = parse(fixture)
    const result = validate(parsed.data, ATOMIZER_SCHEMA)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('非数组 -> 校验失败', () => {
    const result = validate({ notAnArray: true }, ATOMIZER_SCHEMA)
    expect(result.valid).toBe(false)
  })

  it('空数组 -> 校验失败（minItems）', () => {
    const result = validate([], ATOMIZER_SCHEMA)
    expect(result.valid).toBe(false)
  })

  it('缺少 name 字段 -> 校验失败', () => {
    const result = validate([{ id: 'k001', difficulty: '基础' }], ATOMIZER_SCHEMA)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('name'))).toBe(true)
  })

  it('difficulty 不在枚举范围 -> 校验失败', () => {
    const result = validate([{ name: '测试', difficulty: '超级难' }], ATOMIZER_SCHEMA)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('枚举'))).toBe(true)
  })

  it('超长数组 -> 校验失败（maxItems）', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: `k${i}`, difficulty: '基础' }))
    const result = validate(items, ATOMIZER_SCHEMA)
    expect(result.valid).toBe(false)
  })
})
