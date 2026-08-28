import type { Question } from '../types';

const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];

export function getNextReviewInterval(currentIndex: number): number {
  return REVIEW_INTERVALS[Math.min(currentIndex + 1, REVIEW_INTERVALS.length - 1)];
}

export function calculateNextReviewDate(intervalDays: number): string {
  const next = new Date();
  next.setDate(next.getDate() + intervalDays);
  return next.toISOString();
}

export function isReviewDue(question: Question): boolean {
  if (!question.review_enabled) return false;
  if (!question.next_review_at) return true;
  return new Date(question.next_review_at) <= new Date();
}

export function formatReviewInfo(question: Question): { count: number; nextDays: number } {
  const q = question as unknown as Record<string, unknown>;
  const intervalIdx = (q.review_interval_index as number) || 0;
  const count = (q.review_count as number) || 0;
  const nextDays = getNextReviewInterval(intervalIdx);
  return { count, nextDays };
}
