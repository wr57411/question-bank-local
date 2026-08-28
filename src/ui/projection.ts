/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 投屏模式 ==========

export async function enterProjectionMode() {
    w.projectionNodeList = [];
    for (const n of w.allTeachingNodes) {
        const ver = await w.getCurrentVersion(n);
        if (ver && ver.status === 'VERIFIED') w.projectionNodeList.push(n);
    }
    if (w.projectionNodeList.length === 0) {
        w.showStatus('没有已校验的教学内容', 'error');
        return;
    }
    w.projectionIndex = 0;
    await renderProjection();
    document.getElementById('projection-overlay')!.classList.add('active');
}

export function exitProjectionMode() {
    document.getElementById('projection-overlay')!.classList.remove('active');
}

export async function renderProjection() {
    if (w.projectionNodeList.length === 0) return;
    const node = w.projectionNodeList[w.projectionIndex];
    const ver = await w.getCurrentVersion(node);
    const contentEl = document.getElementById('projection-content')!;
    if (ver && ver.content_markdown) {
        w.renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: node, readOnly: true });
    }
    document.getElementById('proj-nav-info')!.textContent = `${w.projectionIndex + 1} / ${w.projectionNodeList.length}`;
    (document.getElementById('proj-prev-btn') as HTMLButtonElement).disabled = w.projectionIndex === 0;
    (document.getElementById('proj-next-btn') as HTMLButtonElement).disabled = w.projectionIndex === w.projectionNodeList.length - 1;
}

export function projectionPrev() {
    if (w.projectionIndex > 0) {
        w.projectionIndex--;
        renderProjection();
    }
}

export function projectionNext() {
    if (w.projectionIndex < w.projectionNodeList.length - 1) {
        w.projectionIndex++;
        renderProjection();
    }
}

export function initProjectionEvents() {
    // 投屏左右滑动
    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('projection-overlay')!.classList.contains('active')) return;
        if (e.key === 'ArrowLeft') projectionPrev();
        if (e.key === 'ArrowRight') projectionNext();
        if (e.key === 'Escape') exitProjectionMode();
    });

    let touchStartX = 0;
    document.getElementById('projection-overlay')!.addEventListener('touchstart', (e: any) => {
        touchStartX = e.touches[0].clientX;
    });
    document.getElementById('projection-overlay')!.addEventListener('touchend', (e: any) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
            if (dx > 0) projectionPrev(); else projectionNext();
        }
    });
}
