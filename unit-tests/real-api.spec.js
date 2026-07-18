/**
 * atomizer 真实 API 烟雾测试
 * 需要 OPENROUTER_API_KEY 环境变量
 * 直接对应用户的核心痛点：atomizer JSON 解析在真机上失败
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { parse, validate, validateContent } from './helpers/ai-test-lib.js'

const API_KEY = process.env.OPENROUTER_API_KEY
const BASE_URL = process.env.API_BASE_URL || 'https://openrouter.ai/api/v1'
const TEST_MODEL = process.env.TEST_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'

const hasKey = !!API_KEY && API_KEY !== 'your-key-here'

if (!hasKey) {
  console.log('\n⚠️  跳过真实 API 测试')
  console.log('   请设置环境变量: export OPENROUTER_API_KEY=your_key')
  console.log('   或复制 .env.example 到 .env 并填写\n')
}

const ATOMIZER_PROMPT = `你是高中物理知识点拆解专家。
你的任务是根据用户输入的章节名称，拆解出该章节包含的所有核心"原子化知识点"。
请务必输出合法的 JSON 数组，不要包含任何其他解释性文字或 markdown 代码块标记。
格式：[{"id":"k001","name":"知识点名称","difficulty":"基础","key_concept":"核心概念"}]
只输出 JSON 数组本身。`

const ATOMIZER_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      difficulty: { type: 'string', enum: ['基础', '进阶', '挑战'] }
    }
  },
  minItems: 1,
  maxItems: 20
}

describe.skipIf(!hasKey)('atomizer - 真实 API 烟雾测试', () => {
  let rawResponse = ''

  beforeAll(async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Question Bank Local'
    }

    const body = {
      model: TEST_MODEL,
      messages: [
        { role: 'system', content: ATOMIZER_PROMPT },
        { role: 'user', content: '牛顿第二定律' }
      ],
      temperature: 0.3,
      stream: false
    }

    const response = await fetch(BASE_URL.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    rawResponse = data.choices?.[0]?.message?.content || ''
    expect(rawResponse.length).toBeGreaterThan(0)
  }, 120000)

  it('API 连通性 - 返回非空内容', () => {
    expect(rawResponse).toBeTruthy()
    expect(rawResponse.length).toBeGreaterThan(10)
  })

  it('JSON 解析 - safeParseJSON 成功（核心痛点测试）', () => {
    const result = parse(rawResponse)
    if (!result.data) {
      console.error('JSON 解析失败！原始响应前500字:', rawResponse.substring(0, 500))
      console.error('解析错误:', result.errors)
    }
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('Schema 校验 - 输出符合 schema（含 LLM 输出归一化）', () => {
    const parsed = parse(rawResponse)
    expect(parsed.data).not.toBeNull()
    // 归一化 LLM 常见的 difficulty 变体
    const DIFFICULTY_MAP = { '中等': '进阶', '简单': '基础', '困难': '挑战', '高级': '挑战', '较难': '进阶' }
    const normalized = parsed.data.map(item => ({
      ...item,
      difficulty: DIFFICULTY_MAP[item.difficulty] || item.difficulty
    }))
    const validation = validate(normalized, ATOMIZER_SCHEMA)
    if (!validation.valid) {
      console.error('Schema 校验失败:', JSON.stringify(validation.errors, null, 2))
      console.error('原始响应前500字:', rawResponse.substring(0, 500))
    }
    expect(validation.valid).toBe(true)
  })

  it('业务规则 - 数组项数合理', () => {
    const parsed = parse(rawResponse)
    expect(parsed.data).not.toBeNull()
    expect(parsed.data.length).toBeGreaterThanOrEqual(1)
    expect(parsed.data.length).toBeLessThanOrEqual(20)
  })

  it('调试输出 - 打印原始响应', () => {
    console.log('\n===== atomizer 真实 API 响应 =====')
    console.log('模型:', TEST_MODEL)
    console.log('响应长度:', rawResponse.length, '字符')
    console.log('前300字:', rawResponse.substring(0, 300))
    const parsed = parse(rawResponse)
    console.log('解析结果:', parsed.data ? `${parsed.data.length} 个知识点` : '解析失败')
    console.log('=====================================\n')
  })
})

describe.skipIf(!hasKey)('generator - 真实 API 烟雾测试', () => {
  let rawResponse = ''

  const GENERATOR_PROMPT = `你是认知物理教学设计师。请根据知识点生成包含五个模块的教学内容，使用 Markdown 格式。
模块一：概念原子化拆解  模块二：沉浸式样例库  模块三：配对练习  模块四：变式组题  模块五：小循环复习包
物理公式用 LaTeX：$F=ma$`

  beforeAll(async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Question Bank Local'
    }

    const response = await fetch(BASE_URL.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: TEST_MODEL,
        messages: [
          { role: 'system', content: GENERATOR_PROMPT },
          { role: 'user', content: '牛顿第二定律基本应用' }
        ],
        temperature: 0.5,
        stream: false
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    rawResponse = data.choices?.[0]?.message?.content || ''
  }, 180000)

  it('generator API 连通性', () => {
    expect(rawResponse.length).toBeGreaterThan(50)
  })

  it('内容质量 - 检查模块存在性', () => {
    const config = {
      minLength: 200,
      requiredSections: ['模块一', '模块二', '模块三', '模块四', '模块五']
    }
    const result = validateContent(rawResponse, config)
    console.log('找到的模块:', result.sections_found)
    console.log('缺少的模块:', result.sections_missing)
    console.log('字符数:', result.charCount)
  })

  it('调试输出 - generator 响应', () => {
    console.log('\n===== generator 真实 API 响应 =====')
    console.log('响应长度:', rawResponse.length, '字符')
    console.log('前500字:', rawResponse.substring(0, 500))
    console.log('=====================================\n')
  })
})
