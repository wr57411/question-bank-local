import { describe, it, expect, beforeEach } from 'vitest'
import { loadDbFunctions } from './helpers/load-db.js'

const NOTE_STORE = 'question_notes'

describe('题目笔记墓碑 (public/db.js 活数据层)', () => {
  let funcs
  let mockStores

  beforeEach(() => {
    const loaded = loadDbFunctions({ dbPath: 'public/db.js' })
    funcs = loaded.funcs
    mockStores = loaded.mockStores
  })

  const getRawNote = (id) => mockStores.get(NOTE_STORE).get(id)

  it('dbDeleteQuestionNote 写墓碑而非硬删：deleted_at 非空、图片清空、updated_at 推进', async () => {
    const note = await funcs.dbAddQuestionNote('q1', 'http://img/1.jpg', '封面', 'note text')
    await funcs.dbDeleteQuestionNote(note.id)
    const raw = getRawNote(note.id)
    expect(raw).toBeTruthy()
    expect(raw.deleted_at).toBeTruthy()
    expect(raw.note_image_url).toBeNull()
    expect(new Date(raw.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(raw.created_at).getTime())
  })

  it('dbGetQuestionNotes 过滤墓碑：删除后查询不到该条', async () => {
    const note = await funcs.dbAddQuestionNote('q1', 'http://img/1.jpg', '封面', 'note text')
    await funcs.dbDeleteQuestionNote(note.id)
    const notes = await funcs.dbGetQuestionNotes('q1')
    expect(notes.find((n) => n.id === note.id)).toBeUndefined()
    expect(notes).toHaveLength(0)
  })

  it('墓碑行在存储里仍存在（不是 removeItem）——其它设备才能通过 pull 感知', async () => {
    const note = await funcs.dbAddQuestionNote('q1', 'http://img/1.jpg', '封面', 'note text')
    await funcs.dbDeleteQuestionNote(note.id)
    const raw = getRawNote(note.id)
    expect(raw).toBeTruthy()
    expect(raw.id).toBe(note.id)
    expect(raw.deleted_at).toBeTruthy()
  })

  it('applyRemoteSnapshot 透传 deleted_at：其它设备的墓碑拉回来后本机也过滤掉', async () => {
    const live = await funcs.dbAddQuestionNote('q2', 'http://img/live.jpg', '活', 'text')
    const tombstoneTs = new Date(Date.now() + 100000).toISOString()
    const snapshot = {
      question_notes: [
        {
          id: live.id,
          question_id: 'q2',
          note_image_url: null,
          label: '活',
          text_note: 'text',
          created_at: live.created_at,
          updated_at: tombstoneTs,
          deleted_at: tombstoneTs
        }
      ]
    }
    await funcs.dbApplyRemoteSnapshot(snapshot)
    const notes = await funcs.dbGetQuestionNotes('q2')
    expect(notes).toHaveLength(0)
    const raw = getRawNote(live.id)
    expect(raw).toBeTruthy()
    expect(raw.deleted_at).toBeTruthy()
  })

  it('活笔记不受影响：带图的活行 push 后查询正常、图片原样', async () => {
    const note = await funcs.dbAddQuestionNote('q3', 'http://img/keep.jpg', '活', 'text')
    const notes = await funcs.dbGetQuestionNotes('q3')
    expect(notes).toHaveLength(1)
    expect(notes[0].id).toBe(note.id)
    expect(notes[0].note_image_url).toBe('http://img/keep.jpg')
    expect(notes[0].deleted_at).toBeFalsy()
    const raw = getRawNote(note.id)
    expect(raw.note_image_url).toBe('http://img/keep.jpg')
    expect(raw.deleted_at).toBeFalsy()
  })
})
