import { dbQuestionNotes, generateId, nowIso } from './stores';
import type { QuestionNote } from '../types';

export async function dbGetQuestionNotes(questionId: string): Promise<QuestionNote[]> {
  const result: QuestionNote[] = [];
  await dbQuestionNotes.iterate((v: unknown) => {
    const note = v as QuestionNote;
    if (note && note.question_id === questionId && !note.deleted_at) result.push(note);
  });
  return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function dbAddQuestionNote(questionId: string, imageUrl: string | null, label: string, textNote: string): Promise<QuestionNote> {
  const id = generateId();
  const now = nowIso();
  const note: QuestionNote = { id, question_id: questionId, image_url: imageUrl, label: label || '', text_note: textNote || '', created_at: now, updated_at: now, deleted_at: null };
  await dbQuestionNotes.setItem(id, note);
  return note;
}

export async function dbUpdateQuestionNote(noteId: string, updates: Partial<QuestionNote>): Promise<void> {
  const note = await dbQuestionNotes.getItem(noteId) as QuestionNote | null;
  if (!note) return;
  await dbQuestionNotes.setItem(noteId, { ...note, ...updates, updated_at: nowIso() });
}

export async function dbDeleteQuestionNote(noteId: string): Promise<void> {
  const note = await dbQuestionNotes.getItem(noteId) as QuestionNote | null;
  if (!note) return;
  await dbQuestionNotes.setItem(noteId, { ...note, deleted_at: nowIso() });
}
