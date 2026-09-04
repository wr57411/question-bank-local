import { Router } from 'express';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { normalizeTimestamp, toMillis, parseAiMetadata, nowIso } from '../utils/helpers.js';
import { replicateToSupabase } from '../services/replicate.js';
import { mergeUserSettings } from '../services/user-settings.js';
import { mergeQuickFavTags, type QuickFavSnapshot } from '../services/quick-fav-merge.js';
import {
  createAppliedResult, upsertTag, upsertQuestion, upsertPaper,
  upsertSimilarLink, upsertQuestionNote,
  listQuestionTagIds, listPaperQuestionIds
} from '../services/sync-upsert.js';

const router = Router();
router.use(authMiddleware);

interface DbRow { [key: string]: unknown; }

router.post('/push', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { tags = [], questions = [], papers = [], similar_links = [], pending_link_list = [], topics = [], question_notes = [], teaching_nodes = [], teaching_versions = [], node_questions = [], pdf_books = [], pdf_chapters = [], pdf_topics = [], pdf_docs = [], pdf_categories = [], settings = null } = req.body || {};

    const applied = createAppliedResult();

  const transaction = db.transaction(() => {
    for (const tag of tags) {
      if (upsertTag(userId, tag)) applied.tags.push(tag.id);
    }
    for (const question of questions) {
      if (upsertQuestion(userId, question, applied)) applied.questions.push(question.id);
    }
    for (const paper of papers) {
      if (upsertPaper(userId, paper)) applied.papers.push(paper.id);
    }
    for (const link of similar_links) {
      if (upsertSimilarLink(userId, link)) applied.similar_links.push(`${link.question_id}_${link.similar_question_id}`);
    }
    for (const note of question_notes) {
      if (upsertQuestionNote(userId, note)) applied.question_notes.push(note.id);
    }
    if (settings) {
      const existingSettings = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
      let prev: Record<string, unknown> = {};
      if (existingSettings?.settings) {
        try { prev = JSON.parse(existingSettings.settings); } catch { prev = {}; }
      }
      const merged = mergeUserSettings(prev, (settings ?? {}) as Record<string, unknown>);
      db.prepare('INSERT OR REPLACE INTO user_settings (user_id, settings) VALUES (?, ?)').run(userId, JSON.stringify(merged));
    }
  });

    transaction();
    replicateToSupabase(userId).catch(e => console.warn('[sync] Supabase 复制失败:', (e as Error).message));
    res.json({ success: true, now: nowIso(), applied });
  } catch (e) {
    res.status(500).json({ error: '同步 push 失败', detail: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/pull', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const since = req.query.since ? toMillis(req.query.since as string) : 0;

  const tags = (db.prepare('SELECT * FROM tags WHERE user_id = ?').all(userId) as DbRow[])
    .filter((tag) => !since || toMillis((tag.updated_at || tag.created_at) as string) > since)
    .sort((a, b) => toMillis(a.updated_at as string) - toMillis(b.updated_at as string))
    .map((tag) => ({
      ...tag,
      updated_at: normalizeTimestamp((tag.updated_at || tag.created_at) as string),
      created_at: normalizeTimestamp((tag.created_at || tag.updated_at) as string),
      deleted_at: tag.deleted_at ? normalizeTimestamp(tag.deleted_at as string) : null
    }));

  const questions = (db.prepare('SELECT * FROM questions WHERE user_id = ?').all(userId) as DbRow[])
    .filter((q) => !since || toMillis((q.updated_at || q.created_at) as string) > since)
    .sort((a, b) => toMillis(a.updated_at as string) - toMillis(b.updated_at as string))
    .map((q) => ({
      ...q,
      ai_metadata: parseAiMetadata(q.ai_metadata),
      versions: (() => { try { let v = JSON.parse((q.versions as string) || '[]'); if (typeof v === 'string') v = JSON.parse(v); return Array.isArray(v) ? v : []; } catch { return []; } })(),
      book_name: q.book_name || '',
      page_number: q.page_number || '',
      question_number: q.question_number || '',
      updated_at: normalizeTimestamp((q.updated_at || q.created_at) as string),
      created_at: normalizeTimestamp((q.created_at || q.updated_at) as string),
      deleted_at: q.deleted_at ? normalizeTimestamp(q.deleted_at as string) : null,
      tag_ids: listQuestionTagIds(q.id as string, userId)
    }));

  const papers = (db.prepare('SELECT * FROM papers WHERE user_id = ?').all(userId) as DbRow[])
    .filter((p) => !since || toMillis((p.updated_at || p.created_at) as string) > since)
    .sort((a, b) => toMillis(a.updated_at as string) - toMillis(b.updated_at as string))
    .map((p) => ({
      ...p,
      updated_at: normalizeTimestamp((p.updated_at || p.created_at) as string),
      created_at: normalizeTimestamp((p.created_at || p.updated_at) as string),
      deleted_at: p.deleted_at ? normalizeTimestamp(p.deleted_at as string) : null,
      question_ids: listPaperQuestionIds(p.id as string, userId)
    }));

  const similar_links = (db.prepare('SELECT * FROM similar_question_links WHERE user_id = ?').all(userId) as DbRow[])
    .filter((link) => !since || toMillis((link.updated_at || link.created_at) as string) > since)
    .sort((a, b) => toMillis(a.updated_at as string) - toMillis(b.updated_at as string))
    .map((link) => ({
      question_id: link.question_id,
      similar_question_id: link.similar_question_id,
      created_at: normalizeTimestamp((link.created_at || link.updated_at) as string),
      updated_at: normalizeTimestamp((link.updated_at || link.created_at) as string),
      deleted_at: link.deleted_at ? normalizeTimestamp(link.deleted_at as string) : null
    }));

  const user = db.prepare('SELECT pending_link_list FROM users WHERE id = ?').get(userId) as { pending_link_list: string } | undefined;
  const settingsRow = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
  const pending_link_list = JSON.parse(user?.pending_link_list || '[]');

  const teachingNodes = (db.prepare('SELECT * FROM teaching_nodes WHERE user_id = ?').all(userId) as DbRow[])
    .filter(n => !since || toMillis((n.updated_at || n.created_at) as string) > since)
    .map(n => ({ ...n, created_at: normalizeTimestamp(n.created_at as string), updated_at: normalizeTimestamp(n.updated_at as string) }));

  const teachingVersions = (db.prepare('SELECT * FROM teaching_versions WHERE user_id = ?').all(userId) as DbRow[])
    .filter(v => !since || toMillis((v.updated_at || v.created_at) as string) > since)
    .map(v => ({ ...v, is_current: !!v.is_current, content_json: v.content_json ? JSON.parse(v.content_json as string) : null, drawings: v.drawings ? JSON.parse(v.drawings as string) : {}, created_at: normalizeTimestamp(v.created_at as string), updated_at: normalizeTimestamp(v.updated_at as string) }));

  const nodeQuestions = (db.prepare('SELECT * FROM node_questions WHERE user_id = ?').all(userId) as DbRow[])
    .map(nq => ({ ...nq, created_at: normalizeTimestamp(nq.created_at as string) }));

  const topicsList = (db.prepare('SELECT * FROM topics WHERE user_id = ?').all(userId) as DbRow[])
    .filter(t => !since || toMillis((t.updated_at || t.created_at) as string) > since)
    .map(t => ({
      ...t,
      created_at: normalizeTimestamp(t.created_at as string),
      updated_at: normalizeTimestamp(t.updated_at as string),
      deleted_at: t.deleted_at ? normalizeTimestamp(t.deleted_at as string) : null,
      topic_questions: db.prepare('SELECT question_id, order_num, teacher_comment FROM topic_questions WHERE topic_id = ? AND user_id = ?').all(t.id, userId)
    }));

  const questionNotes = (db.prepare('SELECT * FROM question_notes WHERE user_id = ?').all(userId) as DbRow[])
    .filter(n => !since || toMillis((n.updated_at || n.created_at) as string) > since)
    .map(n => ({ ...n, created_at: normalizeTimestamp(n.created_at as string), updated_at: normalizeTimestamp(n.updated_at as string) }));

  const userSettings = settingsRow?.settings ? JSON.parse(settingsRow.settings) : null;

    res.json({ now: nowIso(), tags, questions, papers, similar_links, question_notes: questionNotes, settings: userSettings });
  } catch (e) {
    res.status(500).json({ error: '同步 pull 失败', detail: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/settings', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
    let settings: Record<string, unknown> = {};
    if (row?.settings) {
      try { settings = JSON.parse(row.settings); } catch { settings = {}; }
    }
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: '读取设置失败', detail: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/favorite-tags', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { items, order, rev } = req.body || {};
    if (!items || typeof items !== 'object' || Array.isArray(items) || items === null) {
      res.status(400).json({ error: 'items 格式不合法' });
      return;
    }
    const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
    let prev: Record<string, unknown> = {};
    if (row?.settings) {
      try { prev = JSON.parse(row.settings); } catch { prev = {}; }
    }
    const cur = (prev as Record<string, QuickFavSnapshot | undefined>).quickFavoriteTags;
    const local: QuickFavSnapshot = {
      items,
      order: order || { ids: [], at: '' },
      rev: Number(rev) || 0,
    };
    const result = mergeQuickFavTags(local, cur);
    if (result.conflicts.length > 0) {
      res.json({
        conflict: true,
        conflicts: result.conflicts,
        serverRev: Number(cur?.rev) || 0,
      });
      return;
    }
    const next = {
      items: result.merged.items,
      order: result.merged.order,
      rev: (Number(cur?.rev) || 0) + 1,
    };
    const mergedSettings = { ...prev, quickFavoriteTags: next };
    db.prepare('INSERT OR REPLACE INTO user_settings (user_id, settings) VALUES (?, ?)').run(userId, JSON.stringify(mergedSettings));
    res.json({ conflict: false, rev: next.rev, items: next.items, order: next.order });
  } catch (e) {
    res.status(500).json({ error: '保存常用标签失败', detail: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
