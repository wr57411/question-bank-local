import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { normalizeAiMetadata, parseAiMetadata } from '../utils/helpers.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const includeDeleted = req.query.include_deleted === '1';
  const sql = includeDeleted
    ? 'SELECT * FROM questions WHERE user_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM questions WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC';
  const questions = db.prepare(sql).all((req as AuthRequest).userId) as { id: string; ai_metadata: unknown; question_tags?: unknown[] }[];

  const tagStmt = db.prepare(`
    SELECT t.* FROM question_tags qt
    JOIN tags t ON qt.tag_id = t.id
    WHERE qt.question_id = ? AND t.deleted_at IS NULL
  `);

  for (const q of questions) {
    q.ai_metadata = parseAiMetadata(q.ai_metadata);
    q.question_tags = tagStmt.all(q.id).map(t => ({ tags: t }));
  }
  res.json(questions);
});

router.post('/', (req, res) => {
  const { id, question_image_url, answer_image_url, layout_type, tag_ids, user_comment, semantic_summary, ai_metadata } = req.body;
  const qId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO questions (id, user_id, question_image_url, answer_image_url, layout_type, user_comment, semantic_summary, ai_metadata, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(qId, (req as AuthRequest).userId, question_image_url, answer_image_url || null, layout_type || 0, user_comment || '', semantic_summary || '', normalizeAiMetadata(ai_metadata));

  if (tag_ids && tag_ids.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)');
    for (const tagId of tag_ids) {
      stmt.run(qId, tagId);
    }
  }
  res.json({ id: qId });
});

router.put('/:id', (req, res) => {
  const { question_image_url, answer_image_url, layout_type, user_comment, semantic_summary, ai_metadata } = req.body;
  db.prepare(`UPDATE questions SET question_image_url = COALESCE(?, question_image_url),
    answer_image_url = COALESCE(?, answer_image_url), layout_type = COALESCE(?, layout_type),
    user_comment = COALESCE(?, user_comment), semantic_summary = COALESCE(?, semantic_summary), ai_metadata = COALESCE(?, ai_metadata),
    updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(question_image_url, answer_image_url, layout_type, user_comment, semantic_summary, ai_metadata == null ? null : normalizeAiMetadata(ai_metadata), req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE questions SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE questions SET deleted_at = NULL WHERE id = ? AND user_id = ?').run(req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

router.delete('/:id/permanent', (req, res) => {
  db.prepare('DELETE FROM question_tags WHERE question_id = ?').run(req.params.id);
  db.prepare('DELETE FROM paper_questions WHERE question_id = ?').run(req.params.id);
  db.prepare('DELETE FROM similar_question_links WHERE user_id = ? AND (question_id = ? OR similar_question_id = ?)').run((req as AuthRequest).userId, req.params.id, req.params.id);
  db.prepare('DELETE FROM questions WHERE id = ? AND user_id = ?').run(req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

router.post('/:id/tags', (req, res) => {
  const { tag_id } = req.body;
  db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)').run(req.params.id, tag_id);
  res.json({ success: true });
});

export default router;
