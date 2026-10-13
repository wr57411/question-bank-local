import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 假 Image：设置 src 后立即 onerror，让真实 compressImage 走 reject 分支
class BrokenImage {
  set src(_: string) { setTimeout(() => this.onerror?.(new Event('error')), 0); }
  onerror: any = null; onload: any = null;
  addEventListener() {} removeEventListener() {}
}

const NOTE_VERSION_HTML = `
<div id="add-note-version-modal"><div class="modal-content"></div></div>
<input id="note-version-label" />
<input id="note-version-text" />
<img id="note-version-preview" />
<div id="note-version-preview-wrap"></div>
<div id="modal-note-version-bar">
  <select id="modal-note-version-select"></select>
</div>
<div id="modal-question-image"></div>
<textarea id="modal-question-text-note"></textarea>
`;

const FORM_HTML = `
<form id="question-form">
  <input type="text" id="form-text-note" />
  <input type="text" id="form-comment" />
  <div id="extra-note-versions"></div>
  <div id="questions-list"></div>
  <span id="question-count"></span>
  <button type="submit">添加题目</button>
</form>
`;

describe('compressNoteImage（1600/0.85，失败回退原图）', () => {
  beforeEach(() => { vi.stubGlobal('Image', BrokenImage as any); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('压缩失败时回退原图（绝不丢图）', async () => {
    const { compressNoteImage } = await import('../src/services/image');
    const src = 'data:image/jpeg;base64,ORIGINAL';
    await expect(compressNoteImage(src)).resolves.toBe(src);
  });

  it('空值原样放行（null/undefined 不进压缩流程）', async () => {
    const { compressNoteImage } = await import('../src/services/image');
    await expect(compressNoteImage(null as any)).resolves.toBeNull();
    await expect(compressNoteImage(undefined as any)).resolves.toBeUndefined();
  });
});

describe('接线：详情页「+ 添加版本」落库走 compressNoteImage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../src/services/image', () => ({
      compressNoteImage: async (img: string) => (img ? 'COMPRESSED::' + img : img),
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('confirmAddNoteVersion 落库传压缩值 COMPRESSED::RAW', async () => {
    document.body.innerHTML = NOTE_VERSION_HTML;
    const w = window as any;
    w.currentQuestionId = 'q1';
    w._detailLoadToken = 0;
    w.allQuestions = [];
    w.dbGetLastViewedNote = () => null;
    w.dbSetLastViewedNote = () => {};
    w.dbGetQuestionNotes = async () => [];
    w.dbAddQuestionNote = vi.fn(async () => ({ id: 'note-new' }));
    w.showStatus = () => {};
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Camera: { getPhoto: async () => ({ dataUrl: 'RAW' }) } },
    };

    const { confirmAddNoteVersion, takePhotoForNoteVersion } = await import('../src/ui/note-version');
    await takePhotoForNoteVersion();
    await new Promise((r) => setTimeout(r, 0)); // 等 .then 把 addNoteVersionImage 置为 RAW

    await confirmAddNoteVersion();

    expect(w.dbAddQuestionNote).toHaveBeenCalled();
    const img = w.dbAddQuestionNote.mock.calls[0][1];
    expect(img).toBe('COMPRESSED::RAW');
  });
});

describe('接线：表单「额外版本」落库走 compressNoteImage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../src/services/image', () => ({
      compressNoteImage: async (img: string) => (img ? 'COMPRESSED::' + img : img),
    }));
    // question-core 经 ../data → backup.ts 引用全部 store 实例；
    // 不能只部分 mock stores（缺 dbTags 等会让 backup 顶层炸），改为 stub 全局 localforage。
    // 语义对齐其他单测（如 question-tag-sync.spec.ts）的内存 fake。
    vi.stubGlobal('localforage', {
      createInstance: () => ({
        setItem: async () => {},
        getItem: async () => null,
        iterate: async (_cb: any) => {},
        removeItem: async () => {},
        key: async () => null,
        keys: async () => [],
        length: async () => 0,
        dropInstance: async () => {},
        config: {},
      }),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('extraNoteVersions 中带 image 的版本落库传压缩值 COMPRESSED::EXTRA', async () => {
    document.body.innerHTML = FORM_HTML;
    const w = window as any;
    w.croppedImages = { question: 'Q', answer: null, blank: null };
    w.formSelectedTagIds = [];
    w.getSelectedVersions = () => [];
    w.extraNoteVersions = [{ idx: 0, image: 'EXTRA' }];
    w.dbCreateQuestion = async () => ({ id: 'newq' });
    w.dbAddQuestionNote = vi.fn(async () => ({}));
    w.dbGetAllQuestions = async () => [];
    w.removeImage = () => {};
    w.renderFormSelectedTags = () => {};
    w.resetVersionCheckboxes = () => {};
    w.clearFormGeneratedTags = () => {};
    w.showStatus = () => {};
    w.activeFilterTags = [];
    w.selectedQuestions = new Set();
    w.questionBasket = new Set();
    w.getCurrentVersionId = () => null;
    w.allTags = [];

    const { initQuestionForm } = await import('../src/ui/question-core');
    initQuestionForm();
    const form = document.getElementById('question-form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));

    const calls = w.dbAddQuestionNote.mock.calls;
    const extraCall = calls.find((c: any[]) => c[1] === 'COMPRESSED::EXTRA');
    expect(extraCall).toBeTruthy();
    expect(extraCall[0]).toBe('newq');
    expect(extraCall[2]).toBe('笔记 v2');
  });
});
