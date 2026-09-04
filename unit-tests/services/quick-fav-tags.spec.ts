import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadQuickFavTags,
  visibleQuickFavIds,
  setQuickFavOn,
  reorderQuickFavIds,
  pendingQuickFavCount,
  hasPendingQuickFavChanges,
  markQuickFavSynced,
  beginQuickFavPush,
  endQuickFavPush,
  adoptRemoteQuickFavTags,
  resolveQuickFavConflicts,
} from '../../src/services/quick-fav-tags';

beforeEach(() => {
  localStorage.clear();
  endQuickFavPush();
});

describe('loadQuickFavTags', () => {
  it('returns empty initial state when no record', () => {
    const s = loadQuickFavTags();
    expect(s.items).toEqual({});
    expect(s.order).toEqual({ ids: [], at: '' });
    expect(s.rev).toBe(0);
    expect(s.synced).toEqual({ items: {}, order: { ids: [], at: '' } });
  });

  it('returns empty initial state on illegal JSON without throwing', () => {
    localStorage.setItem('quickFavoriteTags', '{not json');
    expect(() => loadQuickFavTags()).not.toThrow();
    expect(loadQuickFavTags()).toEqual({
      items: {},
      order: { ids: [], at: '' },
      rev: 0,
      synced: { items: {}, order: { ids: [], at: '' } },
    });
  });

  it('drops items that are not objects or missing on/at', () => {
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({
        items: {
          a: { on: true, at: '2024-01-01T00:00:00.000Z' },
          b: { on: true },
          c: { at: 'x' },
          d: 'junk',
          e: { on: false, at: '2024-01-02T00:00:00.000Z' },
        },
      })
    );
    const s = loadQuickFavTags();
    expect(Object.keys(s.items).sort()).toEqual(['a', 'e']);
  });

  it('treats unparseable at as oldest (0)', () => {
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({ items: { a: { on: true, at: 'garbage' } } })
    );
    const s = loadQuickFavTags();
    expect(s.items.a.at).toBe('garbage');
    expect(Date.parse(s.items.a.at) || 0).toBe(0);
  });

  it('parses numeric string rev but normalizes garbage / NaN / negative to 0', () => {
    localStorage.setItem('quickFavoriteTags', JSON.stringify({ rev: '5' }));
    expect(loadQuickFavTags().rev).toBe(5);
    localStorage.setItem('quickFavoriteTags', JSON.stringify({ rev: 'oops' }));
    expect(loadQuickFavTags().rev).toBe(0);
    localStorage.setItem('quickFavoriteTags', JSON.stringify({ rev: -3 }));
    expect(loadQuickFavTags().rev).toBe(0);
    localStorage.setItem('quickFavoriteTags', JSON.stringify({ rev: NaN }));
    expect(loadQuickFavTags().rev).toBe(0);
    localStorage.setItem('quickFavoriteTags', JSON.stringify({ rev: 7 }));
    expect(loadQuickFavTags().rev).toBe(7);
  });

  it('filters order.ids missing from items without writing them back', () => {
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({
        items: { a: { on: true, at: '2024-01-01T00:00:00.000Z' } },
        order: { ids: ['a', 'ghost'], at: '2024-01-01T00:00:00.000Z' },
      })
    );
    expect(visibleQuickFavIds()).toEqual(['a']);
    const s = loadQuickFavTags();
    expect(s.order.ids).toEqual(['a', 'ghost']);
  });
});

describe('visibleQuickFavIds', () => {
  it('returns on items in order.ids sequence', () => {
    setQuickFavOn('a', true);
    setQuickFavOn('b', true);
    setQuickFavOn('c', true);
    reorderQuickFavIds(['c', 'a', 'b']);
    expect(visibleQuickFavIds()).toEqual(['c', 'a', 'b']);
  });

  it('hides items that are off', () => {
    setQuickFavOn('a', true);
    setQuickFavOn('b', false);
    expect(visibleQuickFavIds()).toEqual(['a']);
  });

  it('appends new members missing from order by at ascending', () => {
    setQuickFavOn('a', true);
    reorderQuickFavIds(['a']);
    setQuickFavOn('c', true);
    setQuickFavOn('b', true);
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({
        items: {
          a: { on: true, at: '2024-01-01T00:00:00.000Z' },
          b: { on: true, at: '2024-03-01T00:00:00.000Z' },
          c: { on: true, at: '2024-02-01T00:00:00.000Z' },
        },
        order: { ids: ['a'], at: '2024-01-01T00:00:00.000Z' },
      })
    );
    expect(visibleQuickFavIds()).toEqual(['a', 'c', 'b']);
  });
});

