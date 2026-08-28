import { Router } from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const isTest = process.env.NODE_ENV === 'test';
const issueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '反馈提交过于频繁，请稍后再试' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅支持图片附件'));
  },
});

export interface IssueMetadata {
  platform?: string;
  ua?: string;
  version_code?: number;
  version_name?: string;
  page?: string;
  client_time?: string;
}

export function buildIssueBody(description: string, metadata: IssueMetadata | null, imageUrl: string | null): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (imageUrl) parts.push('![screenshot](' + imageUrl + ')');
  const meta = metadata || {};
  const clean = (v: unknown) => String(v ?? '').replace(/[|\n\r`]/g, ' ');
  const lines = [
    '| 项目 | 值 |',
    '| --- | --- |',
    '| App 版本 | ' + clean(meta.version_name || '?') + ' (code ' + clean(String(meta.version_code ?? '?')) + ') |',
    '| 平台 | ' + clean(meta.platform || '?') + ' |',
    '| 页面 | ' + clean(meta.page || '-') + ' |',
    '| 客户端时间 | ' + clean(meta.client_time || '-') + ' |',
  ];
  parts.push('<details><summary>设备信息</summary>\n\n' + lines.join('\n') + '\n\nUA: `' + clean(meta.ua || '-') + '`\n\n</details>');
  return parts.join('\n\n');
}

const GH_API = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');

function ghConfig() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',
    branch: process.env.GITHUB_FEEDBACK_BRANCH || 'feedback-assets',
    baseBranch: process.env.GITHUB_BASE_BRANCH || 'main',
    labels: (process.env.GITHUB_ISSUE_LABELS || 'user-feedback').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

let uploadChain: Promise<unknown> = Promise.resolve();

function ghFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(GH_API + path, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export async function ensureAssetBranch(repo: string, token: string, branch: string, baseBranch: string): Promise<string> {
  const refResp = await ghFetch('/repos/' + repo + '/git/ref/heads/' + branch, token);
  if (refResp.ok) {
    const ref = await refResp.json();
    return ref.object.sha;
  }
  const baseResp = await ghFetch('/repos/' + repo + '/git/ref/heads/' + baseBranch, token);
  if (!baseResp.ok) throw new Error('无法读取基础分支 ' + baseBranch + ' (HTTP ' + baseResp.status + ')');
  const base = await baseResp.json();
  const createResp = await ghFetch('/repos/' + repo + '/git/refs', token, {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: base.object.sha }),
  });
  if (!createResp.ok) throw new Error('创建反馈分支失败 (HTTP ' + createResp.status + ')');
  return base.object.sha;
}

export async function uploadImageToRepo(
  repo: string, token: string, branch: string, baseSha: string, fileName: string, base64Content: string
): Promise<string> {
  const blobResp = await ghFetch('/repos/' + repo + '/git/blobs', token, {
    method: 'POST',
    body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
  });
  if (!blobResp.ok) throw new Error('创建 blob 失败 (HTTP ' + blobResp.status + ')');
  const blob = await blobResp.json();

  const commitResp = await ghFetch('/repos/' + repo + '/git/commits/' + baseSha, token);
  if (!commitResp.ok) throw new Error('读取基提交失败 (HTTP ' + commitResp.status + ')');
  const baseCommit = await commitResp.json();

  const path = 'screenshots/' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '/' + fileName;
  const treeResp = await ghFetch('/repos/' + repo + '/git/trees', token, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
    }),
  });
  if (!treeResp.ok) throw new Error('创建 tree 失败 (HTTP ' + treeResp.status + ')');
  const tree = await treeResp.json();

  const newCommitResp = await ghFetch('/repos/' + repo + '/git/commits', token, {
    method: 'POST',
    body: JSON.stringify({ message: 'chore: add feedback screenshot ' + fileName, tree: tree.sha, parents: [baseSha] }),
  });
  if (!newCommitResp.ok) throw new Error('创建提交失败 (HTTP ' + newCommitResp.status + ')');
  const newCommit = await newCommitResp.json();

  const patchResp = await ghFetch('/repos/' + repo + '/git/refs/heads/' + branch, token, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!patchResp.ok) throw new Error('更新分支引用失败 (HTTP ' + patchResp.status + ')');
  return 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + path;
}

export async function createIssue(
  repo: string, token: string, title: string, body: string, labels: string[]
): Promise<{ number: number; html_url: string }> {
  const resp = await ghFetch('/repos/' + repo + '/issues', token, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error('创建 Issue 失败 (HTTP ' + resp.status + '): ' + (data.message || ''));
  return { number: data.number, html_url: data.html_url };
}

router.post('/', issueLimiter, upload.single('screenshot'), async (req, res) => {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.repo) {
    res.status(503).json({ error: '服务端未配置 GitHub（GITHUB_TOKEN / GITHUB_REPO）' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 4000) : '';
  if (!title) {
    res.status(400).json({ error: '标题必填' });
    return;
  }
  let metadata: IssueMetadata | null = null;
  if (typeof req.body?.metadata === 'string' && req.body.metadata) {
    try { metadata = JSON.parse(req.body.metadata); } catch { metadata = null; }
  }
  try {
    let imageUrl: string | null = null;
    if (req.file) {
      const buffer = req.file.buffer.toString('base64');
      const safeName = (Date.now() + '-' + req.file.originalname.replace(/[^\w.-]/g, '_')).slice(0, 100);
      const task = uploadChain.then(() =>
        ensureAssetBranch(cfg.repo, cfg.token, cfg.branch, cfg.baseBranch).then((baseSha) =>
          uploadImageToRepo(cfg.repo, cfg.token, cfg.branch, baseSha, safeName, buffer)
        )
      );
      uploadChain = task.catch(() => {});
      imageUrl = await task;
    }
    const body = buildIssueBody(description, metadata, imageUrl);
    const issue = await createIssue(cfg.repo, cfg.token, '[App反馈] ' + title, body, cfg.labels);
    res.json({ success: true, issue_number: issue.number, issue_url: issue.html_url, image_url: imageUrl });
  } catch (e: any) {
    console.error('[issues] GitHub 提交失败:', e.message);
    res.status(502).json({ error: 'GitHub 提交失败', detail: e.message });
  }
});

router.use((err: any, _req: Request, res: ExpressResponse, _next: NextFunction) => {
  const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  res.status(status).json({ error: err?.code === 'LIMIT_FILE_SIZE' ? '截图超过 5MB' : (err?.message || '上传文件无效') });
});

export default router;
