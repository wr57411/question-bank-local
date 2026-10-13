import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { SemanticRouter, estimateBuildMinutes } from '../src/services/semantic/router.ts';
import { EngineBinding } from '../src/services/semantic/binding.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';

const DIM = 4;
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };
const mkEngine = (id, v, modalities = ['text']) => {
  const engine = {
    id, fingerprint: `fp-${id}`, modalities, encodeCalls: 0,
    probe: async () => ({ ok: true, fingerprint: `fp-${id}` }),
    encode: async () => { engine.encodeCalls++; return v; },
  };
  return engine;
};
const manifest = (engineId, v) => ({
  engineId, engineFingerprint: `fp-${engineId}`, spaceKey: 'k', dim: DIM, normalize: 'l2',
  itemCount: 2, sourceHash: 'h', probeText: 'x', probeVector: Array.from(v), builtAt: '', builtBy: engineId,
});

const ANCHOR = norm([1, 0, 0, 0]);
const DRIFTED = norm([0.2, 1, 0, 0]);

async function setup(state, out = {}) {
  const reg = new VectorStoreRegistry();
  const s = reg.get('mac');
  await s.clear();
  if (state !== 'absent') await s.writeManifest(manifest('mac', ANCHOR));
  await s.putVector('q-1', norm([1, 0, 0, 0]));
  await s.putVector('q-2', norm([0, 1, 0, 0]));
  const engine = state === 'stale' ? mkEngine('mac', DRIFTED) : mkEngine('mac', ANCHOR);
  const binding = new EngineBinding(reg);
  await binding.switchTo('mac', { engine });
  out.engine = engine;
  out.binding = binding;
  return new SemanticRouter(binding);
}

const fakeBinding = (state) => ({
  active: {
    generation: 1,
    engineId: 'mac',
    engine: mkEngine('mac', ANCHOR),
    store: null,
    manifest: { ...manifest('mac', ANCHOR), itemCount: 91 },
    index: { size: 1, bytes: 0, get: () => null, rank: () => [{ id: 'q-1', score: 1 }] },
    state,
  },
});

const readyActive = (over = {}) => ({
  generation: 1,
  engineId: 'mac',
  engine: mkEngine('mac', ANCHOR),
  store: null,
  manifest: { ...manifest('mac', ANCHOR), itemCount: 91 },
  index: { size: 1, bytes: 0, get: () => ANCHOR, rank: () => [{ id: 'q-1', score: 1 }] },
  state: 'ready',
  ...over,
});

const encodeBoomBinding = () => ({
  active: readyActive({
    engine: {
      id: 'mac', fingerprint: 'fp-mac', modalities: ['text'],
      probe: async () => ({ ok: true, fingerprint: 'fp-mac' }),
      encode: async () => { throw new Error('引擎进程已退出'); },
    },
  }),
});

const switchingBinding = () => {
  const binding = { active: readyActive() };
  binding.active.engine = {
    id: 'mac', fingerprint: 'fp-mac', modalities: ['text'],
    probe: async () => ({ ok: true, fingerprint: 'fp-mac' }),
    encode: async () => {
      binding.active = { ...binding.active, generation: 2 };
      return ANCHOR;
    },
  };
  return binding;
};

const rankBoomBinding = () => ({
  active: readyActive({
    index: { size: 1, bytes: 0, get: () => ANCHOR, rank: () => { throw new Error('索引已释放'); } },
  }),
});

async function realSwitchFailure() {
  const reg = new VectorStoreRegistry();
  const mac = reg.get('mac');
  await mac.clear();
  await mac.writeManifest(manifest('mac', ANCHOR));
  await mac.putVector('q-1', norm([1, 0, 0, 0]));
  const binding = new EngineBinding(reg);
  await binding.switchTo('mac', { engine: mkEngine('mac', ANCHOR) });
  expect(binding.active.state).toBe('ready');

  const linux = reg.get('linux');
  await linux.clear();
  linux.loadManifest = async () => { throw new Error('IndexedDB 不可用'); };

  const r = new SemanticRouter(binding);
  const out = await r.switchTo('linux', { engine: mkEngine('linux', ANCHOR) });
  return { binding, r, out };
}

beforeEach(() => { installFakeLocalforage(); });

