import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-8 备份兼容：question_tags 关联升级为带版本实体（created_at/updated_at/deleted_at）后，
// 备份导入链路必须对「旧备份缺字段」宽容、对「新备份带字段」无损保留、软删时间戳不被重置。
//
// 经核实（src/data/backup.ts:171-174）：importStoreRecords 对 question_tags 直接
//   instance.setItem(`${qt.question_id}_${qt.tag_id}`, qt)
// 原样落库，不做字段校验/裁剪；exportFullBackup（iterate 全记录）与分片写读（JSON.stringify/parse）
// 均无损透传。故该需求为「自动满足」——本文件以证据固化行为，不改实现。

const H = vi.hoisted(() => {
  // 内存版 store：用 Map 记录落库键值，setItem 同时写入 Map，便于断言「原样保留」
  const mkStore = (seed: Array<[string, unknown]> = []) => {
    const m = new Map<string, unknown>(seed);
    return {
      _map: m,
      iterate: async (cb: (v: unknown, k: string, n: number) => unknown) => {
        let n = 1;
        for (const [k, v] of m) {
          const r = cb(v, k, n++);
          if (r !== undefined) return r;
        }
        return undefined;
      },
      getItem: vi.fn(async (k: string) => m.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: unknown) => { m.set(k, v); }),
      removeItem: vi.fn(async (k: string) => { m.delete(k); }),
      clear: vi.fn(async () => { m.clear(); }),
    };
  };
  return { mkStore };
});

vi.mock('../src/data/stores', () => {
  const other = () => H.mkStore();
  return {
    dbQuestions: other(),
    dbTags: other(),
    dbQuestionTags: H.mkStore(),
    dbPapers: other(),
    dbPaperQuestions: other(),
    dbSimilarQuestionLinks: other(),
    dbTopics: other(),
    dbTopicQuestions: other(),
    dbQuestionNotes: other(),
    dbPendingPhotos: other(),
    dbTeachingNodes: other(),
    dbTeachingVersions: other(),
    dbNodeQuestions: other(),
    dbChangelog: other(),
    generateId: () => 'test-' + Math.random().toString(36).slice(2),
    nowIso: () => new Date('2026-01-01T00:00:00.000Z').toISOString(),
    toMillis: (s: string) => (s ? Date.parse(s) || 0 : 0),
  };
});

import { importStoreRecords, importBackupData, exportFullBackup } from '../src/data/backup';

describe('P0-8 备份兼容：question_tags 关联导入（旧缺字段 / 新带字段 / 往返）', () => {
  let dbQuestionTags: any;
  beforeEach(async () => {
    const stores = await import('../src/data/stores');
    dbQuestionTags = (stores as any).dbQuestionTags;
    dbQuestionTags._map.clear();
    dbQuestionTags.setItem.mockClear();
  });

  it('旧备份（关联记录无 updated_at/deleted_at）导入 → 不抛错，记录进入 dbQuestionTags', async () => {
    const legacyRecord = { question_id: 'q1', tag_id: 't1' };
    await expect(importStoreRecords('question_tags', [legacyRecord])).resolves.not.toThrow();
    expect(dbQuestionTags.setItem).toHaveBeenCalledTimes(1);
    expect(dbQuestionTags.setItem.mock.calls[0][0]).toBe('q1_t1');
    // 写入值原样（不补默认时间戳、不裁剪字段）
    expect(dbQuestionTags.setItem.mock.calls[0][1]).toEqual(legacyRecord);
    expect(await dbQuestionTags.getItem('q1_t1')).toEqual(legacyRecord);
  });

  it('新备份（关联记录带 created_at/updated_at/deleted_at）导入 → 两字段被保留', async () => {
    const record = {
      question_id: 'q2', tag_id: 't2',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: null,
    };
    await expect(importStoreRecords('question_tags', [record])).resolves.not.toThrow();
    const stored = await dbQuestionTags.getItem('q2_t2');
    expect(stored).toEqual(record);
    expect(stored.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(stored.updated_at).toBe('2026-03-01T00:00:00.000Z');
    expect(stored.deleted_at).toBeNull();
  });

  it('带软删（deleted_at 非 null）的关联记录导入 → 时间戳不被重置', async () => {
    const tombstone = {
      question_id: 'q3', tag_id: 't3',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      deleted_at: '2026-05-01T00:00:00.000Z',
    };
    await importStoreRecords('question_tags', [tombstone]);
    const stored = await dbQuestionTags.getItem('q3_t3');
    expect(stored.deleted_at).toBe('2026-05-01T00:00:00.000Z');
    expect(stored.updated_at).toBe('2026-05-01T00:00:00.000Z');
  });

  it('往返一致：exportFullBackup 导出 → importStoreRecords 导入后，时间戳与导出前相同', async () => {
    const before = [
      { question_id: 'rq1', tag_id: 'rt1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z', deleted_at: null },
      { question_id: 'rq2', tag_id: 'rt2', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z', deleted_at: '2026-06-01T00:00:00.000Z' },
    ];
    await importStoreRecords('question_tags', before);
    dbQuestionTags.setItem.mockClear();

    const exported = (await exportFullBackup()) as any;
    const qtExported = exported.question_tags as any[];
    expect(qtExported).toHaveLength(2);
    // 导出即包含完整时间戳
    for (const rec of before) {
      const e = qtExported.find((x: any) => x.question_id === rec.question_id && x.tag_id === rec.tag_id);
      expect(e).toEqual(rec);
    }

    // 清空后重新导入（模拟「导出→导入」恢复）
    dbQuestionTags._map.clear();
    await importStoreRecords('question_tags', qtExported);

    for (const rec of before) {
      const back = await dbQuestionTags.getItem(`${rec.question_id}_${rec.tag_id}`);
      expect(back).toEqual(rec);
    }
  });

  it('importBackupData 全量导入：question_tags 缺字段不报错、带字段保留', async () => {
    const data = {
      questions: [{ id: 'qX' }],
      tags: [{ id: 'tX', name: '物理' }],
      question_tags: [
        { question_id: 'qX', tag_id: 'tX' },
        { question_id: 'qX', tag_id: 'tY', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null },
      ],
    };
    await expect(importBackupData(data)).resolves.toMatchObject({ questions: 1, tags: 1 });
    expect(await dbQuestionTags.getItem('qX_tX')).toEqual({ question_id: 'qX', tag_id: 'tX' });
    expect((await dbQuestionTags.getItem('qX_tY')).updated_at).toBe('2026-01-01T00:00:00.000Z');
  });
});
