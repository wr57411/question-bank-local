import localforage from 'localforage';
import type { QueuedFeedback } from '../types/issue-feedback';

export const dbFeedbackQueue = localforage.createInstance({ name: 'questionBankFeedback', storeName: 'feedback_queue' });

function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const buf = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function enqueueFeedback(item: Omit<QueuedFeedback, 'id' | 'attempts' | 'created_at'>): Promise<string> {
  const id = createId();
  const record: QueuedFeedback = { ...item, id, attempts: 0, created_at: Date.now() };
  await dbFeedbackQueue.setItem(id, record);
  return id;
}

export async function listFeedbackQueue(): Promise<QueuedFeedback[]> {
  const out: QueuedFeedback[] = [];
  await dbFeedbackQueue.iterate((value: QueuedFeedback) => { if (value) out.push(value); });
  return out.sort((a, b) => a.created_at - b.created_at);
}

export async function removeFeedbackFromQueue(id: string): Promise<void> {
  await dbFeedbackQueue.removeItem(id);
}

export async function updateFeedbackAttempt(id: string, error: string): Promise<void> {
  const item = await dbFeedbackQueue.getItem<QueuedFeedback>(id);
  if (!item) return;
  item.attempts += 1;
  item.last_error = error.slice(0, 500);
  await dbFeedbackQueue.setItem(id, item);
}
