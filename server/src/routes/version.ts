import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const releasesDir = path.join(__dirname, '..', '..', 'releases');
if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir, { recursive: true });

router.get('/latest', (req, res) => {
  const row = db.prepare(
    "SELECT id, version_name, version_code, apk_filename, apk_size, release_notes, created_at FROM app_versions WHERE status = 'published' ORDER BY version_code DESC LIMIT 1"
  ).get() as { version_name: string; version_code: number; apk_filename: string; apk_size: number; release_notes: string; created_at: string } | undefined;
  if (!row) { res.json({ has_update: false }); return; }
  const clientCode = parseInt(req.query.current_code as string) || 0;
  res.json({
    has_update: row.version_code > clientCode,
    version_name: row.version_name,
    version_code: row.version_code,
    apk_filename: row.apk_filename,
    apk_size: row.apk_size,
    release_notes: row.release_notes,
    created_at: row.created_at,
    download_url: `/api/version/download/${row.apk_filename}`
  });
});

router.post('/publish', authMiddleware, (req, res) => {
  const { filename, version_name, version_code, release_notes } = req.body;
  if (!filename || !version_name || !version_code) {
    res.status(400).json({ error: 'filename, version_name, version_code 必填' });
    return;
  }

  const filePath = path.join(releasesDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `文件 ${filename} 不在 releases/ 目录中` });
    return;
  }

  const code = parseInt(version_code);
  if (isNaN(code)) { res.status(400).json({ error: 'version_code 必须是整数' }); return; }

  const existing = db.prepare("SELECT id FROM app_versions WHERE version_code = ?").get(code);
  if (existing) { res.status(400).json({ error: `version_code ${code} 已存在` }); return; }

  const stat = fs.statSync(filePath);
  const result = db.prepare(
    "INSERT INTO app_versions (version_name, version_code, apk_filename, apk_size, release_notes, status) VALUES (?, ?, ?, ?, ?, 'published')"
  ).run(version_name, code, filename, stat.size, release_notes || '');

  res.json({
    id: result.lastInsertRowid,
    version_name,
    version_code: code,
    apk_filename: filename,
    apk_size: stat.size,
    download_url: `/api/version/download/${filename}`
  });
});

router.get('/download/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const filePath = path.join(releasesDir, safe);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: '文件不存在' }); return; }
  res.download(filePath);
});

router.get('/list', (_req, res) => {
  const rows = db.prepare(
    "SELECT id, version_name, version_code, apk_filename, apk_size, release_notes, status, created_at FROM app_versions ORDER BY version_code DESC"
  ).all();
  res.json(rows);
});

router.put('/:id/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['draft', 'published'].includes(status)) { res.status(400).json({ error: 'status 必须是 draft 或 published' }); return; }
  db.prepare("UPDATE app_versions SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

export default router;
