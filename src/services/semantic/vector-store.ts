declare const localforage: typeof import('localforage');

import type { EngineId, StoreManifest, VectorStore } from './types';
import { readManifest, commitBuild, MANIFEST_KEY } from './manifest';

export function storeNameFor(engineId: EngineId): string {
  return `embeddings__${engineId}`;
}

export class LocalVectorStore implements VectorStore {
  readonly engineId: EngineId;
  private inst: ReturnType<typeof localforage.createInstance>;

  constructor(engineId: EngineId) {
    this.engineId = engineId;
    this.inst = localforage.createInstance({ name: 'questionBank', storeName: storeNameFor(engineId) });
  }

  loadManifest(): Promise<StoreManifest | null> { return readManifest(storeNameFor(this.engineId)); }
  async putVector(id: string, v: Float32Array): Promise<void> { await this.inst.setItem(id, v.buffer); }
  async getVector(id: string): Promise<Float32Array | null> {
    const buf = (await this.inst.getItem(id)) as ArrayBuffer | null;
    return buf ? new Float32Array(buf) : null;
  }
  async iterate(cb: (id: string, v: Float32Array) => void): Promise<void> {
    await this.inst.iterate((v: unknown, k: string) => {
      if (k === MANIFEST_KEY) return;
      if (v instanceof ArrayBuffer) cb(k, new Float32Array(v));
    });
  }
  async count(): Promise<number> {
    let n = 0;
    await this.inst.iterate((_v: unknown, k: string) => { if (k !== MANIFEST_KEY) n++; });
    return n;
  }
  async clear(): Promise<void> { await this.inst.clear(); }
  writeManifest(m: StoreManifest): Promise<void> { return commitBuild(storeNameFor(this.engineId), m); }
}
