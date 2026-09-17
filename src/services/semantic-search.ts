import { remoteCall } from '../data/sync';
import { getAllVectors } from '../data/embeddings';
import { cosineSimilarity, SemanticHit } from './semantic';

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

export async function searchSemantic(queryVec: Float32Array, topK = 10): Promise<SemanticHit[]> {
  const vectors = await getAllVectors();
  const hits: SemanticHit[] = [];
  vectors.forEach((vec, id) => hits.push({ id, score: cosineSimilarity(queryVec, vec) }));
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
