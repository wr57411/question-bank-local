declare const localforage: typeof import('localforage');

import type { StoreManifest } from './types';

export const PROBE_TEXT = '计算三角形的面积';
export const MANIFEST_KEY = '__manifest__';

function store(storeName: string) {
  return localforage.createInstance({ name: 'questionBank', storeName });
}

export async function readManifest(storeName: string): Promise<StoreManifest | null> {
  return (await store(storeName).getItem(MANIFEST_KEY)) as StoreManifest | null;
}

export async function beginBuild(storeName: string): Promise<void> {
  await store(storeName).clear();
}

export async function commitBuild(storeName: string, m: StoreManifest): Promise<void> {
  await store(storeName).setItem(MANIFEST_KEY, m);
}
