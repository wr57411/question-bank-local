import { dbTeachingNodes, dbTeachingVersions, dbNodeQuestions, generateId, nowIso } from './stores';
import type { TeachingNode, TeachingVersion, NodeQuestion } from '../types';

export async function dbCreateTeachingNode(node: Partial<TeachingNode>): Promise<TeachingNode> {
  const now = nowIso();
  const record: TeachingNode = {
    id: node.id || generateId(),
    chapter: node.chapter || '',
    subject: node.subject || '物理',
    name: node.name || '',
    difficulty: node.difficulty || '基础',
    key_concept: node.key_concept || '',
    diagram: node.diagram || '',
    current_version_id: node.current_version_id || null,
    created_at: now,
    updated_at: now,
  };
  await dbTeachingNodes.setItem(record.id, record);
  return record;
}

export async function dbGetTeachingNode(id: string): Promise<TeachingNode | null> {
  return await dbTeachingNodes.getItem(id) as TeachingNode | null;
}

export async function dbGetTeachingNodesByStatus(status: string): Promise<TeachingNode[]> {
  const result: TeachingNode[] = [];
  await dbTeachingNodes.iterate((node: unknown) => {
    if (node && (node as TeachingNode).status === status) result.push(node as TeachingNode);
  });
  return result;
}

export async function dbGetTeachingNodesByChapter(chapter: string): Promise<TeachingNode[]> {
  const result: TeachingNode[] = [];
  await dbTeachingNodes.iterate((node: unknown) => {
    if (node && (node as TeachingNode).chapter === chapter) result.push(node as TeachingNode);
  });
  return result;
}

export async function dbGetAllTeachingNodes(): Promise<TeachingNode[]> {
  const result: TeachingNode[] = [];
  await dbTeachingNodes.iterate((node: unknown) => {
    if (node) result.push(node as TeachingNode);
  });
  result.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return result;
}

export async function dbUpdateTeachingNode(id: string, updates: Partial<TeachingNode>): Promise<TeachingNode | null> {
  const node = await dbTeachingNodes.getItem(id) as TeachingNode | null;
  if (!node) return null;
  const updated = { ...node, ...updates, updated_at: nowIso() };
  await dbTeachingNodes.setItem(id, updated);
  return updated;
}

export async function dbDeleteTeachingNode(id: string): Promise<void> {
  await dbTeachingNodes.removeItem(id);
  const verKeys: string[] = [];
  await dbTeachingVersions.iterate((v: unknown, key: string) => { if (v && (v as TeachingVersion).node_id === id) verKeys.push(key); });
  for (const key of verKeys) await dbTeachingVersions.removeItem(key);
  const nqKeys: string[] = [];
  await dbNodeQuestions.iterate((v: unknown, key: string) => { if (v && (v as NodeQuestion).node_id === id) nqKeys.push(key); });
  for (const key of nqKeys) await dbNodeQuestions.removeItem(key);
}

export async function dbCreateVersion(nodeId: string, versionData: Partial<TeachingVersion>): Promise<TeachingVersion> {
  const id = generateId();
  const existingVersions: TeachingVersion[] = [];
  await dbTeachingVersions.iterate((v: unknown) => {
    if (v && (v as TeachingVersion).node_id === nodeId) existingVersions.push(v as TeachingVersion);
  });
  const maxNum = existingVersions.reduce((max, v) => Math.max(max, v.version_number || 0), 0);
  const version: TeachingVersion = {
    id,
    node_id: nodeId,
    version_number: maxNum + 1,
    content: versionData.content || '',
    is_current: true,
    created_at: nowIso(),
  };
  for (const v of existingVersions) {
    if (v.is_current) await dbTeachingVersions.setItem(v.id, { ...v, is_current: false });
  }
  await dbTeachingVersions.setItem(id, version);
  await dbTeachingNodes.setItem(nodeId, { ...(await dbTeachingNodes.getItem(nodeId) as TeachingNode), current_version_id: id, updated_at: nowIso() });
  return version;
}

