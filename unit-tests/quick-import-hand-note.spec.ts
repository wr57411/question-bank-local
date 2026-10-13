import { describe, it, expect, beforeEach } from 'vitest';
import {
  confirmQuickImport,
  toggleQuickImportMode,
  isQuickMode,
  addQuickHandNote,
  removeQuickHandNote,
  readPendingHandNotes,
  resetQuickHandNotes,
  handNoteLabel,
} from '../src/ui/quick-import';

const w = window as any;

const BAR_HTML =
  '<div id="qi-hw-block">' +
    '<span id="qi-hw-count"></span>' +
    '<div id="qi-hw-list"></div>' +
  '</div>' +
  '<button id="qi-note-btn"></button>' +
  '<span id="qi-note-dot"></span>' +
  '<div id="qi-note-area">' +
    '<textarea id="qi-note-input"></textarea>' +
    '<span id="qi-note-count"></span>' +
  '</div>' +
  '<div id="toast"></div><div id="toast-msg"></div>' +
  '<div id="error-modal"></div>';

function flush(times = 5): Promise<void> {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (n++ >= times) resolve();
      else setTimeout(tick, 5);
    };
    setTimeout(tick, 5);
  });
}

async function setupPair(): Promise<void> {
  if (isQuickMode()) toggleQuickImportMode();
  toggleQuickImportMode();
  toggleQuickImportMode();
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  if (isQuickMode()) toggleQuickImportMode();
  resetQuickHandNotes();
  w.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      MediaGallery: {
        getMedias: async () => ({
          medias: [
            { identifier: 'content://a.jpg', data: 'AAAA' },
            { identifier: 'content://b.jpg', data: 'BBBB' },
          ],
        }),
        getFullImage: async () => ({ data: 'QQQQ', mimeType: 'image/png' }),
      },
    },
  };
  document.body.innerHTML = BAR_HTML;
  delete w.dbCreateQuestion;
  delete w.dbAddQuestionNote;
  delete w.loadQuestions;
  w.allTags = [];
});

describe('手写笔记待存列表行为', () => {
  it('加入 1 张后计数显示 1/5 且列表有 1 个图片', async () => {
    await addQuickHandNote('d0');
    expect(document.getElementById('qi-hw-count')!.textContent).toBe('1/5');
    expect(document.querySelectorAll('#qi-hw-list img')).toHaveLength(1);
  });

  it('连加超过上限只保留 5 张且第 6 次被拒绝', async () => {
    for (let i = 0; i < 6; i++) await addQuickHandNote('d' + i);
    expect(readPendingHandNotes()).toHaveLength(5);
    expect(document.querySelectorAll('#qi-hw-list img')).toHaveLength(5);
  });

  it('removeQuickHandNote 删除指定下标并保持其余顺序', async () => {
    for (const d of ['d0', 'd1', 'd2', 'd3', 'd4']) await addQuickHandNote(d);
    removeQuickHandNote(1);
    expect(readPendingHandNotes()).toEqual(['d0', 'd2', 'd3', 'd4']);
  });

  it('removeQuickHandNote 越界下标不改变内部状态', async () => {
    await addQuickHandNote('d0');
    await addQuickHandNote('d1');
    removeQuickHandNote(-1);
    removeQuickHandNote(99);
    expect(readPendingHandNotes()).toEqual(['d0', 'd1']);
  });

  it('resetQuickHandNotes 清空列表且计数回到 0/5', async () => {
    await addQuickHandNote('d0');
    await addQuickHandNote('d1');
    resetQuickHandNotes();
    expect(readPendingHandNotes()).toEqual([]);
    expect(document.getElementById('qi-hw-count')!.textContent).toBe('0/5');
    expect(document.querySelectorAll('#qi-hw-list img')).toHaveLength(0);
  });

  it('readPendingHandNotes 返回内部状态的副本', async () => {
    await addQuickHandNote('d0');
    const snap = readPendingHandNotes();
    snap.push('extra');
    snap[0] = 'mutated';
    expect(readPendingHandNotes()).toEqual(['d0']);
  });

  it('handNoteLabel 首张无序号其余带序号', () => {
    expect(handNoteLabel(0)).toBe('手写笔记');
    expect(handNoteLabel(1)).toBe('手写笔记 2');
    expect(handNoteLabel(2)).toBe('手写笔记 3');
  });

  it('有手写照片时圆点显示，重置且文字为空时隐藏', async () => {
    const dot = document.getElementById('qi-note-dot')!;
    await addQuickHandNote('d0');
    expect(dot.style.display).toBe('inline-block');
    resetQuickHandNotes();
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    expect(input.value).toBe('');
    expect(dot.style.display).toBe('none');
  });

  it('DOM 缺失时相关函数不抛异常', async () => {
    document.body.innerHTML = '';
    await addQuickHandNote('d0');
    removeQuickHandNote(0);
    resetQuickHandNotes();
    expect(readPendingHandNotes()).toEqual([]);
    expect(handNoteLabel(0)).toBe('手写笔记');
  });
});

describe('confirmQuickImport mounts hand-note photos as extra notes', () => {
  it('确认导入时把每张手写照片挂载为 手写笔记 / 手写笔记 2 并保留文字笔记 v1', async () => {
    const calls: any[][] = [];
    w.dbCreateQuestion = async () => ({ id: 'q-new', question_image_url: 'data:image/png;base64,QQQQ' });
    w.dbAddQuestionNote = async (...args: any[]) => { calls.push(args); };
    w.loadQuestions = async () => {};

    await setupPair();

    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = '我的文字笔记';

    await addQuickHandNote('hand-photo-1');
    await addQuickHandNote('hand-photo-2');

    await confirmQuickImport();

    const labels = calls.map((c) => c[2]);
    expect(labels).toEqual(['笔记 v1', '手写笔记', '手写笔记 2']);
    expect(calls[0][0]).toBe('q-new');
    expect(calls[0][1]).toBe('data:image/png;base64,QQQQ');
    expect(calls[0][3]).toBe('我的文字笔记');
    expect(calls[1][0]).toBe('q-new');
    expect(calls[1][1]).toBe('hand-photo-1');
    expect(calls[1][3]).toBe('');
    expect(calls[2][0]).toBe('q-new');
    expect(calls[2][1]).toBe('hand-photo-2');
    expect(calls[2][3]).toBe('');
  });

  it('dbCreateQuestion 失败时保留待存手写照片不丢失', async () => {
    const calls: any[][] = [];
    w.dbCreateQuestion = async () => { throw new Error('db down'); };
    w.dbAddQuestionNote = async (...args: any[]) => { calls.push(args); };
    w.loadQuestions = async () => {};

    await setupPair();

    await addQuickHandNote('hand-photo-1');
    await addQuickHandNote('hand-photo-2');
    expect(readPendingHandNotes()).toHaveLength(2);

    await confirmQuickImport();

    expect(calls).toHaveLength(0);
    expect(readPendingHandNotes()).toHaveLength(2);
  });
});
