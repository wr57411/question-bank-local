import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 1 数据层（1.1 / 1.2 / 1.7 / N1-data）回归测试，覆盖：
//   - 默认类别种子（六类，含必需「系统」；幂等，重复启动不重复种）
//   - dbUpdateTag：改名/改色/改 category_id 且带 updated_at
//   - category_id 同步保留与传播：dbApplyRemoteSnapshot / dbBuildSyncPayload 保留 category_id
//   - 备份：tag_categories 自动进分片（exportFullBackup 含该数组）
//   - N1-data：零标签题查询（有效题=无 deleted_at；untagged=无 live 关联）

const H = vi.hoisted(() => {
  const stores: Record<string, any> = {};
  function makeStore(name: string) {
    const map = new Map<string, unknown>();
    const store = {
      _name: name,
      _map: map,
      iterate: async (cb: (v: unknown, k: string, n: number) => unknown) => {
        let n = 1;
        for (const [k, v] of map) {
          const r = cb(v, k, n++);
          if (r !== undefined) return r;
        }
        return undefined;
      },
      getItem: async (k: string) => (map.has(k) ? map.get(k) : null),
      setItem: async (k: string, v: unknown) => { map.set(k, v); },
      removeItem: async (k: string) => { map.delete(k); },
      clear: async () => { map.clear(); },
    };
    stores[name] = store;
    return store;
  }
  let idCounter = 0;
  return {
    stores,
    makeStore,
    generateId: () => 'id-' + (++idCounter) + '-' + Math.random().toString(36).slice(2),
    nowIso: () => new Date().toISOString(),
    toMillis: (s: string | number | undefined | null) => (!s ? 0 : (typeof s === 'number' ? s : (Date.parse(s) || 0))),
  };
});

vi.mock('../src/data/stores', () => ({
  dbQuestions: H.makeStore('dbQuestions'),
  dbTags: H.makeStore('dbTags'),
  dbQuestionTags: H.makeStore('dbQuestionTags'),
  dbPapers: H.makeStore('dbPapers'),
  dbPaperQuestions: H.makeStore('dbPaperQuestions'),
  dbSimilarQuestionLinks: H.makeStore('dbSimilarQuestionLinks'),
  dbTopics: H.makeStore('dbTopics'),
  dbTopicQuestions: H.makeStore('dbTopicQuestions'),
  dbQuestionNotes: H.makeStore('dbQuestionNotes'),
  dbPendingPhotos: H.makeStore('dbPendingPhotos'),
  dbTeachingNodes: H.makeStore('dbTeachingNodes'),
  dbTeachingVersions: H.makeStore('dbTeachingVersions'),
  dbNodeQuestions: H.makeStore('dbNodeQuestions'),
  dbTagCategories: H.makeStore('dbTagCategories'),
  dbAppSettings: H.makeStore('dbAppSettings'),
  dbGroups: H.makeStore('dbGroups'),
  dbChangelog: H.makeStore('dbChangelog'),
  generateId: H.generateId,
  nowIso: H.nowIso,
  toMillis: H.toMillis,
}));

import { dbGetAllTagCategories, ensureDefaultTagCategories, DEFAULT_TAG_CATEGORIES, computeDefaultVisibility, dbCreateTagCategory, dbRenameTagCategory, dbDeleteTagCategory, dbMoveTagCategory, DEFAULT_VISIBILITY, migrateTagTaxonomy } from '../src/data/tag-categories';
import { dbUpdateTag } from '../src/data/tags';
import { dbApplyRemoteSnapshot, dbBuildSyncPayload } from '../src/data/sync';
import { listUntaggedQuestions, getUntaggedQuestionCount } from '../src/data/questions';
import { exportFullBackup } from '../src/data/backup';
import { getVisibilityConfig, setVisibilityConfig, clearAppSettingsCache } from '../src/data/app-settings';
import { TAG_CATEGORY_GUESS } from '../src/data/tag-category-guess';

const tags = () => H.stores.dbTags as any;
const cats = () => H.stores.dbTagCategories as any;
const questions = () => H.stores.dbQuestions as any;
const qt = () => H.stores.dbQuestionTags as any;
const settings = () => H.stores.dbAppSettings as any;

