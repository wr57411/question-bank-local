export interface VersionCombo {
  id: string;
  name: string;
  displayName?: string;
  versionIds: string[];
  created_at: string;
  updated_at: string;
}

const COMBOS_KEY = 'versionCombos';
const ACTIVE_COMBO_KEY = 'activeVersionComboId';

export function loadVersionCombos(): VersionCombo[] {
  const raw = localStorage.getItem(COMBOS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((c: VersionCombo) => c && typeof c.id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveVersionCombos(combos: VersionCombo[]): void {
  localStorage.setItem(COMBOS_KEY, JSON.stringify(combos));
}

export function getComboById(id: string): VersionCombo | null {
  return loadVersionCombos().find((c) => c.id === id) || null;
}

export function getActiveComboId(): string {
  return localStorage.getItem(ACTIVE_COMBO_KEY) || '';
}

export function setActiveComboId(id: string): void {
  localStorage.setItem(ACTIVE_COMBO_KEY, id);
}

export function createVersionCombo(name: string, versionIds: string[]): VersionCombo {
  const now = new Date().toISOString();
  const combo: VersionCombo = {
    id: 'combo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || '新组合',
    versionIds: [...versionIds],
    created_at: now,
    updated_at: now,
  };
  saveVersionCombos([...loadVersionCombos(), combo]);
  return combo;
}

export function updateVersionCombo(
  id: string,
  patch: Partial<Pick<VersionCombo, 'name' | 'displayName' | 'versionIds'>>
): VersionCombo | null {
  const combos = loadVersionCombos();
  const idx = combos.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const current = combos[idx];
  const next: VersionCombo = { ...current, ...patch, updated_at: new Date().toISOString() };
  if (patch.name !== undefined) next.name = patch.name.trim() || current.name;
  if (patch.versionIds !== undefined) next.versionIds = [...patch.versionIds];
  combos[idx] = next;
  saveVersionCombos(combos);
  return next;
}

export function deleteVersionCombo(id: string): VersionCombo[] {
  const next = loadVersionCombos().filter((c) => c.id !== id);
  saveVersionCombos(next);
  if (getActiveComboId() === id) setActiveComboId(next[0]?.id ?? '');
  return next;
}

export function resolveActiveCombo(allVersionIds: () => string[]): VersionCombo {
  const activeId = getActiveComboId();
  const existing = activeId ? getComboById(activeId) : null;
  if (existing) return existing;
  const first = loadVersionCombos()[0];
  if (first) {
    setActiveComboId(first.id);
    return first;
  }
  const created = createVersionCombo('组合一', allVersionIds());
  setActiveComboId(created.id);
  return created;
}

export function comboVersionNames(
  combo: VersionCombo | null,
  nameById: (id: string) => string | null
): string[] {
  if (!combo) return [];
  return combo.versionIds.map(nameById).filter((n): n is string => !!n);
}

const SHORT_NAME_RULES: Array<[string, string]> = [
  ['高三', '高'],
  ['培优', '培'],
  ['同步', '同'],
  ['基础', '基'],
  ['中等', '中'],
  ['冲刺', '冲'],
];

export function versionShortName(name: string): string {
  const trimmed = (name || '').trim();
  for (const [keyword, short] of SHORT_NAME_RULES) {
    if (trimmed.includes(keyword)) return short;
  }
  return trimmed.charAt(0);
}

export function comboPreviewText(
  combo: VersionCombo | null,
  nameById: (id: string) => string | null
): string {
  if (!combo) return '';
  return comboVersionNames(combo, nameById).map(versionShortName).join('');
}

export function getComboDisplayText(combo: VersionCombo | null): string {
  if (!combo) return '';
  const custom = (combo.displayName || '').trim();
  return custom || (combo.name || '').trim();
}