describe('Router L0 闸门', () => {
  it('ready → 返回真实排序结果，degraded 为 null', async () => {
    const r = await setup('ready');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded).toBeNull();
    expect(res.hits[0].id).toBe('q-1');
    expect(res.hits[0].score).toBeCloseTo(1, 5);
    expect(res.engineId).toBe('mac');
  });

  it('absent → degraded=store-absent，带可读的建库提示，且不返回 hits', async () => {
    const r = await setup('absent');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-absent');
    expect(res.degraded.detail).toMatch(/建库/);
    expect(res.hits).toEqual([]);
  });

  it('stale → degraded=store-stale，且不返回 hits', async () => {
    const r = await setup('stale');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-stale');
    expect(res.hits).toEqual([]);
  });

  it('模态不支持 → degraded=no-engine', async () => {
    const r = await setup('ready');
    const res = await r.search({ query: { kind: 'image', dataUrl: 'data:image/png;base64,AA==' } });
    expect(res.degraded.reason).toBe('no-engine');
  });

  it('searchSimilar 在 ready 下返回其它题，且不调用 encode', async () => {
    const out = {};
    const r = await setup('ready', out);
    const before = out.engine.encodeCalls;
    const res = await r.searchSimilar('q-1');
    expect(res.degraded).toBeNull();
    expect(res.hits.map((h) => h.id)).toEqual(['q-2']);
    expect(out.engine.encodeCalls).toBe(before);
  });

  it('searchSimilar 对库中不存在的题返回 degraded', async () => {
    const r = await setup('ready');
    const res = await r.searchSimilar('nope');
    expect(res.degraded.reason).toBe('store-absent');
  });
});

describe("Router 处理 'building'（正在建库）态", () => {
  it("building → degraded=store-absent + 可读建库提示，绝不静默当成 ready", async () => {
    const r = new SemanticRouter(fakeBinding('building'));
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-absent');
    expect(res.degraded.detail).toMatch(/建库/);
    expect(res.degraded.detail).toMatch(/4 分钟/);
    expect(res.hits).toEqual([]);
  });

  it("building 下 searchSimilar 返回 store-absent（不是 stale、也不返回 hits）", async () => {
    const r = new SemanticRouter(fakeBinding('building'));
    const res = await r.searchSimilar('q-1');
    expect(res.degraded.reason).toBe('store-absent');
    expect(res.hits).toEqual([]);
  });
});

describe('Router 的 corrupt 语义对齐（search 与 searchSimilar 一致）', () => {
  it('corrupt → search 与 searchSimilar 都报 store-corrupt，不折成 store-absent', async () => {
    const r = new SemanticRouter(fakeBinding('corrupt'));
    const s1 = await r.search({ query: { kind: 'text', text: '面积' } });
    const s2 = await r.searchSimilar('q-1');
    expect(s1.degraded.reason).toBe('store-corrupt');
    expect(s2.degraded.reason).toBe('store-corrupt');
    expect(s1.hits).toEqual([]);
    expect(s2.hits).toEqual([]);
  });
});

describe('引擎切换兜底（switchTo 失败落成状态，不 reject）', () => {
  it('switchTo 成功 → ok=true、state=ready、degraded 为 null，随后可搜', async () => {
    const reg = new VectorStoreRegistry();
    const s = reg.get('mac');
    await s.clear();
    await s.writeManifest(manifest('mac', ANCHOR));
    await s.putVector('q-1', norm([1, 0, 0, 0]));
    const r = new SemanticRouter(new EngineBinding(reg));
    const out = await r.switchTo('mac', { engine: mkEngine('mac', ANCHOR) });
    expect(out.ok).toBe(true);
    expect(out.state).toBe('ready');
    expect(out.degraded).toBeNull();
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.hits.map((h) => h.id)).toEqual(['q-1']);
  });

  it('switchTo 内 loadManifest 抛错 → 不 reject、落成 absent，且 active 已指向新引擎', async () => {
    const reg = new VectorStoreRegistry();
    const mac = reg.get('mac');
    await mac.clear();
    await mac.writeManifest(manifest('mac', ANCHOR));
    await mac.putVector('q-1', norm([1, 0, 0, 0]));
    const binding = new EngineBinding(reg);
    await binding.switchTo('mac', { engine: mkEngine('mac', ANCHOR) });
    expect(binding.active.state).toBe('ready');
    expect(binding.active.engineId).toBe('mac');

    const linux = reg.get('linux');
    await linux.clear();
    linux.loadManifest = async () => { throw new Error('IndexedDB 不可用'); };

    const r = new SemanticRouter(binding);
    const out = await r.switchTo('linux', { engine: mkEngine('linux', ANCHOR) });

    expect(out.state).toBe('absent');
    expect(binding.active.state).toBe('absent');
    expect(binding.active.engineId).toBe('linux');
    expect(binding.active.index).toBeNull();
    expect(binding.active.manifest).toBeNull();
    expect(binding.active.switchError).toBe('IndexedDB 不可用');
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('switch-failed');
    expect(res.hits).toEqual([]);
  });

  it('switchTo 内 encode 抛错（自洽校验）→ 不 reject、落成 absent，异常不穿透', async () => {
    const reg = new VectorStoreRegistry();
    const s = reg.get('mac');
    await s.clear();
    await s.writeManifest(manifest('mac', ANCHOR));
    const binding = new EngineBinding(reg);
    const boom = {
      id: 'mac', fingerprint: 'fp-mac', modalities: ['text'],
      probe: async () => ({ ok: true, fingerprint: 'fp-mac' }),
      encode: async () => { throw new Error('引擎进程已退出'); },
    };
    const r = new SemanticRouter(binding);
    const out = await r.switchTo('mac', { engine: boom });
    expect(out.ok).toBe(true);
    expect(out.state).toBe('absent');
    expect(out.degraded).toBeNull();
    expect(binding.active.state).toBe('absent');
    expect(binding.active.engineId).toBe('mac');
    expect(binding.active.switchError).toBe('引擎进程已退出');
  });

  it('binding.switchTo 仍 reject → Router 兜住不穿透，degraded.reason=switch-failed', async () => {
    const rejecting = {
      active: null,
      switchTo: async () => { throw new Error('绑定器崩了'); },
    };
    const r = new SemanticRouter(rejecting);
    const out = await r.switchTo('mac', { engine: mkEngine('mac', ANCHOR) });
    expect(out.ok).toBe(false);
    expect(out.degraded.reason).toBe('switch-failed');
    expect(out.degraded.detail).toMatch(/绑定器崩了/);
  });
});

