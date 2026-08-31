import { describe, it, expect, beforeEach } from 'vitest';
import { computeAnchoredPosition, getQuickImportAnchorRect, applyModalPosition, bindModalToAnchor, isQuickImportBarVisible } from '../src/ui/modal-anchor';
import { openModal, closeModal } from '../src/ui/common';

function setBar(height: number, visible: boolean) {
  document.body.innerHTML = `
    <div id="quick-import-bar" style="display:${visible ? 'block' : 'none'};position:fixed;top:0;left:0;right:0;height:${height}px"></div>
    <div id="test-modal" class="modal"><div class="modal-content" style="height:400px"></div></div>
  `;
  const bar = document.getElementById('quick-import-bar') as HTMLElement;
  bar.getBoundingClientRect = () => ({ top: 0, bottom: visible ? height : 0, left: 0, right: 375, width: 375, height: visible ? height : 0, x: 0, y: 0, toJSON() { return {}; } } as DOMRect);
}

describe('computeAnchoredPosition - 纯计算', () => {
  it('锚点可见且下方空间充足：置于锚点正下方，top = anchorBottom + margin', () => {
    const r = computeAnchoredPosition({ anchorBottom: 312, anchorTop: 0, viewportHeight: 844, contentHeight: 400, margin: 12 });
    expect(r.placement).toBe('below');
    expect(r.top).toBe(324); // 312+12
    expect(r.maxHeight).toBe(844 - 324 - 12); // 视口 - top - bottom margin
  });

  it('锚点隐藏（anchorBottom=0）：回落到居中可用区域（top = margin，maxHeight 受限）', () => {
    const r = computeAnchoredPosition({ anchorBottom: 0, anchorTop: 0, viewportHeight: 844, contentHeight: 400, margin: 12 });
    expect(r.top).toBe(12);
    expect(r.maxHeight).toBe(844 - 24);
  });

  it('下方空间不足但上方空间更小：仍在下方但限高并启用内部滚动（constrained-below）', () => {
    // 视口 600，锚点底 312，内容高 500，下方仅 276 可用
    const r = computeAnchoredPosition({ anchorBottom: 312, anchorTop: 0, viewportHeight: 600, contentHeight: 500, margin: 12 });
    expect(r.placement).toBe('constrained-below');
    expect(r.maxHeight).toBe(600 - 324 - 12);
    expect(r.top).toBe(324);
  });

  it('锚点靠近视口底部（通用翻转）：上方空间更大时翻转到锚点上方', () => {
    const r = computeAnchoredPosition({ anchorBottom: 700, anchorTop: 600, viewportHeight: 800, contentHeight: 400, margin: 12 });
    expect(r.placement).toBe('above');
    // top = anchorTop - contentHeight - margin（若放得下），否则限高
    expect(r.top).toBeLessThan(600);
  });

  it('safe-area 参与计算：safeTop/safeBottom 抵扣可用高度', () => {
    const r = computeAnchoredPosition({ anchorBottom: 312, anchorTop: 0, viewportHeight: 844, contentHeight: 400, margin: 12, safeTop: 44, safeBottom: 34 });
    expect(r.maxHeight).toBe(844 - 324 - 12 - 34);
  });

  it('内容高度为 0 时不抛异常，返回下方可用空间', () => {
    const r = computeAnchoredPosition({ anchorBottom: 196, anchorTop: 0, viewportHeight: 844, contentHeight: 0, margin: 12 });
    expect(r.top).toBe(208);
    expect(r.maxHeight).toBeGreaterThan(0);
  });
});

describe('getQuickImportAnchorRect', () => {
  beforeEach(() => { setBar(312, true); });
  it('bar 可见时返回 bottom = 高度', () => {
    const r = getQuickImportAnchorRect();
    expect(r?.bottom).toBe(312);
  });
  it('bar 隐藏时返回 null', () => {
    setBar(312, false);
    const r = getQuickImportAnchorRect();
    expect(r).toBe(null);
  });
  it('bar 高度 196（笔记收起）时返回 196', () => {
    setBar(196, true);
    const r = getQuickImportAnchorRect();
    expect(r?.bottom).toBe(196);
  });
});

describe('applyModalPosition', () => {
  beforeEach(() => {
    setBar(312, true);
    Object.defineProperty(window, 'innerHeight', { value: 844, writable: true });
  });
  it('bar 可见时 modal 的 top 与 maxHeight 被设置为锚点下方', () => {
    const modal = document.getElementById('test-modal') as HTMLElement;
    const content = modal.querySelector('.modal-content') as HTMLElement;
    content.getBoundingClientRect = () => ({ height: 400, top: 0, bottom: 400 } as any);
    applyModalPosition(modal, content, getQuickImportAnchorRect());
    expect(modal.style.top).toBe('312px');
    expect(content.style.maxHeight).toContain('px');
    expect(content.style.overflowY).toBe('auto');
  });
  it('bar 隐藏时回落到默认（top 清空或为 0，居中）', () => {
    setBar(312, false);
    const modal = document.getElementById('test-modal') as HTMLElement;
    const content = modal.querySelector('.modal-content') as HTMLElement;
    applyModalPosition(modal, content, getQuickImportAnchorRect());
    expect(modal.style.top).toBe('');
  });
  it('保持 z-index 与动画类不被改动', () => {
    const modal = document.getElementById('test-modal') as HTMLElement;
    modal.style.zIndex = '1000';
    modal.classList.add('active');
    const content = modal.querySelector('.modal-content') as HTMLElement;
    applyModalPosition(modal, content, getQuickImportAnchorRect());
    expect(modal.style.zIndex).toBe('1000');
    expect(modal.classList.contains('active')).toBe(true);
  });
});

describe('isQuickImportBarVisible', () => {
  beforeEach(() => { setBar(312, true); });
  it('bar 可见时返回 true', () => {
    expect(isQuickImportBarVisible()).toBe(true);
  });
  it('visibility:hidden 时返回 false', () => {
    const bar = document.getElementById('quick-import-bar') as HTMLElement;
    bar.style.visibility = 'hidden';
    expect(isQuickImportBarVisible()).toBe(false);
  });
});

describe('bindModalToAnchor - 同步', () => {
  it('resize 时重新计算位置', async () => {
    setBar(312, true);
    Object.defineProperty(window, 'innerHeight', { value: 844, writable: true });
    const h = bindModalToAnchor('test-modal');
    const modal = document.getElementById('test-modal') as HTMLElement;
    modal.classList.add('active');
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 50));
    expect(modal.style.top).toBe('312px');
    h.destroy();
  });
});

describe('common.openModal 锚点集成', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="quick-import-bar" style="display:block;position:fixed;top:0;height:312px"></div>
      <div id="test-modal" class="modal"><div class="modal-content" style="height:300px"></div></div>
    `;
    const bar = document.getElementById('quick-import-bar') as HTMLElement;
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 312, left: 0, right: 375, width: 375, height: 312 } as any);
    Object.defineProperty(window, 'innerHeight', { value: 844, writable: true });
  });
  it('openModal 后 modal.top 被设为 anchorBottom', () => {
    openModal('test-modal');
    const modal = document.getElementById('test-modal') as HTMLElement;
    expect(modal.classList.contains('active')).toBe(true);
    expect(modal.style.top).toBe('312px');
  });
  it('closeModal 后 top 被清空（回落）', () => {
    openModal('test-modal');
    closeModal('test-modal');
    const modal = document.getElementById('test-modal') as HTMLElement;
    expect(modal.classList.contains('active')).toBe(false);
    expect(modal.style.top).toBe('');
  });
});
