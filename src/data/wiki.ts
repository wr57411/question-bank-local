import { dbWikiPages, dbWikiLinks, dbCompileJobs, dbWikiLog, generateId, nowIso } from './stores';
import type { WikiPage, WikiLink, CompileJob } from '../types';
import { resolveEntity, mergeIntoExistingPage } from '../services/wiki-entity';

// ===== WikiPage CRUD =====

export async function wikiGetPage(id: string): Promise<WikiPage | null> {
  return (await dbWikiPages.getItem(id)) as WikiPage | null;
}

export async function wikiGetAllPages(includeDeleted = false): Promise<WikiPage[]> {
  const pages: WikiPage[] = [];
  await dbWikiPages.iterate((v: unknown) => {
    const p = v as WikiPage;
    if (p && (!p.deleted_at || includeDeleted)) pages.push(p);
  });
  return pages;
}

export async function wikiGetPagesByReviewStatus(status: WikiPage['review_status']): Promise<WikiPage[]> {
  const pages: WikiPage[] = [];
  await dbWikiPages.iterate((v: unknown) => {
    const p = v as WikiPage;
    if (p && !p.deleted_at && p.review_status === status) pages.push(p);
  });
  return pages;
}

export async function wikiGetCanonicalPage(canonicalTitle: string): Promise<WikiPage | null> {
  let found: WikiPage | null = null;
  await dbWikiPages.iterate((v: unknown) => {
    const p = v as WikiPage;
    if (p && !p.deleted_at && p.canonical_title === canonicalTitle) found = p;
  });
  return found;
}

export async function wikiGetPendingReviews(limit = 20): Promise<WikiPage[]> {
  const pages: WikiPage[] = [];
  await dbWikiPages.iterate((v: unknown) => {
    const p = v as WikiPage;
    if (p && !p.deleted_at && (p.review_status === 'auto' || p.review_status === 'needs_merge')) {
      pages.push(p);
    }
  });
  return pages.slice(0, limit);
}

export async function wikiPutPage(page: WikiPage): Promise<void> {
  await dbWikiPages.setItem(page.id, page);
}

export async function wikiSoftDeletePage(id: string): Promise<void> {
  const page = await wikiGetPage(id);
  if (page) {
    page.deleted_at = nowIso();
    page.updated_at = nowIso();
    await dbWikiPages.setItem(id, page);
  }
}

export async function wikiHardDeletePage(id: string): Promise<void> {
  await dbWikiPages.removeItem(id);
}

export async function wikiUpdateReviewStatus(id: string, status: WikiPage['review_status']): Promise<void> {
  const page = await wikiGetPage(id);
  if (page) {
    page.review_status = status;
    page.updated_at = nowIso();
    await dbWikiPages.setItem(id, page);
  }
}

// ===== WikiLink CRUD =====

export async function wikiGetLinks(includeDeleted = false): Promise<WikiLink[]> {
  const links: WikiLink[] = [];
  await dbWikiLinks.iterate((v: unknown) => {
    const l = v as WikiLink;
    if (l && (!l.deleted_at || includeDeleted)) links.push(l);
  });
  return links;
}

export async function wikiGetLinksForPage(pageId: string): Promise<WikiLink[]> {
  const links: WikiLink[] = [];
  await dbWikiLinks.iterate((v: unknown) => {
    const l = v as WikiLink;
    if (l && !l.deleted_at && (l.source_page_id === pageId || l.target_page_id === pageId)) {
      links.push(l);
    }
  });
  return links;
}

export async function wikiPutLink(link: WikiLink): Promise<void> {
  await dbWikiLinks.setItem(link.id, link);
}

export async function wikiSoftDeleteLink(id: string): Promise<void> {
  const link = await dbWikiLinks.getItem(id) as WikiLink | null;
  if (link) {
    link.deleted_at = nowIso();
    await dbWikiLinks.setItem(id, link);
  }
}

// ===== CompileJob CRUD =====

