import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 2 数据层（2.1 / 2.2 / 2.3）回归测试，覆盖：
//   - expr：空表达式 / 单标签退化 / and-or 任意嵌套 / 未知标签(死引用) / 重复标签 / 空 children
//   - expr：每个节点命中题数自底向上（根、子分组、叶子）
//   - groups：增删改查（软删）/ kind 过滤与排序 / 系统成员标签（仅 topic，挂「系统」类别）
//   - groups：成员 = 表达式命中 ∪ 带系统成员标签的题
//   - 备份：groups 自动进 ALL_STORES（exportFullBackup 含该数组）

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
    generateId: () => 'id-' + (++idCounter),
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

import { evalExpr, collectDeadTagRefs, removeTagFromExpr, formatExpr, exprContainsTag, collectExprTagIds, type QuestionTagMap } from '../src/data/expr';
import {
  dbCreateGroup, dbUpdateGroup, dbDeleteGroup, dbGetAllGroups, dbGetGroup,
  getGroupMemberQuestionIds, getGroupManualMemberCount, buildGroupQuestionTagMap, invalidateGroupsCache,
} from '../src/data/groups';
import { exportFullBackup } from '../src/data/backup';

const groups = () => H.stores.dbGroups as any;
const tags = () => H.stores.dbTags as any;
const cats = () => H.stores.dbTagCategories as any;
const qt = () => H.stores.dbQuestionTags as any;
const questions = () => H.stores.dbQuestions as any;

function seedCategory(id: string, name: string, order: number, isSystem = false): void {
  cats().setItem(id, { id, name, order, is_system: isSystem, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null });
}

function seedQuestion(id: string, deleted = false): void {
  questions().setItem(id, { id, deleted_at: deleted ? '2026-02-01T00:00:00.000Z' : null });
}

// 关联记录默认指向一道「有效题」；questionDeleted 用于验证「题目自身软删不计入成员」。
function putAssoc(questionId: string, tagId: string, deleted = false, questionDeleted = false): void {
  if (!questions()._map.has(questionId)) seedQuestion(questionId, questionDeleted);
  qt().setItem(`${questionId}_${tagId}`, {
    question_id: questionId, tag_id: tagId,
    deleted_at: deleted ? '2026-02-01T00:00:00.000Z' : null,
  });
}

beforeEach(() => {
  for (const s of Object.values(H.stores)) (s as any)._map.clear();
  invalidateGroupsCache();
});

