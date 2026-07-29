import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { isEnabled, startBackgroundSync, getSyncStatus } from '../services/replicate.js';
import { getServerSyncStatus, startPullFromPrimary } from '../services/server-sync.js';

const router = Router();
router.use(authMiddleware);

router.get('/status', (_req, res) => {
  const sync = getSyncStatus() as { in_progress: boolean; last_result: unknown };
  res.json({
    supabase_enabled: isEnabled(),
    sync_in_progress: sync.in_progress,
    last_result: sync.last_result,
    timestamp: new Date().toISOString()
  });
});

router.post('/sync-to-supabase', (_req, res) => {
  if (!isEnabled()) {
    res.status(400).json({ error: 'Supabase 未配置，请设置 SUPABASE_URL 和 SUPABASE_KEY 环境变量' });
    return;
  }
  const result = startBackgroundSync();
  res.json(result);
});

router.get('/server-sync-status', (_req, res) => {
  res.json(getServerSyncStatus());
});

router.post('/sync-from-primary', (_req, res) => {
  const result = startPullFromPrimary();
  res.json(result);
});

export default router;