export async function wikiGetPendingJobs(limit = 50): Promise<CompileJob[]> {
  const jobs: CompileJob[] = [];
  await dbCompileJobs.iterate((v: unknown) => {
    const j = v as CompileJob;
    if (j && (j.status === 'pending' || j.status === 'processing')) {
      jobs.push(j);
    }
  });
  return jobs.slice(0, limit).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function wikiPutJob(job: CompileJob): Promise<void> {
  await dbCompileJobs.setItem(job.id, job);
}

export async function wikiCreatePendingJob(source_type: CompileJob['source_type'], source_id: string): Promise<CompileJob> {
  const job: CompileJob = {
    id: generateId(),
    source_type,
    source_id,
    status: 'pending',
    attempt_count: 0,
    error_message: null,
    result_page_ids: [],
    created_at: nowIso(),
    completed_at: null,
  };
  await wikiPutJob(job);
  return job;
}

export async function wikiMarkJobFailed(id: string, error: string): Promise<void> {
  const job = await dbCompileJobs.getItem(id) as CompileJob | null;
  if (job) {
    job.status = 'failed';
    job.error_message = error;
    job.completed_at = nowIso();
    job.attempt_count += 1;
    await dbCompileJobs.setItem(id, job);
  }
}

export async function wikiMarkJobCompleted(id: string, pageIds: string[]): Promise<void> {
  const job = await dbCompileJobs.getItem(id) as CompileJob | null;
  if (job) {
    job.status = 'completed';
    job.result_page_ids = pageIds;
    job.completed_at = nowIso();
    await dbCompileJobs.setItem(id, job);
  }
}

// ===== Graph data for UI =====

export interface GraphNode {
  id: string;
  title: string;
  type: WikiPage['type'];
  source_count: number;
  review_status: WikiPage['review_status'];
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: WikiLink['relation'];
}

export interface WikiGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function wikiGetSubgraphAroundNode(centerId: string, depth = 1): Promise<WikiGraph> {
  const visited = new Set<string>([centerId]);
  const edges: GraphEdge[] = [];

  let frontier = [centerId];
  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];
    for (const pageId of frontier) {
      const links = await wikiGetLinksForPage(pageId);
      for (const link of links) {
        const otherId = link.source_page_id === pageId ? link.target_page_id : link.source_page_id;
        edges.push({
          source: link.source_page_id,
          target: link.target_page_id,
          relation: link.relation,
        });
        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextFrontier.push(otherId);
        }
      }
    }
    frontier = nextFrontier;
  }

  const nodes: GraphNode[] = [];
  for (const id of visited) {
    const page = await wikiGetPage(id);
    if (page) {
      nodes.push({
        id: page.id,
        title: page.title,
        type: page.type,
        source_count: page.source_ids.length,
        review_status: page.review_status,
      });
    }
  }

  return { nodes, edges };
}

export async function wikiGetLocalViewForType(type: WikiPage['type']): Promise<WikiGraph> {
  const pages = await wikiGetAllPages();
  const filtered = pages.filter(p => p.type === type);
  const ids = new Set(filtered.map(p => p.id));
  const nodes: GraphNode[] = filtered.map(p => ({
    id: p.id,
    title: p.title,
    type: p.type,
    source_count: p.source_ids.length,
    review_status: p.review_status,
  }));

  const edges: GraphEdge[] = [];
  const allLinks = await wikiGetLinks();
  for (const link of allLinks) {
    if (ids.has(link.source_page_id) && ids.has(link.target_page_id)) {
      edges.push({
        source: link.source_page_id,
        target: link.target_page_id,
        relation: link.relation,
      });
    }
  }

  return { nodes, edges };
}

// ===== Index =====

export interface WikiIndexEntry {
  id: string;
  title: string;
  type: WikiPage['type'];
  summary: string;
  source_count: number;
  updated_at: string;
}

export interface WikiIndex {
  generated_at: string;
  total: number;
  by_type: Record<WikiPage['type'], WikiIndexEntry[]>;
}

export async function wikiGetIndex(): Promise<WikiIndex> {
  const pages = await wikiGetAllPages();
  const by_type: Record<WikiPage['type'], WikiIndexEntry[]> = {
    concept: [], method: [], model: [], fallacy: [],
  };
  for (const p of pages) {
    by_type[p.type].push({
      id: p.id, title: p.title, type: p.type,
      summary: p.summary.slice(0, 80),
      source_count: p.source_ids.length,
      updated_at: p.updated_at,
    });
  }
  for (const t of Object.keys(by_type) as WikiPage['type'][]) {
    by_type[t].sort((a, b) => a.title.localeCompare(b.title));
  }
  return { generated_at: nowIso(), total: pages.length, by_type };
}

// ===== Log =====

export interface WikiLogEntry {
  id: string;
  timestamp: string;
  action: 'ingest' | 'compile' | 'update' | 'merge' | 'delete' | 'lint';
  detail: string;
  page_ids: string[];
}

export async function wikiLogAppend(entry: Omit<WikiLogEntry, 'id' | 'timestamp'>): Promise<void> {
  const logEntry: WikiLogEntry = {
    ...entry,
    id: generateId(),
    timestamp: nowIso(),
  };
  await dbWikiLog.setItem(logEntry.id, logEntry);
}

