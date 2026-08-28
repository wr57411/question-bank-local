/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FeedbackMetadata, IssueSubmitResult, QueuedFeedback } from '../types/issue-feedback';
import { enqueueFeedback, listFeedbackQueue, removeFeedbackFromQueue, updateFeedbackAttempt } from '../data/issue-queue';
import { dataURLtoBlob } from './image';
import { APP_VERSION_CODE, APP_VERSION_NAME } from './app-update';

export function buildFeedbackMetadata(page: string): FeedbackMetadata {
  const cap = (window as any).Capacitor;
  const platform = cap && cap.getPlatform ? cap.getPlatform() : 'web';
  return {
    platform,
    ua: navigator.userAgent.slice(0, 200),
    version_code: APP_VERSION_CODE,
    version_name: APP_VERSION_NAME,
    page,
    client_time: new Date().toISOString(),
  };
}

export function normalizeFeedbackTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, ' ');
  return t.length > 120 ? t.slice(0, 117) + '...' : t;
}

function getServerInfo(): { serverUrl: string; apiToken: string } {
  return {
    serverUrl: (localStorage.getItem('serverUrl') || '').replace(/\/+$/, ''),
    apiToken: localStorage.getItem('apiToken') || '',
  };
}

export interface FeedbackInput {
  title: string;
  description: string;
  screenshot: string | null;
  page: string;
  metadata?: FeedbackMetadata;
}

export async function submitFeedback(input: FeedbackInput): Promise<IssueSubmitResult> {
  const { serverUrl, apiToken } = getServerInfo();
  if (!serverUrl || !apiToken) throw new Error('请先登录同步账号，再提交反馈');
  const fd = new FormData();
  fd.append('title', normalizeFeedbackTitle(input.title));
  fd.append('description', input.description.trim().slice(0, 4000));
  fd.append('metadata', JSON.stringify(input.metadata ?? buildFeedbackMetadata(input.page)));
  if (input.screenshot) fd.append('screenshot', dataURLtoBlob(input.screenshot), 'screenshot.jpg');
  const resp = await fetch(serverUrl + '/api/issues', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiToken },
    body: fd,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || '提交失败 (' + resp.status + ')') as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return data as IssueSubmitResult;
}

export async function queueFeedback(input: FeedbackInput, lastError: string): Promise<string> {
  return enqueueFeedback({
    title: normalizeFeedbackTitle(input.title),
    description: input.description.trim().slice(0, 4000),
    metadata: buildFeedbackMetadata(input.page),
    screenshot: input.screenshot,
    last_error: (lastError || '').slice(0, 500),
  });
}

const MAX_ATTEMPTS = 5;
let flushing = false;

export async function flushFeedbackQueue(): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: (await listFeedbackQueue()).length };
  flushing = true;
  try {
    const items = await listFeedbackQueue();
    let flushed = 0;
    for (const item of items) {
      try {
        await submitFeedback({
          title: item.title,
          description: item.description,
          screenshot: item.screenshot,
          page: item.metadata?.page || '',
          metadata: item.metadata ?? undefined,
        });
        await removeFeedbackFromQueue(item.id);
        flushed += 1;
      } catch (e: any) {
        const status = typeof e.status === 'number' ? e.status : 0;
        const permanent = status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
        const nextAttempts = item.attempts + 1;
        if (permanent || nextAttempts >= MAX_ATTEMPTS) {
          await removeFeedbackFromQueue(item.id);
          continue;
        }
        await updateFeedbackAttempt(item.id, e.message || String(e));
        break;
      }
    }
    const remaining = (await listFeedbackQueue()).length;
    return { flushed, remaining };
  } finally {
    flushing = false;
  }
}
