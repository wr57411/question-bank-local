/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 校验界面 ==========

let currentVerifyNodeId: string | null = null;

Object.defineProperty(w, 'currentVerifyNodeId', { get: () => currentVerifyNodeId, set: (v) => { currentVerifyNodeId = v; }, configurable: true });

export async function getVerifyNodeList() {
    const result: any[] = [];
    for (const n of w.allTeachingNodes) {
        const ver = await w.getCurrentVersion(n);
        if (ver && (ver.status === 'GENERATED' || ver.status === 'VERIFIED')) result.push(n);
    }
    return result;
}

export async function openVerifyModal(nodeId: string) {
    const node = w.allTeachingNodes.find((n: any) => n.id === nodeId);
    if (!node) return;
    currentVerifyNodeId = nodeId;
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex((n: any) => n.id === nodeId);
    document.getElementById('verify-title')!.textContent = node.name;
    (document.getElementById('verify-prev-btn') as HTMLButtonElement).disabled = idx <= 0;
    (document.getElementById('verify-next-btn') as HTMLButtonElement).disabled = idx >= verifyList.length - 1;
    const ver = await w.getCurrentVersion(node);
    const contentEl = document.getElementById('verify-content')!;
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    w.isWysiwygEditing = false;
    if (ver && ver.content_markdown) {
        w.renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: node });
    } else {
        contentEl.innerHTML = '<p style="color:var(--text-tertiary)">暂无内容</p>';
    }
    contentEl.style.display = 'block';
    document.getElementById('verify-edit-toolbar')!.style.display = 'none';
    document.getElementById('verify-actions')!.style.display = 'flex';
    document.getElementById('teaching-verify-modal')!.classList.add('active');
    loadLinkedQuestions(nodeId);
}

export async function verifyPrev() {
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex((n: any) => n.id === currentVerifyNodeId);
    if (idx > 0) {
        await openVerifyModal(verifyList[idx - 1].id);
    }
}

export async function verifyNext() {
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex((n: any) => n.id === currentVerifyNodeId);
    if (idx >= 0 && idx < verifyList.length - 1) {
        await openVerifyModal(verifyList[idx + 1].id);
    }
}

// isWysiwygEditing: app.js 用 var 声明已创建 window 属性，直接读写 w.isWysiwygEditing
let wysiwygOriginalHtml = '';

export function toggleVerifyEdit() {
    const contentEl = document.getElementById('verify-content')!;
    const toolbar = document.getElementById('verify-edit-toolbar')!;
    const actionsEl = document.getElementById('verify-actions')!;
    if (w.isWysiwygEditing) {
        cancelWysiwygEdit();
        return;
    }
    wysiwygOriginalHtml = contentEl.innerHTML;
    w.isWysiwygEditing = true;
    contentEl.contentEditable = 'true';
    contentEl.classList.add('wysiwyg-editing');
    toolbar.style.display = 'block';
    actionsEl.style.display = 'none';
    contentEl.querySelectorAll('.katex').forEach(function(el) {
        el.setAttribute('title', '点击编辑公式');
        el.addEventListener('click', handleKatexEdit);
    });
    contentEl.focus();
}

export function handleKatexEdit(e: any) {
    e.stopPropagation();
    e.preventDefault();
    const katexEl = e.target.closest('.katex');
    if (!katexEl) return;
    const annotation = katexEl.querySelector('annotation');
    let latex = annotation ? annotation.textContent : '';
    if (!latex) {
        const mathEl = katexEl.closest('.katex-display');
        if (mathEl) latex = mathEl.getAttribute('data-latex') || '';
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'katex-edit-input';
    input.value = latex;
    input.setAttribute('data-original-latex', latex);
    katexEl.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            finishKatexEdit(input);
        } else if (ev.key === 'Escape') {
            input.value = input.getAttribute('data-original-latex') || '';
            finishKatexEdit(input);
        }
    });
    input.addEventListener('blur', function() { finishKatexEdit(input); });
}

export function finishKatexEdit(input: HTMLInputElement) {
    const latex = input.value.trim();
    const isDisplay = input.parentElement && input.parentElement.classList.contains('katex-display');
    const span = document.createElement('span');
    span.className = 'katex';
    span.setAttribute('title', '点击编辑公式');
    span.addEventListener('click', handleKatexEdit);
    try {
        if (typeof (w as any).katex !== 'undefined') {
            (w as any).katex.render(latex, span, { throwOnError: false, displayMode: isDisplay });
        } else {
            span.textContent = latex;
        }
    } catch (err) {
        span.textContent = latex;
    }
    if (isDisplay) {
        const wrapper = document.createElement('div');
        wrapper.className = 'katex-display';
        wrapper.setAttribute('data-latex', latex);
        wrapper.appendChild(span);
        input.replaceWith(wrapper);
    } else {
        input.replaceWith(span);
    }
}

