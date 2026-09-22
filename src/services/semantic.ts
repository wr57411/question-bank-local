export function decodeVector(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SemanticHit { id: string; score: number }

export function mergeRankings(literalIds: string[], semanticScores: SemanticHit[], semanticTopK = 10): { literal: string[]; semantic: SemanticHit[] } {
  const literalSet = new Set(literalIds);
  const semantic = semanticScores
    .filter((s) => !literalSet.has(s.id))
    .sort((x, y) => y.score - x.score)
    .slice(0, semanticTopK);
  return { literal: literalIds, semantic };
}
