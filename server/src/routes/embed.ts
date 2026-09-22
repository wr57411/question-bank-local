import { Router } from 'express';
import db from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const EMBED_BASE = process.env.EMBED_SERVICE_URL || 'http://127.0.0.1:3002';
const MODEL_TAG = 'wemm-embedding-2b';

export function validateTexts(texts: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 8) {
    errors.push('texts 必须为 1-8 个字符串');
    return errors;
  }
  if (texts.some((t) => typeof t !== 'string' || (t as string).length > 200)) {
    errors.push('每条文本必须是不超过 200 字的字符串');
  }
  return errors;
}

router.post('/text', async (req, res) => {
  const errors = validateTexts(req.body?.texts);
  if (errors.length) {
    res.status(400).json({ error: errors[0] });
    return;
  }
  try {
    const resp = await fetch(`${EMBED_BASE}/encode-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: req.body.texts }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) {
      res.status(502).json({ error: `编码服务返回 ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { dim: number; vectors: number[][] };
    res.json(data);
  } catch {
    res.status(503).json({ error: '语义编码服务不可用' });
  }
});

router.post('/image', async (req, res) => {
  const image = req.body?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 10 * 1024 * 1024) {
    res.status(400).json({ error: 'image 必须是 10MB 内的图片 data URL' });
    return;
  }
  try {
    const resp = await fetch(`${EMBED_BASE}/encode-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [image] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      res.status(502).json({ error: `编码服务返回 ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { dim: number; vectors: number[][] };
    res.json(data);
  } catch {
    res.status(503).json({ error: '语义编码服务不可用' });
  }
});

router.get('/vectors', (_req, res) => {
  const rows = db
    .prepare('SELECT question_id, dim, vector FROM question_embeddings WHERE model = ?')
    .all(MODEL_TAG) as { question_id: string; dim: number; vector: Buffer }[];
  const embeddings = rows.map((r) => ({
    question_id: r.question_id,
    dim: r.dim,
    vector: Buffer.from(r.vector).toString('base64'),
  }));
  res.json({ model: MODEL_TAG, count: embeddings.length, embeddings });
});

export default router;
