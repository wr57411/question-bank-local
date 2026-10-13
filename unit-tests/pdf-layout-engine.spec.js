import { describe, it, expect } from 'vitest'
import { planLayout, singleColumnWidthMM } from '../src/data/pdf-layout-engine'

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

  it('稀疏双栏题被强制单栏，与单栏题顺序混排', () => {
    const r = planLayout([mk('s1', 1000, 400, 20), mk('d1', 1000, 400, 20, 'double'), mk('s2', 1000, 400, 20), mk('d2', 1000, 400, 20, 'double')])
    const p1 = r.pages[0].L.concat(r.pages[0].R)
    expect(p1.map(c => c.src.slice(-2))).toEqual(['s1', 'd1', 's2'])
    expect(r.pages.length).toBe(2)
  })

  it('密集双栏题保持双栏组，组间强制翻页不混排', () => {
    const r = planLayout([mk('s1', 1000, 400, 100), mk('d1', 1000, 400, 100, 'double'), mk('s2', 1000, 400, 100), mk('d2', 1000, 400, 100, 'double')])
    expect(r.pages.length).toBe(2)
    expect(r.pages[0].L.map(c => c.src.slice(-2))).toEqual(['s1', 's2'])
    expect(r.pages[1].L.concat(r.pages[1].R).map(c => c.src.slice(-2))).toEqual(['d1', 'd2'])
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
  it('绝对目标 + clamp[0.35,1] 下限生效', () => {
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

describe('绝对目标归一化', () => {
  it('stemMM 变大 → rw 变大，直到撞上栏宽天花板', () => {
    const mk1 = () => [mk('a', 1000, 400, 40)]
    const w4 = planLayout(mk1(), { stemMM: 4 }).pages[0].L[0].w
    const w8 = planLayout(mk1(), { stemMM: 8 }).pages[0].L[0].w
    const w40 = planLayout(mk1(), { stemMM: 40 }).pages[0].L[0].w
    expect(w4).toBeCloseTo(100, 2)
    expect(w8).toBeCloseTo(190, 5)
    expect(w40).toBeCloseTo(190, 5)
  })

  it('下限 0.35×栏宽 防止 tH 估错把图缩成蚂蚁', () => {
    const r = planLayout([mk('a', 1000, 400, 100000)], { stemMM: 4 })
    expect(r.pages[0].L[0].w).toBeCloseTo(190 * 0.35, 5)
  })

  it('双栏下达不到 0.75×目标 的题被强制单栏，达标的保留双栏', () => {
    const sparse = planLayout([mk('d', 1000, 400, 20, 'double')], { stemMM: 4 })
    expect(sparse.pages[0].L[0].w).toBeCloseTo(190, 5)
    const dense = planLayout([mk('d', 1000, 400, 100, 'double')], { stemMM: 4 })
    expect(dense.pages[0].L[0].w).toBeCloseTo(40, 5)
  })
})

describe('planLayout 切割路径与预算', () => {
  it('双栏左栏切割后碎片续到右栏且与左切片 si 配对', () => {
    const r = planLayout([mk('d1', 1000, 2000, 40, 'double'), mk('d2', 1000, 2000, 40, 'double')])
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
    const r = planLayout([mk('d1', 1000, 7000, 40, 'double'), mk('d2', 1000, 7000, 40, 'double'), mk('d3', 1000, 7000, 40, 'double')])
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
    const r = planLayout([mk('d1', 1000, 7000, 40, 'double'), mk('d2', 1000, 7000, 40, 'double'), mk('d3', 1000, 7000, 40, 'double')])
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

describe('singleColumnWidthMM', () => {
  it('side=10 → 190（默认）、15 → 180、0 → 210', () => {
    expect(singleColumnWidthMM(10)).toBe(190)
    expect(singleColumnWidthMM(15)).toBe(180)
    expect(singleColumnWidthMM(0)).toBe(210)
  })
})

describe('独立边距 marginTop/Bottom/Side', () => {
  it('side=15：单栏 x=15、单栏宽 63（=uws*0.35 下限），双栏右 x=AW−side−uwd=107 且栏缝仍为 4', () => {
    const s = planLayout([mk('s1', 1000, 400, 100)], { marginSideMM: 15 })
    expect(s.pages[0].L[0].x).toBe(15)
    expect(s.pages[0].L[0].w).toBeCloseTo(63, 5)

    const d = planLayout([
      mk('d1', 1000, 1200, 35, 'double'),
      mk('d2', 1000, 1200, 35, 'double'),
      mk('d3', 1000, 1200, 35, 'double'),
    ], { marginSideMM: 15 })
    const cells = d.pages.flatMap(p => p.L.concat(p.R))
    const xs = [...new Set(cells.map(c => c.x))].sort((a, b) => a - b)
    expect(xs).toEqual([15, 107])
    expect(xs[1] - (xs[0] + cells[0].w)).toBeCloseTo(4, 5)
  })

  it('marginTop=20 且 bottom=10：首格 y（自页底起算）比 bottom=20 时大 10mm（即上移 10mm）', () => {
    const unit = [mk('a', 1000, 400, 100)]
    const yTop20 = planLayout(unit, { marginTopMM: 20, marginBottomMM: 10 }).pages[0].L[0].y
    const yBot20 = planLayout(unit, { marginTopMM: 10, marginBottomMM: 20 }).pages[0].L[0].y
    expect(yTop20 - yBot20).toBeCloseTo(10, 5)
  })

  it('边距非法（uh<=0 或 uws<=0）返回空页且 truncated=true，不产垃圾坐标', () => {
    const r1 = planLayout([mk('a', 1000, 400, 100)], { marginTopMM: 200, marginBottomMM: 200 })
    expect(r1.pages.length).toBe(0)
    expect(r1.truncated).toBe(true)
    const r2 = planLayout([mk('a', 1000, 400, 100)], { marginSideMM: 105 })
    expect(r2.pages.length).toBe(0)
    expect(r2.truncated).toBe(true)
  })

  it('缺省三值时与 marginMM=10 现状逐位一致（回归锁定）', () => {
    const unit = [mk('a', 1000, 400, 100), mk('d1', 1000, 1200, 100, 'double'), mk('d2', 1000, 1200, 100, 'double'), mk('d3', 1000, 1200, 100, 'double')]
    const a = planLayout(unit.map(u => ({ ...u })))
    const b = planLayout(unit.map(u => ({ ...u })), { marginMM: 10 })
    const key = r => r.pages.flatMap(p => p.L.concat(p.R)).map(c => [c.x, c.y, c.w, c.h].join(',')).join('|')
    expect(key(a)).toBe(key(b))
  })
})

describe('双栏栏宽不含 CPAD', () => {
  it('双栏左右列 x 分别为 MG 与 AW/2+CGAP/2，栏缝恰为 CGAP', () => {
    const r = planLayout([
      mk('d1', 1000, 1200, 35, 'double'),
      mk('d2', 1000, 1200, 35, 'double'),
      mk('d3', 1000, 1200, 35, 'double'),
    ])
    const cells = r.pages.flatMap(p => p.L.concat(p.R))
    const xs = [...new Set(cells.map(c => c.x))].sort((a, b) => a - b)
    expect(xs).toEqual([10, 107])
    expect(xs[1] - (xs[0] + cells[0].w)).toBeCloseTo(4, 5)
    expect(cells.every(c => c.w === cells[0].w)).toBe(true)
    expect(cells[0].w).toBeCloseTo(93, 5)
  })
})
