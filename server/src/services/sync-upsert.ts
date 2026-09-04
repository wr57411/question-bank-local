import db from '../db/connection.js';
import { normalizeTimestamp, toMillis, isIncomingNewer, normalizeAiMetadata, normalizeSimilarPair } from '../utils/helpers.js';

interface Record {
  id?: string;
  [key: string]: unknown;
}

export interface AppliedResult {
  tags: string[];
  questions: string[];
  papers: string[];
  similar_links: string[];
  purged_question_ids: string[];
  question_notes: string[];
}

export function createAppliedResult(): AppliedResult {
  return { tags: [], questions: [], papers: [], similar_links: [], purged_question_ids: [], question_notes: [] };
}

export function listQuestionTagIds(questionId: string, userId: string): string[] {
  return db.prepare(`
    SELECT qt.tag_id
    FROM question_tags qt
    JOIN tags t ON t.id = qt.tag_id
    WHERE qt.question_id = ? AND t.user_id = ? AND t.deleted_at IS NULL
    ORDER BY qt.tag_id
  `).all(questionId, userId).map((row) => (row as { tag_id: string }).tag_id);
}

export function listPaperQuestionIds(paperId: string, userId: string): string[] {
  return db.prepare(`
    SELECT pq.question_id
    FROM paper_questions pq
    JOIN questions q ON q.id = pq.question_id
    WHERE pq.paper_id = ? AND q.user_id = ?
    ORDER BY pq.order_num ASC, pq.question_id ASC
  `).all(paperId, userId).map((row) => (row as { question_id: string }).question_id);
}

function replaceQuestionTags(questionId: string, tagIds: string[]): void {
  db.prepare('DELETE FROM question_tags WHERE question_id = ?').run(questionId);
  const insert = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds || []) {
    insert.run(questionId, tagId);
  }
}

function replacePaperQuestions(paperId: string, questionIds: string[]): void {
  db.prepare('DELETE FROM paper_questions WHERE paper_id = ?').run(paperId);
  const insert = db.prepare('INSERT OR IGNORE INTO paper_questions (paper_id, question_id, order_num) VALUES (?, ?, ?)');
  let order = 1;
  for (const questionId of questionIds || []) {
    insert.run(paperId, questionId, order++);
  }
}

// ─── 通用 upsert 配置 ───────────────────────────────────────────────

interface UpsertConfig {
  table: string;
  requiredFields: string[];
  columns: string[];
  hasDeletedAt?: boolean;
  hasCreatedAt?: boolean;
  serialize?: (record: Record) => Record;
}

function upsertRecord(userId: string, record: Record, config: UpsertConfig): boolean {
  if (!record?.id) return false;
  for (const f of config.requiredFields) {
    if (!record[f]) return false;
  }

  const existing = db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND user_id = ?`).get(record.id, userId) as Record | undefined;

  const updatedAtPath = config.hasDeletedAt
    ? (record.updated_at || record.deleted_at || record.created_at)
    : (record.updated_at || record.created_at);
  const updatedAt = normalizeTimestamp(updatedAtPath as string);
  if (!isIncomingNewer(existing, updatedAt)) return false;

  const createdAt = normalizeTimestamp((record.created_at || existing?.created_at || updatedAt) as string);
  const deletedAt = config.hasDeletedAt && record.deleted_at ? normalizeTimestamp(record.deleted_at as string) : null;

  const data = config.serialize ? config.serialize(record) : record;
  const values = config.columns.map(c => {
    if (c === 'created_at') return createdAt;
    if (c === 'updated_at') return updatedAt;
    if (c === 'deleted_at') return deletedAt;
    if (c === 'user_id') return userId;
    return data[c] ?? null;
  });

  const colList = config.columns.join(', ');
  const placeholders = config.columns.map(() => '?').join(', ');
  const updates = config.columns.filter(c => c !== 'id' && c !== 'user_id').map(c => `${c}=excluded.${c}`).join(', ');

  db.prepare(`
    INSERT INTO ${config.table} (${colList}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}
  `).run(...values);

  return true;
}

// ─── 简单表的 upsert（配置驱动）─────────────────────────────────────

const TAG_COLUMNS = ['id', 'user_id', 'name', 'color', 'created_at', 'updated_at', 'deleted_at'];
const NOTE_COLUMNS = ['id', 'user_id', 'question_id', 'note_image_url', 'label', 'text_note', 'created_at', 'updated_at'];

export function upsertTag(userId: string, tag: Record): boolean {
  return upsertRecord(userId, tag, {
    table: 'tags',
    requiredFields: ['name'],
    columns: TAG_COLUMNS,
    hasDeletedAt: true,
    serialize: (r) => ({ ...r, color: (r.color as string) || '#3B82F6' }),
  });
}

export function upsertQuestionNote(userId: string, note: Record): boolean {
  return upsertRecord(userId, note, {
    table: 'question_notes',
    requiredFields: [],
    columns: NOTE_COLUMNS,
    hasDeletedAt: false,
  });
}

// ─── 特殊 upsert（保留独立实现）─────────────────────────────────────

export function upsertQuestion(userId: string, question: Record, applied: AppliedResult): boolean {
  if (!question?.id) return false;
  const existing = db.prepare('SELECT * FROM questions WHERE id = ? AND user_id = ?').get(question.id, userId) as Record | undefined;
  const updatedAt = normalizeTimestamp((question.updated_at || question.deleted_at || question.created_at) as string);
  if (!isIncomingNewer(existing, updatedAt)) return false;

  if (question.purged_at) {
    db.prepare('DELETE FROM question_tags WHERE question_id = ?').run(question.id);
    db.prepare('DELETE FROM paper_questions WHERE question_id = ?').run(question.id);
    db.prepare('DELETE FROM similar_question_links WHERE user_id = ? AND (question_id = ? OR similar_question_id = ?)').run(userId, question.id, question.id);
    db.prepare('DELETE FROM questions WHERE id = ? AND user_id = ?').run(question.id, userId);
    applied.purged_question_ids.push(question.id as string);
    return true;
  }

  const createdAt = normalizeTimestamp((question.created_at || existing?.created_at || updatedAt) as string);
  const deletedAt = question.deleted_at ? normalizeTimestamp(question.deleted_at as string) : null;

  let versions: string[];
  if (Array.isArray(question.versions) && question.versions.length > 0) {
    versions = question.versions as string[];
  } else if (typeof question.versions === 'string' && question.versions !== '[]' && question.versions !== '"[]"') {
    try { versions = JSON.parse(question.versions); } catch { versions = JSON.parse((existing?.versions as string) || '[]'); }
  } else {
    versions = JSON.parse((existing?.versions as string) || '[]');
  }

  if (existing) {
    db.prepare(`UPDATE questions SET question_image_url = ?, answer_image_url = ?, layout_type = ?, user_comment = ?, semantic_summary = ?, ai_metadata = ?, versions = ?, book_name = ?, page_number = ?, question_number = ?, created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND user_id = ?`)
      .run(question.question_image_url || null, question.answer_image_url || null, question.layout_type || 0, question.user_comment || '', question.semantic_summary || '', normalizeAiMetadata(question.ai_metadata), JSON.stringify(versions), question.book_name || '', question.page_number || '', question.question_number || '', createdAt, updatedAt, deletedAt, question.id, userId);
  } else {
    let insertVersions: string[];
    if (Array.isArray(question.versions)) {
      insertVersions = question.versions as string[];
    } else if (typeof question.versions === 'string') {
      try { insertVersions = JSON.parse(question.versions || '[]'); } catch { insertVersions = []; }
    } else {
      insertVersions = [];
    }
    db.prepare(`INSERT INTO questions (id, user_id, question_image_url, answer_image_url, layout_type, user_comment, semantic_summary, ai_metadata, versions, book_name, page_number, question_number, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(question.id, userId, question.question_image_url || null, question.answer_image_url || null, question.layout_type || 0, question.user_comment || '', question.semantic_summary || '', normalizeAiMetadata(question.ai_metadata), JSON.stringify(insertVersions), question.book_name || '', question.page_number || '', question.question_number || '', createdAt, updatedAt, deletedAt);
  }

  replaceQuestionTags(question.id as string, (question.tag_ids as string[]) || []);
  return true;
}

