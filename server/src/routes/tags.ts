import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY name').all((req as AuthRequest).userId);
  res.json(tags);
});

router.post('/', (req, res) => {
  const { id, name, color } = req.body;
  const tagId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO tags (id, user_id, name, color, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(tagId, (req as AuthRequest).userId, name, color || '#3B82F6');
  res.json({ id: tagId, name, color: color || '#3B82F6' });
});

router.delete('/:id', (req, res) => {
  db.prepare(`UPDATE tags SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, (req as AuthRequest).userId);
  res.json({ success: true });
});

export default router;
