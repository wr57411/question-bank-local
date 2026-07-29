import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

describe('同步', () => {
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    tokenA = await createTestUser(app, `139${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
    tokenB = await createTestUser(app, `139${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
  });

  it('push 应该批量写入数据', async () => {
    const res = await request(app)
      .post('/api/sync/push')
      .set(authHeaders(tokenA))
      .send({
        tags: [
          { id: 'tag-001', name: '力学', color: '#ff0000' },
          { id: 'tag-002', name: '电学', color: '#00ff00' },
        ],
      });

    expect(res.status).toBe(200);

    const pullRes = await request(app)
      .get('/api/sync/pull?since=0')
      .set(authHeaders(tokenA));

    expect(pullRes.status).toBe(200);
    expect(pullRes.body.tags.length).toBeGreaterThanOrEqual(2);
  });

  it('pull 应该按时间戳过滤', async () => {
    await request(app)
      .post('/api/sync/push')
      .set(authHeaders(tokenA))
      .send({ tags: [{ id: 'tag-timeout', name: '热学' }] });

    const now = Date.now();
    const future = new Date(now + 60000).toISOString();

    const pullRes = await request(app)
      .get(`/api/sync/pull?since=${encodeURIComponent(future)}`)
      .set(authHeaders(tokenA));

    expect(pullRes.status).toBe(200);
    expect(pullRes.body.tags.length).toBe(0);
  });

  it('用户数据隔离：A 看不到 B 的数据', async () => {
    await request(app)
      .post('/api/sync/push')
      .set(authHeaders(tokenA))
      .send({ tags: [{ id: 'tag-private', name: 'A的私有标签' }] });

    const pullRes = await request(app)
      .get('/api/sync/pull?since=0')
      .set(authHeaders(tokenB));

    expect(pullRes.status).toBe(200);
    const hasPrivate = pullRes.body.tags.some((t: { id: string }) => t.id === 'tag-private');
    expect(hasPrivate).toBe(false);
  });
});
