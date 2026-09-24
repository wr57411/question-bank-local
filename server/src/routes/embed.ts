import { Router } from 'express';
import db from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const DEFAULT_EMBED_BASE = 'http://127.0.0.1:3002';
const MODEL_TAG = 'wemm-embedding-2b';

export function embedBaseFor(engineId: string): string {
  if (engineId) {
    const key = `EMBED_SERVICE_URL__${engineId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const scoped = process.env[key];
    if (scoped) return scoped;
  }
  return process.env.EMBED_SERVICE_URL || DEFAULT_EMBED_BASE;
}

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

export function filterVectorsByEngine(
  rows: { engine_id: string; question_id: string; dim: number; vector: Buffer }[],
  engineId: string,
) {
  return rows
    .filter((r) => r.engine_id === engineId)
    .map((r) => ({ question_id: r.question_id, dim: r.dim, vector: Buffer.from(r.vector).toString('base64') }));
}

export function buildFingerprint(h: Record<string, unknown>): string {
  const keys = ['model_path', 'device', 'dtype', 'torch', 'transformers'];
  return keys.map((k) => `${k}=${String(h[k] ?? '')}`).join('|');
}

async function fetchEngineHealth(
  engineId: string,
): Promise<{ reachable: boolean; health: Record<string, unknown> }> {
  try {
    const resp = await fetch(`${embedBaseFor(engineId)}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { reachable: false, health: {} };
    return { reachable: true, health: (await resp.json()) as Record<string, unknown> };
  } catch {
    return { reachable: false, health: {} };
  }
}

router.post('/text', async (req, res) => {
  const errors = validateTexts(req.body?.texts);
  if (errors.length) {
    res.status(400).json({ error: errors[0] });
    return;
  }
  const engineId = String(req.query.engineId || '');
  try {
    const resp = await fetch(`${embedBaseFor(engineId)}/encode-text`, {
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
  const engineId = String(req.query.engineId || '');
  try {
    const resp = await fetch(`${embedBaseFor(engineId)}/encode-images`, {
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

router.get('/vectors', (req, res) => {
  const engineId = String(req.query.engineId || '');
  if (!engineId) {
    res.status(400).json({ error: '缺少 engineId' });
    return;
  }
  const rows = db
    .prepare('SELECT engine_id, question_id, dim, vector FROM question_embeddings WHERE engine_id = ?')
    .all(engineId) as { engine_id: string; question_id: string; dim: number; vector: Buffer }[];
  const embeddings = filterVectorsByEngine(rows, engineId);
  res.json({ engineId, model: MODEL_TAG, count: embeddings.length, embeddings });
});

router.get('/engines', async (_req, res) => {
  const ids = (
    db
      .prepare("SELECT DISTINCT engine_id FROM question_embeddings WHERE engine_id <> 'legacy-default'")
      .all() as { engine_id: string }[]
  ).map((r) => r.engine_id);
  const engines = await Promise.all(
    ids.map(async (id) => {
      const { reachable, health } = await fetchEngineHealth(id);
      return { id, fingerprint: reachable ? buildFingerprint(health) : '', reachable };
    }),
  );
  res.json(engines);
});

router.get('/health', async (req, res) => {
  const engineId = String(req.query.engineId || '');
  if (!engineId) {
    res.status(400).json({ error: '缺少 engineId' });
    return;
  }
  const { reachable, health } = await fetchEngineHealth(engineId);
  if (!reachable) {
    res.status(503).json({ error: '语义编码服务不可用' });
    return;
  }
  res.json({ ...health, engineId, fingerprint: buildFingerprint(health) });
});

export default router;
