import type { Engine, StoreManifest } from './types';
import { cosineSimilarity } from './invariants';

export const CONFORMANCE_THRESHOLD = 0.99;

export async function checkSelfConsistency(
  engine: Engine,
  manifest: StoreManifest,
  signal?: AbortSignal,
): Promise<{ ok: boolean; score: number | null; reason?: 'dim-mismatch' | 'drifted' }> {
  const probe = await engine.encode({ kind: 'text', text: manifest.probeText }, signal);
  const anchor = Float32Array.from(manifest.probeVector);
  const score = cosineSimilarity(probe, anchor);
  if (score === null) return { ok: false, score: null, reason: 'dim-mismatch' };
  if (score < CONFORMANCE_THRESHOLD) return { ok: false, score, reason: 'drifted' };
  return { ok: true, score };
}
