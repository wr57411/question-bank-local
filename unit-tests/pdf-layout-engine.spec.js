import { describe, it, expect } from 'vitest'
import { planLayout } from '../src/data/pdf-layout-engine'

function mk(key, w, h, tH, lm = 'single', extra = {}) {
  return { key, src: 'data:image/jpeg;base64,' + key, w, h, tH, lm, labelH: 0, afterGap: 0, ...extra }
}

describe('planLayout 基础流', () => {
  it('全 single 短图同页顺序排列', () => {
    const r = planLayout([mk('a', 1000, 400, 20), mk('b', 1000, 400, 20), mk('c', 1000, 400, 20)])
    expect(r.pages.length).toBe(1)
    expect(r.pages[0].L.length).toBe(3)
    expect(r.pages[0].L.map(c => c.src.slice(-1))).toEqual(['a', 'b', 'c'])
    expect(r.nSplit).toBe(0)
  })

  it('单栏组在前、双栏组在后、组间强制翻页不混排', () => {
    const r = planLayout([mk('s1', 1000, 400, 20), mk('d1', 1000, 400, 20, 'double'), mk('s2', 1000, 400, 20), mk('d2', 1000, 400, 20, 'double')])
    expect(r.pages.length).toBe(2)
    const p1 = r.pages[0].L.concat(r.pages[0].R)
    const p2 = r.pages[1].L.concat(r.pages[1].R)
    expect(p1.map(c => c.src.slice(-2))).toEqual(['s1', 's2'])
    expect(p2.map(c => c.src.slice(-2))).toEqual(['d1', 'd2'])
  })
})

describe('planLayout 长图切割', () => {
  it('超高图被切割且碎片回队继续排版', () => {
    const r = planLayout([mk('long', 900, 4000, 18)])
    expect(r.pages.length).toBeGreaterThan(1)
    expect(r.nSplit).toBeGreaterThan(0)
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    expect(cells.some(c => c.isSp && c.crop && c.crop.sy === 0)).toBe(true)
    expect(cells.some(c => c.isSp && c.crop && c.crop.sy > 0)).toBe(true)
  })

  it('切割碎片保持源图顺序（后续图不插到碎片中间）', () => {
    const r = planLayout([mk('long', 900, 4000, 18), mk('after', 1000, 300, 20)])
    const flat = r.pages.flatMap(p => p.L.concat(p.R))
    const lastLongIdx = flat.map(c => c.src.slice(-1)).lastIndexOf('g')
    const afterIdx = flat.findIndex(c => c.src.endsWith('after'))
    expect(afterIdx).toBeGreaterThan(lastLongIdx)
  })

  it('碎片在新页整放时保留裁剪信息（isSp=false 但带 crop）', () => {
    const r = planLayout([mk('long', 900, 4000, 18)])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    expect(cells.some(c => !c.isSp && c.crop && c.crop.sy > 0)).toBe(true)
  })
})

describe('planLayout 归一化与参数', () => {
  it('normScale 按 baseline 中位数缩放并 clamp 到 [0.35,1]', () => {
    const r = planLayout([mk('big', 1000, 400, 10), mk('small', 1000, 400, 100)])
    const cells = r.pages[0].L
    const bigCell = cells.find(c => c.src.endsWith('g'))
    const smallCell = cells.find(c => c.src.endsWith('l'))
    expect(smallCell.w / bigCell.w).toBeCloseTo(0.35, 5)
  })

  it('topReserveMM 只压缩第一页可用高度', () => {
    const r = planLayout([mk('a', 1000, 400, 20)], { topReserveMM: 35 })
    expect(r.pages[0].L[0].y).toBeCloseTo(297 - 10 - (277 - 35) + 6, 5)
  })

  it('labelH 记录到 cell 供绘制层预算', () => {
    const withLabel = planLayout([mk('a', 1000, 400, 20, 'single', { label: '第 1 题', labelH: 5 })])
    expect(withLabel.pages[0].L[0].labelH).toBe(5)
  })

  it('marginMM 可配置', () => {
    const r = planLayout([mk('a', 1000, 400, 20)], { marginMM: 15 })
    expect(r.pages[0].L[0].x).toBe(15)
  })

  it('空输入与全零图返回空页', () => {
    expect(planLayout([]).pages.length).toBe(0)
    expect(planLayout([mk('z', 0, 0, 0)]).pages.length).toBe(0)
  })
})

