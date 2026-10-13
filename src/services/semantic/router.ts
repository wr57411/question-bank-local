import type {
  ActiveBinding,
  DegradeInfo,
  Engine,
  EngineId,
  Hit,
  Modality,
  SearchRequest,
  SearchResult,
  StoreState,
} from './types';
import type { EngineBinding } from './binding';

const SECONDS_PER_ITEM = 227 / 91;
const FALLBACK_BUILD_MINUTES = 4;

export interface SwitchOutcome {
  ok: boolean;
  state: StoreState;
  degraded: DegradeInfo | null;
}

export function estimateBuildMinutes(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(1, Math.round((itemCount * SECONDS_PER_ITEM) / 60));
}

export class SemanticRouter {
  constructor(private binding: EngineBinding) {}

  private head(modality: Modality) {
    const active = this.binding.active;
    return {
      spaceKey: active?.manifest?.spaceKey ?? '',
      engineId: active?.engineId ?? '',
      modality,
      timings: { probeMs: 0, encodeMs: 0, rankMs: 0 },
    };
  }

  private absentDegrade(active: ActiveBinding): DegradeInfo {
    if (active.switchError) {
      return { reason: 'switch-failed', detail: `引擎切换失败：${active.switchError}` };
    }
    const minutes = estimateBuildMinutes(active.manifest?.itemCount ?? 0) || FALLBACK_BUILD_MINUTES;
    return { reason: 'store-absent', detail: `正在为该引擎建库，约 ${minutes} 分钟` };
  }

  async switchTo(engineId: EngineId, opts: { engine: Engine; signal?: AbortSignal }): Promise<SwitchOutcome> {
    try {
      const active = await this.binding.switchTo(engineId, opts);
      return { ok: true, state: active.state, degraded: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        state: this.binding.active?.state ?? 'absent',
        degraded: { reason: 'switch-failed', detail: `引擎切换失败：${message}` },
      };
    }
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const t0 = Date.now();
    const base = this.head(req.query.kind);
    const active = this.binding.active;
    if (!active) return { ...base, hits: [], degraded: { reason: 'no-engine' } };
    if (!active.engine.modalities.includes(req.query.kind)) {
      return { ...base, hits: [], degraded: { reason: 'no-engine', detail: `${active.engineId} 不支持 ${req.query.kind}` } };
    }
    if (active.state === 'absent' || active.state === 'building') {
      return { ...base, hits: [], degraded: this.absentDegrade(active) };
    }
    if (active.state === 'stale') {
      return { ...base, hits: [], degraded: { reason: 'store-stale', detail: '该引擎已升级，向量库需重建' } };
    }
    if (active.state === 'corrupt') {
      return { ...base, hits: [], degraded: { reason: 'store-corrupt', detail: '向量库损坏，需重建' } };
    }
    if (!active.index) return { ...base, hits: [], degraded: { reason: 'store-absent', detail: '向量索引未就绪' } };

    const gen = active.generation;
    let q: Float32Array;
    try {
      q = await active.engine.encode(req.query, req.signal);
    } catch {
      return { ...base, hits: [], degraded: { reason: 'encode-failed' } };
    }
    if (this.binding.active?.generation !== gen) {
      return { ...base, hits: [], degraded: { reason: 'switch-failed', detail: '引擎已切换' } };
    }

    const t1 = Date.now();
    let hits: Hit[];
    try {
      hits = active.index
        .rank(q, req.topK ?? 10, req.minScore ?? 0.25)
        .map((h) => ({ ...h, source: active.engineId }));
    } catch {
      return { ...base, hits: [], degraded: { reason: 'store-corrupt', detail: '向量索引检索失败，需重建' } };
    }
    return { ...base, hits, degraded: null, timings: { probeMs: 0, encodeMs: t1 - t0, rankMs: Date.now() - t1 } };
  }

  async searchSimilar(id: string, opts?: { topK?: number }): Promise<SearchResult> {
    const base = this.head('text');
    const active = this.binding.active;
    if (!active || active.state !== 'ready' || !active.index) {
      const reason: DegradeInfo['reason'] =
        active?.state === 'stale' ? 'store-stale' : active?.state === 'corrupt' ? 'store-corrupt' : 'store-absent';
      return { ...base, hits: [], degraded: { reason } };
    }
    const self = active.index.get(id);
    if (!self) return { ...base, hits: [], degraded: { reason: 'store-absent', detail: '该题不在当前引擎的库中' } };
    const topK = opts?.topK ?? 6;
    const t0 = Date.now();
    let hits: Hit[];
    try {
      hits = active.index
        .rank(self, topK + 1, 0)
        .filter((h) => h.id !== id)
        .slice(0, topK)
        .map((h) => ({ ...h, source: active.engineId }));
    } catch {
      return { ...base, hits: [], degraded: { reason: 'store-corrupt', detail: '向量索引检索失败，需重建' } };
    }
    return { ...base, hits, degraded: null, timings: { probeMs: 0, encodeMs: 0, rankMs: Date.now() - t0 } };
  }
}