export function upsertSimilarLink(userId: string, link: Record): boolean {
  const pair = normalizeSimilarPair(link?.question_id as string, link?.similar_question_id as string);
  if (!pair) return false;
  const [questionId, similarQuestionId] = pair;
  const ownsBoth = db.prepare(`SELECT COUNT(*) as count FROM questions WHERE user_id = ? AND id IN (?, ?)`).get(userId, questionId, similarQuestionId) as { count: number };
  if (ownsBoth.count !== 2) return false;

  const existing = db.prepare(`SELECT * FROM similar_question_links WHERE user_id = ? AND question_id = ? AND similar_question_id = ?`).get(userId, questionId, similarQuestionId) as Record | undefined;
  const updatedAt = normalizeTimestamp((link.updated_at || link.deleted_at || link.created_at) as string);
  if (!isIncomingNewer(existing, updatedAt)) return false;

  const createdAt = normalizeTimestamp((link.created_at || existing?.created_at || updatedAt) as string);
  const deletedAt = link.deleted_at ? normalizeTimestamp(link.deleted_at as string) : null;
  db.prepare(`INSERT INTO similar_question_links (question_id, similar_question_id, user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(question_id, similar_question_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`)
    .run(questionId, similarQuestionId, userId, createdAt, updatedAt, deletedAt);
  return true;
}

export function upsertNodeQuestion(userId: string, nq: Record): boolean {
  if (!nq?.id) return false;
  const existing = db.prepare('SELECT * FROM node_questions WHERE id = ? AND user_id = ?').get(nq.id, userId);
  if (existing) return false;
  db.prepare('INSERT INTO node_questions (id, user_id, node_id, question_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(nq.id, userId, nq.node_id || '', nq.question_id || '', normalizeTimestamp(nq.created_at as string));
  return true;
}

export function upsertPaper(userId: string, paper: Record): boolean {
  if (!paper?.id || !paper.name) return false;
  const existing = db.prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?').get(paper.id, userId) as Record | undefined;
  const updatedAt = normalizeTimestamp((paper.updated_at || paper.deleted_at || paper.created_at) as string);
  if (!isIncomingNewer(existing, updatedAt)) return false;

  const createdAt = normalizeTimestamp((paper.created_at || existing?.created_at || updatedAt) as string);
  const deletedAt = paper.deleted_at ? normalizeTimestamp(paper.deleted_at as string) : null;

  if (existing) {
    db.prepare(`UPDATE papers SET name = ?, created_at = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND user_id = ?`)
      .run(paper.name, createdAt, updatedAt, deletedAt, paper.id, userId);
  } else {
    db.prepare(`INSERT INTO papers (id, user_id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(paper.id, userId, paper.name, createdAt, updatedAt, deletedAt);
  }

  replacePaperQuestions(paper.id as string, (paper.question_ids as string[]) || []);
  return true;
}
