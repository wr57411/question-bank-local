declare const localforage: typeof import('localforage');

export const dbQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'questions' });
export const dbTags = localforage.createInstance({ name: 'questionBank', storeName: 'tags' });
export const dbQuestionTags = localforage.createInstance({ name: 'questionBank', storeName: 'question_tags' });
export const dbPapers = localforage.createInstance({ name: 'questionBank', storeName: 'papers' });
export const dbPaperQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'paper_questions' });
export const dbSimilarQuestionLinks = localforage.createInstance({ name: 'questionBank', storeName: 'similar_question_links' });
export const dbTopics = localforage.createInstance({ name: 'questionBank', storeName: 'topics' });
export const dbTopicQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'topic_questions' });
export const dbQuestionNotes = localforage.createInstance({ name: 'questionBank', storeName: 'question_notes' });
export const dbPendingPhotos = localforage.createInstance({ name: 'questionBank', storeName: 'pending_photos' });
export const dbTeachingNodes = localforage.createInstance({ name: 'questionBank', storeName: 'teaching_nodes' });
export const dbTeachingVersions = localforage.createInstance({ name: 'questionBank', storeName: 'teaching_versions' });
export const dbNodeQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'node_questions' });
export const dbChangelog = localforage.createInstance({ name: 'questionBank', storeName: 'changelog' });

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const hex = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toMillis(value: string | number | undefined | null): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const ms = Date.parse(value);
  return isNaN(ms) ? 0 : ms;
}
