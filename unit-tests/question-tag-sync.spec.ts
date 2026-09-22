import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 0（D6）关联逐条合并 + 标签双向合并 的客户端回归测试。
// 用内存 Map 模拟 localforage 各 store（复刻 localforage「回调返回非 undefined 即终止」语义），
// 断言 dbApplyRemoteSnapshot / dbAddTagToQuestion / dbRemoveTagFromQuestion / importStoreRecords / dbClearAllData
// 对 question_tags 的处理符合「带版本实体 + 逐条时间戳合并 + 软删传播」。
//
// 覆盖的防回归 bug：
//   1) 标签下行 insert-only（D1）：已存在标签的改名/改色/删除不下行
//   2) 关联取消不增量传播（D6）：取消标签被另一端陈旧全量 push 复活
//   3) dbRemoveTagFromQuestion 物理删除 → 取消关联无法传播
//   4) 无 updated_at 的存量记录合并抛错 / 无法合并（P0-7）
//   5) 旧备份关联记录缺两字段导入报错（P0-8）
//   6) dbClearAllData 漏清 question_tags（D7）

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
    generateId: () => 'id-' + Math.random().toString(36).slice(2),
    nowIso: () => new Date().toISOString(),
    toMillis: (s: string | number | undefined | null) => (!s ? 0 : (typeof s === 'number' ? s : (Date.parse(s) || 0))),
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
  generateId: H.generateId,
  nowIso: H.nowIso,
  toMillis: H.toMillis,
}));

import { dbApplyRemoteSnapshot, dbClearAllData } from '../src/data/sync';
import { dbAddTagToQuestion, dbRemoveTagFromQuestion } from '../src/data/questions';
import { buildTagIndex } from '../src/data/tags';
import { importStoreRecords } from '../src/data/backup';

const qtStore = () => H.stores.dbQuestionTags as any;
const tagStore = () => H.stores.dbTags as any;

beforeEach(() => {
  for (const s of Object.values(H.stores)) (s as any)._map.clear();
});

describe('P0-1 标签下行双向合并', () => {
  it('本地有旧、远端有更新 → 取新（修复 D1 insert-only）', async () => {
    await tagStore().setItem('t1', { id: 't1', name: '旧名', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await dbApplyRemoteSnapshot({ tags: [{ id: 't1', name: '新名', updated_at: '2026-06-01T00:00:00.000Z', deleted_at: null }] });
    const t = await tagStore().getItem('t1');
    expect(t.name).toBe('新名');
  });

  it('远端软删（更新） → 本地也标删', async () => {
    await tagStore().setItem('t1', { id: 't1', name: '新名', updated_at: '2026-06-01T00:00:00.000Z', deleted_at: null });
    await dbApplyRemoteSnapshot({ tags: [{ id: 't1', name: '新名', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: '2026-07-01T00:00:00.000Z' }] });
    const t = await tagStore().getItem('t1');
    expect(t.deleted_at).toBeTruthy();
  });
});

describe('P0-4 关联逐条合并', () => {
  it('两侧不同时间戳 → 取新者；一侧软删更新且另一侧较旧 → 删除生效且不被复活', async () => {
    await qtStore().setItem('q1_t1', { question_id: 'q1', tag_id: 't1', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await dbApplyRemoteSnapshot({ question_tags: [{ question_id: 'q1', tag_id: 't1', updated_at: '2026-03-01T00:00:00.000Z', deleted_at: null }] });
    const r = await qtStore().getItem('q1_t1');
    expect(r.updated_at).toBe('2026-03-01T00:00:00.000Z');

    // 软删（更晚）覆盖较旧的 live → 删除生效
    await dbApplyRemoteSnapshot({ question_tags: [{ question_id: 'q1', tag_id: 't1', updated_at: '2026-05-01T00:00:00.000Z', deleted_at: '2026-05-01T00:00:00.000Z' }] });
    const d = await qtStore().getItem('q1_t1');
    expect(d.deleted_at).toBeTruthy();

    // 再推一个较旧的 live → 不应复活（修复 D6 取消关联被陈旧 push 复活）
    await dbApplyRemoteSnapshot({ question_tags: [{ question_id: 'q1', tag_id: 't1', created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z', deleted_at: null }] });
    const after = await qtStore().getItem('q1_t1');
    expect(after.deleted_at).toBeTruthy();
  });
});

describe('P0-5 软删传播', () => {
  it('dbRemoveTagFromQuestion 后关联仍在 store 但带 deleted_at（非物理删除）', async () => {
    await dbAddTagToQuestion('q1', 't1');
    let r = await qtStore().getItem('q1_t1');
    expect(r).toBeTruthy();
    expect(r.deleted_at).toBeFalsy();

    await dbRemoveTagFromQuestion('q1', 't1');
    r = await qtStore().getItem('q1_t1');
    expect(r).toBeTruthy();
    expect(r.deleted_at).toBeTruthy();
  });
});

describe('P0-7 时间戳兜底', () => {
  it('无 updated_at 的存量记录可参与合并、不抛错', async () => {
    await qtStore().setItem('q1_t1', { question_id: 'q1', tag_id: 't1' });
    await dbApplyRemoteSnapshot({ question_tags: [{ question_id: 'q1', tag_id: 't1', updated_at: '2026-06-01T00:00:00.000Z', deleted_at: null }] });
    const r = await qtStore().getItem('q1_t1');
    expect(r.updated_at).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('P0-8 旧备份兼容', () => {
  it('导入不含 updated_at/deleted_at 的旧关联不报错', async () => {
    await expect(importStoreRecords('question_tags', [{ question_id: 'q1', tag_id: 't1' }])).resolves.toBe(1);
    const r = await qtStore().getItem('q1_t1');
    expect(r).toEqual({ question_id: 'q1', tag_id: 't1' });
  });
});

describe('P0-10 dbClearAllData 清 question_tags', () => {
  it('清空后 question_tags 为空（修复 D7 孤儿关联）', async () => {
    await qtStore().setItem('q1_t1', { question_id: 'q1', tag_id: 't1' });
    await dbClearAllData();
    expect(await qtStore().getItem('q1_t1')).toBeNull();
  });
});

describe('buildTagIndex 跳过软删关联', () => {
  it('软删后的关联不再计入题目标签索引', async () => {
    await tagStore().setItem('t1', { id: 't1', name: '物理', deleted_at: null });
    await dbAddTagToQuestion('q1', 't1');
    let idx = await buildTagIndex();
    expect(idx.get('q1')?.map((x) => x.id)).toContain('t1');

    await dbRemoveTagFromQuestion('q1', 't1');
    idx = await buildTagIndex();
    expect(idx.get('q1')?.map((x) => x.id) ?? []).not.toContain('t1');
  });
});
