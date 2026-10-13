export type SpaceKey = string;
export type EngineId = string;

export type Modality = 'text' | 'image';

export type StoreState = 'absent' | 'building' | 'ready' | 'stale' | 'corrupt';

export interface StoreManifest {
  engineId: EngineId;
  engineFingerprint: string;
  spaceKey: SpaceKey;
  dim: number;
  normalize: 'l2' | 'none';
  itemCount: number;
  sourceHash: string;
  probeText: string;
  probeVector: number[];
  builtAt: string;
  builtBy: string;
}

export interface VectorIndex {
  readonly size: number;
  readonly bytes: number;
  get(id: string): Float32Array | null;
  rank(q: Float32Array, topK: number, minScore: number): { id: string; score: number }[];
}

export interface ActiveBinding {
  generation: number;
  engineId: EngineId;
  engine: Engine;
  store: VectorStore | null;
  manifest: StoreManifest | null;
  index: VectorIndex | null;
  state: StoreState;
  switchError?: string;
}

export interface Engine {
  readonly id: EngineId;
  readonly fingerprint: string;
  readonly modalities: Modality[];
  probe(signal?: AbortSignal): Promise<{ ok: boolean; fingerprint: string }>;
  encode(input: { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string }, signal?: AbortSignal): Promise<Float32Array>;
}

export interface VectorStore {
  readonly engineId: EngineId;
  loadManifest(): Promise<StoreManifest | null>;
  putVector(id: string, v: Float32Array): Promise<void>;
  getVector(id: string): Promise<Float32Array | null>;
  iterate(cb: (id: string, v: Float32Array) => void): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
  writeManifest(m: StoreManifest): Promise<void>;
}

export interface Hit { id: string; score: number; source: EngineId }

export interface DegradeInfo { reason: 'no-engine' | 'store-absent' | 'store-stale' | 'store-corrupt' | 'encode-failed' | 'switch-failed'; detail?: string }

export interface SearchRequest {
  query: { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string };
  topK?: number;
  minScore?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  engineId?: EngineId;
}

export interface SearchResult {
  hits: Hit[];
  spaceKey: SpaceKey;
  engineId: EngineId;
  modality: Modality;
  degraded: DegradeInfo | null;
  timings: { probeMs: number; encodeMs: number; rankMs: number };
}