export async function dbGetVersionsByNode(nodeId: string): Promise<TeachingVersion[]> {
  const result: TeachingVersion[] = [];
  await dbTeachingVersions.iterate((v: unknown) => {
    if (v && (v as TeachingVersion).node_id === nodeId) result.push(v as TeachingVersion);
  });
  return result.sort((a, b) => b.version_number - a.version_number);
}

export async function dbGetVersion(versionId: string): Promise<TeachingVersion | null> {
  return await dbTeachingVersions.getItem(versionId) as TeachingVersion | null;
}

export async function dbUpdateVersion(versionId: string, updates: Partial<TeachingVersion>): Promise<void> {
  const version = await dbTeachingVersions.getItem(versionId) as TeachingVersion | null;
  if (!version) return;
  await dbTeachingVersions.setItem(versionId, { ...version, ...updates });
}

export async function dbDeleteVersion(versionId: string): Promise<void> {
  const version = await dbTeachingVersions.getItem(versionId) as TeachingVersion | null;
  if (!version) return;
  await dbTeachingVersions.removeItem(versionId);
  if (version.is_current) {
    const remaining = await dbGetVersionsByNode(version.node_id);
    if (remaining.length > 0) {
      await dbTeachingVersions.setItem(remaining[0].id, { ...remaining[0], is_current: true });
      await dbTeachingNodes.setItem(version.node_id, { ...(await dbTeachingNodes.getItem(version.node_id) as TeachingNode), current_version_id: remaining[0].id });
    }
  }
}

export async function dbSetCurrentVersion(nodeId: string, versionId: string): Promise<void> {
  const versions = await dbGetVersionsByNode(nodeId);
  for (const v of versions) {
    if (v.is_current && v.id !== versionId) await dbTeachingVersions.setItem(v.id, { ...v, is_current: false });
  }
  const target = await dbTeachingVersions.getItem(versionId) as TeachingVersion | null;
  if (target) await dbTeachingVersions.setItem(versionId, { ...target, is_current: true });
  await dbTeachingNodes.setItem(nodeId, { ...(await dbTeachingNodes.getItem(nodeId) as TeachingNode), current_version_id: versionId, updated_at: nowIso() });
}

export async function dbLinkQuestionToNode(nodeId: string, questionId: string, module?: string, order?: number): Promise<NodeQuestion> {
  const id = generateId();
  const record: NodeQuestion = { id, node_id: nodeId, question_id: questionId, module: module || '', order_num: order || 0, created_at: nowIso() };
  await dbNodeQuestions.setItem(id, record);
  return record;
}

export async function dbUnlinkQuestionFromNode(nodeId: string, questionId: string): Promise<void> {
  const keysToRemove: string[] = [];
  await dbNodeQuestions.iterate((v: unknown, key: string) => {
    const nq = v as NodeQuestion;
    if (nq.node_id === nodeId && nq.question_id === questionId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbNodeQuestions.removeItem(key);
}

export async function dbGetNodeQuestions(nodeId: string): Promise<NodeQuestion[]> {
  const result: NodeQuestion[] = [];
  await dbNodeQuestions.iterate((v: unknown) => {
    if (v && (v as NodeQuestion).node_id === nodeId) result.push(v as NodeQuestion);
  });
  return result.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
}

export async function dbGetQuestionNodes(questionId: string): Promise<NodeQuestion[]> {
  const result: NodeQuestion[] = [];
  await dbNodeQuestions.iterate((v: unknown) => {
    if (v && (v as NodeQuestion).question_id === questionId) result.push(v as NodeQuestion);
  });
  return result;
}

export async function dbGetAllNodeQuestions(): Promise<NodeQuestion[]> {
  const result: NodeQuestion[] = [];
  await dbNodeQuestions.iterate((v: unknown) => {
    if (v) result.push(v as NodeQuestion);
  });
  return result;
}
