import { describe, expect, it } from 'vitest';
import { cosineSimilarity, decodeVector, mergeRankings } from '../src/services/semantic';

function f32base64(arr) {
  const bytes = new Uint8Array(Float32Array.from(arr).buffer);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

describe('decodeVector', () => {
  it('base64 → Float32Array 往返一致', () => {
    const v = decodeVector(f32base64([0.5, -1.25, 2]));
    expect(Array.from(v)).toEqual([0.5, -1.25, 2]);
  });
});

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0，零向量保护', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe('mergeRankings', () => {
  it('字面置顶，语义去重后按分数取 top-K', () => {
    const out = mergeRankings(
      ['a', 'b'],
      [{ id: 'b', score: 0.99 }, { id: 'c', score: 0.9 }, { id: 'd', score: 0.8 }, { id: 'e', score: 0.7 }],
      2
    );
    expect(out.literal).toEqual(['a', 'b']);
    expect(out.semantic.map((s) => s.id)).toEqual(['c', 'd']);
  });
  it('语义为空时返回空补充区', () => {
    const out = mergeRankings(['a'], []);
    expect(out.semantic).toEqual([]);
  });
});
