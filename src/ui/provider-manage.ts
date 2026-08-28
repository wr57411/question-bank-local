/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 模型服务商管理 ==========

let cloudProviders: any[] = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
let currentProviderId = localStorage.getItem('current_provider_id') || '';
let editingProviderId: string | null = null;

Object.defineProperty(w, 'cloudProviders', { get: () => cloudProviders, set: (v) => { cloudProviders = v; }, configurable: true });
Object.defineProperty(w, 'currentProviderId', { get: () => currentProviderId, set: (v) => { currentProviderId = v; }, configurable: true });

// 迁移旧配置（兼容性）
export function migrateOldConfig() {
    if (cloudProviders.length === 0) {
        const oldBaseUrl = localStorage.getItem('cloud_api_base_url');
        const oldApiKey = localStorage.getItem('cloud_api_key');
        const oldModel = localStorage.getItem('cloud_api_model');

        if (oldBaseUrl && oldApiKey) {
            const provider = {
                id: 'default',
                name: 'MiniMax',
                baseUrl: oldBaseUrl,
                apiKey: oldApiKey,
                model: oldModel || 'MiniMax-M2.7'
            };
            cloudProviders.push(provider);
            currentProviderId = 'default';
            localStorage.setItem('cloud_providers', JSON.stringify(cloudProviders));
            localStorage.setItem('current_provider_id', currentProviderId);
        }
    }
}

// 渲染服务商列表
export function renderProviderList() {
    const container = document.getElementById('provider-list')!;
    container.innerHTML = '';

    cloudProviders.forEach(provider => {
        const item = document.createElement('div');
        item.style.cssText = `display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:12px;border-radius:6px;border:2px solid ${provider.id === currentProviderId ? '#6366f1' : '#e5e7eb'};background:${provider.id === currentProviderId ? '#eef2ff' : '#fff'}`;

        // 选择按钮
        const selectBtn = document.createElement('span');
        selectBtn.textContent = provider.name;
        selectBtn.style.cssText = `cursor:pointer;flex:1;color:${provider.id === currentProviderId ? '#6366f1' : '#333'};font-weight:${provider.id === currentProviderId ? '600' : '400'}`;
        selectBtn.onclick = () => selectProvider(provider.id);
        item.appendChild(selectBtn);

        // 编辑按钮
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.title = '编辑';
        editBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px';
        editBtn.onmouseover = () => editBtn.style.background = '#f3f4f6';
        editBtn.onmouseout = () => editBtn.style.background = 'none';
        editBtn.onclick = (e) => { e.stopPropagation(); editProvider(provider.id); };
        item.appendChild(editBtn);

        // 复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋';
        copyBtn.title = '复制';
        copyBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px';
        copyBtn.onmouseover = () => copyBtn.style.background = '#f0fdf4';
        copyBtn.onmouseout = () => copyBtn.style.background = 'none';
        copyBtn.onclick = (e) => { e.stopPropagation(); copyProvider(provider.id); };
        item.appendChild(copyBtn);

        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = '删除';
        delBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px';
        delBtn.onmouseover = () => delBtn.style.background = '#fef2f2';
        delBtn.onmouseout = () => delBtn.style.background = 'none';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteProviderById(provider.id); };
        item.appendChild(delBtn);

        container.appendChild(item);
    });

    // 显示当前服务商名称
    const currentProvider = cloudProviders.find(p => p.id === currentProviderId);
    document.getElementById('current-provider-name')!.textContent = currentProvider ? `当前: ${currentProvider.name}` : '';
}

// 直接按 ID 删除服务商（无需先打开编辑弹窗）
export function deleteProviderById(providerId: string) {
    const provider = cloudProviders.find(p => p.id === providerId);
    if (!provider) return;
    if (!confirm(`确定删除服务商「${provider.name}」？`)) return;

    cloudProviders = cloudProviders.filter(p => p.id !== providerId);
    if (currentProviderId === providerId) {
        currentProviderId = cloudProviders.length > 0 ? cloudProviders[0].id : '';
    }

    localStorage.setItem('cloud_providers', JSON.stringify(cloudProviders));
    localStorage.setItem('current_provider_id', currentProviderId);
    renderProviderList();
    w.showStatus('服务商已删除', 'success');
}

// 复制服务商配置
export function copyProvider(providerId: string) {
    const provider = cloudProviders.find(p => p.id === providerId);
    if (!provider) return;

    const newProvider = {
        id: 'provider_' + Date.now(),
        name: provider.name + ' - 副本',
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        authHeader: provider.authHeader || 'Authorization',
        authScheme: provider.authScheme != null ? provider.authScheme : 'Bearer',
        endpoint: provider.endpoint || ''
    };
    cloudProviders.push(newProvider);
    localStorage.setItem('cloud_providers', JSON.stringify(cloudProviders));

    // 打开编辑弹窗让用户调整
    editProvider(newProvider.id);
    renderProviderList();
    w.showStatus('已复制服务商配置', 'success');
}

