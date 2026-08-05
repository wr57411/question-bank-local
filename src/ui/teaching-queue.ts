/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 任务队列引擎 ==========

export class TeachingTaskQueue {
    maxConcurrency: number;
    isRunning: boolean;
    activeCount: number;
    totalProcessed: number;
    totalToProcess: number;
    selectedIds: string[];

    constructor(maxConcurrency = 2) {
        this.maxConcurrency = maxConcurrency;
        this.isRunning = false;
        this.activeCount = 0;
        this.totalProcessed = 0;
        this.totalToProcess = 0;
        this.selectedIds = [];
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        document.getElementById('batch-start-btn')!.style.display = 'none';
        document.getElementById('batch-pause-btn')!.style.display = 'inline-block';
        document.getElementById('teaching-progress-wrap')!.style.display = 'block';
        this._scheduleNext();
    }

    pause() {
        this.isRunning = false;
        document.getElementById('batch-start-btn')!.style.display = 'inline-block';
        (document.getElementById('batch-start-btn') as HTMLButtonElement).textContent = '▶ 继续';
        document.getElementById('batch-pause-btn')!.style.display = 'none';
    }

    async _scheduleNext() {
        if (!this.isRunning) return;
        if (this.activeCount >= this.maxConcurrency) return;
        let nextNode: any = null;
        for (const n of w.allTeachingNodes) {
            if (this.selectedIds.length > 0 && !this.selectedIds.includes(n.id)) continue;
            const ver = await w.getCurrentVersion(n);
            if (ver && ver.status === 'PENDING') {
                nextNode = n;
                break;
            }
        }
        if (!nextNode) {
            if (this.activeCount === 0) {
                this.isRunning = false;
                document.getElementById('batch-start-btn')!.style.display = 'inline-block';
                (document.getElementById('batch-start-btn') as HTMLButtonElement).textContent = '▶ 生成选中';
                document.getElementById('batch-pause-btn')!.style.display = 'none';
                if (this.totalProcessed > 0) {
                    w.showStatus(`批量生成完成，共处理 ${this.totalProcessed} 个知识点`, 'success');
                }
            }
            return;
        }
        this.activeCount++;
        this._processNode(nextNode).finally(() => {
            this.activeCount--;
            this._scheduleNext();
        });
        this._scheduleNext();
    }

    async _processNode(node: any) {
        const ver = await w.getCurrentVersion(node);
        if (!ver) return;
        await w.dbUpdateVersion(ver.id, { status: 'GENERATING', error_msg: null });
        await w.renderTeachingStats();
        await w.renderTeachingNodeList();

        let retryCount = 0;
        const maxRetries = 3;
        let lastError: any = null;
        let fullText = '';

        while (retryCount < maxRetries) {
            try {
                fullText = '';
                const provider = w.getCurrentProvider();
                const result = await w.callCloudAIStream(
                    `请生成关于【${node.name}】的教学内容。${node.key_concept ? '核心概念：' + node.key_concept : ''}`,
                    (chunk: string, full: string) => {
                        fullText = full;
                        this._updateNodeProgress(node.id, full);
                    },
                    { systemPrompt: w.TEACHING_GENERATOR_PROMPT, temperature: 0.7 }
                );

                if (!result || result.trim().length < 50) {
                    throw new Error('生成内容过短');
                }

                await w.dbUpdateVersion(ver.id, {
                    status: 'GENERATED',
                    content_markdown: result,
                    content_json: null,
                    error_msg: null,
                    retry_count: retryCount,
                    model_name: provider ? provider.model : ''
                });
                this.totalProcessed++;
                await this._updateProgress();
                await w.renderTeachingStats();
                await w.renderTeachingNodeList();
                return;
            } catch (e: any) {
                lastError = e;
                retryCount++;
                if (retryCount < maxRetries) {
                    await w.dbUpdateVersion(ver.id, { retry_count: retryCount });
                    console.warn(`[TeachingQueue] 节点 ${node.name} 第${retryCount}次重试:`, e.message);
                }
            }
        }

        await w.dbUpdateVersion(ver.id, {
            status: 'ERROR',
            error_msg: lastError ? lastError.message.substring(0, 100) : '未知错误',
            retry_count: retryCount
        });
        this.totalProcessed++;
        await this._updateProgress();
        await w.renderTeachingStats();
        await w.renderTeachingNodeList();
    }

    _updateNodeProgress(nodeId: string, fullText: string) {
        const card = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (card) {
            const meta = card.querySelector('.teaching-node-meta');
            if (meta) meta.textContent = `生成中... ${fullText.length}字`;
        }
    }

    async _updateProgress() {
        const total = this.selectedIds.length > 0 ? this.selectedIds.length : w.allTeachingNodes.length;
        let done = 0;
        for (const n of w.allTeachingNodes) {
            if (this.selectedIds.length > 0 && !this.selectedIds.includes(n.id)) continue;
            const ver = await w.getCurrentVersion(n);
            if (ver && (ver.status === 'GENERATED' || ver.status === 'VERIFIED' || ver.status === 'ERROR')) done++;
        }
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        document.getElementById('teaching-progress-bar')!.style.width = pct + '%';
    }
}

let teachingQueue: any = null;

