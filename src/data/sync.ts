/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions,
  dbTopics, dbQuestionNotes,
  dbGroups, dbTagCategories, dbAppSettings,
  nowIso, toMillis
} from './stores';
import type { SyncPayload, DataFingerprint, Paper, QuestionTagSync } from '../types';
import { adoptRemoteQuickFavTags, pendingQuickFavCount } from '../services/quick-fav-tags';
import { invalidateTagIndex } from './tags';
import { invalidateQuestionsCache } from './questions';
import { invalidateGroupsCache } from './groups';
import { clearAppSettingsCache } from './app-settings';

// 按 updated_at/deleted_at/created_at 取最大值判定「远端是否更新」；空时间戳兜底 0，避免存量记录互相覆盖
function recNewer(incoming: any, existing: any): boolean {
  if (!existing) return true;
  const inc = toMillis(incoming.updated_at || incoming.deleted_at || incoming.created_at || '');
  const ex = toMillis(existing.updated_at || existing.deleted_at || existing.created_at || '');
  return inc >= ex;
}

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

// ---------- 2.13 配置同步（groups / tag_categories / app_settings） ----------
// 本地唯一权威 = IndexedDB store；同步时序列化进 user_settings 通道（沿用 quickFavoriteTags 范式）。
// 服务端 mergeUserSettings 为浅合并（按顶层键整块替换）→ 集合级 LWW，不做逐条时间戳。
// 「本机无未推送改动」= 当前内容 hash 等于上次成功推送后记录的 hash。
const CONFIG_PUSHED_HASH_KEY = 'configPushedHash';

async function readStoreArray(store: { iterate: (cb: (v: unknown, k: string) => void) => Promise<void> }): Promise<any[]> {
  const arr: any[] = [];
  await store.iterate((v: unknown) => { if (v !== undefined && v !== null) arr.push(v); });
  return arr;
}

export async function collectConfigSnapshot(): Promise<{ groups: unknown[]; tag_categories: unknown[]; app_settings: Record<string, unknown> }> {
  const groups = await readStoreArray(dbGroups);
  const tag_categories = await readStoreArray(dbTagCategories);
  const app_settings: Record<string, unknown> = {};
  await dbAppSettings.iterate((v: unknown, k: string) => { app_settings[k] = v; });
  return { groups, tag_categories, app_settings };
}

function sortById(arr: any[]): any[] {
  return [...arr].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) out[k] = (val as Record<string, unknown>)[k];
      return out;
    }
    return val;
  });
}

export async function configSnapshotHash(): Promise<string> {
  const snap = await collectConfigSnapshot();
  return stableStringify({
    groups: sortById(snap.groups),
    tag_categories: sortById(snap.tag_categories),
    app_settings: snap.app_settings,
  });
}

function markConfigPushed(hash: string): void {
  try { localStorage.setItem(CONFIG_PUSHED_HASH_KEY, hash); } catch { /* ignore */ }
}

async function hasLocalUnpushedConfig(): Promise<boolean> {
  const pushed = localStorage.getItem(CONFIG_PUSHED_HASH_KEY);
  return pushed !== (await configSnapshotHash());
}

async function applyConfigSnapshot(snapshot: any): Promise<void> {
  if (Array.isArray(snapshot.groups)) {
    for (const g of snapshot.groups) { if (g?.id) await dbGroups.setItem(g.id, g); }
  }
  if (Array.isArray(snapshot.tag_categories)) {
    for (const c of snapshot.tag_categories) { if (c?.id) await dbTagCategories.setItem(c.id, c); }
  }
  if (snapshot.app_settings && typeof snapshot.app_settings === 'object' && !Array.isArray(snapshot.app_settings)) {
    for (const [k, v] of Object.entries(snapshot.app_settings)) await dbAppSettings.setItem(k, v);
  }
  invalidateGroupsCache();
  clearAppSettingsCache();
}

export async function dbBuildSyncPayload(): Promise<SyncPayload> {
  const payload: SyncPayload = {
    questions: [], tags: [], question_tags: [], papers: [], paper_questions: [],
    question_notes: [],
  };
  payload.settings = await collectConfigSnapshot();
  await dbQuestions.iterate((v: unknown) => { if (v) payload.questions.push(v); });
  await dbTags.iterate((v: unknown) => { if (v) payload.tags.push(v); });
  await dbQuestionTags.iterate((v: unknown) => { if (v) payload.question_tags.push(v as QuestionTagSync); });
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

export async function dbApplyRemoteSnapshot(snapshot: any, opts: { forceConfig?: boolean } = {}): Promise<void> {
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
      if (recNewer(t, existing)) await dbTags.setItem(t.id, t);
    }
  }
  if (snapshot.question_tags) {
    for (const qt of snapshot.question_tags) {
      const key = `${qt.question_id}_${qt.tag_id}`;
      const existing = await dbQuestionTags.getItem(key);
      if (recNewer(qt, existing)) await dbQuestionTags.setItem(key, qt);
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
  // 2.13：仅当本机无未推送配置改动（或显式强制）时才采用远端，避免覆盖本地未上传的章节/专题/设置。
  if (snapshot.settings && typeof snapshot.settings === 'object') {
    const s = snapshot.settings;
    const hasConfig = Array.isArray(s.groups) || Array.isArray(s.tag_categories)
      || (s.app_settings && typeof s.app_settings === 'object' && !Array.isArray(s.app_settings));
    if (hasConfig && (opts.forceConfig || !(await hasLocalUnpushedConfig()))) {
      await applyConfigSnapshot(s);
      markConfigPushed(await configSnapshotHash());
    }
  }

  invalidateTagIndex();
  invalidateQuestionsCache();
}

export async function dbFinalizeSuccessfulSync(applied: any): Promise<void> {
  if (applied && applied.questions) {
    for (const id of applied.questions) {
      const q = await dbQuestions.getItem<any>(id);
      if (q) { q._dirty = false; await dbQuestions.setItem(id, q); }
    }
  }
  // 推送成功后才记录配置 hash，失败时保持「未推送」以免下次同步误采用远端覆盖本地
  markConfigPushed(await configSnapshotHash());
}

export async function dbClearAllData(): Promise<void> {
  await dbQuestions.clear();
  await dbTags.clear();
  await dbQuestionTags.clear();
  await dbPapers.clear();
  await dbPaperQuestions.clear();
  await dbQuestionNotes.clear();
}

export async function dbReplaceWithRemoteSnapshot(snapshot: any): Promise<void> {
  await dbClearAllData();
  // doSyncDown 语义为「以服务器为准」，配置也强制采用远端
  await dbApplyRemoteSnapshot(snapshot, { forceConfig: true });
}