// 选择服务商
export function selectProvider(providerId: string) {
    currentProviderId = providerId;
    localStorage.setItem('current_provider_id', providerId);
    renderProviderList();
    w.showStatus('已切换服务商', 'success');
}

// 显示添加服务商弹窗
export function showAddProviderModal() {
    editingProviderId = null;
    document.getElementById('provider-modal-title')!.textContent = '添加服务商';
    (document.getElementById('provider-name') as HTMLInputElement).value = '';
    (document.getElementById('provider-base-url') as HTMLInputElement).value = '';
    (document.getElementById('provider-api-key') as HTMLInputElement).value = '';
    (document.getElementById('provider-model') as HTMLInputElement).value = '';
    (document.getElementById('provider-auth-header') as HTMLInputElement).value = 'Authorization';
    (document.getElementById('provider-auth-scheme') as HTMLInputElement).value = 'Bearer';
    (document.getElementById('provider-endpoint') as HTMLInputElement).value = '';
    document.getElementById('provider-delete-btn')!.style.display = 'none';
    document.getElementById('provider-modal')!.classList.add('active');
}

// 编辑服务商
export function editProvider(providerId: string) {
    const provider = cloudProviders.find(p => p.id === providerId);
    if (!provider) return;

    editingProviderId = providerId;
    document.getElementById('provider-modal-title')!.textContent = '编辑服务商';
    (document.getElementById('provider-name') as HTMLInputElement).value = provider.name;
    (document.getElementById('provider-base-url') as HTMLInputElement).value = provider.baseUrl || '';
    (document.getElementById('provider-api-key') as HTMLInputElement).value = provider.apiKey || '';
    (document.getElementById('provider-model') as HTMLInputElement).value = provider.model;
    (document.getElementById('provider-auth-header') as HTMLInputElement).value = provider.authHeader || 'Authorization';
    (document.getElementById('provider-auth-scheme') as HTMLInputElement).value = provider.authScheme != null ? provider.authScheme : 'Bearer';
    (document.getElementById('provider-endpoint') as HTMLInputElement).value = provider.endpoint || '';
    document.getElementById('provider-delete-btn')!.style.display = 'inline-block';
    document.getElementById('provider-modal')!.classList.add('active');
}

// 关闭服务商弹窗
export function closeProviderModal() {
    document.getElementById('provider-modal')!.classList.remove('active');
    editingProviderId = null;
}

// 保存服务商
export function saveProvider() {
    const name = (document.getElementById('provider-name') as HTMLInputElement).value.trim();
    const baseUrl = (document.getElementById('provider-base-url') as HTMLInputElement).value.trim();
    const apiKey = (document.getElementById('provider-api-key') as HTMLInputElement).value.trim();
    const model = (document.getElementById('provider-model') as HTMLInputElement).value.trim();
    const authHeader = (document.getElementById('provider-auth-header') as HTMLInputElement).value.trim() || 'Authorization';
    const authScheme = (document.getElementById('provider-auth-scheme') as HTMLInputElement).value;
    const endpoint = (document.getElementById('provider-endpoint') as HTMLInputElement).value.trim();

    if (!name || !model) {
        w.showStatus('请至少填写服务商名称和模型名称', 'error');
        return;
    }
    if (!baseUrl && !endpoint) {
        w.showStatus('请填写 Base URL 或自定义端点', 'error');
        return;
    }

    const extra: any = { authHeader, authScheme };
    if (endpoint) extra.endpoint = endpoint;

    if (editingProviderId) {
        // 编辑现有服务商
        const index = cloudProviders.findIndex(p => p.id === editingProviderId);
        if (index !== -1) {
            cloudProviders[index] = { ...cloudProviders[index], name, baseUrl, apiKey, model, ...extra };
        }
    } else {
        // 添加新服务商
        const provider = {
            id: 'provider_' + Date.now(),
            name,
            baseUrl,
            apiKey,
            model,
            ...extra
        };
        cloudProviders.push(provider);
        currentProviderId = provider.id;
    }

    localStorage.setItem('cloud_providers', JSON.stringify(cloudProviders));
    localStorage.setItem('current_provider_id', currentProviderId);
    closeProviderModal();
    renderProviderList();
    w.showStatus('服务商已保存', 'success');
}

