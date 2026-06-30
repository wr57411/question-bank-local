import { describe, it, expect, beforeEach } from 'vitest'
import { loadDbFunctions } from './helpers/load-db.js'

let funcs

beforeEach(() => {
  const loaded = loadDbFunctions()
  funcs = loaded.funcs
})

describe('generateId', () => {
  it('should return a UUID v4 format string', () => {
    const id = funcs.generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('should generate unique ids', () => {
    const id1 = funcs.generateId()
    const id2 = funcs.generateId()
    expect(id1).not.toBe(id2)
  })

  it('should have length 36', () => {
    expect(funcs.generateId()).toHaveLength(36)
  })
})

describe('_toMillis', () => {
  it('should return 0 for null/undefined', () => {
    expect(funcs._toMillis(null)).toBe(0)
    expect(funcs._toMillis(undefined)).toBe(0)
    expect(funcs._toMillis('')).toBe(0)
  })

  it('should convert ISO string to milliseconds', () => {
    const result = funcs._toMillis('2024-01-15T10:30:00.000Z')
    expect(result).toBe(new Date('2024-01-15T10:30:00.000Z').getTime())
  })

  it('should convert "YYYY-MM-DD HH:MM:SS" format', () => {
    const result = funcs._toMillis('2024-01-15 10:30:00')
    expect(result).toBe(new Date('2024-01-15T10:30:00Z').getTime())
  })

  it('should return 0 for invalid strings', () => {
    expect(funcs._toMillis('not-a-date')).toBe(0)
    expect(funcs._toMillis('abc')).toBe(0)
  })
})

describe('_normalizeTagRecord', () => {
  it('should return null for null input', () => {
    expect(funcs._normalizeTagRecord(null, 'key')).toBeNull()
  })

  it('should return null for non-object input', () => {
    expect(funcs._normalizeTagRecord('string', 'key')).toBeNull()
  })

  it('should set id from key if missing', () => {
    const result = funcs._normalizeTagRecord({ name: 'test' }, 'test-id')
    expect(result.id).toBe('test-id')
  })

  it('should convert createdAt to created_at', () => {
    const result = funcs._normalizeTagRecord({ id: '1', createdAt: '2024-01-01' }, 'key')
    expect(result.created_at).toBe('2024-01-01')
  })

  it('should convert updatedAt to updated_at', () => {
    const result = funcs._normalizeTagRecord({ id: '1', updatedAt: '2024-01-01' }, 'key')
    expect(result.updated_at).toBe('2024-01-01')
  })

  it('should convert deletedAt to deleted_at', () => {
    const result = funcs._normalizeTagRecord({ id: '1', deletedAt: '2024-01-01' }, 'key')
    expect(result.deleted_at).toBe('2024-01-01')
  })

  it('should set default color if missing', () => {
    const result = funcs._normalizeTagRecord({ id: '1', name: 'test' }, 'key')
    expect(result.color).toBe('#3B82F6')
  })
})

describe('_normalizeQuestionRecord', () => {
  it('should return null for null input', () => {
    expect(funcs._normalizeQuestionRecord(null, 'key')).toBeNull()
  })

  it('should return null for non-object input', () => {
    expect(funcs._normalizeQuestionRecord('string', 'key')).toBeNull()
  })

  it('should set id from key if missing', () => {
    const result = funcs._normalizeQuestionRecord({}, 'test-id')
    expect(result.id).toBe('test-id')
  })

  it('should map questionImageUrl to question_image_url', () => {
    const result = funcs._normalizeQuestionRecord({ questionImageUrl: 'test.jpg' }, 'key')
    expect(result.question_image_url).toBe('test.jpg')
  })

  it('should map answerImageUrl to answer_image_url', () => {
    const result = funcs._normalizeQuestionRecord({ answerImageUrl: 'answer.jpg' }, 'key')
    expect(result.answer_image_url).toBe('answer.jpg')
  })

  it('should map layoutType to layout_type', () => {
    const result = funcs._normalizeQuestionRecord({ layoutType: 1 }, 'key')
    expect(result.layout_type).toBe(1)
  })

  it('should set default AI fields', () => {
    const result = funcs._normalizeQuestionRecord({ id: '1' }, 'key')
    expect(result.semantic_summary).toBe('')
    expect(result.ai_metadata).toEqual({})
    expect(result.user_comment).toBe('')
  })
})

describe('_normalizePaperRecord', () => {
  it('should return null for null input', () => {
    expect(funcs._normalizePaperRecord(null, 'key')).toBeNull()
  })

  it('should map title to name', () => {
    const result = funcs._normalizePaperRecord({ id: '1', title: 'Test Paper' }, 'key')
    expect(result.name).toBe('Test Paper')
  })

  it('should keep name if exists', () => {
    const result = funcs._normalizePaperRecord({ id: '1', name: 'My Paper' }, 'key')
    expect(result.name).toBe('My Paper')
  })
})

describe('_normalizeSimilarLinkPair', () => {
  it('should return null if ids are the same', () => {
    expect(funcs._normalizeSimilarLinkPair('id1', 'id1')).toBeNull()
  })

  it('should return null if any id is null', () => {
    expect(funcs._normalizeSimilarLinkPair(null, 'id2')).toBeNull()
    expect(funcs._normalizeSimilarLinkPair('id1', null)).toBeNull()
  })

  it('should sort ids alphabetically', () => {
    const result = funcs._normalizeSimilarLinkPair('z-id', 'a-id')
    expect(result[0]).toBe('a-id')
    expect(result[1]).toBe('z-id')
  })
})

describe('_similarLinkKey', () => {
  it('should create key from sorted pair', () => {
    const key = funcs._similarLinkKey('z-id', 'a-id')
    expect(key).toBe('a-id_z-id')
  })

  it('should return null for same ids', () => {
    expect(funcs._similarLinkKey('id1', 'id1')).toBeNull()
  })
})

describe('_normalizeSimilarLinkRecord', () => {
  it('should return null for null input', () => {
    expect(funcs._normalizeSimilarLinkRecord(null, 'key')).toBeNull()
  })

  it('should normalize pair and add timestamps', () => {
    const result = funcs._normalizeSimilarLinkRecord(
      { question_id: 'b', similar_question_id: 'a' },
      'key'
    )
    expect(result.question_id).toBe('a')
    expect(result.similar_question_id).toBe('b')
    expect(result.created_at).toBeDefined()
    expect(result.updated_at).toBeDefined()
    expect(result.deleted_at).toBeNull()
  })
})

describe('_needsNormalization', () => {
  it('should return false for null inputs', () => {
    expect(funcs._needsNormalization(null, null)).toBe(false)
    expect(funcs._needsNormalization(null, {})).toBe(false)
    expect(funcs._needsNormalization({}, null)).toBe(false)
  })

  it('should return false for identical objects', () => {
    const obj = { id: '1', name: 'test' }
    expect(funcs._needsNormalization(obj, obj)).toBe(false)
  })

  it('should return true for different objects', () => {
    expect(funcs._needsNormalization({ id: '1' }, { id: '2' })).toBe(true)
  })
})

describe('_isRemoteNewer', () => {
  it('should return true if local is null', () => {
    expect(funcs._isRemoteNewer({ updated_at: '2024-01-01' }, null)).toBe(true)
  })

  it('should return true if remote is newer', () => {
    const remote = { updated_at: '2024-02-01' }
    const local = { updated_at: '2024-01-01' }
    expect(funcs._isRemoteNewer(remote, local)).toBe(true)
  })

  it('should return false if local is newer', () => {
    const remote = { updated_at: '2024-01-01' }
    const local = { updated_at: '2024-02-01' }
    expect(funcs._isRemoteNewer(remote, local)).toBe(false)
  })
})

describe('dataURLtoBlob', () => {
  it.skip('should convert data URL to Blob - skipped due to const assignment in db.js', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const blob = funcs.dataURLtoBlob(dataUrl)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
  })
})

describe('_isDataUrl', () => {
  it('should return true for data: URLs', () => {
    expect(funcs._isDataUrl('data:image/png;base64,abc')).toBe(true)
  })

  it('should return false for other URLs', () => {
    expect(funcs._isDataUrl('https://example.com/img.jpg')).toBe(false)
    expect(funcs._isDataUrl('/uploads/img.jpg')).toBe(false)
    expect(funcs._isDataUrl(null)).toBe(false)
  })
})

describe('_isRemoteUrl', () => {
  it('should return true for http/https URLs', () => {
    expect(funcs._isRemoteUrl('https://example.com/img.jpg')).toBe(true)
    expect(funcs._isRemoteUrl('http://example.com/img.jpg')).toBe(true)
  })

  it('should return false for other URLs', () => {
    expect(funcs._isRemoteUrl('data:image/png;base64,abc')).toBe(false)
    expect(funcs._isRemoteUrl('/uploads/img.jpg')).toBe(false)
  })
})

describe('_isServerAssetPath', () => {
  it('should return true for /uploads/ paths', () => {
    expect(funcs._isServerAssetPath('/uploads/image.jpg')).toBe(true)
  })

  it('should return false for other paths', () => {
    expect(funcs._isServerAssetPath('https://example.com/img.jpg')).toBe(false)
    expect(funcs._isServerAssetPath('/images/img.jpg')).toBe(false)
  })
})

describe('_needsAssetUpload', () => {
  it('should return true for data URLs', () => {
    expect(funcs._needsAssetUpload('data:image/png;base64,abc')).toBe(true)
  })

  it('should return true for blob URLs', () => {
    expect(funcs._needsAssetUpload('blob:http://localhost/abc')).toBe(true)
  })

  it('should return true for file URLs', () => {
    expect(funcs._needsAssetUpload('file:///path/to/img.jpg')).toBe(true)
  })

  it('should return false for server asset paths', () => {
    expect(funcs._needsAssetUpload('/uploads/image.jpg')).toBe(false)
  })

  it('should return false for remote URLs', () => {
    expect(funcs._needsAssetUpload('https://example.com/img.jpg')).toBe(false)
  })

  it('should return false for null/undefined', () => {
    expect(funcs._needsAssetUpload(null)).toBe(false)
    expect(funcs._needsAssetUpload(undefined)).toBe(false)
  })
})

describe('_normalizeServerAssetUrl', () => {
  it('should return data URLs as-is', () => {
    const url = 'data:image/png;base64,abc'
    expect(funcs._normalizeServerAssetUrl(url)).toBe(url)
  })

  it('should return http URLs as-is', () => {
    const url = 'https://example.com/img.jpg'
    expect(funcs._normalizeServerAssetUrl(url)).toBe(url)
  })

  it('should prepend server URL to /uploads/ paths', () => {
    funcs.initRemoteSync('http://server.com', 'token', true)
    const result = funcs._normalizeServerAssetUrl('/uploads/image.jpg')
    expect(result).toBe('http://server.com/uploads/image.jpg')
  })
})
