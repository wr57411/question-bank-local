import { describe, it, expect } from 'vitest'
import { ptToMM, mmToPt, clampStemPt, parseStemPt, derivePrintMetrics, deriveTopReserveMM, deriveHeaderReserveMM, loadStemMM, loadStemPt, DEFAULT_STEM_PT, DEFAULT_STEM_MM, DOUBLE_MIN_RATIO, STEM_PT_PRESETS } from '../src/data/pdf-print-size'
import { DEFAULT_PAGE_SETUP } from '../src/data/pdf-page-setup'

describe('pt 与 mm 换算', () => {
  it('12pt ≈ 4.234mm', () => expect(ptToMM(12)).toBeCloseTo(4.2336, 4))
  it('往返一致', () => expect(mmToPt(ptToMM(14))).toBeCloseTo(14, 6))
})

describe('挡位表', () => {
  it('默认档为五号 10.5pt（默认走双栏）', () => expect(DEFAULT_STEM_PT).toBe(10.5))
  it('DEFAULT_STEM_MM = ptToMM(10.5) ≈ 3.7044', () => expect(DEFAULT_STEM_MM).toBeCloseTo(3.7044, 4))
  it('DOUBLE_MIN_RATIO = 0.75（尺寸感知栏位阈值）', () => expect(DOUBLE_MIN_RATIO).toBe(0.75))
  it('挡位按 pt 升序且含 5 档', () => {
    expect(STEM_PT_PRESETS.map(p => p.pt)).toEqual([9, 10.5, 12, 14, 16])
  })
  it('越界钳到表内', () => {
    expect(clampStemPt(99)).toBe(16)
    expect(clampStemPt(1)).toBe(9)
    expect(parseStemPt('garbage')).toBe(10.5)
  })
})

describe('derivePrintMetrics 在 14pt 下（比例表校验点）', () => {
  const m = derivePrintMetrics(ptToMM(14))
  it('题干基准 = 输入 stemMM', () => expect(m.stemMM).toBeCloseTo(4.9392, 4))
  it('题号 0.97 倍、答案标签 0.79 倍', () => {
    expect(m.numLabelPt).toBeCloseTo(14 * 0.97, 4)
    expect(m.ansLabelPt).toBeCloseTo(14 * 0.79, 4)
  })
  it('标题 1.59 倍、页码 0.71 倍', () => {
    expect(m.titlePt).toBeCloseTo(14 * 1.59, 4)
    expect(m.pageNumPt).toBeCloseTo(14 * 0.71, 4)
  })
  it('副标题 0.97 倍、参考答案页眉 1.41 倍', () => {
    expect(m.subTitlePt).toBeCloseTo(14 * 0.97, 4)
    expect(m.answerHeaderPt).toBeCloseTo(14 * 1.41, 4)
  })
  it('cellPadMM 恒为 6，不随字号', () => {
    expect(derivePrintMetrics(ptToMM(9)).cellPadMM).toBe(6)
    expect(derivePrintMetrics(ptToMM(16)).cellPadMM).toBe(6)
  })
  it('labelH 随字号线性放大且大于字形高', () => {
    expect(m.numLabelH).toBeGreaterThan(ptToMM(m.numLabelPt))
    expect(m.numLabelH / ptToMM(m.numLabelPt)).toBeCloseTo(1.28, 2)
  })
  it('loadStemMM 空存储时回落默认档 10.5pt', () => expect(loadStemMM()).toBeCloseTo(ptToMM(10.5), 6))
})

describe('derivePrintMetrics 单调性', () => {
  it('stemMM 变大 → 所有字号与预留高单调不减', () => {
    const a = derivePrintMetrics(ptToMM(9))
    const b = derivePrintMetrics(ptToMM(16))
    for (const k of ['numLabelPt', 'ansLabelPt', 'titlePt', 'pageNumPt', 'numLabelH', 'ansLabelH', 'minSplitMM']) {
      expect(b[k]).toBeGreaterThan(a[k])
    }
  })
})

describe('deriveTopReserveMM（紧凑标题区）', () => {
  const metrics = derivePrintMetrics(ptToMM(10.5))
  it('默认 setup：12.76（锁定省 21mm 这个数）', () => {
    expect(deriveTopReserveMM(DEFAULT_PAGE_SETUP, metrics)).toBeCloseTo(12.76, 2)
  })
  it('showTitle=false 恒为 0', () => {
    expect(deriveTopReserveMM({ ...DEFAULT_PAGE_SETUP, showTitle: false }, metrics)).toBe(0)
  })
  it('仅标题（关副标题）：10+4.631+1.178−10 ≈ 5.81', () => {
    expect(deriveTopReserveMM({ ...DEFAULT_PAGE_SETUP, showCount: false }, metrics)).toBeCloseTo(5.81, 2)
  })
  it('marginTop=30 时标题块整体下移，reserve=32.76', () => {
    expect(deriveTopReserveMM({ ...DEFAULT_PAGE_SETUP, marginTopMM: 30 }, metrics)).toBeCloseTo(32.76, 2)
  })
  it('answerHeaderReserve：10+5.216−10=5.22', () => {
    expect(deriveHeaderReserveMM(DEFAULT_PAGE_SETUP, metrics)).toBeCloseTo(5.22, 2)
  })
})

describe('loadStemMM', () => {
  it('等于 ptToMM(loadStemPt())', () => {
    expect(loadStemMM()).toBeCloseTo(ptToMM(loadStemPt()), 6)
  })
})

describe('derivePrintMetrics 标签基线偏移', () => {
  it('标签基线偏移 = 0.8 × 标签字号mm', () => {
    const m = derivePrintMetrics(4)
    expect(m.numLabelBaselineMM).toBeCloseTo(4 * 0.97 * 0.8, 4)
    expect(m.ansLabelBaselineMM).toBeCloseTo(4 * 0.79 * 0.8, 4)
  })
})
