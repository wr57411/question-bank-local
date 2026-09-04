import { describe, it, expect } from 'vitest';
import { mergeUserSettings } from '../../server/src/services/user-settings.ts';

describe('mergeUserSettings', () => {
  it('incoming 缺某字段 → 该字段原样保留（不被抹除）', () => {
    const prev = { a: 1, b: 2, cloud_providers: [{ key: 'secret' }] };
    const incoming = { a: 9 };
    const merged = mergeUserSettings(prev, incoming);
    expect(merged).toEqual({ a: 9, b: 2, cloud_providers: [{ key: 'secret' }] });
  });

  it('incoming 显式传 [] → 清空生效（不被恢复）', () => {
    const prev = { cloud_providers: [{ key: 'secret' }], other: 1 };
    const incoming = { cloud_providers: [] };
    const merged = mergeUserSettings(prev, incoming);
    expect(merged.cloud_providers).toEqual([]);
    expect(merged.other).toBe(1);
  });

  it('incoming 有新字段 → 正常写入', () => {
    const prev = { a: 1 };
    const incoming = { c: 3 };
    const merged = mergeUserSettings(prev, incoming);
    expect(merged).toEqual({ a: 1, c: 3 });
  });

  it('incoming 覆盖已有字段', () => {
    const prev = { a: 1, b: 2 };
    const incoming = { b: 20 };
    expect(mergeUserSettings(prev, incoming)).toEqual({ a: 1, b: 20 });
  });

  it('prev 为空对象时直接采用 incoming', () => {
    const incoming = { x: 'hello' };
    expect(mergeUserSettings({}, incoming)).toEqual({ x: 'hello' });
  });
});
