import type { ActiveBinding, Engine, EngineId, StoreManifest, VectorIndex, VectorStore } from './types';
import type { VectorStoreRegistry } from './registry';
import { checkSelfConsistency } from './conformance';
import { FlatVectorIndex } from './flat-index';

export class EngineBinding {
  private _active: ActiveBinding | null = null;
  private _gen = 0;

  constructor(private registry: VectorStoreRegistry) {}

  get active(): ActiveBinding | null { return this._active; }

  async switchTo(engineId: EngineId, opts: { engine: Engine; signal?: AbortSignal }): Promise<ActiveBinding> {
    const { engine, signal } = opts;
    let store: VectorStore | null = null;
    const frame = (manifest: StoreManifest | null, index: VectorIndex | null) => ({ engineId, engine, store, manifest, index });

    try {
      store = this.registry.get(engineId);
      const health = await engine.probe(signal).catch(() => ({ ok: false, fingerprint: '' }));
      if (!health.ok) return this.commit({ ...frame(null, null), state: 'absent', switchError: '该引擎当前不可达' });

      const manifest = await store.loadManifest();
      if (!manifest) return this.commit({ ...frame(null, null), state: 'absent' });

      if (manifest.engineFingerprint !== engine.fingerprint) {
        return this.commit({ ...frame(manifest, null), state: 'stale' });
      }

      const c = await checkSelfConsistency(engine, manifest, signal);
      if (!c.ok) return this.commit({ ...frame(manifest, null), state: 'stale' });

      let index: VectorIndex;
      try {
        index = await FlatVectorIndex.build(store, manifest.dim);
      } catch {
        return this.commit({ ...frame(manifest, null), state: 'corrupt' });
      }
      return this.commit({ ...frame(manifest, index), state: 'ready' });
    } catch (err) {
      const switchError = err instanceof Error ? err.message : String(err);
      return this.commit({ ...frame(null, null), state: 'absent', switchError });
    }
  }

  private commit(p: Omit<ActiveBinding, 'generation'>): ActiveBinding {
    const next: ActiveBinding = { generation: ++this._gen, ...p };
    this._active = next;
    return next;
  }
}
