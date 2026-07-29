import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

describe('题目 CRUD', () => {
  let token: string;

  beforeEach(async () => {
    token = await createTestUser(app, `138${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
  });

  it('应该创建题目', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({
        question_image_url: 'http://example.com/q1.png',
        answer_image_url: 'http://example.com/a1.png',
        layout_type: 'vertical',
        user_comment: '测试题目',
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });

  it('应该查询题目列表', async () => {
    await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({ question_image_url: 'http://example.com/q2.png' });

    const res = await request(app)
      .get('/api/questions')
      .set(authHeaders(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('应该更新题目', async () => {
    const createRes = await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({ user_comment: '原始评论' });

    const id = createRes.body.id;

    const updateRes = await request(app)
      .put(`/api/questions/${id}`)
      .set(authHeaders(token))
      .send({ user_comment: '修改后的评论' });

    expect(updateRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/questions')
      .set(authHeaders(token));

    const found = getRes.body.find((q: { id: string }) => q.id === id);
    expect(found.user_comment).toBe('修改后的评论');
  });

  it('应该软删除题目', async () => {
    const createRes = await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({});
    const id = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/questions/${id}`)
      .set(authHeaders(token));
    expect(delRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/questions')
      .set(authHeaders(token));
    const found = getRes.body.find((q: { id: string }) => q.id === id);
    expect(found).toBeUndefined();
  });

  it('应该恢复软删除的题目', async () => {
    const createRes = await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({});
    const id = createRes.body.id;

    await request(app).delete(`/api/questions/${id}`).set(authHeaders(token));
    await request(app).post(`/api/questions/${id}/restore`).set(authHeaders(token));

    const getRes = await request(app)
      .get('/api/questions')
      .set(authHeaders(token));
    const found = getRes.body.find((q: { id: string }) => q.id === id);
    expect(found).toBeTruthy();
  });

  it('应该永久删除题目', async () => {
    const createRes = await request(app)
      .post('/api/questions')
      .set(authHeaders(token))
      .send({});
    const id = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/questions/${id}/permanent`)
      .set(authHeaders(token));
    expect(delRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/questions?include_deleted=true')
      .set(authHeaders(token));
    const found = getRes.body.find((q: { id: string }) => q.id === id);
    expect(found).toBeUndefined();
  });
});