describe('2.3 表达式求值', () => {
  const map: QuestionTagMap = new Map([
    ['q1', new Set(['t1', 't2'])],
    ['q2', new Set(['t1'])],
    ['q3', new Set(['t2', 't3'])],
  ]);

  it('空表达式（根分组无子节点）命中空集，根题数为 0', () => {
    const r = evalExpr({ op: 'or', children: [] }, map);
    expect(r.hits.size).toBe(0);
    expect(r.counts).toEqual({ op: 'or', count: 0, children: [] });
  });

  it('单标签分组等价单标签（不特判）', () => {
    const bare = evalExpr({ tag: 't1' }, map);
    const orWrap = evalExpr({ op: 'or', children: [{ tag: 't1' }] }, map);
    const andWrap = evalExpr({ op: 'and', children: [{ tag: 't1' }] }, map);
    expect([...bare.hits].sort()).toEqual(['q1', 'q2']);
    expect([...orWrap.hits].sort()).toEqual([...bare.hits].sort());
    expect([...andWrap.hits].sort()).toEqual([...bare.hits].sort());
    expect(orWrap.counts).toEqual({ op: 'or', count: 2, children: [{ tag: 't1', count: 2 }] });
  });

  it('and / or 任意嵌套，且每个节点命中题数自底向上正确', () => {
    // (t1 或 t3) 且 t2 → (q1,q2,q3) ∩ (q1,q3) = {q1,q3}
    const r = evalExpr({
      op: 'and',
      children: [
        { op: 'or', children: [{ tag: 't1' }, { tag: 't3' }] },
        { tag: 't2' },
      ],
    }, map);
    expect([...r.hits].sort()).toEqual(['q1', 'q3']);
    expect(r.counts).toEqual({
      op: 'and', count: 2,
      children: [
        { op: 'or', count: 3, children: [{ tag: 't1', count: 2 }, { tag: 't3', count: 1 }] },
        { tag: 't2', count: 2 },
      ],
    });
  });

  it('三层嵌套求值正确', () => {
    // ((t1 且 t2) 或 t3) → ({q1}) ∪ ({q3}) = {q1,q3}
    const r = evalExpr({
      op: 'or',
      children: [
        { op: 'and', children: [{ tag: 't1' }, { tag: 't2' }] },
        { tag: 't3' },
      ],
    }, map);
    expect([...r.hits].sort()).toEqual(['q1', 'q3']);
  });

  it('未知标签 id 视为空集，且计入死引用报告', () => {
    expect(evalExpr({ tag: 'nope' }, map).hits.size).toBe(0);
    const dead = collectDeadTagRefs(
      { op: 'or', children: [{ tag: 't1' }, { tag: 'nope' }, { tag: 'gone' }] },
      ['t1'],
    );
    expect(dead).toEqual(['nope', 'gone']);
  });

  it('未知标签夹在 and 中会把结果掐成空（可观测性有据可查）', () => {
    const r = evalExpr({ op: 'and', children: [{ tag: 't1' }, { tag: 'nope' }] }, map);
    expect(r.hits.size).toBe(0);
    expect(r.counts).toEqual({
      op: 'and', count: 0,
      children: [{ tag: 't1', count: 2 }, { tag: 'nope', count: 0 }],
    });
  });

  it('重复标签去重，题数不翻倍', () => {
    const r = evalExpr({ op: 'or', children: [{ tag: 't1' }, { tag: 't1' }] }, map);
    expect([...r.hits].sort()).toEqual(['q1', 'q2']);
    expect(r.counts).toEqual({
      op: 'or', count: 2,
      children: [{ tag: 't1', count: 2 }, { tag: 't1', count: 2 }],
    });
  });

  it('空 children 数组：and 与 or 都命中空集', () => {
    expect(evalExpr({ op: 'and', children: [] }, map).hits.size).toBe(0);
    expect(evalExpr({ op: 'or', children: [] }, map).counts).toEqual({ op: 'or', count: 0, children: [] });
  });

  it('collectDeadTagRefs：无死引用返回空 / 去重', () => {
    expect(collectDeadTagRefs({ op: 'and', children: [{ tag: 't1' }, { tag: 't2' }] }, ['t1', 't2'])).toEqual([]);
    expect(collectDeadTagRefs({ op: 'or', children: [{ tag: 'x' }, { tag: 'x' }, { tag: 'x' }] }, [])).toEqual(['x']);
  });

  it('removeTagFromExpr：物理移除叶子并剔除因此变空的子分组', () => {
    const expr = { op: 'and', children: [{ op: 'or', children: [{ tag: 't1' }] }, { tag: 't2' }] };
    expect(removeTagFromExpr(expr, 't1')).toEqual({ op: 'and', children: [{ tag: 't2' }] });
    expect(removeTagFromExpr(expr, 't2')).toEqual({ op: 'and', children: [{ op: 'or', children: [{ tag: 't1' }] }] });
    expect(removeTagFromExpr({ tag: 't1' }, 't1')).toEqual({ op: 'or', children: [] });
    expect(removeTagFromExpr(expr, 'nope')).toEqual(expr);
  });

  it('removeTagFromExpr：移除根下唯一叶子后根分组为空（明确提示的判据）', () => {
    expect(removeTagFromExpr({ op: 'or', children: [{ tag: 't1' }, { tag: 't2' }] }, 't1'))
      .toEqual({ op: 'or', children: [{ tag: 't2' }] });
    expect(removeTagFromExpr({ op: 'or', children: [{ tag: 't1' }] }, 't1'))
      .toEqual({ op: 'or', children: [] });
  });

  it('formatExpr：按计划示例回显（分组加括号、紧贴「且」）', () => {
    const nameOf = (id: string) => ({ t1: '圆周运动', t2: '平抛运动', t3: '较难' }[id] ?? id);
    const expr = { op: 'and', children: [{ op: 'or', children: [{ tag: 't1' }, { tag: 't2' }] }, { tag: 't3' }] };
    expect(formatExpr(expr, nameOf)).toBe('（圆周运动 或 平抛运动）且 较难');
    expect(formatExpr({ op: 'or', children: [] }, nameOf)).toBe('（空）');
    expect(formatExpr({ tag: 't1' }, nameOf)).toBe('圆周运动');
  });

  it('exprContainsTag / collectExprTagIds', () => {
    const expr = { op: 'and', children: [{ op: 'or', children: [{ tag: 't1' }, { tag: 't2' }] }, { tag: 't3' }] };
    expect(exprContainsTag(expr, 't2')).toBe(true);
    expect(exprContainsTag(expr, 'nope')).toBe(false);
    expect(collectExprTagIds(expr)).toEqual(['t1', 't2', 't3']);
  });
});

