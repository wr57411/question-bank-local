import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { storeNameFor } from '../src/services/semantic/vector-store.ts';
import { VectorStoreRegistry } from '../src/services/semantic/registry.ts';
import { estimateStorage, ensurePersistent, STORAGE_WARN_RATIO } from '../src/services/semantic/storage.ts';

const mkManifest = (over = {}) => ({
  engineId: 'mac', engineFingerprint: 'fp-1',
  spaceKey: 'wemm-embedding-2b:bf16:2048:l2:text+image',
  dim: 2048, normalize: 'l2', itemCount: 91, sourceHash: 'h1',
  probeText: '计算三角形的面积', probeVector: [0.1, 0.2],
  builtAt: '2026-09-22T00:00:00Z', builtBy: 'mac@1',
  ...over,
});

beforeEach(() => { installFakeLocalforage(); });

describe('物理隔离', () => {
  it('不同引擎映射到不同 store 名', () => {
    expect(storeNameFor('mac')).toBe('embeddings__mac');
    expect(storeNameFor('linux')).not.toBe(storeNameFor('mac'));
  });

  it('一个引擎写入的向量在另一个引擎的库里读不到', async () => {
    const r = new VectorStoreRegistry();
    await r.get('mac').putVector('q1', new Float32Array([1, 2, 3]));
    expect(await r.get('mac').count()).toBe(1);
    expect(await r.get('linux').count()).toBe(0);
    expect(await r.get('linux').getVector('q1')).toBeNull();
  });

  it('putVector/getVector 往返保持浮点值', async () => {
    const r = new VectorStoreRegistry();
    const s = r.get('mac');
    await s.putVector('q1', new Float32Array([0.5, -1.25, 3]));
    expect(Array.from(await s.getVector('q1'))).toEqual([0.5, -1.25, 3]);
    expect(await s.getVector('missing')).toBeNull();
  });

  it('iterate 以 (id, v) 顺序回调，且跳过 manifest 条目', async () => {
    const r = new VectorStoreRegistry();
    const s = r.get('mac');
    await s.putVector('q1', new Float32Array([1, 2]));
    await s.writeManifest(mkManifest());
    const seen = [];
    await s.iterate((id, v) => seen.push([id, Array.from(v)]));
    expect(seen).toEqual([['q1', [1, 2]]]);
    expect(await s.count()).toBe(1);
  });

  it('writeManifest 写入的内容可被 loadManifest 读回', async () => {
    const r = new VectorStoreRegistry();
    const s = r.get('mac');
    await s.writeManifest(mkManifest());
    expect((await s.loadManifest()).itemCount).toBe(91);
  });
});

describe('VectorStoreRegistry', () => {
  it('每个引擎拿到自己的 store 实例', () => {
    const r = new VectorStoreRegistry();
    expect(r.get('mac').engineId).toBe('mac');
    expect(r.get('linux').engineId).toBe('linux');
    expect(r.get('mac')).toBe(r.get('mac'));
  });

  it('默认不淘汰：get 过的引擎都留在 list 中', () => {
    const r = new VectorStoreRegistry();
    r.get('mac'); r.get('linux'); r.get('win');
    expect(r.list().sort()).toEqual(['linux', 'mac', 'win']);
  });

  it('remove 是显式操作，只删指定引擎的库', async () => {
    const r = new VectorStoreRegistry();
    r.get('mac'); r.get('linux');
    expect(await r.remove('linux')).toBe(true);
    expect(r.list()).toEqual(['mac']);
  });

  it('remove 只清空目标引擎的数据，其它引擎的库不受影响', async () => {
    const r = new VectorStoreRegistry();
    await r.get('mac').putVector('q1', new Float32Array([1]));
    await r.get('linux').putVector('q1', new Float32Array([2]));
    await r.remove('mac');
    expect(await r.get('mac').count()).toBe(0);
    expect(await r.get('linux').count()).toBe(1);
  });

  it('remove 不存在的引擎返回 false，不抛异常', async () => {
    const r = new VectorStoreRegistry();
    expect(await r.remove('nope')).toBe(false);
  });
});

describe('容量观测（不做自制 LRU）', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 400 * 1024 * 1024, quota: 1000 * 1024 * 1024 }),
        persist: async () => true,
        persisted: async () => false,
      },
    });
  });

  it('estimateStorage 返回 usage/quota/ratio', async () => {
    const s = await estimateStorage();
    expect(s.usage).toBe(419430400);
    expect(s.quota).toBe(1048576000);
    expect(s.ratio).toBeCloseTo(0.4, 5);
  });

  it('navigator.storage 缺失时返回零值而非抛异常', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    const s = await estimateStorage();
    expect(s).toEqual({ usage: 0, quota: 0, ratio: 0 });
  });

  it('quota 为 0 时 ratio 回退为 0，不做除零', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 10, quota: 0 }), persist: async () => true, persisted: async () => false },
    });
    expect(await estimateStorage()).toEqual({ usage: 10, quota: 0, ratio: 0 });
  });

  it('ensurePersistent 在未持久化时申请 persist', async () => {
    expect(await ensurePersistent()).toBe(true);
  });

  it('ensurePersistent 已持久化时不再申请 persist', async () => {
    let persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 0, quota: 0 }),
        persisted: async () => true,
        persist: async () => { persistCalls++; return true; },
      },
    });
    expect(await ensurePersistent()).toBe(true);
    expect(persistCalls).toBe(0);
  });

  it('告警阈值为 0.8', () => {
    expect(STORAGE_WARN_RATIO).toBe(0.8);
  });
});
