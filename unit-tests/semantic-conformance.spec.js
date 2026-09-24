import { describe, it, expect } from 'vitest';
import { checkSelfConsistency, CONFORMANCE_THRESHOLD } from '../src/services/semantic/conformance.ts';

const v = (n, seed = 0) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (i + seed) % 7 + 1; return a; };
const norm = (a) => { const s = Math.sqrt(a.reduce((x, y) => x + y * y, 0)); return Float32Array.from(a, (x) => x / s); };

const engine = (vec) => ({ id: 'mac', fingerprint: 'fp', modalities: ['text'], probe: async () => ({ ok: true, fingerprint: 'fp' }), encode: async () => vec });

const manifest = (vec) => ({ engineId: 'mac', engineFingerprint: 'fp', spaceKey: 'k', dim: vec.length, normalize: 'l2', itemCount: 1, sourceHash: 'h', probeText: 'x', probeVector: Array.from(vec), builtAt: '', builtBy: '' });

describe('自洽校验', () => {
  it('引擎输出与库锚点一致 → ok', async () => {
    const p = norm(v(2048));
    const r = await checkSelfConsistency(engine(p), manifest(p));
    expect(r.ok).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('引擎输出按比例缩放 → 仍判 ok（余弦对尺度不变）', async () => {
    const p = norm(v(2048));
    const scaled = Float32Array.from(p, (x) => x * 7.5);
    const r = await checkSelfConsistency(engine(scaled), manifest(p));
    expect(r.ok).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('引擎已漂移（余弦 0.887）→ 判 drifted', async () => {
    const p = norm(v(2048));
    const drifted = norm(Float32Array.from(p, (x, i) => (i % 3 === 0 ? x * 0.2 : x)));
    const r = await checkSelfConsistency(engine(drifted), manifest(p));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('drifted');
  });

  it('维度不同 → 判 dim-mismatch，不静默截断', async () => {
    const r = await checkSelfConsistency(engine(norm(v(256))), manifest(norm(v(2048))));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dim-mismatch');
  });

  it('阈值常量为 0.99', () => {
    expect(CONFORMANCE_THRESHOLD).toBe(0.99);
  });
});
