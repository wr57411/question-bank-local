import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { EngineBinding } from '../src/services/semantic/binding.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';

const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };
const vec = (seed) => norm(Float32Array.from({ length: 2048 }, (_, i) => ((i + seed) % 7) + 1));
const mkEngine = (id, v) => ({ id, fingerprint: `fp-${id}`, modalities: ['text'], probe: async () => ({ ok: true, fingerprint: `fp-${id}` }), encode: async () => v });

async function seedStore(registry, engineId, m) {
  const s = registry.get(engineId);
  await s.clear();
  await s.writeManifest(m);
}

const manifest = (engineId, v) => ({ engineId, engineFingerprint: `fp-${engineId}`, spaceKey: 'k', dim: v.length, normalize: 'l2', itemCount: 1, sourceHash: 'h', probeText: 'x', probeVector: Array.from(v), builtAt: '', builtBy: engineId });

beforeEach(() => { installFakeLocalforage(); });

describe('EngineBinding 原子切换', () => {
  it('库与引擎配对 → ready', async () => {
    const reg = new VectorStoreRegistry();
    const v = vec(0);
    await seedStore(reg, 'mac', manifest('mac', v));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', v) });
    expect(a.state).toBe('ready');
    expect(a.engineId).toBe('mac');
  });

  it('无 manifest → absent，不拿旧库凑合', async () => {
    const reg = new VectorStoreRegistry();
    await seedStore(reg, 'mac', manifest('mac', vec(0)));
    const b = new EngineBinding(reg);
    await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    const a = await b.switchTo('linux', { engine: mkEngine('linux', vec(1)) });
    expect(a.state).toBe('absent');
    expect(a.store).not.toBeNull();
    expect(a.manifest).toBeNull();
  });

  it('引擎漂移 → stale', async () => {
    const reg = new VectorStoreRegistry();
    const anchor = vec(0);
    await seedStore(reg, 'mac', manifest('mac', anchor));
    const drifted = norm(Float32Array.from(anchor, (x, i) => (i % 3 === 0 ? x * 0.2 : x)));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', drifted) });
    expect(a.state).toBe('stale');
  });

  it('每次切换 generation 自增', async () => {
    const reg = new VectorStoreRegistry();
    await seedStore(reg, 'mac', manifest('mac', vec(0)));
    const b = new EngineBinding(reg);
    const a1 = await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    const a2 = await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    expect(a2.generation).toBe(a1.generation + 1);
    expect(b.active.generation).toBe(a2.generation);
    expect(a1.generation).not.toBe(b.active.generation);
  });

  it('索引构建失败（库里有维度不符的向量）→ corrupt，异常不穿透', async () => {
    const reg = new VectorStoreRegistry();
    const anchor4 = norm(Float32Array.from([1, 2, 3, 4]));
    await seedStore(reg, 'mac', manifest('mac', anchor4));
    await reg.get('mac').putVector('bad', new Float32Array(8));
    const b = new EngineBinding(reg);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', anchor4) });
    expect(a.state).toBe('corrupt');
    expect(a.index).toBeNull();
    expect(a.manifest).not.toBeNull();
  });

  it('引擎不可达 → absent', async () => {
    const reg = new VectorStoreRegistry();
    const down = { id: 'linux', fingerprint: 'x', modalities: ['text'], probe: async () => ({ ok: false, fingerprint: '' }), encode: async () => vec(1) };
    const b = new EngineBinding(reg);
    const a = await b.switchTo('linux', { engine: down });
    expect(a.state).toBe('absent');
  });

  it('registry.get 抛错 → 不 reject，落成 absent 且带 switchError', async () => {
    const boom = { get() { throw new Error('localforage 不可用'); } };
    const b = new EngineBinding(boom);
    const a = await b.switchTo('mac', { engine: mkEngine('mac', vec(0)) });
    expect(a.state).toBe('absent');
    expect(a.switchError).toBe('localforage 不可用');
    expect(a.store).toBeNull();
    expect(b.active).toBe(a);
  });
});
