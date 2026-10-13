import type { EngineId, VectorStore } from './types';
import { LocalVectorStore } from './vector-store';

export class VectorStoreRegistry {
  private stores = new Map<EngineId, VectorStore>();

  get(engineId: EngineId): VectorStore {
    let s = this.stores.get(engineId);
    if (!s) { s = new LocalVectorStore(engineId); this.stores.set(engineId, s); }
    return s;
  }

  list(): EngineId[] { return [...this.stores.keys()]; }

  async remove(engineId: EngineId): Promise<boolean> {
    const s = this.stores.get(engineId);
    if (!s) return false;
    await s.clear();
    this.stores.delete(engineId);
    return true;
  }
}
