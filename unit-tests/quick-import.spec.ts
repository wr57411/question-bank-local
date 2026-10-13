import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadVersionCombos,
  saveVersionCombos,
  createVersionCombo,
  updateVersionCombo,
  deleteVersionCombo,
  getComboById,
  getActiveComboId,
  setActiveComboId,
  resolveActiveCombo,
  comboVersionNames,
  versionShortName,
  comboPreviewText,
  getComboDisplayText,
} from '../src/services/version-combo';
import {
  pickQuestionAnswerPair, countFreshMedias,
  loadImportedIds, markImportedIds, clearImportedIds,
  buildQuickCreateArgs, loadQuickLayoutType, saveQuickLayoutType,
  toggleLayoutType, layoutLabel, layoutFullLabel,
} from '../src/services/quick-import';

beforeEach(() => localStorage.clear());

describe('version-combo', () => {
  it('creates a combo with unique id and persists', () => {
    const c = createVersionCombo('组合一', ['peiyou', 'gaosan']);
    expect(c.name).toBe('组合一');
    expect(c.versionIds).toEqual(['peiyou', 'gaosan']);
    expect(loadVersionCombos()).toHaveLength(1);
  });

  it('renames and replaces version ids', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    updateVersionCombo(c.id, { name: '高三专用', versionIds: ['gaosan', 'tongblian'] });
    expect(loadVersionCombos()[0].name).toBe('高三专用');
    expect(loadVersionCombos()[0].versionIds).toEqual(['gaosan', 'tongblian']);
  });

  it('deletes combo and clears active pointer when deleted', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    setActiveComboId(c.id);
    deleteVersionCombo(c.id);
    expect(loadVersionCombos()).toHaveLength(0);
    expect(getComboById(c.id)).toBeNull();
  });

  it('resolveActiveCombo falls back to creating 组合一 with all versions', () => {
    const combo = resolveActiveCombo(() => ['peiyou', 'gaosan', 'tongblian']);
    expect(combo.name).toBe('组合一');
    expect(combo.versionIds).toEqual(['peiyou', 'gaosan', 'tongblian']);
    expect(getActiveComboId()).toBe(combo.id);
  });

  it('resolveActiveCombo reuses existing active combo', () => {
    const c = createVersionCombo('自定义', ['gaosan']);
    setActiveComboId(c.id);
    expect(resolveActiveCombo(() => ['peiyou']).id).toBe(c.id);
  });

  it('comboVersionNames maps ids to names and drops unknown ids', () => {
    const c = createVersionCombo('组合一', ['peiyou', 'ghost']);
    expect(comboVersionNames(c, (id) => ({ peiyou: '培优版' }[id] ?? null))).toEqual(['培优版']);
  });

  it('saveVersionCombos overwrites the stored list', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    saveVersionCombos([{ ...c, name: '覆盖后' }]);
    expect(loadVersionCombos()).toHaveLength(1);
    expect(loadVersionCombos()[0].name).toBe('覆盖后');
  });
});

const M = (id: string) => ({ identifier: id });

describe('quick-import pairing', () => {
  it('picks newest as answer and second newest as question', () => {
    const pair = pickQuestionAnswerPair([M('a'), M('b'), M('c')], new Set());
    expect(pair!.answer.identifier).toBe('a');
    expect(pair!.question.identifier).toBe('b');
  });

  it('skips already imported medias', () => {
    const pair = pickQuestionAnswerPair([M('a'), M('b'), M('c'), M('d')], new Set(['a', 'b']));
    expect(pair!.answer.identifier).toBe('c');
    expect(pair!.question.identifier).toBe('d');
  });

  it('returns null when fewer than two fresh medias', () => {
    expect(pickQuestionAnswerPair([M('a')], new Set())).toBeNull();
    expect(pickQuestionAnswerPair([], new Set())).toBeNull();
    expect(pickQuestionAnswerPair([M('a'), M('b')], new Set(['a', 'b']))).toBeNull();
  });

  it('countFreshMedias counts medias not yet imported', () => {
    expect(countFreshMedias([M('a'), M('b')], new Set(['a']))).toBe(1);
  });
});

