// 备份分片纯逻辑：把单份大 JSON 拆成若干 ≤2MB 的 JSON 数组分片，降低写/读两侧峰值内存（OOM 闪退根因）。
// 本模块不依赖任何平台能力或存储 IO，可在 jsdom 或纯 node 下直接单测。
// 分片以 UTF-8 字节数为上限，绝不切分单条记录，且严格保持记录顺序。

export const SHARD_MAX_BYTES = 2 * 1024 * 1024;

const encoder = new TextEncoder();

function byteLengthOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

function shardArrayBytes(recordBytes: number[], length: number): number {
  return recordBytes.reduce((s, b) => s + b, 0) + length + 1;
}

export function splitRecordsIntoShards(records: unknown[], maxBytes: number = SHARD_MAX_BYTES): unknown[][] {
  const shards: unknown[][] = [];
  if (records.length === 0) return shards;

  let current: unknown[] = [];
  let currentBytes: number[] = [];
  for (const rec of records) {
    const rb = byteLengthOf(rec);
    if (current.length > 0) {
      const projected = shardArrayBytes([...currentBytes, rb], current.length + 1);
      if (projected > maxBytes) {
        shards.push(current);
        current = [];
        currentBytes = [];
      }
    }
    current.push(rec);
    currentBytes.push(rb);
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

export function planShards(
  payload: Record<string, unknown>,
  maxBytes: number = SHARD_MAX_BYTES,
): { arrays: { store: string; shards: unknown[][] }[]; others: { key: string; value: unknown }[] } {
  const arrays: { store: string; shards: unknown[][] }[] = [];
  const others: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      arrays.push({ store: key, shards: splitRecordsIntoShards(value, maxBytes) });
    } else {
      others.push({ key, value });
    }
  }
  return { arrays, others };
}

export function shardFileName(store: string, index: number): string {
  return `${store}-${String(index).padStart(3, '0')}.json`;
}

export interface ShardManifest {
  format: 'sharded_v1';
  created_at: string;
  stores: { name: string; shards: number; count: number }[];
  others: string[];
}

export function buildShardManifest(
  arrays: { store: string; shards: unknown[][] }[],
  others: { key: string; value: unknown }[],
): ShardManifest {
  return {
    format: 'sharded_v1',
    created_at: new Date().toISOString(),
    stores: arrays.map((a) => ({
      name: a.store,
      shards: a.shards.length,
      count: a.shards.reduce((s, sh) => s + sh.length, 0),
    })),
    others: others.map((o) => o.key),
  };
}

export function verifyShardManifest(
  manifest: unknown,
  actual: { store: string; shardCount: number; recordCount: number }[],
): string[] {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest 缺失或非对象');
    return errors;
  }
  const m = manifest as Partial<ShardManifest>;
  if (m.format !== 'sharded_v1') errors.push('manifest.format 不是 sharded_v1');
  if (!Array.isArray(m.stores)) {
    errors.push('manifest.stores 非数组');
    return errors;
  }
  const actualMap = new Map(actual.map((a) => [a.store, a]));
  for (const s of m.stores) {
    const a = actualMap.get(s.name);
    if (!a) {
      errors.push(`缺少 store: ${s.name}`);
      continue;
    }
    if (a.shardCount !== s.shards) {
      errors.push(`store ${s.name} 片数不符：期望 ${s.shards}，实际 ${a.shardCount}`);
    }
    if (a.recordCount !== s.count) {
      errors.push(`store ${s.name} 记录数不符：期望 ${s.count}，实际 ${a.recordCount}`);
    }
  }
  return errors;
}

export function reassemblePayload(
  manifest: ShardManifest,
  readShard: (fileName: string) => unknown[],
  others: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const s of manifest.stores) {
    const arr: unknown[] = [];
    for (let i = 0; i < s.shards; i++) {
      const shard = readShard(shardFileName(s.name, i));
      if (!Array.isArray(shard)) {
        throw new Error(`分片不是数组：${shardFileName(s.name, i)}`);
      }
      for (const rec of shard) arr.push(rec);
    }
    payload[s.name] = arr;
  }
  for (const [k, v] of Object.entries(others)) payload[k] = v;
  return payload;
}
