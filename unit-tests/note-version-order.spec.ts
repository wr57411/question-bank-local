import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sortNoteVersions, loadNoteVersionsForDetail, deleteCurrentNoteVersion } from '../src/ui/note-version';

const DETAIL_HTML = `
<div id="modal-note-version-bar" style="display:none">
  <select id="modal-note-version-select"></select>
  <button type="button" id="modal-note-version-delete">🗑 删除</button>
</div>
<div id="modal-question-image"></div>
<textarea id="modal-question-text-note"></textarea>
`;

describe('loadNoteVersionsForDetail 展示层接线（数据层顺序不利时也必须把题图排在首位）', () => {
  const ts = '2026-09-14T10:00:00.000Z';

  beforeEach(() => {
    document.body.innerHTML = DETAIL_HTML;
    const w = window as never as Record<string, unknown>;
    w._detailLoadToken = 0;
    w.currentQuestionId = 'q1';
    w.allQuestions = [];
    w.dbGetLastViewedNote = () => null;
    w.dbSetLastViewedNote = () => {};
  });

  it('同毫秒 + 数据层把「手写笔记」排在前时，下拉仍以「笔记 v1」为首且默认选中它', async () => {
    const w = window as never as Record<string, unknown>;
    const hand = note('aaa-hand', '手写笔记', ts);
    const v1 = note('zzz-v1', '笔记 v1', ts);
    w.dbGetQuestionNotes = async () => [hand, v1];

    await loadNoteVersionsForDetail('q1');

    const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toEqual(['笔记 v1', '手写笔记']);
    expect(select.value).toBe('zzz-v1');
    expect((document.getElementById('modal-question-image') as HTMLElement).innerHTML).toContain(
      'data:image/png;base64,zzz-v1'
    );
  });
});

const note = (id: string, label: string, created_at: string) => ({
  id,
  question_id: 'q1',
  note_image_url: 'data:image/png;base64,' + id,
  label,
  text_note: '',
  created_at,
  updated_at: created_at,
  deleted_at: null,
});

