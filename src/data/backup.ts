import {
  dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions,
  dbSimilarQuestionLinks, dbTopics, dbTopicQuestions, dbQuestionNotes,
  dbPendingPhotos, dbTeachingNodes, dbTeachingVersions, dbNodeQuestions,
  dbTagCategories, dbAppSettings, dbGroups, dbChangelog, generateId, nowIso
} from './stores';
import { clearAppSettingsCache } from './app-settings';
import type { BackupManifest, ChangeRecord, FullBackupData } from '../types';

const CHANGELOG_THRESHOLD = 500;
const FULL_SNAPSHOT_INTERVAL_DAYS = 7;

const ALL_STORES: { name: string; instance: typeof dbQuestions }[] = [
  { name: 'questions', instance: dbQuestions },
  { name: 'tags', instance: dbTags },
  { name: 'question_tags', instance: dbQuestionTags },
  { name: 'papers', instance: dbPapers },
  { name: 'paper_questions', instance: dbPaperQuestions },
  { name: 'similar_question_links', instance: dbSimilarQuestionLinks },
  { name: 'topics', instance: dbTopics },
  { name: 'topic_questions', instance: dbTopicQuestions },
  { name: 'question_notes', instance: dbQuestionNotes },
  { name: 'pending_photos', instance: dbPendingPhotos },
  { name: 'teaching_nodes', instance: dbTeachingNodes },
  { name: 'teaching_versions', instance: dbTeachingVersions },
  { name: 'node_questions', instance: dbNodeQuestions },
  { name: 'tag_categories', instance: dbTagCategories },
  { name: 'app_settings', instance: dbAppSettings },
  { name: 'groups', instance: dbGroups },
];

// ⚠️ 未启用：changelog 增量链路自 D8 起停用，保留仅为减少改动面。
// 停用原因（docs/plans/2026-09-12-d8-backup-fix.md）：
//   D8-a: 本函数是 dbChangelog 的唯一写入点，但全仓无调用者 → changelog 永远为空
//   D8-b: createFullSnapshot() 从不落盘基线数据，base_snapshot_id 指向不存在的快照
// 因此增量备份在"写入"与"恢复"两端都不成立。备份一律走 exportFullBackup() 全量。
export async function recordChange(store: string, key: string, action: 'put' | 'delete', value?: unknown): Promise<void> {
  const id = generateId();
  const record: ChangeRecord = { store, key, action, value, timestamp: nowIso() };
  await dbChangelog.setItem(id, record);
  const count = await getChangelogCount();
  if (count >= CHANGELOG_THRESHOLD) {
    await createFullSnapshot();
    await clearChangelog();
  }
}

export async function getChangelogCount(): Promise<number> {
  let count = 0;
  await dbChangelog.iterate(() => { count++; });
  return count;
}

