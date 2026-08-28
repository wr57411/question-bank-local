import db from '../db/connection.js';
import { nowIso } from '../utils/helpers.js';
import {
  createAppliedResult, upsertTag, upsertQuestion, upsertPaper,
  upsertSimilarLink, upsertTopic, upsertQuestionNote,
  upsertTeachingNode, upsertTeachingVersion, upsertNodeQuestion,
  upsertPdfBook, upsertPdfChapter, upsertPdfTopic, upsertPdfDoc, upsertPdfCategory
} from './sync-upsert.js';

let primaryUrl = '';
let primaryToken = '';
let primaryUserId = '';
let syncEnabled = false;
let syncInProgress = false;
let lastSyncResult: unknown = null;
let lastSyncAt: string | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function initServerSync(): boolean {
  primaryUrl = process.env.PRIMARY_SERVER_URL || '';
  const phone = process.env.SYNC_PHONE || '';
  const password = process.env.SYNC_PASSWORD || '';

  if (!primaryUrl || !phone || !password) {
    console.warn('[server-sync] PRIMARY_SERVER_URL/SYNC_PHONE/SYNC_PASSWORD 未配置，服务器间同步已禁用');
    return false;
  }

  primaryUrl = primaryUrl.replace(/\/+$/, '');
  syncEnabled = true;
  console.log(`[server-sync] 服务器间同步已启用，主服务器: ${primaryUrl}`);
  return true;
}

export function isEnabled(): boolean {
  return syncEnabled;
}

export function getServerSyncStatus(): {
  server_sync_enabled: boolean;
  sync_in_progress: boolean;
  last_result: unknown;
  primary_url: string;
  last_sync_at: string | null;
} {
  return {
    server_sync_enabled: syncEnabled,
    sync_in_progress: syncInProgress,
    last_result: lastSyncResult,
    primary_url: primaryUrl,
    last_sync_at: lastSyncAt,
  };
}

