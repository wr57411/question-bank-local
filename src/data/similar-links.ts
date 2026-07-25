import { dbSimilarQuestionLinks, nowIso } from './stores';
import type { SimilarQuestionLink } from '../types';

function normalizeSimilarLinkPair(questionId: string, similarQuestionId: string): [string, string] | null {
  if (!questionId || !similarQuestionId || questionId === similarQuestionId) return null;
  return [questionId, similarQuestionId].sort() as [string, string];
}

function similarLinkKey(questionId: string, similarQuestionId: string): string | null {
  const pair = normalizeSimilarLinkPair(questionId, similarQuestionId);
  return pair ? pair[0] + '_' + pair[1] : null;
}

export async function dbGetAllSimilarLinks(): Promise<SimilarQuestionLink[]> {
  const result: SimilarQuestionLink[] = [];
  await dbSimilarQuestionLinks.iterate((v: unknown) => {
    const link = v as SimilarQuestionLink;
    if (link && !link.deleted_at) result.push(link);
  });
  return result;
}

export async function dbGetSimilarQuestionIds(questionId: string): Promise<string[]> {
  const ids: string[] = [];
  await dbSimilarQuestionLinks.iterate((v: unknown) => {
    const link = v as SimilarQuestionLink;
    if (!link || link.deleted_at) return;
    if (link.question_id === questionId) ids.push(link.similar_question_id);
    else if (link.similar_question_id === questionId) ids.push(link.question_id);
  });
  return ids;
}

export async function dbAddSimilarQuestionLinks(questionId: string, targetIds: string[]): Promise<void> {
  const now = nowIso();
  for (const targetId of targetIds) {
    const key = similarLinkKey(questionId, targetId);
    if (!key) continue;
    const pair = normalizeSimilarLinkPair(questionId, targetId)!;
    const existing = await dbSimilarQuestionLinks.getItem(key) as SimilarQuestionLink | null;
    if (existing && !existing.deleted_at) continue;
    const link: SimilarQuestionLink = {
      question_id: pair[0],
      similar_question_id: pair[1],
      created_at: existing?.created_at || now,
      updated_at: now,
      deleted_at: null,
    };
    await dbSimilarQuestionLinks.setItem(key, link);
  }
}

export async function dbRemoveSimilarQuestionLink(questionId: string, targetId: string): Promise<void> {
  const key = similarLinkKey(questionId, targetId);
  if (!key) return;
  const link = await dbSimilarQuestionLinks.getItem(key) as SimilarQuestionLink | null;
  if (!link) return;
  await dbSimilarQuestionLinks.setItem(key, { ...link, deleted_at: nowIso() });
}
