import { escapeHtml } from './common';
import DOMPurify from 'dompurify';

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
        errorColor: '#cc0000',
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
