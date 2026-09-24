import type { SpaceKey } from './types';

export function decodeVector(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number | null {
  if (a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function makeSpaceKey(p: {
  model: string;
  precision: string;
  dim: number;
  normalize: 'l2' | 'none';
  modalities: string[];
}): SpaceKey {
  return `${p.model}:${p.precision}:${p.dim}:${p.normalize}:${[...p.modalities].sort().join('+')}`;
}
