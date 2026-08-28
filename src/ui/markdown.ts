/* eslint-disable @typescript-eslint/no-explicit-any */
import { escapeHtml } from './common';
import DOMPurify from 'dompurify';

const w = window as any;

declare const marked: { parse: (text: string) => string };
declare function renderMathInElement(el: HTMLElement, options: Record<string, unknown>): void;

export interface RenderMarkdownOptions {
  drawings?: Record<string, { data?: string }>;
  readOnly?: boolean;
  node?: unknown;
}

export function renderMarkdown(mdText: string, containerEl: HTMLElement, options: RenderMarkdownOptions = {}): void {
  const drawings = options.drawings || {};
  const readOnly = options.readOnly || false;

  try {
    let html = marked.parse(mdText || '');

    html = html.replace(/\[DRAW:id=([^:\]]+):([^\]]+)\]/g, (_m: string, id: string, desc: string) => {
      return buildDrawHTML(id, desc.trim(), drawings, readOnly);
    });
    html = html.replace(/\[绘图占位[：:]([^\]]+)\]/g, (_m: string, desc: string) => {
      const id = 'draw_' + Math.random().toString(36).substr(2, 6);
      return buildDrawHTML(id, desc.trim(), drawings, readOnly);
    });

    containerEl.innerHTML = DOMPurify.sanitize(html, {
      ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac'],
      ADD_ATTR: ['xmlns', 'display', 'class']
    });

    if (typeof renderMathInElement === 'function') {
      renderMathInElement(containerEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
        errorColor: 'var(--danger)',
        strict: false,
      });
    }
  } catch (e) {
    console.error('renderMarkdown 失败:', e);
    containerEl.textContent = mdText || '';
  }
}

function buildDrawHTML(id: string, desc: string, drawings: Record<string, { data?: string }>, readOnly: boolean): string {
  const d = drawings[id];
  if (d && d.data) {
    return '<div class="draw-placeholder" data-draw-id="' + escapeHtml(id) + '">' +
      '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + escapeHtml(desc) + '</span></div>' +
      '<img class="draw-saved-img" src="' + d.data + '" data-draw-id="' + escapeHtml(id) + '" data-draw-desc="' + escapeHtml(desc) + '" />' +
      '</div>';
  }
  return '<div class="draw-placeholder" data-draw-id="' + escapeHtml(id) + '">' +
    '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + escapeHtml(desc) + '</span>' +
    (readOnly ? '' : '<div class="draw-toolbar"><button class="draw-init-btn">✏️ 手绘</button></div>') +
    '</div>' +
    '<div class="draw-canvas-wrap" data-draw-id="' + escapeHtml(id) + '" data-draw-desc="' + escapeHtml(desc) + '"></div>' +
    '</div>';
}

// ========== Drawing Canvas ==========

let drawState: any = null;

export function _buildDrawHTML(id: string, desc: string, drawings: any, readOnly: boolean): string {
  const d = drawings[id];
  if (d && d.data) {
    return '<div class="draw-placeholder" data-draw-id="' + id + '">' +
      '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + w.escapeHtml(desc) + '</span></div>' +
      '<img class="draw-saved-img" src="' + d.data + '" data-draw-id="' + id + '" data-draw-desc="' + w.escapeHtml(desc) + '" />' +
      '</div>';
  }
  return '<div class="draw-placeholder" data-draw-id="' + id + '">' +
    '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + w.escapeHtml(desc) + '</span>' +
    (readOnly ? '' : '<div class="draw-toolbar"><button class="draw-init-btn">✏️ 手绘</button></div>') +
    '</div>' +
    '<div class="draw-canvas-wrap" data-draw-id="' + id + '" data-draw-desc="' + w.escapeHtml(desc) + '"></div>' +
    '</div>';
}

