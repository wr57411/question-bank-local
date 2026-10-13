import type { VectorStore } from './types';

export const FLAT_INDEX_MAX_BYTES = 256 * 1024 * 1024;

export class FlatVectorIndex {
  private constructor(
    private data: Float32Array,
    private norms: Float32Array,
    private ids: string[],
    private idToRow: Map<string, number>,
    private dim: number,
  ) {}

  static async build(store: VectorStore, dim: number): Promise<FlatVectorIndex> {
    const count = await store.count();
    const bytes = count * dim * 4;
    if (bytes > FLAT_INDEX_MAX_BYTES) {
      throw new Error(`向量库超出内存预算：${bytes} > ${FLAT_INDEX_MAX_BYTES}`);
    }
    const data = new Float32Array(count * dim);
    const norms = new Float32Array(count);
    const ids: string[] = [];
    const idToRow = new Map<string, number>();
    let r = 0;
    let dimError: string | null = null;
    await store.iterate((id, v) => {
      if (dimError) return;
      if (v.length !== dim) {
        dimError = `dim 不符：${id} 为 ${v.length}，期望 ${dim}`;
        return;
      }
      const off = r * dim;
      data.set(v, off);
      let s = 0;
      for (let i = 0; i < dim; i++) s += v[i] * v[i];
      norms[r] = Math.sqrt(s) || 1;
      ids.push(id);
      idToRow.set(id, r);
      r++;
    });
    if (dimError) throw new Error(dimError);
    return new FlatVectorIndex(data, norms, ids, idToRow, dim);
  }

  get size(): number { return this.ids.length; }
  get bytes(): number { return this.data.byteLength; }

  get(id: string): Float32Array | null {
    const r = this.idToRow.get(id);
    if (r === undefined) return null;
    return this.data.slice(r * this.dim, (r + 1) * this.dim);
  }

  rank(q: Float32Array, topK: number, minScore: number): { id: string; score: number }[] {
    const { data, norms, ids, dim } = this;
    const n = ids.length;
    if (q.length !== dim) return [];
    let qn = 0;
    for (let i = 0; i < dim; i++) qn += q[i] * q[i];
    qn = Math.sqrt(qn) || 1;
    const scores = new Float32Array(n);
    for (let r = 0; r < n; r++) {
      const off = r * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += q[i] * data[off + i];
      scores[r] = dot / (qn * norms[r]);
    }
    const order: number[] = [];
    for (let r = 0; r < n; r++) if (scores[r] >= minScore) order.push(r);
    order.sort((a, b) => scores[b] - scores[a]);
    return order.slice(0, topK).map((r) => ({ id: ids[r], score: scores[r] }));
  }
}
