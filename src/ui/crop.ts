/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Cropper: any;
const w = window as any;

// ========== 裁剪 ==========

let cropper: any = null;
let currentCropTarget: string | null = null;
let cropSessionId = 0;
let cropInteractionLayer: HTMLElement | null = null;
let cropMoveZone: HTMLElement | null = null;
let cropCornerZones: Record<string, HTMLElement> = {};
let cropGestureState: any = null;
let cropInteractionFrame = 0;
let _cropResolve: ((v: any) => void) | null = null;

Object.defineProperty(w, 'cropper', { get: () => cropper, set: (v) => { cropper = v; }, configurable: true });
Object.defineProperty(w, 'currentCropTarget', { get: () => currentCropTarget, set: (v) => { currentCropTarget = v; }, configurable: true });

export function clampValue(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothSeries(values: number[], radius: number): number[] {
  if (!values.length || radius <= 0) return values.slice();
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return values.map((_, i) => {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    return (prefix[end + 1] - prefix[start]) / (end - start + 1);
  });
}

export function getOtsuThreshold(histogram: number[], totalPixels: number): number {
  let total = 0;
  for (let i = 0; i < histogram.length; i++) total += i * histogram[i];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 180;
  for (let i = 0; i < histogram.length; i++) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = totalPixels - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (total - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * Math.pow(backgroundMean - foregroundMean, 2);
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = i;
    }
  }
  return threshold;
}

export function collectRanges(flags: boolean[], maxGap: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (start === -1) start = i;
      gap = 0;
      continue;
    }
    if (start === -1) continue;
    if (gap < maxGap) {
      gap++;
      continue;
    }
    ranges.push({ start, end: i - gap - 1 });
    start = -1;
    gap = 0;
  }
  if (start !== -1) ranges.push({ start, end: flags.length - 1 - gap });
  return ranges.filter(range => range.end >= range.start);
}

export function expandRect(rect: { x: number; y: number; width: number; height: number }, padX: number, padY: number, maxWidth: number, maxHeight: number): { x: number; y: number; width: number; height: number } {
  const x = clampValue(rect.x - padX, 0, maxWidth);
  const y = clampValue(rect.y - padY, 0, maxHeight);
  const right = clampValue(rect.x + rect.width + padX, 0, maxWidth);
  const bottom = clampValue(rect.y + rect.height + padY, 0, maxHeight);
  return { x, y, width: right - x, height: bottom - y };
}