export function htmlToMarkdown(html: string) {
    const div = document.createElement('div');
    div.innerHTML = html;
    function processNode(node: any): string {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(processNode).join('');
        if (tag === 'katex' || (node.classList && node.classList.contains('katex'))) {
            const ann = node.querySelector('annotation');
            const latex = ann ? ann.textContent : node.textContent;
            const parent = node.closest('.katex-display');
            return parent ? '$$' + latex + '$$' : '$' + latex + '$';
        }
        if (tag === 'annotation') return '';
        const kd = node.querySelector('.katex');
        if (kd && tag === 'div' && node.classList.contains('katex-display')) {
            const ann2 = kd.querySelector('annotation');
            const latex2 = ann2 ? ann2.textContent : (node.getAttribute('data-latex') || kd.textContent);
            return '\n$$' + latex2 + '$$\n';
        }
        switch(tag) {
            case 'h1': return '\n# ' + children.trim() + '\n\n';
            case 'h2': return '\n## ' + children.trim() + '\n\n';
            case 'h3': return '\n### ' + children.trim() + '\n\n';
            case 'p': return children.trim() + '\n\n';
            case 'br': return '\n';
            case 'strong': case 'b': return '**' + children + '**';
            case 'em': case 'i': return '*' + children + '*';
            case 'code': return '`' + children + '`';
            case 'pre': return '\n```\n' + node.textContent + '\n```\n\n';
            case 'blockquote': return children.trim().split('\n').map(function(l: string){return '> '+l}).join('\n') + '\n\n';
            case 'ul': return '\n' + children + '\n';
            case 'ol': return '\n' + children + '\n';
            case 'li': return '- ' + children.trim() + '\n';
            case 'a': { const href = node.getAttribute('href') || ''; return '[' + children + '](' + href + ')'; }
            case 'img': { const src = node.getAttribute('src') || ''; const alt = node.getAttribute('alt') || ''; return '![' + alt + '](' + src + ')'; }
            case 'table': return '\n' + processTable(node) + '\n\n';
            case 'hr': return '\n---\n\n';
            case 'div':
                if (node.classList && node.classList.contains('draw-placeholder')) {
                    const drawId = node.getAttribute('data-draw-id') || 'unknown';
                    const descEl = node.querySelector('.draw-placeholder-desc');
                    const desc = descEl ? descEl.textContent.replace('🎨 ', '') : '';
                    return '\n[DRAW:id=' + drawId + ':' + desc + ']\n';
                }
                return children;
            default: return children;
        }
    }
    function processTable(table: any) {
        const rows = table.querySelectorAll('tr');
        if (!rows.length) return '';
        const result: string[] = [];
        rows.forEach(function(row: any, i: number) {
            const cells = Array.from(row.querySelectorAll('th,td')).map(function(c: any){return c.textContent.trim()});
            result.push('| ' + cells.join(' | ') + ' |');
            if (i === 0) result.push('| ' + cells.map(function(){return '---'}).join(' | ') + ' |');
        });
        return result.join('\n');
    }
    let md = Array.from(div.childNodes).map(processNode).join('');
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
}

export async function saveWysiwygEdit() {
    const contentEl = document.getElementById('verify-content')!;
    const node = w.allTeachingNodes.find((n: any) => n.id === currentVerifyNodeId);
    if (!node) return;
    const ver = await w.getCurrentVersion(node);
    if (!ver) return;
    const md = htmlToMarkdown(contentEl.innerHTML);
    await w.dbUpdateVersion(ver.id, { content_markdown: md, status: 'GENERATED' });
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    document.getElementById('verify-edit-toolbar')!.style.display = 'none';
    document.getElementById('verify-actions')!.style.display = 'flex';
    w.isWysiwygEditing = false;
    await w.renderTeachingStats();
    await w.renderTeachingNodeList();
    await openVerifyModal(node.id);
    w.showStatus('内容已保存', 'success');
}

export function cancelWysiwygEdit() {
    const contentEl = document.getElementById('verify-content')!;
    contentEl.innerHTML = wysiwygOriginalHtml;
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    document.getElementById('verify-edit-toolbar')!.style.display = 'none';
    document.getElementById('verify-actions')!.style.display = 'flex';
    w.isWysiwygEditing = false;
}

export function closeVerifyModal() {
    document.getElementById('teaching-verify-modal')!.classList.remove('active');
    currentVerifyNodeId = null;
}

