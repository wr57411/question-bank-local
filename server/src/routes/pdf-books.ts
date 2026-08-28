import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const books = db.prepare('SELECT * FROM pdf_books WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at').all(userId) as { id: string; chapters?: unknown[] }[];
  const chapterStmt = db.prepare('SELECT * FROM pdf_chapters WHERE book_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY sort_order');
  for (const book of books) {
    book.chapters = chapterStmt.all(book.id, userId);
  }
  res.json(books);
});

router.post('/', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { id, name } = req.body;
  const bookId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO pdf_books (id, user_id, name, updated_at) VALUES (?, ?, ?, datetime('now'))`).run(bookId, userId, name);
  res.json({ id: bookId, name });
});

router.put('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { name } = req.body;
  db.prepare(`UPDATE pdf_books SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(name, req.params.id, userId);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE pdf_books SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  db.prepare(`UPDATE pdf_chapters SET deleted_at = datetime('now') WHERE book_id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

router.post('/chapters', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { id, book_id, parent_id, name, sort_order } = req.body;
  const chapterId = id || uuidv4();
  db.prepare(`INSERT OR REPLACE INTO pdf_chapters (id, user_id, book_id, parent_id, name, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(chapterId, userId, book_id, parent_id || null, name, sort_order || 0);
  res.json({ id: chapterId, book_id, parent_id: parent_id || null, name, sort_order: sort_order || 0 });
});

router.put('/chapters/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { name, parent_id, sort_order } = req.body;
  db.prepare(`UPDATE pdf_chapters SET name = COALESCE(?, name), parent_id = ?, sort_order = COALESCE(?, sort_order), updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(name || null, parent_id !== undefined ? parent_id : null, sort_order !== undefined ? sort_order : null, req.params.id, userId);
  res.json({ success: true });
});

router.delete('/chapters/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE pdf_chapters SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

export default router;
