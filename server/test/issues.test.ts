import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

const BASE_SHA = 'basec0ffee00000000000000000000000000000001';
const TREE_SHA = 'treefedcba00000000000000000000000000000002';
const COMMIT_SHA = 'c0mmit123000000000000000000000000000000003';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMElEQVR4nO3NAQ0AAAgDINc/9K3hHFQgCimTmZmZmZmZmZmZmZmZmZmZ2Qe0EwEs1rR0XQAAAABJRU5ErkJggg==';

type GhCall = { url: string; method: string; body: any };
let ghCalls: GhCall[] = [];

function jsonResponse(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function uniquePhone() {
  return '139' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
}

function setupFetchMock() {
  const stub = vi.fn(async (url: string, init: any = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    ghCalls.push({ url, method, body });
    if (url.endsWith('/git/ref/heads/feedback-assets') && method === 'GET') {
      return jsonResponse({ object: { sha: BASE_SHA } });
    }
    if (url.endsWith('/git/blobs') && method === 'POST') return jsonResponse({ sha: 'blobsha1' });
    if (url.endsWith('/git/commits/' + BASE_SHA) && method === 'GET') return jsonResponse({ tree: { sha: 'treeBaseSha' } });
    if (url.endsWith('/git/trees') && method === 'POST') return jsonResponse({ sha: TREE_SHA });
    if (url.endsWith('/git/commits') && method === 'POST') return jsonResponse({ sha: COMMIT_SHA });
    if (url.endsWith('/git/refs/heads/feedback-assets') && method === 'PATCH') {
      return jsonResponse({ object: { sha: COMMIT_SHA } });
    }
    if (url.endsWith('/issues') && method === 'POST') {
      return jsonResponse({ number: 7, html_url: 'https://github.com/me/question-bank-app/issues/7' });
    }
    return jsonResponse({ message: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', stub);
}

describe('POST /api/issues', () => {
  beforeEach(() => {
    ghCalls = [];
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPO = 'me/question-bank-app';
    setupFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;
  });

  it('未登录返回 401', async () => {
    const res = await request(app).post('/api/issues');
    expect(res.status).toBe(401);
  });

  it('服务端未配置 GitHub 时返回 503', async () => {
    delete process.env.GITHUB_TOKEN;
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app).post('/api/issues').set(authHeaders(token)).field('title', 'x');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('GITHUB_TOKEN');
  });

  it('缺标题返回 400', async () => {
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app).post('/api/issues').set(authHeaders(token));
    expect(res.status).toBe(400);
  });

  it('带截图成功提交：先写 blob/tree/commit/branch，再创建 Issue，正文含图片链接与元数据', async () => {
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app)
      .post('/api/issues')
      .set(authHeaders(token))
      .field('title', '打不开拍照')
      .field('description', '点拍照按钮没反应')
      .field('metadata', JSON.stringify({ platform: 'android', version_code: 2, version_name: '1.1', page: '添加', client_time: '2026-08-27T00:00:00Z', ua: 'UA' }))
      .attach('screenshot', Buffer.from(PNG_BASE64, 'base64'), { filename: 'shot.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.issue_number).toBe(7);
    expect(String(res.body.image_url)).toContain('raw.githubusercontent.com/me/question-bank-app/feedback-assets/screenshots/');
    const issueCall = ghCalls.find((c) => c.url.endsWith('/issues') && c.method === 'POST');
    expect(issueCall).toBeTruthy();
    expect(issueCall.body.title).toBe('[App反馈] 打不开拍照');
    expect(issueCall.body.body).toContain('![screenshot](https://raw.githubusercontent.com/me/question-bank-app/feedback-assets/screenshots/');
    expect(issueCall.body.body).toContain('| 平台 | android |');
    expect(issueCall.body.body).toContain('点拍照按钮没反应');
    expect(issueCall.body.labels).toContain('user-feedback');
    const blobCall = ghCalls.find((c) => c.url.endsWith('/git/blobs'));
    expect(blobCall.body.encoding).toBe('base64');
    const methods = ghCalls.map((c) => c.method);
    expect(methods.indexOf('POST') < methods.lastIndexOf('PATCH')).toBe(true);
  });

  it('无截图也可提交纯文字 Issue', async () => {
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app)
      .post('/api/issues')
      .set(authHeaders(token))
      .field('title', '纯文字反馈')
      .field('description', '没有截图');
    expect(res.status).toBe(200);
    const issueCall = ghCalls.find((c) => c.url.endsWith('/issues'));
    expect(issueCall.body.body).not.toContain('![screenshot]');
  });

  it('非图片附件返回 400', async () => {
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app)
      .post('/api/issues')
      .set(authHeaders(token))
      .field('title', '附件类型错误')
      .attach('screenshot', Buffer.from('not-an-image'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('仅支持图片');
  });

  it('超过 5MB 的截图返回 413', async () => {
    const token = await createTestUser(app, uniquePhone());
    const res = await request(app)
      .post('/api/issues')
      .set(authHeaders(token))
      .field('title', '截图太大')
      .attach('screenshot', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain('5MB');
  });

  it('GitHub 上传失败返回 502', async () => {
    const token = await createTestUser(app, uniquePhone());
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'boom' }, 500)));
    const res = await request(app)
      .post('/api/issues')
      .set(authHeaders(token))
      .field('title', '上传失败')
      .attach('screenshot', Buffer.from(PNG_BASE64, 'base64'), { filename: 's.png', contentType: 'image/png' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('GitHub 提交失败');
  });

  it('并发两个带截图请求都能成功（上传串行化）', async () => {
    const token = await createTestUser(app, uniquePhone());
    const mk = () =>
      request(app)
        .post('/api/issues')
        .set(authHeaders(token))
        .field('title', '并发反馈')
        .attach('screenshot', Buffer.from(PNG_BASE64, 'base64'), { filename: 'c.png', contentType: 'image/png' });
    const results = await Promise.all([mk(), mk()]);
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(200);
  });
});