describe('sortNoteVersions（毫秒级 created_at 撞车时的确定性排序）', () => {
  it('created_at 各不相同时保持创建先后顺序', () => {
    const rows = [
      note('c', '笔记 v3', '2026-09-14T10:00:00.002Z'),
      note('a', '笔记 v1', '2026-09-14T10:00:00.000Z'),
      note('b', '笔记 v2', '2026-09-14T10:00:00.001Z'),
    ];
    expect(sortNoteVersions(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('created_at 相同（同毫秒写入）时「笔记 v1」恒排最前', () => {
    const ts = '2026-09-14T10:00:00.000Z';
    const rows = [note('hw', '手写笔记', ts), note('v1', '笔记 v1', ts)];
    expect(sortNoteVersions(rows).map((r) => r.label)).toEqual(['笔记 v1', '手写笔记']);
  });

  it('同毫秒的多张手写笔记按序号升序', () => {
    const ts = '2026-09-14T10:00:00.000Z';
    const rows = [
      note('h2', '手写笔记 2', ts),
      note('h1', '手写笔记', ts),
      note('v1', '笔记 v1', ts),
      note('h3', '手写笔记 3', ts),
    ];
    expect(sortNoteVersions(rows).map((r) => r.label)).toEqual([
      '笔记 v1',
      '手写笔记',
      '手写笔记 2',
      '手写笔记 3',
    ]);
  });

  it('同毫秒且无序号线索时按 id 兜底，多次调用结果一致', () => {
    const ts = '2026-09-14T10:00:00.000Z';
    const rows = [note('zzz', '考前复习', ts), note('aaa', '期末冲刺', ts)];
    const first = sortNoteVersions(rows).map((r) => r.id);
    const second = sortNoteVersions([...rows].reverse()).map((r) => r.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['aaa', 'zzz']);
  });

  it('不修改传入的数组', () => {
    const ts = '2026-09-14T10:00:00.000Z';
    const rows = [note('hw', '手写笔记', ts), note('v1', '笔记 v1', ts)];
    const before = rows.map((r) => r.id);
    sortNoteVersions(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('空数组与缺失字段不抛异常', () => {
    expect(sortNoteVersions([])).toEqual([]);
    expect(() => sortNoteVersions([{} as never, note('a', '笔记 v1', '')])).not.toThrow();
  });
});

describe('deleteCurrentNoteVersion（墓碑删除当前图片版本，不可恢复、跨设备）', () => {
  beforeEach(() => {
    document.body.innerHTML = DETAIL_HTML;
    const w = window as never as Record<string, unknown>;
    w._detailLoadToken = 0;
    w.currentQuestionId = 'q1';
    w.allQuestions = [];
    w.dbGetLastViewedNote = () => null;
    w.dbSetLastViewedNote = vi.fn();
    w.dbDeleteQuestionNote = vi.fn(async () => {});
    w.dbGetQuestionNotes = async () => [];
    w.dbAddQuestionNote = async () => note('new-v1', '笔记 v1', '2026-09-14T10:00:00.000Z');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('选中「笔记 v1」点删除 → 以该 note id 调用 dbDeleteQuestionNote，并清空 lastViewed', async () => {
    const w = window as never as Record<string, unknown>;
    w.dbGetQuestionNotes = async () => [note('zzz-v1', '笔记 v1', '2026-09-14T10:00:00.000Z')];
    await loadNoteVersionsForDetail('q1');
    const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
    expect(select.value).toBe('zzz-v1');

    await deleteCurrentNoteVersion();

    expect(w.dbDeleteQuestionNote).toHaveBeenCalledWith('zzz-v1');
    expect(w.dbSetLastViewedNote).toHaveBeenCalledWith('q1', '');
  });

  it('confirm 返回 false → 不调用 dbDeleteQuestionNote', async () => {
    const w = window as never as Record<string, unknown>;
    w.dbGetQuestionNotes = async () => [note('zzz-v1', '笔记 v1', '2026-09-14T10:00:00.000Z')];
    await loadNoteVersionsForDetail('q1');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await deleteCurrentNoteVersion();

    expect(w.dbDeleteQuestionNote).not.toHaveBeenCalled();
  });

  it('删除后重载 → 下拉不再含被删版本，默认选中剩余第一项', async () => {
    const w = window as never as Record<string, unknown>;
    const v1 = note('aaa-v1', '笔记 v1', '2026-09-14T10:00:00.000Z');
    const v2 = note('bbb-v2', '手写笔记', '2026-09-14T10:00:00.000Z');
    w.dbGetQuestionNotes = async () => [v1, v2];
    await loadNoteVersionsForDetail('q1');
    const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
    expect(select.value).toBe('aaa-v1');

    w.dbGetQuestionNotes = async () => [v2];

    await deleteCurrentNoteVersion();

    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).not.toContain('笔记 v1');
    expect(select.value).toBe('bbb-v2');
  });

  it('select 无选中值时不调用删除且不抛异常', async () => {
    const w = window as never as Record<string, unknown>;
    document.body.innerHTML = DETAIL_HTML;
    await expect(deleteCurrentNoteVersion()).resolves.not.toThrow();
    expect(w.dbDeleteQuestionNote).not.toHaveBeenCalled();
  });

  it('select 元素缺失时不抛异常', async () => {
    const w = window as never as Record<string, unknown>;
    document.body.innerHTML = `
<div id="modal-note-version-bar" style="display:none"></div>
<div id="modal-question-image"></div>
<textarea id="modal-question-text-note"></textarea>`;
    await expect(deleteCurrentNoteVersion()).resolves.not.toThrow();
    expect(w.dbDeleteQuestionNote).not.toHaveBeenCalled();
  });
});
