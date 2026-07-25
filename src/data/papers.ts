import { dbPapers, dbPaperQuestions, generateId, nowIso } from './stores';
import type { Paper, PaperQuestion } from '../types';

export async function dbGetAllPapers(): Promise<Paper[]> {
  const papers: Paper[] = [];
  await dbPapers.iterate((v: unknown, key: string) => {
    const p = v as Record<string, unknown>;
    if (!p) return;
    const paper: Paper = {
      id: (p.id as string) || key,
      name: (p.name as string) || (p.title as string) || '',
      created_at: (p.created_at as string) || (p.createdAt as string) || '',
      updated_at: (p.updated_at as string) || (p.updatedAt as string) || '',
      deleted_at: (p.deleted_at as string) || (p.deletedAt as string) || null,
    };
    if (!paper.deleted_at) papers.push(paper);
  });
  for (const paper of papers) {
    let count = 0;
    await dbPaperQuestions.iterate((pq: unknown) => {
      if ((pq as PaperQuestion).paper_id === paper.id) count++;
    });
    (paper as unknown as Record<string, unknown>).question_count = count;
  }
  return papers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function dbCreatePaper(name: string, selectedTagIds: string[]): Promise<Paper> {
  const id = generateId();
  const now = nowIso();
  const paper: Paper = { id, name, created_at: now, updated_at: now, deleted_at: null };
  await dbPapers.setItem(id, paper);
  return paper;
}

export async function dbDeletePaper(paperId: string): Promise<void> {
  const paper = await dbPapers.getItem(paperId) as Paper | null;
  if (!paper) return;
  await dbPapers.setItem(paperId, { ...paper, deleted_at: nowIso() });
  const keysToRemove: string[] = [];
  await dbPaperQuestions.iterate((pq: unknown, key: string) => {
    if ((pq as PaperQuestion).paper_id === paperId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbPaperQuestions.removeItem(key);
}

export async function dbGetPaperQuestions(paperId: string): Promise<string[]> {
  const questionIds: string[] = [];
  await dbPaperQuestions.iterate((pq: unknown) => {
    const record = pq as PaperQuestion;
    if (record.paper_id === paperId) questionIds.push(record.question_id);
  });
  return questionIds;
}
