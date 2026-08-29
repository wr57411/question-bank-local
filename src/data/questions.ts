import { dbQuestions, dbQuestionTags, generateId, nowIso, toMillis } from './stores';
import { buildTagIndex, invalidateTagIndex } from './tags';
import type { Question, BookInfo } from '../types';

let _questionsCache: Question[] | null = null;
let _questionsDirty = true;

export function invalidateQuestionsCache(): void {
  _questionsDirty = true;
}

function normalizeQuestionRecord(question: Record<string, unknown>, key: string): Question | null {
  if (!question || typeof question !== 'object') return null;
  const next = { ...question } as Record<string, unknown>;
  if (!next.id && key) next.id = key;
  if (!next.question_image_url) {
    next.question_image_url = next.questionImageUrl || next.question_image || next.image_url || next.image || next.question || null;
  }
  if (!next.answer_image_url) {
    next.answer_image_url = next.answerImageUrl || next.answer_image || next.answer || null;
  }
  if (next.question_image_blank_url === undefined) {
    next.question_image_blank_url = next.questionImageBlankUrl || next.question_blank_url || next.blank_image || null;
  }
  if (next.layoutType != null && next.layout_type == null) next.layout_type = next.layoutType;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (next.purgedAt && !next.purged_at) next.purged_at = next.purgedAt;
  if (!next.semantic_summary) next.semantic_summary = '';
  if (!next.ai_metadata) next.ai_metadata = {};
  if (!next.user_comment) next.user_comment = '';
  if (!next.versions) next.versions = [];
  if (!next.book_name) next.book_name = '';
  if (!next.page_number) next.page_number = '';
  if (!next.question_number) next.question_number = '';
  if (typeof next.id !== 'string' || typeof next.created_at !== 'string') return null;
  return next as unknown as Question;
}

export function recordNeedsNormalization(original: Record<string, unknown>): boolean {
  if (!original || typeof original !== 'object') return false;
  if (!original.id) return true;
  const required: Array<keyof Record<string, unknown>> = [
    'question_image_url', 'answer_image_url', 'question_image_blank_url',
    'semantic_summary', 'ai_metadata', 'user_comment',
    'versions', 'book_name', 'page_number', 'question_number'
  ];
  for (const k of required) {
    if (!(k in original)) return true;
  }
  if (original.layoutType != null && original.layout_type == null) return true;
  if (original.createdAt != null && original.created_at == null) return true;
  if (original.updatedAt != null && original.updated_at == null) return true;
  if (original.deletedAt != null && original.deleted_at == null) return true;
  if (original.purgedAt != null && original.purged_at == null) return true;
  return false;
}

export async function dbGetAllQuestions(): Promise<Question[]> {
  if (_questionsCache && !_questionsDirty) {
    const qtMap = await buildTagIndex();
    return _questionsCache.map(q => { const c = { ...q }; c.question_tags = qtMap.get(c.id) || []; return c; });
  }
  const questions: Question[] = [];
  const updates: Question[] = [];
  await dbQuestions.iterate((v: unknown, key: string) => {
    const question = normalizeQuestionRecord(v as Record<string, unknown>, key);
    if (!question) return;
    if (recordNeedsNormalization(v as Record<string, unknown>)) updates.push(question);
    if (!question.deleted_at) questions.push({ ...question });
  });
  for (const question of updates) await dbQuestions.setItem(question.id, question);
  _questionsCache = questions.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
  _questionsDirty = false;
  const qtMap = await buildTagIndex();
  for (const q of _questionsCache) q.question_tags = qtMap.get(q.id) || [];
  return _questionsCache.map(q => ({ ...q }));
}

export async function dbGetTrashedQuestions(): Promise<Question[]> {
  const questions: Question[] = [];
  await dbQuestions.iterate((v: unknown, key: string) => {
    const question = normalizeQuestionRecord(v as Record<string, unknown>, key);
    if (!question) return;
    if (question.deleted_at && !question.purged_at) questions.push({ ...question });
  });
  const qtMap = await buildTagIndex();
  for (const q of questions) q.question_tags = qtMap.get(q.id) || [];
  return questions.sort((a, b) => toMillis(b.deleted_at) - toMillis(a.deleted_at));
}

