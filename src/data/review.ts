import { dbQuestions } from './stores';
import { dbGetQuestionNotes, dbAddQuestionNote } from './notes';

const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];

export async function dbEnableReview(questionId: string): Promise<Record<string, unknown> | null> {
  const q = await dbQuestions.getItem<Record<string, unknown>>(questionId);
  if (!q) return null;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const updated = {
    ...q,
    review_enabled: true,
    review_next_date: tomorrow.toISOString().slice(0, 10),
    review_interval_index: 0,
    review_count: 0
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

export async function dbDisableReview(questionId: string): Promise<Record<string, unknown> | null> {
  const q = await dbQuestions.getItem<Record<string, unknown>>(questionId);
  if (!q) return null;
  const updated = {
    ...q,
    review_enabled: false,
    review_next_date: null,
    review_interval_index: 0,
    review_count: 0
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

export async function dbCompleteReview(questionId: string): Promise<Record<string, unknown> | null> {
  const q = await dbQuestions.getItem<Record<string, unknown>>(questionId);
  if (!q) return null;
  const idx = Math.min(((q.review_interval_index as number) || 0) + 1, EBBINGHAUS_INTERVALS.length - 1);
  const days = EBBINGHAUS_INTERVALS[idx];
  const next = new Date();
  next.setDate(next.getDate() + days);
  const updated = {
    ...q,
    review_next_date: next.toISOString().slice(0, 10),
    review_interval_index: idx,
    review_count: ((q.review_count as number) || 0) + 1
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

export async function dbGetPendingReviews(): Promise<Record<string, unknown>[]> {
  const today = new Date().toISOString().slice(0, 10);
  const result: Record<string, unknown>[] = [];
  await dbQuestions.iterate((q: Record<string, unknown>) => {
    if (q && q.review_enabled && q.review_next_date && (q.review_next_date as string) <= today && !q.deleted_at) {
      result.push(q);
    }
  });
  result.sort((a, b) => ((a.review_next_date as string) || '').localeCompare((b.review_next_date as string) || ''));
  return result;
}
