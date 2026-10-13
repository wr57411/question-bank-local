import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body: unknown }> }));

vi.mock('../src/data/sync', () => ({
  remoteCall: vi.fn(async (path: string, method = 'GET', body: unknown = null) => {
    H.calls.push({ path, method, body });
    if (path.includes('/health')) return { fingerprint: 'fp-from-server', dtype: 'bfloat16' };
    return { dim: 3, vectors: [[1, 0, 0]] };
  }),
}));

import { HttpEngine } from '../src/services/semantic/engine-http';

describe('HttpEngine 请求携带自己的 engineId', () => {
  beforeEach(() => {
    H.calls.length = 0;
  });

  it('文本编码打到 /api/embed/text 且带自己的 engineId', async () => {
    const engine = new HttpEngine('linux-cuda', 'fp');
    await engine.encode({ kind: 'text', text: '斜面摩擦' });
    expect(H.calls).toHaveLength(1);
    expect(H.calls[0].method).toBe('POST');
    expect(H.calls[0].path).toBe('/api/embed/text?engineId=linux-cuda');
  });

  it('图像编码打到 /api/embed/image 且带自己的 engineId', async () => {
    const engine = new HttpEngine('mac-mps', 'fp');
    await engine.encode({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' });
    expect(H.calls[0].method).toBe('POST');
    expect(H.calls[0].path).toBe('/api/embed/image?engineId=mac-mps');
  });

  it('engineId 做 URL 转义', async () => {
    const engine = new HttpEngine('mac mps', 'fp');
    await engine.encode({ kind: 'text', text: 'x' });
    expect(H.calls[0].path).toBe('/api/embed/text?engineId=mac%20mps');
  });

  it('探活同样带自己的 engineId', async () => {
    const engine = new HttpEngine('linux-cuda', 'fp');
    await engine.health();
    expect(H.calls[0].path).toBe('/api/embed/health?engineId=linux-cuda');
  });
});
