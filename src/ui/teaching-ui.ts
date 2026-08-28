/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 教学模块 UI ==========

let allTeachingNodes: any[] = [];

Object.defineProperty(w, 'allTeachingNodes', { get: () => allTeachingNodes, set: (v) => { allTeachingNodes = v; }, configurable: true });

export async function loadTeachingView() {
    const migrated = await w.migrateTeachingNodesToVersions();
    if (migrated > 0) console.log(`[Teaching] 迁移了 ${migrated} 个节点到多版本模式`);
    allTeachingNodes = await w.dbGetAllTeachingNodes();
    // 断点续传：将上次中断的 GENERATING 状态重置为 PENDING
    let resetCount = 0;
    for (const node of allTeachingNodes) {
        const ver = await getCurrentVersion(node);
        if (ver && ver.status === 'GENERATING') {
            await w.dbUpdateVersion(ver.id, { status: 'PENDING', error_msg: null });
            resetCount++;
        }
    }
    if (resetCount > 0) {
        w.showStatus(`已恢复 ${resetCount} 个中断的生成任务`, 'info');
    }
    renderTeachingStats();
    renderTeachingNodeList();
    w.updateTeachingSelectedCount();
    const hasNodes = allTeachingNodes.length > 0;
    document.getElementById('teaching-queue-card')!.style.display = hasNodes ? 'block' : 'none';
    document.getElementById('teaching-project-entry')!.style.display = hasNodes ? 'block' : 'none';
}

export async function getCurrentVersion(node: any) {
    if (!node.current_version_id) return null;
    return await w.dbGetVersion(node.current_version_id);
}

export async function getNodeVersions(node: any) {
    return await w.dbGetVersionsByNode(node.id);
}

export async function renderTeachingStats() {
    const counts: any = { PENDING: 0, GENERATING: 0, GENERATED: 0, VERIFIED: 0, ERROR: 0 };
    for (const n of allTeachingNodes) {
        const ver = await getCurrentVersion(n);
        if (ver && counts[ver.status] !== undefined) counts[ver.status]++;
    }
    document.getElementById('stat-pending')!.textContent = counts.PENDING;
    document.getElementById('stat-generating')!.textContent = counts.GENERATING;
    document.getElementById('stat-generated')!.textContent = counts.GENERATED;
    document.getElementById('stat-verified')!.textContent = counts.VERIFIED;
    document.getElementById('stat-error')!.textContent = counts.ERROR;
}

