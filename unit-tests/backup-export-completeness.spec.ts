import { describe, it, expect, vi } from 'vitest';

// FF-1 防回归（2026-09-12）
// localforage 的 iterate 有一个关键语义：**回调一旦返回非 undefined，迭代立即终止**。
// 见 node_modules/localforage/dist/localforage.js 的 iterate 实现：
//     var result = iterator(value, cursor.key, iterationNumber++);
//     if (result !== void 0) { resolve(result); } else { cursor["continue"](); }
// 因此 `(v) => arr.push(v)` 是错的——Array.push 返回新长度 → 每个 store 只会取到第一条记录。
// 后果：备份/导出/百度网盘上传全部残缺且静默无报错（实测：14 个 store 各恰好 1 条）。
//
// 本测试的 mock 必须**复刻**上述提前终止语义，否则这条 bug 会再次逃过测试。

const H = vi.hoisted(() => {
  const mk = (records: Array<[string, unknown]>) => ({
    iterate: async (cb: (v: unknown, k: string, n: number) => unknown) => {
      let n = 1;
      for (const [k, v] of records) {
        const r = cb(v, k, n++);
        if (r !== undefined) return r;
      }
      return undefined;
    },
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    clear: async () => undefined,
  });

  const QUESTIONS: Array<[string, unknown]> = [
    ['q1', { id: 'q1' }],
    ['q2', { id: 'q2' }],
    ['q3', { id: 'q3' }],
  ];
  const TAGS: Array<[string, unknown]> = [
    ['t1', { id: 't1', name: '甲' }],
    ['t2', { id: 't2', name: '乙' }],
  ];
  const QUESTION_TAGS: Array<[string, unknown]> = [
    ['q1_t1', { question_id: 'q1', tag_id: 't1' }],
    ['q2_t1', { question_id: 'q2', tag_id: 't1' }],
    ['q3_t2', { question_id: 'q3', tag_id: 't2' }],
  ];

  return { mk, QUESTIONS, TAGS, QUESTION_TAGS };
});

vi.mock('../src/data/stores', () => ({
  dbQuestions: H.mk(H.QUESTIONS),
  dbTags: H.mk(H.TAGS),
  dbQuestionTags: H.mk(H.QUESTION_TAGS),
  dbPapers: H.mk([]),
  dbPaperQuestions: H.mk([]),
  dbSimilarQuestionLinks: H.mk([]),
  dbTopics: H.mk([]),
  dbTopicQuestions: H.mk([]),
  dbQuestionNotes: H.mk([]),
  dbPendingPhotos: H.mk([]),
  dbTeachingNodes: H.mk([]),
  dbTeachingVersions: H.mk([]),
  dbNodeQuestions: H.mk([]),
  dbChangelog: H.mk([]),
  dbTagCategories: H.mk([]),
  dbAppSettings: H.mk([]),
  dbGroups: H.mk([]),
  generateId: () => 'test-' + Math.random().toString(36).slice(2),
  nowIso: () => new Date().toISOString(),
  toMillis: (s: string) => (s ? Date.parse(s) || 0 : 0),
}));

import { buildBackupData } from '../src/ui/backup';
import { smartBackup } from '../src/data/backup';

describe('备份导出完整性（FF-1 防回归）', () => {
  it('mock 自身必须复刻 localforage 的「提前终止」语义，否则本测试无效', async () => {
    const store = H.mk(H.QUESTIONS);
    const seen: string[] = [];
    const stopped = await store.iterate((v: any) => seen.push(v.id));
    expect(seen.length).toBe(1);
    expect(stopped).toBe(1);
  });

  it('buildBackupData 必须导出每个 store 的全部记录，而不是只有第一条', async () => {
    const data = await buildBackupData();
    expect(data.questions.length).toBe(3);
    expect(data.tags.length).toBe(2);
    expect(data.question_tags.length).toBe(3);
  });

  it('smartBackup 必须返回含数据的全量对象（D8 防回归）', async () => {
    const data = await smartBackup();
    expect(Array.isArray(data.questions)).toBe(true);
    expect(data.questions.length).toBe(3);
    expect(data.tags.length).toBe(2);
    expect(data._meta.is_full).toBe(true);
  });
});
