import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

interface WikiPageRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  canonical_title: string;
  aliases: string;
  summary: string;
  content: string;
  latex_formulas: string;
  key_conditions: string;
  common_mistakes: string;
  related_page_ids: string;
  source_ids: string;
  source_snippets: string;
  confidence: number;
  review_status: string;
  generated_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

interface WikiLinkRow {
  id: string;
  user_id: string;
  source_page_id: string;
  target_page_id: string;
  relation: string;
  description: string;
  created_at: string;
  deleted_at: string | null;
}

function parsePage(row: WikiPageRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    canonical_title: row.canonical_title,
    aliases: JSON.parse(row.aliases || '[]'),
    summary: row.summary,
    content: row.content,
    latex_formulas: JSON.parse(row.latex_formulas || '[]'),
    key_conditions: JSON.parse(row.key_conditions || '[]'),
    common_mistakes: JSON.parse(row.common_mistakes || '[]'),
    related_page_ids: JSON.parse(row.related_page_ids || '[]'),
    source_ids: JSON.parse(row.source_ids || '[]'),
    source_snippets: JSON.parse(row.source_snippets || '[]'),
    confidence: row.confidence,
    review_status: row.review_status,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    version: row.version,
    deleted_at: row.deleted_at,
  };
}

function parseLink(row: WikiLinkRow) {
  return {
    id: row.id,
    source_page_id: row.source_page_id,
    target_page_id: row.target_page_id,
    relation: row.relation,
    description: row.description,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

router.get('/pages', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const rows = db.prepare('SELECT * FROM wiki_pages WHERE user_id = ? AND deleted_at IS NULL ORDER BY canonical_title').all(userId) as WikiPageRow[];
  res.json(rows.map(parsePage));
});

router.get('/pages/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, userId) as WikiPageRow | undefined;
  if (!row) { res.status(404).json({ error: '页面不存在' }); return; }
  res.json(parsePage(row));
});

router.get('/links', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const rows = db.prepare('SELECT * FROM wiki_links WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at').all(userId) as WikiLinkRow[];
  res.json(rows.map(parseLink));
});

router.get('/graph', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const pages = db.prepare('SELECT id, title, type, source_ids, review_status FROM wiki_pages WHERE user_id = ? AND deleted_at IS NULL').all(userId) as { id: string; title: string; type: string; source_ids: string; review_status: string }[];
  const links = db.prepare('SELECT source_page_id, target_page_id, relation FROM wiki_links WHERE user_id = ? AND deleted_at IS NULL').all(userId) as { source_page_id: string; target_page_id: string; relation: string }[];

  const nodes = pages.map(p => ({
    id: p.id,
    title: p.title,
    type: p.type,
    source_count: JSON.parse(p.source_ids || '[]').length,
    review_status: p.review_status,
  }));

  const edges = links.map(l => ({
    source: l.source_page_id,
    target: l.target_page_id,
    relation: l.relation,
  }));

  res.json({ nodes, edges });
});

