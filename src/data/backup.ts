import {
  dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions,
  dbSimilarQuestionLinks, dbTopics, dbTopicQuestions, dbQuestionNotes,
  dbPendingPhotos, dbTeachingNodes, dbTeachingVersions, dbNodeQuestions,
  dbChangelog, generateId, nowIso
} from './stores';
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
];

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

export async function createFullSnapshot(): Promise<BackupManifest> {
  const snapshotId = generateId();
  const data: FullBackupData = {
    questions: [], tags: [], question_tags: [], papers: [], paper_questions: [],
    similar_question_links: [], topics: [], topic_questions: [], question_notes: [],
    pending_photos: [], teaching_nodes: [], teaching_versions: [], node_questions: [],
  };
  for (const store of ALL_STORES) {
    const arr = data[store.name as keyof FullBackupData] as unknown[];
    if (arr) await store.instance.iterate((v: unknown) => { arr.push(v); });
  }
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
    pending_photos: [], teaching_nodes: [], teaching_versions: [], node_questions: [],
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

export async function importBackupData(data: Record<string, unknown>): Promise<{ questions: number; tags: number }> {
  const isIncremental = data.format === 'incremental_v1' && !data.is_full;
  if (isIncremental) {
    const changes = (data.changes || []) as ChangeRecord[];
    const result = await applyIncrementalBackup(changes);
    return { questions: result.applied, tags: 0 };
  }
  const tags = (data.tags || []) as { id: string }[];
  const questions = (data.questions || []) as { id: string }[];
  const questionTags = (data.question_tags || []) as { question_id: string; tag_id: string }[];
  const papers = (data.papers || []) as { id: string }[];
  const paperQuestions = (data.paper_questions || []) as { paper_id: string; question_id: string }[];
  const similarLinks = (data.similar_question_links || []) as { question_id: string; similar_question_id: string }[];
  const topics = (data.topics || []) as { id: string }[];
  const topicQuestions = (data.topic_questions || []) as { topic_id: string; question_id: string }[];
  const questionNotes = (data.question_notes || []) as { id: string }[];
  const pendingPhotos = (data.pending_photos || []) as { id: string }[];
  const teachingNodes = (data.teaching_nodes || []) as { id: string }[];
  const teachingVersions = (data.teaching_versions || []) as { id: string }[];
  const nodeQuestions = (data.node_questions || []) as { id: string }[];

  await Promise.all([
    ...tags.map(t => dbTags.setItem(t.id, t)),
    ...questions.map(q => dbQuestions.setItem(q.id, q)),
    ...questionTags.map(qt => dbQuestionTags.setItem(`${qt.question_id}_${qt.tag_id}`, qt)),
    ...papers.map(p => dbPapers.setItem(p.id, p)),
    ...paperQuestions.map(pq => dbPaperQuestions.setItem(`${pq.paper_id}_${pq.question_id}`, pq)),
    ...topics.map(t => dbTopics.setItem(t.id, t)),
    ...topicQuestions.map(tq => dbTopicQuestions.setItem(`${tq.topic_id}_${tq.question_id}`, tq)),
    ...questionNotes.map(n => dbQuestionNotes.setItem(n.id, n)),
    ...pendingPhotos.map(p => dbPendingPhotos.setItem(p.id, p)),
    ...teachingNodes.map(n => dbTeachingNodes.setItem(n.id, n)),
    ...teachingVersions.map(v => dbTeachingVersions.setItem(v.id, v)),
    ...nodeQuestions.map(nq => dbNodeQuestions.setItem(nq.id, nq)),
  ]);
  if (similarLinks.length > 0) {
    for (const link of similarLinks) {
      const ids = [link.question_id, link.similar_question_id].sort();
      if (ids[0] && ids[1] && ids[0] !== ids[1]) {
        await dbSimilarQuestionLinks.setItem(`${ids[0]}_${ids[1]}`, { ...link, question_id: ids[0], similar_question_id: ids[1] });
      }
    }
  }
  if (data.pending_link_list) localStorage.setItem('pendingLinkList', JSON.stringify(data.pending_link_list));
  return { questions: questions.length, tags: tags.length };
}

export function shouldForceFullSnapshot(): boolean {
  const lastTime = localStorage.getItem('lastSnapshotTime');
  if (!lastTime) return true;
  const daysSince = (Date.now() - Date.parse(lastTime)) / (1000 * 60 * 60 * 24);
  return daysSince >= FULL_SNAPSHOT_INTERVAL_DAYS;
}

export async function smartBackup(): Promise<BackupManifest | (FullBackupData & { _meta: BackupManifest })> {
  if (shouldForceFullSnapshot()) {
    return await exportFullBackup();
  }
  const lastBackupTime = localStorage.getItem('lastBackupTime') || '1970-01-01T00:00:00Z';
  return await exportIncrementalBackup(lastBackupTime);
}
