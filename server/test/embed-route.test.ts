import { describe, expect, it } from 'vitest';
import { validateTexts } from '../src/routes/embed.js';

describe('validateTexts', () => {
  it('接受 1-8 个 ≤200 字符字符串', () => {
    expect(validateTexts(['斜面摩擦'])).toEqual([]);
    expect(validateTexts(Array(8).fill('x'))).toEqual([]);
  });
  it('拒绝空数组/超量/超长/非字符串', () => {
    expect(validateTexts([])).toHaveLength(1);
    expect(validateTexts(Array(9).fill('x'))).toHaveLength(1);
    expect(validateTexts(['x'.repeat(201)])).toHaveLength(1);
    expect(validateTexts([42 as unknown as string])).toHaveLength(1);
  });
});