export async function renderTeachingNodeList() {
    const container = document.getElementById('teaching-node-list')!;
    if (allTeachingNodes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:20px">暂无知识点，请先拆解章节</p>';
        return;
    }
    const nodeStatuses: any = {};
    const nodeVersions: any = {};
    for (const node of allTeachingNodes) {
        const versions = await getNodeVersions(node);
        nodeVersions[node.id] = versions;
        const curVer = versions.find((v: any) => v.is_current) || versions[versions.length - 1];
        nodeStatuses[node.id] = curVer ? curVer.status : 'PENDING';
    }
    // Group by chapter
    const chapterGroups: any = {};
    for (const node of allTeachingNodes) {
        const ch = node.chapter || '未分类';
        if (!chapterGroups[ch]) chapterGroups[ch] = [];
        chapterGroups[ch].push(node);
    }
    // Sort chapter keys: extract book + chapter number
    const chapterKeys = Object.keys(chapterGroups).sort((a, b) => {
        const bookA = a.match(/必修(.)/)?.[1] || a.match(/选修(.)/)?.[1] || 'z';
        const bookB = b.match(/必修(.)/)?.[1] || b.match(/选修(.)/)?.[1] || 'z';
        if (bookA !== bookB) return bookA.localeCompare(bookB);
        const chA = a.match(/第(.+?)章/)?.[1] || '';
        const chB = b.match(/第(.+?)章/)?.[1] || '';
        const numOrder = ['一','二','三','四','五','六','七','八','九','十'];
        return (numOrder.indexOf(chA) === -1 ? 99 : numOrder.indexOf(chA)) - (numOrder.indexOf(chB) === -1 ? 99 : numOrder.indexOf(chB));
    });

    let html = '';
    for (const ch of chapterKeys) {
        const nodes = chapterGroups[ch];
        const statusOrder: any = { GENERATING: 0, PENDING: 1, ERROR: 2, GENERATED: 3, VERIFIED: 4 };
        nodes.sort((a: any, b: any) => (statusOrder[nodeStatuses[a.id]] ?? 9) - (statusOrder[nodeStatuses[b.id]] ?? 9));
        const counts: any = {};
        nodes.forEach((n: any) => { const s = nodeStatuses[n.id]; counts[s] = (counts[s] || 0) + 1; });
        const summaryParts: string[] = [];
        if (counts.PENDING) summaryParts.push(`${counts.PENDING} 待生成`);
        if (counts.GENERATED) summaryParts.push(`${counts.GENERATED} 待校验`);
        if (counts.VERIFIED) summaryParts.push(`${counts.VERIFIED} 已完成`);
        if (counts.ERROR) summaryParts.push(`${counts.ERROR} 错误`);
        const summaryText = summaryParts.join(' · ');

        html += `<details class="chapter-group" open style="margin-bottom:12px;border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden">
            <summary style="padding:10px 14px;background:var(--surface);cursor:pointer;font-size:13px;font-weight:600;color:var(--primary);display:flex;justify-content:space-between;align-items:center;user-select:none">
                <span>${ch} (${nodes.length})</span>
                <span style="font-size:11px;font-weight:400;color:var(--text-tertiary)">${summaryText}</span>
            </summary>
            <div style="padding:6px">`;

        for (const node of nodes) {
            const status = nodeStatuses[node.id];
            const versions = nodeVersions[node.id] || [];
            const curVer = versions.find((v: any) => v.is_current) || versions[versions.length - 1];
            const statusText = ({ PENDING: '待生成', GENERATING: '生成中', GENERATED: '待校验', VERIFIED: '已完成', ERROR: '错误' } as any)[status] || status;
            const verCount = versions.length;
            const verLabel = verCount > 1 ? `v${curVer?.version_num || 1}/${verCount}` : `v${curVer?.version_num || 1}`;
            const showCheckbox = status === 'PENDING' || status === 'ERROR';
            const checkbox = showCheckbox ? `<input type="checkbox" class="node-select-cb" data-node-id="${node.id}" onchange="updateTeachingSelectedCount()" style="width:18px;height:18px;margin-right:6px;flex-shrink:0" />` : '<div style="width:24px;flex-shrink:0"></div>';
            let actions = '';
            if (status === 'GENERATED') {
                actions = `<button onclick="openVerifyModal('${node.id}')" style="background:var(--primary)">查看</button>`;
            } else if (status === 'VERIFIED') {
                actions = `<button onclick="openVerifyModal('${node.id}')" style="background:var(--primary)">查看</button><button onclick="addNewVersion('${node.id}')" class="secondary" title="增加新版本">+v</button>`;
            } else if (status === 'ERROR') {
                actions = `<button onclick="regenerateNode('${node.id}')" style="background:var(--danger)">重试</button>`;
            } else if (status === 'PENDING') {
                actions = `<button onclick="deleteTeachingNode('${node.id}')" class="secondary" style="background:var(--danger)">🗑</button>`;
            }
            if (verCount > 0 && status !== 'PENDING') {
                actions += `<button onclick="showVersionSwitcher('${node.id}')" class="secondary" title="切换版本">${verLabel}</button>`;
            }
            const errorInfo = status === 'ERROR' && curVer?.error_msg ? ` · ${curVer.error_msg.substring(0, 40)}` : '';
            const diagramThumb = node.diagram ? `<div class="node-diagram-thumb" onclick="event.stopPropagation();showNodeDiagram('${node.id}')" title="查看示意图">${node.diagram.startsWith('<svg') ? node.diagram : '<img src="' + node.diagram + '" style="width:100%;height:100%;object-fit:contain" />'}</div>` : '';
            html += `<div class="teaching-node-card" data-node-id="${node.id}">
                ${checkbox}
                ${diagramThumb}
                <div class="teaching-node-info">
                    <div class="teaching-node-name">${node.name}</div>
                    <div class="teaching-node-meta">${node.difficulty}${errorInfo}</div>
                </div>
                <span class="status-badge status-${status}">${statusText}</span>
                <div class="teaching-node-actions">${actions}</div>
            </div>`;
        }
        html += '</div></details>';
    }
    container.innerHTML = html;
}

