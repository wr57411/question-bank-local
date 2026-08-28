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
} from '../src/services/version-combo';

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
