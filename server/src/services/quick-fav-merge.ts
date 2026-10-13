export interface QuickFavItem { on: boolean; at: string }
export interface QuickFavSnapshot {
  items: Record<string, QuickFavItem>;
  order: { ids: string[]; at: string };
  rev: number;
}
export interface QuickFavConflict { id: string; local: QuickFavItem; remote: QuickFavItem }

function atMs(at: string | undefined): number {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function newerItem(a: QuickFavItem, b: QuickFavItem): QuickFavItem {
  return atMs(a.at) >= atMs(b.at) ? a : b;
}

function mergeOrder(
  local: QuickFavSnapshot,
  remote: QuickFavSnapshot | undefined,
  mergedItems: Record<string, QuickFavItem>
): { ids: string[]; at: string } {
  let skeleton = local;
  if (remote && atMs(remote.order?.at) > atMs(local.order?.at)) {
    skeleton = remote;
  }
  const skeletonIds = (skeleton.order?.ids || []).filter(
    (id) => mergedItems[id] && mergedItems[id].on === true
  );
  const missing = Object.keys(mergedItems)
    .filter((id) => mergedItems[id].on === true && !skeletonIds.includes(id))
    .sort((a, b) => atMs(mergedItems[a].at) - atMs(mergedItems[b].at));
  return { ids: [...skeletonIds, ...missing], at: skeleton.order?.at || '' };
}

export function mergeQuickFavTags(
  local: QuickFavSnapshot,
  remote: QuickFavSnapshot | undefined
): { merged: { items: Record<string, QuickFavItem>; order: { ids: string[]; at: string } }; conflicts: QuickFavConflict[] } {
  const conflicts: QuickFavConflict[] = [];
  const items: Record<string, QuickFavItem> = {};

  const localItems = local.items || {};
  const remoteItems = remote ? remote.items || {} : {};
  const allKeys = new Set([...Object.keys(localItems), ...Object.keys(remoteItems)]);

  const localRev = Number(local.rev) || 0;
  const remoteRev = remote ? Number(remote.rev) || 0 : 0;

  for (const id of allKeys) {
    const l = localItems[id];
    const r = remoteItems[id];
    if (l && !r) {
      items[id] = l;
    } else if (!l && r) {
      items[id] = r;
    } else if (l && r) {
      if (l.on === r.on) {
        items[id] = newerItem(l, r);
      } else if (localRev < remoteRev) {
        conflicts.push({ id, local: l, remote: r });
        items[id] = l;
      } else {
        items[id] = newerItem(l, r);
      }
    }
  }

  const order = mergeOrder(local, remote, items);
  return { merged: { items, order }, conflicts };
}
