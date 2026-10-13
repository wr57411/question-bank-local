import { describe, it, expect, vi, beforeEach } from 'vitest';

// 覆盖 C3：新建题目时写入的标签关联必须自带完整四字段。
// 缺时间戳的关联会被服务端 normalizeTimestamp 填成「现在」（已实测），从而把服务端存量墓碑复活。
const H = vi.hoisted(() => {
  const stores: Record<string, any> = {};
  function makeStore(name: string) {
    const map = new Map<string, unknown>();
    const store = {
      _name: name,
      _map: map,
      iterate: async (cb: (v: unknown, k: string, n: number) => unknown) => {
        let n = 1;
        for (const [k, v] of map) {
          const r = cb(v, k, n++);
          if (r !== undefined) return r;
        }
        return undefined;
      },
      getItem: async (k: string) => (map.has(k) ? map.get(k) : null),
      setItem: async (k: string, v: unknown) => { map.set(k, v); },
      removeItem: async (k: string) => { map.delete(k); },
      clear: async () => { map.clear(); },
    };
    stores[name] = store;
    return store;
  }
  return {
    stores,
    makeStore,
    generateId: () => 'q-new',
    nowIso: () => '2026-05-05T00:00:00.000Z',
    toMillis: (s: any) => (!s ? 0 : (typeof s === 'number' ? s : (Date.parse(s) || 0))),
  };
});

vi.mock('../src/data/stores', () => ({
  dbQuestions: H.makeStore('dbQuestions'),
  dbTags: H.makeStore('dbTags'),
  dbQuestionTags: H.makeStore('dbQuestionTags'),
  dbPapers: H.makeStore('dbPapers'),
  dbPaperQuestions: H.makeStore('dbPaperQuestions'),
  dbTopics: H.makeStore('dbTopics'),
  dbQuestionNotes: H.makeStore('dbQuestionNotes'),
  dbSimilarQuestionLinks: H.makeStore('dbSimilarQuestionLinks'),
  dbTopicQuestions: H.makeStore('dbTopicQuestions'),
  dbPendingPhotos: H.makeStore('dbPendingPhotos'),
  dbTeachingNodes: H.makeStore('dbTeachingNodes'),
  dbTeachingVersions: H.makeStore('dbTeachingVersions'),
  dbNodeQuestions: H.makeStore('dbNodeQuestions'),
  dbChangelog: H.makeStore('dbChangelog'),
  dbTagCategories: H.makeStore('dbTagCategories'),
  dbAppSettings: H.makeStore('dbAppSettings'),
  dbGroups: H.makeStore('dbGroups'),
  generateId: H.generateId,
  nowIso: H.nowIso,
  toMillis: H.toMillis,
}));

vi.mock('../src/services/image', () => ({ compressImage: async (f: unknown) => f }));

import { dbCreateQuestion, dbAddTagToQuestion } from '../src/data/questions';

const qtStore = () => H.stores.dbQuestionTags as any;

beforeEach(() => {
  for (const s of Object.values(H.stores)) (s as any)._map.clear();
});

describe('C3 新建题目写入的关联带完整四字段', () => {
  it('dbCreateQuestion 写出的关联含 created_at / updated_at / deleted_at', async () => {
    await dbCreateQuestion(null, null, ['t1', 't2'], 0, null, [], null);

    const r1 = await qtStore().getItem('q-new_t1');
    expect(r1).toBeTruthy();
    expect(r1.question_id).toBe('q-new');
    expect(r1.tag_id).toBe('t1');
    expect(r1.created_at).toBe('2026-05-05T00:00:00.000Z');
    expect(r1.updated_at).toBe('2026-05-05T00:00:00.000Z');
    expect(r1.deleted_at).toBeNull();

    const r2 = await qtStore().getItem('q-new_t2');
    expect(r2.created_at).toBe('2026-05-05T00:00:00.000Z');
    expect(r2.deleted_at).toBeNull();
  });

  it('字段形状与 dbAddTagToQuestion 完全一致', async () => {
    await dbAddTagToQuestion('q1', 't1');
    const added = await qtStore().getItem('q1_t1');
    expect(Object.keys(added).sort()).toEqual(['created_at', 'deleted_at', 'question_id', 'tag_id', 'updated_at']);
  });
});
