import 'dotenv/config';
import './db/schema.js';

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { register, login, authMiddleware } from './middleware/auth.js';
import questionsRouter from './routes/questions.js';
import tagsRouter from './routes/tags.js';
import papersRouter from './routes/papers.js';
import syncRouter from './routes/sync.js';
import versionRouter from './routes/version.js';
import recoveryRouter from './routes/recovery.js';
import pdfsRouter from './routes/pdfs.js';
import pdfBooksRouter from './routes/pdf-books.js';
import pdfTopicsRouter from './routes/pdf-topics.js';
import wikiRouter from './routes/wiki.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors({ credentials: true }));

const isTest = process.env.NODE_ENV === 'test';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '注册次数过多，请稍后再试' },
});

app.use(express.json({ limit: '50mb' }));

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const previewsDir = path.join(uploadsDir, 'previews');
if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });
app.use('/pdf-previews', express.static(previewsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/register', registerLimiter, (req, res) => {
  const { phone, password, nickname } = req.body;
  if (!phone || !password) { res.status(400).json({ error: '手机号和密码必填' }); return; }
  const result = register(phone, password, nickname);
  if (result.error) { res.status(400).json(result); return; }
  res.json(result);
});

app.post('/api/login', authLimiter, (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) { res.status(400).json({ error: '手机号和密码必填' }); return; }
  const result = login(phone, password);
  if (result.error) { res.status(400).json(result); return; }
  res.json(result);
});

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: '未上传文件' }); return; }
  const url = '/uploads/' + req.file.filename;
  res.json({
    url,
    absolute_url: `${req.protocol}://${req.get('host')}${url}`
  });
});

app.use('/api/questions', questionsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/papers', papersRouter);
app.use('/api/sync', syncRouter);
app.use('/api/version', versionRouter);
app.use('/api/recovery', recoveryRouter);
app.use('/api/pdfs', pdfsRouter);
app.use('/api/pdf-books', pdfBooksRouter);
app.use('/api/pdf-topics', pdfTopicsRouter);
app.use('/api/wiki', wikiRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误', detail: err.message });
});

export default app;