Object.defineProperty(w, 'teachingQueue', { get: () => teachingQueue, set: (v) => { teachingQueue = v; }, configurable: true });

export function updateTeachingSelectedCount() {
    const checked = document.querySelectorAll('.node-select-cb:checked');
    document.getElementById('selected-count')!.textContent = String(checked.length);
}

export function selectAllPending() {
    const checkboxes = document.querySelectorAll('.node-select-cb') as NodeListOf<HTMLInputElement>;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateTeachingSelectedCount();
}

export async function startSelectedGeneration() {
    const checked = document.querySelectorAll('.node-select-cb:checked');
    if (checked.length === 0) {
        w.showStatus('请先勾选要生成的知识点', 'error');
        return;
    }
    const selectedIds = Array.from(checked).map(cb => cb.getAttribute('data-node-id')!);
    if (!teachingQueue) {
        teachingQueue = new TeachingTaskQueue(2);
    }
    teachingQueue.selectedIds = selectedIds;
    teachingQueue.totalToProcess = selectedIds.length;
    teachingQueue.totalProcessed = 0;
    teachingQueue.start();
}

export async function startAllGeneration() {
    let pendingCount = 0;
    for (const n of w.allTeachingNodes) {
        const ver = await w.getCurrentVersion(n);
        if (ver && ver.status === 'PENDING') pendingCount++;
    }
    if (pendingCount === 0) {
        w.showStatus('没有待生成的知识点', 'error');
        return;
    }
    if (!teachingQueue) {
        teachingQueue = new TeachingTaskQueue(2);
    }
    teachingQueue.selectedIds = [];
    teachingQueue.totalToProcess = pendingCount;
    teachingQueue.totalProcessed = 0;
    teachingQueue.start();
}

export function pauseBatchGeneration() {
    if (teachingQueue) teachingQueue.pause();
}

export async function regenerateNode(nodeId: string) {
    const node = await w.dbGetTeachingNode(nodeId);
    if (!node) return;
    const provider = w.getCurrentProvider();
    const ver = await w.getCurrentVersion(node);
    if (ver && ver.status === 'ERROR') {
        await w.dbUpdateVersion(ver.id, {
            status: 'PENDING',
            error_msg: null,
            model_name: provider ? provider.model : ver.model_name
        });
    } else {
        await w.dbCreateVersion(nodeId, {
            status: 'PENDING',
            is_current: true,
            model_name: provider ? provider.model : ''
        });
    }
    await w.renderTeachingStats();
    await w.renderTeachingNodeList();
    if (teachingQueue && teachingQueue.isRunning) {
        teachingQueue._scheduleNext();
    }
}

export async function addNewVersion(nodeId: string) {
    const provider = w.getCurrentProvider();
    if (!provider) {
        w.showStatus('请先添加并选择一个模型服务商', 'error');
        return;
    }
    const newVer = await w.dbCreateVersion(nodeId, {
        status: 'PENDING',
        is_current: true,
        model_name: provider.model
    });
    w.showStatus(`已创建新版本 v${newVer.version_num}`, 'success');
    await w.renderTeachingStats();
    await w.renderTeachingNodeList();
}

export async function showVersionSwitcher(nodeId: string) {
    const versions = await w.getNodeVersions(await w.dbGetTeachingNode(nodeId));
    if (versions.length <= 1) return;
    const node = await w.dbGetTeachingNode(nodeId);
    const curVer = versions.find((v: any) => v.is_current);
    let msg = `当前版本: v${curVer?.version_num || 1}\n\n所有版本:\n`;
    versions.forEach((v: any, i: number) => {
        const statusText = ({ PENDING: '待生成', GENERATING: '生成中', GENERATED: '待校验', VERIFIED: '已完成', ERROR: '错误' } as any)[v.status] || v.status;
        msg += `${i + 1}. v${v.version_num} - ${statusText}${v.model_name ? ' (' + v.model_name + ')' : ''}${v.is_current ? ' [当前]' : ''}\n`;
    });
    msg += '\n输入版本号切换:';
    const choice = prompt(msg, String(curVer?.version_num || 1));
    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < versions.length) {
            await w.dbSetCurrentVersion(nodeId, versions[idx].id);
            w.showStatus(`已切换到 v${versions[idx].version_num}`, 'success');
            await w.renderTeachingStats();
            await w.renderTeachingNodeList();
        }
    }
}

export async function retryAllErrors() {
    for (const node of w.allTeachingNodes) {
        const ver = await w.getCurrentVersion(node);
        if (ver && ver.status === 'ERROR') {
            await w.dbUpdateVersion(ver.id, { status: 'PENDING', error_msg: null });
        }
    }
    await w.renderTeachingStats();
    await w.renderTeachingNodeList();
    if (teachingQueue && teachingQueue.isRunning) {
        teachingQueue._scheduleNext();
    }
}

export async function deleteTeachingNode(nodeId: string) {
    await w.dbDeleteTeachingNode(nodeId);
    w.allTeachingNodes = w.allTeachingNodes.filter((n: any) => n.id !== nodeId);
    w.renderTeachingStats();
    w.renderTeachingNodeList();
    if (w.allTeachingNodes.length === 0) {
        document.getElementById('teaching-queue-card')!.style.display = 'none';
        document.getElementById('teaching-project-entry')!.style.display = 'none';
    }
}
