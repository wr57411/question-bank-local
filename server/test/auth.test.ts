import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

describe('认证', () => {
  describe('注册', () => {
    it('应该成功注册并返回 token', async () => {
      const res = await request(app)
        .post('/api/register')
        .send({ phone: '13800001001', password: 'pass123456', nickname: '用户A' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.id).toBeTruthy();
    });

    it('重复手机号应该返回错误', async () => {
      const phone = '13800001002';
      await request(app).post('/api/register').send({ phone, password: 'pass123456' });

      const res = await request(app)
        .post('/api/register')
        .send({ phone, password: 'pass123456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('手机号已注册');
    });

    it('缺少手机号或密码应该返回 400', async () => {
      const res = await request(app).post('/api/register').send({ phone: '13800001003' });
      expect(res.status).toBe(400);
    });
  });

  describe('登录', () => {
    it('正确凭据应该返回 token', async () => {
      const phone = '13800002001';
      const password = 'pass123456';
      await request(app).post('/api/register').send({ phone, password });

      const res = await request(app).post('/api/login').send({ phone, password });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.id).toBeTruthy();
    });

    it('错误密码应该返回 400', async () => {
      const phone = '13800002002';
      await request(app).post('/api/register').send({ phone, password: 'pass123456' });

      const res = await request(app).post('/api/login').send({ phone, password: 'wrong' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('密码错误');
    });

    it('不存在的用户应该返回 400', async () => {
      const res = await request(app)
        .post('/api/login')
        .send({ phone: '13800002999', password: 'pass123456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('用户不存在');
    });
  });

  describe('受保护路由', () => {
    it('无 token 访问应该返回 401', async () => {
      const res = await request(app).get('/api/questions');
      expect(res.status).toBe(401);
    });

    it('错误 token 应该返回 401', async () => {
      const res = await request(app)
        .get('/api/questions')
        .set(authHeaders('invalid-token'));
      expect(res.status).toBe(401);
    });

    it('有效 token 应该通过', async () => {
      const token = await createTestUser(app, '13800003001');
      const res = await request(app)
        .get('/api/questions')
        .set(authHeaders(token));
      expect(res.status).toBe(200);
    });
  });
});
