import { dbAppSettings } from './stores';
import {
  dbGetAllTagCategories, computeDefaultVisibility, DEFAULT_VISIBILITY,
  type VisibilityConfig, type VisibilityKind,
} from './tag-categories';

// IndexedDB 仍是权威存储；此处加一层同步镜像 + 内存缓存：
//   1) 连续「读-改-写」（如可见性勾选）无需每次回读 IDB，避免互相竞态；
//   2) 用户改动同步写入 localStorage 镜像，即便紧随其后的 reload 中断了 IDB 事务也能恢复；
//   3) 远端应用配置 / 备份恢复会清空镜像，保证以 IDB 为准（见 clearAppSettingsCache 调用点）。
const _appSettingsCache = new Map<string, unknown>();
const MIRROR_PREFIX = 'appSettingMirror:';

export function clearAppSettingsCache(): void {
  _appSettingsCache.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MIRROR_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

export async function getAppSetting<T>(key: string): Promise<T | null> {
  if (_appSettingsCache.has(key)) return _appSettingsCache.get(key) as T;
  const v = await dbAppSettings.getItem(key);
  const idbVal = v === null || v === undefined ? null : (v as T);
  const raw = localStorage.getItem(MIRROR_PREFIX + key);
  if (raw !== null) {
    try {
      const mirror = JSON.parse(raw) as T;
      if (JSON.stringify(mirror) !== JSON.stringify(idbVal)) {
        void dbAppSettings.setItem(key, mirror); // 回写：IDB 落后于本机改动
        _appSettingsCache.set(key, mirror);
        return mirror;
      }
    } catch { /* ignore */ }
  }
  if (idbVal !== null) _appSettingsCache.set(key, idbVal);
  return idbVal;
}

export async function setAppSetting<T>(key: string, value: T): Promise<void> {
  _appSettingsCache.set(key, value);
  try { localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
  await dbAppSettings.setItem(key, value);
}

export const VISIBILITY_KEYS: Record<VisibilityKind, string> = {
  chapter: 'chapterVisibleCategories',
  topic: 'topicVisibleCategories',
};

export async function getVisibilityConfig(kind: VisibilityKind): Promise<VisibilityConfig> {
  const stored = await getAppSetting<VisibilityConfig>(VISIBILITY_KEYS[kind]);
  if (stored) return stored;
  const cats = await dbGetAllTagCategories();
  return computeDefaultVisibility(cats, kind);
}

export async function setVisibilityConfig(kind: VisibilityKind, config: VisibilityConfig): Promise<void> {
  await setAppSetting(VISIBILITY_KEYS[kind], config);
}

export { DEFAULT_VISIBILITY };
