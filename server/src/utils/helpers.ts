export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeTimestamp(value: string | null | undefined, fallback?: string): string {
  if (!value) return fallback || nowIso();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T') + 'Z';
  }
  return value;
}

export function toMillis(value: string | null | undefined): number {
  const ms = Date.parse(normalizeTimestamp(value, '1970-01-01T00:00:00.000Z'));
  return Number.isFinite(ms) ? ms : 0;
}

export function isIncomingNewer(existingRecord: { updated_at?: string; deleted_at?: string; created_at?: string } | undefined, incomingTimestamp: string): boolean {
  if (!existingRecord) return true;
  return toMillis(incomingTimestamp) >= toMillis(existingRecord.updated_at || existingRecord.deleted_at || existingRecord.created_at);
}

export function normalizeAiMetadata(value: unknown): string {
  if (!value) return '{}';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function parseAiMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try { return JSON.parse(value as string); } catch { return {}; }
}

export function normalizeSimilarPair(questionId: string | undefined, similarQuestionId: string | undefined): [string, string] | null {
  if (!questionId || !similarQuestionId || questionId === similarQuestionId) return null;
  return [questionId, similarQuestionId].sort() as [string, string];
}
