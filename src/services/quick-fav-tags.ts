export interface QuickFavItem {
  on: boolean;
  at: string;
}

export interface QuickFavRemote {
  items: Record<string, QuickFavItem>;
  order: { ids: string[]; at: string };
  rev: number;
}

export interface QuickFavTags extends QuickFavRemote {
  synced: { items: Record<string, QuickFavItem>; order: { ids: string[]; at: string } };
}

export interface QuickFavConflict {
  id: string;
  local: QuickFavItem;
  remote: QuickFavItem;
}

const KEY = 'quickFavoriteTags';
const INFLIGHT_TTL_MS = 30000;

let inflightSnapshot: string | null = null;
let inflightAt = 0;
let queued = false;

function resetInflight(): void {
  inflightSnapshot = null;
  inflightAt = 0;
  queued = false;
}

function emptyState(): QuickFavTags {
  return { items: {}, order: { ids: [], at: '' }, rev: 0, synced: { items: {}, order: { ids: [], at: '' } } };
}

function atTime(at: string): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? 0 : t;
}

function normalizeItem(v: unknown): QuickFavItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.on !== 'boolean') return null;
  if (typeof o.at !== 'string') return null;
  return { on: o.on, at: o.at };
}

function cleanItems(raw: unknown): Record<string, QuickFavItem> {
  const out: Record<string, QuickFavItem> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ni = normalizeItem(v);
    if (ni) out[k] = ni;
  }
  return out;
}

function normalizeOrder(raw: unknown): { ids: string[]; at: string } {
  if (!raw || typeof raw !== 'object') return { ids: [], at: '' };
  const o = raw as Record<string, unknown>;
  const ids = Array.isArray(o.ids)
    ? (o.ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const at = typeof o.at === 'string' ? o.at : '';
  return { ids, at };
}

function normalizeSynced(raw: unknown): { items: Record<string, QuickFavItem>; order: { ids: string[]; at: string } } {
  if (!raw || typeof raw !== 'object') return { items: {}, order: { ids: [], at: '' } };
  const o = raw as Record<string, unknown>;
  return {
    items: cleanItems(o.items),
    order: normalizeOrder(o.order),
  };
}

function itemsEqual(a: Record<string, QuickFavItem>, b: Record<string, QuickFavItem>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const ai = a[k];
    const bi = b[k];
    if (!bi || ai.on !== bi.on || atTime(ai.at) !== atTime(bi.at)) return false;
  }
  return true;
}

function orderEquals(a: { ids: string[]; at: string }, b: { ids: string[]; at: string }): boolean {
  if (a.ids.length !== b.ids.length) return false;
  for (let i = 0; i < a.ids.length; i++) {
    if (a.ids[i] !== b.ids[i]) return false;
  }
  return atTime(a.at) === atTime(b.at);
}

function snapshotEqual(
  items: Record<string, QuickFavItem>,
  order: { ids: string[]; at: string },
  snap: string | null
): boolean {
  if (!snap) return false;
  try {
    const p = JSON.parse(snap);
    return itemsEqual(items, cleanItems(p?.items)) && orderEquals(order, normalizeOrder(p?.order));
  } catch {
    return false;
  }
}

export function loadQuickFavTags(): QuickFavTags {
  const raw = localStorage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    const p = JSON.parse(raw);
    return {
      items: cleanItems(p?.items),
      order: normalizeOrder(p?.order),
      rev: normalizeRev(p?.rev),
      synced: normalizeSynced(p?.synced),
    };
  } catch {
    return emptyState();
  }
}

export function saveQuickFavTags(next: QuickFavTags): QuickFavTags {
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function visibleQuickFavIds(): string[] {
  const state = loadQuickFavTags();
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of state.order.ids) {
    const it = state.items[id];
    if (it && it.on) {
      ordered.push(id);
      seen.add(id);
    }
  }
  const extras = Object.keys(state.items)
    .filter((id) => state.items[id].on && !seen.has(id))
    .sort((a, b) => atTime(state.items[a].at) - atTime(state.items[b].at));
  return [...ordered, ...extras];
}

export function setQuickFavOn(id: string, on: boolean): void {
  const state = loadQuickFavTags();
  state.items[id] = { on, at: new Date().toISOString() };
  saveQuickFavTags(state);
}

export function reorderQuickFavIds(ids: string[]): void {
  const state = loadQuickFavTags();
  state.order = { ids: [...ids], at: new Date().toISOString() };
  saveQuickFavTags(state);
}

export function pendingQuickFavCount(): number {
  const state = loadQuickFavTags();
  const snap = normalizeSynced(state.synced);
  let count = 0;
  const allKeys = new Set([...Object.keys(state.items), ...Object.keys(snap.items)]);
  for (const k of allKeys) {
    const cur = state.items[k];
    const sync = snap.items[k];
    if (!cur && !sync) continue;
    if (!cur || !sync) {
      count++;
      continue;
    }
    if (cur.on !== sync.on || atTime(cur.at) !== atTime(sync.at)) count++;
  }
  if (!orderEquals(state.order, snap.order)) count++;
  return count;
}

export function hasPendingQuickFavChanges(): boolean {
  return pendingQuickFavCount() > 0;
}

export function beginQuickFavPush(): string | null {
  if (inflightSnapshot !== null && Date.now() - inflightAt < INFLIGHT_TTL_MS) {
    queued = true;
    return null;
  }
  const state = loadQuickFavTags();
  inflightSnapshot = JSON.stringify({ items: state.items, order: state.order });
  inflightAt = Date.now();
  return inflightSnapshot;
}

export function endQuickFavPush(): boolean {
  const hadQueued = queued;
  resetInflight();
  return hadQueued;
}

export function markQuickFavSynced(
  rev: number,
  items: Record<string, QuickFavItem>,
  order: { ids: string[]; at: string }
): void {
  const state = loadQuickFavTags();
  const serverItems = cleanItems(items);
  const serverOrder = normalizeOrder(order);
  const localSameAsInflight = snapshotEqual(state.items, state.order, inflightSnapshot);
  if (!inflightSnapshot || localSameAsInflight) {
    state.items = serverItems;
    state.order = serverOrder;
  }
  state.rev = normalizeRev(rev);
  state.synced = { items: serverItems, order: serverOrder };
  saveQuickFavTags(state);
}

export function adoptRemoteQuickFavTags(remote: QuickFavRemote, force = false): boolean {
  if (!force && hasPendingQuickFavChanges()) return false;
  const state = loadQuickFavTags();
  state.items = cleanItems(remote.items);
  state.order = normalizeOrder(remote.order);
  state.rev = normalizeRev(remote.rev);
  state.synced = { items: state.items, order: state.order };
  saveQuickFavTags(state);
  resetInflight();
  return true;
}

export function resolveQuickFavConflicts(picks: Record<string, boolean>, rev: number): void {
  const state = loadQuickFavTags();
  const now = new Date().toISOString();
  for (const [id, on] of Object.entries(picks)) {
    state.items[id] = { on: !!on, at: now };
  }
  state.rev = normalizeRev(rev);
  saveQuickFavTags(state);
}

function normalizeRev(raw: unknown): number {
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  }
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0) return 0;
  return raw;
}
