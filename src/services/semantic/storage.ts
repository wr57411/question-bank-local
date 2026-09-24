export const STORAGE_WARN_RATIO = 0.8;

export async function estimateStorage(): Promise<{ usage: number; quota: number; ratio: number }> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.storage?.estimate) return { usage: 0, quota: 0, ratio: 0 };
  const e = await nav.storage.estimate();
  const usage = e.usage ?? 0;
  const quota = e.quota ?? 0;
  return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
}

export async function ensurePersistent(): Promise<boolean> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.storage?.persist) return false;
  if (nav.storage.persisted && (await nav.storage.persisted())) return true;
  return nav.storage.persist();
}
