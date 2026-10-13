declare const localforage: typeof import('localforage');

import { decodeVector } from '../services/semantic/invariants';
import {
  EngineUnreachableError,
  activateEngine,
  buildEngineStore,
  resolveEngine,
} from '../services/semantic/runtime';

let _dbEmbeddings: ReturnType<typeof localforage.createInstance> | null = null;

function dbEmbeddings(): ReturnType<typeof localforage.createInstance> {
  if (!_dbEmbeddings) {
    _dbEmbeddings = localforage.createInstance({ name: 'questionBank', storeName: 'embeddings' });
  }
  return _dbEmbeddings;
}

export async function refreshEmbeddings(): Promise<number> {
  let resolved;
  try {
    resolved = await resolveEngine();
  } catch {
    return 0;
  }
  if (!resolved) return 0;
  try {
    const built = await buildEngineStore(resolved.engineId, resolved.engine);
    await activateEngine(resolved.engineId, resolved.engine);
    return built.count;
  } catch (err) {
    if (err instanceof EngineUnreachableError) return 0;
    console.error('[embeddings] 建库写入失败', err);
    return 0;
  }
}

export async function getAllVectors(): Promise<Map<string, Float32Array>> {
  const map = new Map<string, Float32Array>();
  await dbEmbeddings().iterate((v: unknown) => {
    const item = v as { question_id: string; vector: string } | null;
    if (item?.vector) map.set(item.question_id, decodeVector(item.vector));
  });
  return map;
}
