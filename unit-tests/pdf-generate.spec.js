import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  setFontSize() {} setTextColor() {} setFont() {}
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

  it('layout_type 快速映射：0→单栏组、1→双栏组，混合自动混排组间翻页', async () => {
    const qs = [
      { ...q('s1', false), layout_type: 0 },
      { ...q('s2', false), layout_type: 0 },
      { ...q('d1', false), layout_type: 1 },
    ]
    const doc = await generatePDF(qs, { mode: 'single', noSave: true })
    expect(doc.pages).toBe(2)
    const imgs = doc.calls.filter(c => c[0] === 'addImage')
    const d1 = imgs.find(c => c[1].endsWith('Qd1'))
    expect(d1).toBeTruthy()
    expect(d1[2]).toBe(16)
    const s1 = imgs.find(c => c[1].endsWith('Qs1'))
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
    expect(imgs.find(c => c[1].endsWith('Qd'))[2]).toBe(16)
    expect(imgs.find(c => c[1].endsWith('Ad'))[2]).toBe(16)
    const texts = doc.calls.filter(c => c[0] === 'text').map(c => c[1])
    expect(texts.join('|')).toContain('参考答案')
    expect(doc.pages).toBe(4)
  })
})