export async function getChangelogSince(since: string): Promise<ChangeRecord[]> {
  const changes: ChangeRecord[] = [];
  const sinceMs = Date.parse(since);
  await dbChangelog.iterate((v: unknown) => {
    const record = v as ChangeRecord;
    if (record && Date.parse(record.timestamp) > sinceMs) changes.push(record);
  });
  return changes.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export async function clearChangelog(): Promise<void> {
  await dbChangelog.clear();
}

// 仅生成 manifest 与快照标记。不再遍历全量 store 去填一个从不返回、填完即丢的局部对象
// （FF-4：exportFullBackup 仍会自己遍历产出真正用于返回的数据）。
export async function createFullSnapshot(): Promise<BackupManifest> {
  const snapshotId = generateId();
  const manifest: BackupManifest = {
    format: 'incremental_v1',
    snapshot_id: snapshotId,
    base_snapshot_id: null,
    timestamp: nowIso(),
    is_full: true,
    changes: [],
  };
  localStorage.setItem('lastSnapshotId', snapshotId);
  localStorage.setItem('lastSnapshotTime', manifest.timestamp);
  return manifest;
}

// 单一来源的 store 统计：遍历同一份 ALL_STORES，返回每个 store 的条数 + 所有记录里最大的
// updated_at/deleted_at。供状态栏与自动备份指纹共用，避免各处各写一份 store 清单导致新增
// store 漏加、自动备份静默停摆（FF-5）。
export async function collectStoreStats(): Promise<{ counts: Record<string, number>; maxUpdatedAt: string }> {
  const counts: Record<string, number> = {};
  let maxTs = 0;
  try {
    for (const store of ALL_STORES) {
      let c = 0;
      await store.instance.iterate((v: unknown) => {
        c++;
        const rec = v as { updated_at?: unknown; deleted_at?: unknown };
        if (rec && typeof rec.updated_at === 'string') {
          const t = Date.parse(rec.updated_at);
          if (!isNaN(t) && t > maxTs) maxTs = t;
        }
        if (rec && typeof rec.deleted_at === 'string') {
          const t = Date.parse(rec.deleted_at);
          if (!isNaN(t) && t > maxTs) maxTs = t;
        }
      });
      counts[store.name] = c;
    }
  } catch (e) {
    console.warn('统计备份数据失败（collectStoreStats）:', e);
  }
  return { counts, maxUpdatedAt: maxTs ? new Date(maxTs).toISOString() : '' };
}

// ⚠️ 未启用：见上方 recordChange 的 D8 说明，增量备份路径当前无意义。
export async function exportIncrementalBackup(since: string): Promise<BackupManifest> {
  const changes = await getChangelogSince(since);
  const baseSnapshotId = localStorage.getItem('lastSnapshotId');
  return {
    format: 'incremental_v1',
    snapshot_id: generateId(),
    base_snapshot_id: baseSnapshotId,
    timestamp: nowIso(),
    is_full: false,
    changes,
  };
}

export async function exportFullBackup(): Promise<FullBackupData & { _meta: BackupManifest }> {
  const data: FullBackupData = {
    questions: [], tags: [], question_tags: [], papers: [], paper_questions: [],
    similar_question_links: [], topics: [], topic_questions: [], question_notes: [],
    pending_photos: [],     teaching_nodes: [], teaching_versions: [], node_questions: [],
    tag_categories: [], app_settings: [], groups: [],
  };
  for (const store of ALL_STORES) {
    const arr = data[store.name as keyof FullBackupData] as unknown[];
    if (arr) await store.instance.iterate((v: unknown) => { arr.push(v); });
  }
  data.pending_link_list = JSON.parse(localStorage.getItem('pendingLinkList') || '[]');
  const manifest = await createFullSnapshot();
  await clearChangelog();
  return { ...data, _meta: manifest };
}

export async function applyIncrementalBackup(changes: ChangeRecord[]): Promise<{ applied: number; errors: number }> {
  let applied = 0;
  let errors = 0;
  const storeMap = new Map(ALL_STORES.map(s => [s.name, s.instance]));
  for (const change of changes) {
    const store = storeMap.get(change.store);
    if (!store) { errors++; continue; }
    try {
      if (change.action === 'put' && change.value !== undefined) {
        await store.setItem(change.key, change.value);
      } else if (change.action === 'delete') {
        await store.removeItem(change.key);
      }
      applied++;
    } catch { errors++; }
  }
  return { applied, errors };
}

// 按 store 导入记录的唯一入口：分片恢复与全量 importBackupData 都走这里，避免两份键名逻辑漂移
// （今日 FF-1 能潜伏，正是因为同一能力存在两份实现）。store 名与 ALL_STORES 对齐，返回写入条数。
export async function importStoreRecords(store: string, records: unknown[]): Promise<number> {
  const entry = ALL_STORES.find((s) => s.name === store);
  if (!entry) {
    throw new Error(`备份包含未知 store「${store}」，请升级客户端后再恢复`);
  }
  if (!Array.isArray(records)) {
    throw new Error(`store「${store}」的数据不是数组，无法导入`);
  }
  const instance = entry.instance;
  switch (store) {
    case 'question_tags': {
      const recs = records as Array<{ question_id: string; tag_id: string }>;
      await Promise.all(recs.map((qt) => instance.setItem(`${qt.question_id}_${qt.tag_id}`, qt)));
      break;
    }
    case 'paper_questions': {
      const recs = records as Array<{ paper_id: string; question_id: string }>;
      await Promise.all(recs.map((pq) => instance.setItem(`${pq.paper_id}_${pq.question_id}`, pq)));
      break;
    }
    case 'topic_questions': {
      const recs = records as Array<{ topic_id: string; question_id: string }>;
      await Promise.all(recs.map((tq) => instance.setItem(`${tq.topic_id}_${tq.question_id}`, tq)));
      break;
    }
    case 'similar_question_links': {
      // 与 importBackupData 旧逻辑一致：按两端 id 排序去重，键为 ${a}_${b}
      const recs = records as Array<{ question_id: string; similar_question_id: string }>;
      for (const link of recs) {
        const ids = [link.question_id, link.similar_question_id].sort();
        if (ids[0] && ids[1] && ids[0] !== ids[1]) {
          await instance.setItem(`${ids[0]}_${ids[1]}`, { ...link, question_id: ids[0], similar_question_id: ids[1] });
        }
      }
      break;
    }
    default: {
      const recs = records as Array<{ id: string }>;
      await Promise.all(recs.map((r) => instance.setItem(r.id, r)));
      // 恢复 app_settings 后清空同步镜像，避免本机旧镜像覆盖刚恢复的值
      if (store === 'app_settings') clearAppSettingsCache();
    }
  }
  return records.length;
}

export async function importBackupData(data: Record<string, unknown>): Promise<{ questions: number; tags: number }> {
  const isIncremental = data.format === 'incremental_v1' && !data.is_full;
  if (isIncremental) {
    const changes = (data.changes || []) as ChangeRecord[];
    if (changes.length === 0) {
      throw new Error('该文件是空的增量备份（0 条变更），不含任何数据。请改用「📤 导出」产出的全量文件。');
    }
    const result = await applyIncrementalBackup(changes);
    return { questions: result.applied, tags: 0 };
  }
  if (!Array.isArray(data.questions) && !Array.isArray(data.tags)) {
    throw new Error('这不是数据备份文件（缺少 questions/tags），无法导入');
  }
  // 所有 store 走同一个 importStoreRecords 入口，键名规则只有一处定义
  for (const s of ALL_STORES) {
    const records = data[s.name];
    if (Array.isArray(records)) {
      await importStoreRecords(s.name, records);
    }
  }
  if (data.pending_link_list) localStorage.setItem('pendingLinkList', JSON.stringify(data.pending_link_list));
  return {
    questions: Array.isArray(data.questions) ? data.questions.length : 0,
    tags: Array.isArray(data.tags) ? data.tags.length : 0,
  };
}

export function shouldForceFullSnapshot(): boolean {
  const lastTime = localStorage.getItem('lastSnapshotTime');
  if (!lastTime) return true;
  const daysSince = (Date.now() - Date.parse(lastTime)) / (1000 * 60 * 60 * 24);
  return daysSince >= FULL_SNAPSHOT_INTERVAL_DAYS;
}

export async function smartBackup(): Promise<FullBackupData & { _meta: BackupManifest }> {
  return await exportFullBackup();
}
