import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getPdfPageCount, renderPdfPages } from '../services/pdf-render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfUploadDir = path.join(__dirname, '..', '..', 'uploads', 'pdfs');
if (!fs.existsSync(pdfUploadDir)) fs.mkdirSync(pdfUploadDir, { recursive: true });

const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, pdfUploadDir),
  filename: (_req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const pdfUpload = multer({ storage: pdfStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

router.post('/upload', pdfUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: '未上传文件' }); return; }
    const userId = (req as AuthRequest).userId;
    const id = path.basename(req.file.filename, path.extname(req.file.filename));
    const serverPath = '/uploads/pdfs/' + req.file.filename;
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const originalName = req.body.filename || req.file.originalname;

    let pageCount = 0;
    try { pageCount = await getPdfPageCount(filePath); } catch { pageCount = 0; }

    db.prepare(`INSERT INTO pdf_docs (id, user_id, filename, page_count, file_size, server_path, chapter_id, topic_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, originalName, pageCount, fileSize, serverPath, req.body.chapter_id || null, req.body.topic_id || null);

    res.json({ id, filename: originalName, page_count: pageCount, file_size: fileSize, server_path: serverPath });
  } catch (e) {
    res.status(500).json({ error: '上传失败: ' + (e as Error).message });
  }
});

router.get('/', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const docs = db.prepare('SELECT * FROM pdf_docs WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(userId) as { id: string; tag_ids?: string[] }[];
  const tagStmt = db.prepare('SELECT tag_id FROM pdf_doc_tags WHERE pdf_id = ?');
  for (const doc of docs) {
    doc.tag_ids = (tagStmt.all(doc.id) as { tag_id: string }[]).map(r => r.tag_id);
  }
  res.json(docs);
});

router.get('/:id/pages', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const doc = db.prepare('SELECT * FROM pdf_docs WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, userId) as { server_path: string; page_count: number } | undefined;
    if (!doc) { res.status(404).json({ error: 'PDF 不存在' }); return; }

    const from = Math.max(1, parseInt(req.query.from as string) || 1);
    const to = Math.min(doc.page_count, parseInt(req.query.to as string) || from + 2);

    const filePath = path.join(__dirname, '..', '..', doc.server_path);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: '文件不存在' }); return; }

    const pages = await renderPdfPages(filePath, from, to);
    res.json({ pages, total_pages: doc.page_count });
  } catch (e) {
    res.status(500).json({ error: '渲染失败: ' + (e as Error).message });
  }
});

router.get('/:id/download', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const doc = db.prepare('SELECT * FROM pdf_docs WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, userId) as { server_path: string; filename: string } | undefined;
  if (!doc) { res.status(404).json({ error: 'PDF 不存在' }); return; }

  const filePath = path.resolve(path.join(__dirname, '..', '..', doc.server_path));
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: '文件不存在' }); return; }

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  res.setHeader('Content-Type', 'application/pdf');
  fs.createReadStream(filePath).pipe(res);
});

router.put('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { filename, chapter_id, topic_id, category_id } = req.body;
  db.prepare(`UPDATE pdf_docs SET filename = COALESCE(?, filename), chapter_id = ?, topic_id = ?, category_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(filename || null, chapter_id !== undefined ? chapter_id : null, topic_id !== undefined ? topic_id : null, category_id !== undefined ? category_id : null, req.params.id, userId);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE pdf_docs SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

router.post('/:id/tags', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { tag_ids = [] } = req.body;
  const doc = db.prepare('SELECT id FROM pdf_docs WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, userId);
  if (!doc) { res.status(404).json({ error: 'PDF 不存在' }); return; }

  db.prepare('DELETE FROM pdf_doc_tags WHERE pdf_id = ?').run(req.params.id);
  const insert = db.prepare('INSERT OR IGNORE INTO pdf_doc_tags (pdf_id, tag_id) VALUES (?, ?)');
  for (const tagId of tag_ids) {
    insert.run(req.params.id, tagId);
  }
  res.json({ success: true });
});

export default router;
