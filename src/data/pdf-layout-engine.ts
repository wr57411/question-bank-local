import type { LayoutImage, LayoutCell, LayoutPage, PlanLayoutOptions, PlanLayoutResult, CropRect } from '../types';

const AW = 210, AH = 297, CGAP = 4, CPAD = 6, MIN_SPLIT = 25;

interface QueueItem {
  key: string;
  cropY: number;
  cropH: number;
  lm: 'single' | 'double';
}

export function planLayout(images: LayoutImage[], opts: PlanLayoutOptions = {}): PlanLayoutResult {
  const MG = opts.marginMM ?? 10;
  const uws = AW - 2 * MG;
  const uwd = (uws - CGAP) / 2 - 2 * CPAD;
  const uh = AH - 2 * MG;
  const tgt = opts.targetTextMM ?? 4;
  const topReserve = opts.topReserveMM ?? 0;

  const valid = images.filter(im => im.tH > 0 && im.w > 0 && im.h > 0);
  if (!valid.length) return { pages: [], nSplit: 0, truncated: false };

  const scales = valid.map(im => tgt / ((im.tH / im.w) * (im.lm === 'double' ? uwd : uws)));
  scales.sort((a, b) => a - b);
  const baseline = scales[Math.floor(scales.length / 2)] || 1;

  const norm = new Map<string, number>();
  for (const im of valid) {
    const uw = im.lm === 'double' ? uwd : uws;
    const raw = tgt / ((im.tH / im.w) * uw);
    norm.set(im.key, Math.max(0.35, Math.min(1, raw / baseline)));
  }

  const byKey = new Map(images.map(im => [im.key, im]));
  const queue: QueueItem[] = [];
  for (const want of ['single', 'double'] as const) {
    for (const im of images) {
      if (im.lm === want && im.tH > 0 && im.w > 0 && im.h > 0) {
        queue.push({ key: im.key, cropY: 0, cropH: im.h, lm: im.lm });
      }
    }
  }

  const pages: LayoutPage[] = [];
  let nSplit = 0;
  let page: LayoutPage = { L: [], R: [] };
  let yL = uh - topReserve;
  let yR = uh - topReserve;

  function newPage(): void {
    if (page.L.length || page.R.length) pages.push(page);
    page = { L: [], R: [] };
    yL = uh;
    yR = uh;
  }

  function addCell(col: 'L' | 'R', x: number, y: number, w: number, h: number, im: LayoutImage, q: QueueItem, crop: CropRect | undefined, sp: boolean, si: number): void {
    const cell: LayoutCell = {
      x, y, w, h,
      src: im.src,
      label: im.label,
      labelH: im.labelH || 0,
      afterGap: q.cropY === 0 && q.cropH === im.h ? im.afterGap || 0 : 0,
      isSp: sp,
      si,
      p: crop ? 1 : '',
      t: crop ? 2 : '',
      crop,
    };
    (col === 'L' ? page.L : page.R).push(cell);
  }

  let lastLm: string | undefined;
  let iter = 0;

  while (queue.length && iter < images.length * 8 + 64) {
    iter++;
    const q = queue.shift()!;
    const im = byKey.get(q.key);
    if (!im) continue;
    if (lastLm !== undefined && q.lm !== lastLm && (page.L.length || page.R.length)) newPage();
    lastLm = q.lm;

    const uw = q.lm === 'double' ? uwd : uws;
    const ns = norm.get(q.key)!;
    const rw = uw * ns;
    const rh = rw * (q.cropH / im.w);
    const lh = im.labelH || 0;
    const pad = CPAD;
    const isWhole = q.cropY === 0 && q.cropH === im.h;
    const gap = isWhole ? im.afterGap || 0 : 0;

    if (q.lm === 'single') {
      const need = rh + lh + pad * 2 + gap;
      if (need <= yL) {
        addCell('L', MG, AH - MG - yL + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
        yL -= need;
      } else {
        const availImg = yL - pad * 2 - lh;
        if (availImg >= MIN_SPLIT && availImg < rh) {
          const cropPx = Math.min(Math.round(q.cropH * (availImg / rh)), q.cropH);
          addCell('L', MG, AH - MG - yL + pad, rw, availImg, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx }, true, nSplit);
          nSplit++;
          yL = 0;
          const remH = q.cropH - cropPx;
          const startY = q.cropY + cropPx;
          newPage();
          if (remH > 0) queue.unshift({ key: q.key, cropY: startY, cropH: remH, lm: q.lm });
        } else {
          newPage();
          const need2 = rh + lh + pad * 2 + gap;
          if (need2 <= uh) {
            addCell('L', MG, MG + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
            yL = uh - need2;
          } else {
            const availImg2 = uh - pad * 2 - lh;
            if (availImg2 < rh) {
              const cropPx2 = Math.min(Math.round(q.cropH * (availImg2 / rh)), q.cropH);
              addCell('L', MG, MG + pad, rw, availImg2, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx2 }, true, nSplit);
              nSplit++;
              yL = 0;
              const remH2 = q.cropH - cropPx2;
              const sP = q.cropY + cropPx2;
              newPage();
              if (remH2 > 0) queue.unshift({ key: q.key, cropY: sP, cropH: remH2, lm: q.lm });
            } else {
              addCell('L', MG, MG + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
              yL = availImg2 - rh;
            }
          }
        }
      }
    } else {
      const need = rh + lh + pad * 2;
      let placed = false;

      if (need + gap <= yL) {
        addCell('L', MG + CPAD, AH - MG - yL + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
        yL -= need + gap;
        placed = true;
      } else if (yL - pad * 2 - lh >= MIN_SPLIT && yL - pad * 2 - lh < rh) {
        const availImg = yL - pad * 2 - lh;
        const cropPx = Math.min(Math.round(q.cropH * (availImg / rh)), q.cropH);
        addCell('L', MG + CPAD, AH - MG - yL + pad, rw, availImg, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx }, true, nSplit);
        nSplit++;
        yL = 0;
        const remHpx = q.cropH - cropPx;
        const startY2 = q.cropY + cropPx;
        if (remHpx > 0) {
          const remHmm = rw * (remHpx / im.w);
          if (remHmm + lh + pad * 2 <= yR) {
            addCell('R', AW / 2 + CGAP / 2 + CPAD, AH - MG - yR + pad, rw, remHmm, im, { ...q, cropY: startY2, cropH: remHpx }, { sx: 0, sy: startY2, sw: im.w, sh: remHpx }, true, nSplit - 1);
            yR -= remHmm + lh + pad * 2;
          } else {
            queue.unshift({ key: q.key, cropY: startY2, cropH: remHpx, lm: q.lm });
          }
        }
        placed = true;
      }

      if (!placed) {
        if (need + gap <= yR) {
          addCell('R', AW / 2 + CGAP / 2 + CPAD, AH - MG - yR + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
          yR -= need + gap;
          placed = true;
        } else {
          newPage();
          if (need + gap <= uh) {
            addCell('L', MG + CPAD, MG + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
            yL = uh - need - gap;
            placed = true;
          } else {
            const availImg2 = uh - pad * 2 - lh;
            if (availImg2 < rh) {
              const cropPx2 = Math.min(Math.round(q.cropH * (availImg2 / rh)), q.cropH);
              addCell('L', MG + CPAD, MG + pad, rw, availImg2, im, q, { sx: 0, sy: q.cropY, sw: im.w, sh: cropPx2 }, true, nSplit);
              nSplit++;
              yL = 0;
              const remH2px = q.cropH - cropPx2;
              const sP2 = q.cropY + cropPx2;
              newPage();
              if (remH2px > 0) queue.unshift({ key: q.key, cropY: sP2, cropH: remH2px, lm: q.lm });
            } else {
              addCell('L', MG + CPAD, MG + pad, rw, rh, im, q, q.cropY === 0 && q.cropH === im.h ? undefined : { sx: 0, sy: q.cropY, sw: im.w, sh: q.cropH }, false, nSplit);
              yL = availImg2 - rh;
            }
            placed = true;
          }
        }
      }
    }
  }

  if (page.L.length || page.R.length) pages.push(page);
  return { pages, nSplit, truncated: queue.length > 0 };
}
