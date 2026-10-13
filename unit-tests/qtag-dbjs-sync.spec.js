import { describe, it, expect, beforeEach } from 'vitest'
import { loadDbFunctions } from './helpers/load-db.js'

// 本用例针对「线上实际生效」的 public/db.js 实现（由 helpers/load-db.js 用 new Function 加载真身）。
// 不能改用 unit-tests/question-tag-sync.spec.ts 那种 import TS 模块的写法：
// TS 侧的 dbApplyRemoteSnapshot / dbBuildSyncPayload 从未挂到 window，运行时根本不生效（影子实现）。
//
// 覆盖的防回归 bug：
//   1) push 不发 question_tags → 服务端只读 question_tags[] → 标签关联 100% 上传失败
//   2) pull 用服务端 tag_ids 做整题替换 → 本地独有的关联被静默抹掉
//   3) 缺时间戳的关联被服务端 normalizeTimestamp 填成「现在」→ 服务端存量墓碑被复活
//   4) _collectQuestionTagIds 不过滤关联墓碑 → 上行带上已取消的关联

const Q_CREATED = '2026-01-01T00:00:00.000Z'
const Q_UPDATED = '2026-01-02T00:00:00.000Z'

let funcs
let stores

const store = (name) => stores.get(name)

function seedQuestion(id, extra = {}) {
  store('questions').set(id, {
    id,
    question_image_url: null,
    answer_image_url: null,
    question_image_blank_url: null,
    layout_type: 0,
    versions: [],
    created_at: Q_CREATED,
    updated_at: Q_UPDATED,
    deleted_at: null,
    purged_at: null,
    user_comment: '',
    semantic_summary: '',
    ai_metadata: {},
    book_name: '',
    page_number: '',
    question_number: '',
    ...extra,
  })
}

beforeEach(() => {
  const loaded = loadDbFunctions()
  funcs = loaded.funcs
  stores = loaded.mockStores
})

describe('push：payload 必须携带 question_tags（活的 db.js 实现）', () => {
  it('含墓碑；且缺时间戳的记录被补成稳定旧值，不是 now', async () => {
    seedQuestion('q1')
    store('tags').set('t1', { id: 't1', name: '标签一', color: '#3B82F6' })
    store('tags').set('t2', { id: 't2', name: '标签二', color: '#3B82F6' })
    store('question_tags').set('q1_t1', { question_id: 'q1', tag_id: 't1' })
    store('question_tags').set('q1_t2', {
      question_id: 'q1',
      tag_id: 't2',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: '2026-03-01T00:00:00.000Z',
    })

    const payload = await funcs.dbBuildSyncPayload()

    expect(Array.isArray(payload.question_tags)).toBe(true)
    expect(payload.question_tags).toHaveLength(2)

    const live = payload.question_tags.find((r) => r.tag_id === 't1')
    expect(live.question_id).toBe('q1')
    expect(live.deleted_at).toBeNull()
    // 回落到题目创建时间；关键是「不是 now」，否则服务端会据此复活自己的存量墓碑
    expect(live.updated_at).toBe(Q_CREATED)
    expect(Date.now() - funcs._toMillis(live.updated_at)).toBeGreaterThan(24 * 3600 * 1000)

    const tomb = payload.question_tags.find((r) => r.tag_id === 't2')
    expect(tomb.deleted_at).toBe('2026-03-01T00:00:00.000Z')
  })

  it('上行 tag_ids 不包含已墓碑化的关联', async () => {
    seedQuestion('q1')
    store('tags').set('t1', { id: 't1', name: '标签一', color: '#3B82F6' })
    store('tags').set('t2', { id: 't2', name: '标签二', color: '#3B82F6' })
    store('question_tags').set('q1_t1', { question_id: 'q1', tag_id: 't1', created_at: Q_CREATED, updated_at: Q_UPDATED, deleted_at: null })
    store('question_tags').set('q1_t2', { question_id: 'q1', tag_id: 't2', created_at: Q_CREATED, updated_at: '2026-03-01T00:00:00.000Z', deleted_at: '2026-03-01T00:00:00.000Z' })

    const payload = await funcs.dbBuildSyncPayload()
    const q1 = payload.questions.find((q) => q.id === 'q1')

    expect(q1.tag_ids).toContain('t1')
    expect(q1.tag_ids).not.toContain('t2')
  })
})

