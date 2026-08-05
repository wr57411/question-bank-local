import { wikiGetAllPages } from '../data/wiki';
import type { WikiPage } from '../types';

const SIMILARITY_THRESHOLD = 0.9;
const HIGH_CONFIDENCE_THRESHOLD = 0.95;

export type EntityResolution = 'new' | 'existing' | 'merge';

export interface ResolutionResult {
  action: EntityResolution;
  target_page?: WikiPage;
  similarity?: number;
}

function simpleSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase().replace(/[·\.\s]/g, '');
  const bLower = b.toLowerCase().replace(/[·\.\s]/g, '');

  if (aLower === bLower) return 1.0;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.9;

  const aChars = new Set(aLower.split(''));
  const bChars = new Set(bLower.split(''));
  let intersection = 0;
  for (const c of aChars) {
    if (bChars.has(c)) intersection++;
  }
  const union = new Set([...aChars, ...bChars]).size;
  return union > 0 ? intersection / union : 0;
}
export { simpleSimilarity };

interface ProviderLike {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function llmConfirmSameConcept(titleA: string, titleB: string): Promise<boolean> {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.getCurrentProvider !== 'function') return false;
  const provider = (w.getCurrentProvider as () => ProviderLike | null)();
  if (!provider || !provider.apiKey) return false;

  const prompt = `判断以下两个高中物理术语是否指同一概念（即可合并为同一条百科条目）。

术语A：${titleA}
术语B：${titleB}

只回答"是"或"否"，不要其他文字。`;

  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const url = baseUrl.includes('openrouter')
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : baseUrl + '/chat/completions';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
    if (url.includes('openrouter')) {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'Question Bank Local - Entity';
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 5,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const data = await res.json();
      const content: string = data.choices?.[0]?.message?.content || '';
      return content.trim().startsWith('是') || content.toLowerCase().trim().startsWith('yes');
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

export async function resolveEntity(
  _title: string,
  canonicalTitle: string,
  aliases: string[] = [],
  pages?: WikiPage[]
): Promise<ResolutionResult> {
  const allPages = pages ?? await wikiGetAllPages();

  const exact = allPages.find(p => p.canonical_title === canonicalTitle) ?? null;
  if (exact) {
    return { action: 'existing', target_page: exact, similarity: 1.0 };
  }

  let bestMatch: WikiPage | null = null;
  let bestSim = 0;

  for (const page of allPages) {
    let sim = simpleSimilarity(canonicalTitle, page.canonical_title);
    if (sim < SIMILARITY_THRESHOLD) {
      for (const alias of page.aliases) {
        const aliasSim = simpleSimilarity(canonicalTitle, alias);
        if (aliasSim > sim) sim = aliasSim;
      }
    }
    for (const alias of aliases) {
      const aliasSim = simpleSimilarity(alias, page.canonical_title);
      if (aliasSim > sim) sim = aliasSim;
    }
    if (sim > bestSim && sim >= SIMILARITY_THRESHOLD) {
      bestSim = sim;
      bestMatch = page;
    }
  }

  if (bestMatch) {
    if (bestSim >= HIGH_CONFIDENCE_THRESHOLD) {
      return { action: 'existing', target_page: bestMatch, similarity: bestSim };
    }
    const confirmed = await llmConfirmSameConcept(canonicalTitle, bestMatch.canonical_title);
    if (confirmed) {
      return { action: 'merge', target_page: bestMatch, similarity: bestSim };
    }
    return { action: 'new' };
  }

  return { action: 'new' };
}

export async function mergeIntoExistingPage(
  existing: WikiPage,
  newSourceId: string,
  newSnippet: string,
  newAliases: string[] = []
): Promise<void> {
  const existingSourceIds = new Set(existing.source_ids);
  if (!existingSourceIds.has(newSourceId)) {
    existing.source_ids.push(newSourceId);
  }

  const existingSnippets = new Set(existing.source_snippets);
  if (newSnippet && !existingSnippets.has(newSnippet)) {
    existing.source_snippets.push(newSnippet);
  }

  for (const alias of newAliases) {
    if (!existing.aliases.includes(alias)) {
      existing.aliases.push(alias);
    }
  }

  existing.updated_at = new Date().toISOString();
  existing.version += 1;

  const { wikiPutPage } = await import('../data/wiki');
  await wikiPutPage(existing);
}

export function generateAliases(_title: string): string[] {
  return [];
}
