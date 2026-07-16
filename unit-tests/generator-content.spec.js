/**
 * generator 内容质量校验单元测试
 * 测试: validateContent 对 LLM 生成 Markdown 内容的校验
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { validateContent } from './helpers/ai-test-lib.js'

const FIXTURE_DIR = resolve(process.cwd(), 'unit-tests/fixtures')

const GENERATOR_CONFIG = {
  type: 'markdown',
  minLength: 500,
  requiredSections: ['模块一', '模块二', '模块三', '模块四', '模块五'],
  latexCheck: true
}

describe('generator - 内容质量校验', () => {

  it('完整五模块内容 -> valid', () => {
    const longContent = `
## 模块一：概念原子化拆解
这里是模块一的详细内容，包含多个物理公式和定理。牛顿第二定律是经典力学的核心定律之一，它描述了力与运动之间的关系。公式表达为 F=ma，其中 F 是合外力，m 是物体质量，a 是加速度。这一定律在高考中几乎每年必考，考察形式包括单选题、多选题和计算题。

## 模块二：沉浸式样例库
这里是模块二的详细内容，包含多个样例和解题步骤。这些内容需要足够长以满足最小长度要求。我们添加更多的物理公式和详细解析。样例一：一个质量为2kg的物体在水平面上受到10N的水平推力作用，求加速度。解题思路：首先进行受力分析，竖直方向上重力和支持力平衡，水平方向上只有推力，因此由牛顿第二定律 F=ma 可得 a=F/m=10/2=5m/s²。

## 模块三：配对练习
这里是模块三的练习内容。每道练习都配有详细解析。学生需要通过模仿来掌握核心概念。练习一：一个质量为5kg的物体受到15N的合外力作用，求其加速度大小和方向。参考答案：由 F=ma 得 a=15/5=3m/s²，方向与力的方向相同。

## 模块四：变式组题
这里是模块四的变式题目。难度有所提升，需要综合运用前面学到的原子化模型。变式一：在粗糙水平面上，质量为3kg的物体受到水平推力 F=12N 作用，已知摩擦系数为0.2，求加速度。提示：需要先计算摩擦力 f=μmg，再用 F-f=ma 求解。

## 模块五：小循环复习包
这里是模块五的复习检查题，帮助学生巩固所学知识。
1. 以下哪个选项正确描述了牛顿第二定律？A. F=ma B. F=mv C. F=ma² D. F=m/a
2. 质量为4kg的物体受到8N的力，加速度是多少？
3. 连接体问题中，整体法适用于什么情况？
4. 请简述牛顿第二定律的适用条件。
5. 在太空中，牛顿第二定律是否仍然成立？
    `.trim()
    const result = validateContent(longContent, GENERATOR_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.sections_found.length).toBe(5)
    expect(result.charCount).toBeGreaterThanOrEqual(500)
  })

  it('缺少模块 -> invalid + 指出缺少哪些', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'generator_missing_modules.txt'), 'utf8')
    const longContent = fixture + '\n' + '补充内容以达到最小长度要求。' + 'x'.repeat(500)
    const result = validateContent(longContent, GENERATOR_CONFIG)
    expect(result.sections_missing.length).toBeGreaterThan(0)
  })

  it('内容过短 -> invalid', () => {
    const fixture = readFileSync(resolve(FIXTURE_DIR, 'generator_short_response.txt'), 'utf8')
    const result = validateContent(fixture, GENERATOR_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('过短'))).toBe(true)
  })

  it('空内容 -> invalid', () => {
    const result = validateContent('', GENERATOR_CONFIG)
    expect(result.valid).toBe(false)
  })

  it('null 输入 -> invalid', () => {
    const result = validateContent(null, GENERATOR_CONFIG)
    expect(result.valid).toBe(false)
  })
})