router.post('/pages', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { id, type, title, canonical_title, aliases, summary, content, latex_formulas, key_conditions, common_mistakes, related_page_ids, source_ids, source_snippets, confidence, review_status, generated_at, updated_at, version } = req.body;
  const pageId = id || uuidv4();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM wiki_pages WHERE id = ? AND user_id = ?').get(pageId, userId) as WikiPageRow | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO wiki_pages
      (id, user_id, type, title, canonical_title, aliases, summary, content, latex_formulas, key_conditions, common_mistakes, related_page_ids, source_ids, source_snippets, confidence, review_status, generated_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pageId, userId, type, title, canonical_title, JSON.stringify(aliases || []), summary || '', content || '', JSON.stringify(latex_formulas || []), JSON.stringify(key_conditions || []), JSON.stringify(common_mistakes || []), JSON.stringify(related_page_ids || []), JSON.stringify(source_ids || []), JSON.stringify(source_snippets || []), confidence || 0, review_status || 'auto', generated_at || now, updated_at || now, version || 1);
    res.json({ id: pageId, action: 'created' });
    return;
  }

  const unionJson = (a: string, b: string): string[] => {
    const set = new Set<string>(JSON.parse(a || '[]'));
    for (const x of JSON.parse(b || '[]')) set.add(x);
    return [...set];
  };

  const mergedAliases = unionJson(existing.aliases, JSON.stringify(aliases || []));
  const mergedSourceIds = unionJson(existing.source_ids, JSON.stringify(source_ids || []));
  const mergedSnippets = unionJson(existing.source_snippets, JSON.stringify(source_snippets || []));
  const mergedRelated = unionJson(existing.related_page_ids, JSON.stringify(related_page_ids || []));

  const incomingVersion = typeof version === 'number' ? version : (version ? Number(version) : 1) || 1;
  const existingVersion = existing.version || 1;

  let finalContent = existing.content || '';
  let finalSummary = existing.summary || '';
  let finalLatex = existing.latex_formulas || '[]';
  let finalConditions = existing.key_conditions || '[]';
  let finalMistakes = existing.common_mistakes || '[]';
  let finalReviewStatus = existing.review_status || 'auto';
  let finalConfidence = existing.confidence ?? 0;
  let finalVersion = existingVersion;

  if (incomingVersion > existingVersion) {
    finalContent = content ?? existing.content ?? '';
    finalSummary = summary ?? existing.summary ?? '';
    finalLatex = JSON.stringify(latex_formulas || JSON.parse(existing.latex_formulas || '[]'));
    finalConditions = JSON.stringify(key_conditions || JSON.parse(existing.key_conditions || '[]'));
    finalMistakes = JSON.stringify(common_mistakes || JSON.parse(existing.common_mistakes || '[]'));
    finalReviewStatus = review_status || existing.review_status || 'auto';
    finalConfidence = confidence ?? existing.confidence ?? 0;
    finalVersion = incomingVersion;
  } else if (incomingVersion === existingVersion) {
    const incContent = content || '';
    if (incContent && incContent !== existing.content) {
      finalReviewStatus = 'needs_merge';
      finalContent = incContent.length >= (existing.content || '').length ? incContent : (existing.content || '');
    }
    const incSummary = summary || '';
    if (incSummary && incSummary !== existing.summary) {
      finalSummary = incSummary.length >= (existing.summary || '').length ? incSummary : (existing.summary || '');
    }
    finalVersion = existingVersion + 1;
  }

  db.prepare(`
    UPDATE wiki_pages SET
      aliases = ?, summary = ?, content = ?, latex_formulas = ?, key_conditions = ?, common_mistakes = ?, related_page_ids = ?, source_ids = ?, source_snippets = ?, confidence = ?, review_status = ?, updated_at = ?, version = ?
    WHERE id = ? AND user_id = ?
  `).run(
    JSON.stringify(mergedAliases),
    finalSummary,
    finalContent,
    finalLatex,
    finalConditions,
    finalMistakes,
    JSON.stringify(mergedRelated),
    JSON.stringify(mergedSourceIds),
    JSON.stringify(mergedSnippets),
    finalConfidence,
    finalReviewStatus,
    now,
    finalVersion,
    pageId, userId
  );
  res.json({ id: pageId, action: 'merged' });
});

router.post('/links', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { id, source_page_id, target_page_id, relation, description, created_at } = req.body;
  const linkId = id || uuidv4();

  const dup = db.prepare('SELECT id FROM wiki_links WHERE user_id = ? AND source_page_id = ? AND target_page_id = ? AND relation = ? AND deleted_at IS NULL').get(userId, source_page_id, target_page_id, relation) as { id: string } | undefined;
  if (dup) {
    res.json({ id: dup.id, action: 'duplicate' });
    return;
  }

  db.prepare(`
    INSERT OR REPLACE INTO wiki_links
    (id, user_id, source_page_id, target_page_id, relation, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(linkId, userId, source_page_id, target_page_id, relation, description || '', created_at || new Date().toISOString());
  res.json({ id: linkId, action: 'created' });
});

router.delete('/pages/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE wiki_pages SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

router.delete('/links/:id', (req, res) => {
  const userId = (req as AuthRequest).userId;
  db.prepare(`UPDATE wiki_links SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, userId);
  res.json({ success: true });
});

router.patch('/pages/:id/review', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { review_status } = req.body;
  db.prepare(`UPDATE wiki_pages SET review_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(review_status, req.params.id, userId);
  res.json({ success: true });
});

export default router;
