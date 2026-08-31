import { describe, it, expect } from 'vitest';
import { computeAnchoredPosition } from '../src/ui/modal-anchor';

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