export async function detectCenterQuestionRect(image: HTMLImageElement): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return null;
  const maxDimension = 960;
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(240, Math.round(naturalWidth * scale));
  const height = Math.max(240, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const histogram = new Array(256).fill(0);
  const gray = new Uint8Array(width * height);
  let mean = 0;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const value = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
    gray[p] = value;
    histogram[value]++;
    mean += value;
  }
  mean /= gray.length || 1;
  let threshold = getOtsuThreshold(histogram, gray.length);
  threshold = clampValue(Math.round(Math.min(threshold, mean - 12)), 90, 210);
  const marginX = Math.round(width * 0.05);
  const marginY = Math.round(height * 0.03);
  const activeWidth = Math.max(1, width - marginX * 2);
  const rowCounts = new Array(height).fill(0);
  for (let y = marginY; y < height - marginY; y++) {
    let count = 0;
    for (let x = marginX; x < width - marginX; x++) {
      if (gray[y * width + x] < threshold) count++;
    }
    rowCounts[y] = count;
  }
  const smoothedRows = smoothSeries(rowCounts, Math.max(3, Math.round(height / 200)));
  const maxRow = smoothedRows.reduce((m, v) => Math.max(m, v), 0);
  if (!maxRow) return null;
  const rowThreshold = Math.max(activeWidth * 0.01, maxRow * 0.18);
  const activeRows = smoothedRows.map(value => value >= rowThreshold);
  const rowRanges = collectRanges(activeRows, Math.max(8, Math.round(height * 0.018)));
  let bestRect: { x: number; y: number; width: number; height: number } | null = null;
  let bestScore = -Infinity;
  for (const range of rowRanges) {
    const bandHeight = range.end - range.start + 1;
    if (bandHeight < Math.round(height * 0.035)) continue;
    const colCounts = new Array(width).fill(0);
    for (let y = range.start; y <= range.end; y++) {
      for (let x = marginX; x < width - marginX; x++) {
        if (gray[y * width + x] < threshold) colCounts[x]++;
      }
    }
    const smoothedCols = smoothSeries(colCounts, Math.max(2, Math.round(width / 180)));
    const maxCol = smoothedCols.reduce((m, v) => Math.max(m, v), 0);
    if (!maxCol) continue;
    const colThreshold = Math.max(bandHeight * 0.035, maxCol * 0.16);
    let left = -1;
    let right = -1;
    for (let x = marginX; x < width - marginX; x++) {
      if (smoothedCols[x] >= colThreshold) {
        left = x;
        break;
      }
    }
    for (let x = width - marginX - 1; x >= marginX; x--) {
      if (smoothedCols[x] >= colThreshold) {
        right = x;
        break;
      }
    }
    if (left === -1 || right === -1 || right <= left) continue;
    const rect = expandRect({
      x: left,
      y: range.start,
      width: right - left + 1,
      height: bandHeight
    }, Math.round(width * 0.035), Math.round(height * 0.02), width, height);
    const widthRatio = rect.width / width;
    const heightRatio = rect.height / height;
    if (widthRatio < 0.12 || heightRatio < 0.04 || heightRatio > 0.65) continue;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const distanceX = Math.abs(centerX - width / 2) / (width / 2);
    const distanceY = Math.abs(centerY - height / 2) / (height / 2);
    const centerScore = 1 - Math.min(1, distanceX * 0.7 + distanceY * 1.2);
    const sizeScore = Math.max(0, 1 - Math.abs(heightRatio - 0.18) / 0.18) * 0.6 + Math.max(0, 1 - Math.abs(widthRatio - 0.45) / 0.45) * 0.4;
    const score = centerScore * 0.68 + sizeScore * 0.32;
    if (score > bestScore) {
      bestScore = score;
      bestRect = rect;
    }
  }
  if (!bestRect) return null;
  const scaleX = naturalWidth / width;
  const scaleY = naturalHeight / height;
  return {
    x: Math.round(bestRect.x * scaleX),
    y: Math.round(bestRect.y * scaleY),
    width: Math.round(bestRect.width * scaleX),
    height: Math.round(bestRect.height * scaleY)
  };
}