export async function dbCreateQuestion(
  questionImageUrl: string | null,
  answerImageUrl: string | null,
  selectedTagIds: string[],
  layoutType: number,
  blankImageUrl: string | null,
  versions: string[],
  bookInfo: BookInfo | null
): Promise<Question> {
  const id = generateId();
  const now = nowIso();
  const question: Question = {
    id,
    question_image_url: questionImageUrl,
    answer_image_url: answerImageUrl,
    question_image_blank_url: blankImageUrl,
    layout_type: layoutType || 0,
    versions: versions || [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
    semantic_summary: '',
    ai_metadata: {},
    book_name: bookInfo?.book_name || '',
    page_number: bookInfo?.page_number || '',
    question_number: bookInfo?.question_number || '',
  };
  await dbQuestions.setItem(id, question);
  invalidateQuestionsCache();
  for (const tagId of selectedTagIds) {
    await dbQuestionTags.setItem(`${id}_${tagId}`, { question_id: id, tag_id: tagId });
  }
  invalidateTagIndex();
  return question;
}

export async function dbSoftDeleteQuestion(questionId: string): Promise<void> {
  const question = await dbQuestions.getItem(questionId) as Question | null;
  if (!question) return;
  await dbQuestions.setItem(questionId, { ...question, deleted_at: nowIso(), updated_at: nowIso() });
  invalidateQuestionsCache();
}

export async function dbRestoreQuestion(questionId: string): Promise<void> {
  const question = await dbQuestions.getItem(questionId) as Question | null;
  if (!question) return;
  await dbQuestions.setItem(questionId, { ...question, deleted_at: null, updated_at: nowIso() });
  invalidateQuestionsCache();
}

export async function dbPermanentDeleteQuestion(questionId: string): Promise<void> {
  await dbQuestions.setItem(questionId, { ...(await dbQuestions.getItem(questionId) as Question), purged_at: nowIso() });
  const keysToRemove: string[] = [];
  await dbQuestionTags.iterate((qt: unknown, key: string) => {
    if ((qt as { question_id: string }).question_id === questionId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbQuestionTags.removeItem(key);
  invalidateQuestionsCache();
  invalidateTagIndex();
}

export async function dbAddTagToQuestion(questionId: string, tagId: string): Promise<void> {
  await dbQuestionTags.setItem(`${questionId}_${tagId}`, { question_id: questionId, tag_id: tagId });
  invalidateTagIndex();
}

export async function dbRemoveTagFromQuestion(questionId: string, tagId: string): Promise<void> {
  await dbQuestionTags.removeItem(`${questionId}_${tagId}`);
  invalidateTagIndex();
}

export async function dbUpdateQuestionBlankImage(questionId: string, blankImageUrl: string | null): Promise<void> {
  const question = await dbQuestions.getItem(questionId) as Question | null;
  if (!question) return;
  await dbQuestions.setItem(questionId, { ...question, question_image_blank_url: blankImageUrl, updated_at: nowIso() });
  invalidateQuestionsCache();
}

export async function dbUpdateQuestionVersions(questionId: string, versions: string[]): Promise<void> {
  const question = await dbQuestions.getItem(questionId) as Question | null;
  if (!question) return;
  await dbQuestions.setItem(questionId, { ...question, versions, updated_at: nowIso() });
  invalidateQuestionsCache();
}

export async function dbUpdateQuestionBookInfo(questionId: string, bookInfo: BookInfo): Promise<void> {
  const question = await dbQuestions.getItem(questionId) as Question | null;
  if (!question) return;
  await dbQuestions.setItem(questionId, {
    ...question,
    book_name: bookInfo.book_name || '',
    page_number: bookInfo.page_number || '',
    question_number: bookInfo.question_number || '',
    updated_at: nowIso(),
  });
  invalidateQuestionsCache();
}

export async function dbGetAllBookNames(): Promise<string[]> {
  const names = new Set<string>();
  await dbQuestions.iterate((v: unknown) => {
    const q = v as Question;
    if (q && q.book_name && !q.deleted_at) names.add(q.book_name);
  });
  return Array.from(names).sort();
}

export async function dbRemoveVersionFromAllQuestions(versionId: string): Promise<void> {
  const updates: Question[] = [];
  await dbQuestions.iterate((v: unknown, key: string) => {
    const q = v as Question;
    if (q && q.versions && q.versions.includes(versionId)) {
      updates.push({ ...q, versions: q.versions.filter(id => id !== versionId), updated_at: nowIso() });
    }
  });
  for (const q of updates) await dbQuestions.setItem(q.id, q);
  invalidateQuestionsCache();
}
