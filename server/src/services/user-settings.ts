export function mergeUserSettings(prev: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  return { ...prev, ...incoming };
}
