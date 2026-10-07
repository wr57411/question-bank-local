import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db/connection.js';
import {
  FALLBACK_ENGINE_ID,
  buildFingerprint,
  configuredEngineIds,
  filterVectorsByEngine,
  validateTexts,
} from '../src/routes/embed.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

describe('validateTexts', () => {
  it('接受 1-8 个 ≤200 字符字符串', () => {
    expect(validateTexts(['斜面摩擦'])).toEqual([]);
    expect(validateTexts(Array(8).fill('x'))).toEqual([]);
  });
  it('拒绝空数组/超量/超长/非字符串', () => {
    expect(validateTexts([])).toHaveLength(1);
    expect(validateTexts(Array(9).fill('x'))).toHaveLength(1);
    expect(validateTexts(['x'.repeat(201)])).toHaveLength(1);
    expect(validateTexts([42 as unknown as string])).toHaveLength(1);
  });
});

describe('filterVectorsByEngine', () => {
  it('只返回指定引擎的向量', () => {
    const rows = [
      { engine_id: 'mac', question_id: 'q-1', dim: 4, vector: Buffer.alloc(16) },
      { engine_id: 'linux', question_id: 'q-1', dim: 4, vector: Buffer.alloc(16) },
    ];
    const out = filterVectorsByEngine(rows, 'linux');
    expect(out).toHaveLength(1);
    expect(out[0].question_id).toBe('q-1');
  });
});

describe('buildFingerprint', () => {
  it('相同 health 产出相同指纹', () => {
    const h = { device: 'mps', model_loaded: true, model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).toBe(buildFingerprint({ ...h }));
  });

  it('device 变化则指纹变化', () => {
    const h = { device: 'mps', model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).not.toBe(buildFingerprint({ ...h, device: 'cuda' }));
  });

  it('dtype 变化则指纹变化', () => {
    const h = { device: 'mps', model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).not.toBe(buildFingerprint({ ...h, dtype: 'float32' }));
  });

  it('指纹里不再出现 quant 键', () => {
    const h = { device: 'mps', model_path: '/m/x', torch: '2.14.0', dtype: 'bfloat16' };
    expect(buildFingerprint(h)).not.toContain('quant=');
    expect(buildFingerprint({ ...h, quant: '8bit' })).toBe(buildFingerprint(h));
  });
});

describe('configuredEngineIds', () => {
  it('EMBED_SERVICE_URL__WINDOWS 归一化为 windows', () => {
    expect(configuredEngineIds({ EMBED_SERVICE_URL__WINDOWS: 'http://windows:3002' })).toEqual(['windows']);
  });

  it('EMBED_SERVICE_URL__MY_ENGINE_1 归一化为 my_engine_1', () => {
    expect(configuredEngineIds({ EMBED_SERVICE_URL__MY_ENGINE_1: 'http://x:3002' })).toEqual(['my_engine_1']);
  });

  it('裸 EMBED_SERVICE_URL 不产生具名引擎', () => {
    expect(configuredEngineIds({ EMBED_SERVICE_URL: 'http://127.0.0.1:3002' })).toEqual([]);
  });

  it('多引擎去重且保序', () => {
    expect(
      configuredEngineIds({
        EMBED_SERVICE_URL: 'http://127.0.0.1:3002',
        EMBED_SERVICE_URL__LINUX_CUDA: 'http://linux:3002',
        EMBED_SERVICE_URL__MY_ENGINE_1: 'http://my:3002',
      }),
    ).toEqual(['linux_cuda', 'my_engine_1']);
  });
});

