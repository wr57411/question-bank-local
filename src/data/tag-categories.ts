import { dbTagCategories, dbTags, generateId, nowIso } from './stores';
import { dbUpdateTag } from './tags';
import { getAppSetting, setAppSetting } from './app-settings';
import { TAG_CATEGORY_GUESS } from './tag-category-guess';
import type { Tag, TagCategory } from '../types';

// 默认类别种子（可在 APP 内增删改名）。「系统」是必需项：专题的系统成员标签挂在这里，
// 默认在所有选择器隐藏，避免污染。顺序即默认显示顺序。
export const DEFAULT_TAG_CATEGORIES: ReadonlyArray<{ name: string; order: number; is_system: boolean }> = [
  { name: '知识点/模型', order: 0, is_system: false },
  { name: '情境', order: 1, is_system: false },
  { name: '易错题', order: 2, is_system: false },
  { name: '难度', order: 3, is_system: false },
  { name: '系统', order: 4, is_system: true },
  { name: '其他特征', order: 5, is_system: false },
  { name: '典型方法', order: 6, is_system: false },
];

export async function dbGetAllTagCategories(): Promise<TagCategory[]> {
  const list: TagCategory[] = [];
  await dbTagCategories.iterate((v: unknown) => {
    if (v) list.push(v as TagCategory);
  });
  return list.sort((a, b) => a.order - b.order);
}

// 幂等种入：仅当 store 为空时种入默认六类，重复启动不会重复种（也不会覆盖用户改动）。
export async function ensureDefaultTagCategories(): Promise<number> {
  let existing = 0;
  await dbTagCategories.iterate(() => { existing++; });
  if (existing > 0) return 0;
  const now = nowIso();
  for (const c of DEFAULT_TAG_CATEGORIES) {
    const id = generateId();
    const record: TagCategory = {
      id,
      name: c.name,
      order: c.order,
      is_system: c.is_system,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await dbTagCategories.setItem(id, record);
  }
  return DEFAULT_TAG_CATEGORIES.length;
}

export interface VisibilityConfig {
  ids: string[];
  unclassified: boolean;
}

export type VisibilityKind = 'chapter' | 'topic';

export const DEFAULT_VISIBILITY: Record<VisibilityKind, { names: string[]; unclassified: boolean }> = {
  chapter: { names: ['知识点/模型'], unclassified: false },
  topic: { names: ['知识点/模型', '情境', '易错题', '难度', '其他特征', '典型方法'], unclassified: true },
};

export function computeDefaultVisibility(categories: TagCategory[], kind: VisibilityKind): VisibilityConfig {
  const def = DEFAULT_VISIBILITY[kind];
  const ids = categories.filter((c) => def.names.includes(c.name)).map((c) => c.id);
  return { ids, unclassified: def.unclassified };
}

export async function dbCreateTagCategory(name: string): Promise<TagCategory> {
  const all = await dbGetAllTagCategories();
  const order = all.length ? Math.max(...all.map((c) => c.order)) + 1 : 0;
  const now = nowIso();
  const id = generateId();
  const record: TagCategory = {
    id,
    name,
    order,
    is_system: false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await dbTagCategories.setItem(id, record);
  return record;
}

export async function dbRenameTagCategory(id: string, name: string): Promise<void> {
  const cat = (await dbTagCategories.getItem(id)) as TagCategory | null;
  if (!cat) return;
  if (cat.is_system) throw new Error('系统类别不可改名');
  await dbTagCategories.setItem(id, { ...cat, name, updated_at: nowIso() });
}

export async function dbDeleteTagCategory(id: string): Promise<void> {
  const cat = (await dbTagCategories.getItem(id)) as TagCategory | null;
  if (!cat) return;
  if (cat.is_system) throw new Error('系统类别不可删除');
  const affected: string[] = [];
  await dbTags.iterate((t: unknown, key: string) => {
    const tag = t as Tag;
    if (tag && tag.category_id === id) affected.push(key);
  });
  for (const key of affected) await dbUpdateTag(key, { category_id: null });
  await dbTagCategories.removeItem(id);
}

export async function dbMoveTagCategory(id: string, dir: -1 | 1): Promise<void> {
  const all = await dbGetAllTagCategories();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= all.length) return;
  const a = all[idx];
  const b = all[swap];
  await dbTagCategories.setItem(a.id, { ...a, order: b.order, updated_at: nowIso() });
  await dbTagCategories.setItem(b.id, { ...b, order: a.order, updated_at: nowIso() });
}

const LEGACY_CATEGORY_NAMES = ['题型/情境', '错因', '学科'];
const TAXONOMY_V2_FLAG = 'taxonomyV2Migrated';

async function dbCreateTagCategoryWithOrder(name: string, order: number, isSystem: boolean): Promise<TagCategory> {
  const now = nowIso();
  const id = generateId();
  const record: TagCategory = { id, name, order, is_system: isSystem, created_at: now, updated_at: now, deleted_at: null };
  await dbTagCategories.setItem(id, record);
  return record;
}

export async function migrateTagTaxonomy(): Promise<boolean> {
  if (await getAppSetting<boolean>(TAXONOMY_V2_FLAG)) return false;
  const before = await dbGetAllTagCategories();
  if (!before.some((c) => LEGACY_CATEGORY_NAMES.includes(c.name))) {
    await setAppSetting(TAXONOMY_V2_FLAG, true);
    return false;
  }
  const existingNames = new Set(before.map((c) => c.name));
  for (const def of DEFAULT_TAG_CATEGORIES) {
    if (!existingNames.has(def.name)) await dbCreateTagCategoryWithOrder(def.name, def.order, def.is_system);
  }
  const all = await dbGetAllTagCategories();
  const idByName = new Map(all.map((c) => [c.name, c.id] as const));
  const toReassign: { key: string; catId: string }[] = [];
  await dbTags.iterate((v: unknown, key: string) => {
    const tag = v as Tag;
    if (!tag || tag.deleted_at) return;
    const catId = idByName.get(TAG_CATEGORY_GUESS[tag.name] || '');
    if (catId && tag.category_id !== catId) toReassign.push({ key, catId });
  });
  for (const u of toReassign) await dbUpdateTag(u.key, { category_id: u.catId });
  for (const name of LEGACY_CATEGORY_NAMES) {
    const cat = all.find((c) => c.name === name);
    if (cat) await dbDeleteTagCategory(cat.id);
  }
  await setAppSetting(TAXONOMY_V2_FLAG, true);
  return true;
}
