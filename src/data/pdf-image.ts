import type { CropRect } from '../types';

export function estimateTHFromPixels(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  const N = w * h;
  for (let i = 0; i < N; i++) sum += data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const mean = sum / N;

  const proj = new Float32Array(h);
  const step = Math.max(1, Math.floor(w / 200));
  const thresh = mean * 0.88;
  for (let y = 0; y < h; y++) {
    let dark = 0, total = 0;
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const v = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      total++;
      if (v < thresh) dark++;
    }
    proj[y] = dark / total;
  }

  const sm = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const a0 = y > 0 ? proj[y - 1] : proj[y];
    const a1 = proj[y];
    const a2 = y < h - 1 ? proj[y + 1] : proj[y];
    sm[y] = (a0 + a1 + a2) / 3;
  }

  const heights: number[] = [];
  const minTh = 0.05;
  let inLine = false, lineStart = 0;
  for (let y = 0; y < h; y++) {
    if (sm[y] > minTh && !inLine) { inLine = true; lineStart = y; }
    else if (sm[y] <= minTh && inLine) {
      inLine = false;
      const lhh = y - lineStart;
      if (lhh >= 5 && lhh <= h * 0.22) heights.push(lhh);
    }
  }
  if (inLine) {
    const lhh = h - lineStart;
    if (lhh >= 5 && lhh <= h * 0.22) heights.push(lhh);
  }

  if (!heights.length) return Math.max(10, Math.round(h * 0.025));
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败: ' + String(src).slice(0, 60)));
    img.src = src;
  });
}

export async function loadImageDims(src: string): Promise<{ w: number; h: number }> {
  const img = await loadImage(src);
  return { w: img.naturalWidth, h: img.naturalHeight };
}

export async function estimateTH(src: string): Promise<number> {
  const img = await loadImage(src);
  const sc = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * sc);
  const h = Math.round(img.naturalHeight * sc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Math.max(10, Math.round(h * 0.025));
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return estimateTHFromPixels(data, w, h) / sc;
}

export async function cropImage(src: string, rect: CropRect): Promise<string> {
  const img = await loadImage(src);
  try {
    const c = document.createElement('canvas');
    c.width = rect.sw; c.height = rect.sh;
    const ctx = c.getContext('2d');
    if (!ctx) return src;
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    return c.toDataURL('image/jpeg', 0.92);
  } catch {
    return src;
  }
}