function seedCategory(id: string, name: string, order: number, isSystem = false): void {
  cats().setItem(id, { id, name, order, is_system: isSystem, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
}

beforeEach(() => {
  for (const s of Object.values(H.stores)) (s as any)._map.clear();
});

describe('1.1 默认类别种子', () => {
  it('首次种入 6 类，含必需「系统」类且 is_system=true', async () => {
    const seeded = await ensureDefaultTagCategories();
    expect(seeded).toBe(7);
    const all = await dbGetAllTagCategories();
    expect(all).toHaveLength(7);
    const names = all.map((c) => c.name);
    expect(names).toEqual(['知识点/模型', '情境', '易错题', '难度', '系统', '其他特征', '典型方法']);
    const sys = all.find((c) => c.name === '系统');
    expect(sys?.is_system).toBe(true);
  });

  it('store 非空时重复调用不重复种（幂等）', async () => {
    await ensureDefaultTagCategories();
    const second = await ensureDefaultTagCategories();
    expect(second).toBe(0);
    expect(await dbGetAllTagCategories()).toHaveLength(7);
  });

  it('种子清单与 DEFAULT_TAG_CATEGORIES 常量一致', () => {
    expect(DEFAULT_TAG_CATEGORIES).toHaveLength(7);
    expect(DEFAULT_TAG_CATEGORIES.map((c) => c.name)).toContain('系统');
  });
});

describe('1.2 dbUpdateTag', () => {
  it('改 category_id + name + color 且刷新 updated_at', async () => {
    await tags().setItem('t1', { id: 't1', name: '旧', color: '#000', category_id: null, created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    const before = await tags().getItem('t1');
    const updated = await dbUpdateTag('t1', { name: '新', color: '#FFF', category_id: 'cat-1' });
    expect(updated?.name).toBe('新');
    expect(updated?.color).toBe('#FFF');
    expect(updated?.category_id).toBe('cat-1');
    expect(updated?.updated_at).toBeTruthy();
    expect(updated?.updated_at).not.toBe(before.updated_at);
  });

  it('漏传字段不覆盖原值', async () => {
    await tags().setItem('t1', { id: 't1', name: '旧', color: '#000', category_id: 'cat-1', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    const updated = await dbUpdateTag('t1', { name: '新' });
    expect(updated?.color).toBe('#000');
    expect(updated?.category_id).toBe('cat-1');
  });

  it('不存在的标签返回 null', async () => {
    expect(await dbUpdateTag('nope', { name: 'x' })).toBeNull();
  });
});

describe('1.7 category_id 同步保留与传播', () => {
  it('dbApplyRemoteSnapshot 保留 category_id（不被丢弃）', async () => {
    await tags().setItem('t1', { id: 't1', name: '旧', category_id: null, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await dbApplyRemoteSnapshot({ tags: [{ id: 't1', name: '新', category_id: 'cat-9', updated_at: '2026-06-01T00:00:00.000Z', deleted_at: null }] });
    const t = await tags().getItem('t1');
    expect(t.category_id).toBe('cat-9');
  });

  it('dbBuildSyncPayload 上行包含 category_id', async () => {
    await tags().setItem('t1', { id: 't1', name: '物理', category_id: 'cat-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    const payload = await dbBuildSyncPayload();
    const pushed = (payload.tags as any[]).find((t) => t.id === 't1');
    expect(pushed.category_id).toBe('cat-1');
  });

  it('备份 exportFullBackup 含 tag_categories 数组（自动进分片）', async () => {
    await ensureDefaultTagCategories();
    const data = await exportFullBackup();
    expect(Array.isArray((data as any).tag_categories)).toBe(true);
    expect((data as any).tag_categories).toHaveLength(7);
  });
});

describe('N1-data 零标签题查询', () => {
  function putQuestion(id: string, deleted = false): void {
    questions().setItem(id, { id, created_at: '2026-01-01T00:00:00.000Z', deleted_at: deleted ? '2026-02-01T00:00:00.000Z' : null });
  }

  it('只数「有效且无 live 关联」的题', async () => {
    putQuestion('q1');             // 有效，有 live 关联
    putQuestion('q2');             // 有效，无关联 → 零标签
    putQuestion('q3', true);       // 已删 → 不计入
    putQuestion('q4');             // 有效，但关联已软删 → 视为零标签
    await qt().setItem('q1_t1', { question_id: 'q1', tag_id: 't1', deleted_at: null });
    await qt().setItem('q4_t1', { question_id: 'q4', tag_id: 't1', deleted_at: '2026-02-01T00:00:00.000Z' });

    const list = await listUntaggedQuestions();
    const ids = list.map((q) => q.id).sort();
    expect(ids).toEqual(['q2', 'q4']);
    expect(await getUntaggedQuestionCount()).toBe(2);
  });

  it('全部有标签时为零', async () => {
    putQuestion('q1');
    putQuestion('q2');
    await qt().setItem('q1_t1', { question_id: 'q1', tag_id: 't1', deleted_at: null });
    await qt().setItem('q2_t1', { question_id: 'q2', tag_id: 't1', deleted_at: null });
    expect(await getUntaggedQuestionCount()).toBe(0);
  });
});

describe('1.3 类别增删改名（系统类保护）', () => {
  it('新增类别追加到末尾 order', async () => {
    seedCategory('c0', 'A', 0);
    seedCategory('c1', 'B', 1);
    const created = await dbCreateTagCategory('C');
    expect(created.order).toBe(2);
    expect(created.is_system).toBe(false);
    const all = await dbGetAllTagCategories();
    expect(all.map((c) => c.name)).toEqual(['A', 'B', 'C']);
  });

  it('改名普通类别生效', async () => {
    seedCategory('c0', '旧名', 0);
    await dbRenameTagCategory('c0', '新名');
    expect((await cats().getItem('c0')).name).toBe('新名');
  });

  it('系统类别改名抛错（保护）', async () => {
    seedCategory('sys', '系统', 5, true);
    await expect(dbRenameTagCategory('sys', '改名')).rejects.toThrow();
    expect((await cats().getItem('sys')).name).toBe('系统');
  });

  it('删除类别后挂在其下的标签退回 category_id=null', async () => {
    seedCategory('c0', '要删', 0);
    await tags().setItem('t1', { id: 't1', name: '标签A', color: '#000', category_id: 'c0', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await tags().setItem('t2', { id: 't2', name: '标签B', color: '#000', category_id: 'c0', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await tags().setItem('t3', { id: 't3', name: '标签C', color: '#000', category_id: 'other', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await dbDeleteTagCategory('c0');
    expect(await cats().getItem('c0')).toBeNull();
    expect((await tags().getItem('t1')).category_id).toBeNull();
    expect((await tags().getItem('t2')).category_id).toBeNull();
    expect((await tags().getItem('t3')).category_id).toBe('other');
  });

  it('系统类别删除抛错（保护）', async () => {
    seedCategory('sys', '系统', 5, true);
    await tags().setItem('t1', { id: 't1', name: 'x', color: '#000', category_id: 'sys', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
    await expect(dbDeleteTagCategory('sys')).rejects.toThrow();
    expect(await cats().getItem('sys')).not.toBeNull();
    expect((await tags().getItem('t1')).category_id).toBe('sys');
  });

  it('上移/下移交换 order', async () => {
    seedCategory('c0', 'A', 0);
    seedCategory('c1', 'B', 1);
    await dbMoveTagCategory('c0', 1);
    const all = await dbGetAllTagCategories();
    expect(all.map((c) => c.name)).toEqual(['B', 'A']);
    await dbMoveTagCategory('c0', -1);
    const all2 = await dbGetAllTagCategories();
    expect(all2.map((c) => c.name)).toEqual(['A', 'B']);
  });
});

describe('1.6 选择器可见性配置', () => {
  it('computeDefaultVisibility：章节只显知识点/模型 且不显未分类；专题显六组（除系统）且显未分类', () => {
    const list = [
      { id: 'k1', name: '知识点/模型', order: 0, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k2', name: '情境', order: 1, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k3', name: '易错题', order: 2, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k4', name: '难度', order: 3, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k5', name: '其他特征', order: 4, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k6', name: '典型方法', order: 5, is_system: false, created_at: '', updated_at: '', deleted_at: null },
      { id: 'k7', name: '系统', order: 6, is_system: true, created_at: '', updated_at: '', deleted_at: null },
    ] as any;
    const chapter = computeDefaultVisibility(list, 'chapter');
    expect(chapter.ids.sort()).toEqual(['k1']);
    expect(chapter.unclassified).toBe(false);
    const topic = computeDefaultVisibility(list, 'topic');
    expect(topic.ids.sort()).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
    expect(topic.unclassified).toBe(true);
  });

  it('getVisibilityConfig 未设置时回退默认', async () => {
    seedCategory('k1', '知识点/模型', 0);
    seedCategory('k2', '题型/情境', 1);
    seedCategory('k3', '错因', 2);
    seedCategory('k4', '难度', 3);
    const chapter = await getVisibilityConfig('chapter');
    expect(chapter.ids.sort()).toEqual(['k1']);
    expect(chapter.unclassified).toBe(false);
  });

  it('setVisibilityConfig 后 get 返回所存', async () => {
    await setVisibilityConfig('topic', { ids: ['k9'], unclassified: false });
    const got = await getVisibilityConfig('topic');
    expect(got).toEqual({ ids: ['k9'], unclassified: false });
  });

  it('DEFAULT_VISIBILITY 与裁决一致', () => {
    expect(DEFAULT_VISIBILITY.chapter.names).toEqual(['知识点/模型']);
    expect(DEFAULT_VISIBILITY.chapter.unclassified).toBe(false);
    expect(DEFAULT_VISIBILITY.topic.names).toEqual(['知识点/模型', '情境', '易错题', '难度', '其他特征', '典型方法']);
    expect(DEFAULT_VISIBILITY.topic.unclassified).toBe(true);
  });
});

describe('分类体系迁移 migrateTagTaxonomy', () => {
  beforeEach(() => {
    clearAppSettingsCache();
    localStorage.clear();
  });

  const OLD_SIX: [string, string, number, boolean][] = [
    ['oc1', '知识点/模型', 0, false],
    ['oc2', '题型/情境', 1, false],
    ['oc3', '错因', 2, false],
    ['oc4', '难度', 3, false],
    ['oc5', '学科', 4, false],
    ['oc6', '系统', 5, true],
  ];

  function seedOldSix(): void {
    for (const [id, name, order, isSystem] of OLD_SIX) seedCategory(id, name, order, isSystem);
  }

  function putTag(id: string, name: string, categoryId: string | null, deletedAt: string | null = null): void {
    tags().setItem(id, { id, name, color: '#3B82F6', category_id: categoryId, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: deletedAt });
  }

  async function catNameOfTag(tagId: string): Promise<string | null> {
    const t = await tags().getItem(tagId);
    if (!t.category_id) return null;
    const c = await cats().getItem(t.category_id);
    return c ? c.name : null;
  }

  it('旧六类 + 标签 → 七类就位、旧三类被软删（移除）、标签按 TAG_CATEGORY_GUESS 重指', async () => {
    seedOldSix();
    putTag('t1', '传送带', 'oc2');   // 在旧「题型/情境」→ 应到「知识点/模型」
    putTag('t2', '易错', 'oc3');     // 在旧「错因」→ 应到「易错题」
    putTag('t3', '困难', 'oc3');     // 在旧「错因」→ 应到「难度」
    putTag('t4', '图像', 'oc5');     // 在旧「学科」→ 应到「其他特征」
    putTag('t5', '微元法', 'oc2');   // 在旧「题型/情境」→ 应到「典型方法」
    putTag('t6', '临界情况', 'oc1'); // 已正确 → 不动

    const migrated = await migrateTagTaxonomy();
    expect(migrated).toBe(true);

    const all = await dbGetAllTagCategories();
    expect(all.map((c) => c.name).sort()).toEqual(
      ['知识点/模型', '情境', '易错题', '难度', '系统', '其他特征', '典型方法'].sort(),
    );
    expect(all.find((c) => c.name === '题型/情境')).toBeUndefined();
    expect(all.find((c) => c.name === '错因')).toBeUndefined();
    expect(all.find((c) => c.name === '学科')).toBeUndefined();

    expect(await catNameOfTag('t1')).toBe('知识点/模型');
    expect(await catNameOfTag('t2')).toBe('易错题');
    expect(await catNameOfTag('t3')).toBe('难度');
    expect(await catNameOfTag('t4')).toBe('其他特征');
    expect(await catNameOfTag('t5')).toBe('典型方法');
    expect(await catNameOfTag('t6')).toBe('知识点/模型');
  });

  it('映射里没有的标签保持未分类，旧类别删除后不复活', async () => {
    seedOldSix();
    putTag('t1', '自定义神秘标签', 'oc5');
    putTag('t2', '另一映射外标签', null);

    expect(await migrateTagTaxonomy()).toBe(true);

    expect(await catNameOfTag('t1')).toBeNull();
    expect((await tags().getItem('t1')).category_id).toBeNull();
    expect((await tags().getItem('t2')).category_id).toBeNull();
    const names = (await dbGetAllTagCategories()).map((c) => c.name);
    expect(names).not.toContain('学科');
    expect(names).not.toContain('题型/情境');
    expect(TAG_CATEGORY_GUESS['自定义神秘标签']).toBeUndefined();
  });

  it('已软删的标签不参与重指', async () => {
    seedOldSix();
    putTag('t1', '传送带', 'oc2', '2026-02-01T00:00:00.000Z'); // 指向旧类：会被既有 dbDeleteTagCategory 置 null，但不重指
    putTag('t2', '传送带', 'oc1', '2026-02-01T00:00:00.000Z'); // 指向存活类：完全不动

    expect(await migrateTagTaxonomy()).toBe(true);

    const t1 = await tags().getItem('t1');
    expect(t1.deleted_at).toBeTruthy();
    expect(t1.category_id).toBeNull();
    const t2 = await tags().getItem('t2');
    expect(t2.category_id).toBe('oc1');
  });

  it('幂等：再跑一次返回 false、数据不变', async () => {
    seedOldSix();
    putTag('t1', '传送带', 'oc2');
    expect(await migrateTagTaxonomy()).toBe(true);

    const allBefore = await dbGetAllTagCategories();
    const t1Before = await tags().getItem('t1');
    const settingsBefore = await settings().getItem('taxonomyV2Migrated');

    expect(await migrateTagTaxonomy()).toBe(false);

    expect(await dbGetAllTagCategories()).toEqual(allBefore);
    expect(await tags().getItem('t1')).toEqual(t1Before);
    expect(await settings().getItem('taxonomyV2Migrated')).toBe(settingsBefore);
    expect(settingsBefore).toBe(true);
  });

  it('新装（store 空）：先 ensureDefaultTagCategories 再迁移 → 返回 false、七类就位', async () => {
    expect(await ensureDefaultTagCategories()).toBe(7);
    expect(await migrateTagTaxonomy()).toBe(false);
    const all = await dbGetAllTagCategories();
    expect(all).toHaveLength(7);
    expect(all.map((c) => c.name)).toEqual(['知识点/模型', '情境', '易错题', '难度', '系统', '其他特征', '典型方法']);
    expect(await settings().getItem('taxonomyV2Migrated')).toBe(true);
  });

  it('「系统」类别与 is_system 保持不变；新建类别保留默认 order 与 is_system', async () => {
    seedOldSix();
    expect(await migrateTagTaxonomy()).toBe(true);

    const all = await dbGetAllTagCategories();
    const sys = all.find((c) => c.name === '系统');
    expect(sys).toBeDefined();
    expect(sys!.is_system).toBe(true);
    expect(sys!.id).toBe('oc6');

    const def = (name: string) => DEFAULT_TAG_CATEGORIES.find((c) => c.name === name)!;
    for (const name of ['情境', '易错题', '其他特征', '典型方法']) {
      const c = all.find((x) => x.name === name)!;
      expect(c).toBeDefined();
      expect(c.order).toBe(def(name).order);
      expect(c.is_system).toBe(def(name).is_system);
    }
  });
});
