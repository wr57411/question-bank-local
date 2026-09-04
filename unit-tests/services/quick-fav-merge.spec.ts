import { describe, it, expect } from 'vitest';
import { mergeQuickFavTags, type QuickFavSnapshot, type QuickFavItem } from '../../server/src/services/quick-fav-merge.ts';

const A = '2024-01-01T00:00:00.000Z';
const B = '2024-02-01T00:00:00.000Z';
const C = '2024-03-01T00:00:00.000Z';

const item = (on: boolean, at: string): QuickFavItem => ({ on, at });
const snap = (
  items: Record<string, QuickFavItem>,
  orderIds: string[],
  orderAt: string,
  rev: number
): QuickFavSnapshot => ({ items, order: { ids: orderIds, at: orderAt }, rev });

describe('mergeQuickFavTags 合并规则矩阵', () => {
  it('仅一端有该 key → 采用存在的那一端', () => {
    const local = snap({ a: item(true, A) }, ['a'], A, 1);
    const remote = snap({ b: item(false, B) }, ['b'], B, 1);
    const { merged, conflicts } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(0);
    expect(merged.items.a).toEqual(item(true, A));
    expect(merged.items.b).toEqual(item(false, B));
  });

  it('两端都有、结论相同 → 取 at 较新者', () => {
    const local = snap({ a: item(true, A) }, ['a'], A, 1);
    const remote = snap({ a: item(true, B) }, ['a'], B, 1);
    const { merged, conflicts } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(0);
    expect(merged.items.a).toEqual(item(true, B));
  });

  it('结论相反、local.rev === remote.rev → 取 at 较新者，不算冲突', () => {
    const local = snap({ a: item(true, A) }, ['a'], A, 5);
    const remote = snap({ a: item(false, B) }, ['a'], B, 5);
    const { merged, conflicts } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(0);
    expect(merged.items.a).toEqual(item(false, B));
  });

  it('结论相反、local.rev < remote.rev → 真冲突，不自动裁决', () => {
    const local = snap({ a: item(true, A) }, ['a'], A, 2);
    const remote = snap({ a: item(false, B) }, ['a'], B, 5);
    const { merged, conflicts } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ id: 'a', local: item(true, A), remote: item(false, B) });
    expect(merged.items.a).toEqual(item(true, A));
  });

  it('结论相反、local.rev > remote.rev → 取 at 较新者，不算冲突', () => {
    const local = snap({ a: item(true, A) }, ['a'], A, 9);
    const remote = snap({ a: item(false, B) }, ['a'], B, 5);
    const { merged, conflicts } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(0);
    expect(merged.items.a).toEqual(item(false, B));
  });

  it('remote 为 undefined（首次写入）→ 全部采用 local，无冲突', () => {
    const local = snap({ a: item(true, A), b: item(false, B) }, ['a'], A, 3);
    const { merged, conflicts } = mergeQuickFavTags(local, undefined);
    expect(conflicts).toHaveLength(0);
    expect(merged.items).toEqual({ a: item(true, A), b: item(false, B) });
    expect(merged.order).toEqual({ ids: ['a'], at: A });
  });
});

describe('mergeQuickFavTags 顺序合并', () => {
  it('骨架取 order.at 较新的一端', () => {
    const local = snap(
      { a: item(true, A), b: item(true, B) },
      ['a'],
      A,
      1
    );
    const remote = snap(
      { a: item(true, A), b: item(true, B) },
      ['b'],
      B,
      1
    );
    const { merged } = mergeQuickFavTags(local, remote);
    expect(merged.order.at).toBe(B);
  });

  it('骨架缺失的 on=true 成员按 at 升序追加到末尾', () => {
    const local = snap(
      { a: item(true, A), b: item(true, '2024-02-01T00:00:00.000Z'), c: item(true, '2024-01-15T00:00:00.000Z') },
      [],
      '',
      1
    );
    const remote = snap(
      { a: item(true, A) },
      ['a'],
      B,
      1
    );
    const { merged } = mergeQuickFavTags(local, remote);
    expect(merged.order.ids).toEqual(['a', 'c', 'b']);
    expect(merged.order.at).toBe(B);
  });

  it('骨架里 on=false 或已不存在的成员被剔除', () => {
    const local = snap(
      { a: item(false, A), d: item(true, '2024-01-01T00:00:00.000Z') },
      ['a', 'd', 'ghost'],
      A,
      1
    );
    const { merged } = mergeQuickFavTags(local, undefined);
    expect(merged.order.ids).toEqual(['d']);
  });
});

describe('mergeQuickFavTags 鲁棒性与 at 原样保留', () => {
  it('at 为非法时间字符串 → 按最旧处理，不崩溃', () => {
    const local = snap({ a: item(true, 'garbage') }, ['a'], 'garbage', 2);
    const remote = snap({ a: item(false, 'garbage') }, ['a'], 'garbage', 5);
    expect(() => mergeQuickFavTags(local, remote)).not.toThrow();
    const { conflicts, merged } = mergeQuickFavTags(local, remote);
    expect(conflicts).toHaveLength(1);
    expect(merged.items.a).toEqual(item(true, 'garbage'));
  });

  it('服务端原样保留 at，不被篡改（等价格式也保留）', () => {
    const fragile = '2024-05-01T00:00:00.000+00:00';
    const local = snap({ a: item(true, fragile) }, ['a'], fragile, 1);
    const remote = snap({ b: item(true, A) }, ['b'], A, 1);
    const { merged } = mergeQuickFavTags(local, remote);
    expect(merged.items.a.at).toBe(fragile);
    expect(merged.items.a.at).not.toBe('2024-05-01T00:00:00.000Z');
  });
});