export function getDefaultCropRect(image: HTMLImageElement): { x: number; y: number; width: number; height: number } | null {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return null;
  return { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
}

export function destroyCropInteractionLayer(): void {
  if (cropInteractionFrame) {
    cancelAnimationFrame(cropInteractionFrame);
    cropInteractionFrame = 0;
  }
  if (cropGestureState) {
    document.removeEventListener("pointermove", updateCropGesture, true);
    document.removeEventListener("pointerup", endCropGesture, true);
    document.removeEventListener("pointercancel", endCropGesture, true);
    const activeElement = cropGestureState.activeElement;
    if (activeElement && cropGestureState.pointerId !== undefined && activeElement.releasePointerCapture) {
      try { activeElement.releasePointerCapture(cropGestureState.pointerId); } catch (e) {}
    }
  }
  cropGestureState = null;
  if (cropInteractionLayer && cropInteractionLayer.parentNode) cropInteractionLayer.parentNode.removeChild(cropInteractionLayer);
  cropInteractionLayer = null;
  cropMoveZone = null;
  cropCornerZones = {};
}

export function queueCropInteractionSync(): void {
  if (!cropper || !cropInteractionLayer) return;
  if (cropInteractionFrame) cancelAnimationFrame(cropInteractionFrame);
  cropInteractionFrame = requestAnimationFrame(() => {
    cropInteractionFrame = 0;
    syncCropInteractionLayer();
  });
}

export function syncCropInteractionLayer(): void {
  if (!cropper || !cropInteractionLayer) return;
  let cropBox: any;
  try { cropBox = cropper.getCropBoxData(); } catch (e) { return; }
  if (!cropBox || !Number.isFinite(cropBox.left) || !Number.isFinite(cropBox.top) || !Number.isFinite(cropBox.width) || !Number.isFinite(cropBox.height)) return;
  const zoneSize = 96;
  const halfZone = zoneSize / 2;
  const positions: Record<string, { left: number; top: number }> = {
    nw: { left: cropBox.left - halfZone, top: cropBox.top - halfZone },
    ne: { left: cropBox.left + cropBox.width - halfZone, top: cropBox.top - halfZone },
    sw: { left: cropBox.left - halfZone, top: cropBox.top + cropBox.height - halfZone },
    se: { left: cropBox.left + cropBox.width - halfZone, top: cropBox.top + cropBox.height - halfZone }
  };
  Object.keys(cropCornerZones).forEach(mode => {
    const el = cropCornerZones[mode];
    const pos = positions[mode];
    if (!el || !pos) return;
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
  });
  if (!cropMoveZone) return;
  const baseInset = clampValue(Math.round(Math.min(cropBox.width, cropBox.height) * 0.18), 16, 28);
  const insetX = Math.min(baseInset, Math.max(0, (cropBox.width - 28) / 2));
  const insetY = Math.min(baseInset, Math.max(0, (cropBox.height - 28) / 2));
  const moveWidth = Math.max(24, cropBox.width - insetX * 2);
  const moveHeight = Math.max(24, cropBox.height - insetY * 2);
  cropMoveZone.style.left = cropBox.left + insetX + "px";
  cropMoveZone.style.top = cropBox.top + insetY + "px";
  cropMoveZone.style.width = moveWidth + "px";
  cropMoveZone.style.height = moveHeight + "px";
}

export function initCropInteractionLayer(): void {
  destroyCropInteractionLayer();
  const container = document.getElementById("crop-container");
  if (!container || !cropper) return;
  const layer = document.createElement("div");
  layer.id = "crop-interaction-layer";
  const zones: Record<string, HTMLElement> = {};
  ["nw", "ne", "sw", "se"].forEach(mode => {
    const el = document.createElement("div");
    el.className = "crop-hit-corner corner-" + mode;
    el.dataset.mode = mode;
    el.addEventListener("pointerdown", onCropGestureStart);
    layer.appendChild(el);
    zones[mode] = el;
  });
  const moveZone = document.createElement("div");
  moveZone.className = "crop-move-zone";
  moveZone.dataset.mode = "move-box";
  moveZone.addEventListener("pointerdown", onCropGestureStart);
  layer.appendChild(moveZone);
  container.appendChild(layer);
  cropInteractionLayer = layer;
  cropMoveZone = moveZone;
  cropCornerZones = zones;
  queueCropInteractionSync();
}

export function onCropGestureStart(event: any): void {
  if (!cropper) return;
  event.preventDefault();
  event.stopPropagation();
  let cropBox: any;
  let canvasBox: any;
  try {
    cropBox = cropper.getCropBoxData();
    canvasBox = cropper.getCanvasData();
  } catch (e) {
    return;
  }
  if (!cropBox || !canvasBox) return;
  cropGestureState = {
    mode: event.currentTarget.dataset.mode,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startBox: {
      left: cropBox.left,
      top: cropBox.top,
      width: cropBox.width,
      height: cropBox.height
    },
    canvasBox: {
      left: canvasBox.left,
      top: canvasBox.top,
      width: canvasBox.width,
      height: canvasBox.height
    },
    activeElement: event.currentTarget
  };
  if (cropInteractionLayer) cropInteractionLayer.classList.add("active");
  event.currentTarget.classList.add("active");
  if (event.currentTarget.setPointerCapture) {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) {}
  }
  document.addEventListener("pointermove", updateCropGesture, true);
  document.addEventListener("pointerup", endCropGesture, true);
  document.addEventListener("pointercancel", endCropGesture, true);
}

