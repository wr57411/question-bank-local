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
      pdf_url: (p.pdf_url as string) || null,
      pdf_local_path: (p.pdf_local_path as string) || null,
    };
    if (!paper.deleted_at) papers.push(paper);
  });
  const countMap = new Map<string, number>();
  await dbPaperQuestions.iterate((pq: unknown) => {
    const pid = (pq as PaperQuestion).paper_id;
    if (pid) countMap.set(pid, (countMap.get(pid) || 0) + 1);
  });
  for (const paper of papers) {
    (paper as Paper & { question_count?: number }).question_count = countMap.get(paper.id) || 0;
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

export async function dbCreatePaperFromExport(name: string, questionIds: string[], pdfUrl: string | null, pdfLocalPath: string | null): Promise<Paper> {
  const id = generateId();
  const now = nowIso();
  const paper: Paper = { id, name, created_at: now, updated_at: now, deleted_at: null, pdf_url: pdfUrl, pdf_local_path: pdfLocalPath };
  await dbPapers.setItem(id, paper);
  let order = 1;
  for (const questionId of questionIds) {
    await dbPaperQuestions.setItem(`${id}_${questionId}`, { paper_id: id, question_id: questionId, order_num: order } as PaperQuestion);
    order++;
  }
  return paper;
}

export async function dbEnsurePaperPdfLocal(paper: Paper): Promise<string | null> {
  if (paper.pdf_local_path) return paper.pdf_local_path;
  if (!paper.pdf_url) return null;
  const serverUrl = (localStorage.getItem('serverUrl') || '').replace(/\/+$/, '');
  if (!serverUrl) return null;
  const resp = await fetch(serverUrl + paper.pdf_url);
  if (!resp.ok) throw new Error(`下载试卷 PDF 失败: ${resp.status}`);
  const blob = await resp.blob();
  const b64 = await blobToBase64(blob);
  const w = window as unknown as { Capacitor?: { Plugins?: { Filesystem?: { writeFile(opts: Record<string, unknown>): Promise<unknown> } } } };
  const fs = w.Capacitor?.Plugins?.Filesystem;
  if (!fs) return null;
  const relativePath = 'papers-cache/' + (paper.pdf_url.split('/').pop() || `${paper.id}.pdf`);
  await fs.writeFile({ path: relativePath, data: b64, directory: 'DOCUMENTS' });
  const updated = { ...paper, pdf_local_path: relativePath };
  await dbPapers.setItem(paper.id, updated);
  return relativePath;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

export async function dbGetPaperQuestions(paperId: string): Promise<{ paper: Paper | null; questions: any[] }> {
  const paper = await dbPapers.getItem(paperId) as Paper | null;
  const questionIds: { id: string; order: number }[] = [];
  await dbPaperQuestions.iterate((pq: unknown) => {
    const record = pq as PaperQuestion;
    if (record.paper_id === paperId) questionIds.push({ id: record.question_id, order: record.order_num || 0 });
  });
  questionIds.sort((a, b) => a.order - b.order);
  const { dbQuestions } = await import('./stores');
  const questions: any[] = [];
  for (const { id } of questionIds) {
    const q = await dbQuestions.getItem(id);
    if (q) questions.push(q);
  }
  return { paper, questions };
}
