import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_PAGE_SETUP, clampPageSetup, loadPageSetup, savePageSetup, MARGIN_MIN_MM, MARGIN_MAX_MM } from '../src/data/pdf-page-setup'

describe('clampPageSetup', () => {
  it('null/undefined 返回全默认', () => {
    expect(clampPageSetup(null)).toEqual(DEFAULT_PAGE_SETUP)
    expect(clampPageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP)
  })
  it('边距 clamp 到 [0,30]', () => {
    expect(clampPageSetup({ marginTopMM: -5 }).marginTopMM).toBe(0)
    expect(clampPageSetup({ marginTopMM: 99 }).marginTopMM).toBe(30)
    expect(clampPageSetup({ marginBottomMM: 12.5 }).marginBottomMM).toBe(12.5)
    expect(clampPageSetup({ marginSideMM: 0 }).marginSideMM).toBe(0)
  })
  it('非有限边距回落默认 10', () => {
    expect(clampPageSetup({ marginTopMM: NaN }).marginTopMM).toBe(10)
    expect(clampPageSetup({ marginTopMM: 'abc' }).marginTopMM).toBe(10)
    expect(clampPageSetup({}).marginSideMM).toBe(10)
  })
  it('字符串数字被 Number 转换后接受', () => {
    expect(clampPageSetup({ marginTopMM: '8' }).marginTopMM).toBe(8)
  })
  it('布尔归一：缺失回落 true，任意值 Boolean 化', () => {
    expect(clampPageSetup({}).showTitle).toBe(true)
    expect(clampPageSetup({ showCount: 0 }).showCount).toBe(false)
    expect(clampPageSetup({ showTitle: 'yes' }).showTitle).toBe(true)
  })
  it('部分字段缺失时其余回落默认', () => {
    const r = clampPageSetup({ marginTopMM: 8 })
    expect(r).toEqual({ marginTopMM: 8, marginBottomMM: 10, marginSideMM: 10, showTitle: true, showCount: true })
  })
})

  it('每个边距字段的无效值回落各自的默认（不串用 marginTop 的）', () => {
    expect(clampPageSetup({ marginBottomMM: NaN }).marginBottomMM).toBe(DEFAULT_PAGE_SETUP.marginBottomMM)
    expect(clampPageSetup({ marginSideMM: NaN }).marginSideMM).toBe(DEFAULT_PAGE_SETUP.marginSideMM)
    expect(clampPageSetup({ marginTopMM: NaN }).marginTopMM).toBe(DEFAULT_PAGE_SETUP.marginTopMM)
  })

  it('save 后 localStorage 原始串是 clamp 后的 JSON', () => {
    savePageSetup({ ...DEFAULT_PAGE_SETUP, marginTopMM: 99 })
    expect(JSON.parse(localStorage.getItem('pdfPageSetup')).marginTopMM).toBe(30)
  })

  it('save→load→save 幂等', () => {
    const x = { marginTopMM: 8, marginBottomMM: 29, marginSideMM: 0, showTitle: false, showCount: false }
    savePageSetup(x)
    const once = loadPageSetup()
    savePageSetup(once)
    expect(loadPageSetup()).toEqual(once)
  })

describe('load/save 往返', () => {
  beforeEach(() => localStorage.clear())
  it('空存储返回全默认', () => {
    expect(loadPageSetup()).toEqual(DEFAULT_PAGE_SETUP)
  })
  it('save 后 load 往返一致', () => {
    const s = { marginTopMM: 8, marginBottomMM: 12, marginSideMM: 9, showTitle: false, showCount: true }
    savePageSetup(s)
    expect(loadPageSetup()).toEqual(s)
  })
  it('save 自动 clamp 越界值', () => {
    savePageSetup({ ...DEFAULT_PAGE_SETUP, marginBottomMM: 99 })
    expect(loadPageSetup().marginBottomMM).toBe(30)
  })
  it('存储里的坏 JSON 容错回默认', () => {
    localStorage.setItem('pdfPageSetup', '{not json')
    expect(loadPageSetup()).toEqual(DEFAULT_PAGE_SETUP)
  })
  it('存储里是数组/数字等非对象时也容错', () => {
    localStorage.setItem('pdfPageSetup', '42')
    expect(loadPageSetup()).toEqual(DEFAULT_PAGE_SETUP)
  })
})
