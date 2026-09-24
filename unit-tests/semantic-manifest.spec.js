import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeLocalforage } from './helpers/fake-localforage.js';
import { readManifest, beginBuild, commitBuild, PROBE_TEXT } from '../src/services/semantic/manifest.ts';

const mkManifest = (over = {}) => ({
  engineId: 'mac', engineFingerprint: 'fp-1',
  spaceKey: 'wemm-embedding-2b:bf16:2048:l2:text+image',
  dim: 2048, normalize: 'l2', itemCount: 91, sourceHash: 'h1',
  probeText: PROBE_TEXT, probeVector: [0.1, 0.2], builtAt: '2026-09-22T00:00:00Z', builtBy: 'mac@1',
  ...over,
});

describe('两阶段提交', () => {
  beforeEach(async () => {
    installFakeLocalforage();
    await beginBuild('embeddings__test');
  });

  it('beginBuild 后、commitBuild 前读不到 manifest（半库被识别为 absent）', async () => {
    expect(await readManifest('embeddings__test')).toBeNull();
  });

  it('commitBuild 后可读到完整 manifest', async () => {
    await commitBuild('embeddings__test', mkManifest());
    const m = await readManifest('embeddings__test');
    expect(m.engineId).toBe('mac');
    expect(m.probeVector).toEqual([0.1, 0.2]);
  });

  it('再次 beginBuild 会清掉旧 manifest', async () => {
    await commitBuild('embeddings__test', mkManifest());
    await beginBuild('embeddings__test');
    expect(await readManifest('embeddings__test')).toBeNull();
  });
});
