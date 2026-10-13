import { describe, it, expect } from 'vitest';
import { cosineSimilarity, decodeVector, makeSpaceKey } from '../src/services/semantic/invariants.ts';

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
  it('同维向量返回余弦', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('维度不等返回 null，而不是静默截断', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeNull();
  });

  it('零向量返回 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('makeSpaceKey', () => {
  it('同配置两次构造结果相同', () => {
    const p = { model: 'wemm-embedding-2b', precision: 'bf16', dim: 2048, normalize: 'l2', modalities: ['text', 'image'] };
    expect(makeSpaceKey(p)).toBe(makeSpaceKey(p));
  });

  it('模态顺序不影响结果', () => {
    const base = { model: 'm', precision: 'bf16', dim: 2048, normalize: 'l2' };
    expect(makeSpaceKey({ ...base, modalities: ['text', 'image'] }))
      .toBe(makeSpaceKey({ ...base, modalities: ['image', 'text'] }));
  });

  it('维度不同则键不同', () => {
    const base = { model: 'm', precision: 'bf16', normalize: 'l2', modalities: ['text'] };
    expect(makeSpaceKey({ ...base, dim: 2048 })).not.toBe(makeSpaceKey({ ...base, dim: 256 }));
  });
});