describe('GET /api/embed/engines', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM question_embeddings').run();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('编码服务不可达');
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('不把迁移遗留的 legacy-default 列为引擎', async () => {
    const token = await createTestUser(app, `138${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
    const ins = db.prepare(
      'INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)',
    );
    ins.run('legacy-default', 'q-legacy', 'wemm-embedding-2b', 4, Buffer.alloc(16));
    ins.run('mac', 'q-1', 'wemm-embedding-2b', 4, Buffer.alloc(16));

    const res = await request(app).get('/api/embed/engines').set(authHeaders(token));
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain('mac');
    expect(ids).not.toContain('legacy-default');
  });
});

describe('引擎目录来自配置', () => {
  const envKey = 'EMBED_SERVICE_URL__MAC';
  let saved: string | undefined;

  beforeEach(() => {
    db.prepare('DELETE FROM question_embeddings').run();
    saved = process.env[envKey];
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('编码服务不可达');
    }));
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[envKey];
    else process.env[envKey] = saved;
    vi.unstubAllGlobals();
  });

  it('返回的 id 数组已去重', async () => {
    const token = await createTestUser(app, `136${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
    process.env[envKey] = 'http://127.0.0.1:9';
    db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)').run(
      'mac',
      'q-1',
      'wemm-embedding-2b',
      4,
      Buffer.alloc(16),
    );

    const res = await request(app).get('/api/embed/engines').set(authHeaders(token));
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain('mac');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('未建库的已配置引擎也出现在目录里', async () => {
    const token = await createTestUser(app, `135${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
    process.env[envKey] = 'http://127.0.0.1:9';

    const res = await request(app).get('/api/embed/engines').set(authHeaders(token));
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain('mac');
    expect(ids).not.toContain('legacy-default');
  });

  it('含 fallback 引擎', async () => {
    const token = await createTestUser(app, `134${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);

    const res = await request(app).get('/api/embed/engines').set(authHeaders(token));
    expect(res.status).toBe(200);
    expect((res.body as { id: string }[]).map((e) => e.id)).toContain(FALLBACK_ENGINE_ID);
  });
});

describe('GET /api/embed/vectors/meta', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM question_embeddings').run();
  });

  it('返回指定引擎的向量条数与最近更新时间', async () => {
    const token = await createTestUser(app, `133${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
    db.prepare(
      'INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?,?)',
    ).run('mac', 'q-1', 'wemm-embedding-2b', 4, Buffer.alloc(16), '2026-10-01 00:00:00');

    const res = await request(app).get('/api/embed/vectors/meta?engineId=mac').set(authHeaders(token));
    expect(res.status).toBe(200);
    expect(res.body.engineId).toBe('mac');
    expect(res.body.count).toBe(1);
    expect(res.body.latestUpdatedAt).toBe('2026-10-01 00:00:00');
  });

  it('缺 engineId 返回 400', async () => {
    const token = await createTestUser(app, `132${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);

    const res = await request(app).get('/api/embed/vectors/meta').set(authHeaders(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('缺少 engineId');
  });
});

interface StubService {
  url: string;
  hits: string[];
  health: Record<string, unknown>;
  close: () => Promise<void>;
}

async function startStubService(health: Record<string, unknown>, vector: number[]): Promise<StubService> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url || '');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify(health));
      return;
    }
    if (req.url === '/encode-text' || req.url === '/encode-images') {
      res.end(JSON.stringify({ dim: vector.length, vectors: [vector] }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    health,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('每引擎各自的编码服务地址', () => {
  let mac: StubService;
  let linux: StubService;
  let fallback: StubService;
  let token: string;
  const saved: Record<string, string | undefined> = {};
  const envKeys = ['EMBED_SERVICE_URL__MAC_MPS', 'EMBED_SERVICE_URL__LINUX_CUDA', 'EMBED_SERVICE_URL'];

  beforeEach(async () => {
    db.prepare('DELETE FROM question_embeddings').run();
    mac = await startStubService(
      { device: 'mps', model_path: '/models/mac', dtype: 'bfloat16', torch: '2.14.0', transformers: '4.0.0' },
      [1, 0, 0],
    );
    linux = await startStubService(
      { device: 'cuda', model_path: '/models/linux', dtype: 'float16', torch: '2.13.0', transformers: '4.0.0' },
      [0, 1, 0],
    );
    fallback = await startStubService(
      { device: 'cpu', model_path: '/models/default', dtype: 'float32', torch: '2.12.0', transformers: '4.0.0' },
      [0, 0, 1],
    );
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.EMBED_SERVICE_URL__MAC_MPS = mac.url;
    process.env.EMBED_SERVICE_URL__LINUX_CUDA = linux.url;
    process.env.EMBED_SERVICE_URL = fallback.url;
    token = await createTestUser(app, `139${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
  });

  afterEach(async () => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await Promise.all([mac.close(), linux.close(), fallback.close()]);
  });

  it('① /engines 为每个引擎各自探活、返回两个不同指纹', async () => {
    const ins = db.prepare(
      'INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)',
    );
    ins.run('mac-mps', 'q-mac', 'wemm-embedding-2b', 3, Buffer.alloc(12));
    ins.run('linux-cuda', 'q-linux', 'wemm-embedding-2b', 3, Buffer.alloc(12));

    const res = await request(app).get('/api/embed/engines').set(authHeaders(token));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.body as { id: string; fingerprint: string; reachable: boolean }[]).map((e) => [e.id, e]));
    expect(byId['mac-mps'].reachable).toBe(true);
    expect(byId['linux-cuda'].reachable).toBe(true);
    expect(byId['mac-mps'].fingerprint).toBe(buildFingerprint(mac.health));
    expect(byId['linux-cuda'].fingerprint).toBe(buildFingerprint(linux.health));
    expect(byId['mac-mps'].fingerprint).not.toBe(byId['linux-cuda'].fingerprint);
    expect(mac.hits).toContain('/health');
    expect(linux.hits).toContain('/health');
  });

  it('② /health?engineId=X 探 X 自己的服务', async () => {
    const res = await request(app).get('/api/embed/health?engineId=linux-cuda').set(authHeaders(token));
    expect(res.status).toBe(200);
    expect(res.body.engineId).toBe('linux-cuda');
    expect(res.body.fingerprint).toBe(buildFingerprint(linux.health));
    expect(linux.hits).toContain('/health');
    expect(mac.hits).not.toContain('/health');
    expect(fallback.hits).not.toContain('/health');
  });

  it('③ /text?engineId=X 转发到 X 自己的服务', async () => {
    const res = await request(app)
      .post('/api/embed/text?engineId=linux-cuda')
      .set(authHeaders(token))
      .send({ texts: ['斜面摩擦'] });
    expect(res.status).toBe(200);
    expect(res.body.vectors).toEqual([[0, 1, 0]]);
    expect(linux.hits).toContain('/encode-text');
    expect(mac.hits).not.toContain('/encode-text');
    expect(fallback.hits).not.toContain('/encode-text');
  });

  it('③b /image?engineId=X 转发到 X 自己的服务', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    const res = await request(app)
      .post('/api/embed/image?engineId=mac-mps')
      .set(authHeaders(token))
      .send({ image: dataUrl });
    expect(res.status).toBe(200);
    expect(res.body.vectors).toEqual([[1, 0, 0]]);
    expect(mac.hits).toContain('/encode-images');
    expect(linux.hits).not.toContain('/encode-images');
    expect(fallback.hits).not.toContain('/encode-images');
  });

  it('④ 缺 engineId 时回退到默认 EMBED_SERVICE_URL', async () => {
    const res = await request(app)
      .post('/api/embed/text')
      .set(authHeaders(token))
      .send({ texts: ['斜面摩擦'] });
    expect(res.status).toBe(200);
    expect(res.body.vectors).toEqual([[0, 0, 1]]);
    expect(fallback.hits).toContain('/encode-text');
    expect(mac.hits).not.toContain('/encode-text');
    expect(linux.hits).not.toContain('/encode-text');
  });
});