describe('pending changes', () => {
  it('counts > 0 after edits and 0 after markQuickFavSynced', () => {
    setQuickFavOn('a', true);
    expect(pendingQuickFavCount()).toBeGreaterThan(0);
    expect(hasPendingQuickFavChanges()).toBe(true);
    markQuickFavSynced(1, loadQuickFavTags().items, loadQuickFavTags().order);
    expect(pendingQuickFavCount()).toBe(0);
    expect(hasPendingQuickFavChanges()).toBe(false);
  });

  it('counts a delete as a pending change', () => {
    setQuickFavOn('a', true);
    markQuickFavSynced(1, loadQuickFavTags().items, loadQuickFavTags().order);
    setQuickFavOn('a', false);
    expect(pendingQuickFavCount()).toBeGreaterThan(0);
    markQuickFavSynced(2, loadQuickFavTags().items, loadQuickFavTags().order);
    expect(pendingQuickFavCount()).toBe(0);
  });

  it('counts an order change as one pending item', () => {
    setQuickFavOn('a', true);
    setQuickFavOn('b', true);
    markQuickFavSynced(1, loadQuickFavTags().items, loadQuickFavTags().order);
    reorderQuickFavIds(['b', 'a']);
    expect(pendingQuickFavCount()).toBe(1);
  });

  it('does not misreport pending for equivalent ISO time formats', () => {
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({
        items: { a: { on: true, at: '2024-05-01T00:00:00.000Z' } },
        order: { ids: ['a'], at: '' },
        rev: 1,
        synced: {
          items: { a: { on: true, at: '2024-05-01T00:00:00.000+00:00' } },
          order: { ids: ['a'], at: '' },
        },
      })
    );
    expect(pendingQuickFavCount()).toBe(0);
  });
});

describe('adoptRemoteQuickFavTags', () => {
  const remote = (items: Record<string, { on: boolean; at: string }>) => ({
    items,
    order: { ids: Object.keys(items), at: '2024-05-01T00:00:00.000Z' },
    rev: 42,
  });

  it('adopts remote when local has no pending', () => {
    const r = remote({ x: { on: true, at: '2024-05-01T00:00:00.000Z' } });
    const ok = adoptRemoteQuickFavTags(r);
    expect(ok).toBe(true);
    const s = loadQuickFavTags();
    expect(s.items).toEqual(r.items);
    expect(s.rev).toBe(42);
    expect(pendingQuickFavCount()).toBe(0);
  });

  it('rejects adopt and keeps local when there are pending changes', () => {
    setQuickFavOn('a', true);
    const r = remote({ x: { on: true, at: '2024-05-01T00:00:00.000Z' } });
    const ok = adoptRemoteQuickFavTags(r);
    expect(ok).toBe(false);
    const s = loadQuickFavTags();
    expect(s.items).toEqual({ a: { on: true, at: expect.any(String) } });
  });

  it('force adopt overrides local even with pending changes', () => {
    setQuickFavOn('a', true);
    const r = remote({ x: { on: true, at: '2024-05-01T00:00:00.000Z' } });
    const ok = adoptRemoteQuickFavTags(r, true);
    expect(ok).toBe(true);
    const s = loadQuickFavTags();
    expect(s.items).toEqual(r.items);
  });
});

describe('resolveQuickFavConflicts', () => {
  it('writes picked on values and updates rev', () => {
    setQuickFavOn('a', true);
    setQuickFavOn('b', false);
    resolveQuickFavConflicts({ a: false, b: true }, 9);
    const s = loadQuickFavTags();
    expect(s.items.a).toEqual({ on: false, at: expect.any(String) });
    expect(s.items.b).toEqual({ on: true, at: expect.any(String) });
    expect(s.rev).toBe(9);
  });
});