async function loginToPrimary(): Promise<string> {
  const phone = process.env.SYNC_PHONE;
  const password = process.env.SYNC_PASSWORD;
  if (!phone || !password) throw new Error('SYNC_PHONE/SYNC_PASSWORD 未配置');

  const response = await fetch(`${primaryUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (!response.ok) throw new Error(`主服务器登录失败: ${response.status}`);
  const data = await response.json() as { id?: string; token?: string; error?: string };
  if (data.error) throw new Error(`主服务器登录失败: ${data.error}`);
  if (!data.token || !data.id) throw new Error('主服务器登录响应缺少 token 或 id');

  primaryUserId = data.id;
  primaryToken = data.token;
  return primaryToken;
}

interface PullResponse {
  now: string;
  tags: unknown[];
  questions: unknown[];
  papers: unknown[];
  similar_links: unknown[];
  pending_link_list: string[];
  topics: unknown[];
  question_notes: unknown[];
  teaching_nodes: unknown[];
  teaching_versions: unknown[];
  node_questions: unknown[];
  pdf_books: unknown[];
  pdf_chapters: unknown[];
  pdf_topics: unknown[];
  pdf_docs: unknown[];
  pdf_categories: unknown[];
  settings: Record<string, unknown> | null;
}

async function pullFromPrimary(retryCount = 0): Promise<{ applied: string[]; count: number; timestamp: string }> {
  if (!primaryToken || !primaryUserId) {
    await loginToPrimary();
  }

  const url = `${primaryUrl}/api/sync/pull${lastSyncAt ? `?since=${lastSyncAt}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${primaryToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    if (retryCount >= 3) {
      throw new Error('主服务器认证失败，已重试 3 次，请检查 SYNC_PHONE/SYNC_PASSWORD');
    }
    primaryToken = '';
    primaryUserId = '';
    await loginToPrimary();
    return pullFromPrimary(retryCount + 1);
  }

  if (!response.ok) throw new Error(`主服务器 pull 失败: ${response.status}`);
  const data = await response.json() as PullResponse;

  const applied = createAppliedResult();

  db.transaction(() => {
    for (const tag of data.tags || []) {
      try {
        if (upsertTag(primaryUserId, tag as Record<string, unknown>)) {
          applied.tags.push((tag as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] tag 同步失败:', (e as Error).message);
      }
    }
    for (const question of data.questions || []) {
      try {
        if (upsertQuestion(primaryUserId, question as Record<string, unknown>, applied)) {
          applied.questions.push((question as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] question 同步失败:', (e as Error).message);
      }
    }
    for (const paper of data.papers || []) {
      try {
        if (upsertPaper(primaryUserId, paper as Record<string, unknown>)) {
          applied.papers.push((paper as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] paper 同步失败:', (e as Error).message);
      }
    }
    for (const link of data.similar_links || []) {
      try {
        if (upsertSimilarLink(primaryUserId, link as Record<string, unknown>)) {
          applied.similar_links.push(`${(link as { question_id: string }).question_id}_${(link as { similar_question_id: string }).similar_question_id}`);
        }
      } catch (e) {
        console.warn('[server-sync] similar_link 同步失败:', (e as Error).message);
      }
    }
    for (const topic of data.topics || []) {
      try {
        if (upsertTopic(primaryUserId, topic as Record<string, unknown>)) {
          applied.topics.push((topic as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] topic 同步失败:', (e as Error).message);
      }
    }
    for (const note of data.question_notes || []) {
      try {
        if (upsertQuestionNote(primaryUserId, note as Record<string, unknown>)) {
          applied.question_notes.push((note as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] question_note 同步失败:', (e as Error).message);
      }
    }
    for (const node of data.teaching_nodes || []) {
      try {
        if (upsertTeachingNode(primaryUserId, node as Record<string, unknown>)) {
          applied.teaching_nodes.push((node as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] teaching_node 同步失败:', (e as Error).message);
      }
    }
    for (const ver of data.teaching_versions || []) {
      try {
        if (upsertTeachingVersion(primaryUserId, ver as Record<string, unknown>)) {
          applied.teaching_versions.push((ver as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] teaching_version 同步失败:', (e as Error).message);
      }
    }
    for (const nq of data.node_questions || []) {
      try {
        if (upsertNodeQuestion(primaryUserId, nq as Record<string, unknown>)) {
          applied.node_questions.push((nq as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] node_question 同步失败:', (e as Error).message);
      }
    }
    for (const book of data.pdf_books || []) {
      try {
        if (upsertPdfBook(primaryUserId, book as Record<string, unknown>)) {
          applied.pdf_books.push((book as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] pdf_book 同步失败:', (e as Error).message);
      }
    }
    for (const ch of data.pdf_chapters || []) {
      try {
        if (upsertPdfChapter(primaryUserId, ch as Record<string, unknown>)) {
          applied.pdf_chapters.push((ch as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] pdf_chapter 同步失败:', (e as Error).message);
      }
    }
    for (const pt of data.pdf_topics || []) {
      try {
        if (upsertPdfTopic(primaryUserId, pt as Record<string, unknown>)) {
          applied.pdf_topics.push((pt as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] pdf_topic 同步失败:', (e as Error).message);
      }
    }
    for (const doc of data.pdf_docs || []) {
      try {
        if (upsertPdfDoc(primaryUserId, doc as Record<string, unknown>)) {
          applied.pdf_docs.push((doc as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] pdf_doc 同步失败:', (e as Error).message);
      }
    }
    for (const cat of data.pdf_categories || []) {
      try {
        if (upsertPdfCategory(primaryUserId, cat as Record<string, unknown>)) {
          applied.pdf_categories.push((cat as { id: string }).id);
        }
      } catch (e) {
        console.warn('[server-sync] pdf_category 同步失败:', (e as Error).message);
      }
    }

    if (data.pending_link_list) {
      db.prepare('UPDATE users SET pending_link_list = ? WHERE id = ?').run(JSON.stringify(data.pending_link_list), primaryUserId);
    }
    if (data.settings) {
      const existingSettings = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(primaryUserId) as { settings: string } | undefined;
      const prev = existingSettings ? JSON.parse(existingSettings.settings) : {};
      const merged = { ...data.settings };
      if ((!merged.cloud_providers || (merged.cloud_providers as unknown[]).length === 0) && prev.cloud_providers && (prev.cloud_providers as unknown[]).length > 0) {
        merged.cloud_providers = prev.cloud_providers;
        merged.current_provider_id = prev.current_provider_id || '';
      }
      if ((!merged.appVersions || (merged.appVersions as unknown[]).length === 0) && prev.appVersions && (prev.appVersions as unknown[]).length > 0) {
        merged.appVersions = prev.appVersions;
      }
      db.prepare('INSERT OR REPLACE INTO user_settings (user_id, settings) VALUES (?, ?)').run(primaryUserId, JSON.stringify(merged));
    }

    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(primaryUserId);
    if (!exists) {
      const phone = process.env.SYNC_PHONE || '';
      db.prepare('INSERT INTO users (id, phone, nickname) VALUES (?, ?, ?)').run(primaryUserId, phone, 'synced');
    } else {
      db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(process.env.SYNC_PHONE || '', primaryUserId);
    }
  })();

  const totalApplied =
    applied.tags.length + applied.questions.length + applied.papers.length +
    applied.similar_links.length + applied.topics.length + applied.question_notes.length +
    applied.teaching_nodes.length + applied.teaching_versions.length + applied.node_questions.length +
    applied.pdf_books.length + applied.pdf_chapters.length + applied.pdf_topics.length +
    applied.pdf_docs.length + applied.pdf_categories.length;

  const allApplied: string[] = [];
  allApplied.push(...applied.tags, ...applied.questions, ...applied.papers, ...applied.topics, ...applied.pdf_books, ...applied.pdf_docs);

  let maxTimestamp = data.now || nowIso();
  const allRecords = [
    ...(data.tags || []), ...(data.questions || []), ...(data.papers || []),
    ...(data.topics || []), ...(data.question_notes || []), ...(data.teaching_nodes || []),
    ...(data.teaching_versions || []), ...(data.pdf_books || []), ...(data.pdf_chapters || []),
    ...(data.pdf_topics || []), ...(data.pdf_docs || []), ...(data.pdf_categories || []),
  ];
  for (const rec of allRecords) {
    const ts = (rec as { updated_at?: string }).updated_at;
    if (ts && ts > maxTimestamp) maxTimestamp = ts;
  }

  return { applied: allApplied, count: totalApplied, timestamp: maxTimestamp };
}

export async function startPullFromPrimary(): Promise<{ message: string; started_at: string }> {
  if (!syncEnabled) return { message: '服务器间同步未配置', started_at: nowIso() };
  if (syncInProgress) return { message: '同步已在进行中', started_at: nowIso() };

  syncInProgress = true;
  (async () => {
    try {
      const result = await pullFromPrimary();
      lastSyncResult = { success: true, count: result.count, timestamp: nowIso() };
      lastSyncAt = result.timestamp;
      console.log(`[server-sync] 拉取完成: ${result.count} 条记录更新`);
    } catch (e) {
      const msg = (e as Error).message;
      lastSyncResult = { error: msg, timestamp: nowIso() };
      console.warn('[server-sync] 拉取失败:', msg);
      if (msg.includes('登录失败')) {
        primaryToken = '';
        primaryUserId = '';
      }
    } finally {
      syncInProgress = false;
    }
  })();

  return { message: '同步已启动', started_at: nowIso() };
}

export function startPeriodicSync(): void {
  if (!syncEnabled) return;
  const intervalMs = parseInt(process.env.SERVER_SYNC_INTERVAL || '300000', 10);

  startPullFromPrimary().catch(e => {
    console.warn('[server-sync] 初始拉取异常:', (e as Error).message);
  });

  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(async () => {
    if (!syncInProgress) {
      await startPullFromPrimary().catch(e => {
        console.warn('[server-sync] 周期拉取异常:', (e as Error).message);
      });
    }
  }, intervalMs);
  console.log(`[server-sync] 周期同步已启动，间隔 ${intervalMs / 1000}s`);
}
