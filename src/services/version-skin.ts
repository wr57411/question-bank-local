export interface VersionTheme {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  accent: string;
  accentLight: string;
  headerGradStart: string;
  headerGradEnd: string;
}

export interface AppVersion {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  theme: VersionTheme;
}

export const DEFAULT_VERSIONS: AppVersion[] = [
  { id: 'peiyou', name: '培优版', emoji: '🚀', tagline: '挑战难题，突破自我',
    theme: { primary: '#6366F1', primaryLight: '#EDE9FE', primaryDark: '#4338CA', accent: '#F59E0B', accentLight: '#FEF3C7', headerGradStart: '#6366F1', headerGradEnd: '#4F46E5' } },
  { id: 'gaosan', name: '高三总复习版', emoji: '📖', tagline: '系统复习，冲刺高考',
    theme: { primary: '#1E40AF', primaryLight: '#DBEAFE', primaryDark: '#1E3A8A', accent: '#DC2626', accentLight: '#FEE2E2', headerGradStart: '#1E40AF', headerGradEnd: '#2563EB' } },
  { id: 'tongblian', name: '同步练版', emoji: '📝', tagline: '紧跟进度，同步提升',
    theme: { primary: '#059669', primaryLight: '#D1FAE5', primaryDark: '#047857', accent: '#D97706', accentLight: '#FEF3C7', headerGradStart: '#059669', headerGradEnd: '#10B981' } },
];

export const DEFAULT_VERSION_ID = 'peiyou';

export function loadAppVersions(): AppVersion[] {
  const saved = localStorage.getItem('appVersions');
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  return DEFAULT_VERSIONS.map(v => ({ ...v }));
}

export function saveAppVersions(versions: AppVersion[]): void {
  localStorage.setItem('appVersions', JSON.stringify(versions));
}

export function getAppVersions(): AppVersion[] {
  return loadAppVersions();
}

export function getAppVersionById(id: string): AppVersion | null {
  return getAppVersions().find(v => v.id === id) || null;
}

export function getCurrentVersionId(): string {
  return localStorage.getItem('appVersion') || DEFAULT_VERSION_ID;
}

export function getCurrentVersion(): AppVersion | null {
  const id = getCurrentVersionId();
  return getAppVersionById(id) || getAppVersionById(DEFAULT_VERSION_ID);
}

export function applyVersionTheme(versionId: string): void {
  const version = getAppVersionById(versionId);
  if (!version) return;

  const t = version.theme;
  const root = document.documentElement;

  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--primary-light', t.primaryLight);
  root.style.setProperty('--primary-dark', t.primaryDark);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-light', t.accentLight);

  const header = document.getElementById('app-header');
  if (header) {
    header.style.background = `linear-gradient(135deg,${t.headerGradStart} 0%,${t.headerGradEnd} 100%)`;
  }

  const title = document.getElementById('header-title');
  if (title) {
    title.textContent = '';
    title.appendChild(document.createTextNode(version.emoji + ' ' + version.name + ' '));
    const editSpan = document.createElement('span');
    editSpan.textContent = '✏️';
    editSpan.style.cssText = 'font-size:12px;cursor:pointer;opacity:.5';
    editSpan.title = '改名';
    editSpan.onclick = () => { const w = window as unknown as Record<string, unknown>; if (typeof w.renameCurrentVersion === 'function') (w.renameCurrentVersion as () => void)(); };
    title.appendChild(editSpan);
  }
}
