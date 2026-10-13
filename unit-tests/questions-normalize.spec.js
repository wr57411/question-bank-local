import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('localforage', {
  createInstance: () => ({
    iterate: async () => {},
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {}
  })
})

const { recordNeedsNormalization } = await import('../src/data/questions')

const fullRecord = (extra = {}) => ({
  id: 'q1',
  question_image_url: 'data:image/jpeg;base64,AAA',
  answer_image_url: null,
  question_image_blank_url: null,
  layout_type: 1,
  versions: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  purged_at: null,
  semantic_summary: '',
  ai_metadata: {},
  user_comment: '',
  book_name: '',
  page_number: '',
  question_number: '',
  ...extra
})

describe('recordNeedsNormalization', () => {
  it('字段齐全的记录无需写回', () => {
    expect(recordNeedsNormalization(fullRecord())).toBe(false)
  })

  it('缺 semantic_summary 需要写回', () => {
    const r = fullRecord(); delete r.semantic_summary
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('缺 ai_metadata 需要写回', () => {
    const r = fullRecord(); delete r.ai_metadata
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('缺 versions 需要写回', () => {
    const r = fullRecord(); delete r.versions
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('缺 question_image_url 需要写回', () => {
    const r = fullRecord(); delete r.question_image_url
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('缺 book_name/page_number/question_number 需要写回', () => {
    const r = fullRecord(); delete r.book_name; delete r.page_number; delete r.question_number
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('存在 camelCase 旧字段且缺 snake_case 需要写回', () => {
    const r = fullRecord(); delete r.layout_type; r.layoutType = 1
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('camelCase 旧字段存在但 snake_case 也在时无需写回', () => {
    expect(recordNeedsNormalization(fullRecord({ layoutType: 1 }))).toBe(false)
  })

  it('缺 id 需要写回', () => {
    const r = fullRecord(); delete r.id
    expect(recordNeedsNormalization(r)).toBe(true)
  })

  it('大 base64 字段不影响判定性能语义（仅字段存在性检查）', () => {
    const r = fullRecord({ question_image_url: 'data:image/jpeg;base64,' + 'A'.repeat(500000) })
    expect(recordNeedsNormalization(r)).toBe(false)
  })
})