export async function verifyApprove() {
    if (!currentVerifyNodeId) return;
    const ver = await w.getCurrentVersion(await w.dbGetTeachingNode(currentVerifyNodeId));
    if (ver) {
        await w.dbUpdateVersion(ver.id, { status: 'VERIFIED' });
    }
    await w.renderTeachingStats();
    await w.renderTeachingNodeList();
    closeVerifyModal();
    w.showStatus('已通过校验', 'success');
}

export async function verifyRegenerate() {
    if (!currentVerifyNodeId) return;
    const nodeId = currentVerifyNodeId;
    closeVerifyModal();
    await w.regenerateNode(nodeId);
}

// ========== 知识点关联题库 ==========

export async function loadLinkedQuestions(nodeId: string) {
    const linked = await w.dbGetNodeQuestions(nodeId);
    const container = document.getElementById('verify-linked-questions')!;
    if (!linked.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.style.display = 'block';
    container.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px">已关联题目：</div>' +
        linked.map((nq: any) => {
            const q = nq.question_data;
            const thumb = q.question_image_url ? `<img src="${q.question_image_url}" style="width:48px;height:48px;object-fit:contain;border-radius:4px;background:var(--surface-dim)">` : '<div style="width:48px;height:48px;background:var(--surface-dim);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-tertiary)">无图</div>';
            const label = q.semantic_summary || q.user_comment || nq.module;
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-light)">
                ${thumb}
                <div style="flex:1;font-size:12px;color:var(--text)">${label}<br><span style="color:var(--text-tertiary)">${nq.module} · #${nq.order}</span></div>
                <button onclick="unlinkQuestionFromNode('${nq.id}','${nq.question_id}')" style="font-size:11px;padding:2px 8px;background:var(--danger);color:#fff;border:none;border-radius:4px;cursor:pointer">移除</button>
            </div>`;
        }).join('');
}

export async function unlinkQuestionFromNode(linkId: string, questionId: string) {
    if (!currentVerifyNodeId) return;
    const links = await w.dbGetNodeQuestions(currentVerifyNodeId);
    const link = links.find((l: any) => l.id === linkId);
    if (link) {
        await w.dbUnlinkQuestionFromNode(currentVerifyNodeId, questionId);
        await loadLinkedQuestions(currentVerifyNodeId);
        w.showStatus('已移除关联', 'info');
    }
}

export function openNodeQuestionPicker() {
    if (!currentVerifyNodeId) return;
    const container = document.getElementById('node-question-picker-list')!;
    container.innerHTML = '';
    if (!w.allQuestions || !w.allQuestions.length) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px">题库为空，请先添加题目</div>';
    } else {
        w.allQuestions.forEach((q: any) => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border-light);cursor:pointer';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = 'node_questions';
            cb.value = q.id;
            cb.style.cssText = 'accent-color:var(--primary)';
            const img = document.createElement('img');
            img.src = q.question_image_url || '';
            img.style.cssText = 'width:40px;height:40px;object-fit:contain;border-radius:4px;background:var(--surface-dim)';
            if (!q.question_image_url) img.style.visibility = 'hidden';
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;font-size:13px;color:var(--text)';
            info.textContent = q.semantic_summary || q.user_comment || (q.question_tags && q.question_tags.length ? q.question_tags.map((qt: any) => qt.tags?.name).filter(Boolean).join('、') : '') || '题目 ' + q.id.substring(0, 8);
            label.append(cb, img, info);
            container.appendChild(label);
        });
    }
    document.getElementById('node-question-picker-modal')!.classList.add('active');
}

export function closeNodeQuestionPicker() {
    document.getElementById('node-question-picker-modal')!.classList.remove('active');
}

export async function confirmNodeQuestionLinks() {
    if (!currentVerifyNodeId) return;
    const selected = Array.from(document.querySelectorAll('input[name="node_questions"]:checked')).map((cb: any) => cb.value);
    const module = (document.getElementById('nq-module-select') as HTMLSelectElement).value;
    const existing = await w.dbGetNodeQuestions(currentVerifyNodeId);
    const existingIds = new Set(existing.map((nq: any) => nq.question_id));
    let added = 0;
    for (const qId of selected) {
        if (!existingIds.has(qId)) {
            const maxOrder = existing.reduce((max: number, nq: any) => nq.module === module ? Math.max(max, nq.order || 0) : max, 0);
            await w.dbLinkQuestionToNode(currentVerifyNodeId, qId, module, maxOrder + 1);
            added++;
        }
    }
    closeNodeQuestionPicker();
    await loadLinkedQuestions(currentVerifyNodeId);
    if (added > 0) w.showStatus(`已关联 ${added} 道题目到「${module}」`, 'success');
    else w.showStatus('没有新增关联', 'info');
}
