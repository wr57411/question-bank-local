import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const topics = db.prepare('SELECT * FROM pdf_topics WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at').all(userId);
  res.json(topics);
});

router.post('/', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { id, name, parent_id, sort_order } = req.body;
  const topicId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO pdf_topics (id, user_id, name, parent_id, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(topicId, userId, name, parent_id || null, sort_order || 0);
  res.json({ id: topicId, name, parent_id: parent_id || null, sort_order: sort_order || 0 });
});

router.put('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { name, parent_id, sort_order } = req.body;
  db.prepare(`UPDATE pdf_topics SET name = COALESCE(?, name), parent_id = ?, sort_order = COALESCE(?, sort_order), updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(name || null, parent_id !== undefined ? (parent_id || null) : null, sort_order !== undefined ? sort_order : null, req.params.id, userId);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE pdf_topics SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

export default router;
