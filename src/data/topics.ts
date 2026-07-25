import { dbTopics, dbTopicQuestions, generateId, nowIso } from './stores';
import type { Topic, TopicQuestion } from '../types';

export async function dbGetAllTopics(): Promise<Topic[]> {
  const topics: Topic[] = [];
  await dbTopics.iterate((v: unknown, key: string) => {
    const t = v as Record<string, unknown>;
    if (!t) return;
    const topic: Topic = {
      id: (t.id as string) || key,
      name: (t.name as string) || '',
      description: (t.description as string) || '',
      created_at: (t.created_at as string) || (t.createdAt as string) || '',
      updated_at: (t.updated_at as string) || (t.updatedAt as string) || '',
      deleted_at: (t.deleted_at as string) || (t.deletedAt as string) || null,
    };
    if (!topic.deleted_at) topics.push(topic);
  });
  for (const t of topics) {
    let count = 0;
    await dbTopicQuestions.iterate((tq: unknown) => { if ((tq as TopicQuestion).topic_id === t.id) count++; });
    t.question_count = count;
  }
  return topics.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function dbCreateTopic(name: string, description: string, questionIds: string[]): Promise<Topic> {
  const id = generateId();
  const now = nowIso();
  const topic: Topic = { id, name, description: description || '', created_at: now, updated_at: now, deleted_at: null };
  await dbTopics.setItem(id, topic);
  if (questionIds && questionIds.length > 0) {
    let n = 1;
    for (const qId of questionIds) {
      await dbTopicQuestions.setItem(`${id}_${qId}`, { topic_id: id, question_id: qId, order_num: n++, teacher_comment: '' });
    }
  }
  return topic;
}

export async function dbUpdateTopic(topicId: string, name: string, description: string): Promise<void> {
  const topic = await dbTopics.getItem(topicId) as Topic | null;
  if (!topic) return;
  await dbTopics.setItem(topicId, { ...topic, name, description: description || '', updated_at: nowIso() });
}

export async function dbDeleteTopic(topicId: string): Promise<void> {
  const topic = await dbTopics.getItem(topicId) as Topic | null;
  if (!topic) return;
  await dbTopics.setItem(topicId, { ...topic, deleted_at: nowIso(), updated_at: nowIso() });
}

export async function dbGetTopicQuestions(topicId: string): Promise<TopicQuestion[]> {
  const results: TopicQuestion[] = [];
  await dbTopicQuestions.iterate((tq: unknown) => {
    const record = tq as TopicQuestion;
    if (record.topic_id === topicId) results.push(record);
  });
  return results.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
}

export async function dbUpdateTopicQuestions(topicId: string, questionIds: string[]): Promise<void> {
  const keysToRemove: string[] = [];
  await dbTopicQuestions.iterate((tq: unknown, key: string) => {
    if ((tq as TopicQuestion).topic_id === topicId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbTopicQuestions.removeItem(key);
  let n = 1;
  for (const qId of questionIds) {
    await dbTopicQuestions.setItem(`${topicId}_${qId}`, { topic_id: topicId, question_id: qId, order_num: n++, teacher_comment: '' });
  }
}

export async function dbAddQuestionToTopic(topicId: string, questionId: string): Promise<void> {
  let maxOrder = 0;
  await dbTopicQuestions.iterate((tq: unknown) => {
    const record = tq as TopicQuestion;
    if (record.topic_id === topicId && (record.order_num || 0) > maxOrder) maxOrder = record.order_num || 0;
  });
  await dbTopicQuestions.setItem(`${topicId}_${questionId}`, { topic_id: topicId, question_id: questionId, order_num: maxOrder + 1, teacher_comment: '' });
}

export async function dbRemoveQuestionFromTopic(topicId: string, questionId: string): Promise<void> {
  await dbTopicQuestions.removeItem(`${topicId}_${questionId}`);
}

export async function dbUpdateTopicQuestionComment(topicId: string, questionId: string, comment: string): Promise<void> {
  const key = `${topicId}_${questionId}`;
  const record = await dbTopicQuestions.getItem(key) as TopicQuestion | null;
  if (!record) return;
  await dbTopicQuestions.setItem(key, { ...record, teacher_comment: comment });
}
