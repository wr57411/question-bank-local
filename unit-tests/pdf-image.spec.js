import { describe, it, expect } from 'vitest'
import { estimateTHFromPixels } from '../src/data/pdf-image'

function white(w, h) {
  return new Uint8ClampedArray(w * h * 4).fill(255)
}

function stripes(w, h, periodPx, bandPx) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = Math.floor(periodPx / 2); y < h; y += periodPx) {
    for (let dy = 0; dy < bandPx && y + dy < h; dy++) {
      for (let x = 0; x < w; x++) {
        const i = ((y + dy) * w + x) * 4
        d[i] = 40; d[i + 1] = 40; d[i + 2] = 40
      }
    }
  }
  return d
}

describe('estimateTHFromPixels', () => {
  it('纯白图走 fallback（约 h*0.025）', () => {
    expect(estimateTHFromPixels(white(200, 400), 200, 400)).toBe(10)
  })

  it('暗带图走 runs 检出主路径，中位数接近带宽', () => {
    const v = estimateTHFromPixels(stripes(400, 300, 50, 12), 400, 300)
    expect(v).toBeGreaterThanOrEqual(12)
    expect(v).toBeLessThanOrEqual(16)
    expect(v).not.toBe(10)
  })
})