export async function showNodeDiagram(nodeId: string) {
    const node = await w.dbGetTeachingNode(nodeId);
    if (!node || !node.diagram) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:90vw;max-height:80vh;overflow:auto;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    box.innerHTML = '<div style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--text)">' + node.name + ' - 示意图</div>' +
        '<div style="min-width:200px;min-height:150px;display:flex;align-items:center;justify-content:center">' +
        (node.diagram.startsWith('<svg') ? node.diagram : '<img src="' + node.diagram + '" style="max-width:100%;max-height:60vh" />') +
        '</div>' +
        '<div style="margin-top:12px;font-size:11px;color:var(--text-tertiary)">点击空白处关闭 · 手绘功能在校验弹窗中使用</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

export async function atomizeChapter() {
    const chapter = (document.getElementById('teaching-chapter-input') as HTMLInputElement).value.trim();
    if (!chapter) {
        w.showStatus('请输入章节名称', 'error');
        return;
    }
    const provider = w.getCurrentProvider();
    if (!provider) {
        w.showStatus('请先添加并选择一个模型服务商', 'error');
        return;
    }

    const mode = (document.getElementById('atomize-mode-select') as HTMLSelectElement).value;
    const btn = document.getElementById('atomize-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = mode === 'multimodal' ? '图文拆解中...' : '拆解中...';

    try {
        let parsed: any = null;

        if (mode === 'multimodal') {
            let retryCount = 0;
            const maxRetries = 2;
            while (retryCount < maxRetries && !parsed) {
                const isRetry = retryCount > 0;
                const promptText = isRetry
                    ? `上一次返回的内容无法解析为合法JSON。请重新拆解章节【${chapter}】，只输出纯JSON数组（含 diagram 字段），不要任何markdown标记或解释文字。`
                    : `请拆解章节：【${chapter}】`;
                btn.textContent = isRetry ? `JSON解析失败，重试(${retryCount}/${maxRetries})...` : '图文拆解中...';
                const result = await w.callCloudAIMultimodal(promptText, {
                    systemPrompt: w.KNOWLEDGE_ATOMIZER_PROMPT_MULTIMODAL,
                    temperature: isRetry ? 0.3 : 0.5
                });
                const textToParse = result.text || '';
                parsed = w.safeParseJSON(textToParse);
                if (!parsed) {
                    console.warn(`[atomizeChapter:multimodal] 第${retryCount + 1}次解析失败，AI返回前300字:`, textToParse.substring(0, 300));
                    retryCount++;
                }
            }
        } else {
            let resultText = '';
            let retryCount = 0;
            const maxRetries = 3;
            while (retryCount < maxRetries && !parsed) {
                const isRetry = retryCount > 0;
                const promptText = isRetry
                    ? `上一次返回的内容无法解析为合法JSON。请重新拆解章节【${chapter}】，只输出纯JSON数组，不要任何markdown标记或解释文字。`
                    : `请拆解章节：【${chapter}】`;
                btn.textContent = isRetry ? `JSON解析失败，重试(${retryCount}/${maxRetries})...` : '拆解中...';
                resultText = await w.callCloudAIStream(
                    promptText,
                    (chunk: string, full: string) => { btn.textContent = (isRetry ? `重试(${retryCount}/${maxRetries}) ` : '拆解中... ') + full.length + '字'; },
                    { systemPrompt: w.KNOWLEDGE_ATOMIZER_PROMPT, temperature: isRetry ? 0.3 : 0.5 }
                );
                parsed = w.safeParseJSON(resultText);
                if (!parsed) {
                    console.warn(`[atomizeChapter] 第${retryCount + 1}次解析失败，AI返回前300字:`, resultText.substring(0, 300));
                    retryCount++;
                }
            }
        }

        if (!parsed || !Array.isArray(parsed)) {
            throw new Error('AI返回的内容无法解析为JSON数组');
        }

        let created = 0;
        let withDiagram = 0;
        for (const item of parsed) {
            if (!item.name) continue;
            const diagram = item.diagram || '';
            if (diagram) withDiagram++;
            const node = await w.dbCreateTeachingNode({
                chapter,
                subject: '物理',
                name: item.name,
                difficulty: item.difficulty || '基础',
                key_concept: item.key_concept || '',
                diagram
            });
            await w.dbCreateVersion(node.id, { version_num: 1, status: 'PENDING', is_current: true });
            created++;
        }

        const diagramInfo = withDiagram > 0 ? `，其中 ${withDiagram} 个带示意图` : '';
        w.showStatus(`已拆解出 ${created} 个知识点${diagramInfo}`, 'success');
        await loadTeachingView();
    } catch (e: any) {
        w.showStatus('拆解失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 拆解';
    }
}
