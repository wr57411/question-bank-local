import { describe, it, expect } from 'vitest';
import {
  SHARD_MAX_BYTES,
  splitRecordsIntoShards,
  planShards,
  shardFileName,
  buildShardManifest,
  verifyShardManifest,
  reassemblePayload,
  type ShardManifest,
} from '../src/services/backup-shards';

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// 造一条体积可控的记录：data 字段用 ASCII 填充（1 字符 = 1 字节）
function makeRecord(id: string, bytes: number): { id: string; data: string } {
  const base = JSON.stringify({ id, data: '' }).length;
  const fill = Math.max(0, bytes - base);
  return { id, data: 'A'.repeat(fill) };
}

describe('splitRecordsIntoShards', () => {
  it('空数组返回空分片列表', () => {
    expect(splitRecordsIntoShards([])).toEqual([]);
  });

  it('单条记录超过 maxBytes 时单独成片，不被切分', () => {
    const big = makeRecord('big', 5000);
    const shards = splitRecordsIntoShards([big], 4096);
    expect(shards.length).toBe(1);
    expect(shards[0]).toEqual([big]);
  });

  it('累计字节数恰好到达上限的边界行为：不超额落片', () => {
    const maxBytes = 4096;
    const recs = [makeRecord('a', 1000), makeRecord('b', 1000), makeRecord('c', 1000)];
    const shards = splitRecordsIntoShards(recs, maxBytes);
    let total = 0;
    for (const sh of shards) {
      const bytes = jsonBytes(sh);
      if (sh.length > 1) expect(bytes).toBeLessThanOrEqual(maxBytes);
      total += sh.length;
    }
    expect(total).toBe(3);
  });

  it('多片场景下每片（>1 条）序列化后字节数不超过上限', () => {
    const maxBytes = 4096;
    const recs = Array.from({ length: 50 }, (_, i) => makeRecord(`r${i}`, 500));
    const shards = splitRecordsIntoShards(recs, maxBytes);
    expect(shards.length).toBeGreaterThan(1);
    let total = 0;
    for (const sh of shards) {
      if (sh.length > 1) expect(jsonBytes(sh)).toBeLessThanOrEqual(maxBytes);
      total += sh.length;
    }
    expect(total).toBe(50);
  });

  it('顺序保持：序号序列与原始一致', () => {
    const recs = Array.from({ length: 100 }, (_, i) => ({ n: i }));
    const shards = splitRecordsIntoShards(recs, 4096);
    const flat = shards.flat();
    expect(flat.map((r) => (r as { n: number }).n)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

describe('planShards / buildShardManifest / reassemblePayload', () => {
  it('等价性：多 store + 大记录跨多片，重组结果与原 payload 深度相等', () => {
    const maxBytes = 4096;
    const payload: Record<string, unknown> = {
      questions: Array.from({ length: 20 }, (_, i) => makeRecord(`q${i}`, 1200)),
      question_notes: Array.from({ length: 10 }, (_, i) => makeRecord(`n${i}`, 800)),
      tags: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, name: `标签${i}` })),
      _meta: { format: 'incremental_v1', timestamp: '2026-09-14T00:00:00.000Z', is_full: true },
    };

    const { arrays, others } = planShards(payload, maxBytes);
    expect(arrays.map((a) => a.store)).toEqual(['questions', 'question_notes', 'tags']);
    expect(others.map((o) => o.key)).toEqual(['_meta']);

    const manifest = buildShardManifest(arrays, others);

    const shardMap = new Map<string, string>();
    for (const { store, shards } of arrays) {
      shards.forEach((sh, i) => shardMap.set(shardFileName(store, i), JSON.stringify(sh)));
    }
    const othersRecord: Record<string, unknown> = {};
    for (const o of others) othersRecord[o.key] = o.value;

    const readShard = (fileName: string): unknown[] => JSON.parse(shardMap.get(fileName) as string);
    const restored = reassemblePayload(manifest, readShard, othersRecord);

    expect(restored).toEqual(payload);
  });

  it('数组型 store 顺序在 plan 中保持', () => {
    const payload = { a: [1], z: [2], m: [3] };
    const { arrays } = planShards(payload);
    expect(arrays.map((a) => a.store)).toEqual(['a', 'z', 'm']);
  });

  it('空数组 store：片数为 0，重组后为空数组', () => {
    const payload = { questions: [], tags: [{ id: 't1' }] };
    const { arrays, others } = planShards(payload);
    const manifest = buildShardManifest(arrays, others);
    const emptyStore = manifest.stores.find((s) => s.name === 'questions');
    expect(emptyStore?.shards).toBe(0);
    expect(emptyStore?.count).toBe(0);

    const shardMap = new Map<string, string>();
    for (const { store, shards } of arrays) {
      shards.forEach((sh, i) => shardMap.set(shardFileName(store, i), JSON.stringify(sh)));
    }
    const othersRecord: Record<string, unknown> = {};
    for (const o of others) othersRecord[o.key] = o.value;
    const restored = reassemblePayload(manifest, (fn) => JSON.parse(shardMap.get(fn) as string), othersRecord);
    expect(restored.questions).toEqual([]);
    expect(restored.tags).toEqual([{ id: 't1' }]);
  });

  it('非数组项（如 _meta 对象）不进入分片，且能通过 others 还原', () => {
    const payload = { questions: [makeRecord('q1', 100)], _meta: { a: 1, b: [2, 3] }, config: { x: true } };
    const { arrays, others } = planShards(payload);
    const arrayStores = arrays.map((a) => a.store);
    expect(arrayStores).toEqual(['questions']);
    expect(others.map((o) => o.key).sort()).toEqual(['_meta', 'config']);

    const manifest = buildShardManifest(arrays, others);
    expect(manifest.others.sort()).toEqual(['_meta', 'config']);

    const shardMap = new Map<string, string>();
    for (const { store, shards } of arrays) {
      shards.forEach((sh, i) => shardMap.set(shardFileName(store, i), JSON.stringify(sh)));
    }
    const othersRecord: Record<string, unknown> = {};
    for (const o of others) othersRecord[o.key] = o.value;
    const restored = reassemblePayload(manifest, (fn) => JSON.parse(shardMap.get(fn) as string), othersRecord);
    expect(restored._meta).toEqual({ a: 1, b: [2, 3] });
    expect(restored.config).toEqual({ x: true });
    expect(restored.questions).toEqual([makeRecord('q1', 100)]);
  });
});

describe('shardFileName', () => {
  it('生成稳定可排序的文件名', () => {
    expect(shardFileName('questions', 0)).toBe('questions-000.json');
    expect(shardFileName('question_notes', 12)).toBe('question_notes-012.json');
  });
});

describe('verifyShardManifest', () => {
  const manifest: ShardManifest = {
    format: 'sharded_v1',
    created_at: '2026-09-14T00:00:00.000Z',
    stores: [
      { name: 'questions', shards: 3, count: 100 },
      { name: 'tags', shards: 1, count: 5 },
    ],
    others: ['_meta'],
  };

  it('正常情况返回空数组', () => {
    const errors = verifyShardManifest(manifest, [
      { store: 'questions', shardCount: 3, recordCount: 100 },
      { store: 'tags', shardCount: 1, recordCount: 5 },
    ]);
    expect(errors).toEqual([]);
  });

  it('少一片（shardCount 不符）返回非空错误', () => {
    const errors = verifyShardManifest(manifest, [
      { store: 'questions', shardCount: 2, recordCount: 100 },
      { store: 'tags', shardCount: 1, recordCount: 5 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('questions');
  });

  it('记录数不符返回非空错误', () => {
    const errors = verifyShardManifest(manifest, [
      { store: 'questions', shardCount: 3, recordCount: 99 },
      { store: 'tags', shardCount: 1, recordCount: 5 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('记录数不符');
  });

  it('缺失 store 返回非空错误', () => {
    const errors = verifyShardManifest(manifest, [
      { store: 'questions', shardCount: 3, recordCount: 100 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('tags');
  });
});

describe('常量', () => {
  it('SHARD_MAX_BYTES 为 2MB', () => {
    expect(SHARD_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
