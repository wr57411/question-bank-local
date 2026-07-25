import { dbTags, dbQuestionTags, generateId, nowIso } from './stores';
import type { Tag } from '../types';

let _tagIndexCache: Map<string, { id: string; name: string; color: string }[]> | null = null;
let _tagIndexDirty = true;
let _tagsCache: Tag[] | null = null;
let _tagsDirty = true;

export function invalidateTagIndex(): void {
  _tagIndexDirty = true;
  _tagsDirty = true;
}

function normalizeTagRecord(tag: Record<string, unknown>, key: string): Tag | null {
  if (!tag || typeof tag !== 'object') return null;
  const next = { ...tag } as Record<string, unknown>;
  if (!next.id && key) next.id = key;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (!next.color) next.color = '#3B82F6';
  return next as unknown as Tag;
}

export async function buildTagIndex(): Promise<Map<string, { id: string; name: string; color: string }[]>> {
  if (_tagIndexCache && !_tagIndexDirty) return _tagIndexCache;

  const tagsById = new Map<string, Tag>();
  const updates: Tag[] = [];
  await dbTags.iterate((tag: unknown, key: string) => {
    const normalized = normalizeTagRecord(tag as Record<string, unknown>, key);
    if (!normalized) return;
    if (JSON.stringify(tag) !== JSON.stringify(normalized)) updates.push(normalized);
    if (!normalized.deleted_at) tagsById.set(normalized.id, normalized);
  });
  for (const tag of updates) await dbTags.setItem(tag.id, tag);

  const qtByQuestionId = new Map<string, { id: string; name: string; color: string }[]>();
  await dbQuestionTags.iterate((qt: unknown) => {
    const record = qt as { question_id: string; tag_id: string };
    const tag = tagsById.get(record.tag_id);
    if (!tag) return;
    if (!qtByQuestionId.has(record.question_id)) qtByQuestionId.set(record.question_id, []);
    qtByQuestionId.get(record.question_id)!.push({ id: tag.id, name: tag.name, color: tag.color });
  });

  _tagIndexCache = qtByQuestionId;
  _tagIndexDirty = false;
  return _tagIndexCache;
}

export async function dbGetAllTags(): Promise<Tag[]> {
  if (_tagsCache && !_tagsDirty) return _tagsCache.map(t => ({ ...t }));
  const tags: Tag[] = [];
  const updates: Tag[] = [];
  await dbTags.iterate((tag: unknown, key: string) => {
    const normalized = normalizeTagRecord(tag as Record<string, unknown>, key);
    if (!normalized) return;
    if (JSON.stringify(tag) !== JSON.stringify(normalized)) updates.push(normalized);
    if (!normalized.deleted_at) tags.push(normalized);
  });
  for (const tag of updates) await dbTags.setItem(tag.id, tag);
  _tagsCache = tags.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  _tagsDirty = false;
  return _tagsCache.map(t => ({ ...t }));
}

export async function dbCreateTag(name: string, color: string): Promise<Tag> {
  const id = generateId();
  const now = nowIso();
  const tag: Tag = { id, name, color: color || '#3B82F6', created_at: now, deleted_at: null };
  await dbTags.setItem(id, tag);
  invalidateTagIndex();
  return tag;
}

export async function dbDeleteTag(tagId: string): Promise<void> {
  const tag = await dbTags.getItem(tagId) as Tag | null;
  if (!tag) return;
  await dbTags.setItem(tagId, { ...tag, deleted_at: nowIso() });
  const keysToRemove: string[] = [];
  await dbQuestionTags.iterate((qt: unknown, key: string) => {
    if ((qt as { tag_id: string }).tag_id === tagId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbQuestionTags.removeItem(key);
  invalidateTagIndex();
}