describe('planLayout 切割路径与预算', () => {
  it('双栏左栏切割后碎片续到右栏且与左切片 si 配对', () => {
    const r = planLayout([mk('d1', 1000, 2000, 18, 'double'), mk('d2', 1000, 2000, 18, 'double')])
    const pairs = []
    r.pages.forEach(p => {
      const l = p.L.find(c => c.isSp && c.crop && c.crop.sy === 0)
      if (!l) return
      const rr = p.R.find(c => c.isSp && c.crop && c.src === l.src && c.crop.sy > 0)
      if (rr) pairs.push([l, rr])
    })
    expect(pairs.length).toBeGreaterThan(0)
    for (const [l, rr] of pairs) {
      expect(rr.si).toBe(l.si)
      expect(rr.crop.sy).toBe(l.crop.sh)
    }
  })

  it('剩余高度不足 MIN_SPLIT 时整图翻页不切割', () => {
    const r = planLayout([mk('a', 1000, 1250, 20), mk('b', 1000, 200, 20)])
    expect(r.pages.length).toBe(2)
    expect(r.pages[0].L.map(c => c.src.slice(-1))).toEqual(['a'])
    expect(r.pages[0].L[0].isSp).toBe(false)
    const bCells = r.pages[1].L.concat(r.pages[1].R)
    expect(bCells.length).toBe(1)
    expect(bCells[0].src.endsWith('b')).toBe(true)
    expect(bCells[0].isSp).toBe(false)
  })

  it('双栏碎片右栏放不下时回队到后续页且无静默丢失', () => {
    const r = planLayout([mk('d1', 1000, 7000, 18, 'double'), mk('d2', 1000, 7000, 18, 'double'), mk('d3', 1000, 7000, 18, 'double')])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const srcs = [...new Set(cells.map(c => c.src.slice(-2)))].sort()
    expect(srcs).toEqual(['d1', 'd2', 'd3'])
    expect(r.pages[0].R.length).toBe(0)
    expect(r.nSplit).toBeGreaterThan(0)
    expect(r.truncated).toBe(false)
  })

  it('afterGap 计入占位预算挤不下时第二张翻页', () => {
    const r = planLayout([mk('a', 1000, 400, 20, 'single', { afterGap: 160 }), mk('b', 1000, 400, 20)])
    expect(r.pages.length).toBe(2)
    expect(r.pages[0].L[0].src.endsWith('a')).toBe(true)
    expect(r.pages[0].L[0].afterGap).toBe(160)
    const bCells = r.pages[1].L.concat(r.pages[1].R)
    expect(bCells.length).toBe(1)
    expect(bCells[0].src.endsWith('b')).toBe(true)
    expect(bCells[0].isSp).toBe(false)
  })

  it('正常排完时 truncated 为 false', () => {
    const r = planLayout([mk('a', 1000, 400, 20), mk('b', 1000, 400, 20), mk('c', 1000, 400, 20)])
    expect(r.truncated).toBe(false)
  })

  it('切割尾段小于 MIN_SPLIT 时无条件回队保留内容', () => {
    const r = planLayout([mk('tail', 1000, 1474, 20)])
    expect(r.truncated).toBe(false)
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const tailCells = cells.filter(c => c.src.endsWith('tail'))
    const last = tailCells[tailCells.length - 1]
    expect(last.crop).toBeTruthy()
    expect(last.crop.sy + last.crop.sh).toBe(1474)
  })

  it('双栏各图 crop 段无缝覆盖完整像素范围', () => {
    const r = planLayout([mk('d1', 1000, 7000, 18, 'double'), mk('d2', 1000, 7000, 18, 'double'), mk('d3', 1000, 7000, 18, 'double')])
    expect(r.truncated).toBe(false)
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const bySrc = new Map()
    for (const c of cells) {
      if (!bySrc.has(c.src)) bySrc.set(c.src, [])
      bySrc.get(c.src).push(c)
    }
    expect(bySrc.size).toBe(3)
    for (const segs of bySrc.values()) {
      expect(segs.every(c => c.crop)).toBe(true)
      segs.sort((a, b) => a.crop.sy - b.crop.sy)
      expect(segs[0].crop.sy).toBe(0)
      for (let i = 1; i < segs.length; i++) expect(segs[i].crop.sy).toBe(segs[i - 1].crop.sy + segs[i - 1].crop.sh)
      const lastSeg = segs[segs.length - 1]
      expect(lastSeg.crop.sy + lastSeg.crop.sh).toBe(7000)
    }
  })
})

describe('planLayout spacing 窗口与零碎片防护', () => {
  it('spacing 窗口内能整放不误切：availImg >= rh 时落新页整放，无零高度碎片', () => {
    const r = planLayout([mk('a', 1000, 400, 20), mk('b', 1000, 400, 20, 'single', { afterGap: 120 })])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const b = cells.find(c => c.src.endsWith('b'))
    expect(b.isSp).toBe(false)
    expect(!b.crop || b.crop.sy === 0).toBe(true)
    expect(cells.some(c => c.crop && c.crop.sh === 0)).toBe(false)
    expect(cells.every(c => c.h > 0)).toBe(true)
  })

  it('切割场景所有碎片 h > 0 且 crop.sh > 0（remH 零守卫）', () => {
    const r = planLayout([mk('long', 900, 4000, 18), mk('after', 1000, 300, 20)])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    expect(r.nSplit).toBeGreaterThan(0)
    expect(r.truncated).toBe(false)
    expect(cells.every(c => c.h > 0)).toBe(true)
    expect(cells.every(c => !c.crop || c.crop.sh > 0)).toBe(true)
  })
})