export function updateCropGesture(event: any): void {
  if (!cropper || !cropGestureState || event.pointerId !== cropGestureState.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const minSize = 80;
  const edgeMargin = 0;
  const { mode, startX, startY, startBox, canvasBox } = cropGestureState;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  const minLeft = canvasBox.left + edgeMargin;
  const minTop = canvasBox.top + edgeMargin;
  const maxRight = canvasBox.left + canvasBox.width - edgeMargin;
  const maxBottom = canvasBox.top + canvasBox.height - edgeMargin;
  let nextLeft = startBox.left;
  let nextTop = startBox.top;
  let nextWidth = startBox.width;
  let nextHeight = startBox.height;
  if (mode === "move-box") {
    nextLeft = clampValue(startBox.left + dx, minLeft, maxRight - startBox.width);
    nextTop = clampValue(startBox.top + dy, minTop, maxBottom - startBox.height);
  } else if (mode === "nw") {
    const anchorRight = startBox.left + startBox.width;
    const anchorBottom = startBox.top + startBox.height;
    nextLeft = clampValue(startBox.left + dx, minLeft, anchorRight - minSize);
    nextTop = clampValue(startBox.top + dy, minTop, anchorBottom - minSize);
    nextWidth = anchorRight - nextLeft;
    nextHeight = anchorBottom - nextTop;
  } else if (mode === "ne") {
    const anchorLeft = startBox.left;
    const anchorBottom = startBox.top + startBox.height;
    const nextRight = clampValue(startBox.left + startBox.width + dx, anchorLeft + minSize, maxRight);
    nextTop = clampValue(startBox.top + dy, minTop, anchorBottom - minSize);
    nextWidth = nextRight - anchorLeft;
    nextHeight = anchorBottom - nextTop;
  } else if (mode === "sw") {
    const anchorRight = startBox.left + startBox.width;
    const anchorTop = startBox.top;
    nextLeft = clampValue(startBox.left + dx, minLeft, anchorRight - minSize);
    const nextBottom = clampValue(startBox.top + startBox.height + dy, anchorTop + minSize, maxBottom);
    nextWidth = anchorRight - nextLeft;
    nextHeight = nextBottom - anchorTop;
  } else if (mode === "se") {
    const anchorLeft = startBox.left;
    const anchorTop = startBox.top;
    const nextRight = clampValue(startBox.left + startBox.width + dx, anchorLeft + minSize, maxRight);
    const nextBottom = clampValue(startBox.top + startBox.height + dy, anchorTop + minSize, maxBottom);
    nextWidth = nextRight - anchorLeft;
    nextHeight = nextBottom - anchorTop;
  }
  cropper.setCropBoxData({
    left: nextLeft,
    top: nextTop,
    width: nextWidth,
    height: nextHeight
  });
  syncCropInteractionLayer();
}

export function endCropGesture(event: any): void {
  if (!cropGestureState || (event && event.pointerId !== undefined && event.pointerId !== cropGestureState.pointerId)) return;
  document.removeEventListener("pointermove", updateCropGesture, true);
  document.removeEventListener("pointerup", endCropGesture, true);
  document.removeEventListener("pointercancel", endCropGesture, true);
  const activeElement = cropGestureState.activeElement;
  if (activeElement) {
    activeElement.classList.remove("active");
    if (cropGestureState.pointerId !== undefined && activeElement.releasePointerCapture) {
      try { activeElement.releasePointerCapture(cropGestureState.pointerId); } catch (e) {}
    }
  }
  if (cropMoveZone) cropMoveZone.classList.remove("active");
  Object.values(cropCornerZones).forEach(el => { if (el) el.classList.remove("active"); });
  if (cropInteractionLayer) cropInteractionLayer.classList.remove("active");
  cropGestureState = null;
  queueCropInteractionSync();
}

export function createCropperWithRect(image: HTMLImageElement, rect: any, sessionId: number): void {
  const instance = new Cropper(image, {
    viewMode: 0,
    dragMode: "move",
    autoCropArea: 1.0,
    cropBoxMovable: true,
    cropBoxResizable: true,
    background: false,
    modal: true,
    crop() {
      if (sessionId !== cropSessionId) return;
      queueCropInteractionSync();
    },
    ready() {
      if (sessionId !== cropSessionId) return;
      initCropInteractionLayer();
      queueCropInteractionSync();
    }
  });
  cropper = instance;
}

export function isValidCropRect(rect: any): boolean {
  return !!(rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0);
}

export function openCropModal(dataUrl: string, target: string, resolveCrop?: ((v: any) => void) | null, preferredRect?: any): void {
  currentCropTarget = target;
  _cropResolve = resolveCrop || null;
  const ci = document.getElementById("crop-image") as HTMLImageElement;
  document.getElementById("crop-modal")!.classList.add("active");
  destroyCropInteractionLayer();
  if (cropper) { cropper.destroy(); cropper = null; }
  const sessionId = ++cropSessionId;
  ci.onload = null;
  ci.onload = () => {
    if (sessionId !== cropSessionId) return;
    const rect = isValidCropRect(preferredRect) ? preferredRect : getDefaultCropRect(ci);
    if (sessionId !== cropSessionId) return;
    try { createCropperWithRect(ci, rect, sessionId); } catch (e) { console.error(e); }
  };
  ci.src = dataUrl;
}

export function startCrop(target: string, preferredRect?: any): void {
  const d = w.originalImages[target];
  if (!d) { w.showStatus("请先选择图片", "error"); return; }
  const rect = isValidCropRect(preferredRect) ? preferredRect : null;
  openCropModal(d, target, null, rect);
}

export function confirmCrop(): void {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ maxWidth: 2000, maxHeight: 2000, fillColor: "#fff" });
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  document.getElementById("crop-modal")!.classList.remove("active");
  destroyCropInteractionLayer();
  cropper.destroy(); cropper = null;

  // 跨页裁剪模式：通过 Promise 返回
  if (_cropResolve) {
    _cropResolve(dataUrl);
    _cropResolve = null;
    return;
  }

  // 普通裁剪模式：更新预览
  (document.getElementById(currentCropTarget + "-preview") as HTMLImageElement).src = dataUrl;
  document.getElementById(currentCropTarget + "-preview-wrap")!.style.display = "inline-block";
  document.getElementById(currentCropTarget + "-preview-label")!.classList.remove("hidden");
  w.croppedImages[currentCropTarget!] = dataUrl; w.originalImages[currentCropTarget!] = dataUrl;
  if (w.suggestedCropRects[currentCropTarget!] !== undefined) w.suggestedCropRects[currentCropTarget!] = null;
  if (currentCropTarget === 'question') {
    const copyBtn = document.getElementById("copy-q-to-a-btn");
    if (copyBtn) copyBtn.style.display = "";
  }
}

export function cancelCrop(): void {
  document.getElementById("crop-modal")!.classList.remove("active");
  cropSessionId++;
  destroyCropInteractionLayer();
  if (cropper) { cropper.destroy(); cropper = null; }
  (document.getElementById("crop-image") as HTMLImageElement).onload = null;
  if (_cropResolve) { _cropResolve(null); _cropResolve = null; }
}

export function rotateCrop(deg: number): void {
  if (!cropper) return;
  cropper.rotate(deg);
  queueCropInteractionSync();
  setTimeout(queueCropInteractionSync, 0);
}
