import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// import 链（embeddings → sync → stores）在模块顶层会调 localforage.createInstance，
// 必须在静态 import 求值前先放一个全局桩（同 embeddings-lazy.spec.js 的踩坑记录）。
vi.hoisted(() => {
  const noopStore = () => ({
    setItem: async () => {},
    getItem: async () => null,
    removeItem: async () => {},
    clear: async () => {},
    length: async () => 0,
    iterate: async () => {},
  });
  globalThis.localforage = { createInstance: noopStore };
});

import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { initRemoteSync } from '../src/data/sync.ts';
import { refreshEmbeddings } from '../src/data/embeddings.ts';
import { HttpEngine } from '../src/services/semantic/engine-http.ts';
import {
  ENGINE_STORAGE_KEY,
  MODEL_TAG,
  buildEngineStore,
  createSemanticService,
  fnv1a,
  initSemanticRuntime,
  makeEngine,
  resolveEngine,
  sourceHashFor,
  spaceKeyFor,
  storedEngineId,
  switchSemanticEngine,
} from '../src/services/semantic/runtime.ts';
import { makeSpaceKey } from '../src/services/semantic/invariants.ts';
import { PROBE_TEXT, readManifest } from '../src/services/semantic/manifest.ts';
import { LocalVectorStore, storeNameFor } from '../src/services/semantic/vector-store.ts';
import { EngineBinding } from '../src/services/semantic/binding.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';
import { SemanticRouter } from '../src/services/semantic/router.ts';

const REAL_FETCH = globalThis.fetch;
const BASE = 'http://test.local';
const DIM = 8;

const ENGINE_MAC = { id: 'mac', fingerprint: 'fp-mac', reachable: true };
const ENGINE_LINUX = { id: 'linux', fingerprint: 'fp-linux', reachable: true };

const norm = (a) => {
  const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0));
  return Float32Array.from(a, (x) => x / s);
};
const vec = (seed) => norm(Float32Array.from({ length: DIM }, (_, i) => ((i + seed) % 5) + 1));

