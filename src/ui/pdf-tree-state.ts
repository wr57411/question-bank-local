let expandedNodes: string[] = [];
let renderCallback: (() => void) | null = null;

export function getExpanded(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem('pdf_tree_expanded') || '[]');
    expandedNodes = Array.isArray(stored) ? stored : [];
    return expandedNodes;
  } catch {
    return [];
  }
}

export function setExpanded(ids: string[]): void {
  expandedNodes = ids;
  localStorage.setItem('pdf_tree_expanded', JSON.stringify(ids));
}

export function setRenderCallback(fn: () => void): void {
  renderCallback = fn;
}

export function toggleExpand(id: string): void {
  const ids = getExpanded();
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
  setExpanded(ids);
  if (renderCallback) renderCallback();
}
