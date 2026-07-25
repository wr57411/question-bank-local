export interface AppUpdateInfo {
  version_code: number;
  version_name: string;
  download_url: string;
  changelog: string;
}

export const APP_VERSION_CODE = 2;
export const APP_VERSION_NAME = '1.1';

export async function checkForUpdate(serverUrl: string): Promise<AppUpdateInfo | null> {
  try {
    const response = await fetch(`${serverUrl}/api/app/version`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json() as AppUpdateInfo;
    if (data.version_code > APP_VERSION_CODE) return data;
    return null;
  } catch {
    return null;
  }
}
