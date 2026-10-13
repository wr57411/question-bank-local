import { remoteCall } from '../../data/sync';
import { HttpEngine } from './engine-http';
import { VectorStoreRegistry } from './registry';
import { EngineBinding } from './binding';
import { SemanticRouter, type SwitchOutcome } from './router';
import { decodeVector, makeSpaceKey } from './invariants';
import { storeNameFor } from './vector-store';
import { PROBE_TEXT, beginBuild, commitBuild } from './manifest';
import type { Engine, EngineId, Modality, StoreManifest } from './types';

export const MODEL_TAG = 'wemm-embedding-2b';
export const ENGINE_STORAGE_KEY = 'semanticEngineId';

const NORMALIZE: 'l2' | 'none' = 'l2';
const MODALITIES: Modality[] = ['text', 'image'];

export interface EngineInfo {
  id: EngineId;
  fingerprint: string;
  reachable: boolean;
}

export interface ResolvedEngine {
  engineId: EngineId;
  engine: HttpEngine;
}

export interface BuildOutcome {
  engineId: EngineId;
  count: number;
  dim: number;
  spaceKey: string;
  sourceHash: string;
}

export class EngineUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineUnreachableError';
  }
}

interface VectorsResponse {
  count?: number;
  embeddings?: { question_id: string; dim: number; vector: string }[];
}

let _registry: VectorStoreRegistry | null = null;
let _binding: EngineBinding | null = null;

function registry(): VectorStoreRegistry {
  if (!_registry) _registry = new VectorStoreRegistry();
  return _registry;
}

function binding(): EngineBinding {
  if (!_binding) _binding = new EngineBinding(registry());
  return _binding;
}

export function createSemanticService(deps?: { binding?: EngineBinding }): SemanticRouter {
  return new SemanticRouter(deps?.binding ?? binding());
}

export function makeEngine(info: EngineInfo): HttpEngine {
  return new HttpEngine(info.id, info.fingerprint, MODALITIES);
}

export function spaceKeyFor(dtype: string, dim: number): string {
  return makeSpaceKey({
    model: MODEL_TAG,
    precision: dtype,
    dim,
    normalize: NORMALIZE,
    modalities: MODALITIES,
  });
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sourceHashFor(count: number, dim: number, fingerprint: string): string {
  return fnv1a(`${count}:${dim}:${fingerprint}`);
}

export async function listEngines(): Promise<EngineInfo[]> {
  const res = (await remoteCall('/api/embed/engines')) as EngineInfo[] | null;
  return Array.isArray(res) ? res : [];
}

export function storedEngineId(): EngineId | null {
  return localStorage.getItem(ENGINE_STORAGE_KEY) || null;
}

export async function resolveEngine(): Promise<ResolvedEngine | null> {
  const engines = await listEngines();
  if (engines.length === 0) return null;
  const stored = storedEngineId();
  const chosen = engines.find((e) => e.id === stored) ?? engines[0];
  return { engineId: chosen.id, engine: makeEngine(chosen) };
}

export function activateEngine(engineId: EngineId, engine: Engine): Promise<SwitchOutcome> {
  return createSemanticService().switchTo(engineId, { engine });
}

export async function buildEngineStore(
  engineId: EngineId,
  engine: HttpEngine,
  signal?: AbortSignal,
): Promise<BuildOutcome> {
  let health: { fingerprint: string; dtype: string };
  try {
    health = await engine.health(signal);
  } catch {
    throw new EngineUnreachableError(`引擎 ${engineId} 不可达`);
  }

  const store = registry().get(engineId);
  const storeName = storeNameFor(engineId);

  let items: { question_id: string; dim: number; vector: string }[];
  let probeVector: Float32Array;
  try {
    const res = (await remoteCall(
      `/api/embed/vectors?engineId=${encodeURIComponent(engineId)}`,
    )) as VectorsResponse;
    items = res?.embeddings ?? [];
    probeVector = await engine.encode({ kind: 'text', text: PROBE_TEXT }, signal);
  } catch {
    throw new EngineUnreachableError(`引擎 ${engineId} 的向量拉取失败`);
  }

  const count = items.length;
  const dim = count > 0 ? items[0].dim : probeVector.length;

  const manifest: StoreManifest = {
    engineId,
    engineFingerprint: health.fingerprint,
    spaceKey: spaceKeyFor(health.dtype, dim),
    dim,
    normalize: NORMALIZE,
    itemCount: count,
    sourceHash: sourceHashFor(count, dim, health.fingerprint),
    probeText: PROBE_TEXT,
    probeVector: Array.from(probeVector),
    builtAt: new Date().toISOString(),
    builtBy: engineId,
  };

  await beginBuild(storeName);
  for (const it of items) {
    await store.putVector(it.question_id, decodeVector(it.vector));
  }
  await commitBuild(storeName, manifest);

  return {
    engineId,
    count,
    dim,
    spaceKey: manifest.spaceKey,
    sourceHash: manifest.sourceHash,
  };
}

function mount(key: string, value: unknown): void {
  (window as unknown as Record<string, unknown>)[key] = value;
}

export async function switchSemanticEngine(engineId: EngineId): Promise<SwitchOutcome | null> {
  const engines = await listEngines();
  const info = engines.find((e) => e.id === engineId);
  if (!info) return null;
  const outcome = await activateEngine(engineId, makeEngine(info));
  localStorage.setItem(ENGINE_STORAGE_KEY, engineId);
  mount('semanticEngineId', engineId);
  return outcome;
}

export async function initSemanticRuntime(): Promise<void> {
  let resolved: ResolvedEngine | null;
  try {
    resolved = await resolveEngine();
  } catch {
    return;
  }
  if (!resolved) return;
  const service = createSemanticService();
  mount('SemanticService', service);
  mount('semanticEngineId', resolved.engineId);
  await service.switchTo(resolved.engineId, { engine: resolved.engine });
}
