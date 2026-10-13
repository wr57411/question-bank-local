import { describe, it, expect, beforeEach } from 'vitest';
import {
  toggleQuickNote,
  onQuickNoteInput,
  readQuickNoteText,
  resetQuickNote,
  isQuickNoteExpanded,
} from '../src/ui/quick-import';

// 设计方案锚点：docs/plans/2026-08-30-quick-import-text-note.md
// 数据归属（已确认）：复用 question_notes 体系，文字写入 text_note，不新增题目字段
const BAR_HTML = `
<div id="quick-import-bar">
  <button id="qi-note-btn" type="button">📝 笔记<span id="qi-note-dot" style="display:none"></span></button>
  <button id="qi-confirm-btn" type="button">✅ 确认</button>
  <div id="qi-note-area">
    <span id="qi-note-count">0/500</span>
    <textarea id="qi-note-input" maxlength="500"></textarea>
  </div>
  <div id="qi-hint"></div>
</div>
`;

function mount(): void {
  document.body.innerHTML = BAR_HTML;
}

beforeEach(mount);

describe('toggleQuickNote（默认展开，点击切换收起/展开）', () => {
  it('默认展开，首次点击收起', () => {
    expect(isQuickNoteExpanded()).toBe(true);
    toggleQuickNote();
    expect(document.getElementById('qi-note-area')!.style.display).toBe('none');
    expect(isQuickNoteExpanded()).toBe(false);
  });

  it('再次点击重新展开并聚焦输入框', () => {
    toggleQuickNote();
    toggleQuickNote();
    expect(document.getElementById('qi-note-area')!.style.display).toBe('block');
    expect(isQuickNoteExpanded()).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('qi-note-input'));
  });

  it('DOM 缺失时不抛异常', () => {
    document.body.innerHTML = '';
    expect(() => toggleQuickNote()).not.toThrow();
    expect(() => onQuickNoteInput()).not.toThrow();
    expect(() => resetQuickNote()).not.toThrow();
  });
});

describe('onQuickNoteInput（设计 Task 2：字数与圆点标记）', () => {
  it('更新字数统计 N/500', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = '本题用换元法';
    onQuickNoteInput();
    expect(document.getElementById('qi-note-count')!.textContent).toBe('6/500');
  });

  it('有文字时按钮显示圆点，空白文字隐藏圆点', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    const dot = document.getElementById('qi-note-dot') as HTMLElement;
    input.value = '   ';
    onQuickNoteInput();
    expect(dot.style.display).toBe('none');
    input.value = '注意定义域';
    onQuickNoteInput();
    expect(dot.style.display).not.toBe('none');
  });

  it('输入超过 500 字被截断到 500', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = 'x'.repeat(600);
    onQuickNoteInput();
    expect((input as HTMLTextAreaElement).value).toHaveLength(500);
    expect(document.getElementById('qi-note-count')!.textContent).toBe('500/500');
  });
});

describe('readQuickNoteText（设计 Task 2：确认时读取）', () => {
  it('返回去首尾空白的笔记文本', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = '  本题用换元法简化，注意定义域  ';
    expect(readQuickNoteText()).toBe('本题用换元法简化，注意定义域');
  });

  it('空白或缺失时返回空串（空值不产生文本）', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = '    ';
    expect(readQuickNoteText()).toBe('');
    document.body.innerHTML = '';
    expect(readQuickNoteText()).toBe('');
  });
});

describe('resetQuickNote（默认展开语义：清空后保持展开）', () => {
  it('清空输入、隐藏圆点并保持展开', () => {
    const input = document.getElementById('qi-note-input') as HTMLTextAreaElement;
    input.value = '有内容';
    onQuickNoteInput();
    toggleQuickNote();
    resetQuickNote();
    expect(input.value).toBe('');
    expect(document.getElementById('qi-note-count')!.textContent).toBe('0/500');
    expect(document.getElementById('qi-note-dot')!.style.display).toBe('none');
    expect(isQuickNoteExpanded()).toBe(true);
  });
});