describe('markQuickFavSynced race safety', () => {
  it('single push adopts server and clears pending', () => {
    setQuickFavOn('a', true);
    const snap = beginQuickFavPush();
    expect(snap).not.toBeNull();
    markQuickFavSynced(
      1,
      { b: { on: true, at: '2024-05-01T00:00:00.000Z' } },
      { ids: ['b'], at: '2024-05-01T00:00:00.000Z' }
    );
    const s = loadQuickFavTags();
    expect(s.items).toEqual({ b: { on: true, at: '2024-05-01T00:00:00.000Z' } });
    expect(pendingQuickFavCount()).toBe(0);
    expect(endQuickFavPush()).toBe(false);
  });

  it('never overwrites user edits made during push', () => {
    setQuickFavOn('物理', true);
    beginQuickFavPush();
    setQuickFavOn('化学', true);
    markQuickFavSynced(
      1,
      { 物理: { on: true, at: '2024-05-01T00:00:00.000Z' } },
      { ids: ['物理'], at: '2024-05-01T00:00:00.000Z' }
    );
    const s = loadQuickFavTags();
    expect(Object.keys(s.items).sort()).toEqual(['化学', '物理']);
    expect(s.rev).toBe(1);
    expect(pendingQuickFavCount()).toBeGreaterThan(0);
  });

  it('does not swallow edits when two pushes overlap', () => {
    setQuickFavOn('a', true);
    const snap1 = beginQuickFavPush();
    expect(snap1).not.toBeNull();
    setQuickFavOn('b', true);
    const snap2 = beginQuickFavPush();
    expect(snap2).toBeNull();
    markQuickFavSynced(
      1,
      { a: { on: true, at: '2024-05-01T00:00:00.000Z' } },
      { ids: ['a'], at: '2024-05-01T00:00:00.000Z' }
    );
    const s = loadQuickFavTags();
    expect(Object.keys(s.items).sort()).toEqual(['a', 'b']);
    expect(endQuickFavPush()).toBe(true);
  });

  it('adopts server value when there was no inflight push', () => {
    setQuickFavOn('a', true);
    markQuickFavSynced(
      5,
      { b: { on: true, at: '2024-05-01T00:00:00.000Z' } },
      { ids: ['b'], at: '2024-05-01T00:00:00.000Z' }
    );
    const s = loadQuickFavTags();
    expect(s.items).toEqual({ b: { on: true, at: '2024-05-01T00:00:00.000Z' } });
    expect(s.rev).toBe(5);
  });
});

describe('inflight guard self-heal and reset', () => {
  it('returns null while a push is still in flight', () => {
    setQuickFavOn('a', true);
    const s1 = beginQuickFavPush();
    expect(s1).not.toBeNull();
    const s2 = beginQuickFavPush();
    expect(s2).toBeNull();
    endQuickFavPush();
  });

  it('self-heals after inflight TTL expires', () => {
    vi.useFakeTimers();
    try {
      setQuickFavOn('a', true);
      const s1 = beginQuickFavPush();
      expect(s1).not.toBeNull();
      vi.advanceTimersByTime(31000);
      const s2 = beginQuickFavPush();
      expect(s2).not.toBeNull();
      endQuickFavPush();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears inflight after force adopt so a later push can start', () => {
    setQuickFavOn('a', true);
    beginQuickFavPush();
    const r = {
      items: { x: { on: true, at: '2024-05-01T00:00:00.000Z' } },
      order: { ids: ['x'], at: '2024-05-01T00:00:00.000Z' },
      rev: 42,
    };
    expect(adoptRemoteQuickFavTags(r, true)).toBe(true);
    expect(beginQuickFavPush()).not.toBeNull();
    markQuickFavSynced(43, r.items, r.order);
    expect(pendingQuickFavCount()).toBe(0);
    endQuickFavPush();
  });
});

describe('tolerance integration', () => {
  it('survives garbage rev string, bad item, and ghost order id together', () => {
    localStorage.setItem(
      'quickFavoriteTags',
      JSON.stringify({
        items: { a: { on: true, at: '2024-01-01T00:00:00.000Z' }, bad: 5 },
        order: { ids: ['a', 'ghost'], at: 'x' },
        rev: 'oops',
        synced: 'not-json',
      })
    );
    const s = loadQuickFavTags();
    expect(s.rev).toBe(0);
    expect(s.items).toEqual({ a: { on: true, at: '2024-01-01T00:00:00.000Z' } });
    expect(s.order.ids).toEqual(['a', 'ghost']);
    expect(visibleQuickFavIds()).toEqual(['a']);
  });
});
