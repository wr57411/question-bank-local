import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const papers = db.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM paper_questions pq
      JOIN questions q ON q.id = pq.question_id
      WHERE pq.paper_id = p.id AND q.deleted_at IS NULL
    ) as question_count
    FROM papers p WHERE p.user_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC
  `).all((req as AuthRequest).userId);
  res.json(papers);
});

router.get('/:id', (req, res) => {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?').get(req.params.id, (req as AuthRequest).userId);
  if (!paper) { res.status(404).json({ error: '试卷不存在' }); return; }

  const questions = db.prepare(`
    SELECT q.* FROM paper_questions pq
    JOIN questions q ON pq.question_id = q.id
    WHERE pq.paper_id = ? AND q.deleted_at IS NULL
    ORDER BY pq.order_num
  `).all(req.params.id) as { id: string; question_tags?: unknown[] }[];

  const tagStmt = db.prepare(`
    SELECT t.* FROM question_tags qt
    JOIN tags t ON qt.tag_id = t.id
    WHERE qt.question_id = ? AND t.deleted_at IS NULL
  `);
  for (const q of questions) {
    q.question_tags = tagStmt.all(q.id).map(t => ({ tags: t }));
  }

  res.json({ paper, questions });
});

router.post('/', (req, res) => {
  const { id, name, tag_ids } = req.body;
  const pId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO papers (id, user_id, name, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(pId, (req as AuthRequest).userId, name);

  if (tag_ids && tag_ids.length) {
    const qIds = (db.prepare(`
      SELECT DISTINCT question_id FROM question_tags
      WHERE tag_id IN (${tag_ids.map(() => '?').join(',')})
    `).all(...tag_ids) as { question_id: string }[]).map(r => r.question_id);

    const stmt = db.prepare('INSERT OR IGNORE INTO paper_questions (paper_id, question_id, order_num) VALUES (?, ?, ?)');
    qIds.forEach((qId, i) => stmt.run(pId, qId, i + 1));
  }
  res.json({ id: pId });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE papers SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

export default router;
