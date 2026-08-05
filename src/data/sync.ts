/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions,
  dbSimilarQuestionLinks, dbTopics, dbTopicQuestions, dbQuestionNotes,
  dbTeachingNodes, dbTeachingVersions, dbNodeQuestions,
  dbPdfBooks, dbPdfChapters, dbPdfTopics, dbPdfDocs, dbPdfCategories,
  nowIso
} from './stores';
import type { SyncPayload, DataFingerprint } from '../types';

let _serverUrl = '';
let _apiToken = '';
let _syncEnabled = false;

export function initRemoteSync(serverUrl: string, apiToken: string, syncEnabled: boolean): void {
  _serverUrl = serverUrl;
  _apiToken = apiToken;
  _syncEnabled = syncEnabled;
}

export function isSyncEnabled(): boolean {
  return _syncEnabled;
}

export async function remoteCall(path: string, method = 'GET', body: unknown = null): Promise<unknown> {
  if (!_serverUrl || !_apiToken) throw new Error('同步未配置');
  const url = _serverUrl.replace(/\/+$/, '') + path;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${_apiToken}`,
  };
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`同步请求失败: ${response.status}`);
  return response.json();
}

export async function collectDataFingerprint(): Promise<DataFingerprint> {
  let questionCount = 0, tagCount = 0, paperCount = 0, topicCount = 0;
  let questionTagCount = 0, versionsPresent = 0;
  await dbQuestions.iterate((v: unknown) => {
    const q = v as { deleted_at?: string; versions?: string[] };
    if (q && !q.deleted_at) { questionCount++; if (q.versions?.length) versionsPresent++; }
  });
  await dbTags.iterate((v: unknown) => { if (v && !(v as { deleted_at?: string }).deleted_at) tagCount++; });
  await dbPapers.iterate((v: unknown) => { if (v && !(v as { deleted_at?: string }).deleted_at) paperCount++; });
  await dbTopics.iterate((v: unknown) => { if (v && !(v as { deleted_at?: string }).deleted_at) topicCount++; });
  await dbQuestionTags.iterate(() => { questionTagCount++; });
  return { questionCount, tagCount, paperCount, topicCount, questionTagCount, versionsPresent };
}

export async function dbBuildSyncPayload(): Promise<SyncPayload> {
  const payload: SyncPayload = {
    questions: [], tags: [], question_tags: [], papers: [], paper_questions: [],
    similar_question_links: [], topics: [], topic_questions: [], question_notes: [],
    teaching_nodes: [], teaching_versions: [], node_questions: [],
    pdf_books: [], pdf_chapters: [], pdf_topics: [], pdf_docs: [], pdf_categories: [],
  };
  await dbQuestions.iterate((v: unknown) => { if (v) payload.questions.push(v); });
  await dbTags.iterate((v: unknown) => { if (v) payload.tags.push(v); });
  await dbQuestionTags.iterate((v: unknown) => { if (v) payload.question_tags.push(v); });
  await dbPapers.iterate((v: unknown) => { if (v) payload.papers.push(v); });
  await dbPaperQuestions.iterate((v: unknown) => { if (v) payload.paper_questions.push(v); });
  await dbSimilarQuestionLinks.iterate((v: unknown) => { if (v) payload.similar_question_links.push(v); });
  await dbTopics.iterate((v: unknown) => { if (v) payload.topics.push(v); });
  await dbTopicQuestions.iterate((v: unknown) => { if (v) payload.topic_questions.push(v); });
  await dbQuestionNotes.iterate((v: unknown) => { if (v) payload.question_notes.push(v); });
  await dbTeachingNodes.iterate((v: unknown) => { if (v) payload.teaching_nodes.push(v); });
  await dbTeachingVersions.iterate((v: unknown) => { if (v) payload.teaching_versions.push(v); });
  await dbNodeQuestions.iterate((v: unknown) => { if (v) payload.node_questions.push(v); });
  await dbPdfBooks.iterate((v: unknown) => { if (v) payload.pdf_books.push(v); });
  await dbPdfChapters.iterate((v: unknown) => { if (v) payload.pdf_chapters.push(v); });
  await dbPdfTopics.iterate((v: unknown) => { if (v) payload.pdf_topics.push(v); });
  await dbPdfDocs.iterate((v: unknown) => { if (v) payload.pdf_docs.push(v); });
  await dbPdfCategories.iterate((v: unknown) => { if (v) payload.pdf_categories.push(v); });
  return payload;
}

export function checkSyncDataIntegrity(before: DataFingerprint, after: DataFingerprint): string[] {
  const warnings: string[] = [];
  if (after.questionCount < before.questionCount) {
    warnings.push(`题目数量减少: ${before.questionCount} → ${after.questionCount}`);
  }
  if (after.tagCount < before.tagCount) {
    warnings.push(`标签数量减少: ${before.tagCount} → ${after.tagCount}`);
  }
  if (before.versionsPresent > 0 && after.versionsPresent === 0) {
    warnings.push('版本信息可能被丢弃');
  }
  return warnings;
}

// ---------- Batch 6: sync data helpers ----------

let _onSyncDataWarning: ((warnings: any[]) => void) | null = null;

export function setOnSyncDataWarning(fn: (warnings: any[]) => void): void {
  _onSyncDataWarning = fn;
}

export async function dbApplyRemoteSnapshot(snapshot: any): Promise<void> {
  if (snapshot.questions) {
    for (const q of snapshot.questions) {
      const existing = await dbQuestions.getItem<any>(q.id);
      if (!existing || new Date(q.updated_at) > new Date(existing.updated_at)) {
        await dbQuestions.setItem(q.id, q);
      }
    }
  }
  if (snapshot.tags) {
    for (const t of snapshot.tags) {
      const existing = await dbTags.getItem(t.id);
      if (!existing) await dbTags.setItem(t.id, t);
    }
  }
  if (snapshot.papers) {
    for (const p of snapshot.papers) { await dbPapers.setItem(p.id, p); }
  }
  if (snapshot.paper_questions) {
    for (const pq of snapshot.paper_questions) { await dbPaperQuestions.setItem(pq.id || `${pq.paper_id}_${pq.question_id}`, pq); }
  }
  if (snapshot.topics) {
    for (const t of snapshot.topics) { await dbTopics.setItem(t.id, t); }
  }
  if (snapshot.topic_questions) {
    for (const tq of snapshot.topic_questions) { await dbTopicQuestions.setItem(tq.id || `${tq.topic_id}_${tq.question_id}`, tq); }
  }
  if (snapshot.similar_links) {
    for (const sl of snapshot.similar_links) { await dbSimilarQuestionLinks.setItem(sl.id, sl); }
  }
  if (snapshot.question_notes) {
    for (const n of snapshot.question_notes) { await dbQuestionNotes.setItem(n.id, n); }
  }
}

export async function dbFinalizeSuccessfulSync(applied: any): Promise<void> {
  if (applied && applied.questions) {
    for (const id of applied.questions) {
      const q = await dbQuestions.getItem<any>(id);
      if (q) { q._dirty = false; await dbQuestions.setItem(id, q); }
    }
  }
}

export async function dbClearAllData(): Promise<void> {
  await dbQuestions.clear();
  await dbTags.clear();
  await dbPapers.clear();
  await dbPaperQuestions.clear();
  await dbTopics.clear();
  await dbTopicQuestions.clear();
  await dbSimilarQuestionLinks.clear();
  await dbQuestionNotes.clear();
}

export async function dbReplaceWithRemoteSnapshot(snapshot: any): Promise<void> {
  await dbClearAllData();
  await dbApplyRemoteSnapshot(snapshot);
}
