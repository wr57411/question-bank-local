import { dbGroups, dbTags, dbQuestions, dbQuestionTags, generateId, nowIso } from './stores';
import { dbGetAllTagCategories } from './tag-categories';
import { dbUpdateTag, dbDeleteTag, invalidateTagIndex } from './tags';
import { evalExpr, type QuestionTagMap } from './expr';
import type { ExprNode, Group, Tag } from '../types';

let _groupsCache: Group[] | null = null;
let _groupsDirty = true;

export function invalidateGroupsCache(): void {
  _groupsDirty = true;
}

function normalizeGroupRecord(value: unknown, key: string): Group | null {
  if (!value || typeof value !== 'object') return null;
  const g = { ...(value as Record<string, unknown>) };
  if (!g.id && key) g.id = key;
  if (!g.expr || typeof g.expr !== 'object') g.expr = { op: 'or', children: [] };
  if (g.member_tag_id === undefined) g.member_tag_id = null;
  if (typeof g.order !== 'number') g.order = 0;
  if (!g.created_at) g.created_at = nowIso();
  if (!g.updated_at) g.updated_at = g.created_at;
  if (g.deleted_at === undefined) g.deleted_at = null;
  if (typeof g.id !== 'string' || typeof g.name !== 'string') return null;
  if (g.kind !== 'chapter' && g.kind !== 'topic') return null;
  return g as unknown as Group;
}

export async function dbGetAllGroups(kind?: 'chapter' | 'topic'): Promise<Group[]> {
  if (!_groupsCache || _groupsDirty) {
    const groups: Group[] = [];
    await dbGroups.iterate((value: unknown, key: string) => {
      const normalized = normalizeGroupRecord(value, key);
      if (!normalized) return;
      if (!normalized.deleted_at) groups.push(normalized);
    });
    groups.sort((a, b) => (a.order - b.order) || a.created_at.localeCompare(b.created_at));
    _groupsCache = groups;
    _groupsDirty = false;
  }
  const list = kind ? _groupsCache.filter((g) => g.kind === kind) : _groupsCache;
  return list.map((g) => ({ ...g }));
}

export async function dbGetGroup(groupId: string): Promise<Group | null> {
  const all = await dbGetAllGroups();
  return all.find((g) => g.id === groupId) ?? null;
}

async function nextOrder(kind: 'chapter' | 'topic'): Promise<number> {
  const all = await dbGetAllGroups(kind);
  return all.length ? Math.max(...all.map((g) => g.order)) + 1 : 0;
}

// 系统成员标签是破格通道：手动归入的题挂在这个标签上，不受表达式约束。
// 归属「系统」类别（is_system===true），该类别在所有选择器默认隐藏，避免污染。
async function createSystemMemberTag(groupName: string): Promise<string> {
  const categories = await dbGetAllTagCategories();
  const systemCategory = categories.find((c) => c.is_system === true);
  const id = generateId();
  const now = nowIso();
  const tag: Tag = {
    id,
    name: `专题·${groupName}`,
    color: '#3B82F6',
    category_id: systemCategory ? systemCategory.id : null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await dbTags.setItem(id, tag);
  invalidateTagIndex();
  return id;
}

export interface CreateGroupInput {
  kind: 'chapter' | 'topic';
  name: string;
  expr?: ExprNode;
  order?: number;
}

export async function dbCreateGroup(input: CreateGroupInput): Promise<Group> {
  const id = generateId();
  const now = nowIso();
  const member_tag_id = input.kind === 'topic' ? await createSystemMemberTag(input.name) : null;
  const group: Group = {
    id,
    kind: input.kind,
    name: input.name,
    expr: input.expr ?? { op: 'or', children: [] },
    member_tag_id,
    order: input.order ?? (await nextOrder(input.kind)),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await dbGroups.setItem(id, group);
  invalidateGroupsCache();
  return group;
}

export interface UpdateGroupPatch {
  name?: string;
  expr?: ExprNode;
  order?: number;
  member_tag_id?: string | null;
}

export async function dbUpdateGroup(groupId: string, patch: UpdateGroupPatch): Promise<Group | null> {
  const existing = (await dbGroups.getItem(groupId)) as Group | null;
  if (!existing || existing.deleted_at) return null;
  const next: Group = {
    ...existing,
    name: patch.name !== undefined ? patch.name : existing.name,
    expr: patch.expr !== undefined ? patch.expr : existing.expr,
    order: patch.order !== undefined ? patch.order : existing.order,
    member_tag_id: patch.member_tag_id !== undefined ? patch.member_tag_id : existing.member_tag_id,
    updated_at: nowIso(),
  };
  await dbGroups.setItem(groupId, next);
  // 专题改名必须联动系统成员标签名，否则标签池残留「专题·<旧名>」。
  if (patch.name !== undefined && patch.name !== existing.name && existing.kind === 'topic' && existing.member_tag_id) {
    await dbUpdateTag(existing.member_tag_id, { name: `专题·${patch.name}` });
  }
  invalidateGroupsCache();
  return next;
}

export async function dbDeleteGroup(groupId: string): Promise<void> {
  const existing = (await dbGroups.getItem(groupId)) as Group | null;
  if (!existing) return;
  await dbGroups.setItem(groupId, { ...existing, deleted_at: nowIso() });
  // 镜像规则：删专题一并清理其系统成员标签（避免标签池堆积死标签），
  // dbDeleteTag 同时解除该标签上的手动归入关系（题目本身不受影响）。
  if (existing.kind === 'topic' && existing.member_tag_id) {
    await dbDeleteTag(existing.member_tag_id);
  }
  invalidateGroupsCache();
}

// 成员口径：只认「有效关联」且关联指向的「题目自身未软删」。
// 题目记录无 deleted_at 或为 null 视为有效（沿用客户端既有软删语义）。
export async function buildGroupQuestionTagMap(): Promise<QuestionTagMap> {
  const validQuestionIds = new Set<string>();
  await dbQuestions.iterate((value: unknown, key: string) => {
    const q = value as { deleted_at?: string | null } | null;
    if (q && !q.deleted_at) validQuestionIds.add(key);
  });
  const map = new Map<string, Set<string>>();
  await dbQuestionTags.iterate((value: unknown) => {
    const record = value as { question_id: string; tag_id: string; deleted_at?: string | null };
    if (record.deleted_at) return;
    if (!validQuestionIds.has(record.question_id)) return;
    let bucket = map.get(record.question_id);
    if (!bucket) {
      bucket = new Set();
      map.set(record.question_id, bucket);
    }
    bucket.add(record.tag_id);
  });
  return map;
}

// 系统成员标签上的「手动归入」题数（用于删专题时的弹窗说明），只数有效题。
export async function getGroupManualMemberCount(groupId: string): Promise<number> {
  const group = await dbGetGroup(groupId);
  if (!group || !group.member_tag_id) return 0;
  const map = await buildGroupQuestionTagMap();
  let count = 0;
  for (const tags of map.values()) if (tags.has(group.member_tag_id)) count++;
  return count;
}

// 成员 = 表达式命中题 ∪ 带系统成员标签的题（破格通道）。
export async function getGroupMemberQuestionIds(groupId: string): Promise<string[]> {
  const group = await dbGetGroup(groupId);
  if (!group) return [];
  const questionTags = await buildGroupQuestionTagMap();
  const { hits } = evalExpr(group.expr, questionTags);
  if (group.member_tag_id) {
    for (const [questionId, tags] of questionTags) {
      if (tags.has(group.member_tag_id)) hits.add(questionId);
    }
  }
  return Array.from(hits).sort();
}
