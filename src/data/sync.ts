/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions,
  dbTopics, dbQuestionNotes,
  nowIso
} from './stores';
import type { SyncPayload, DataFingerprint, Paper } from '../types';
import { adoptRemoteQuickFavTags, pendingQuickFavCount } from '../services/quick-fav-tags';

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
    question_notes: [],
  };
  await dbQuestions.iterate((v: unknown) => { if (v) payload.questions.push(v); });
  await dbTags.iterate((v: unknown) => { if (v) payload.tags.push(v); });
  await dbQuestionTags.iterate((v: unknown) => { if (v) payload.question_tags.push(v); });
  await dbPapers.iterate((v: unknown) => {
    if (!v) return;
    const { pdf_local_path: _local, ...rest } = v as Record<string, unknown>;
    payload.papers.push(rest);
  });
  await dbPaperQuestions.iterate((v: unknown) => { if (v) payload.paper_questions.push(v); });
  await dbQuestionNotes.iterate((v: unknown) => { if (v) payload.question_notes.push(v); });
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
  if (snapshot.papers) {
    for (const p of snapshot.papers) {
      const local = await dbPapers.getItem<Paper & { pdf_local_path?: string | null }>(p.id);
      await dbPapers.setItem(p.id, { ...p, pdf_local_path: local?.pdf_local_path ?? null });
    }
  }
  if (snapshot.question_notes) {
    for (const n of snapshot.question_notes) { await dbQuestionNotes.setItem(n.id, n); }
  }
  if (snapshot.settings && typeof snapshot.settings === 'object' && snapshot.settings.quickFavoriteTags) {
    if (pendingQuickFavCount() === 0) adoptRemoteQuickFavTags(snapshot.settings.quickFavoriteTags);
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
  await dbQuestionNotes.clear();
}

export async function dbReplaceWithRemoteSnapshot(snapshot: any): Promise<void> {
  await dbClearAllData();
  await dbApplyRemoteSnapshot(snapshot);
}
