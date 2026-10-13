import { vi } from 'vitest';

const stores = new Map();

function makeStore(storeName) {
  if (!stores.has(storeName)) stores.set(storeName, new Map());
  const m = stores.get(storeName);
  return {
    async setItem(k, v) { m.set(k, v); },
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async removeItem(k) { m.delete(k); },
    async clear() { m.clear(); },
    async length() { return m.size; },
    async iterate(cb) { for (const [k, v] of [...m.entries()]) cb(v, k); },
  };
}

export function installFakeLocalforage() {
  stores.clear();
  vi.stubGlobal('localforage', { createInstance: ({ storeName }) => makeStore(storeName) });
  return stores;
}
