import { createClient, SupabaseClient } from '@supabase/supabase-js';
import db from '../db/connection.js';
import { normalizeTimestamp, nowIso } from '../utils/helpers.js';

let supabase: SupabaseClient | null = null;

export function initSupabase(): boolean {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[replicate] SUPABASE_URL 或 SUPABASE_KEY 未配置，Supabase 复制已禁用');
    return false;
  }
  supabase = createClient(url, key, {
    global: {
      fetch: (...args: Parameters<typeof fetch>) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        return fetch(args[0], { ...args[1], signal: controller.signal })
          .finally(() => clearTimeout(timeout));
      }
    }
  });
  console.log('[replicate] Supabase 客户端已初始化（超时60s）');
  return true;
}

export function isEnabled(): boolean {
  return !!supabase;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

async function upsertBatch(table: string, rows: unknown[]): Promise<void> {
  if (!rows.length || !supabase) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) console.warn(`[replicate] ${table} upsert 失败:`, error.message);
  else console.log(`[replicate] ${table} 同步 ${rows.length} 条成功`);
}

interface DbRow { [key: string]: unknown; }

async function replicateUser(userId: string): Promise<void> {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbRow | undefined;
  if (!user) return;
  await upsertBatch('users', [{
    id: user.id, phone: user.phone || '', nickname: user.nickname || '',
    created_at: normalizeTimestamp(user.created_at as string), updated_at: normalizeTimestamp(user.updated_at as string)
  }]);
}

async function replicateTags(userId: string): Promise<void> {
  const rows = (db.prepare('SELECT * FROM tags WHERE user_id = ?').all(userId) as DbRow[]).map(t => ({
    id: t.id, user_id: t.user_id, name: t.name, subject: t.subject || '',
    created_at: normalizeTimestamp(t.created_at as string), updated_at: normalizeTimestamp(t.updated_at as string)
  }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch('tags', rows.slice(i, i + BATCH_SIZE));
    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }
}

async function replicateQuestions(userId: string): Promise<void> {
  const rows = (db.prepare('SELECT * FROM questions WHERE user_id = ?').all(userId) as DbRow[]).map(q => {
    const tagIds = (db.prepare(`SELECT qt.tag_id FROM question_tags qt JOIN tags t ON t.id = qt.tag_id WHERE qt.question_id = ? AND t.user_id = ?`).all(q.id, userId) as DbRow[]).map(r => r.tag_id);
    return {
      id: q.id, user_id: q.user_id, content: q.content || '', answer: q.answer || '',
      type: q.type || 'text', images: q.images || '[]', tag_ids: JSON.stringify(tagIds),
      versions: q.versions || '[]', source: q.source || '', difficulty: q.difficulty || '',
      created_at: normalizeTimestamp(q.created_at as string), updated_at: normalizeTimestamp(q.updated_at as string)
    };
  });
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch('questions', rows.slice(i, i + BATCH_SIZE));
    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }
}

async function replicatePapers(userId: string): Promise<void> {
  const rows = (db.prepare('SELECT * FROM papers WHERE user_id = ?').all(userId) as DbRow[]).map(p => ({
    id: p.id, user_id: p.user_id, title: p.title || '', questions: p.questions || '[]',
    created_at: normalizeTimestamp(p.created_at as string), updated_at: normalizeTimestamp(p.updated_at as string)
  }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch('papers', rows.slice(i, i + BATCH_SIZE));
    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }
}

async function replicateSimilarLinks(userId: string): Promise<void> {
  const rows = (db.prepare(`SELECT sl.* FROM similar_question_links sl JOIN questions q ON q.id = sl.question_id_1 WHERE q.user_id = ?`).all(userId) as DbRow[]).map(sl => ({
    id: sl.id, question_id_1: sl.question_id_1, question_id_2: sl.question_id_2,
    reason: sl.reason || '', created_at: normalizeTimestamp(sl.created_at as string)
  }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch('similar_question_links', rows.slice(i, i + BATCH_SIZE));
    if (i + BATCH_SIZE < rows.length) await sleep(BATCH_DELAY_MS);
  }
}

let syncInProgress = false;
let lastSyncResult: unknown = null;

export async function replicateToSupabase(userId: string): Promise<void> {
  if (!supabase) return;
  try {
    await replicateUser(userId);
    await replicateTags(userId);
    await replicateQuestions(userId);
    await replicatePapers(userId);
    await replicateSimilarLinks(userId);
  } catch (e) {
    console.warn('[replicate] 复制失败:', (e as Error).message);
  }
}

export async function fullReplicateToSupabase(): Promise<unknown> {
  if (!supabase) return { error: 'Supabase 未配置' };
  if (syncInProgress) return { error: '同步正在进行中，请稍候', in_progress: true };
  syncInProgress = true;
  lastSyncResult = null;
  try {
    const users = db.prepare('SELECT id FROM users').all() as { id: string }[];
    let count = 0;
    for (const user of users) {
      await replicateToSupabase(user.id);
      count++;
      if (count < users.length) await sleep(BATCH_DELAY_MS);
    }
    lastSyncResult = { success: true, users: count, timestamp: nowIso() };
    console.log('[replicate] 全量同步完成:', lastSyncResult);
    return lastSyncResult;
  } catch (e) {
    lastSyncResult = { error: (e as Error).message, timestamp: nowIso() };
    console.warn('[replicate] 全量同步失败:', (e as Error).message);
    return lastSyncResult;
  } finally {
    syncInProgress = false;
  }
}

export function startBackgroundSync(): unknown {
  if (!supabase) return { error: 'Supabase 未配置' };
  if (syncInProgress) return { message: '同步已在进行中', in_progress: true };
  fullReplicateToSupabase().catch(e => {
    console.warn('[replicate] 后台同步异常:', (e as Error).message);
  });
  return { message: '同步已启动', started_at: nowIso() };
}

export function getSyncStatus(): unknown {
  return { in_progress: syncInProgress, last_result: lastSyncResult };
}
