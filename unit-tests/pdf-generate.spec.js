import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_PAGE_SETUP } from '../src/data/pdf-page-setup'

class FakeDoc {
  constructor() {
    this.calls = []
    this.pages = 1
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
  }
  addImage(src, fmt, x, y, w, h) { this.calls.push(['addImage', String(src), x, y, w, h]) }
  addPage() { this.pages++; this.calls.push(['addPage']) }
  save(name) { this.calls.push(['save', name]) }
  output(kind) { return kind === 'blob' ? new Blob() : 'data:application/pdf;base64,FAKE' }
  text(t, x, y, o) { this.calls.push(['text', t, x, y]) }
  setFontSize(s) { this.calls.push(['setFontSize', s]) } setTextColor() {} setFont() {}
  setDrawColor() {} setLineWidth() {} setLineDash() {}
  line(x1, y1, x2, y2) { this.calls.push(['line', x1, y1, x2, y2]) }
  addFileToVFS() {} addFont() {}
}

const q = (id, withAns = true) => ({
  id,
  question_image_url: 'data:image/jpeg;base64,Q' + id,
  answer_image_url: withAns ? 'data:image/jpeg;base64,A' + id : null,
})

describe('generatePDF', () => {
  let generatePDF, _internals, lastDoc
  beforeEach(async () => {
    vi.resetModules()
    lastDoc = undefined
    window.jspdf = { jsPDF: class extends FakeDoc { constructor() { super(); lastDoc = this } } }
    window.Capacitor = undefined
    const mod = await import('../src/data/pdf')
    generatePDF = mod.generatePDF
    _internals = mod._internals
    _internals.estimateTH = async () => 20
    _internals.cropImage = async (src, rect) => src + '#crop' + rect.sy + '-' + rect.sh
    _internals.loadImageDims = async (src) => String(src).includes('LONG') ? { w: 900, h: 4000 } : { w: 1000, h: 400 }
    _internals.loadCnFontBase64 = async () => 'FAKE_FONT_B64'
  })

  it('noSave 返回 doc 且 merged 走引擎：2 题带答案画 4 张图', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'merged', title: '试卷A', noSave: true })
    expect(doc).toBeInstanceOf(FakeDoc)
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBeGreaterThanOrEqual(4)
    const srcs = imgs.map(c => c[1]).join('|')
    expect(srcs).toContain('base64,Q1')
    expect(srcs).toContain('base64,A1')
    expect(srcs).toContain('base64,Q2')
    expect(srcs).toContain('base64,A2')
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('第 1 题')
    expect(texts.join('|')).toContain('答案:')
    expect(texts.join('|')).toContain('试卷A')
  })

  it('引擎路径长图触发切割并调用 cropImage', async () => {
    const doc = await generatePDF([q('LONG')], { mode: 'single', noSave: true })
    const crops = doc.calls.filter(c => c[0] === 'addImage' && c[1].includes('#crop'))
    expect(crops.length).toBeGreaterThan(0)
    expect(doc.pages).toBeGreaterThan(1)
  })

  it('Web 端保存走 doc.save(fileName)', async () => {
    await generatePDF([q('1')], { mode: 'single', title: '导出X' })
    expect(lastDoc.calls.some(c => c[0] === 'save' && c[1] === '导出X.pdf')).toBe(true)
  })

  it('separate 模式：题目页后跟参考答案页', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'separate', noSave: true })
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('参考答案')
    expect(doc.pages).toBeGreaterThanOrEqual(2)
  })

  it('double 模式：两题并排（第二题 x 大于页中线）', async () => {
    const doc = await generatePDF([q('1'), q('2')], { mode: 'double', noSave: true })
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBeGreaterThanOrEqual(2)
    expect(imgs[1][2]).toBeGreaterThan(105)
  })

  it('spacing large + spacingCm 画留空虚线', async () => {
    const doc = await generatePDF([q('1')], { mode: 'single', spacing: 'large', spacingCm: 2, noSave: true })
    expect(doc.calls.some(c => c[0] === 'line')).toBe(true)
  })

  it('layout_type 快速映射：稀疏双栏标注回退单栏，与单栏题同页混排', async () => {
    const qs = [
      { ...q('s1', false), layout_type: 0 },
      { ...q('s2', false), layout_type: 0 },
      { ...q('d1', false), layout_type: 1 },
    ]
    const doc = await generatePDF(qs, { mode: 'single', noSave: true })
    expect(doc.pages).toBe(1)
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    const d1 = imgs.find(c => c[1].includes('Qd1'))
    expect(d1).toBeTruthy()
    expect(d1[2]).toBe(10)
    const s1 = imgs.find(c => c[1].includes('Qs1'))
    expect(s1[2]).toBe(10)
  })

  it('separate 走引擎自动混排：双栏标注的题图与答案图均按双栏排版，题目段与答案段分页', async () => {
    const qs = [
      { ...q('s', true), layout_type: 0 },
      { ...q('d', true), layout_type: 1 },
    ]
    const doc = await generatePDF(qs, { mode: 'separate', noSave: true })
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    expect(imgs.length).toBe(4)
    expect(imgs.find(c => c[1].endsWith('Qs'))[2]).toBe(10)
    expect(imgs.find(c => c[1].endsWith('Qd'))[2]).toBe(10)
    expect(imgs.find(c => c[1].endsWith('Ad'))[2]).toBe(10)
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('参考答案')
    expect(doc.pages).toBe(2)
  })

  it('stemMM 变大 → 文字字号同步变大', async () => {
    const small = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 3 })
    const big = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 6 })
    const sizes = d => d.calls.filter(c => c[0] === 'setFontSize').map(c => c[1])
    expect(Math.max(...sizes(big))).toBeGreaterThan(Math.max(...sizes(small)))
  })

  it('stemMM 变大 → 标签预留高与绘制高度同步变大', async () => {
    const small = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 3 })
    const big = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM: 6 })
    const hs = d => d.calls.filter(c => c[0] === 'addImage').map(c => c[5])
    expect(Math.max(...hs(big))).toBeGreaterThan(Math.max(...hs(small)))
  })

  it('标签基线随字号缩放：labelY = imageY - labelH + baseline，间距 = 字号mm × 0.48', async () => {
    const gapOf = async (stemMM) => {
      const doc = await generatePDF([q('1')], { mode: 'single', noSave: true, stemMM })
      const labelY = doc.calls.filter(c => c[0] === 'text' && c[1] === '第 1 题')[0][3]
      const imgY = doc.calls.filter(c => c[0] === 'addImage' && c[1].includes('Q1'))[0][3]
      return imgY - labelY
    }
    const factor = 0.97 * (1.28 - 0.8)
    expect(await gapOf(4)).toBeCloseTo(4 * factor, 3)
    expect(await gapOf(6)).toBeCloseTo(6 * factor, 3)
  })

  it('marginTop 变大 → 首格 y 下移（y 自页顶起算，应变大）', async () => {
    const small = await generatePDF([q('1')], { mode: 'single', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginTopMM: 10 } })
    const big = await generatePDF([q('1')], { mode: 'single', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginTopMM: 20 } })
    const firstY = d => d.calls.filter(c => c[0] === 'addImage')[0][3]
    expect(firstY(big)).toBeGreaterThan(firstY(small))
  })

  it('showTitle=false → 无标题文本，且首格 y 变小', async () => {
    const withTitle = await generatePDF([q('1')], { mode: 'single', title: 'T', noSave: true, setup: DEFAULT_PAGE_SETUP })
    const noTitle = await generatePDF([q('1')], { mode: 'single', title: 'T', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, showTitle: false } })
    const texts = d => d.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts(noTitle).join('|')).not.toContain('T')
    expect(texts(noTitle).join('|')).not.toContain('共 1 题')
    const firstY = d => d.calls.filter(c => c[0] === 'addImage')[0][3]
    expect(firstY(noTitle)).toBeLessThan(firstY(withTitle))
  })

  it('separate 模式：参考答案页眉基线随 marginTop 下移（0.8×headerMM 偏移）', async () => {
    const qs = [q('1')]
    const a = await generatePDF(qs, { mode: 'separate', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginTopMM: 10 } })
    const b = await generatePDF(qs, { mode: 'separate', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginTopMM: 20 } })
    const headerY = d => d.calls.filter(c => c[0] === 'text' && c[1] === '参考答案')[0][3]
    expect(headerY(b) - headerY(a)).toBeCloseTo(10, 3)
    expect(headerY(a)).toBeCloseTo(10 + 10.5 * 0.3528 * 1.41 * 0.8, 2)
  })

  it('showTitle=true 且 showCount=false：画标题不画副标题', async () => {
    const doc = await generatePDF([q('1')], { mode: 'single', title: 'T卷', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, showTitle: true, showCount: false } })
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('T卷')
    expect(texts.join('|')).not.toContain('共 1 题')
  })

  it('marginBottom 变大 → 页码 y 上移（更远离纸底）', async () => {
    const small = await generatePDF([q('1')], { mode: 'single', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginBottomMM: 10 } })
    const big = await generatePDF([q('1')], { mode: 'single', noSave: true, setup: { ...DEFAULT_PAGE_SETUP, marginBottomMM: 20 } })
    const pageNumY = d => {
      const c = d.calls.filter(x => x[0] === 'text' && typeof x[1] === 'string' && x[1].includes('—') && x[1].includes('/'))[0]
      return c ? c[3] : null
    }
    expect(pageNumY(big)).toBeLessThan(pageNumY(small))
  })
})
