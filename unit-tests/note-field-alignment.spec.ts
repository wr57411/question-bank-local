import { describe, it, expect, vi } from 'vitest';

const stores = new Map<string, Map<string, any>>();
function bucket(name: string) {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name)!;
}
vi.stubGlobal('localforage', {
  createInstance: ({ storeName }: any) => {
    const s = bucket(storeName);
    return {
      getItem: async (k: string) => s.get(k) ?? null,
      setItem: async (k: string, v: any) => { s.set(k, v); return v; },
      iterate: async (cb: any) => { for (const [k, v] of s) await cb(v, k); },
      removeItem: async (k: string) => { s.delete(k); },
      clear: async () => { s.clear(); },
    };
  },
});
const noteStore = bucket('question_notes');
const { dbAddQuestionNote } = await import('../src/data/notes');

describe('TS 写端的笔记图片字段必须与线上（旧 db.js）一致', () => {
  it('写入 note_image_url，不写 image_url', async () => {
    const note = await dbAddQuestionNote('q1', 'data:image/jpeg;base64,AAA', '笔记 v1', '');
    expect(note.note_image_url).toBe('data:image/jpeg;base64,AAA');
    expect((note as any).image_url).toBeUndefined();
    expect(Object.keys(noteStore.get(note.id))).toContain('note_image_url');
  });

  it('imageUrl 为 null 时字段为 null（不落成 undefined）', async () => {
    const note = await dbAddQuestionNote('q2', null, '空图', '');
    expect(note.note_image_url).toBeNull();
  });

  it('落库键集合与线上实现一致', async () => {
    const note = await dbAddQuestionNote('q3', 'data:image/jpeg;base64,BBB', 'x', '');
    expect(Object.keys(noteStore.get(note.id)).sort()).toEqual(
      ['created_at', 'deleted_at', 'id', 'label', 'note_image_url', 'question_id', 'text_note', 'updated_at'].sort()
    );
  });
});