describe('pull：逐条合并，绝不静默删除本地独有的关联', () => {
  it('本地独有的关联在 pull 后仍然存在（本 bug 的直接复现）', async () => {
    seedQuestion('q1')
    seedQuestion('q2')
    store('question_tags').set('q1_t1', {
      question_id: 'q1',
      tag_id: 't1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: null,
    })

    await funcs.dbApplyRemoteSnapshot({
      questions: [{ id: 'q1', created_at: Q_CREATED, updated_at: Q_UPDATED, deleted_at: null, tag_ids: [] }],
      tags: [],
      question_tags: [{ question_id: 'q2', tag_id: 't9', created_at: Q_CREATED, updated_at: Q_UPDATED, deleted_at: null }],
    })

    expect(store('question_tags').get('q1_t1')).toBeTruthy()
    expect(store('question_tags').get('q2_t9')).toBeTruthy()
  })

  it('服务端墓碑（更新）覆盖本地较旧的活记录', async () => {
    store('question_tags').set('q1_t1', {
      question_id: 'q1',
      tag_id: 't1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: null,
    })

    await funcs.dbApplyRemoteSnapshot({
      questions: [],
      tags: [],
      question_tags: [{ question_id: 'q1', tag_id: 't1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z', deleted_at: '2026-04-01T00:00:00.000Z' }],
    })

    expect(store('question_tags').get('q1_t1').deleted_at).toBe('2026-04-01T00:00:00.000Z')
  })

  it('远端墓碑 + 本地活记录但缺时间戳 → 保守保留本地', async () => {
    store('question_tags').set('q1_t1', { question_id: 'q1', tag_id: 't1' })

    await funcs.dbApplyRemoteSnapshot({
      questions: [],
      tags: [],
      question_tags: [{ question_id: 'q1', tag_id: 't1', updated_at: '2026-04-01T00:00:00.000Z', deleted_at: '2026-04-01T00:00:00.000Z' }],
    })

    expect(store('question_tags').get('q1_t1').deleted_at).toBeFalsy()
  })

  it('旧服务端不返回 question_tags → 退化为只增不删', async () => {
    seedQuestion('q1')
    store('question_tags').set('q1_t1', {
      question_id: 'q1',
      tag_id: 't1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: null,
    })

    await funcs.dbApplyRemoteSnapshot({
      questions: [{ id: 'q1', created_at: Q_CREATED, updated_at: Q_UPDATED, deleted_at: null, tag_ids: ['t9'] }],
    })

    expect(store('question_tags').get('q1_t1')).toBeTruthy()
    expect(store('question_tags').get('q1_t9')).toBeTruthy()
  })

  it('purged 题目：仍清理其关联，且不被本轮 question_tags 复活', async () => {
    seedQuestion('q1')
    store('question_tags').set('q1_t1', { question_id: 'q1', tag_id: 't1', created_at: Q_CREATED, updated_at: Q_UPDATED, deleted_at: null })

    await funcs.dbApplyRemoteSnapshot({
      questions: [{ id: 'q1', created_at: Q_CREATED, updated_at: '2026-09-01T00:00:00.000Z', deleted_at: null, purged_at: '2026-09-01T00:00:00.000Z', tag_ids: ['t1'] }],
      tags: [],
      question_tags: [{ question_id: 'q1', tag_id: 't1', created_at: Q_CREATED, updated_at: '2026-09-01T00:00:00.000Z', deleted_at: null }],
    })

    expect(store('question_tags').get('q1_t1')).toBeFalsy()
  })
})