// 删除服务商（从弹窗内调用）
export function deleteProvider() {
    if (!editingProviderId) return;
    const idToDelete = editingProviderId;
    closeProviderModal();
    deleteProviderById(idToDelete);
}

// 获取当前服务商配置
export function getCurrentProvider() {
    return cloudProviders.find(p => p.id === currentProviderId);
}

// 初始化服务商列表
export function initProviderList() {
    migrateOldConfig();
    renderProviderList();
}

// 基于用户评价生成标签
export async function generateTagsFromComment() {
    if (!w.currentQuestionId) return;

    const comment = (document.getElementById("user-comment") as HTMLInputElement).value.trim();
    if (!comment) {
        w.showStatus("请输入您对题目的评价", "error");
        return;
    }

    // 保存用户评价
    await w.saveUserComment();

    const btn = (window.event as any).target as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "生成中...";
    w.stopAllPolling();

    try {
        const prompt = `请基于以下用户评价，为题目生成语义标签（JSON数组格式）。
标签范围不限，自行判断哪些语义可以作为题目特征。
只输出JSON数组，不要其他内容。

用户评价：${comment}`;

        const result = await w.callCloudAI(prompt);
        console.log("[标签生成] API 返回:", result);

        // 解析 JSON 数组
        let tags: any[] = [];
        try {
            // 尝试提取 JSON 数组
            const jsonMatch = result.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                tags = JSON.parse(jsonMatch[0]);
            } else {
                // 如果没有找到 JSON，尝试按行分割
                tags = result.split('\n').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('[') && !t.startsWith(']'));
            }
        } catch (e) {
            console.error("[标签生成] JSON 解析失败:", e);
            tags = result.split('\n').map((t: string) => t.trim()).filter((t: string) => t);
        }

        // 显示生成的标签
        const container = document.getElementById("generated-tags-list")!;
        w.addedGeneratedTags.clear();
        container.innerHTML = "";

        tags.forEach(tag => {
            const tagBtn = w.createGeneratedTagButton(tag, {
                onClickNew: (name: string) => addGeneratedTag(name),
                onClickExisting: (t: any) => addGeneratedTag(t.name),
            });
            container.appendChild(tagBtn);
        });

        document.getElementById("generated-tags")!.style.display = tags.length > 0 ? "block" : "none";
        w.showStatus(`生成了 ${tags.length} 个标签`, "success");
    } catch (e: any) {
        console.error("[标签生成] 失败:", e);
        w.showStatus("生成失败: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "生成";
        w.restartAllPolling();
    }
}

// 添加生成的标签到题目
export async function addGeneratedTag(tagName: string) {
    if (!w.currentQuestionId) return;

    try {
        // 查找是否已存在该标签
        let tag = w.allTags.find((t: any) => t.name === tagName);

        if (!tag) {
            // 创建新标签
            tag = await w.dbCreateTag(tagName, "#f59e0b");
            await w.loadTags();
        }

        // 添加标签到题目
        await w.dbAddTagToQuestion(w.currentQuestionId, tag.id);
        await w.loadQuestions();

        // 高亮已添加的标签按钮
        w.addedGeneratedTags.add(tagName);
        const wrapper = document.querySelector(`#generated-tags-list [data-tag="${tagName}"]`);
        if (wrapper) w.markWrapperDone(wrapper);

        // 更新题目详情中的标签显示（不调用 showQuestionDetail 避免重绘）
        const q = w.filteredList[w.detailIndex];
        if (q) {
            const questionTags: any[] = [];
            await w.dbQuestionTags.iterate((v: any, k: string) => {
                if (k.startsWith(w.currentQuestionId + "_")) questionTags.push(v);
            });
            const tagIds = new Set(questionTags.map(qt => qt.tag_id));
            const tagList = w.allTags.filter((t: any) => tagIds.has(t.id));
            document.getElementById("modal-tags")!.innerHTML = tagList.length ? '<h3 style="margin-top:12px">标签（点击移除）</h3><div class="tag-container">' + tagList.map((t: any) => '<span class="tag" style="background:' + t.color + '20;border:1px solid ' + t.color + ';cursor:pointer" onclick="removeTagFromQuestion(\'' + t.id + '\')">' + t.name + ' ✕</span>').join("") + '</div>' : '';
        }

        w.showStatus(`已添加标签: ${tagName}`, "success");
    } catch (e: any) {
        w.showStatus("添加标签失败: " + e.message, "error");
    }
}

// 清除生成的标签列表
export function clearGeneratedTags() {
    document.getElementById("generated-tags-list")!.innerHTML = "";
    document.getElementById("generated-tags")!.style.display = "none";
    w.addedGeneratedTags.clear();
}

// clearFormGeneratedTags is already exported from tag-manage.ts
