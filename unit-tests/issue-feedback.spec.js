import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dbFeedbackQueue, enqueueFeedback, listFeedbackQueue } from '../src/data/issue-queue';
import { normalizeFeedbackTitle, flushFeedbackQueue } from '../src/services/issue-feedback';

describe('normalizeFeedbackTitle', () => {
  it('去除首尾空格并压缩连续空白', () => {
    expect(normalizeFeedbackTitle('  提交   失败   bug ')).toBe('提交 失败 bug');
  });
  it('超过 120 字符截断并加省略号', () => {
    const long = 'a'.repeat(130);
    const out = normalizeFeedbackTitle(long);
    expect(out.length).toBe(120);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('反馈离线队列', () => {
  beforeEach(async () => {
    localStorage.setItem('serverUrl', 'http://127.0.0.1:9999');
    localStorage.setItem('apiToken', 'test-token');
    await dbFeedbackQueue.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('enqueue 后可列出记录，attempts 初始为 0', async () => {
    await enqueueFeedback({ title: '标题', description: '描述', metadata: null, screenshot: null, last_error: '' });
    const items = await listFeedbackQueue();
    expect(items).toHaveLength(1);
    expect(items[0].attempts).toBe(0);
    expect(items[0].title).toBe('标题');
  });

  it('flush 成功后清空队列并 POST /api/issues', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '离线反馈', description: '', metadata: null, screenshot: null, last_error: '' });
    const result = await flushFeedbackQueue();
    expect(result.flushed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/issues');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('flush 失败时保留记录且 attempts 自增', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'GitHub 提交失败' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '会失败', description: '', metadata: null, screenshot: null, last_error: '' });
    const result = await flushFeedbackQueue();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(1);
    const items = await listFeedbackQueue();
    expect(items[0].attempts).toBe(1);
    expect(items[0].last_error).toContain('GitHub 提交失败');
  });

  it('flush 重放时保留入队时的 metadata（含 client_time）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const metadata = { platform: 'android', ua: 'UA', version_code: 2, version_name: '1.1', page: '添加', client_time: '2026-08-27T00:00:00.000Z' };
    await enqueueFeedback({ title: '带元数据', description: '', metadata, screenshot: null, last_error: '' });
    await flushFeedbackQueue();
    const fd = fetchMock.mock.calls[0][1].body;
    expect(JSON.parse(fd.get('metadata'))).toEqual(metadata);
  });

  it('永久性 4xx 失败丢弃该条并继续处理后续', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: '校验失败' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '永久失败', description: '', metadata: null, screenshot: null, last_error: '' });
    await enqueueFeedback({ title: '应成功', description: '', metadata: null, screenshot: null, last_error: '' });
    const result = await flushFeedbackQueue();
    expect(result.flushed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('瞬时失败达到重试上限后丢弃', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: '服务器错误' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '一直失败', description: '', metadata: null, screenshot: null, last_error: '' });
    for (let i = 0; i < 5; i++) await flushFeedbackQueue();
    const items = await listFeedbackQueue();
    expect(items).toHaveLength(0);
  });

  it('限流 429 视为瞬时失败，不丢弃', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: '请求过于频繁' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '被限流', description: '', metadata: null, screenshot: null, last_error: '' });
    const result = await flushFeedbackQueue();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(1);
    const items = await listFeedbackQueue();
    expect(items[0].attempts).toBe(1);
  });

  it('并发 flush 只提交一次', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    await enqueueFeedback({ title: '并发', description: '', metadata: null, screenshot: null, last_error: '' });
    await Promise.all([flushFeedbackQueue(), flushFeedbackQueue()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