export async function wikiGetLog(limit = 50): Promise<WikiLogEntry[]> {
  const entries: WikiLogEntry[] = [];
  await dbWikiLog.iterate((v: unknown) => {
    entries.push(v as WikiLogEntry);
  });
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

// ===== Lint (增强版) =====

export interface LintResult {
  orphan_pages: string[];
  conflict_pages: string[];
  broken_links: string[];
  missing_refs: string[];
  low_confidence: string[];
  duplicate_candidates: Array<{ a: string; b: string; similarity: number }>;
}

export async function wikiLint(): Promise<LintResult> {
  const allPages = await wikiGetAllPages();
  const allLinks = await wikiGetLinks();
  const pageIds = new Set(allPages.map(p => p.id));

  const inboundLinks = new Set<string>();
  const outboundLinks = new Set<string>();
  for (const link of allLinks) {
    inboundLinks.add(link.target_page_id);
    outboundLinks.add(link.source_page_id);
  }

  const orphan_pages = allPages
    .filter(p => p.source_ids.length === 0 && !inboundLinks.has(p.id) && !outboundLinks.has(p.id))
    .map(p => p.id);

  const conflict_pages = allPages
    .filter(p => p.review_status === 'needs_merge')
    .map(p => p.id);

  const broken_links = allLinks
    .filter(l => !pageIds.has(l.source_page_id) || !pageIds.has(l.target_page_id))
    .map(l => l.id);

  const missing_refs = allPages
    .filter(p => p.related_page_ids.length === 0 && p.source_ids.length <= 1)
    .map(p => p.id);

  const low_confidence = allPages
    .filter(p => p.confidence < 0.6 && p.review_status === 'auto')
    .map(p => p.id);

  const duplicate_candidates: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < allPages.length; i++) {
    for (let j = i + 1; j < allPages.length; j++) {
      const sim = titleSimilarity(allPages[i].title, allPages[j].title);
      if (sim > 0.7 && sim < 1.0) {
        duplicate_candidates.push({ a: allPages[i].id, b: allPages[j].id, similarity: sim });
      }
    }
  }

  return { orphan_pages, conflict_pages, broken_links, missing_refs, low_confidence, duplicate_candidates };
}

function titleSimilarity(a: string, b: string): number {
  const aNorm = a.toLowerCase().replace(/[·\.\s]/g, '');
  const bNorm = b.toLowerCase().replace(/[·\.\s]/g, '');
  if (aNorm === bNorm) return 1.0;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.9;
  const aChars = new Set(aNorm.split(''));
  const bChars = new Set(bNorm.split(''));
  let intersection = 0;
  for (const c of aChars) if (bChars.has(c)) intersection++;
  const union = new Set([...aChars, ...bChars]).size;
  return union > 0 ? intersection / union : 0;
}

// ===== 实体对齐 + 智能写入 =====

export interface SmartUpsertResult {
  action: 'created' | 'updated' | 'merged';
  pageId: string;
  mergedInto?: string;
}

export async function wikiSmartUpsertPage(
  page: WikiPage,
  sourceId: string,
  snippet?: string,
  pages?: WikiPage[],
): Promise<SmartUpsertResult> {
  const resolution = await resolveEntity(page.title, page.canonical_title, page.aliases, pages);

  if (resolution.action === 'existing' && resolution.target_page) {
    const existing = resolution.target_page;
    const newSourceIds = new Set([...existing.source_ids, sourceId]);
    existing.source_ids = [...newSourceIds];
    existing.updated_at = nowIso();
    existing.version += 1;
    if (snippet && !existing.source_snippets.includes(snippet)) {
      existing.source_snippets.push(snippet);
    }
    await wikiPutPage(existing);
    await wikiLogAppend({ action: 'update', detail: `实体对齐: 更新「${existing.title}」`, page_ids: [existing.id] });
    return { action: 'updated', pageId: existing.id };
  }

  if (resolution.action === 'merge' && resolution.target_page) {
    await mergeIntoExistingPage(resolution.target_page, sourceId, snippet || '', page.aliases);
    await wikiLogAppend({ action: 'merge', detail: `实体对齐: 合并「${page.title}」→「${resolution.target_page.title}」`, page_ids: [resolution.target_page.id] });
    return { action: 'merged', pageId: resolution.target_page.id, mergedInto: resolution.target_page.id };
  }

  if (pages) pages.push(page);
  await wikiPutPage(page);
  await wikiLogAppend({ action: 'compile', detail: `新建: 「${page.title}」(type=${page.type})`, page_ids: [page.id] });
  return { action: 'created', pageId: page.id };
}
