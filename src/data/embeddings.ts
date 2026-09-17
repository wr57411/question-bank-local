declare const localforage: typeof import('localforage');

import { remoteCall } from './sync';
import { decodeVector } from '../services/semantic';

let _dbEmbeddings: ReturnType<typeof localforage.createInstance> | null = null;

function dbEmbeddings(): ReturnType<typeof localforage.createInstance> {
  if (!_dbEmbeddings) {
    _dbEmbeddings = localforage.createInstance({ name: 'questionBank', storeName: 'embeddings' });
  }
  return _dbEmbeddings;
}

export async function refreshEmbeddings(): Promise<number> {
  const res = (await remoteCall('/api/embed/vectors')) as { embeddings?: { question_id: string; dim: number; vector: string }[] };
  const items = res?.embeddings || [];
  await dbEmbeddings().clear();
  for (const it of items) {
    await dbEmbeddings().setItem(it.question_id, { question_id: it.question_id, dim: it.dim, vector: it.vector });
  }
  return items.length;
}

export async function getAllVectors(): Promise<Map<string, Float32Array>> {
  const map = new Map<string, Float32Array>();
  await dbEmbeddings().iterate((v: unknown) => {
    const item = v as { question_id: string; vector: string } | null;
    if (item?.vector) map.set(item.question_id, decodeVector(item.vector));
  });
  return map;
}
