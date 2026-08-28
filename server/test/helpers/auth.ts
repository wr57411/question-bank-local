import request from 'supertest';
import type { Server } from 'http';

export async function createTestUser(
  app: Server,
  phone = '13800000001',
  password = 'test123456',
  nickname = '测试用户'
): Promise<string> {
  const res = await request(app)
    .post('/api/register')
    .send({ phone, password, nickname });

  if (res.status !== 200) {
    throw new Error(`注册失败: ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export function authHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