describe('切换失败 vs 库从未建过（必须可区分）', () => {
  it('切换失败（有 switchError）→ search 报 switch-failed，detail 绝不是建库文案', async () => {
    const { binding, r, out } = await realSwitchFailure();
    expect(out.ok).toBe(true);
    expect(binding.active.switchError).toBe('IndexedDB 不可用');

    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('switch-failed');
    expect(res.degraded.detail).not.toMatch(/建库/);
    expect(res.degraded.detail).toMatch(/IndexedDB 不可用/);
    expect(res.hits).toEqual([]);
  });

  it('引擎不可达（probe 返回 ok:false）→ search 报 switch-failed，detail 绝不声称正在建库', async () => {
    const reg = new VectorStoreRegistry();
    const s = reg.get('mac');
    await s.clear();
    await s.writeManifest(manifest('mac', ANCHOR));
    await s.putVector('q-1', norm([1, 0, 0, 0]));
    const binding = new EngineBinding(reg);
    const down = {
      id: 'mac', fingerprint: 'fp-mac', modalities: ['text'],
      probe: async () => ({ ok: false, fingerprint: '' }),
      encode: async () => ANCHOR,
    };
    await binding.switchTo('mac', { engine: down });
    expect(binding.active.state).toBe('absent');

    const r = new SemanticRouter(binding);
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('switch-failed');
    expect(res.degraded.detail).not.toMatch(/建库/);
    expect(res.degraded.detail).toMatch(/不可达/);
    expect(res.hits).toEqual([]);
  });

  it('库从未建过（无 switchError）→ search 报 store-absent + 建库文案', async () => {
    const out = {};
    const r = await setup('absent', out);
    expect(out.binding.active.switchError).toBeUndefined();

    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-absent');
    expect(res.degraded.detail).toMatch(/建库/);
    expect(res.degraded.detail).toMatch(/分钟/);
    expect(res.hits).toEqual([]);
  });
});

describe('Router 未覆盖分支补齐', () => {
  it('无 binding（active 为 null）→ degraded=no-engine', async () => {
    const r = new SemanticRouter({ active: null });
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('no-engine');
    expect(res.hits).toEqual([]);
  });

  it('encode 抛错 → degraded=encode-failed，异常不穿透', async () => {
    const r = new SemanticRouter(encodeBoomBinding());
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('encode-failed');
    expect(res.hits).toEqual([]);
  });

  it('encode 期间引擎被切换（generation 不符）→ degraded=switch-failed，且不回退旧库', async () => {
    const binding = switchingBinding();
    const r = new SemanticRouter(binding);
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(binding.active.generation).toBe(2);
    expect(res.degraded.reason).toBe('switch-failed');
    expect(res.hits).toEqual([]);
  });

  it('search 的 rank 抛错 → 不 reject，返回 degraded', async () => {
    const r = new SemanticRouter(rankBoomBinding());
    const res = await r.search({ query: { kind: 'text', text: '面积' } });
    expect(res.degraded.reason).toBe('store-corrupt');
    expect(res.degraded.detail).toMatch(/检索失败/);
    expect(res.hits).toEqual([]);
  });

  it('searchSimilar 的 rank 抛错 → 不 reject，返回 degraded', async () => {
    const r = new SemanticRouter(rankBoomBinding());
    const res = await r.searchSimilar('q-1');
    expect(res.degraded.reason).toBe('store-corrupt');
    expect(res.hits).toEqual([]);
  });
});

describe('建库时长估算（内联提示用）', () => {
  it('按实测 227s/91 题折算', () => {
    expect(estimateBuildMinutes(91)).toBe(4);
    expect(estimateBuildMinutes(0)).toBe(0);
  });
});

describe('模块解析（semantic.ts vs semantic/）', () => {
  it('services 门面导出的是新模块，不是旧的 semantic.ts', async () => {
    const svc = await import('../src/services/index.ts');
    expect(typeof svc.SemanticService).toBe('function');
    expect(svc.SemanticService.name).toBe('SemanticRouter');
  });
});
