import { describe, it, expect, beforeEach } from 'vitest';
import { getNextReviewInterval, calculateNextReviewDate, isReviewDue, formatReviewInfo } from '../../src/services/review';
import { tagSimilarity, findSimilarTags, levenshteinDistance } from '../../src/services/tag-similarity';
import { safeParseJSON } from '../../src/services/ai';

describe('review service', () => {
  it('getNextReviewInterval returns correct intervals', () => {
    expect(getNextReviewInterval(0)).toBe(2);
    expect(getNextReviewInterval(1)).toBe(4);
    expect(getNextReviewInterval(2)).toBe(7);
    expect(getNextReviewInterval(3)).toBe(15);
    expect(getNextReviewInterval(4)).toBe(30);
    expect(getNextReviewInterval(5)).toBe(30);
    expect(getNextReviewInterval(10)).toBe(30);
  });

  it('calculateNextReviewDate returns future date', () => {
    const result = calculateNextReviewDate(7);
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const resultDate = new Date(result);
    expect(resultDate.getTime()).toBeGreaterThan(Date.now());
    expect(Math.abs(resultDate.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it('isReviewDue returns false when review not enabled', () => {
    const q = { id: '1', review_enabled: false, next_review_at: '2020-01-01' } as never;
    expect(isReviewDue(q)).toBe(false);
  });

  it('isReviewDue returns true when past due', () => {
    const q = { id: '1', review_enabled: true, next_review_at: '2020-01-01T00:00:00Z' } as never;
    expect(isReviewDue(q)).toBe(true);
  });

  it('isReviewDue returns true when no next_review_at', () => {
    const q = { id: '1', review_enabled: true, next_review_at: undefined } as never;
    expect(isReviewDue(q)).toBe(true);
  });

  it('formatReviewInfo extracts count and nextDays', () => {
    const q = { id: '1', review_interval_index: 2, review_count: 3 } as never;
    const info = formatReviewInfo(q);
    expect(info.count).toBe(3);
    expect(info.nextDays).toBe(7);
  });
});

describe('tag-similarity service', () => {
  it('levenshteinDistance computes correctly', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('abc', 'ab')).toBe(1);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('tagSimilarity returns 1 for identical strings', () => {
    expect(tagSimilarity('力学', '力学')).toBe(1);
  });

  it('tagSimilarity returns 0.85 for substring match', () => {
    expect(tagSimilarity('牛顿力学', '力学')).toBe(0.85);
  });

  it('tagSimilarity returns value between 0 and 1 for partial match', () => {
    const score = tagSimilarity('力学', '热学');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('findSimilarTags returns sorted matches above threshold', () => {
    const candidates = ['力学', '热学', '光学', '电磁学', '牛顿力学'];
    const results = findSimilarTags('力学', candidates, 0.4);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('力学');
    expect(results[0].score).toBe(1);
  });

  it('findSimilarTags returns empty for empty input', () => {
    expect(findSimilarTags('', ['力学'])).toEqual([]);
  });
});

describe('safeParseJSON', () => {
  it('parses valid JSON array', () => {
    const result = safeParseJSON('[{"id":"k001","name":"test"}]');
    expect(result).toEqual([{ id: 'k001', name: 'test' }]);
  });

  it('parses JSON wrapped in markdown code fence', () => {
    const result = safeParseJSON('```json\n[{"id":"k001"}]\n```');
    expect(result).toEqual([{ id: 'k001' }]);
  });

  it('extracts JSON from surrounding text', () => {
    const result = safeParseJSON('Here is the result: [{"id":"k001"}] done');
    expect(result).toEqual([{ id: 'k001' }]);
  });

  it('returns null for invalid input', () => {
    expect(safeParseJSON(null)).toBeNull();
    expect(safeParseJSON('')).toBeNull();
    expect(safeParseJSON('no json here')).toBeNull();
  });

  it('parses JSON object', () => {
    const result = safeParseJSON('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });
});