export function initDrawCanvas(wrapEl: HTMLElement, drawId: string, desc: string, existingImgSrc?: string): void {
  wrapEl.innerHTML = '';
  const width = wrapEl.offsetWidth || (wrapEl.parentElement ? wrapEl.parentElement.offsetWidth - 4 : 300) || 300;
  const h = 220;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(width, 1200);
  canvas.height = h;
  canvas.style.width = '100%';
  canvas.style.height = h + 'px';
  wrapEl.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (existingImgSrc) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = existingImgSrc;
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'draw-toolbar';
  toolbar.style.padding = '6px 8px';
  toolbar.innerHTML = '<button data-c="#000" class="active">⚫</button><button data-c="#E63946">🔴</button><button data-c="#2563EB">🔵</button><button data-c="#16A34A">🟢</button><span style="width:8px"></span><button data-w="2">细</button><button data-w="4" class="active">中</button><button data-w="6">粗</button><span style="width:8px"></span><button data-mode="erase">橡皮</button><button data-act="undo">撤销</button><button data-act="clear">清空</button><span style="flex:1"></span><button data-act="save" style="background:var(--primary);color:#fff">保存</button><button data-act="cancel" style="background:var(--danger);color:#fff">取消</button>';
  wrapEl.insertBefore(toolbar, canvas);
  drawState = { canvas, ctx, drawId, desc, color: '#000', width: 4, mode: 'draw', paths: [] as any[], currentPath: null as any, drawing: false, lastX: 0, lastY: 0 };
  toolbar.querySelectorAll('button[data-c]').forEach((btn: any) => { btn.addEventListener('click', () => { drawState.color = btn.getAttribute('data-c'); drawState.mode = 'draw'; toolbar.querySelectorAll('button[data-c],button[data-mode]').forEach((b: any) => b.classList.remove('active')); btn.classList.add('active'); }); });
  toolbar.querySelectorAll('button[data-w]').forEach((btn: any) => { btn.addEventListener('click', () => { drawState.width = parseInt(btn.getAttribute('data-w')); toolbar.querySelectorAll('button[data-w]').forEach((b: any) => b.classList.remove('active')); btn.classList.add('active'); }); });
  toolbar.querySelector('button[data-mode="erase"]')!.addEventListener('click', function(this: any) { drawState.mode = drawState.mode === 'erase' ? 'draw' : 'erase'; toolbar.querySelectorAll('button[data-c],button[data-mode]').forEach((b: any) => b.classList.remove('active')); if (drawState.mode === 'erase') this.classList.add('active'); else toolbar.querySelector('button[data-c="#000"]')!.classList.add('active'); });
  toolbar.querySelector('button[data-act="undo"]')!.addEventListener('click', () => { if (drawState.paths.length > 0) { drawState.paths.pop(); redrawCanvas(); } });
  toolbar.querySelector('button[data-act="clear"]')!.addEventListener('click', () => { drawState.paths = []; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
  toolbar.querySelector('button[data-act="save"]')!.addEventListener('click', () => { saveDrawing(drawId, desc); });
  toolbar.querySelector('button[data-act="cancel"]')!.addEventListener('click', () => { cancelDraw(wrapEl, drawId, desc); });
  function getPos(e: any) { const rect = canvas.getBoundingClientRect(); const sx = canvas.width / rect.width; const sy = canvas.height / rect.height; let cx: number, cy: number; if (e.touches && e.touches[0]) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; } else { cx = e.clientX; cy = e.clientY; } return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy }; }
  function startDraw(e: any) { e.preventDefault(); drawState.drawing = true; const p = getPos(e); drawState.lastX = p.x; drawState.lastY = p.y; drawState.currentPath = { color: drawState.color, width: drawState.width, mode: drawState.mode, points: [{ x: p.x, y: p.y }] }; }
  function moveDraw(e: any) { if (!drawState.drawing) return; e.preventDefault(); const p = getPos(e); const ctx2 = drawState.ctx; ctx2.beginPath(); ctx2.moveTo(drawState.lastX, drawState.lastY); ctx2.lineTo(p.x, p.y); if (drawState.mode === 'erase') { ctx2.strokeStyle = '#fff'; ctx2.lineWidth = drawState.width * 3; } else { ctx2.strokeStyle = drawState.color; ctx2.lineWidth = drawState.width; } ctx2.lineCap = 'round'; ctx2.lineJoin = 'round'; ctx2.stroke(); drawState.lastX = p.x; drawState.lastY = p.y; drawState.currentPath.points.push({ x: p.x, y: p.y }); }
  function endDraw(e: any) { if (!drawState.drawing) return; e.preventDefault(); drawState.drawing = false; if (drawState.currentPath && drawState.currentPath.points.length > 0) { drawState.paths.push(drawState.currentPath); } drawState.currentPath = null; }
  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', moveDraw);
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointerleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw, { passive: false });
  function redrawCanvas() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); for (const path of drawState.paths) { ctx.beginPath(); ctx.strokeStyle = path.mode === 'erase' ? '#fff' : path.color; ctx.lineWidth = path.mode === 'erase' ? path.width * 3 : path.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (let j = 0; j < path.points.length; j++) { const pt = path.points[j]; if (j === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); } ctx.stroke(); } }
}

export async function saveDrawing(drawId: string, desc: string): Promise<void> {
  if (!drawState || !w.currentDrawNode) return;
  const canvas = drawState.canvas;
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const ver = await w.getCurrentVersion(w.currentDrawNode);
    if (!ver) return;
    if (!ver.drawings) ver.drawings = {};
    ver.drawings[drawId] = { data: dataUrl, desc, width: canvas.width, height: canvas.height };
    await w.dbUpdateVersion(ver.id, { drawings: ver.drawings });
    const contentEl = document.getElementById('verify-content');
    const projContentEl = document.getElementById('projection-content');
    if (contentEl && contentEl.style.display !== 'none') { w.renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: w.currentDrawNode }); }
    if (projContentEl && document.getElementById('projection-overlay')!.classList.contains('active')) { w.renderMarkdown(ver.content_markdown, projContentEl, { drawings: ver.drawings || {}, node: w.currentDrawNode, readOnly: true }); }
    w.showStatus('手绘图已保存', 'success');
  } catch (e: any) { console.error('saveDrawing failed:', e); w.showStatus('手绘图保存失败: ' + e.message, 'error'); }
}

export function cancelDraw(wrapEl: HTMLElement, drawId: string, desc: string): void {
  if (!w.currentDrawNode) return;
  const drawings = w.currentDrawNode.drawings || {};
  const existing = drawings[drawId];
  if (existing && existing.data) {
    wrapEl.innerHTML = '<img class="draw-saved-img" src="' + existing.data + '" data-draw-id="' + drawId + '" data-draw-desc="' + w.escapeHtml(desc) + '" />';
    wrapEl.querySelector('img')!.addEventListener('click', function(this: HTMLImageElement) { initDrawCanvas(wrapEl, drawId, desc, this.src); });
  } else { wrapEl.innerHTML = ''; }
  drawState = null;
}
