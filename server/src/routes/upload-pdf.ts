import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: '未上传文件' }); return; }
  const url = '/uploads/' + req.file.filename;
  res.json({
    url,
    absolute_url: `${req.protocol}://${req.get('host')}${url}`
  });
});

export default router;
