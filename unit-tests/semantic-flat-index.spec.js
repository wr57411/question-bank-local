import { describe, it, expect } from 'vitest';
import { FlatVectorIndex, FLAT_INDEX_MAX_BYTES } from '../src/services/semantic/flat-index.ts';
import { cosineSimilarity } from '../src/services/semantic/invariants.ts';

const DIM = 8;
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };

function fakeStore(rows) {
  return {
    engineId: 'mac',
    async iterate(cb) { for (const [id, v] of rows) cb(id, v); },
    async count() { return rows.length; },
  };
}

const rows = [
  ['q-1', norm([1, 0, 0, 0, 0, 0, 0, 0])],
  ['q-2', norm([0, 1, 0, 0, 0, 0, 0, 0])],
  ['q-3', norm([1, 1, 0, 0, 0, 0, 0, 0])],
];

describe('FlatVectorIndex', () => {
  it('build 后 size 与 bytes 正确，且内存是一块连续数组', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.size).toBe(3);
    expect(idx.bytes).toBe(3 * DIM * 4);
  });

  it('get 按 id 取回向量', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const v = idx.get('q-1');
    expect(v).not.toBeNull();
    expect(v[0]).toBeCloseTo(1, 6);
  });

  it('get 不存在的 id 返回 null', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.get('nope')).toBeNull();
  });

  it('rank 按余弦降序', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 1, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits.map((h) => h.id)).toEqual(['q-3', 'q-1', 'q-2']);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it('与 invariants.cosineSimilarity 结果一致（防止两处实现漂移）', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 2, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits).toHaveLength(3);
    for (const h of hits) {
      const v = idx.get(h.id);
      expect(h.score).toBeCloseTo(cosineSimilarity(q, v), 6);
    }
  });

  it('未归一化向量必须按余弦而非点乘排序（norms/qn 除法必须生效）', async () => {
    const big = new Float32Array(DIM); big[0] = 10;
    const small = new Float32Array(DIM); small[0] = 1; small[1] = 1;
    const idx = await FlatVectorIndex.build(fakeStore([['big', big], ['small', small]]), DIM);
    const q = norm([1, 1, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 2, 0);
    expect(hits.map((h) => h.id)).toEqual(['small', 'big']);
    expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('零向量上两处实现仍一致（norms 的 `|| 1` 是唯一对齐点）', async () => {
    const idx = await FlatVectorIndex.build(fakeStore([['z-1', new Float32Array(DIM)]]), DIM);
    const q = norm([1, 0, 0, 0, 0, 0, 0, 0]);
    const hits = idx.rank(q, 3, 0);
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeCloseTo(cosineSimilarity(q, new Float32Array(DIM)), 6);
  });

  it('get 返回拷贝：改它不污染内部索引', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const v = idx.get('q-1');
    v[0] = 999;
    expect(idx.get('q-1')[0]).toBeCloseTo(1, 6);
  });

  it('rank 只读内存：构建后不再触碰 store', async () => {
    let reads = 0;
    const store = fakeStore(rows);
    const origIterate = store.iterate;
    store.iterate = async (cb) => { reads++; return origIterate(cb); };
    const idx = await FlatVectorIndex.build(store, DIM);
    expect(reads).toBe(1);
    idx.rank(norm([1, 0, 0, 0, 0, 0, 0, 0]), 3, 0);
    idx.rank(norm([0, 1, 0, 0, 0, 0, 0, 0]), 3, 0);
    expect(reads).toBe(1);
  });

  it('minScore 过滤生效', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    const q = norm([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(idx.rank(q, 10, 0.5).map((h) => h.id)).toEqual(['q-1', 'q-3']);
  });

  it('维度不符的库拒绝构建', async () => {
    await expect(FlatVectorIndex.build(fakeStore([['q-1', new Float32Array(4)]]), DIM)).rejects.toThrow(/dim/);
  });

  it('dim 不符时 build 必须 reject，而不是在异步迭代下挂起', async () => {
    const asyncStore = {
      engineId: 'mac',
      async count() { return 1; },
      async iterate(cb) {
        return new Promise((resolve) => {
          setTimeout(() => {
            cb('bad', new Float32Array(DIM + 1));
            resolve();
          }, 0);
        });
      },
    };
    await expect(FlatVectorIndex.build(asyncStore, DIM)).rejects.toThrow(/dim/);
  });

  it('query 维度不符返回空结果，不静默截断', async () => {
    const idx = await FlatVectorIndex.build(fakeStore(rows), DIM);
    expect(idx.rank(new Float32Array(4), 3, 0)).toEqual([]);
  });

  it('内存预算常量为 256MB', () => {
    expect(FLAT_INDEX_MAX_BYTES).toBe(268435456);
  });

  it('非归一化 query 必须按余弦计算（qn 除法必须生效）', async () => {
    const idx = await FlatVectorIndex.build(fakeStore([['a', norm([1, 0, 0, 0, 0, 0, 0, 0])]]), DIM);
    const q = new Float32Array(DIM);
    q[0] = 5;
    const hits = idx.rank(q, 1, 0);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });
});