describe('quick-import imported fingerprint', () => {
  beforeEach(() => localStorage.clear());

  it('dedupes and keeps newest first', () => {
    markImportedIds(['a', 'b']);
    markImportedIds(['b', 'c']);
    expect(loadImportedIds()).toEqual(['c', 'b', 'a']);
  });

  it('caps stored ids at 200', () => {
    const many = Array.from({ length: 260 }, (_, i) => 'id' + i);
    markImportedIds(many);
    const stored = loadImportedIds();
    expect(stored).toHaveLength(200);
    expect(stored[0]).toBe('id259');
  });

  it('clearImportedIds empties the list', () => {
    markImportedIds(['a']);
    clearImportedIds();
    expect(loadImportedIds()).toEqual([]);
  });

  it('stores newest last-in-array first', () => {
    markImportedIds(['old', 'new']);
    expect(loadImportedIds()).toEqual(['new', 'old']);
  });

  it('evicts oldest when over the cap', () => {
    markImportedIds(Array.from({ length: 200 }, (_, i) => 'id' + i));
    expect(loadImportedIds()[0]).toBe('id199');
    markImportedIds(['fresh']);
    const stored = loadImportedIds();
    expect(stored[0]).toBe('fresh');
    expect(stored).toHaveLength(200);
    expect(stored).not.toContain('id0');
  });
});

describe('buildQuickCreateArgs', () => {
  it('passes layout type through and always nulls book info', () => {
    const args = buildQuickCreateArgs('data:q', 'data:a', ['t1'], ['peiyou'], 1);
    expect(args).toEqual({
      questionImageUrl: 'data:q', answerImageUrl: 'data:a', tagIds: ['t1'],
      layoutType: 1, blankImageUrl: null, versions: ['peiyou'], bookInfo: null,
    });
  });

  it('keeps layout 0 when caller asks for single column only', () => {
    expect(buildQuickCreateArgs('q', null, [], [], 0).layoutType).toBe(0);
  });

  it('copies arrays so callers cannot mutate stored state', () => {
    const tags = ['t1']; const vers = ['peiyou'];
    const args = buildQuickCreateArgs('q', null, tags, vers, 1);
    tags.push('t2'); vers.push('gaosan');
    expect(args.tagIds).toEqual(['t1']);
    expect(args.versions).toEqual(['peiyou']);
  });
});

describe('quick-import layout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 1 (single+double column ok)', () => {
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('round-trips 0 and 1', () => {
    saveQuickLayoutType(0);
    expect(loadQuickLayoutType()).toBe(0);
    saveQuickLayoutType(1);
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('treats any invalid stored value as 1', () => {
    localStorage.setItem('quickImportLayoutType', 'garbage');
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('toggleLayoutType flips between 0 and 1', () => {
    expect(toggleLayoutType(1)).toBe(0);
    expect(toggleLayoutType(0)).toBe(1);
  });

  it('layoutLabel renders a single compact character', () => {
    expect(layoutLabel(1)).toBe('双');
    expect(layoutLabel(0)).toBe('单');
  });

  it('layoutFullLabel renders the readable text for toasts', () => {
    expect(layoutFullLabel(1)).toBe('单双栏均可');
    expect(layoutFullLabel(0)).toBe('仅适合单栏');
  });
});

describe('version combo preview text', () => {
  it('maps known version names to single characters', () => {
    expect(versionShortName('高三总复习版')).toBe('高');
    expect(versionShortName('培优版')).toBe('培');
    expect(versionShortName('同步练版')).toBe('同');
    expect(versionShortName('基础版')).toBe('基');
    expect(versionShortName('中等难度版')).toBe('中');
  });

  it('falls back to the first character for unknown names', () => {
    expect(versionShortName('竞赛版')).toBe('竞');
    expect(versionShortName('')).toBe('');
  });

  it('joins short names of every version in the combo', () => {
    const combo = createVersionCombo('组合一', ['gaosan', 'peiyou', 'tongblian']);
    const nameById = (id: string) =>
      ({ gaosan: '高三总复习版', peiyou: '培优版', tongblian: '同步练版' }[id] ?? null);
    expect(comboPreviewText(combo, nameById)).toBe('高培同');
  });

  it('returns empty string when combo is null', () => {
    expect(comboPreviewText(null, () => 'x')).toBe('');
  });

  it('skips version ids that no longer exist', () => {
    const combo = createVersionCombo('组合一', ['gaosan', 'ghost']);
    const nameById = (id: string) => (id === 'gaosan' ? '高三总复习版' : null);
    expect(comboPreviewText(combo, nameById)).toBe('高');
  });
});

describe('version combo display name', () => {
  it('uses custom displayName when provided', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    updateVersionCombo(c.id, { displayName: '高三专用' });
    expect(getComboDisplayText(getComboById(c.id))).toBe('高三专用');
  });

  it('falls back to combo name when displayName is empty', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    expect(getComboDisplayText(getComboById(c.id))).toBe('组合一');
  });

  it('treats whitespace-only displayName as empty', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    updateVersionCombo(c.id, { displayName: '   ' });
    expect(getComboDisplayText(getComboById(c.id))).toBe('组合一');
  });

  it('returns empty string for null combo', () => {
    expect(getComboDisplayText(null)).toBe('');
  });
});