function toB64(arr) {
  const bytes = new Uint8Array(Float32Array.from(arr).buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function vectorsResponse(engineId, ids, seed = 0) {
  return {
    engineId,
    model: MODEL_TAG,
    count: ids.length,
    embeddings: ids.map((id, i) => ({ question_id: id, dim: DIM, vector: toB64(vec(seed + i)) })),
  };
}

const oldManifest = {
  engineId: 'mac',
  engineFingerprint: 'fp-old',
  spaceKey: 'old-space',
  dim: DIM,
  normalize: 'l2',
  itemCount: 1,
  sourceHash: 'old-hash',
  probeText: PROBE_TEXT,
  probeVector: Array.from(vec(9)),
  builtAt: '2026-09-01T00:00:00Z',
  builtBy: 'mac',
};

function respond(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function isResponse(v) {
  return !!v && typeof v === 'object' && typeof v.json === 'function' && 'ok' in v;
}

async function pick(v) {
  if (v instanceof Error) throw v;
  const val = typeof v === 'function' ? await v() : v;
  return isResponse(val) ? val : respond(val);
}

let fetchMock;

// runtime.ts 持有模块级单例（registry / binding），其中 registry 缓存的 LocalVectorStore
// 在构造时就绑定了当时的 localforage 实例。若每个用例重装一个新桩，缓存实例会指向被丢弃的
// 旧 Map，写入与读取分家。故本文件装一次桩、每个用例只清数据。
const fakeStores = installFakeLocalforage();

function clearAllStores() {
  for (const m of fakeStores.values()) m.clear();
}

function backend(over = {}) {
  const cfg = {
    engines: [ENGINE_MAC],
    health: { engineId: 'mac', dtype: 'bf16', fingerprint: 'fp-server' },
    vectors: vectorsResponse('mac', ['q1', 'q2', 'q3']),
    text: { dim: DIM, vectors: [Array.from(vec(0))] },
    image: { dim: DIM, vectors: [Array.from(vec(0))] },
    ...over,
  };
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(String(url));
    const path = u.pathname + u.search;
    if (path === '/api/embed/engines') return pick(cfg.engines);
    if (path.startsWith('/api/embed/health')) return pick(cfg.health);
    if (path.startsWith('/api/embed/vectors')) return pick(cfg.vectors);
    if (path.startsWith('/api/embed/text')) return pick(cfg.text);
    if (path.startsWith('/api/embed/image')) return pick(cfg.image);
    throw new Error('未预期的请求: ' + path);
  });
  return cfg;
}

function resetWindow() {
  delete window.SemanticService;
  delete window.semanticEngineId;
}

beforeEach(() => {
  clearAllStores();
  localStorage.clear();
  resetWindow();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  initRemoteSync(BASE, 'test-token', true);
});

describe('HttpEngine（Engine 的 HTTP 适配器）', () => {
  it('只读属性满足 Engine 接口：id / fingerprint / modalities', () => {
    const e = new HttpEngine('mac', 'fp-mac');
    expect(e.id).toBe('mac');
    expect(e.fingerprint).toBe('fp-mac');
    expect(e.modalities).toEqual(['text', 'image']);
  });

  it('probe 走 GET /api/embed/health?engineId=，返回服务端算的指纹', async () => {
    backend();
    const e = new HttpEngine('mac', 'fp-local');
    const h = await e.probe();
    expect(h).toEqual({ ok: true, fingerprint: 'fp-server' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/embed/health?engineId=mac`);
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('probe 服务不可达 → ok:false，不抛异常', async () => {
    backend({ health: new Error('connect ECONNREFUSED') });
    const e = new HttpEngine('mac', 'fp-local');
    expect(await e.probe()).toEqual({ ok: false, fingerprint: '' });
  });

  it('probe 服务端 503 → ok:false', async () => {
    backend({ health: () => respond({ error: '语义编码服务不可用' }, 503) });
    const e = new HttpEngine('mac', 'fp-local');
    expect(await e.probe()).toEqual({ ok: false, fingerprint: '' });
  });

  it('encode 文本 → POST /api/embed/text，返回 Float32Array', async () => {
    backend();
    const e = new HttpEngine('mac', 'fp-mac');
    const v = await e.encode({ kind: 'text', text: '计算三角形的面积' });
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(DIM);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/embed/text?engineId=mac`);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ texts: ['计算三角形的面积'] });
  });

  it('encode 图片 → POST /api/embed/image，返回 Float32Array', async () => {
    backend();
    const e = new HttpEngine('mac', 'fp-mac');
    const v = await e.encode({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' });
    expect(v).toBeInstanceOf(Float32Array);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/embed/image?engineId=mac`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ image: 'data:image/png;base64,AAAA' });
  });

  it('encode 服务端返回空向量 → 抛错（不静默返回空数组）', async () => {
    backend({ text: { dim: 0, vectors: [] } });
    const e = new HttpEngine('mac', 'fp-mac');
    await expect(e.encode({ kind: 'text', text: 'x' })).rejects.toThrow();
  });
});

describe('spaceKey / sourceHash', () => {
  it('spaceKey 用 makeSpaceKey 拼装（model:precision:dim:normalize:modalities）', () => {
    const expected = makeSpaceKey({
      model: MODEL_TAG,
      precision: 'bf16',
      dim: 2048,
      normalize: 'l2',
      modalities: ['text', 'image'],
    });
    expect(spaceKeyFor('bf16', 2048)).toBe(expected);
    // makeSpaceKey 对模态排序（顺序无关），故规范形为 image+text
    expect(spaceKeyFor('bf16', 2048)).toBe('wemm-embedding-2b:bf16:2048:l2:image+text');
  });

  it('spaceKey 随 dtype / dim 变化', () => {
    expect(spaceKeyFor('bf16', 2048)).not.toBe(spaceKeyFor('fp32', 2048));
    expect(spaceKeyFor('bf16', 2048)).not.toBe(spaceKeyFor('bf16', 256));
  });

  it('fnv1a 确定性：同输入同输出，不同输入不同输出', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('sourceHash = hash(count:dim:fingerprint)，确定性', () => {
    expect(sourceHashFor(91, 2048, 'fp-1')).toBe(sourceHashFor(91, 2048, 'fp-1'));
    expect(sourceHashFor(91, 2048, 'fp-1')).not.toBe(sourceHashFor(92, 2048, 'fp-1'));
    expect(sourceHashFor(91, 2048, 'fp-1')).not.toBe(sourceHashFor(91, 2048, 'fp-2'));
    expect(sourceHashFor(91, 2048, 'fp-1')).not.toBe(sourceHashFor(91, 1024, 'fp-1'));
  });
});

describe('buildEngineStore：两阶段提交', () => {
  it('成功路径：manifest 字段齐全且落库', async () => {
    backend();
    const engine = new HttpEngine('mac', 'fp-mac');
    const built = await buildEngineStore('mac', engine);

    expect(built).toEqual({
      engineId: 'mac',
      count: 3,
      dim: DIM,
      spaceKey: spaceKeyFor('bf16', DIM),
      sourceHash: sourceHashFor(3, DIM, 'fp-server'),
    });

    const m = await readManifest(storeNameFor('mac'));
    expect(m.engineId).toBe('mac');
    expect(m.engineFingerprint).toBe('fp-server');
    expect(m.spaceKey).toBe(spaceKeyFor('bf16', DIM));
    expect(m.dim).toBe(DIM);
    expect(m.normalize).toBe('l2');
    expect(m.itemCount).toBe(3);
    expect(m.sourceHash).toBe(sourceHashFor(3, DIM, 'fp-server'));
    expect(m.probeText).toBe(PROBE_TEXT);
    expect(m.probeVector).toHaveLength(DIM);
    expect(typeof m.builtAt).toBe('string');
    expect(m.builtBy).toBe('mac');
    expect(await new LocalVectorStore('mac').count()).toBe(3);
  });

  it('拉向量发生在清库之前：拉取期间旧 manifest 仍可见（先拉后清）', async () => {
    await new LocalVectorStore('mac').writeManifest(oldManifest);
    expect(await readManifest(storeNameFor('mac'))).not.toBeNull();

    let duringFetch = 'unset';
    backend({
      vectors: async () => {
        duringFetch = await readManifest(storeNameFor('mac'));
        return vectorsResponse('mac', ['q1', 'q2']);
      },
    });
    await buildEngineStore('mac', new HttpEngine('mac', 'fp-mac'));

    expect(duringFetch).toEqual(oldManifest);
    const after = await readManifest(storeNameFor('mac'));
    expect(after).not.toBeNull();
    expect(after.itemCount).toBe(2);
  });

  it('本地写入失败（putVector 抛错）→ 抛错且不留 manifest（判为不存在，不留半库）', async () => {
    backend();
    const spy = vi
      .spyOn(LocalVectorStore.prototype, 'putVector')
      .mockRejectedValue(new Error('IndexedDB 写入失败'));
    try {
      await expect(buildEngineStore('mac', new HttpEngine('mac', 'fp-mac'))).rejects.toThrow(
        'IndexedDB 写入失败',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await readManifest(storeNameFor('mac'))).toBeNull();
    expect(await new LocalVectorStore('mac').count()).toBe(0);
  });

  it('引擎不可达 → 抛错，且旧库不被清空', async () => {
    await new LocalVectorStore('mac').writeManifest(oldManifest);
    backend({ health: new Error('connect ECONNREFUSED') });
    const engine = new HttpEngine('mac', 'fp-mac');

    await expect(buildEngineStore('mac', engine)).rejects.toThrow('不可达');
    expect(await readManifest(storeNameFor('mac'))).not.toBeNull();
  });

  it('拉向量失败 → 抛错，旧库完好（beginBuild 未执行）', async () => {
    await new LocalVectorStore('mac').writeManifest(oldManifest);
    backend({ vectors: new Error('同步请求失败: 500') });
    const engine = new HttpEngine('mac', 'fp-mac');

    await expect(buildEngineStore('mac', engine)).rejects.toThrow();
    expect(await readManifest(storeNameFor('mac'))).toEqual(oldManifest);
  });

  it('只写本引擎的 store（引擎隔离）', async () => {
    backend({ vectors: vectorsResponse('linux', ['q1']) });
    await buildEngineStore('linux', new HttpEngine('linux', 'fp-linux'));
    expect(await new LocalVectorStore('linux').count()).toBe(1);
    expect(await new LocalVectorStore('mac').count()).toBe(0);
    expect(await readManifest(storeNameFor('linux'))).not.toBeNull();
    expect(await readManifest(storeNameFor('mac'))).toBeNull();
  });
});

describe('refreshEmbeddings：按引擎拉向量 + 两阶段提交 + 重新绑定', () => {
  it('默认取 /engines 第一个引擎，返回条数并落 manifest', async () => {
    backend();
    expect(await refreshEmbeddings()).toBe(3);
    const m = await readManifest(storeNameFor('mac'));
    expect(m).not.toBeNull();
    expect(m.engineId).toBe('mac');
    expect(m.itemCount).toBe(3);
    expect(await new LocalVectorStore('mac').count()).toBe(3);
  });

  it('拉完后门面即可用（switchTo 得到 ready，搜索不降级）', async () => {
    backend();
    await refreshEmbeddings();
    const res = await createSemanticService().search({
      query: { kind: 'text', text: '三角形的面积' },
      minScore: 0,
    });
    expect(res.degraded).toBeNull();
    expect(res.engineId).toBe('mac');
    expect(res.spaceKey).toBe(spaceKeyFor('bf16', DIM));
    expect(res.hits.length).toBeGreaterThan(0);
  });

  it('/engines 为空 → 返回 0，不抛异常、不建库', async () => {
    backend({ engines: [] });
    expect(await refreshEmbeddings()).toBe(0);
    expect(await readManifest(storeNameFor('mac'))).toBeNull();
  });

  it('localStorage 里的引擎优先于 /engines 第一个', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX], vectors: vectorsResponse('linux', ['q1']) });
    localStorage.setItem(ENGINE_STORAGE_KEY, 'linux');
    expect(await refreshEmbeddings()).toBe(1);
    expect(await readManifest(storeNameFor('linux'))).not.toBeNull();
    expect(await readManifest(storeNameFor('mac'))).toBeNull();
  });

  it('拉取失败 → 返回 0，且旧库完好（beginBuild 未执行）', async () => {
    backend();
    expect(await refreshEmbeddings()).toBe(3);
    const before = await readManifest(storeNameFor('mac'));
    expect(before).not.toBeNull();
    expect(before.itemCount).toBe(3);

    backend({ vectors: new Error('同步请求失败: 500') });
    expect(await refreshEmbeddings()).toBe(0);

    expect(await readManifest(storeNameFor('mac'))).toEqual(before);
    expect(await new LocalVectorStore('mac').count()).toBe(3);
  });

  it('/engines 不可达 → 返回 0，不抛异常', async () => {
    backend({ engines: new Error('connect ECONNREFUSED') });
    await expect(refreshEmbeddings()).resolves.toBe(0);
  });
});

describe('resolveEngine / storedEngineId', () => {
  it('无 localStorage 时取第一个引擎', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX] });
    const r = await resolveEngine();
    expect(r.engineId).toBe('mac');
    expect(r.engine).toBeInstanceOf(HttpEngine);
    expect(storedEngineId()).toBeNull();
  });

  it('localStorage 记录不在 /engines 里 → 回退到第一个', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX] });
    localStorage.setItem(ENGINE_STORAGE_KEY, 'ghost');
    expect((await resolveEngine()).engineId).toBe('mac');
  });

  it('/engines 为空 → null', async () => {
    backend({ engines: [] });
    expect(await resolveEngine()).toBeNull();
  });
});

describe('createSemanticService', () => {
  it('返回 SemanticRouter 实例（不是类）', () => {
    const svc = createSemanticService();
    expect(svc).toBeInstanceOf(SemanticRouter);
    expect(typeof svc.search).toBe('function');
    expect(typeof svc.searchSimilar).toBe('function');
  });

  it('未绑定引擎时 search 返回 no-engine 降级', async () => {
    const svc = createSemanticService({ binding: new EngineBinding(new VectorStoreRegistry()) });
    const res = await svc.search({ query: { kind: 'text', text: 'x' } });
    expect(res.degraded.reason).toBe('no-engine');
    expect(res.hits).toEqual([]);
  });
});

describe('initSemanticRuntime：门面单例 + 挂载', () => {
  it('/engines 为空 → 不挂门面、不报错（静默降级）', async () => {
    backend({ engines: [] });
    await expect(initSemanticRuntime()).resolves.toBeUndefined();
    expect(window.SemanticService).toBeUndefined();
    expect(window.semanticEngineId).toBeUndefined();
  });

  it('/engines 请求失败 → 不挂门面、不报错', async () => {
    backend({ engines: new Error('同步请求失败: 401') });
    await expect(initSemanticRuntime()).resolves.toBeUndefined();
    expect(window.SemanticService).toBeUndefined();
  });

  it('挂的是 SemanticRouter 实例 + 当前引擎 id', async () => {
    backend();
    await initSemanticRuntime();
    expect(window.SemanticService).toBeInstanceOf(SemanticRouter);
    expect(typeof window.SemanticService).toBe('object');
    expect(window.semanticEngineId).toBe('mac');
    expect(makeEngine(ENGINE_MAC)).toBeInstanceOf(HttpEngine);
  });

  it('localStorage 里的引擎优先', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX] });
    localStorage.setItem(ENGINE_STORAGE_KEY, 'linux');
    await initSemanticRuntime();
    expect(window.semanticEngineId).toBe('linux');
  });

  it('库已建好时挂载后 search 得到 ready（不降级）', async () => {
    backend();
    await refreshEmbeddings();
    await initSemanticRuntime();
    const res = await window.SemanticService.search({
      query: { kind: 'text', text: '三角形的面积' },
      minScore: 0,
    });
    expect(res.degraded).toBeNull();
    expect(res.hits.length).toBeGreaterThan(0);
  });

  it('库不存在时挂载后 search 报 store-absent（不误用别的库）', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX], vectors: vectorsResponse('linux', ['q1']) });
    localStorage.setItem(ENGINE_STORAGE_KEY, 'linux');
    await initSemanticRuntime();
    expect(window.semanticEngineId).toBe('linux');
    const res = await window.SemanticService.search({ query: { kind: 'text', text: 'x' } });
    expect(res.degraded.reason).toBe('store-absent');
  });
});

describe('switchSemanticEngine', () => {
  it('切换后写 localStorage 与 window.semanticEngineId', async () => {
    backend({ engines: [ENGINE_MAC, ENGINE_LINUX] });
    const outcome = await switchSemanticEngine('linux');
    expect(outcome.state).toBe('absent');
    expect(localStorage.getItem(ENGINE_STORAGE_KEY)).toBe('linux');
    expect(window.semanticEngineId).toBe('linux');
  });

  it('未知引擎 id → 返回 null，且不改动 localStorage', async () => {
    backend({ engines: [ENGINE_MAC] });
    expect(await switchSemanticEngine('ghost')).toBeNull();
    expect(localStorage.getItem(ENGINE_STORAGE_KEY)).toBeNull();
    expect(window.semanticEngineId).toBeUndefined();
  });
});

// ---------------- 第 2 层：真实链路探针（连真实 server，非 mock） ----------------
// 默认连 http://127.0.0.1:3001；可用 SEMANTIC_PROBE_BASE_URL 指向本 worktree 的 server。
// server 不可达 / 缺凭据 / 服务端缺 /api/embed/engines 时一律 skip，不制造假失败。
const PROBE_BASE = process.env.SEMANTIC_PROBE_BASE_URL || 'http://127.0.0.1:3001';

async function probeReachable(base) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await REAL_FETCH(`${base}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch {
    return false;
  }
}

async function probeToken(base) {
  if (process.env.E2E_TOKEN) return process.env.E2E_TOKEN;
  const phone = process.env.E2E_TEST_PHONE;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!phone || !password) return null;
  try {
    const r = await REAL_FETCH(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
    if (!r.ok) return null;
    const body = await r.json();
    return body.token || (body.data && body.data.token) || null;
  } catch {
    return null;
  }
}

async function enginesRouteOk(base, token) {
  try {
    const r = await REAL_FETCH(`${base}/api/embed/engines`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

describe('真实链路探针（连真实 server，非 mock）', () => {
  beforeEach(() => {
    clearAllStores();
    localStorage.clear();
    resetWindow();
    vi.stubGlobal('fetch', REAL_FETCH);
  });

  it('initSemanticRuntime + refreshEmbeddings：manifest 落库、switchTo 得到 ready', async (ctx) => {
    if (!(await probeReachable(PROBE_BASE))) {
      ctx.skip(`server 不可达 (${PROBE_BASE})`);
      return;
    }
    const token = await probeToken(PROBE_BASE);
    if (!token) {
      ctx.skip('缺可用凭据（E2E_TOKEN 或 E2E_TEST_PHONE + E2E_TEST_PASSWORD）');
      return;
    }
    if (!(await enginesRouteOk(PROBE_BASE, token))) {
      ctx.skip(`服务端缺少可用 /api/embed/engines（${PROBE_BASE} 可能在跑旧代码）`);
      return;
    }

    initRemoteSync(PROBE_BASE, token, true);
    await initSemanticRuntime();

    expect(typeof window.semanticEngineId).toBe('string');
    expect(window.semanticEngineId.length).toBeGreaterThan(0);
    expect(window.SemanticService).toBeInstanceOf(SemanticRouter);

    const engineId = window.semanticEngineId;
    const pulled = await refreshEmbeddings();
    expect(pulled).toBeGreaterThan(0);

    const manifest = await readManifest(storeNameFor(engineId));
    expect(manifest).not.toBeNull();
    expect(manifest.engineId).toBe(engineId);
    expect(manifest.itemCount).toBe(pulled);
    expect(manifest.dim).toBeGreaterThan(0);
    expect(manifest.engineFingerprint.length).toBeGreaterThan(0);

    const res = await window.SemanticService.search({
      query: { kind: 'text', text: PROBE_TEXT },
      minScore: 0,
      topK: 3,
    });
    expect(res.degraded).toBeNull();
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.spaceKey).toBe(manifest.spaceKey);

    console.log(
      `[probe] base=${PROBE_BASE} engineId=${engineId} pulled=${pulled} dim=${manifest.dim} spaceKey=${manifest.spaceKey} hits=${res.hits.length}`
    );
  });
});