describe('2.1 groups 数据层', () => {
  it('创建 topic 自动建系统成员标签：挂「系统」类别且命名 专题·<名称>', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: '力学综合' });
    expect(g.member_tag_id).toBeTruthy();
    expect(g.expr).toEqual({ op: 'or', children: [] });
    expect(g.order).toBe(0);
    const tag = await tags().getItem(g.member_tag_id);
    expect(tag.name).toBe('专题·力学综合');
    expect(tag.category_id).toBe('sys');
    expect(tag.deleted_at).toBeNull();
  });

  it('创建 chapter 不建成员标签', async () => {
    const before = tags()._map.size;
    const g = await dbCreateGroup({ kind: 'chapter', name: '第三章' });
    expect(g.member_tag_id).toBeNull();
    expect(tags()._map.size).toBe(before);
  });

  it('系统类别缺失时成员标签 category_id 兜底为 null（不崩）', async () => {
    const g = await dbCreateGroup({ kind: 'topic', name: '无类别' });
    const tag = await tags().getItem(g.member_tag_id);
    expect(tag.category_id).toBeNull();
  });

  it('dbGetAllGroups 按 kind 过滤、按 order 排序、排除软删', async () => {
    await dbCreateGroup({ kind: 'topic', name: 'B', order: 2 });
    await dbCreateGroup({ kind: 'chapter', name: 'A', order: 1 });
    const deleted = await dbCreateGroup({ kind: 'chapter', name: 'C', order: 3 });
    await dbDeleteGroup(deleted.id);

    expect((await dbGetAllGroups('topic')).map((g) => g.name)).toEqual(['B']);
    expect((await dbGetAllGroups('chapter')).map((g) => g.name)).toEqual(['A']);
    expect((await dbGetAllGroups()).map((g) => g.name)).toEqual(['A', 'B']);
  });

  it('dbUpdateGroup 更新 name / expr / order 并刷新 updated_at', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: '旧' });
    const updated = await dbUpdateGroup(g.id, { name: '新', expr: { tag: 't1' }, order: 9 });
    expect(updated?.name).toBe('新');
    expect(updated?.expr).toEqual({ tag: 't1' });
    expect(updated?.order).toBe(9);
    expect(updated?.updated_at).toBeTruthy();
    expect(await dbGetGroup(g.id)).not.toBeNull();
  });

  it('dbUpdateGroup 对不存在 / 已软删的组返回 null', async () => {
    expect(await dbUpdateGroup('nope', { name: 'x' })).toBeNull();
    const g = await dbCreateGroup({ kind: 'chapter', name: 'X' });
    await dbDeleteGroup(g.id);
    expect(await dbUpdateGroup(g.id, { name: 'x' })).toBeNull();
  });

  it('dbDeleteGroup 是软删：记录仍在 store 中，仅置 deleted_at', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: 'X' });
    await dbDeleteGroup(g.id);
    const raw = await groups().getItem(g.id);
    expect(raw).not.toBeNull();
    expect(raw.deleted_at).toBeTruthy();
    expect(await dbGetAllGroups()).toHaveLength(0);
  });
});

