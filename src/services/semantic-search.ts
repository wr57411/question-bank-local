import { remoteCall } from '../data/sync';
import { getAllVectors } from '../data/embeddings';
import { cosineSimilarity } from './semantic/invariants';
import type { Hit } from './semantic/types';

export async function encodeQuery(text: string): Promise<Float32Array | null> {
  try {
    const res = (await remoteCall('/api/embed/text', 'POST', { texts: [text] })) as { vectors: number[][] };
    return new Float32Array(res.vectors[0]);
  } catch {
    return null;
  }
}

export async function encodeImage(dataUrl: string): Promise<Float32Array | null> {
  try {
    const res = (await remoteCall('/api/embed/image', 'POST', { image: dataUrl })) as { vectors: number[][] };
    return new Float32Array(res.vectors[0]);
  } catch {
    return null;
  }
}

export async function searchSemantic(queryVec: Float32Array, topK = 10): Promise<Hit[]> {
  const vectors = await getAllVectors();
  const hits: Hit[] = [];
  vectors.forEach((vec, id) => {
    const score = cosineSimilarity(queryVec, vec);
    if (score === null) return;
    hits.push({ id, score, source: '' });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
