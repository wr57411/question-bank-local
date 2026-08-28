import localforage from 'localforage';
import type { WikiMvpSession } from '../types';
import { generateId, nowIso } from './stores';

const dbWikiMvp = localforage.createInstance({ name: 'questionBank', storeName: 'wiki_mvp_sessions' });

export async function wikiMvpSaveSession(session: WikiMvpSession): Promise<WikiMvpSession> {
  const record: WikiMvpSession = {
    ...session,
    id: session.id || generateId(),
    created_at: session.created_at || nowIso(),
  };
  await dbWikiMvp.setItem(record.id, record);
  return record;
}

export async function wikiMvpListSessions(): Promise<WikiMvpSession[]> {
  const sessions: WikiMvpSession[] = [];
  await dbWikiMvp.iterate((v: unknown) => {
    if (v && typeof v === 'object') sessions.push(v as WikiMvpSession);
  });
  return sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function wikiMvpGetSession(id: string): Promise<WikiMvpSession | null> {
  const record = await dbWikiMvp.getItem<unknown>(id);
  if (!record || typeof record !== 'object') return null;
  return record as WikiMvpSession;
}

export async function wikiMvpDeleteSession(id: string): Promise<void> {
  await dbWikiMvp.removeItem(id);
}