describe('2.1 成员集合 = 表达式命中 ∪ 系统成员标签', () => {
  it('topic：表达式命中与手动归入取并集', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: 'T', expr: { op: 'and', children: [{ tag: 't1' }, { tag: 't2' }] } });
    putAssoc('q1', 't1'); putAssoc('q1', 't2');   // 表达式命中
    putAssoc('q2', g.member_tag_id!);             // 手动归入
    putAssoc('q3', 't1');                          // 只命中一半 → 不在集合
    const ids = await getGroupMemberQuestionIds(g.id);
    expect(ids).toEqual(['q1', 'q2']);
  });

  it('topic 空表达式：只收手动归入的题', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: '纯手工' });
    putAssoc('q9', g.member_tag_id!);
    expect(await getGroupMemberQuestionIds(g.id)).toEqual(['q9']);
  });

  it('chapter：只取表达式命中（member_tag_id 为 null）', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: 'C', expr: { tag: 't1' } });
    putAssoc('q5', 't1');
    putAssoc('q6', 'other');
    expect(await getGroupMemberQuestionIds(g.id)).toEqual(['q5']);
  });

  it('已软删的关联不计入成员集合', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: 'C', expr: { tag: 't1' } });
    putAssoc('q5', 't1');
    putAssoc('q6', 't1', true);
    expect(await getGroupMemberQuestionIds(g.id)).toEqual(['q5']);
  });

  it('裁决2：题目自身已软删的，即使有关联也不计入成员集合', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: 'C', expr: { tag: 't1' } });
    putAssoc('q5', 't1');
    putAssoc('q6', 't1', false, true);
    expect(await getGroupMemberQuestionIds(g.id)).toEqual(['q5']);
    expect((await buildGroupQuestionTagMap()).has('q6')).toBe(false);
  });

  it('裁决2：topic 手动归入的已删题目同样不计入', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: 'T' });
    putAssoc('q1', g.member_tag_id!);
    putAssoc('q2', g.member_tag_id!, false, true);
    expect(await getGroupMemberQuestionIds(g.id)).toEqual(['q1']);
    expect(await getGroupManualMemberCount(g.id)).toBe(1);
  });

  it('不存在的组返回空数组', async () => {
    expect(await getGroupMemberQuestionIds('nope')).toEqual([]);
    expect(await getGroupManualMemberCount('nope')).toBe(0);
  });
});

describe('裁决3 专题改名联动系统成员标签名', () => {
  it('改名后标签名同步为 专题·<新名>', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: '旧名' });
    const updated = await dbUpdateGroup(g.id, { name: '新名' });
    expect(updated?.name).toBe('新名');
    expect((await tags().getItem(g.member_tag_id)).name).toBe('专题·新名');
  });

  it('章节改名不触碰标签（无成员标签）', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: '旧' });
    await dbUpdateGroup(g.id, { name: '新' });
    expect(tags()._map.size).toBe(0);
  });

  it('只改 expr 不改名时不动标签名', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: '原名' });
    await dbUpdateGroup(g.id, { expr: { tag: 't1' } });
    expect((await tags().getItem(g.member_tag_id)).name).toBe('专题·原名');
  });
});

describe('2.8 删专题级联移除系统成员标签', () => {
  it('删 topic：组软删、成员标签软删、手动归入关联解除', async () => {
    seedCategory('sys', '系统', 5, true);
    const g = await dbCreateGroup({ kind: 'topic', name: '待删' });
    putAssoc('q1', g.member_tag_id!);
    await dbDeleteGroup(g.id);
    expect((await groups().getItem(g.id)).deleted_at).toBeTruthy();
    expect((await tags().getItem(g.member_tag_id)).deleted_at).toBeTruthy();
    expect(qt()._map.size).toBe(0);
    expect(await dbGetAllGroups()).toHaveLength(0);
  });

  it('删 chapter 不产生任何标签副作用', async () => {
    const g = await dbCreateGroup({ kind: 'chapter', name: 'C' });
    await dbDeleteGroup(g.id);
    expect(tags()._map.size).toBe(0);
  });
});

describe('2.1 备份接线', () => {
  it('exportFullBackup 含 groups 数组（groups 已进 ALL_STORES）', async () => {
    await dbCreateGroup({ kind: 'chapter', name: '备份章' });
    const data = await exportFullBackup();
    expect(Array.isArray((data as any).groups)).toBe(true);
    expect((data as any).groups).toHaveLength(1);
  });
});
