console.log("[DEBUG] Script loaded, isNative=" + (typeof window.Capacitor !== 'undefined'));
let currentQuestionId = null, allTags = [], allQuestions = [], trashedQuestions = [];
let activeFilterTags = [];
let cropper = null, currentCropTarget = null;
let cropSessionId = 0;
let cropInteractionLayer = null, cropMoveZone = null;
let cropCornerZones = {};
let cropGestureState = null;
let cropInteractionFrame = 0;
let croppedImages = { question: null, answer: null };
let originalImages = { question: null, answer: null };
let suggestedCropRects = { question: null, answer: null };
let floatingPollTimer = null;
let selectedQuestions = new Set();
let questionBasket = new Set();
let detailIndex = -1, filteredList = [];
let exportMode = 'single', exportSpacing = 'none';
let newTagContext = null;
let currentPaperId = null;
let similarCandidates = [];
let similarAiReasons = new Map();

// ========== Gemma 4 Capacitor 插件 Mock (用于 Web 预览与仿真) ==========
if (!window.Capacitor) window.Capacitor = { Plugins: {} };
if (!window.Capacitor.Plugins.Gemma4) {
    window.Capacitor.Plugins.Gemma4 = {
        checkModelStatus: async () => ({ ready: true, progress: 100, path: "web_mock_path" }),
        discoverModel: async () => ({ found: true, path: "web_mock_path" }),
        downloadModel: async () => console.log("[Mock] 模拟下载"),
        analyzeQuestion: async (o) => ({
            tags: ["几何", "计算题"],
            difficulty: 4,
            summary: "这是一道考察三角形内角和与勾股定理结合的几何题，计算量适中。"
        }),
        recommendQuestions: async (o) => {
            return {
                recommended_ids: [],
                reason: "根据您的需求: '" + (o.requirement || "") + "'，AI 挑选了模拟结果。"
            };
        }
    };
}

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const isIOS = isNative && window.Capacitor.getPlatform() === 'ios';
const Camera = isNative ? window.Capacitor.Plugins.Camera : null;
const MediaPlugin = isNative ? (window.Capacitor.Plugins.MediaGallery || window.Capacitor.Plugins.Media || null) : null;
const APP_VERSION_CODE = 2;
const APP_VERSION_NAME = '1.1';

// ========== 版本皮肤系统 ==========
const DEFAULT_VERSIONS = [
    { id: 'peiyou', name: '培优版', emoji: '🚀', tagline: '挑战难题，突破自我',
      theme: { primary: '#6366F1', primaryLight: '#EDE9FE', primaryDark: '#4338CA', accent: '#F59E0B', accentLight: '#FEF3C7', headerGradStart: '#6366F1', headerGradEnd: '#4F46E5' } },
    { id: 'gaosan', name: '高三总复习版', emoji: '📖', tagline: '系统复习，冲刺高考',
      theme: { primary: '#1E40AF', primaryLight: '#DBEAFE', primaryDark: '#1E3A8A', accent: '#DC2626', accentLight: '#FEE2E2', headerGradStart: '#1E40AF', headerGradEnd: '#2563EB' } },
    { id: 'tongblian', name: '同步练版', emoji: '📝', tagline: '紧跟进度，同步提升',
      theme: { primary: '#059669', primaryLight: '#D1FAE5', primaryDark: '#047857', accent: '#D97706', accentLight: '#FEF3C7', headerGradStart: '#059669', headerGradEnd: '#10B981' } },
];

function loadAppVersions() {
    const saved = localStorage.getItem('appVersions');
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return DEFAULT_VERSIONS.map(v => ({ ...v }));
}

function saveAppVersions(versions) {
    localStorage.setItem('appVersions', JSON.stringify(versions));
}

function getAppVersions() {
    return loadAppVersions();
}

function getAppVersionById(id) {
    return getAppVersions().find(v => v.id === id) || null;
}

const DEFAULT_VERSION_ID = 'peiyou';

function getCurrentVersionId() {
    return localStorage.getItem('appVersion') || DEFAULT_VERSION_ID;
}

function getCurrentVersion() {
    const id = getCurrentVersionId();
    return getAppVersionById(id) || getAppVersionById(DEFAULT_VERSION_ID);
}

function applyVersionTheme(versionId) {
    const version = getAppVersionById(versionId);
    if (!version) return;

    const t = version.theme;
    const root = document.documentElement;

    root.style.setProperty('--primary', t.primary);
    root.style.setProperty('--primary-light', t.primaryLight);
    root.style.setProperty('--primary-dark', t.primaryDark);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-light', t.accentLight);

    const header = document.getElementById('app-header');
    if (header) {
        header.style.background = `linear-gradient(135deg,${t.headerGradStart} 0%,${t.headerGradEnd} 100%)`;
    }

    const title = document.getElementById('header-title');
    if (title) {
        title.innerHTML = version.emoji + ' ' + version.name + ' <span onclick="renameCurrentVersion()" style="font-size:12px;cursor:pointer;opacity:.5" title="改名">✏️</span>';
    }
}

function renameCurrentVersion() {
    const v = getCurrentVersion();
    const newName = prompt("输入新版本名称", v.name);
    if (!newName || newName.trim() === v.name) return;
    const versions = getAppVersions();
    const target = versions.find(x => x.id === v.id);
    if (target) { target.name = newName.trim(); saveAppVersions(versions); applyVersionTheme(v.id); renderVersionSwitcher(); renderVersionCheckboxes(); showStatus("版本已改名", "success"); }
}

function setAppVersion(versionId) {
    const version = getAppVersionById(versionId);
    if (!version) return;
    localStorage.setItem('appVersion', versionId);
    applyVersionTheme(versionId);
    renderVersionSwitcher();
    renderVersionFilterTags();
    renderQuestions();
    showStatus('已切换到' + version.name, 'success');
}

function renderVersionSwitcher() {
    const container = document.getElementById('version-switcher');
    if (!container) return;

    const currentId = getCurrentVersionId();
    const versions = getAppVersions();
    container.innerHTML = '';

    versions.forEach(version => {
        const isActive = version.id === currentId;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'flex:1;min-width:100px;position:relative';

        const card = document.createElement('div');
        card.style.cssText = `padding:14px;border:2px solid ${isActive ? version.theme.primary : 'var(--border)'};border-radius:var(--radius-md);cursor:pointer;transition:all .2s;text-align:center;background:${isActive ? version.theme.primaryLight : 'var(--surface)'}`;
        card.onclick = () => setAppVersion(version.id);

        const emoji = document.createElement('div');
        emoji.style.cssText = 'font-size:28px;margin-bottom:6px';
        emoji.textContent = version.emoji;

        const name = document.createElement('div');
        name.style.cssText = `font-size:13px;font-weight:700;color:${isActive ? version.theme.primary : 'var(--text)'};margin-bottom:2px`;
        name.textContent = version.name;

        const tagline = document.createElement('div');
        tagline.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.3';
        tagline.textContent = version.tagline;

        const badge = document.createElement('div');
        if (isActive) {
            badge.style.cssText = `margin-top:6px;display:inline-block;padding:2px 8px;background:${version.theme.primary};color:#fff;border-radius:10px;font-size:10px;font-weight:700`;
            badge.textContent = '当前使用';
        }

        card.append(emoji, name, tagline, badge);
        wrapper.appendChild(card);

        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;border:none;background:rgba(255,255,255,.9);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.2);z-index:5';
        editBtn.onclick = (e) => { e.stopPropagation(); showEditVersionModal(version.id); };
        wrapper.appendChild(editBtn);

        container.appendChild(wrapper);
    });

    const addBtn = document.createElement('div');
    addBtn.style.cssText = 'flex:0 0 auto;padding:14px;border:2px dashed var(--border);border-radius:var(--radius-md);cursor:pointer;transition:all .2s;text-align:center;min-width:80px;display:flex;flex-direction:column;align-items:center;justify-content:center';
    addBtn.onclick = () => showAddVersionModal();
    addBtn.innerHTML = '<div style="font-size:28px;margin-bottom:6px;color:var(--text-tertiary)">+</div><div style="font-size:13px;font-weight:600;color:var(--text-tertiary)">添加版本</div>';
    container.appendChild(addBtn);

    const systemPasswordStatus = document.getElementById('system-password-status');
    const systemPasswordBtn = document.getElementById('system-password-btn');
    if (systemPasswordStatus) {
        const hasPassword = !!localStorage.getItem('systemPassword');
        systemPasswordStatus.textContent = hasPassword ? '已设置密码' : '尚未设置密码';
        systemPasswordStatus.style.color = hasPassword ? '#10b981' : '#888';
    }
    if (systemPasswordBtn) {
        const hasPassword = !!localStorage.getItem('systemPassword');
        systemPasswordBtn.textContent = hasPassword ? '修改密码' : '设置密码';
    }
}

// ========== 平台专属 UI 降级 ==========
// 悬浮窗 / 待补拍 / 待处理 依赖 Android 原生插件（FloatingWindow / QuickCapture），iOS 不可用。
// 端侧 AI（Gemma4）首版 iOS 不做，隐藏其入口，保留"云端 API 服务商"可用。
function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
function applyPlatformUI() {
    const platform = (window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : 'web';
    if (platform === 'android') return; // Android 全功能
    // 下列为 Android 独占能力，iOS / Web 隐藏入口
    hideEl('floating-toggle-btn');
    hideEl('pending-blank-tab');
    hideEl('pending-photos-tab');
    // 端侧 AI 引擎（Gemma4）首版 iOS 不支持：隐藏加载/批量按钮，给出明确提示
    const aiLabel = document.getElementById('ai-status-label');
    const aiDesc = document.getElementById('ai-status-desc');
    hideEl('ai-load-btn');
    hideEl('ai-batch-btn');
    if (aiLabel) { aiLabel.textContent = '暂不支持'; aiLabel.style.background = 'var(--text-tertiary)'; }
    if (aiDesc) aiDesc.textContent = 'iOS 版暂不支持端侧 AI（Gemma4），可使用下方"模型服务商管理"接入云端 API。';
}

document.addEventListener("DOMContentLoaded", async () => {
    // 初始化版本皮肤
    applyVersionTheme(getCurrentVersionId());
    renderVersionCheckboxes();
    renderVersionSwitcher();
    updateExportImgModeBtn();

    // 初始化远程同步
    initRemoteSync(serverUrl, apiToken, syncEnabled);
    // 绑定同步数据完整性警告回调
    if (typeof setOnSyncDataWarning === 'function') {
        setOnSyncDataWarning(showSyncWarning);
    }
    // 恢复实时同步开关状态
    const syncToggle = document.getElementById('sync-toggle');
    if (syncToggle) syncToggle.checked = syncEnabled;
    await refreshAll();
    updatePendingLinkBadge();
    await updatePendingPhotosBadge();
    restartSyncPolling();
    if (currentUser && autoSyncEnabled && syncEnabled) queueAutoSync(true);
    if (currentUser && apiToken) startSupabaseAutoSync();
    checkServerConnection();
    updateSyncBar();
    setInterval(checkServerConnection, 60000);
    checkAppUpdate();

    // 平台专属 UI 降级（iOS / Android 差异）
    applyPlatformUI();
    if (isNative && MediaPlugin) {
        loadGalleryThumbnails('question');
        loadGalleryThumbnails('answer');
    }
});

async function refreshAll() {
    await _migrateQuestionNotes();
    await Promise.all([loadTags(), isFormDirty ? Promise.resolve() : loadQuestions(), loadPapers(), loadTopics(), loadBookFilter()]);
    if (!isFormDirty) {
        const lastBookName = localStorage.getItem('lastBookName');
        if (lastBookName) document.getElementById('book-name').value = lastBookName;
    }
}

// ========== 版本管理 ==========
let editingVersionId = null;
let deletingVersionId = null;

function showAddVersionModal() {
    editingVersionId = null;
    document.getElementById('version-modal-title').textContent = '添加版本';
    document.getElementById('version-name-input').value = '';
    document.getElementById('version-emoji-input').value = '';
    document.getElementById('version-tagline-input').value = '';
    document.getElementById('version-delete-btn').style.display = 'none';
    document.getElementById('version-modal').classList.add('active');
}

function showEditVersionModal(versionId) {
    const version = getAppVersionById(versionId);
    if (!version) return;
    editingVersionId = versionId;
    document.getElementById('version-modal-title').textContent = '编辑版本';
    document.getElementById('version-name-input').value = version.name;
    document.getElementById('version-emoji-input').value = version.emoji;
    document.getElementById('version-tagline-input').value = version.tagline || '';
    document.getElementById('version-delete-btn').style.display = 'inline-block';
    document.getElementById('version-modal').classList.add('active');
}

function closeVersionModal() {
    document.getElementById('version-modal').classList.remove('active');
    editingVersionId = null;
}

function saveVersion() {
    const name = document.getElementById('version-name-input').value.trim();
    const emoji = document.getElementById('version-emoji-input').value.trim();
    const tagline = document.getElementById('version-tagline-input').value.trim();

    if (!name) { showStatus('请输入版本名称', 'error'); return; }
    if (!emoji) { showStatus('请选择版本图标', 'error'); return; }

    const versions = getAppVersions();

    if (editingVersionId) {
        const idx = versions.findIndex(v => v.id === editingVersionId);
        if (idx !== -1) {
            versions[idx].name = name;
            versions[idx].emoji = emoji;
            versions[idx].tagline = tagline;
        }
    } else {
        const id = 'custom_' + Date.now();
        const hue = Math.floor(Math.random() * 360);
        versions.push({
            id,
            name,
            emoji,
            tagline,
            theme: {
                primary: `hsl(${hue}, 70%, 45%)`,
                primaryLight: `hsl(${hue}, 70%, 95%)`,
                primaryDark: `hsl(${hue}, 70%, 30%)`,
                accent: `hsl(${(hue + 180) % 360}, 70%, 45%)`,
                accentLight: `hsl(${(hue + 180) % 360}, 70%, 95%)`,
                headerGradStart: `hsl(${hue}, 70%, 45%)`,
                headerGradEnd: `hsl(${hue + 20}, 60%, 50%)`,
            }
        });
    }

    saveAppVersions(versions);
    closeVersionModal();
    renderVersionSwitcher();
    renderVersionCheckboxes();
    renderVersionFilterTags();
    showStatus(editingVersionId ? '版本已更新' : '版本已添加', 'success');
}

function deleteVersion() {
    if (!editingVersionId) return;
    const systemPassword = localStorage.getItem('systemPassword');
    if (!systemPassword) {
        showStatus('请先在设置中设置系统密码', 'error');
        return;
    }
    deletingVersionId = editingVersionId;
    document.getElementById('version-delete-password').value = '';
    document.getElementById('version-delete-error').style.display = 'none';
    document.getElementById('version-delete-modal').classList.add('active');
}

function closeVersionDeleteModal() {
    document.getElementById('version-delete-modal').classList.remove('active');
    deletingVersionId = null;
}

async function confirmDeleteVersion() {
    if (!deletingVersionId) return;
    const password = document.getElementById('version-delete-password').value;
    const systemPassword = localStorage.getItem('systemPassword');

    if (password !== systemPassword) {
        document.getElementById('version-delete-error').textContent = '密码错误';
        document.getElementById('version-delete-error').style.display = 'block';
        return;
    }

    const versions = getAppVersions().filter(v => v.id !== deletingVersionId);
    saveAppVersions(versions);

    await dbRemoveVersionFromAllQuestions(deletingVersionId);

    if (getCurrentVersionId() === deletingVersionId) {
        localStorage.setItem('appVersion', versions[0]?.id || DEFAULT_VERSION_ID);
        applyVersionTheme(getCurrentVersionId());
    }

    closeVersionDeleteModal();
    closeVersionModal();
    renderVersionSwitcher();
    renderVersionCheckboxes();
    renderVersionFilterTags();
    await loadQuestions();
    showStatus('版本已删除', 'success');
}

// 系统密码管理
function showSystemPasswordModal() {
    const hasPassword = !!localStorage.getItem('systemPassword');
    document.getElementById('system-password-label').textContent = hasPassword ? '修改密码' : '设置密码';
    document.getElementById('system-password-confirm-group').style.display = hasPassword ? 'none' : 'block';
    document.getElementById('system-password-input').value = '';
    document.getElementById('system-password-confirm').value = '';
    document.getElementById('system-password-error').style.display = 'none';
    document.getElementById('system-password-modal').classList.add('active');
}

function closeSystemPasswordModal() {
    document.getElementById('system-password-modal').classList.remove('active');
}

function saveSystemPassword() {
    const hasPassword = !!localStorage.getItem('systemPassword');
    const password = document.getElementById('system-password-input').value;
    const confirm = document.getElementById('system-password-confirm').value;

    if (!password) {
        document.getElementById('system-password-error').textContent = '请输入密码';
        document.getElementById('system-password-error').style.display = 'block';
        return;
    }

    if (!hasPassword && password !== confirm) {
        document.getElementById('system-password-error').textContent = '两次输入的密码不一致';
        document.getElementById('system-password-error').style.display = 'block';
        return;
    }

    localStorage.setItem('systemPassword', password);
    closeSystemPasswordModal();
    showStatus(hasPassword ? '密码已修改' : '密码已设置', 'success');
}

function renderVersionFilterTags() {
    const versions = getAppVersions();
    const currentId = getCurrentVersionId();
    const currentVersion = getAppVersionById(currentId);

    const statusEl = document.getElementById('user-status');
    if (statusEl && currentVersion) {
        statusEl.textContent = currentVersion.tagline || '数据存储在本地，无需联网';
    }
}

function showTab(tabName, btn) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll('div[id$="-tab"]').forEach(t => t.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(tabName + "-tab").classList.remove("hidden");
}

// ========== 相机/相册 ==========
function _handleImageReady(target, dataUrl) {
    originalImages[target] = dataUrl;
    if (document.getElementById('skip-crop-check') && document.getElementById('skip-crop-check').checked) {
        croppedImages[target] = dataUrl;
        suggestedCropRects[target] = null;
        document.getElementById(target + '-preview').src = dataUrl;
        document.getElementById(target + '-preview-wrap').style.display = 'inline-block';
        document.getElementById(target + '-preview-label').classList.remove('hidden');
        if (target === 'question') {
            const copyBtn = document.getElementById('copy-q-to-a-btn');
            if (copyBtn) copyBtn.style.display = '';
        }
    } else {
        croppedImages[target] = dataUrl;
        suggestedCropRects[target] = null;
        startCrop(target, null);
    }
}
async function takePhoto(target) {
    if (isNative && Camera) {
        try {
            const photo = await Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
            _handleImageReady(target, photo.dataUrl);
        } catch (e) { if (e.message !== 'User cancelled photos app') showStatus("拍照失败: " + e.message, "error"); }
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => { _handleImageReady(target, ev.target.result); };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}
async function pickFromGallery(target) {
    if (isNative && Camera) {
        try {
            const photo = await Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' });
            _handleImageReady(target, photo.dataUrl);
        } catch (e) { if (e.message !== 'User cancelled photos app') showStatus("选择图片失败: " + e.message, "error"); }
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => { _handleImageReady(target, ev.target.result); };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}
function handleCameraResult(target, dataUrl) {
    document.getElementById(target + "-preview").src = dataUrl;
    document.getElementById(target + "-preview-wrap").style.display = "inline-block";
    document.getElementById(target + "-preview-label").classList.remove("hidden");
    originalImages[target] = dataUrl; croppedImages[target] = dataUrl;
    if (target === 'question') {
        isFormDirty = true;
        const copyBtn = document.getElementById("copy-q-to-a-btn");
        if (copyBtn) copyBtn.style.display = "";
    }
}
function handleFileSelect(e, target) {
    if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => { handleCameraResult(target, ev.target.result); croppedImages[target] = e.target.files[0]; };
        reader.readAsDataURL(e.target.files[0]);
    }
}
function copyQuestionToAnswer() {
    if (!croppedImages.question) { showStatus("请先选择题目图片", "error"); return; }
    handleCameraResult('answer', croppedImages.question);
    showStatus("已复制题目图片到答案", "success");
}
function removeImage(target) {
    croppedImages[target] = null; originalImages[target] = null;
    suggestedCropRects[target] = null;
    document.getElementById(target + "-preview-wrap").style.display = "none";
    document.getElementById(target + "-preview-label").classList.add("hidden");
    if (target === 'question') {
        const copyBtn = document.getElementById("copy-q-to-a-btn");
        if (copyBtn) copyBtn.style.display = "none";
    }
    if (target === 'question') isFormDirty = false;
}

async function loadGalleryThumbnails(target) {
    if (!isNative || !MediaPlugin) {
        console.warn('[Gallery] not native or no MediaPlugin');
        return;
    }
    const stripId = target === 'answer' ? 'answer-gallery-thumb-strip' : 'question-gallery-thumb-strip';
    const containerId = target === 'answer' ? 'answer-gallery-thumb-container' : 'question-gallery-thumb-container';
    const container = document.getElementById(containerId);
    const strip = document.getElementById(stripId);
    if (!container || !strip) return;
    strip.style.display = '';
    container.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);padding:8px">加载中...</span>';
    try {
        console.log('[Gallery] calling getMedias for ' + target + '...');
        const result = await MediaPlugin.getMedias({
            quantity: 20,
            thumbnailWidth: 240,
            thumbnailHeight: 240,
            thumbnailQuality: 85,
            types: 'photos'
        });
        console.log('[Gallery] getMedias result:', result ? 'ok' : 'null', 'medias:', result?.medias?.length);
        if (!result || !result.medias || result.medias.length === 0) {
            container.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);padding:8px">相册无照片</span>';
            return;
        }
        container.innerHTML = '';
        for (const media of result.medias) {
            const div = document.createElement('div');
            div.style.cssText = 'flex-shrink:0;width:120px;height:120px;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid var(--border);position:relative';
            const img = document.createElement('img');
            const dataUrl = media.data.startsWith('data:') ? media.data : 'data:image/jpeg;base64,' + media.data;
            img.src = dataUrl;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover';
            img.loading = 'lazy';
            div.appendChild(img);
            div.onclick = () => galleryThumbClick(media.identifier, target);
            container.appendChild(div);
        }
    } catch (e) {
        console.error('[Gallery] load failed:', e);
        const msg = e.message || String(e);
        container.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);padding:8px">加载失败: ' + msg + '</span>';
    }
}

async function galleryThumbClick(identifier, target) {
    if (!target) {
        let determinedTarget = 'question';
        if (croppedImages['question']) determinedTarget = 'answer';
        target = determinedTarget;
    }
    const label = target === 'question' ? '题目' : '答案';
    showStatus('正在加载' + label + '图片...', 'success');
    try {
        console.log('[Gallery] loading full image for identifier:', identifier, 'target:', target);
        let dataUrl;
        if (typeof MediaPlugin.getFullImage === 'function' && (identifier.startsWith('content://') || identifier.startsWith('file://') || (!identifier.startsWith('/') && !identifier.match(/^[A-Z]:\\/)))) {
            const result = await MediaPlugin.getFullImage({ identifier: identifier });
            const mime = result.mimeType || 'image/jpeg';
            dataUrl = 'data:' + mime + ';base64,' + result.data;
        } else if (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios' && MediaPlugin.getMediaByIdentifier) {
            const pathResult = await MediaPlugin.getMediaByIdentifier({ identifier: identifier });
            const FS = window.Capacitor?.Plugins?.Filesystem;
            if (FS) {
                const fileResult = await FS.readFile({ path: pathResult.path });
                let data = fileResult.data;
                if (!data.startsWith('data:')) dataUrl = 'data:image/jpeg;base64,' + data;
                else dataUrl = data;
            } else {
                showStatus('文件系统不可用', 'error');
                return;
            }
        } else {
            const FS = window.Capacitor?.Plugins?.Filesystem;
            if (FS) {
                const fileResult = await FS.readFile({ path: identifier });
                let data = fileResult.data;
                if (!data.startsWith('data:')) dataUrl = 'data:image/jpeg;base64,' + data;
                else dataUrl = data;
            } else {
                showStatus('文件系统不可用', 'error');
                return;
            }
        }
        _handleImageReady(target, dataUrl);
        showStatus('已导入' + label + '图片', 'success');
    } catch (e) {
        console.error('[Gallery] load full image failed:', e);
        showStatus('图片加载失败: ' + e.message, 'error');
    }
}

// ========== 悬浮窗截图 ==========

let FloatingWindow = isNative ? window.Capacitor.Plugins.FloatingWindow : null;
console.log("[Floating] isNative=" + isNative + " FloatingWindow=" + FloatingWindow + " allPlugins=" + (isNative ? JSON.stringify(Object.keys(window.Capacitor.Plugins)) : "N/A"));
let floatingActive = false;
let _floatingSaveResolve = null;
let _floatingCrossPageResolve = null;
let _floatingCrossPageTarget = null;
let _floatingCrossPageFirst = null;

async function toggleFloatingWindow() {
    console.log("[Floating] toggleFloatingWindow called! isNative=" + isNative + " FloatingWindow=" + !!FloatingWindow + " floatingActive=" + floatingActive);
    if (!isNative || !FloatingWindow) {
        showStatus("悬浮窗仅在 Android 设备上可用", "error");
        return;
    }
    const btn = document.getElementById('floating-toggle-btn');
    if (floatingActive) {
        await FloatingWindow.stop();
        floatingActive = false;
        btn.textContent = '   悬浮窗';
        btn.style.background = '#3b82f6';
        showStatus("悬浮窗已关闭", "success");
    } else {
        try {
            await FloatingWindow.start();
            floatingActive = true;
            btn.textContent = '⏹ 关闭';
            btn.style.background = '#ef4444';
            showStatus("悬浮窗已启动，切换到其他 App 即可截图", "success");
        } catch (e) {
            console.log("[Floating] start error: " + e.message);
            showStatus("启动失败: " + e.message, "error");
        }
    }
}

async function pickFromFloating(target) {
    console.log("[Floating] pickFromFloating called, target=" + target + " isNative=" + isNative + " floatingActive=" + floatingActive);
    if (!isNative || !FloatingWindow) {
        console.log("[Floating] not native or no FloatingWindow");
        showStatus("悬浮窗仅在 Android 设备上可用", "error");
        return;
    }
    if (!floatingActive) {
        console.log("[Floating] floating not active");
        showStatus("请先启动悬浮窗", "error");
        return;
    }
    try {
        const result = await FloatingWindow.getImages();
        console.log("[Floating] getImages result:", JSON.stringify(result));
        if (!result || !result.images || result.images.length === 0) {
            console.log("[Floating] no images, showing error");
            showStatus("悬浮窗中暂无截图，请先截图", "error");
            return;
        }
        console.log("[Floating] showing image list, count=" + result.images.length);
        showFloatingImageList(result.images, target);
    } catch (e) {
        console.log("[Floating] getImages error:", e.message);
        showStatus("获取截图列表失败: " + e.message, "error");
    }
}

function showFloatingImageList(images, target) {
    console.log("[Floating] showFloatingImageList images=" + images.length + " target=" + target);
    const container = document.getElementById('floating-image-list');
    if (!container) {
        console.log("[Floating] ERROR: floating-image-list element not found!");
        return;
    }
    container.innerHTML = '';
    container.dataset.target = target;

    if (images.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:20px">暂无截图</div>';
    } else {
        images.forEach((img, i) => {
            const typeLabels = { question: '📖 题目', answer: '📝 答案', blank: '📄 空白题' };
            const typeColors = { question: '#10b981', answer: '#8b5cf6', blank: '#f59e0b' };
            const card = document.createElement('div');
            card.style.cssText = 'display:flex;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;align-items:center';
            card.innerHTML = `
                <img src="${img.thumbPath || img.webPath}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb" />
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px">第${img.questionNum}题</div>
                    <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;color:#fff;background:${typeColors[img.imageType] || '#888'}">${typeLabels[img.imageType] || img.imageType}</span>
                </div>
                <button onclick="importFloatingImage(${img.index}, '${target}')" style="padding:6px 12px;background:#10b981;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap">导入</button>
                <button onclick="deleteFloatingImage(${img.index})" style="padding:6px 8px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">🗑</button>
            `;
            container.appendChild(card);
        });
    }

    document.getElementById('floating-modal').classList.add('active');
    console.log("[Floating] modal activated");
}

async function importFloatingImage(index, target) {
    if (!FloatingWindow) return;
    try {
        const result = await FloatingWindow.getImage({ index });
        if (result && result.webPath) {
            // One-click import: directly set image without cropping
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                originalImages[target] = dataUrl;
                croppedImages[target] = dataUrl;
                suggestedCropRects[target] = null;
                handleCameraResult(target, dataUrl);
                showStatus("已导入到" + (target === 'question' ? '题目' : target === 'answer' ? '答案' : '空白题') + "图片", "success");
            };
            img.src = result.webPath;
        }
        closeFloatingModal();
    } catch (e) {
        showStatus("导入失败: " + e.message, "error");
    }
}

async function deleteFloatingImage(index) {
    if (!FloatingWindow) return;
    try {
        await FloatingWindow.removeImage({ index });
        // Refresh list
        const result = await FloatingWindow.getImages();
        const target = document.getElementById('floating-image-list').dataset.target || 'question';
        showFloatingImageList(result.images || [], target);
    } catch (e) {
        showStatus("删除失败: " + e.message, "error");
    }
}

async function clearFloatingImages() {
    if (!FloatingWindow) return;
    try {
        await FloatingWindow.clearImages();
        closeFloatingModal();
        showStatus("已清空全部截图", "success");
    } catch (e) {
        showStatus("清空失败: " + e.message, "error");
    }
}

function closeFloatingModal() {
    document.getElementById('floating-modal').classList.remove('active');
}

// ========== 悬浮窗截屏保存 ==========

// Intercept capture events from native
async function pollFloatingEvents() {
    if (!floatingActive || !FloatingWindow) return;
    try {
        const event = await FloatingWindow.pollEvent();
        console.log("[Floating] pollEvent result:", JSON.stringify(event));
        if (event && event.event === 'imageCaptured') {
            // Show save dialog
            const lastNum = (await FloatingWindow.getLastQuestionNum()).questionNum;
            document.getElementById('floating-save-qnum').value = lastNum;
            document.getElementById('floating-save-modal').classList.add('active');
        } else if (event && event.event === 'previewClicked') {
            // Open floating image list preview
            pickFromFloating('question');
        }
    } catch (e) { console.error("[Floating] pollFloatingEvents error:", e); }
}
floatingPollTimer = setInterval(pollFloatingEvents, 500);

async function confirmFloatingSave(type) {
    const qnum = parseInt(document.getElementById('floating-save-qnum').value) || 1;
    document.getElementById('floating-save-modal').classList.remove('active');

    if (FloatingWindow) {
        await FloatingWindow.setQuestionNum({ questionNum: qnum });

        // Update the last captured image's question number and type
        const images = await FloatingWindow.getImages();
        if (images && images.images && images.images.length > 0) {
            const last = images.images[images.images.length - 1];
            await FloatingWindow.updateImage({ index: last.index, questionNum: qnum, imageType: type });
        }
    }

    if (type === 'cross-page') {
        showStatus("跨页拍摄：请翻到下半部分，再点悬浮窗截图", "success");
        // TODO: handle cross-page flow with floating window
        return;
    }

    showStatus(`已保存到第${qnum}题${type === 'question' ? '题目' : type === 'answer' ? '答案' : '空白题'}`, "success");
}

function cancelFloatingSave() {
    document.getElementById('floating-save-modal').classList.remove('active');
    // Remove the last captured image since user cancelled
    if (FloatingWindow) {
        FloatingWindow.getImages().then(result => {
            if (result && result.images && result.images.length > 0) {
                const last = result.images[result.images.length - 1];
                FloatingWindow.removeImage({ index: last.index });
            }
        });
    }
}

// ========== 跨页拍摄 ==========

let _cropResolve = null; // 跨页裁剪回调

async function crossPageShoot(target) {
    showStatus("拍摄第 1 张（上半部分）", "success");
    const img1 = await captureAndCropOne('上半部分');
    if (!img1) return;

    showStatus("拍摄第 2 张（下半部分）", "success");
    const img2 = await captureAndCropOne('下半部分');
    if (!img2) { showStatus("已取消", "error"); return; }

    showStatus("正在合并...", "success");
    const combined = await mergeImagesVertically(img1, img2);
    handleCameraResult(target, combined);
    showStatus("跨页合并完成", "success");
}

async function captureAndCropOne(label) {
    // 1. 拍照或选图
    let dataUrl = null;
    if (isNative && Camera) {
        try {
            const photo = await Camera.getPhoto({ quality: 90, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
            dataUrl = photo.dataUrl;
        } catch (e) { return null; }
    } else {
        dataUrl = await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
            input.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const reader = new FileReader();
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.readAsDataURL(e.target.files[0]);
                } else resolve(null);
            };
            input.click();
        });
    }
    if (!dataUrl) return null;

    // 2. 打开裁剪弹窗，等待用户确认
    return new Promise((resolve) => {
        openCropModal(dataUrl, '_crossPageCrop', resolve);
    });
}

async function captureOneImage() {
    if (isNative && Camera) {
        try {
            const photo = await Camera.getPhoto({ quality: 90, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
            return photo.dataUrl;
        } catch (e) { return null; }
    } else {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
            input.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const reader = new FileReader();
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.readAsDataURL(e.target.files[0]);
                } else resolve(null);
            };
            input.click();
        });
    }
}

function mergeImagesVertically(dataUrl1, dataUrl2) {
    return new Promise((resolve, reject) => {
        const img1 = new Image(), img2 = new Image();
        let loaded = 0;
        const onLoad = () => {
            if (++loaded < 2) return;
            const maxW = Math.max(img1.width, img2.width);
            const totalH = img1.height + img2.height;
            const canvas = document.createElement('canvas');
            canvas.width = maxW; canvas.height = totalH;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, maxW, totalH);
            ctx.drawImage(img1, (maxW - img1.width) / 2, 0);
            ctx.drawImage(img2, (maxW - img2.width) / 2, img1.height);
            resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        img1.onload = onLoad; img2.onload = onLoad;
        img1.onerror = reject; img2.onerror = reject;
        img1.src = dataUrl1; img2.src = dataUrl2;
    });
}

// ========== 排版适用性 ==========
function selectLayout(el, val) {
    document.querySelectorAll('.layout-option').forEach(l => { l.style.borderColor = '#e5e7eb'; l.style.background = '#fff'; });
    el.style.borderColor = '#3B82F6'; el.style.background = '#3B82F610';
}

// ========== 版本勾选 ==========
function renderVersionCheckboxes() {
    const container = document.getElementById('version-checkboxes');
    if (!container) return;
    const checkedIds = new Set(Array.from(container.querySelectorAll('input[name="question_versions"]:checked')).map(cb => cb.value));
    const versions = getAppVersions();
    const SERIES_ORDER = { '高三': 0, '同步': 1 };
    const DIFF_ORDER = { '培优': 0, '中等': 1, '基础': 2 };
    versions.sort((a, b) => {
        const sa = Object.keys(SERIES_ORDER).find(k => a.name.includes(k)) || '';
        const sb = Object.keys(SERIES_ORDER).find(k => b.name.includes(k)) || '';
        const sd = (SERIES_ORDER[sa] ?? 9) - (SERIES_ORDER[sb] ?? 9);
        if (sd !== 0) return sd;
        const da = Object.keys(DIFF_ORDER).find(k => a.name.includes(k)) || '';
        const db = Object.keys(DIFF_ORDER).find(k => b.name.includes(k)) || '';
        return (DIFF_ORDER[da] ?? 9) - (DIFF_ORDER[db] ?? 9);
    });
    container.innerHTML = '';
    versions.forEach(v => {
        const wrap = document.createElement('div');
        wrap.style.cssText = `display:flex;align-items:center;gap:6px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-md);cursor:pointer;font-size:13px;font-weight:500;transition:border-color .2s,background-color .2s;background:var(--surface)`;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'question_versions';
        cb.value = v.id;
        cb.checked = checkedIds.has(v.id);
        cb.style.cssText = 'accent-color:' + v.theme.primary + ';width:18px;height:18px;cursor:pointer;flex-shrink:0';
        const updateStyle = () => { wrap.style.background = cb.checked ? v.theme.primary + '15' : 'var(--surface)'; wrap.style.borderColor = cb.checked ? v.theme.primary : 'var(--border)'; };
        cb.onchange = updateStyle;
        wrap.onclick = (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            updateStyle();
        };
        const span = document.createElement('span');
        span.textContent = v.emoji + ' ' + v.name;
        wrap.append(cb, span);
        if (cb.checked) { wrap.style.background = v.theme.primary + '15'; wrap.style.borderColor = v.theme.primary; }
        container.appendChild(wrap);
    });
}

function getSelectedVersions() {
    return Array.from(document.querySelectorAll('input[name="question_versions"]:checked')).map(cb => cb.value);
}

function resetVersionCheckboxes() {
    document.querySelectorAll('input[name="question_versions"]').forEach(cb => { cb.checked = false; });
}

// ========== 裁剪 ==========
function clampValue(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function smoothSeries(values, radius) {
    if (!values.length || radius <= 0) return values.slice();
    const prefix = new Array(values.length + 1).fill(0);
    for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
    return values.map((_, i) => {
        const start = Math.max(0, i - radius);
        const end = Math.min(values.length - 1, i + radius);
        return (prefix[end + 1] - prefix[start]) / (end - start + 1);
    });
}
function getOtsuThreshold(histogram, totalPixels) {
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
function collectRanges(flags, maxGap) {
    const ranges = [];
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
function expandRect(rect, padX, padY, maxWidth, maxHeight) {
    const x = clampValue(rect.x - padX, 0, maxWidth);
    const y = clampValue(rect.y - padY, 0, maxHeight);
    const right = clampValue(rect.x + rect.width + padX, 0, maxWidth);
    const bottom = clampValue(rect.y + rect.height + padY, 0, maxHeight);
    return { x, y, width: right - x, height: bottom - y };
}
async function detectCenterQuestionRect(image) {
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
    let bestRect = null;
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
function getDefaultCropRect(image) {
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return null;
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
}
function destroyCropInteractionLayer() {
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
function queueCropInteractionSync() {
    if (!cropper || !cropInteractionLayer) return;
    if (cropInteractionFrame) cancelAnimationFrame(cropInteractionFrame);
    cropInteractionFrame = requestAnimationFrame(() => {
        cropInteractionFrame = 0;
        syncCropInteractionLayer();
    });
}
function syncCropInteractionLayer() {
    if (!cropper || !cropInteractionLayer) return;
    let cropBox;
    try { cropBox = cropper.getCropBoxData(); } catch (e) { return; }
    if (!cropBox || !Number.isFinite(cropBox.left) || !Number.isFinite(cropBox.top) || !Number.isFinite(cropBox.width) || !Number.isFinite(cropBox.height)) return;
    const zoneSize = 96;
    const halfZone = zoneSize / 2;
    const positions = {
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
function initCropInteractionLayer() {
    destroyCropInteractionLayer();
    const container = document.getElementById("crop-container");
    if (!container || !cropper) return;
    const layer = document.createElement("div");
    layer.id = "crop-interaction-layer";
    const zones = {};
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
function onCropGestureStart(event) {
    if (!cropper) return;
    event.preventDefault();
    event.stopPropagation();
    let cropBox;
    let canvasBox;
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
function updateCropGesture(event) {
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
function endCropGesture(event) {
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
function createCropperWithRect(image, rect, sessionId) {
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
function isValidCropRect(rect) {
    return !!(rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0);
}
function openCropModal(dataUrl, target, resolveCrop, preferredRect) {
    currentCropTarget = target;
    _cropResolve = resolveCrop || null;
    const ci = document.getElementById("crop-image");
    document.getElementById("crop-modal").classList.add("active");
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
function startCrop(target, preferredRect) {
    const d = originalImages[target];
    if (!d) { showStatus("请先选择图片", "error"); return; }
    const rect = isValidCropRect(preferredRect) ? preferredRect : null;
    openCropModal(d, target, null, rect);
}
function confirmCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ maxWidth: 2000, maxHeight: 2000, fillColor: "#fff" });
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    document.getElementById("crop-modal").classList.remove("active");
    destroyCropInteractionLayer();
    cropper.destroy(); cropper = null;

    // 跨页裁剪模式：通过 Promise 返回
    if (_cropResolve) {
        _cropResolve(dataUrl);
        _cropResolve = null;
        return;
    }

    // 普通裁剪模式：更新预览
    document.getElementById(currentCropTarget + "-preview").src = dataUrl;
    document.getElementById(currentCropTarget + "-preview-wrap").style.display = "inline-block";
    document.getElementById(currentCropTarget + "-preview-label").classList.remove("hidden");
    croppedImages[currentCropTarget] = dataUrl; originalImages[currentCropTarget] = dataUrl;
    if (suggestedCropRects[currentCropTarget] !== undefined) suggestedCropRects[currentCropTarget] = null;
    if (currentCropTarget === 'question') {
        const copyBtn = document.getElementById("copy-q-to-a-btn");
        if (copyBtn) copyBtn.style.display = "";
    }
}
function cancelCrop() {
    document.getElementById("crop-modal").classList.remove("active");
    cropSessionId++;
    destroyCropInteractionLayer();
    if (cropper) { cropper.destroy(); cropper = null; }
    document.getElementById("crop-image").onload = null;
    if (_cropResolve) { _cropResolve(null); _cropResolve = null; }
}
function rotateCrop(deg) {
    if (!cropper) return;
    cropper.rotate(deg);
    queueCropInteractionSync();
    setTimeout(queueCropInteractionSync, 0);
}

// ========== 标签 ==========
async function loadTags() {
    allTags = await dbGetAllTags();
    activeFilterTags = activeFilterTags.filter(id => allTags.some(t => t.id === id));
    renderTags(); updateTagSelects(); renderFilterTags();
    if (document.getElementById('form-tag-results')) onFormTagSearch();
}
function renderTags() {
    const c = document.getElementById("tags-list"); c.replaceChildren();
    if (!allTags.length) { c.innerHTML = '<div class="empty-state">暂无标签，请添加</div>'; return; }
    allTags.forEach(tag => {
        const el = document.createElement("span"); el.className = "tag";
        el.style.background = tag.color + "20"; el.style.border = "1px solid " + tag.color;
        el.appendChild(document.createTextNode(tag.name));
        const rm = document.createElement("span"); rm.className = "remove"; rm.textContent = "×";
        rm.onclick = () => deleteTag(tag.id); el.appendChild(rm); c.appendChild(el);
    });
}
function updateTagSelects() {
    ["paper-tag-select"].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = Array.from(sel.selectedOptions).map(o => o.value);
        sel.replaceChildren();
        allTags.forEach(t => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; if (prev.includes(t.id)) o.selected = true; sel.appendChild(o); });
    });
    onFormTagSearch();
}

let formSelectedTagIds = [];
let _formTagManageMode = false;
let _formTagLongPressTimer = null;
let _formTagPollTimer = null;
let _formTagLastVal = '';
function _startFormTagPoll() { _formTagLastVal = ''; _formTagPollTimer = setInterval(() => { const inp = document.getElementById('form-tag-search'); if (inp && inp.value !== _formTagLastVal) { _formTagLastVal = inp.value; onFormTagSearch(); } }, 150); }
function _stopFormTagPoll() { clearInterval(_formTagPollTimer); _formTagPollTimer = null; }

function onFormTagSearch() {
    const input = document.getElementById('form-tag-search');
    const resultsDiv = document.getElementById('form-tag-results');
    if (!input || !resultsDiv) return;
    const query = input.value.trim().toLowerCase();
    let matches = allTags.filter(t => !formSelectedTagIds.includes(t.id));
    if (query) matches = matches.filter(t => t.name.toLowerCase().includes(query));
    matches = matches.slice(0, 50);
    resultsDiv.innerHTML = '';
    if (matches.length === 0 && query) {
        const btn = document.createElement("span");
        btn.style.cssText = 'display:inline-flex;align-items:center;padding:4px 10px;background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;color:var(--accent)';
        btn.textContent = '＋ 创建: "' + input.value.trim() + '"';
        btn.onclick = async () => {
            const name = input.value.trim();
            if (!name) return;
            const tag = await dbCreateTag(name, '#3B82F6');
            await loadTags();
            addFormTag(tag.id);
            input.value = '';
            onFormTagSearch();
        };
        resultsDiv.appendChild(btn);
    } else {
        matches.forEach(t => {
            const btn = document.createElement("span");
            btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--surface-dim);border:1px solid var(--border-light);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;transition:all .15s';
            const dot = document.createElement("span");
            dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + t.color + ';flex-shrink:0';
            const nameSpan = document.createElement("span");
            nameSpan.textContent = t.name;
            btn.appendChild(dot);
            btn.appendChild(nameSpan);
            // 长按进入管理模式
            const startLP = () => { _formTagLongPressTimer = setTimeout(() => { _formTagManageMode = !_formTagManageMode; onFormTagSearch(); }, 500); };
            const cancelLP = () => clearTimeout(_formTagLongPressTimer);
            btn.onmousedown = startLP; btn.onmouseup = cancelLP; btn.onmouseleave = cancelLP;
            btn.ontouchstart = startLP; btn.ontouchend = cancelLP; btn.ontouchcancel = cancelLP;
            // 管理模式下加 × 按钮
            if (_formTagManageMode) {
                const rm = document.createElement("span");
                rm.textContent = "×";
                rm.style.cssText = "font-size:10px;padding:1px 5px;margin-left:2px;border-radius:50%;background:rgba(0,0,0,.08);cursor:pointer;line-height:1";
                rm.onclick = async (ev) => {
                    ev.stopPropagation();
                    const used = allQuestions.some(q => q.question_tags && q.question_tags.some(qt => qt.tags && qt.tags.id === t.id));
                    if (used) { showStatus("该标签已被题目使用，请到标签管理中删除", "error"); return; }
                    if (!confirm("确定删除标签「" + t.name + "」吗？")) return;
                    await dbDeleteTag(t.id); allTags = allTags.filter(x => x.id !== t.id);
                    onFormTagSearch(); showStatus("已删除: " + t.name, "success");
                };
                btn.appendChild(rm);
                btn.onclick = null; // 管理模式下不触发选中
            } else {
                btn.onclick = () => { addFormTag(t.id); input.value = ''; onFormTagSearch(); };
            }
            btn.onmouseenter = () => { if (!_formTagManageMode) { btn.style.background = 'var(--primary-light)'; btn.style.borderColor = 'var(--primary)'; } };
            btn.onmouseleave = () => { btn.style.background = 'var(--surface-dim)'; btn.style.borderColor = 'var(--border-light)'; };
            resultsDiv.appendChild(btn);
        });
    }
}

function onFormTagKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const resultsDiv = document.getElementById('form-tag-results');
        const first = resultsDiv ? resultsDiv.querySelector('span') : null;
        if (first) first.click();
    }
}

function addFormTag(tagId) {
    if (formSelectedTagIds.includes(tagId)) return;
    formSelectedTagIds.push(tagId);
    renderFormSelectedTags();
}

function removeFormTag(tagId) {
    formSelectedTagIds = formSelectedTagIds.filter(id => id !== tagId);
    renderFormSelectedTags();
    onFormTagSearch();
}

async function createTagFromSearch() {
    const input = document.getElementById('form-tag-search');
    const name = (input?.value || '').trim();
    if (!name) { showStatus("请输入标签名", "error"); return; }
    let tag = allTags.find(t => t.name === name);
    if (!tag) { tag = await dbCreateTag(name, '#3B82F6'); allTags.push(t); }
    if (!formSelectedTagIds.includes(tag.id)) { formSelectedTagIds.push(tag.id); renderFormSelectedTags(); }
    input.value = ''; onFormTagSearch();
    showStatus("已添加标签: " + name, "success");
}

function renderFormSelectedTags() {
    const div = document.getElementById('form-tag-selected');
    if (!div) return;
    div.innerHTML = '';
    formSelectedTagIds.forEach(tagId => {
        const tag = allTags.find(t => t.id === tagId);
        if (!tag) return;
        const el = document.createElement("span");
        el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:' + tag.color + '15;border:1px solid ' + tag.color + '40;border-radius:var(--radius-xl);font-size:12px;font-weight:500;color:var(--text)';
        el.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + tag.color + '"></span> ' + tag.name + ' <span style="cursor:pointer;color:var(--text-tertiary);margin-left:2px" onclick="removeFormTag(\'' + tag.id + '\')">✕</span>';
        div.appendChild(el);
    });
}
function toggleFilterTags() {
    const toggle = document.getElementById('filter-toggle');
    const tags = document.getElementById('filter-tags');
    const collapsed = tags.classList.toggle('collapsed');
    toggle.classList.toggle('expanded', !collapsed);
    localStorage.setItem('filterTagsExpanded', collapsed ? '0' : '1');
}
function renderFilterTags() {
    const c = document.getElementById("filter-tags"); c.replaceChildren();
    const badge = document.getElementById('filter-badge');
    if (badge) { badge.textContent = activeFilterTags.length; badge.style.display = activeFilterTags.length ? 'inline' : 'none'; }
    const expanded = localStorage.getItem('filterTagsExpanded') === '1';
    if (expanded) { c.classList.remove('collapsed'); document.getElementById('filter-toggle').classList.add('expanded'); }
    else { c.classList.add('collapsed'); document.getElementById('filter-toggle').classList.remove('expanded'); }
    const all = document.createElement("span"); all.className = "filter-tag" + (!activeFilterTags.length ? " active" : "");
    all.textContent = "全部"; all.onclick = () => { activeFilterTags = []; renderFilterTags(); renderQuestions(); }; c.appendChild(all);
    allTags.forEach(tag => {
        const el = document.createElement("span");
        const isActive = activeFilterTags.includes(tag.id);
        el.className = "filter-tag" + (isActive ? " active" : ""); el.textContent = tag.name;
        if (isActive) { el.style.background = tag.color; el.style.color = "#fff"; el.style.borderColor = tag.color; } else { el.style.borderColor = tag.color; }
        el.onclick = () => {
            if (isActive) activeFilterTags = activeFilterTags.filter(id => id !== tag.id);
            else activeFilterTags.push(tag.id);
            renderFilterTags(); renderQuestions();
        };
        c.appendChild(el);
    });
}
document.getElementById("tag-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("tag-name").value.trim(), color = document.getElementById("tag-color").value;
    if (!name) return;
    await dbCreateTag(name, color); document.getElementById("tag-name").value = ""; await loadTags(); showStatus("标签添加成功", "success");
});
async function deleteTag(id) { if (!confirm("确定删除这个标签吗？")) return; await dbDeleteTag(id); await refreshAll(); }

// ========== 新建标签弹窗 ==========
function showNewTagModal(ctx) { newTagContext = ctx; document.getElementById("new-tag-modal").classList.add("active"); document.getElementById("new-tag-name").focus(); }
function closeNewTagModal() { document.getElementById("new-tag-modal").classList.remove("active"); document.getElementById("new-tag-name").value = ""; }
async function submitNewTag() {
    const name = document.getElementById("new-tag-name").value.trim(), color = document.getElementById("new-tag-color").value;
    if (!name) return;
    const tag = await dbCreateTag(name, color); await loadTags(); closeNewTagModal();
    // 自动选中新标签
    if (newTagContext === 'form') {
        addFormTag(tag.id);
    } else if (newTagContext === 'paper') {
        const sel = document.getElementById("paper-tag-select");
        for (const o of sel.options) { if (o.value === tag.id) o.selected = true; }
    }
    showStatus("标签创建成功", "success");
}

// ========== 题目 ==========
let currentAddMode = 'photo'; // 'photo' or 'text' or 'batch'
let batchRowCount = 0;
let openInlineTagAddId = null;
let openInlineTagSearchValue = '';
let isFormDirty = false;

function switchAddMode(mode) {
    currentAddMode = mode;
    const photoSection = document.getElementById('photo-section');
    const batchSection = document.getElementById('batch-section');
    const bookSection = document.getElementById('book-info-section');
    const photoBtn = document.getElementById('mode-photo-btn');
    const textBtn = document.getElementById('mode-text-btn');
    const batchBtn = document.getElementById('mode-batch-btn');
    const questionLabel = document.getElementById('question-image-label');
    
    // 重置所有按钮样式
    [photoBtn, textBtn, batchBtn].forEach(btn => {
        btn.style.background = 'var(--surface-dim)';
        btn.style.color = 'var(--text-secondary)';
        btn.style.boxShadow = '0 3px 0 var(--border)';
    });
    
    if (mode === 'photo') {
        photoSection.style.display = '';
        batchSection.style.display = 'none';
        bookSection.style.display = '';
        photoBtn.style.background = 'var(--primary)';
        photoBtn.style.color = '#fff';
        photoBtn.style.boxShadow = '0 3px 0 var(--primary-dark)';
        questionLabel.textContent = '题目图片（笔记）*';
        if (isNative && MediaPlugin) {
            loadGalleryThumbnails('question');
            loadGalleryThumbnails('answer');
        }
    } else if (mode === 'text') {
        photoSection.style.display = 'none';
        batchSection.style.display = 'none';
        bookSection.style.display = '';
        textBtn.style.background = 'var(--primary)';
        textBtn.style.color = '#fff';
        textBtn.style.boxShadow = '0 3px 0 var(--primary-dark)';
    } else if (mode === 'batch') {
        photoSection.style.display = 'none';
        batchSection.style.display = '';
        bookSection.style.display = 'none';
        batchBtn.style.background = 'var(--primary)';
        batchBtn.style.color = '#fff';
        batchBtn.style.boxShadow = '0 3px 0 var(--primary-dark)';
        if (document.getElementById('batch-rows').children.length === 0) addBatchRow();
        const lastBookName = localStorage.getItem('lastBookName');
        if (lastBookName) document.getElementById('batch-book-name').value = lastBookName;
    }
}

function addBatchRow() {
    batchRowCount++;
    const rowId = 'batch-row-' + batchRowCount;
    const container = document.getElementById('batch-rows');
    const row = document.createElement('div');
    row.id = rowId;
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
    row.innerHTML = `
        <input type="number" placeholder="页码" class="batch-page" style="flex:1;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
        <input type="text" placeholder="题号" class="batch-number" style="flex:1;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
        <button type="button" onclick="removeBatchRow('${rowId}')" style="padding:6px 10px;background:var(--danger);box-shadow:0 2px 0 #B02520;font-size:12px;border:none;border-radius:var(--radius-sm);cursor:pointer;color:#fff">✕</button>
    `;
    container.appendChild(row);
}

function removeBatchRow(rowId) {
    const container = document.getElementById('batch-rows');
    const row = document.getElementById(rowId);
    if (row && container.children.length > 1) {
        row.remove();
    }
}

function getBatchEntries() {
    const entries = [];
    const rows = document.querySelectorAll('#batch-rows > div');
    rows.forEach(row => {
        const page = row.querySelector('.batch-page').value.trim();
        const number = row.querySelector('.batch-number').value.trim();
        if (page || number) entries.push({ page, number });
    });
    return entries;
}

document.getElementById("question-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const qi = croppedImages.question, ai = croppedImages.answer, bi = croppedImages.blank;
    const tags = [...formSelectedTagIds];
    const versions = getSelectedVersions();
    const bookName = document.getElementById("book-name").value.trim();
    const pageNumber = document.getElementById("page-number").value.trim();
    const questionNumber = document.getElementById("question-number").value.trim();
    
    // 批量模式处理
    if (currentAddMode === 'batch') {
        const batchBookName = document.getElementById("batch-book-name").value.trim();
        const entries = getBatchEntries();
        const tags = [...formSelectedTagIds];
        if (!batchBookName) { showStatus("请输入书名", "error"); return; }
        if (entries.length === 0) { showStatus("请添加至少一道题目", "error"); return; }
        
        try {
            const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = "处理中...";
            let count = 0;
            for (const entry of entries) {
                const bookInfo = { book_name: batchBookName, page_number: entry.page, question_number: entry.number };
                await dbCreateQuestion(null, null, tags, 0, null, versions, bookInfo);
                count++;
            }
            localStorage.setItem('lastBookName', batchBookName);
            document.getElementById('batch-rows').innerHTML = '';
            addBatchRow();
            formSelectedTagIds = []; renderFormSelectedTags();
            resetVersionCheckboxes();
            await loadQuestions(); await loadBookFilter();
            showStatus(`成功添加 ${count} 道题目`, "success");
            btn.disabled = false; btn.textContent = "添加题目";
        } catch (err) { showStatus("批量添加失败: " + err.message, "error"); e.target.querySelector('button[type="submit"]').disabled = false; e.target.querySelector('button[type="submit"]').textContent = "添加题目"; }
        return;
    }
    
    // 纯文字模式：至少需要书本信息之一
    if (currentAddMode === 'text' && !bookName && !pageNumber && !questionNumber) {
        showStatus("纯文字模式下请至少填写一项书本信息", "error"); return;
    }
    // 拍照模式：需要图片
    if (currentAddMode === 'photo' && !qi) { showStatus("请先选择题目图片", "error"); return; }
    
    const lr = document.querySelector('input[name="layout_type"]:checked');
    const lt = lr ? parseInt(lr.value) : 0;
    const bookInfo = (pageNumber || questionNumber) ? { book_name: bookName, page_number: pageNumber, question_number: questionNumber } : null;
    
    try {
        const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = "处理中...";
        const newQuestion = await dbCreateQuestion(qi, ai, tags, lt, bi, versions, bookInfo);

        // 创建主版本笔记（仅有图片时）
        const textNote = (document.getElementById("form-text-note")?.value || "").trim();
        if (qi) await dbAddQuestionNote(newQuestion.id, qi, "笔记 v1", textNote);

        // 保存评价
        const comment = document.getElementById("form-comment").value.trim();
        if (comment) {
            await dbQuestions.setItem(newQuestion.id, { ...newQuestion, user_comment: comment, updated_at: new Date().toISOString() });
            _invalidateQuestionsCache();
        }

        // 创建额外版本笔记
        let noteIdx = 2;
        for (const ev of extraNoteVersions) {
            if (ev.image) {
                const labelInput = document.getElementById("extra_" + ev.idx + "-label");
                const label = (labelInput ? labelInput.value.trim() : "") || "笔记 v" + noteIdx;
                await dbAddQuestionNote(newQuestion.id, ev.image, label, "");
                noteIdx++;
            }
        }
        extraNoteVersions = [];
        extraNoteVersionCounter = 0;
        document.getElementById("extra-note-versions").innerHTML = "";

        removeImage("question"); removeImage("answer"); removeImage("blank");
        formSelectedTagIds = []; renderFormSelectedTags();
        document.querySelectorAll('.layout-option').forEach(l => { l.style.borderColor = '#e5e7eb'; l.style.background = '#fff'; });
        resetVersionCheckboxes();
        if (bookName) localStorage.setItem('lastBookName', bookName);
        document.getElementById("page-number").value = "";
        document.getElementById("question-number").value = "";
        document.getElementById("form-comment").value = "";
        document.getElementById("form-text-note").value = "";
        clearFormGeneratedTags();
        await loadQuestions(); await loadBookFilter();
        showStatus("题目添加成功", "success");
        btn.disabled = false; btn.textContent = "添加题目";
    } catch (err) { showStatus("添加失败: " + err.message, "error"); e.target.querySelector('button[type="submit"]').disabled = false; e.target.querySelector('button[type="submit"]').textContent = "添加题目"; }
});
async function loadQuestions() { allQuestions = await dbGetAllQuestions(); renderQuestions(); }

let currentBookFilter = '';
let allBookNames = [];

async function loadBookFilter() {
    allBookNames = await dbGetAllBookNames();
    const select = document.getElementById('book-filter');
    select.innerHTML = '<option value="">📚 全部书本</option>';
    allBookNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = '📖 ' + name;
        select.appendChild(opt);
    });
    const datalist = document.getElementById('book-name-list');
    if (datalist) {
        datalist.innerHTML = '';
        allBookNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            datalist.appendChild(opt);
        });
    }
}

function filterByBook(bookName) {
    currentBookFilter = bookName;
    renderQuestions();
}

function fuzzyMatchTags(searchText) {
    if (!searchText || !allTags.length) return [];
    const q = searchText.toLowerCase().trim();
    if (!q) return [];
    const results = [];
    for (const tag of allTags) {
        const name = (tag.name || '').toLowerCase();
        if (!name) continue;
        let score = 0, type = '';
        if (name.includes(q)) {
            score = 100;
            type = '精确匹配';
        } else if (q.includes(name) && name.length >= 2) {
            score = 90;
            type = '包含标签';
        } else {
            let qi = 0;
            for (let ci = 0; ci < name.length && qi < q.length; ci++) {
                if (name[ci] === q[qi]) qi++;
            }
            if (qi === q.length && q.length >= 2) {
                score = 80;
                type = '顺序匹配';
            }
        }
        if (score === 0) {
            const qChars = new Set(q);
            const nChars = new Set(name);
            let intersection = 0;
            for (const c of qChars) { if (nChars.has(c)) intersection++; }
            const union = new Set([...qChars, ...nChars]).size;
            const jaccard = intersection / union;
            if (jaccard >= 0.34 && intersection >= 2) {
                score = Math.round(40 + jaccard * 40);
                type = '相似';
            }
        }
        if (score > 0) results.push({ tag, score, type });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 5);
}
function showTagSuggestions() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('tag-suggest-dropdown');
    if (!input || !dropdown) return;
    const searchText = input.value.trim();
    if (!searchText) { dropdown.classList.remove('show'); dropdown.replaceChildren(); return; }
    const matches = fuzzyMatchTags(searchText);
    if (!matches.length) { dropdown.classList.remove('show'); dropdown.replaceChildren(); return; }
    dropdown.replaceChildren();
    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'tag-suggest-item';
        const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = m.tag.color || '#3B82F6';
        const label = document.createElement('span'); label.textContent = m.tag.name;
        const badge = document.createElement('span'); badge.className = 'match-type'; badge.textContent = m.type;
        item.appendChild(dot); item.appendChild(label); item.appendChild(badge);
        item.onclick = () => {
            input.value = m.tag.name;
            dropdown.classList.remove('show');
            dropdown.replaceChildren();
            filterQuestions();
            input.focus();
        };
        dropdown.appendChild(item);
    });
    dropdown.classList.add('show');
}
function filterQuestions() {
    showTagSuggestions();
    renderQuestions();
}
function getFilteredQuestions() {
    const currentVersionId = getCurrentVersionId();
    const searchText = document.getElementById('search-input')?.value?.toLowerCase()?.trim() || '';
    let filtered = allQuestions.filter(q => {
        const versions = q.versions || [];
        return versions.length === 0 || versions.includes(currentVersionId);
    });
    if (activeFilterTags.length) {
        filtered = filtered.filter(q => { const qt = q.question_tags.map(t => t.tags.id); return activeFilterTags.some(f => qt.includes(f)); });
    }
    if (currentBookFilter) {
        filtered = filtered.filter(q => q.book_name === currentBookFilter);
    }
    if (searchText) {
        filtered = filtered.filter(q => {
            const bookMatch = (q.book_name || '').toLowerCase().includes(searchText);
            const pageMatch = (q.page_number || '').toLowerCase().includes(searchText);
            const numMatch = (q.question_number || '').toLowerCase().includes(searchText);
            const tagMatch = q.question_tags.some(t => t.tags.name.toLowerCase().includes(searchText));
            const summaryMatch = (q.semantic_summary || '').toLowerCase().includes(searchText);
            return bookMatch || pageMatch || numMatch || tagMatch || summaryMatch;
        });
    }
    return filtered;
}
function renderQuestions() {
    const container = document.getElementById("questions-list");
    const filtered = getFilteredQuestions();
    const currentVersionId = getCurrentVersionId();
    const currentVersion = getAppVersionById(currentVersionId);
    document.getElementById("question-count").textContent = activeFilterTags.length ? `(筛选: ${filtered.length}/${allQuestions.length})` : `(${filtered.length}/${allQuestions.length})`;
    updateSelectedCount();
    if (!filtered.length) { container.innerHTML = '<div class="empty-state"><div class="icon">📝</div>暂无题目</div>'; return; }
    container.replaceChildren();
    filtered.forEach(q => {
        const tags = q.question_tags.map(qt => qt.tags);
        const avail = allTags.filter(t => !tags.some(qt => qt.id === t.id));
        const isChecked = selectedQuestions.has(q.id), inBasket = questionBasket.has(q.id);
        const card = document.createElement("div"); card.className = "question-card" + (isChecked ? " selected" : ""); card.dataset.id = q.id;
        // checkbox
        const cb = document.createElement("button"); cb.className = "q-checkbox" + (isChecked ? " checked" : "");
        cb.textContent = isChecked ? "✓" : "";
        cb.onclick = (ev) => { ev.stopPropagation(); toggleQuestionSelect(q.id, cb); };
        card.appendChild(cb);
        // image or placeholder
        const img = document.createElement("img");
        if (q.question_image_url) {
            img.src = q.question_image_url; img.alt = "题目"; img.loading = "lazy";
        } else {
            img.style.background = 'linear-gradient(135deg, var(--primary-light) 0%, var(--surface-dim) 100%)';
            img.style.display = 'flex';
            img.style.alignItems = 'center';
            img.style.justifyContent = 'center';
            img.style.fontSize = '32px';
            img.alt = "纯文字题目";
            img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="130" viewBox="0 0 160 130"><rect fill="%23E8F5EE" width="160" height="130"/><text x="80" y="60" text-anchor="middle" font-size="28" fill="%231B7A4E">📝</text><text x="80" y="85" text-anchor="middle" font-size="11" fill="%235F6368">纯文字题目</text></svg>');
        }
        img.onclick = () => showQuestionDetail(q.id); card.appendChild(img);
        // info
        const info = document.createElement("div"); info.className = "info"; info.onclick = () => showQuestionDetail(q.id);
        
        // 书本信息
        if (q.book_name || q.page_number || q.question_number) {
            const bookWrap = document.createElement("div");
            bookWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;font-size:10px;color:var(--text-secondary)';
            if (q.book_name) bookWrap.innerHTML += '<span style="background:var(--primary-light);padding:1px 6px;border-radius:8px">📖 ' + q.book_name + '</span>';
            if (q.page_number) bookWrap.innerHTML += '<span style="background:var(--surface-dim);padding:1px 6px;border-radius:8px">p.' + q.page_number + '</span>';
            if (q.question_number) bookWrap.innerHTML += '<span style="background:var(--surface-dim);padding:1px 6px;border-radius:8px">第' + q.question_number + '题</span>';
            info.appendChild(bookWrap);
        }


        // AI 摘要展示
        if (q.semantic_summary && q.semantic_summary !== "AI 正在分析中...") {
            const summaryWrap = document.createElement("div");
            summaryWrap.className = "ai-summary-wrap";
            summaryWrap.innerHTML = '<span class="ai-badge">AI</span> <span class="summary-text">' + q.semantic_summary + '</span>';
            info.appendChild(summaryWrap);
        }

        const tagsWrap = document.createElement("div"); tagsWrap.className = "tags";
        tags.forEach(t => { const te = document.createElement("span"); te.className = "tag"; te.style.background = t.color + "20"; te.textContent = t.name; tagsWrap.appendChild(te); });
        const addBtn = document.createElement("span"); addBtn.className = "tag-add-btn"; addBtn.textContent = "+";
        addBtn.onclick = (ev) => { ev.stopPropagation(); toggleInlineTagAdd(q.id); }; tagsWrap.appendChild(addBtn);
        const inlineAdd = document.createElement("div"); inlineAdd.id = "inline-add-" + q.id; inlineAdd.className = "inline-tag-add hidden";
        inlineAdd.onclick = (ev) => ev.stopPropagation();
        inlineAdd.innerHTML = `<input type="text" id="inline-tag-search-${q.id}" placeholder="🔍 搜索或输入标签名..." oninput="onInlineTagSearch('${q.id}')" onfocus="startInlinePoll('${q.id}')" onblur="stopInlinePoll('${q.id}')" onkeydown="onInlineTagKeydown(event,'${q.id}')" />
            <div id="inline-tag-results-${q.id}" class="inline-tag-results"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button onclick="showNewTagModal('form')" style="padding:4px 10px;font-size:11px;background:var(--accent);box-shadow:0 2px 0 #5A3DC0">＋ 新建标签</button>
                <button onclick="toggleInlineTagAdd('${q.id}')" class="secondary" style="padding:4px 10px;font-size:11px">关闭</button>
            </div>
            <div id="inline-tag-added-${q.id}" class="inline-tag-added" style="display:none"></div>`;
        info.appendChild(tagsWrap); info.appendChild(inlineAdd); card.appendChild(info);
        container.appendChild(card);
    });
    restoreInlineTagAdd();
}
function restoreInlineTagAdd() {
    try {
        if (!openInlineTagAddId) return;
        const el = document.getElementById("inline-add-" + openInlineTagAddId);
        if (el) {
            el.classList.remove("hidden");
            const input = document.getElementById("inline-tag-search-" + openInlineTagAddId);
            if (input) { input.value = openInlineTagSearchValue; input.focus(); }
            onInlineTagSearch(openInlineTagAddId);
        }
    } catch (e) { console.error("恢复标签弹窗失败:", e); }
}
function toggleInlineTagAdd(id) {
    const el = document.getElementById("inline-add-" + id);
    el.classList.toggle("hidden");
    if (!el.classList.contains("hidden")) {
        openInlineTagAddId = id;
        openInlineTagSearchValue = '';
        const input = document.getElementById("inline-tag-search-" + id);
        if (input) { input.value = ''; input.focus(); }
        onInlineTagSearch(id);
    } else {
        openInlineTagAddId = null;
        openInlineTagSearchValue = '';
    }
}

let _inlinePollTimers = {};
function startInlinePoll(qId) { _inlinePollTimers[qId] = setInterval(() => { const inp = document.getElementById('inline-tag-search-' + qId); if (inp && inp.value !== (inp._lastVal||'')) { inp._lastVal = inp.value; onInlineTagSearch(qId); } }, 150); }
function stopInlinePoll(qId) { clearInterval(_inlinePollTimers[qId]); delete _inlinePollTimers[qId]; }

function onInlineTagSearch(qId) {
    const input = document.getElementById("inline-tag-search-" + qId);
    const resultsDiv = document.getElementById("inline-tag-results-" + qId);
    if (!input || !resultsDiv) return;
    const query = input.value.trim().toLowerCase();
    if (openInlineTagAddId === qId) openInlineTagSearchValue = query;
    const question = allQuestions.find(q => q.id === qId);
    const existingTagIds = question ? question.question_tags.map(qt => qt.tags.id) : [];
    let matches = allTags.filter(t => !existingTagIds.includes(t.id));
    if (query) matches = matches.filter(t => t.name.toLowerCase().includes(query));
    matches = matches.slice(0, 12);
    resultsDiv.innerHTML = '';
    if (matches.length === 0 && query) {
        const createBtn = document.createElement("span");
        createBtn.className = "inline-tag-result";
        createBtn.style.cssText = 'background:var(--accent-light);border-color:var(--accent);color:var(--accent)';
        createBtn.textContent = '＋ 创建: "' + input.value.trim() + '"';
        createBtn.onclick = async (ev) => {
            ev.stopPropagation();
            const name = input.value.trim();
            if (!name) return;
            const tag = await dbCreateTag(name, '#3B82F6');
            await dbAddTagToQuestion(qId, tag.id);
            input.value = '';
            allTags.push(tag);
            showAddedTag(qId, tag);
            onInlineTagSearch(qId);
        };
        resultsDiv.appendChild(createBtn);
    } else {
        matches.forEach(t => {
            const btn = document.createElement("span");
            btn.className = "inline-tag-result";
            btn.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + t.color + ';flex-shrink:0"></span> ' + t.name;
            btn.onclick = async (ev) => {
                ev.stopPropagation();
                await dbAddTagToQuestion(qId, t.id);
                showAddedTag(qId, t);
                onInlineTagSearch(qId);
            };
            resultsDiv.appendChild(btn);
        });
    }
}

function onInlineTagKeydown(event, qId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const resultsDiv = document.getElementById("inline-tag-results-" + qId);
        const firstResult = resultsDiv ? resultsDiv.querySelector(".inline-tag-result") : null;
        if (firstResult) firstResult.click();
    }
}

function showAddedTag(qId, tag) {
    const addedDiv = document.getElementById("inline-tag-added-" + qId);
    if (!addedDiv) return;
    addedDiv.style.display = 'flex';
    const span = document.createElement("span");
    span.className = "tag";
    span.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + tag.color + '"></span> ' + tag.name + ' ✓';
    addedDiv.appendChild(span);
    const question = allQuestions.find(q => q.id === qId);
    if (question) question.question_tags.push({ tags: tag });
    const card = document.querySelector('[data-id="' + qId + '"]');
    if (card) {
        const tagsWrap = card.querySelector('.tags');
        if (tagsWrap) {
            const addBtn = tagsWrap.querySelector('.tag-add-btn');
            const te = document.createElement("span"); te.className = "tag"; te.style.background = tag.color + "20"; te.textContent = tag.name;
            if (addBtn) tagsWrap.insertBefore(te, addBtn); else tagsWrap.appendChild(te);
        }
    }
}



// ========== 批量选择 ==========
function toggleQuestionSelect(qId, btn) {
    if (selectedQuestions.has(qId)) { selectedQuestions.delete(qId); btn.classList.remove("checked"); btn.textContent = ""; btn.closest(".question-card").classList.remove("selected"); }
    else { selectedQuestions.add(qId); btn.classList.add("checked"); btn.textContent = "✓"; btn.closest(".question-card").classList.add("selected"); }
    updateSelectedCount();
}
function updateSelectedCount() {
    const el = document.getElementById("selected-count");
    if (selectedQuestions.size > 0) { el.style.display = "inline"; document.getElementById("selected-num").textContent = selectedQuestions.size; }
    else el.style.display = "none";
}

// ========== 笔记版本管理 ==========
let currentNoteVersions = [];
let currentNoteVersionId = null;
let addNoteVersionImage = null;
let extraNoteVersions = [];
let extraNoteVersionCounter = 0;

async function loadNoteVersionsForDetail(questionId) {
    const myToken = ++_detailLoadToken;
    currentNoteVersions = await dbGetQuestionNotes(questionId);
    if (myToken !== _detailLoadToken) return;
    const select = document.getElementById("modal-note-version-select");
    const bar = document.getElementById("modal-note-version-bar");
    const imgDiv = document.getElementById("modal-question-image");
    const textDiv = document.getElementById("modal-question-text-note");

    if (currentNoteVersions.length === 0) {
        // 迁移：使用旧的 question_image_url
        const q = allQuestions.find(q => q.id === questionId);
        if (q && q.question_image_url) {
            const note = await dbAddQuestionNote(questionId, q.question_image_url, '笔记 v1', '');
            currentNoteVersions = [note];
        }
    }

    if (currentNoteVersions.length === 0) {
        bar.style.display = "none";
        imgDiv.innerHTML = '<div style="text-align:center;padding:20px"><p style="color:var(--text-tertiary);margin-bottom:12px">暂无题目图片</p><button onclick="showAddNoteVersionModal()" style="padding:8px 16px;font-size:13px">📷 添加题目图片</button></div>';
        textDiv.style.display = "none";
        return;
    }

    bar.style.display = "flex";
    select.innerHTML = "";
    currentNoteVersions.forEach(n => {
        const opt = document.createElement("option");
        opt.value = n.id;
        opt.textContent = n.label || "笔记";
        select.appendChild(opt);
    });

    // 恢复上次查看的版本
    const lastId = dbGetLastViewedNote(questionId);
    const lastNote = currentNoteVersions.find(n => n.id === lastId);
    if (lastNote) {
        select.value = lastId;
    }

    displayCurrentNoteVersion();
}

async function displayCurrentNoteVersion() {
    const select = document.getElementById("modal-note-version-select");
    const noteId = select.value;
    const note = currentNoteVersions.find(n => n.id === noteId);
    if (!note) return;

    currentNoteVersionId = noteId;
    dbSetLastViewedNote(currentQuestionId, noteId);

    const imgDiv = document.getElementById("modal-question-image");
    imgDiv.innerHTML = '<img src="' + note.note_image_url + '" style="max-width:100%;border-radius:8px">';

    const textarea = document.getElementById("modal-question-text-note");
    textarea.value = note.text_note || "";
}

function saveTextNote() {
    if (!currentNoteVersionId) return;
    const textarea = document.getElementById("modal-question-text-note");
    const text = textarea.value;
    dbUpdateQuestionNote(currentNoteVersionId, { text_note: text });
    const note = currentNoteVersions.find(n => n.id === currentNoteVersionId);
    if (note) note.text_note = text;
    showStatus("笔记已保存", "success");
}

function switchNoteVersion(noteId) {
    displayCurrentNoteVersion();
}

function showAddNoteVersionModal() {
    addNoteVersionImage = null;
    document.getElementById("note-version-label").value = "";
    document.getElementById("note-version-text").value = "";
    document.getElementById("note-version-preview-wrap").style.display = "none";
    document.getElementById("add-note-version-modal").classList.add("active");
}

function closeAddNoteVersionModal() {
    document.getElementById("add-note-version-modal").classList.remove("active");
    addNoteVersionImage = null;
}

function takePhotoForNoteVersion(target) {
    if (isNative && Camera) {
        Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' })
            .then(photo => {
                addNoteVersionImage = photo.dataUrl;
                document.getElementById("note-version-preview").src = photo.dataUrl;
                document.getElementById("note-version-preview-wrap").style.display = "inline-block";
            })
            .catch(e => { if (e.message !== 'User cancelled photos app') showStatus("拍照失败: " + e.message, "error"); });
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    addNoteVersionImage = ev.target.result;
                    document.getElementById("note-version-preview").src = ev.target.result;
                    document.getElementById("note-version-preview-wrap").style.display = "inline-block";
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}

function pickFromGalleryForNoteVersion(target) {
    if (isNative && Camera) {
        Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' })
            .then(photo => {
                addNoteVersionImage = photo.dataUrl;
                document.getElementById("note-version-preview").src = photo.dataUrl;
                document.getElementById("note-version-preview-wrap").style.display = "inline-block";
            })
            .catch(e => { if (e.message !== 'User cancelled photos app') showStatus("选择图片失败: " + e.message, "error"); });
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    addNoteVersionImage = ev.target.result;
                    document.getElementById("note-version-preview").src = ev.target.result;
                    document.getElementById("note-version-preview-wrap").style.display = "inline-block";
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}

function removeNoteVersionImage() {
    addNoteVersionImage = null;
    document.getElementById("note-version-preview-wrap").style.display = "none";
}

async function confirmAddNoteVersion() {
    if (!currentQuestionId) return;
    if (!addNoteVersionImage) { showStatus("请先选择题目图片", "error"); return; }
    const label = document.getElementById("note-version-label").value.trim() || "笔记 " + (currentNoteVersions.length + 1);
    const textNote = document.getElementById("note-version-text").value.trim();
    const note = await dbAddQuestionNote(currentQuestionId, addNoteVersionImage, label, textNote);
    closeAddNoteVersionModal();
    await loadNoteVersionsForDetail(currentQuestionId);
    // 切换到新添加的版本
    document.getElementById("modal-note-version-select").value = note.id;
    displayCurrentNoteVersion();
    showStatus("笔记版本已添加", "success");
}

// ========== 创建时额外版本管理 ==========
function addExtraNoteVersion() {
    extraNoteVersionCounter++;
    const idx = extraNoteVersionCounter;
    const container = document.getElementById("extra-note-versions");
    const div = document.createElement("div");
    div.style.cssText = "margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:var(--radius-md)";
    div.id = "extra-note-" + idx;
    div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;color:var(--text-secondary);font-weight:600">版本 ${idx + 1}</span>
            <button type="button" onclick="removeExtraNoteVersion(${idx})" style="padding:2px 8px;font-size:11px;background:var(--danger);color:#fff;border:none;border-radius:4px;cursor:pointer">删除</button>
        </div>
        <div class="upload-buttons">
            <button type="button" class="upload-btn camera" onclick="takePhotoForExtra('extra_${idx}')" style="font-size:12px;padding:10px">📷 拍照</button>
            <button type="button" class="upload-btn" onclick="pickFromGalleryForExtra('extra_${idx}')" style="background:var(--surface-dim);color:var(--text-secondary);box-shadow:0 2px 0 var(--border);font-size:12px;padding:10px">🖼️ 相册</button>
        </div>
        <div class="preview-wrap" id="extra_${idx}-preview-wrap" style="display:none">
            <span class="preview-delete" onclick="removeExtraImage(${idx})">×</span>
            <img id="extra_${idx}-preview" class="preview-image" />
        </div>
        <input type="text" id="extra_${idx}-label" placeholder="版本名称（可选）" style="width:100%;margin-top:6px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
    `;
    container.appendChild(div);
    extraNoteVersions.push({ idx, image: null });
}

function removeExtraNoteVersion(idx) {
    const div = document.getElementById("extra-note-" + idx);
    if (div) div.remove();
    extraNoteVersions = extraNoteVersions.filter(v => v.idx !== idx);
}

function removeExtraImage(idx) {
    const ev = extraNoteVersions.find(v => v.idx === idx);
    if (ev) ev.image = null;
    document.getElementById("extra_" + idx + "-preview-wrap").style.display = "none";
}

function takePhotoForExtra(target) {
    const idx = parseInt(target.split("_")[1]);
    if (isNative && Camera) {
        Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' })
            .then(photo => {
                const ev = extraNoteVersions.find(v => v.idx === idx);
                if (ev) ev.image = photo.dataUrl;
                document.getElementById("extra_" + idx + "-preview").src = photo.dataUrl;
                document.getElementById("extra_" + idx + "-preview-wrap").style.display = "inline-block";
            })
            .catch(e => { if (e.message !== 'User cancelled photos app') showStatus("拍照失败: " + e.message, "error"); });
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const evObj = extraNoteVersions.find(v => v.idx === idx);
                    if (evObj) evObj.image = ev.target.result;
                    document.getElementById("extra_" + idx + "-preview").src = ev.target.result;
                    document.getElementById("extra_" + idx + "-preview-wrap").style.display = "inline-block";
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}

function pickFromGalleryForExtra(target) {
    const idx = parseInt(target.split("_")[1]);
    if (isNative && Camera) {
        Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' })
            .then(photo => {
                const ev = extraNoteVersions.find(v => v.idx === idx);
                if (ev) ev.image = photo.dataUrl;
                document.getElementById("extra_" + idx + "-preview").src = photo.dataUrl;
                document.getElementById("extra_" + idx + "-preview-wrap").style.display = "inline-block";
            })
            .catch(e => { if (e.message !== 'User cancelled photos app') showStatus("选择图片失败: " + e.message, "error"); });
    } else {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const evObj = extraNoteVersions.find(v => v.idx === idx);
                    if (evObj) evObj.image = ev.target.result;
                    document.getElementById("extra_" + idx + "-preview").src = ev.target.result;
                    document.getElementById("extra_" + idx + "-preview-wrap").style.display = "inline-block";
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
        input.click();
    }
}

// ========== 详情弹窗 + 前后切换 ==========
function showQuestionDetail(qId) {
    currentQuestionId = qId;
    filteredList = getFilteredQuestions();
    detailIndex = filteredList.findIndex(q => q.id === qId); if (detailIndex < 0) detailIndex = 0;
    renderDetailContent(filteredList[detailIndex]);
    document.getElementById("question-modal").classList.add("active");
    updatePendingLinkBtnStyle(qId);
}
let _detailLoadToken = 0;
function renderDetailContent(q) {
    _detailLoadToken++;
    document.getElementById("modal-question-image").innerHTML = '<div style="text-align:center;padding:20px"><p style="color:var(--text-tertiary)">加载中...</p></div>';
    loadNoteVersionsForDetail(q.id);

    document.getElementById("modal-answer-image").innerHTML = q.answer_image_url ? '<h3 style="margin-top:12px">答案</h3><img src="' + q.answer_image_url + '" style="max-width:100%;border-radius:8px">' : '<p style="color:#999;margin-top:12px">无答案图片</p>';
    const tags = q.question_tags.map(qt => qt.tags);
    document.getElementById("modal-tags").innerHTML = tags.length ? '<h3 style="margin-top:12px">标签（点击移除）</h3><div class="tag-container">' + tags.map(t => '<span class="tag" style="background:' + t.color + '20;border:1px solid ' + t.color + ';cursor:pointer" onclick="removeTagFromQuestion(\'' + t.id + '\')">' + t.name + ' ✕</span>').join("") + '</div>' : '';

    // 版本归属编辑
    const versions = q.versions || [];
    const allVersions = getAppVersions();
    let versionHtml = '<h3 style="margin-top:12px">适用版本</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
    allVersions.forEach(v => {
        const checked = versions.includes(v.id);
        versionHtml += `<div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border:1.5px solid ${checked ? v.theme.primary : 'var(--border)'};border-radius:var(--radius-md);cursor:pointer;font-size:12px;transition:border-color .2s,background-color .2s;background:${checked ? v.theme.primaryLight : 'var(--surface)'}" onclick="if(event.target.tagName!=='INPUT'){var cb=this.querySelector('input');cb.checked=!cb.checked;var p=cb.parentElement;p.style.borderColor=cb.checked?'${v.theme.primary}':'var(--border)';p.style.background=cb.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',cb.checked)}"><input type="checkbox" onchange="var p=this.parentElement;p.style.borderColor=this.checked?'${v.theme.primary}':'var(--border)';p.style.background=this.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',this.checked)" ${checked ? 'checked' : ''} style="accent-color:${v.theme.primary};width:18px;height:18px;cursor:pointer;flex-shrink:0"><span>${v.emoji} ${v.name}</span></div>`;
    });
    versionHtml += '</div><small style="color:#888;font-size:11px">不勾选则所有版本均可见</small>';
    document.getElementById("modal-tags").innerHTML += versionHtml;
    
    // 书本信息编辑
    const bookHtml = `<h3 style="margin-top:12px">📖 书本信息</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
            <input id="detail-book-name" placeholder="书名" value="${q.book_name || ''}" style="flex:2;min-width:100px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
            <input id="detail-page-number" placeholder="页码" value="${q.page_number || ''}" style="flex:1;min-width:60px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
            <input id="detail-question-number" placeholder="题号" value="${q.question_number || ''}" style="flex:1;min-width:60px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
        </div>
        <button onclick="saveBookInfo('${q.id}')" style="margin-top:8px;padding:6px 14px;font-size:12px">保存书本信息</button>`;
    document.getElementById("modal-tags").innerHTML += bookHtml;

    // 复习提醒开关
    const reviewEnabled = q.review_enabled || false;
    const reviewNextDate = q.review_next_date || '未设置';
    const reviewCount = q.review_count || 0;
    const reviewHtml = `<h3 style="margin-top:12px">🧠 复习提醒</h3>
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
                <input type="checkbox" ${reviewEnabled ? 'checked' : ''} onchange="toggleReviewForQuestion('${q.id}')" style="accent-color:var(--accent);width:18px;height:18px;cursor:pointer" />
                开启艾宾浩斯复习提醒
            </label>
        </div>
        ${reviewEnabled ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">已复习 ${reviewCount} 次 · 下次复习: ${reviewNextDate}</div>` : ''}`;
    document.getElementById("modal-tags").innerHTML += reviewHtml;

    renderSimilarQuestions(q.id);
    // AI 摘要
    const aiDiv = document.getElementById("modal-ai-summary");
    const aiText = document.getElementById("modal-ai-text");
    if (q.semantic_summary && q.semantic_summary !== "" && q.semantic_summary !== "AI 正在分析中...") {
        aiDiv.style.display = "block";
        aiText.textContent = q.semantic_summary;
    } else {
        aiDiv.style.display = "none";
    }
    // 用户评价
    const userComment = q.user_comment || "";
    const commentInput = document.getElementById("user-comment");
    if (commentInput && document.activeElement !== commentInput) {
        commentInput.value = userComment;
    }
    document.getElementById("detail-nav-info").textContent = (detailIndex + 1) + " / " + filteredList.length;
    document.getElementById("btn-prev").disabled = detailIndex <= 0; document.getElementById("btn-prev").style.opacity = detailIndex <= 0 ? 0.4 : 1;
    document.getElementById("btn-next").disabled = detailIndex >= filteredList.length - 1; document.getElementById("btn-next").style.opacity = detailIndex >= filteredList.length - 1 ? 0.4 : 1;
    updateDetailBasketBtn(q.id);
}

async function toggleQuestionVersion(questionId, versionId, checked) {
    const q = await dbQuestions.getItem(questionId);
    if (!q) return;
    let versions = q.versions || [];
    if (checked) {
        if (!versions.includes(versionId)) versions.push(versionId);
    } else {
        versions = versions.filter(v => v !== versionId);
    }
    await dbUpdateQuestionVersions(questionId, versions);
    await loadQuestions();
    showStatus('版本归属已更新', 'success');
}

async function saveBookInfo(questionId) {
    const bookName = document.getElementById('detail-book-name').value.trim();
    const pageNumber = document.getElementById('detail-page-number').value.trim();
    const questionNumber = document.getElementById('detail-question-number').value.trim();
    await dbUpdateQuestionBookInfo(questionId, {
        book_name: bookName,
        page_number: pageNumber,
        question_number: questionNumber
    });
    await loadQuestions();
    await loadBookFilter();
    showStatus('书本信息已保存', 'success');
}

function updateDetailBasketBtn(qId) {
    const btn = document.getElementById("detail-basket-btn");
    if (questionBasket.has(qId)) { btn.textContent = "✓"; btn.style.background = "#3B82F6"; btn.style.color = "#fff"; }
    else { btn.textContent = "🧺"; btn.style.background = "rgba(255,255,255,.9)"; btn.style.color = "#333"; }
}
function toggleBasketInDetail() { if (!currentQuestionId) return; toggleBasket(currentQuestionId); updateDetailBasketBtn(currentQuestionId); renderQuestions(); }
function navigateDetail(dir) { const ni = detailIndex + dir; if (ni < 0 || ni >= filteredList.length) return; detailIndex = ni; currentQuestionId = filteredList[ni].id; renderDetailContent(filteredList[ni]); }
function closeModal() { document.getElementById("question-modal").classList.remove("active"); currentQuestionId = null; }

async function renderSimilarQuestions(qId) {
    const wrap = document.getElementById("modal-similar-questions");
    if (!wrap) return;
    const ids = await dbGetSimilarQuestionIds(qId);
    const questions = allQuestions.filter(q => ids.includes(q.id));
    wrap.replaceChildren();
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:16px";
    title.textContent = "相似题" + (questions.length ? "（" + questions.length + "）" : "");
    const add = document.createElement("button");
    add.textContent = "添加相似题";
    add.style.cssText = "padding:6px 12px;font-size:12px";
    add.onclick = openSimilarModal;
    head.append(title, add);
    wrap.appendChild(head);
    if (!questions.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size:12px;color:#888;padding:8px;background:#f9fafb;border-radius:8px";
        empty.textContent = "暂无相似题关联";
        wrap.appendChild(empty);
        return;
    }
    const list = document.createElement("div");
    list.className = "similar-list";
    questions.forEach(q => {
        const card = document.createElement("div");
        card.className = "similar-card";
        card.onclick = () => showQuestionDetail(q.id);
        const img = document.createElement("img");
        img.src = q.question_image_url;
        img.style.cursor = "pointer";
        img.onclick = (e) => {
            e.preventDefault();
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out";
            overlay.onclick = () => overlay.remove();
            const big = document.createElement("img");
            big.src = q.question_image_url;
            big.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px";
            overlay.appendChild(big);
            document.body.appendChild(overlay);
        };
        const title = document.createElement("div");
        title.className = "similar-title";
        title.textContent = q.user_comment || q.semantic_summary || q.question_tags.map(qt => qt.tags.name).join("、") || "相似题";
        const remove = document.createElement("button");
        remove.className = "danger";
        remove.style.cssText = "width:100%;padding:5px 8px;font-size:11px;margin-top:6px";
        remove.textContent = "移除关联";
        remove.onclick = async (event) => {
            event.stopPropagation();
            await dbRemoveSimilarQuestionLink(qId, q.id);
            await loadQuestions();
            await renderSimilarQuestions(qId);
            showStatus("已移除相似题关联", "success");
        };
        card.append(img, title, remove);
        list.appendChild(card);
    });
    wrap.appendChild(list);
}

function getQuestionFeatureText(q) {
    return [q.user_comment || "", q.semantic_summary || "", q.question_tags?.map(qt => qt.tags.name).join(" ") || ""].join(" ");
}

function getTextSignalSet(text) {
    return new Set(String(text || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").split("").filter(ch => ch.trim()));
}

function scoreTextSimilarity(a, b) {
    const left = getTextSignalSet(a), right = getTextSignalSet(b);
    if (!left.size || !right.size) return 0;
    let score = 0;
    left.forEach(ch => { if (right.has(ch)) score++; });
    return score;
}

async function buildSimilarCandidates() {
    if (!currentQuestionId) return [];
    const current = allQuestions.find(q => q.id === currentQuestionId);
    if (!current) return [];
    const selectedTagIds = Array.from(document.getElementById("similar-tag-select").selectedOptions).map(o => o.value);
    const linkedIds = await dbGetSimilarQuestionIds(currentQuestionId);
    const currentText = getQuestionFeatureText(current);
    return allQuestions
        .filter(q => q.id !== currentQuestionId && !linkedIds.includes(q.id))
        .map(q => {
            const tagIds = q.question_tags.map(qt => qt.tags.id);
            const tagHit = selectedTagIds.filter(id => tagIds.includes(id)).length;
            const textHit = scoreTextSimilarity(currentText, getQuestionFeatureText(q));
            return { q, tagHit, textHit, score: tagHit * 20 + Math.min(textHit, 20) };
        })
        .filter(item => !selectedTagIds.length || item.tagHit > 0)
        .sort((a, b) => b.score - a.score || new Date(b.q.created_at) - new Date(a.q.created_at));
}

async function openSimilarModal() {
    if (!currentQuestionId) return;
    const current = allQuestions.find(q => q.id === currentQuestionId);
    const sel = document.getElementById("similar-tag-select");
    sel.replaceChildren();
    const currentTagIds = new Set((current?.question_tags || []).map(qt => qt.tags.id));
    allTags.forEach(tag => {
        const option = document.createElement("option");
        option.value = tag.id;
        option.textContent = tag.name;
        option.selected = currentTagIds.has(tag.id);
        sel.appendChild(option);
    });
    similarAiReasons = new Map();
    document.getElementById("similar-ai-reason").style.display = "none";
    document.getElementById("similar-modal").classList.add("active");
    document.getElementById("btn-pending-similar-count").textContent = getPendingLinkList().length;
    await renderSimilarCandidates();
}

function closeSimilarModal() {
    document.getElementById("similar-modal").classList.remove("active");
    similarCandidates = [];
    similarAiReasons = new Map();
}

async function renderSimilarCandidates(aiPickedIds = null) {
    similarCandidates = await buildSimilarCandidates();
    const list = document.getElementById("similar-candidate-list");
    list.replaceChildren();
    if (!similarCandidates.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.style.padding = "24px 12px";
        empty.textContent = "没有找到可关联的候选题";
        list.appendChild(empty);
        return;
    }
    const picked = new Set(aiPickedIds || []);
    similarCandidates.forEach(item => {
        const q = item.q;
        const row = document.createElement("label");
        row.className = "similar-result" + (picked.has(q.id) ? " ai-picked" : "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = q.id;
        checkbox.checked = picked.has(q.id);
        const img = document.createElement("img");
        img.src = q.question_image_url;
        const body = document.createElement("div");
        const title = document.createElement("div");
        title.style.cssText = "font-size:13px;font-weight:600;color:#374151;line-height:1.4";
        title.textContent = q.user_comment || q.semantic_summary || "候选相似题";
        const meta = document.createElement("div");
        meta.className = "similar-meta";
        const tagNames = q.question_tags.map(qt => qt.tags.name).join("、") || "无标签";
        meta.textContent = "标签命中 " + item.tagHit + "｜" + tagNames;
        body.append(title, meta);
        const reason = similarAiReasons.get(q.id);
        if (reason) {
            const reasonEl = document.createElement("div");
            reasonEl.className = "similar-meta";
            reasonEl.style.color = "#5b21b6";
            reasonEl.textContent = "AI：" + reason;
            body.appendChild(reasonEl);
        } else if (q.semantic_summary && q.semantic_summary !== "AI 正在分析中...") {
            const summary = document.createElement("div");
            summary.className = "similar-meta";
            summary.textContent = q.semantic_summary;
            body.appendChild(summary);
        }
        row.append(checkbox, img, body);
        list.appendChild(row);
    });
}

async function loadPendingLinkCandidates() {
    if (!currentQuestionId) return;
    const pendingIds = getPendingLinkList();
    if (!pendingIds.length) { showStatus("待关联列表为空", "error"); return; }
    const linkedIds = await dbGetSimilarQuestionIds(currentQuestionId);
    const available = pendingIds.filter(id => !linkedIds.includes(id));
    document.getElementById("btn-pending-similar-count").textContent = available.length;
    const list = document.getElementById("similar-candidate-list");
    list.replaceChildren();
    if (!available.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.style.padding = "24px 12px";
        empty.textContent = "待关联列表中的题目都已关联";
        list.appendChild(empty);
        return;
    }
    available.forEach(id => {
        const q = allQuestions.find(q => q.id === id);
        if (!q) return;
        const row = document.createElement("label");
        row.className = "similar-result";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = q.id;
        checkbox.checked = true;
        const img = document.createElement("img");
        img.src = q.question_image_url;
        const body = document.createElement("div");
        const title = document.createElement("div");
        title.style.cssText = "font-size:13px;font-weight:600;color:#374151;line-height:1.4";
        title.textContent = q.user_comment || q.semantic_summary || "题目 " + q.id.substring(0, 8);
        const meta = document.createElement("div");
        meta.className = "similar-meta";
        const tagNames = (q.question_tags || []).map(qt => qt.tags.name).join("、") || "无标签";
        meta.textContent = "待关联｜" + tagNames;
        body.append(title, meta);
        row.append(checkbox, img, body);
        list.appendChild(row);
    });
    document.getElementById("similar-modal").classList.add("active");
}

function parseSimilarAIResult(text) {
    try {
        const match = String(text || "").match(/\{[\s\S]*\}/);
        if (match) {
            const data = JSON.parse(match[0]);
            return {
                ids: Array.isArray(data.recommended_ids) ? data.recommended_ids : [],
                reasons: data.reasons && typeof data.reasons === "object" ? data.reasons : {},
                summary: data.summary || data.reason || ""
            };
        }
        const arr = String(text || "").match(/\[[\s\S]*\]/);
        if (arr) return { ids: JSON.parse(arr[0]), reasons: {}, summary: "" };
    } catch (e) {}
    return { ids: [], reasons: {}, summary: String(text || "").slice(0, 120) };
}

async function recommendSimilarWithAI() {
    if (!currentQuestionId) return;
    const current = allQuestions.find(q => q.id === currentQuestionId);
    const candidates = (await buildSimilarCandidates()).slice(0, 30);
    if (!current || !candidates.length) { showStatus("没有可推荐的候选题", "error"); return; }
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "推荐中...";
    try {
        const prompt = `你是题库相似题推荐助手。请根据当前题目的参考标签、用户评价原话、AI摘要，从候选题中推荐最相似的题目。
只输出JSON，不要解释正文。格式：
{"recommended_ids":["候选题ID"],"reasons":{"候选题ID":"推荐原因"},"summary":"整体推荐思路"}

当前题：
${JSON.stringify({
    id: current.id,
    tags: current.question_tags.map(qt => qt.tags.name),
    user_comment: current.user_comment || "",
    summary: current.semantic_summary || ""
})}

候选题：
${JSON.stringify(candidates.map(item => ({
    id: item.q.id,
    tags: item.q.question_tags.map(qt => qt.tags.name),
    user_comment: item.q.user_comment || "",
    summary: item.q.semantic_summary || "",
    tag_hit: item.tagHit
})))}`;
        const resultText = await callCloudAI(prompt);
        const parsed = parseSimilarAIResult(resultText);
        const validIds = new Set(candidates.map(item => item.q.id));
        const picked = parsed.ids.filter(id => validIds.has(id)).slice(0, 10);
        similarAiReasons = new Map(Object.entries(parsed.reasons || {}));
        const reasonEl = document.getElementById("similar-ai-reason");
        reasonEl.textContent = parsed.summary || "AI 已按评价原话、标签和摘要重新排序候选题。";
        reasonEl.style.display = "flex";
        await renderSimilarCandidates(picked);
        showStatus("AI 推荐完成", "success");
    } catch (e) {
        showStatus("AI 推荐失败: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "AI 推荐";
    }
}

async function confirmSimilarLinks() {
    if (!currentQuestionId) return;
    const ids = Array.from(document.querySelectorAll("#similar-candidate-list input[type='checkbox']:checked")).map(input => input.value);
    if (!ids.length) { showStatus("请先勾选要关联的相似题", "error"); return; }
    await dbAddSimilarQuestionLinks(currentQuestionId, ids);
    ids.forEach(id => { if (isPendingLink(id)) removeFromPendingLink(id); });
    await loadQuestions();
    await renderSimilarQuestions(currentQuestionId);
    closeSimilarModal();
    showStatus("已关联 " + ids.length + " 道相似题", "success");
}

// 触摸滑动
(function() {
    let sx=0,sy=0,st=0; const m=document.getElementById("question-modal");
    m.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;st=Date.now();},{passive:true});
    m.addEventListener('touchend',e=>{if(!m.classList.contains('active'))return;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy,dt=Date.now()-st;if(Math.abs(dx)>60&&dt<500&&Math.abs(dy)<100){dx<0?navigateDetail(1):navigateDetail(-1);}},{passive:true});
})();

// ========== 删除(软删除) ==========
async function deleteQuestion() {
    if (!currentQuestionId || !confirm("确定将这道题目移至垃圾篓吗？")) return;
    await dbSoftDeleteQuestion(currentQuestionId); closeModal(); await Promise.all([loadQuestions(), loadPapers()]);
}

// ========== 垃圾篓 ==========
async function loadTrashed() {
    trashedQuestions = await dbGetTrashedQuestions();
    document.getElementById("trash-count").textContent = "(" + trashedQuestions.length + ")";
    const c = document.getElementById("trash-list");
    if (!trashedQuestions.length) { c.innerHTML = '<div class="empty-state">垃圾篓是空的</div>'; return; }
    c.replaceChildren();
    trashedQuestions.forEach(q => {
        const card = document.createElement("div"); card.className = "paper-card";
        const img = document.createElement("img"); img.src = q.question_image_url; img.style.maxWidth = "100%"; img.style.maxHeight = "120px"; img.style.objectFit = "contain"; img.style.borderRadius = "8px";
        const bg = document.createElement("div"); bg.className = "btn-group"; bg.style.marginTop = "10px";
        const rb = document.createElement("button"); rb.className = "success"; rb.textContent = "恢复"; rb.onclick = async () => { await dbRestoreQuestion(q.id); await Promise.all([loadTrashed(), loadQuestions()]); showStatus("已恢复", "success"); };
        const db = document.createElement("button"); db.className = "danger"; db.textContent = "彻底删除"; db.onclick = async () => { if (!confirm("确定彻底删除？不可恢复！")) return; await dbPermanentDeleteQuestion(q.id); await loadTrashed(); showStatus("已彻底删除", "success"); };
        bg.append(rb, db); card.append(img, bg); c.appendChild(card);
    });
}

// ========== 试卷 ==========
document.getElementById("paper-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("paper-name").value.trim();
    const tags = Array.from(document.getElementById("paper-tag-select").selectedOptions).map(o => o.value);
    if (!name) return;
    await dbCreatePaper(name, tags); document.getElementById("paper-form").reset(); await loadPapers(); showStatus("试卷创建成功", "success");
});
async function loadPapers() {
    const papers = await dbGetAllPapers(); const c = document.getElementById("papers-list");
    if (!papers.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📋</div>暂无试卷</div>'; return; }
    c.replaceChildren();
    papers.forEach(p => {
        const card = document.createElement("div"); card.className = "paper-card";
        const title = document.createElement("h3");
        title.textContent = p.name;
        const count = document.createElement("p");
        count.textContent = "题目数量: " + (p.question_count || 0);
        const created = document.createElement("p");
        created.textContent = "创建时间: " + new Date(p.created_at).toLocaleString();
        const bg = document.createElement("div"); bg.className = "btn-group"; bg.style.marginTop = "10px";
        const dl = document.createElement("button"); dl.textContent = "下载 PDF"; dl.onclick = () => generatePaperPDF(p.id);
        const vw = document.createElement("button"); vw.className = "secondary"; vw.textContent = "查看题目"; vw.onclick = () => showPaperDetail(p.id);
        const del = document.createElement("button"); del.className = "danger"; del.textContent = "删除"; del.onclick = async () => { if (!confirm("确定删除？")) return; await dbDeletePaper(p.id); await loadPapers(); };
        bg.append(dl, vw, del); card.append(title, count, created, bg); c.appendChild(card);
    });
}
async function showPaperDetail(pId) {
    currentPaperId = pId;
    const { paper, questions } = await dbGetPaperQuestions(pId); if (!paper) return;
    document.getElementById("paper-modal-title").textContent = paper.name;
    const c = document.getElementById("paper-modal-questions");
    if (!questions.length) { c.innerHTML = '<p style="color:#999">该试卷暂无题目</p>'; }
    else { c.replaceChildren(); questions.forEach((q, i) => { const d = document.createElement("div"); d.style.cssText = "margin-bottom:16px;padding:10px;background:#f9f9f9;border-radius:8px"; d.innerHTML = '<p style="font-weight:500;margin-bottom:8px">第' + (i+1) + '题</p><img src="' + q.question_image_url + '" style="max-width:100%;border-radius:6px">' + (q.answer_image_url ? '<p style="font-weight:500;margin:8px 0 4px;color:#666">答案:</p><img src="' + q.answer_image_url + '" style="max-width:100%;border-radius:6px">' : ''); c.appendChild(d); }); }
    document.getElementById("paper-modal").classList.add("active");
}
function closePaperModal() { document.getElementById("paper-modal").classList.remove("active"); }

function exportPaperAsPDF() {
    if (!currentPaperId) return;
    generatePaperPDF(currentPaperId);
}

function exportPaperAsImages() {
    if (!currentPaperId) return;
    // 获取试卷名称作为默认文件夹名
    const title = document.getElementById("paper-modal-title").textContent;
    document.getElementById("export-images-folder").value = title || '';
    document.getElementById("export-images-summary").textContent = '';
    document.getElementById("export-images-progress").style.display = 'none';
    document.getElementById("export-images-modal").classList.add("active");
}

function getExportImgMode() { return localStorage.getItem('exportImgMode') || 'manual'; }
function setExportImgMode(m) { localStorage.setItem('exportImgMode', m); updateExportImgModeBtn(); }
function updateExportImgModeBtn() {
    const btn = document.getElementById('export-img-mode-btn');
    if (!btn) return;
    const m = getExportImgMode();
    btn.textContent = m === 'manual' ? '✏️ 手动输入' : '⚡ 自动填入';
    btn.title = m === 'manual' ? '点击切换为自动填入' : '点击切换为手动输入';
}
function toggleExportImgMode() {
    setExportImgMode(getExportImgMode() === 'manual' ? 'auto' : 'manual');
}

function _doExportImagesModalConfirm() {
    const folderName = document.getElementById("export-images-folder").value.trim();
    if (!folderName) { alert('请输入文件夹名称'); return; }
    const basketQuestions = window._exportQuestions;
    if (basketQuestions && basketQuestions.length && !currentPaperId) {
        closeExportImagesModal();
        _runExportImagesFromBasket(basketQuestions, folderName);
    } else {
        doExportImages();
    }
}

function closeExportImagesModal() {
    document.getElementById("export-images-modal").classList.remove("active");
}

// 公共函数：导出图片列表到文件夹
async function exportImagesToFolder(imageList, folderName, answerImageList) {
    if (!imageList || !imageList.length) { alert('没有可导出的图片'); return false; }

    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

    if (!isNative || !Filesystem) {
        alert('图片文件夹导出功能仅支持原生 App（Android/iOS）');
        return false;
    }

    try {
        let directory = 'DOCUMENTS';

        // 创建主文件夹
        try {
            await Filesystem.mkdir({ path: folderName, directory, recursive: true });
        } catch (e) { /* 文件夹可能已存在 */ }

        // 导出题目图片
        for (let i = 0; i < imageList.length; i++) {
            const img = imageList[i];
            const progress = ((i + 1) / imageList.length) * 100;
            document.getElementById("export-images-progress-bar").style.width = progress + '%';
            document.getElementById("export-images-progress-text").textContent = `导出题目图片... (${i + 1}/${imageList.length})`;

            try {
                let blob;
                if (img.url.startsWith('data:')) {
                    const res = await fetch(img.url);
                    blob = await res.blob();
                } else if (img.url.startsWith('http')) {
                    const res = await fetch(img.url);
                    blob = await res.blob();
                } else {
                    console.warn('不支持的图片格式:', img.url);
                    continue;
                }

                const base64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(blob);
                });

                await Filesystem.writeFile({
                    path: `${folderName}/${img.name}`,
                    data: base64,
                    directory
                });
            } catch (e) {
                console.warn('导出图片失败:', img.name, e.message);
            }
        }

        // 导出答案图片（如果有）
        if (answerImageList && answerImageList.length > 0) {
            const answerFolder = `${folderName}/答案`;
            try {
                await Filesystem.mkdir({ path: answerFolder, directory, recursive: true });
            } catch (e) { /* 文件夹可能已存在 */ }

            for (let i = 0; i < answerImageList.length; i++) {
                const img = answerImageList[i];
                if (!img.url) continue; // 跳过没有答案的题目

                document.getElementById("export-images-progress-text").textContent = `导出答案图片... (${i + 1}/${answerImageList.length})`;

                try {
                    let blob;
                    if (img.url.startsWith('data:')) {
                        const res = await fetch(img.url);
                        blob = await res.blob();
                    } else if (img.url.startsWith('http')) {
                        const res = await fetch(img.url);
                        blob = await res.blob();
                    } else {
                        console.warn('不支持的答案图片格式:', img.url);
                        continue;
                    }

                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.readAsDataURL(blob);
                    });

                    await Filesystem.writeFile({
                        path: `${answerFolder}/${img.name}`,
                        data: base64,
                        directory
                    });
                } catch (e) {
                    console.warn('导出答案图片失败:', img.name, e.message);
                }
            }
        }

        return true;
    } catch (e) {
        console.error('导出失败:', e);
        alert('导出失败: ' + e.message);
        return false;
    }
}

async function doExportImagesFromBasket() {
    const questions = window._exportQuestions;
    if (!questions || !questions.length) { alert('没有可导出的题目'); return; }

    if (getExportImgMode() === 'auto') {
        const folderName = "题库导出_" + new Date().toISOString().slice(0, 10);
        await _runExportImagesFromBasket(questions, folderName);
    } else {
        document.getElementById("export-images-folder").value = '';
        document.getElementById("export-images-summary").textContent = '';
        document.getElementById("export-images-progress").style.display = 'none';
        document.getElementById("export-images-modal").classList.add("active");
    }
}

async function _runExportImagesFromBasket(questions, folderName) {
    // 合并用户选择的文件夹
    const selectedFolder = getExportFolder();
    if (selectedFolder) folderName = selectedFolder + '/' + folderName;

    const exportType = document.querySelector('input[name="export-type"]:checked')?.value || 'with_notes';

    // 定义导出任务
    const tasks = [];

    if (exportType === 'with_notes' || exportType === 'both') {
        const imageList = questions.map((q, i) => ({
            url: q.question_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        })).filter(img => img.url);

        const answerImageList = questions.map((q, i) => ({
            url: q.answer_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        }));

        tasks.push({
            folderName: folderName,
            imageList: imageList,
            answerImageList: answerImageList,
            label: '带笔记版'
        });
    }

    if (exportType === 'blank' || exportType === 'both') {
        const imageList = questions.map((q, i) => ({
            url: q.question_image_blank_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        })).filter(img => img.url); // 过滤掉没有空白版的题目

        const answerImageList = questions.map((q, i) => ({
            url: q.answer_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        }));

        tasks.push({
            folderName: exportType === 'both' ? folderName + '-空白' : folderName,
            imageList: imageList,
            answerImageList: answerImageList,
            label: '空白版'
        });
    }

    if (!tasks.length) { alert('没有可导出的图片'); return; }

    // 执行导出任务
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        document.getElementById("export-images-summary").textContent = `共 ${task.imageList.length} 张题目图片（${task.label}），准备导出...`;
        document.getElementById("export-images-progress").style.display = 'block';
        document.getElementById("export-images-progress-bar").style.width = '0%';
        document.getElementById("export-images-progress-text").textContent = '导出中...';

        const success = await exportImagesToFolder(task.imageList, task.folderName, task.answerImageList);
        if (!success) {
            document.getElementById("export-images-progress").style.display = 'none';
            return; // 如果失败，停止
        }

        if (i < tasks.length - 1) {
            // 还有下一个任务，等待一下再继续
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // 完成
    document.getElementById("export-images-progress-bar").style.width = '100%';
    document.getElementById("export-images-progress-text").textContent = '导出完成！';

    const taskLabels = tasks.map(t => t.label).join(' 和 ');
    const folderNames = tasks.length > 1 ? `${folderName}/ 和 ${folderName}-空白/` : `${folderName}/`;
    document.getElementById("export-images-summary").textContent = `✅ 已导出 ${taskLabels} 到 ${folderNames}`;
    setTimeout(() => closeExportImagesModal(), 2000);
}

async function doExportImages() {
    if (!currentPaperId) return;
    const folderName = document.getElementById("export-images-folder").value.trim();
    if (!folderName) { alert('请输入文件夹名称'); return; }

    const { paper, questions } = await dbGetPaperQuestions(currentPaperId);
    if (!questions || !questions.length) { alert('该试卷暂无题目'); return; }

    const exportType = document.querySelector('input[name="export-type"]:checked')?.value || 'with_notes';

    // 定义导出任务
    const tasks = [];

    if (exportType === 'with_notes' || exportType === 'both') {
        const imageList = questions.map((q, i) => ({
            url: q.question_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        })).filter(img => img.url);

        const answerImageList = questions.map((q, i) => ({
            url: q.answer_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        }));

        tasks.push({
            folderName: folderName,
            imageList: imageList,
            answerImageList: answerImageList,
            label: '带笔记版'
        });
    }

    if (exportType === 'blank' || exportType === 'both') {
        const imageList = questions.map((q, i) => ({
            url: q.question_image_blank_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        })).filter(img => img.url); // 过滤掉没有空白版的题目

        const answerImageList = questions.map((q, i) => ({
            url: q.answer_image_url,
            name: String(i + 1).padStart(3, '0') + '.jpg'
        }));

        tasks.push({
            folderName: exportType === 'both' ? folderName + '-空白' : folderName,
            imageList: imageList,
            answerImageList: answerImageList,
            label: '空白版'
        });
    }

    if (!tasks.length) { alert('没有可导出的图片'); return; }

    // 执行导出任务
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        document.getElementById("export-images-summary").textContent = `共 ${task.imageList.length} 张题目图片（${task.label}），准备导出...`;
        document.getElementById("export-images-progress").style.display = 'block';
        document.getElementById("export-images-progress-bar").style.width = '0%';
        document.getElementById("export-images-progress-text").textContent = '导出中...';

        const success = await exportImagesToFolder(task.imageList, task.folderName, task.answerImageList);
        if (!success) {
            document.getElementById("export-images-progress").style.display = 'none';
            return; // 如果失败，停止
        }

        if (i < tasks.length - 1) {
            // 还有下一个任务，等待一下再继续
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // 完成
    document.getElementById("export-images-progress-bar").style.width = '100%';
    document.getElementById("export-images-progress-text").textContent = '导出完成！';

    const taskLabels = tasks.map(t => t.label).join(' 和 ');
    const folderNames = tasks.length > 1 ? `${folderName}/ 和 ${folderName}-空白/` : `${folderName}/`;
    document.getElementById("export-images-summary").textContent = `✅ 已导出 ${taskLabels} 到 ${folderNames}`;
    setTimeout(() => closeExportImagesModal(), 2000);
}

// ========== 待处理照片 ==========
let currentProcessPhotoId = null;

async function showPendingPhotosTab() {
    showTab('pending-photos', document.querySelector('.tab[onclick*="pending-photos"]'));
    await loadPendingPhotos();
}

async function loadPendingPhotos() {
    const groups = await dbGetPendingPhotosGrouped();
    const c = document.getElementById("pending-photos-list");
    const countBadge = document.getElementById("pending-photos-count");
    const allPhotos = await dbGetPendingPhotos();

    if (allPhotos.length > 0) {
        countBadge.textContent = allPhotos.length;
        countBadge.style.display = "inline-block";
    } else {
        countBadge.style.display = "none";
    }

    if (!allPhotos.length) {
        c.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:30px">暂无待处理照片<br><small>长按 App 图标选择「快速拍照」</small></div>';
        return;
    }

    c.replaceChildren();
    const groupKeys = Object.keys(groups);

    groupKeys.forEach(gid => {
        const photos = groups[gid];
        const isUngrouped = gid === "未分组";
        const label = isUngrouped ? "📷 未分组" : "📌 " + gid.replace("group_", "第") + "组";

        // 组标题
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 0 6px;border-bottom:2px solid var(--border)";
        const title = document.createElement("div");
        title.textContent = label + " (" + photos.length + "张)";
        title.style.cssText = "font-size:14px;font-weight:700;color:var(--text)";
        header.appendChild(title);

        if (!isUngrouped && photos.length > 1) {
            const batchBtn = document.createElement("button");
            batchBtn.textContent = "批量处理";
            batchBtn.style.cssText = "padding:6px 14px;font-size:12px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer";
            batchBtn.onclick = () => openBatchProcessModal(gid);
            header.appendChild(batchBtn);
        }
        c.appendChild(header);

        // 照片列表
        const list = document.createElement("div");
        list.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;padding:8px 0";
        photos.forEach(p => {
            const item = document.createElement("div");
            item.style.cssText = "position:relative;cursor:pointer";
            item.onclick = () => openProcessPhotoModal(p.id);
            const img = document.createElement("img");
            img.src = p.image_url;
            img.style.cssText = "width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid var(--border-light)";
            const del = document.createElement("span");
            del.textContent = "×";
            del.style.cssText = "position:absolute;top:-4px;right:-4px;width:20px;height:20px;background:var(--danger);color:#fff;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer";
            del.onclick = (e) => { e.stopPropagation(); deletePendingPhotoById(p.id); };
            item.append(img, del);
            list.appendChild(item);
        });
        c.appendChild(list);
    });
}

let currentBatchGroupId = null;

async function openProcessPhotoModal(photoId) {
    currentProcessPhotoId = photoId;
    currentBatchGroupId = null;
    const photo = await dbPendingPhotos.getItem(photoId);
    if (!photo) return;

    document.getElementById("process-photo-img").src = photo.image_url;
    document.getElementById("process-photo-img").style.display = "block";
    document.getElementById("process-photo-label").value = "";

    const qSelect = document.getElementById("process-photo-question");
    qSelect.innerHTML = '<option value="">-- 新建题目 --</option>';
    allQuestions.filter(q => !q.deleted_at).forEach(q => {
        const opt = document.createElement("option");
        opt.value = q.id;
        opt.textContent = (q.semantic_summary || q.user_comment || q.id.substring(0, 8));
        qSelect.appendChild(opt);
    });

    const tSelect = document.getElementById("process-photo-tags");
    tSelect.innerHTML = "";
    allTags.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        tSelect.appendChild(opt);
    });

    document.getElementById("process-photo-modal").classList.add("active");
}

function openBatchProcessModal(groupId) {
    currentBatchGroupId = groupId;
    document.getElementById("process-photo-label").value = "";
    document.getElementById("process-photo-img").style.display = "none";

    const qSelect = document.getElementById("process-photo-question");
    qSelect.innerHTML = '<option value="">-- 新建题目 --</option>';
    allQuestions.filter(q => !q.deleted_at).forEach(q => {
        const opt = document.createElement("option");
        opt.value = q.id;
        opt.textContent = (q.semantic_summary || q.user_comment || q.id.substring(0, 8));
        qSelect.appendChild(opt);
    });

    const tSelect = document.getElementById("process-photo-tags");
    tSelect.innerHTML = "";
    allTags.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        tSelect.appendChild(opt);
    });

    document.getElementById("process-photo-modal").classList.add("active");
}

async function confirmProcessPhoto() {
    if (currentBatchGroupId) {
        // 批量处理模式
        const questionId = document.getElementById("process-photo-question").value;
        const label = document.getElementById("process-photo-label").value.trim();
        const tags = Array.from(document.getElementById("process-photo-tags").selectedOptions).map(o => o.value);

        const groups = await dbGetPendingPhotosGrouped();
        const photos = groups[currentBatchGroupId] || [];

        if (questionId) {
            for (let i = 0; i < photos.length; i++) {
                const v = label ? label + " v" + (i + 1) : "笔记 v" + (i + 1);
                await dbAddQuestionNote(questionId, photos[i].image_url, v, "");
                await dbMarkPendingPhotoProcessed(photos[i].id, questionId);
            }
            if (tags.length) {
                for (const tagId of tags) await dbAddTagToQuestion(questionId, tagId);
            }
        } else {
            const newQ = await dbCreateQuestion(photos[0].image_url, null, tags, 0, null, []);
            for (let i = 0; i < photos.length; i++) {
                const v = label ? label + " v" + (i + 1) : "笔记 v" + (i + 1);
                await dbAddQuestionNote(newQ.id, photos[i].image_url, v, "");
                await dbMarkPendingPhotoProcessed(photos[i].id, newQ.id);
            }
        }

        currentBatchGroupId = null;
        closeProcessPhotoModal();
        await loadPendingPhotos();
        await loadQuestions();
        showStatus("批量处理完成", "success");
        return;
    }

    // 单张处理模式
    if (!currentProcessPhotoId) return;
    const photo = await dbPendingPhotos.getItem(currentProcessPhotoId);
    if (!photo) return;

    const questionId = document.getElementById("process-photo-question").value;
    const label = document.getElementById("process-photo-label").value.trim() || "笔记 v1";
    const tags = Array.from(document.getElementById("process-photo-tags").selectedOptions).map(o => o.value);

    if (questionId) {
        await dbAddQuestionNote(questionId, photo.image_url, label, "");
        if (tags.length) {
            for (const tagId of tags) await dbAddTagToQuestion(questionId, tagId);
        }
    } else {
        const newQ = await dbCreateQuestion(photo.image_url, null, tags, 0, null, []);
        await dbAddQuestionNote(newQ.id, photo.image_url, label, "");
    }

    await dbMarkPendingPhotoProcessed(currentProcessPhotoId, questionId || "new");
    closeProcessPhotoModal();
    await loadPendingPhotos();
    await loadQuestions();
    showStatus("照片已处理", "success");
}

function closeProcessPhotoModal() {
    document.getElementById("process-photo-modal").classList.remove("active");
    currentProcessPhotoId = null;
}

async function confirmProcessPhoto() {
    if (!currentProcessPhotoId) return;
    const photo = await dbPendingPhotos.getItem(currentProcessPhotoId);
    if (!photo) return;

    const questionId = document.getElementById("process-photo-question").value;
    const label = document.getElementById("process-photo-label").value.trim() || "笔记 v1";
    const tags = Array.from(document.getElementById("process-photo-tags").selectedOptions).map(o => o.value);

    if (questionId) {
        // 关联到已有题目
        await dbAddQuestionNote(questionId, photo.image_url, label, "");
        if (tags.length) {
            for (const tagId of tags) {
                await dbAddTagToQuestion(questionId, tagId);
            }
        }
    } else {
        // 创建新题目
        const newQ = await dbCreateQuestion(photo.image_url, null, tags, 0, null, []);
        await dbAddQuestionNote(newQ.id, photo.image_url, label, "");
    }

    await dbMarkPendingPhotoProcessed(currentProcessPhotoId, questionId || "new");
    closeProcessPhotoModal();
    await loadPendingPhotos();
    await loadQuestions();
    showStatus("照片已处理", "success");
}

async function deletePendingPhoto() {
    if (!currentProcessPhotoId) return;
    if (!confirm("确定删除这张照片？")) return;
    await dbDeletePendingPhoto(currentProcessPhotoId);
    closeProcessPhotoModal();
    await loadPendingPhotos();
    showStatus("照片已删除", "success");
}

async function deletePendingPhotoById(photoId) {
    if (!confirm("确定删除这张照片？")) return;
    await dbDeletePendingPhoto(photoId);
    await loadPendingPhotos();
    showStatus("照片已删除", "success");
}

function closePendingPhotosModal() {
    document.getElementById("pending-photos-modal").classList.remove("active");
}

// ========== 专题管理 ==========
let currentTopicId = null;

function renderTopicQuestionPicker() {
    const container = document.getElementById("topic-question-picker");
    if (!container) return;
    const currentVersionId = getCurrentVersionId();
    const filtered = allQuestions.filter(q => {
        const versions = q.versions || [];
        return versions.length === 0 || versions.includes(currentVersionId);
    });
    container.innerHTML = '';
    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px">暂无题目</div>';
        return;
    }
    filtered.forEach(q => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border-light);cursor:pointer";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "topic_questions";
        cb.value = q.id;
        cb.style.cssText = "accent-color:var(--primary)";
        const img = document.createElement("img");
        img.src = q.question_image_url;
        img.style.cssText = "width:40px;height:40px;object-fit:contain;border-radius:4px;background:var(--surface-dim)";
        const info = document.createElement("div");
        info.style.cssText = "flex:1;font-size:13px;color:var(--text)";
        info.textContent = q.semantic_summary || q.user_comment || q.question_tags.map(qt => qt.tags.name).join("、") || "题目 " + q.id.substring(0, 8);
        label.append(cb, img, info);
        container.appendChild(label);
    });
}

function getSelectedTopicQuestions() {
    return Array.from(document.querySelectorAll('input[name="topic_questions"]:checked')).map(cb => cb.value);
}

document.getElementById("topic-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("topic-name").value.trim();
    const desc = document.getElementById("topic-desc").value.trim();
    if (!name) return;
    const questionIds = getSelectedTopicQuestions();
    await dbCreateTopic(name, desc, questionIds);
    document.getElementById("topic-form").reset();
    await loadTopics();
    showStatus("专题创建成功", "success");
});

async function loadTopics() {
    const topics = await dbGetAllTopics();
    const c = document.getElementById("topics-list");
    if (!topics.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📚</div>暂无专题</div>'; return; }
    c.replaceChildren();
    topics.forEach(t => {
        const card = document.createElement("div");
        card.className = "paper-card";
        const title = document.createElement("h3");
        title.textContent = t.name;
        const desc = document.createElement("p");
        desc.textContent = t.description || "暂无描述";
        desc.style.cssText = "color:var(--text-secondary);font-size:13px";
        const count = document.createElement("p");
        count.textContent = (t.question_count || 0) + " 题 · 创建于 " + new Date(t.created_at).toLocaleDateString();
        count.style.cssText = "color:var(--text-tertiary);font-size:12px";
        const bg = document.createElement("div");
        bg.className = "btn-group";
        bg.style.marginTop = "10px";
        const vw = document.createElement("button");
        vw.textContent = "查看";
        vw.onclick = () => showTopicDetail(t.id);
        const dl = document.createElement("button");
        dl.className = "secondary";
        dl.textContent = "导出 PDF";
        dl.onclick = () => exportTopicPDFForId(t.id);
        const del = document.createElement("button");
        del.className = "danger";
        del.textContent = "删除";
        del.onclick = async () => { if (!confirm("确定删除专题？")) return; await dbDeleteTopic(t.id); await loadTopics(); };
        bg.append(vw, dl, del);
        card.append(title, desc, count, bg);
        c.appendChild(card);
    });
}

async function showTopicDetail(topicId) {
    currentTopicId = topicId;
    const { topic, questions } = await dbGetTopicQuestions(topicId);
    if (!topic) return;
    document.getElementById("topic-detail-title").textContent = topic.name;
    document.getElementById("topic-detail-desc").textContent = topic.description || "";
    const c = document.getElementById("topic-detail-questions");
    if (!questions.length) {
        c.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:20px">该专题暂无题目</p>';
    } else {
        c.replaceChildren();
        questions.forEach((q, i) => {
            const d = document.createElement("div");
            d.style.cssText = "margin-bottom:16px;padding:12px;background:var(--surface-dim);border-radius:var(--radius-md)";
            const header = document.createElement("div");
            header.style.cssText = "font-weight:600;margin-bottom:8px;font-size:14px";
            header.textContent = "第" + (i + 1) + "题";
            const img = document.createElement("img");
            img.src = q.question_image_url;
            img.style.cssText = "max-width:100%;border-radius:6px;margin-bottom:8px";
            const commentLabel = document.createElement("div");
            commentLabel.style.cssText = "font-size:12px;color:var(--text-secondary);margin-bottom:4px;font-weight:600";
            commentLabel.textContent = "📝 教师评价";
            const textarea = document.createElement("textarea");
            textarea.value = q.teacher_comment || "";
            textarea.placeholder = "输入教师对这道题在本专题中的评价...";
            textarea.rows = 2;
            textarea.style.cssText = "width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;resize:none;margin-bottom:6px";
            const saveBtn = document.createElement("button");
            saveBtn.textContent = "保存评价";
            saveBtn.style.cssText = "padding:6px 14px;font-size:12px";
            saveBtn.onclick = async () => {
                await dbUpdateTopicQuestionComment(topicId, q.id, textarea.value);
                showStatus("评价已保存", "success");
            };
            d.append(header, img, commentLabel, textarea, saveBtn);
            c.appendChild(d);
        });
    }
    document.getElementById("topic-detail-modal").classList.add("active");
}

function closeTopicDetailModal() {
    document.getElementById("topic-detail-modal").classList.remove("active");
    currentTopicId = null;
}

async function exportTopicPDF() {
    if (!currentTopicId) return;
    await exportTopicPDFForId(currentTopicId);
}

async function exportTopicPDFForId(topicId) {
    const { topic, questions } = await dbGetTopicQuestions(topicId);
    if (!topic || !questions.length) { showStatus("专题暂无题目", "error"); return; }
    await generatePDF(questions, { mode: 'merged', title: topic.name });
    showStatus("PDF 已生成", "success");
}

async function deleteTopic() {
    if (!currentTopicId) return;
    if (!confirm("确定删除这个专题？")) return;
    await dbDeleteTopic(currentTopicId);
    closeTopicDetailModal();
    await loadTopics();
    showStatus("专题已删除", "success");
}

// ========== AI 智能组卷逻辑 ==========
let currentAIRecommendedIds = [];

async function startAIPaperGeneration() {
    const requirement = document.getElementById("ai-paper-requirement").value.trim();
    if (!requirement) { showStatus("请先输入您的组卷需求", "error"); return; }

    const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
    if (!Gemma4) { showStatus("AI 引擎未准备好 (仅限原生 App 使用)", "error"); return; }

    const status = await Gemma4.checkModelStatus();
    if (!status.ready) { showStatus("Gemma 4 模型尚未就绪，请先下载或发现模型", "error"); return; }

    showStatus("AI 正在根据您的需求筛选题目...", "success");

    // 1. 粗排 (Coarse-filter): 提取所有有摘要的题目，并进行初步过滤
    const candidates = allQuestions
        .filter(q => q.semantic_summary && q.semantic_summary !== "AI 正在分析中...")
        .map(q => ({
            id: q.id,
            tags: q.question_tags.map(t => t.tags.name),
            summary: q.semantic_summary,
            difficulty: q.ai_metadata?.difficulty || 0
        }));

    if (candidates.length === 0) {
        showStatus("题库中尚无经过 AI 分析的题目，请先添加题目并等待分析完成", "error");
        return;
    }

    try {
        // 2. 精排 (Rerank): 调用 Gemma 4 插件进行语义匹配
        const result = await Gemma4.recommendQuestions({
            requirement: requirement,
            candidatesJson: JSON.stringify(candidates.slice(0, 50)) // 传入前 50 道相关题目以防 Token 超限
        });

        // 3. 展示结果
        renderAIRecommendations(result.recommended_ids, result.reason);
    } catch (e) {
        showStatus("AI 推荐失败: " + e.message, "error");
    }
}

function renderAIRecommendations(ids, reason) {
    currentAIRecommendedIds = ids;
    const modal = document.getElementById("ai-recommend-modal");
    const reasonEl = document.getElementById("ai-recommend-reason");
    const listEl = document.getElementById("ai-recommend-list");

    reasonEl.innerHTML = '<strong>AI 推荐思路:</strong><br>' + (reason || "根据您的要求挑选了以下题目。");
    listEl.replaceChildren();

    const recommendedQuestions = allQuestions.filter(q => ids.includes(q.id));
    if (recommendedQuestions.length === 0) {
        listEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:20px;color:#999">未找到完全符合条件的题目</p>';
    } else {
        recommendedQuestions.forEach(q => {
            const card = document.createElement("div");
            card.className = "question-card";
            card.style.margin = "0";
            card.innerHTML = `<img src="${q.question_image_url}" style="height:100px"><div class="info"><div class="ai-summary-wrap" style="border-left-color:#10b981;margin:0;font-size:10px">${q.semantic_summary}</div></div>`;
            listEl.appendChild(card);
        });
    }

    document.getElementById("ai-create-paper-btn").onclick = () => createPaperFromAI(ids);
    modal.classList.add("active");
}

function closeAIRecommendModal() {
    document.getElementById("ai-recommend-modal").classList.remove("active");
}

async function createPaperFromAI(ids) {
    if (!ids || ids.length === 0) return;
    const name = "AI 推荐试卷 " + new Date().toLocaleDateString();

    // 复用 dbCreatePaper 的逻辑，但直接指定 ID 列表
    const id = generateId();
    const now = _nowIso();
    const paper = { id, name, created_at: now, updated_at: now, deleted_at: null };
    await dbPapers.setItem(id, paper);

    let n = 1;
    for (const qId of ids) {
        await dbPaperQuestions.setItem(`${id}_${qId}`, { paper_id: id, question_id: qId, order_num: n++ });
    }

    closeAIRecommendModal();
    await loadPapers();
    showStatus("AI 试卷已生成", "success");
    showTab('papers', document.querySelector('.tab[onclick*="papers"]'));
}

// ========== 导出 PDF ==========
function exportSelectedOrAll() {
    const filtered = getFilteredQuestions();
    const qs = selectedQuestions.size > 0 ? allQuestions.filter(q => selectedQuestions.has(q.id)) : filtered;
    showExportModal(qs);
}
function showExportModal(questions) {
    window._exportQuestions = questions;
    document.getElementById("export-summary").textContent = "将导出 " + questions.length + " 道题目";
    // 默认文件名带日期时间
    const now = new Date();
    const ts = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    document.getElementById("export-filename").value = "题库导出_" + ts;
    loadExportFolders();
    document.getElementById("export-modal").classList.add("active");
}

async function loadExportFolders() {
    const sel = document.getElementById("export-folder-select");
    sel.innerHTML = '<option value="">加载中...</option>';
    try {
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (isNative && window.Capacitor?.Plugins?.Filesystem) {
            const result = await window.Capacitor.Plugins.Filesystem.readdir({ path: '.', directory: 'DOCUMENTS' });
            const dirs = (result.files || []).filter(f => typeof f === 'object' && f.type === 'directory');
            sel.innerHTML = '';
            dirs.forEach(d => { const o = document.createElement('option'); o.value = d.name; o.textContent = '📁 ' + d.name; sel.appendChild(o); });
        }
    } catch (e) { sel.innerHTML = ''; }
    // 底部加新建选项
    const opt = document.createElement('option');
    opt.value = '__new__';
    opt.textContent = '＋ 新建文件夹...';
    sel.appendChild(opt);
    sel.onchange = () => {
        document.getElementById("export-new-folder-wrap").style.display = sel.value === '__new__' ? 'flex' : 'none';
    };
}

async function confirmNewExportFolder() {
    const name = document.getElementById("export-new-folder-name").value.trim();
    if (!name) return;
    try {
        await window.Capacitor.Plugins.Filesystem.mkdir({ path: name, directory: 'DOCUMENTS', recursive: true });
    } catch (e) {}
    await loadExportFolders();
    const sel = document.getElementById("export-folder-select");
    sel.value = name;
    sel.onchange();
    showStatus("文件夹已创建: " + name, "success");
}

function getExportFolder() {
    const sel = document.getElementById("export-folder-select");
    return (sel && sel.value && sel.value !== '__new__') ? sel.value : '';
}

function getExportFileName() {
    return document.getElementById("export-filename")?.value?.trim() || '题库导出';
}

async function previewExportPDF() {
    const qs = window._exportQuestions; if (!qs || !qs.length) { showStatus("没有可导出的题目", "error"); return; }
    showStatus("正在生成预览，请稍候...", "success");
    const spc = exportSpacing === 'large' ? parseFloat(document.getElementById("spc-large").value) : exportSpacing === 'small' ? parseFloat(document.getElementById("spc-small").value) : 0;
    // 生成完整 PDF（不保存）
    const doc = await generatePDF(qs, { mode: exportMode, spacing: exportSpacing, spacingCm: spc, title: getExportFileName(), noSave: true });
    if (!doc) { showStatus("生成失败", "error"); return; }
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative && window.Capacitor?.Plugins?.Filesystem) {
        // 用 arraybuffer 输出避免 dataurlstring 内存溢出
        const ab = doc.output('arraybuffer');
        const bytes = new Uint8Array(ab);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const b64 = btoa(binary);
        const tmpFile = 'preview_temp.pdf';
        try {
            try { await window.Capacitor.Plugins.Filesystem.deleteFile({ path: tmpFile, directory: 'CACHE' }); } catch (_) {}
            await window.Capacitor.Plugins.Filesystem.writeFile({ path: tmpFile, data: b64, directory: 'CACHE' });
            const uriResult = await window.Capacitor.Plugins.Filesystem.getUri({ path: tmpFile, directory: 'CACHE' });
            // 用 FileOpener 打开 PDF（需要安装 @capacitor-community/file-opener）
            if (window.Capacitor.Plugins.FileOpener) {
                await window.Capacitor.Plugins.FileOpener.open({
                    filePath: uriResult.uri,
                    contentType: 'application/pdf'
                });
            } else {
                // 降级到 Browser（可能不工作）
                await window.Capacitor.Plugins.Browser.open({ url: uriResult.uri });
            }
            showStatus("预览已打开", "success");
            setTimeout(() => { try { window.Capacitor.Plugins.Filesystem.deleteFile({ path: tmpFile, directory: 'CACHE' }); } catch (_) {} }, 30000);
        } catch (e) {
            showStatus("预览失败: " + e.message, "error");
        }
    } else {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    }
}
function closeExportModal() { document.getElementById("export-modal").classList.remove("active"); }
function selectExportMode(el, mode) { exportMode = mode; document.querySelectorAll("#export-modal .mode-option").forEach(e => e.classList.remove("selected")); el.classList.add("selected"); }
function selectSpacing(el, sp) { exportSpacing = sp; document.querySelectorAll("#export-modal .spacing-option").forEach(e => e.classList.remove("selected")); el.classList.add("selected"); }
async function doExportPDF() {
    const qs = window._exportQuestions; if (!qs || !qs.length) { showStatus("没有可导出的题目", "error"); return; }
    closeExportModal(); showStatus("正在生成 PDF...", "success");
    const spc = exportSpacing === 'large' ? parseFloat(document.getElementById("spc-large").value) : exportSpacing === 'small' ? parseFloat(document.getElementById("spc-small").value) : 0;
    await generatePDF(qs, { mode: exportMode, spacing: exportSpacing, spacingCm: spc, title: getExportFileName() });
    showStatus("PDF 已生成", "success");
}

// ========== 待关联功能 ==========

let _pendingLinkList = JSON.parse(localStorage.getItem('pendingLinkList') || '[]');

function getPendingLinkList() { return _pendingLinkList; }

function savePendingLinkList(arr) {
    _pendingLinkList = arr;
    localStorage.setItem('pendingLinkList', JSON.stringify(arr));
    updatePendingLinkBadge();
}

function togglePendingLink(qId) {
    const idx = _pendingLinkList.indexOf(qId);
    if (idx !== -1) {
        _pendingLinkList.splice(idx, 1);
    } else {
        _pendingLinkList.unshift(qId);
    }
    savePendingLinkList(_pendingLinkList);
}

function isPendingLink(qId) { return _pendingLinkList.includes(qId); }

function updatePendingLinkBadge() {
    const count = _pendingLinkList.length;
    const badge = document.getElementById('pending-link-count');
    const textEl = document.getElementById('pending-link-count-text');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-block' : 'none'; }
    if (textEl) textEl.textContent = count > 0 ? `(${count})` : '';
}

async function updatePendingPhotosBadge() {
    const count = await dbGetPendingPhotoCount();
    const badge = document.getElementById('pending-photos-count');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

// 从 native 端导入待处理照片
async function importPendingPhotosFromNative(filePaths, groupInfo) {
    if (!filePaths || !filePaths.length) return;

    const groups = groupInfo ? JSON.parse(groupInfo) : {};
    const totalGroups = groups.total_groups || 0;

    // 读取文件并导入到 IndexedDB
    for (const filePath of filePaths) {
        try {
            // 从文件路径解析 group_id
            const match = filePath.match(/photo_\d+_\d+_(.+)\.jpg$/);
            let groupId = "未分组";
            if (match) {
                const rawGroupId = match[1];
                if (rawGroupId.startsWith("group_")) {
                    groupId = rawGroupId;
                }
            }

            // 尝试通过 Capacitor Filesystem 读取文件
            let imageDataUrl = null;
            if (isNative && window.Capacitor?.Plugins?.Filesystem) {
                try {
                    const result = await window.Capacitor.Plugins.Filesystem.readFile({
                        path: filePath,
                        directory: 'DATA'
                    });
                    imageDataUrl = 'data:image/jpeg;base64,' + result.data;
                } catch (e) {
                    console.warn("无法读取文件:", filePath, e);
                    continue;
                }
            } else {
                console.warn("非原生环境，无法读取文件:", filePath);
                continue;
            }

            if (imageDataUrl) {
                await dbAddPendingPhoto(imageDataUrl, groupId);
            }
        } catch (e) {
            console.error("导入照片失败:", filePath, e);
        }
    }

    await updatePendingPhotosBadge();
    showStatus("已导入 " + filePaths.length + " 张待处理照片", "success");
}

// 暴露给 native 端调用
window.importPendingPhotos = importPendingPhotosFromNative;

function togglePendingLinkInDetail() {
    if (!currentQuestionId) return;
    togglePendingLink(currentQuestionId);
    updatePendingLinkBtnStyle(currentQuestionId);
    if (!document.getElementById('pending-link-tab').classList.contains('hidden')) renderPendingLinkList();
}

function updatePendingLinkBtnStyle(qId) {
    const btn = document.getElementById('detail-pending-link-btn');
    if (!btn) return;
    btn.style.background = isPendingLink(qId) ? '#f59e0b' : 'rgba(255,255,255,.9)';
    btn.style.color = isPendingLink(qId) ? '#fff' : '';
}

async function renderPendingLinkList() {
    const container = document.getElementById('pending-link-list');
    container.innerHTML = '';
    if (!_pendingLinkList.length) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:30px">暂无待关联题目</div>';
        return;
    }
    const validIds = [];
    for (const qId of _pendingLinkList) {
        try {
            const q = await dbQuestions.getItem(qId);
            if (!q || q.deleted_at) continue;
            validIds.push(qId);
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #f0f0f0;cursor:pointer';
            div.onclick = () => { showQuestionDetail(qId); };
            const img = document.createElement('img');
            img.src = q.question_image_url;
            img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0';
            div.appendChild(img);
            const info = document.createElement('div');
            info.style.cssText = 'flex:1';
            const title = document.createElement('div');
            title.textContent = q.semantic_summary || '题目 ' + qId.substring(0, 8);
            title.style.cssText = 'font-size:14px;color:#333;margin-bottom:4px';
            info.appendChild(title);
            const hint = document.createElement('div');
            hint.textContent = '点击查看';
            hint.style.cssText = 'font-size:12px;color:#888';
            info.appendChild(hint);
            div.appendChild(info);
            const btn = document.createElement('button');
            btn.textContent = '❌';
            btn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;padding:4px';
            btn.onclick = (e) => { e.stopPropagation(); removeFromPendingLink(qId); };
            div.appendChild(btn);
            container.appendChild(div);
        } catch (e) { console.warn('加载题目失败:', qId, e); }
    }
    if (validIds.length !== _pendingLinkList.length) savePendingLinkList(validIds);
}

function removeFromPendingLink(qId) {
    const idx = _pendingLinkList.indexOf(qId);
    if (idx !== -1) _pendingLinkList.splice(idx, 1);
    savePendingLinkList(_pendingLinkList);
    renderPendingLinkList();
}

// ========== 试题篮 ==========
function toggleBasket(qId) { if (questionBasket.has(qId)) questionBasket.delete(qId); else questionBasket.add(qId); updateBasketBadge(); }
function updateBasketBadge() { const b = document.getElementById("basket-badge"); if (questionBasket.size > 0) { b.style.display = "flex"; b.textContent = questionBasket.size; } else b.style.display = "none"; }
function openBasketModal() {
    if (!questionBasket.size) { showStatus("试题篮是空的，请先勾选题目", "error"); return; }
    document.getElementById("basket-modal-count").textContent = "(" + questionBasket.size + "题)";
    const c = document.getElementById("basket-items"); c.replaceChildren();
    allQuestions.filter(q => questionBasket.has(q.id)).forEach((q, i) => {
        const d = document.createElement("div"); d.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #f0f0f0";
        const img = document.createElement("img"); img.src = q.question_image_url; img.style.cssText = "width:50px;height:50px;object-fit:contain;border-radius:6px;background:#f9f9f9";
        const label = document.createElement("span"); label.textContent = "第" + (i+1) + "题"; label.style.flex = "1"; label.style.fontSize = "13px";
        const rm = document.createElement("button"); rm.className = "danger"; rm.style.cssText = "padding:4px 10px;font-size:12px"; rm.textContent = "移除";
        rm.onclick = () => { questionBasket.delete(q.id); updateBasketBadge(); openBasketModal(); renderQuestions(); };
        d.append(img, label, rm); c.appendChild(d);
    });
    document.getElementById("basket-modal").classList.add("active");
}
function closeBasketModal() { document.getElementById("basket-modal").classList.remove("active"); }
function exportFromBasket() {
    const qs = allQuestions.filter(q => questionBasket.has(q.id));
    closeBasketModal(); showExportModal(qs);
}

// ========== 导入/导出 ==========
// ========== AI 模型管理交互 ==========
async function updateAIStatusUI() {
    const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
    console.log("updateAIStatusUI: Gemma4 plugin =", Gemma4);
    if (!Gemma4) {
        console.log("updateAIStatusUI: Gemma4 plugin not found!");
        return;
    }
    initProviderList(); // 初始化服务商列表
    const status = await Gemma4.checkModelStatus();
    console.log("updateAIStatusUI: status =", JSON.stringify(status));
    const label = document.getElementById("ai-status-label");
    const desc = document.getElementById("ai-status-desc");
    const loadBtn = document.getElementById("ai-load-btn");
    const batchBtn = document.getElementById("ai-batch-btn");

    if (status.ready) {
        label.textContent = "已就绪";
        label.style.background = "#10b981";
        desc.textContent = "Gemma 4 引擎已就绪";
        loadBtn.textContent = "✅ 模型已加载";
        loadBtn.style.display = "none";
        loadBtn.disabled = true;
        batchBtn.style.display = "";
    } else {
        label.textContent = "未就绪";
        label.style.background = "#ef4444";
        desc.textContent = "请将 gemma-4-E2B-it-Q3_K_S.gguf 放入手机的 Download 目录，然后点击\"加载模型\"。";
        loadBtn.textContent = "加载模型";
        loadBtn.style.display = "";
        loadBtn.disabled = false;
        batchBtn.style.display = "none";
    }
}

async function handleLoadModel() {
    const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
    if (!Gemma4) { showStatus("请在原生 App 中使用此功能", "error"); return; }

    const btn = document.getElementById("ai-load-btn");
    const desc = document.getElementById("ai-status-desc");
    btn.disabled = true;
    btn.textContent = "正在加载...";
    desc.textContent = "正在扫描 Download 目录并加载模型，请稍候（首次加载约需 10-30 秒）...";

    const result = await Gemma4.discoverModel();
    btn.disabled = false;

    if (result.found && result.ready) {
        showStatus("模型加载成功", "success");
        updateAIStatusUI();
    } else if (result.found && !result.ready) {
        showStatus("加载失败: " + (result.error || "未知错误"), "error");
        btn.textContent = "重试加载";
        desc.textContent = "错误详情: " + (result.error || "无");
    } else {
        showStatus("未在 Download 目录找到模型文件", "error");
        btn.textContent = "加载模型";
        desc.textContent = "请确认 gemma-4-E2B-it-Q3_K_S.gguf 已放入手机的 Download 目录。";
    }
}

// ========== 云端 API 配置 ==========
async function pasteTo(inputId) {
    try {
        const res = await Capacitor.Plugins.Clipboard.read();
        document.getElementById(inputId).value = (res && res.value) || res || '';
    } catch (e) {
        showStatus("粘贴失败: " + e.message, "error");
    }
}

// ========== 模型服务商管理 ==========

let cloudProviders = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
let currentProviderId = localStorage.getItem('current_provider_id') || '';
let editingProviderId = null;

// 迁移旧配置（兼容性）
function migrateOldConfig() {
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
function renderProviderList() {
    const container = document.getElementById('provider-list');
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
    document.getElementById('current-provider-name').textContent = currentProvider ? `当前: ${currentProvider.name}` : '';
}

// 直接按 ID 删除服务商（无需先打开编辑弹窗）
function deleteProviderById(providerId) {
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
    showStatus('服务商已删除', 'success');
}

// 复制服务商配置
function copyProvider(providerId) {
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
    showStatus('已复制服务商配置', 'success');
}

// 选择服务商
function selectProvider(providerId) {
    currentProviderId = providerId;
    localStorage.setItem('current_provider_id', providerId);
    renderProviderList();
    showStatus('已切换服务商', 'success');
}

// 显示添加服务商弹窗
function showAddProviderModal() {
    editingProviderId = null;
    document.getElementById('provider-modal-title').textContent = '添加服务商';
    document.getElementById('provider-name').value = '';
    document.getElementById('provider-base-url').value = '';
    document.getElementById('provider-api-key').value = '';
    document.getElementById('provider-model').value = '';
    document.getElementById('provider-auth-header').value = 'Authorization';
    document.getElementById('provider-auth-scheme').value = 'Bearer';
    document.getElementById('provider-endpoint').value = '';
    document.getElementById('provider-delete-btn').style.display = 'none';
    document.getElementById('provider-modal').classList.add('active');
}

// 编辑服务商
function editProvider(providerId) {
    const provider = cloudProviders.find(p => p.id === providerId);
    if (!provider) return;

    editingProviderId = providerId;
    document.getElementById('provider-modal-title').textContent = '编辑服务商';
    document.getElementById('provider-name').value = provider.name;
    document.getElementById('provider-base-url').value = provider.baseUrl || '';
    document.getElementById('provider-api-key').value = provider.apiKey || '';
    document.getElementById('provider-model').value = provider.model;
    document.getElementById('provider-auth-header').value = provider.authHeader || 'Authorization';
    document.getElementById('provider-auth-scheme').value = provider.authScheme != null ? provider.authScheme : 'Bearer';
    document.getElementById('provider-endpoint').value = provider.endpoint || '';
    document.getElementById('provider-delete-btn').style.display = 'inline-block';
    document.getElementById('provider-modal').classList.add('active');
}

// 关闭服务商弹窗
function closeProviderModal() {
    document.getElementById('provider-modal').classList.remove('active');
    editingProviderId = null;
}

// 保存服务商
function saveProvider() {
    const name = document.getElementById('provider-name').value.trim();
    const baseUrl = document.getElementById('provider-base-url').value.trim();
    const apiKey = document.getElementById('provider-api-key').value.trim();
    const model = document.getElementById('provider-model').value.trim();
    const authHeader = document.getElementById('provider-auth-header').value.trim() || 'Authorization';
    const authScheme = document.getElementById('provider-auth-scheme').value;
    const endpoint = document.getElementById('provider-endpoint').value.trim();

    if (!name || !model) {
        showStatus('请至少填写服务商名称和模型名称', 'error');
        return;
    }
    if (!baseUrl && !endpoint) {
        showStatus('请填写 Base URL 或自定义端点', 'error');
        return;
    }

    const extra = { authHeader, authScheme };
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
    showStatus('服务商已保存', 'success');
}

// 删除服务商（从弹窗内调用）
function deleteProvider() {
    if (!editingProviderId) return;
    const idToDelete = editingProviderId;
    closeProviderModal();
    deleteProviderById(idToDelete);
}

// 获取当前服务商配置
function getCurrentProvider() {
    return cloudProviders.find(p => p.id === currentProviderId);
}

// 初始化服务商列表
function initProviderList() {
    migrateOldConfig();
    renderProviderList();
}

// AI 函数已提取到 ai.js

// 基于用户评价生成标签
async function generateTagsFromComment() {
    if (!currentQuestionId) return;

    const comment = document.getElementById("user-comment").value.trim();
    if (!comment) {
        showStatus("请输入您对题目的评价", "error");
        return;
    }

    // 保存用户评价
    await saveUserComment();

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "生成中...";
    stopAllPolling();

    try {
        const prompt = `请基于以下用户评价，为题目生成语义标签（JSON数组格式）。
标签范围不限，自行判断哪些语义可以作为题目特征。
只输出JSON数组，不要其他内容。

用户评价：${comment}`;

        const result = await callCloudAI(prompt);
        console.log("[标签生成] API 返回:", result);

        // 解析 JSON 数组
        let tags = [];
        try {
            // 尝试提取 JSON 数组
            const jsonMatch = result.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                tags = JSON.parse(jsonMatch[0]);
            } else {
                // 如果没有找到 JSON，尝试按行分割
                tags = result.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('[') && !t.startsWith(']'));
            }
        } catch (e) {
            console.error("[标签生成] JSON 解析失败:", e);
            tags = result.split('\n').map(t => t.trim()).filter(t => t);
        }

        // 显示生成的标签
        const container = document.getElementById("generated-tags-list");
        addedGeneratedTags.clear();
        container.innerHTML = "";

        tags.forEach(tag => {
            const tagBtn = createGeneratedTagButton(tag, {
                onClickNew: (name) => addGeneratedTag(name),
                onClickExisting: (t) => addGeneratedTag(t.name),
            });
            container.appendChild(tagBtn);
        });

        document.getElementById("generated-tags").style.display = tags.length > 0 ? "block" : "none";
        showStatus(`生成了 ${tags.length} 个标签`, "success");
    } catch (e) {
        console.error("[标签生成] 失败:", e);
        showStatus("生成失败: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "生成";
        restartAllPolling();
    }
}

// 添加生成的标签到题目
let addedGeneratedTags = new Set();

async function addGeneratedTag(tagName) {
    if (!currentQuestionId) return;

    try {
        // 查找是否已存在该标签
        let tag = allTags.find(t => t.name === tagName);

        if (!tag) {
            // 创建新标签
            tag = await dbCreateTag(tagName, "#f59e0b");
            await loadTags();
        }

        // 添加标签到题目
        await dbAddTagToQuestion(currentQuestionId, tag.id);
        await loadQuestions();

        // 高亮已添加的标签按钮
        addedGeneratedTags.add(tagName);
        const wrapper = document.querySelector(`#generated-tags-list [data-tag="${tagName}"]`);
        if (wrapper) markWrapperDone(wrapper);

        // 更新题目详情中的标签显示（不调用 showQuestionDetail 避免重绘）
        const q = filteredList[detailIndex];
        if (q) {
            const questionTags = [];
            await dbQuestionTags.iterate((v, k) => {
                if (k.startsWith(currentQuestionId + "_")) questionTags.push(v);
            });
            const tagIds = new Set(questionTags.map(qt => qt.tag_id));
            const tagList = allTags.filter(t => tagIds.has(t.id));
            document.getElementById("modal-tags").innerHTML = tagList.length ? '<h3 style="margin-top:12px">标签（点击移除）</h3><div class="tag-container">' + tagList.map(t => '<span class="tag" style="background:' + t.color + '20;border:1px solid ' + t.color + ';cursor:pointer" onclick="removeTagFromQuestion(\'' + t.id + '\')">' + t.name + ' ✕</span>').join("") + '</div>' : '';
        }

        showStatus(`已添加标签: ${tagName}`, "success");
    } catch (e) {
        showStatus("添加标签失败: " + e.message, "error");
    }
}

// 清除生成的标签列表
function clearGeneratedTags() {
    document.getElementById("generated-tags-list").innerHTML = "";
    document.getElementById("generated-tags").style.display = "none";
    addedGeneratedTags.clear();
}

// 清除表单生成的标签列表
function clearFormGeneratedTags() {
    document.getElementById("form-generated-tags-list").innerHTML = "";
    document.getElementById("form-generated-tags").style.display = "none";
}

// ========== 标签相似度匹配（中文优化） ==========

// 计算两个中文标签的相似度（不含 Token 消耗）
// 策略：字包含 > 字符重叠比例（以短串为基准）
function tagSimilarity(a, b) {
    if (a === b) return 1;
    const la = a.toLowerCase(), lb = b.toLowerCase();
    // 1. 包含关系：一个串完全包含另一个 → 高相似
    if (la.includes(lb) || lb.includes(la)) return 0.9;
    // 2. 字符重叠：以较短串为基准，重叠字数 / 短串长度
    const setA = new Set(la), setB = new Set(lb);
    let overlap = 0;
    for (const c of setA) { if (setB.has(c)) overlap++; }
    const shorter = Math.min(la.length, lb.length);
    return shorter === 0 ? 0 : overlap / shorter;
}

// 找到 allTags 中所有相似的标签，按相似度降序返回数组 [{ tag, similarity }]
function findSimilarTags(name, maxResults = 3) {
    const results = [];
    for (const t of allTags) {
        const s = tagSimilarity(name, t.name);
        if (s >= 0.7) results.push({ tag: t, similarity: s });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
}

// 标记标签按钮组为已选中（变绿）
function markWrapperDone(wrapper) {
    const mainBtn = wrapper.querySelector("button");
    if (mainBtn) { mainBtn.style.background = "#22c55e"; mainBtn.style.color = "#fff"; mainBtn.style.borderColor = "#22c55e"; }
    wrapper.querySelectorAll("button").forEach(b => { b.style.pointerEvents = "none"; });
}

// 创建带相似度提示的标签按钮（共用函数）
// opts.onClickNew(tagName) — 点击新标签时回调
// opts.onClickExisting(tag) — 点击已有标签时回调
function createGeneratedTagButton(tagName, opts) {
    const exact = allTags.find(t => t.name === tagName);
    const similarList = !exact ? findSimilarTags(tagName) : [];

    // 外层 wrapper，包裹主按钮 + 相似标签按钮
    const wrapper = document.createElement("span");
    wrapper.style.cssText = "display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;";
    wrapper.dataset.tag = tagName;

    // 主标签按钮（必须 type=button 防止触发表单提交）
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = "padding:4px 10px;font-size:11px;border-radius:12px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;";

    if (exact) {
        btn.style.border = "1px solid #22c55e";
        btn.style.background = "#f0fdf4";
        btn.style.color = "#166534";
        btn.innerHTML = `<span>${tagName}</span><span style="font-size:9px;background:#22c55e;color:#fff;border-radius:6px;padding:1px 4px">存</span>`;
        btn.onclick = () => opts.onClickExisting(exact);
        wrapper.appendChild(btn);
    } else {
        btn.style.border = "1px solid var(--warning)";
        btn.style.background = "var(--warning-light)";
        btn.style.color = "#92400e";
        btn.textContent = tagName;
        btn.onclick = () => opts.onClickNew(tagName);
        wrapper.appendChild(btn);

        // 相似标签各自独立按钮（必须 type=button）
        similarList.forEach(s => {
            const hint = document.createElement("button");
            hint.type = "button";
            hint.textContent = "≈" + s.tag.name;
            hint.style.cssText = "padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px dashed #d97706;background:#fffbeb;color:#92400e;opacity:.7;transition:all .15s;";
            hint.onmouseenter = () => { hint.style.opacity = "1"; hint.style.background = "#FEF3C7"; };
            hint.onmouseleave = () => { hint.style.opacity = "0.7"; hint.style.background = "#fffbeb"; };
            hint.onclick = (ev) => { ev.stopPropagation(); opts.onClickExisting(s.tag); };
            wrapper.appendChild(hint);
        });
    }

    // hover 效果（主按钮）
    btn.onmouseenter = () => { if (btn.style.background !== 'rgb(34, 197, 94)') btn.style.background = '#FEF3C7'; };
    btn.onmouseleave = () => {
        if (btn.style.background === 'rgb(34, 197, 94)') return;
        btn.style.background = exact ? '#f0fdf4' : 'var(--warning-light)';
    };

    return wrapper;
}

// 基于评价生成标签（表单版）
async function generateFormTagsFromComment() {
    const comment = document.getElementById("form-comment").value.trim();
    if (!comment) { showStatus("请输入评价", "error"); return; }

    const btn = event.target;
    btn.disabled = true; btn.textContent = "生成中...";
    stopAllPolling();

    try {
        const prompt = `请基于以下用户评价，为题目生成语义标签（JSON数组格式）。
标签范围不限，自行判断哪些语义可以作为题目特征。
只输出JSON数组，不要其他内容。

用户评价：${comment}`;

        const result = await callCloudAI(prompt);
        let tags = [];
        try {
            const jsonMatch = result.match(/\[[\s\S]*?\]/);
            if (jsonMatch) { tags = JSON.parse(jsonMatch[0]); }
            else { tags = result.split('\n').map(t => t.trim()).filter(t => t && !t.startsWith('[') && !t.startsWith(']')); }
        } catch (e) { tags = result.split('\n').map(t => t.trim()).filter(t => t); }

        const container = document.getElementById("form-generated-tags-list");
        container.innerHTML = "";
        tags.forEach(tag => {
            const wrapper = createGeneratedTagButton(tag, {
                onClickNew: async (name) => {
                    let t = allTags.find(x => x.name === name);
                    if (!t) { t = await dbCreateTag(name, '#f59e0b'); allTags.push(t); onFormTagSearch(); }
                    if (!formSelectedTagIds.includes(t.id)) { formSelectedTagIds.push(t.id); renderFormSelectedTags(); }
                    markWrapperDone(wrapper);
                },
                onClickExisting: (t) => {
                    if (!formSelectedTagIds.includes(t.id)) { formSelectedTagIds.push(t.id); renderFormSelectedTags(); }
                    markWrapperDone(wrapper);
                },
            });
            container.appendChild(wrapper);
        });
        document.getElementById("form-generated-tags").style.display = tags.length > 0 ? "block" : "none";
        showStatus(`生成了 ${tags.length} 个标签`, "success");
    } catch (e) {
        showStatus("生成失败: " + e.message, "error");
    } finally { btn.disabled = false; btn.textContent = "🤖 AI 生成"; restartAllPolling(); }
}

async function addFormTagByName(tagName) {
    let tag = allTags.find(t => t.name === tagName);
    if (!tag) { tag = await dbCreateTag(tagName, '#f59e0b'); await loadTags(); }
    addFormTag(tag.id);
}

// 从题目移除标签
async function removeTagFromQuestion(tagId) {
    if (!currentQuestionId) return;

    try {
        await dbRemoveTagFromQuestion(currentQuestionId, tagId);
        await loadQuestions();
        showQuestionDetail(currentQuestionId);
        showStatus("已移除标签", "success");
    } catch (e) {
        showStatus("移除标签失败: " + e.message, "error");
    }
}

// 保存用户评价到题目
async function saveUserComment() {
    if (!currentQuestionId) return;

    const comment = document.getElementById("user-comment").value.trim();
    const q = await dbQuestions.getItem(currentQuestionId);
    if (!q) return;

    await dbQuestions.setItem(currentQuestionId, {
        ...q,
        user_comment: comment,
        updated_at: new Date().toISOString()
    });
    _invalidateQuestionsCache();
    await loadQuestions();
    await doAutoBackup();
}

async function analyzeSingleQuestion() {
    if (!currentQuestionId) return;

    const mode = document.getElementById("analyze-mode")?.value || "cloud";
    const q = await dbQuestions.getItem(currentQuestionId);
    if (!q) return;

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "分析中...";

    try {
        let result;
        if (mode === "cloud") {
            // 云端 API
            const prompt = "请简要描述这道题目图片的内容，包括学科和大致知识点";
            btn.textContent = "分析中 (云端)...";
            console.log("[分析] 调用云端 API, 题目ID:", currentQuestionId, "有无图片:", !!q.question_image_url);
            // 传递真实图片数据
            result = { summary: await callCloudAI(prompt, q.question_image_url), difficulty: 3 };
        } else {
            // 本地模型
            const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
            if (!Gemma4) { showStatus("请在原生 App 中使用本地模型", "error"); return; }
            const status = await Gemma4.checkModelStatus();
            if (!status.ready) { showStatus("本地 AI 引擎未就绪，请先加载模型", "error"); return; }

            const progressListener = window.Capacitor.Plugins.Gemma4.addListener('analyzeProgress', (info) => {
                const pct = info.total > 0 ? Math.round(info.step / info.total * 100) : 0;
                btn.textContent = "分析中 " + pct + "% (" + info.status + ")";
            });

            try {
                result = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error("超时")), 600000);
                    Gemma4.analyzeQuestion({ prompt: "请简要描述这张题目图片的内容，包括学科和大致知识点" })
                        .then(r => { clearTimeout(timer); resolve(r); })
                        .catch(e => { clearTimeout(timer); reject(e); });
                });
            } finally {
                progressListener.remove();
            }
        }

        q.semantic_summary = result.summary || "分析完成";
        q.ai_metadata = { difficulty: result.difficulty || 3, tags: result.tags || [], analyzed_at: new Date().toISOString(), mode };
        await dbQuestions.setItem(q.id, q);
        _invalidateQuestionsCache();

        const aiDiv = document.getElementById("modal-ai-summary");
        const aiText = document.getElementById("modal-ai-text");
        aiDiv.style.display = "block";
        aiText.textContent = q.semantic_summary;
        showStatus("分析完成 (" + (mode === "cloud" ? "云端" : "本地") + ")", "success");
    } catch (e) {
        showStatus("分析失败: " + e.message, "error");
    }
    btn.disabled = false;
    btn.textContent = "🧠 分析此题";
}

async function handleBatchAnalyze() {
    const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
    if (!Gemma4) { showStatus("请在原生 App 中使用此功能", "error"); return; }

    const status = await Gemma4.checkModelStatus();
    if (!status.ready) { showStatus("AI 引擎未就绪", "error"); return; }

    const pending = [];
    await dbQuestions.iterate((q) => {
        if (q && !q.deleted_at && (!q.semantic_summary || q.semantic_summary === "" || q.semantic_summary === "AI 正在分析中...")) {
            pending.push(q);
        }
    });

    if (pending.length === 0) { showStatus("所有题目已分析完成", "success"); return; }

    const btn = document.getElementById("ai-batch-btn");
    btn.disabled = true;
    btn.textContent = "分析中 (0/" + pending.length + ")...";
    showStatus("开始批量分析 " + pending.length + " 道题目...", "success");

    let done = 0;
    for (const q of pending) {
        try {
            const img = q.question_image_url || "";
            if (!img || !img.startsWith("data:")) { done++; continue; }

            const result = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("超时")), 600000);
                Gemma4.analyzeQuestion({ prompt: "请简要描述这张题目图片的内容，包括学科和大致知识点" })
                    .then(r => { clearTimeout(timer); resolve(r); })
                    .catch(e => { clearTimeout(timer); reject(e); });
            });

            q.semantic_summary = result.summary || "分析完成";
            q.ai_metadata = {
                difficulty: result.difficulty || 3,
                tags_suggested: result.tags || [],
                analyzed_at: new Date().toISOString()
            };
            await dbQuestions.setItem(q.id, q);
            _invalidateQuestionsCache();
            done++;
        } catch (e) {
            btn.disabled = false;
            btn.textContent = "🧠 批量分析已有题目";
            showStatus("第 " + (done + 1) + " 道题分析失败: " + e.message, "error");
            return;
        }
        btn.textContent = "分析中 (" + (done) + "/" + pending.length + ")...";
    }

    btn.disabled = false;
    btn.textContent = "🧠 批量分析已有题目";
    showStatus("分析完成: " + done + " 道题全部成功", "success");
    await loadQuestions();
}

// 页面加载时初始化 AI 状态
window.addEventListener('DOMContentLoaded', () => {
    updateAIStatusUI();
    setInterval(updateAIStatusUI, 10000);
    const savedAtomizeMode = localStorage.getItem('atomize_mode') || 'text';
    const atomizeSelect = document.getElementById('atomize-mode-select');
    if (atomizeSelect) atomizeSelect.value = savedAtomizeMode;
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('tag-suggest-dropdown');
        const wrap = dropdown?.parentElement;
        if (dropdown && wrap && !wrap.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
});

// ========== 自动化测试上帝模式 ==========
window.runFullAIAutomation = async function() {
    console.log("🛠️ [自动化] 🚀 开始全链路自检 (Gemma 4 全自动调试流程)...");
    showStatus("正在执行全自动 AI 压力测试...", "success");

    // 1. 注入模拟数据 (防止题库为空)
    console.log("🛠️ [自动化] Step 1: 正在尝试注入模拟题目数据...");
    const testId = 'auto-test-' + Date.now();
    await dbQuestions.setItem(testId, {
        id: testId,
        semantic_summary: '自动化测试专用：勾股定理难题',
        question_image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        created_at: new Date().toISOString(),
        question_tags: [],
        ai_metadata: { difficulty: 5 }
    });
    _invalidateQuestionsCache();
    await loadQuestions();
    console.log("🛠️ [自动化] ✅ Step 1: 模拟题目注入成功");

    // 2. 自动发现并加载模型
    console.log("🛠️ [自动化] Step 2: 正在执行自动模型发现 handleDiscoverModel...");
    await handleDiscoverModel();

    // 3. 等待引擎就绪 (轮询)
    console.log("🛠️ [自动化] Step 3: 开始轮询检查 AI 引擎就绪状态...");
    const checkReady = setInterval(async () => {
        const status = await window.Capacitor.Plugins.Gemma4.checkModelStatus();
        console.log("🛠️ [自动化] 当前引擎状态: ", JSON.stringify(status));
        if (status.ready) {
            clearInterval(checkReady);
            console.log("🛠️ [自动化] ✅ Step 3: AI 引擎已就绪，准备进入智能组卷阶段");

            // 4. 模拟输入需求并点击
            console.log("🛠️ [自动化] Step 4: 正在模拟用户输入组卷需求...");
            document.getElementById("ai-paper-requirement").value = "给我 1 道最难的测试题";
            await startAIPaperGeneration();

            // 5. 延迟 3 秒后自动点击“一键生成”
            setTimeout(async () => {
                const modal = document.getElementById("ai-recommend-modal");
                if (modal.classList.contains("active")) {
                    console.log("🛠️ [自动化] ✅ Step 5: AI 推荐成功！正在自动生成最终试卷...");
                    await createPaperFromAI(currentAIRecommendedIds);
                    showStatus("✨ 全自动调试任务完成！", "success");
                    console.log("🛠️ [自动化] 🎉 任务达成：试卷已入库并完成全链路闭环。");
                } else {
                    console.warn("🛠️ [自动化] ❌ Step 5 失败：AI 推荐弹窗未弹出。");
                }
            }, 3000);
        }
    }, 2000);
};

async function handleImport(event) {
    const file = event.target.files[0]; if (!file) return;
    try { showStatus("正在导入...", "success"); const r = await importAllData(file); await refreshAll(); showStatus("导入成功: " + r.questions + " 题, " + r.tags + " 标签, " + r.papers + " 试卷", "success"); }
    catch (e) { showStatus("导入失败: " + e.message, "error"); }
    event.target.value = "";
}

// ========== 空白版题目功能 ==========

let _pendingBlankList = JSON.parse(localStorage.getItem('pendingBlankList') || '[]'); // 待补拍列表

// 显示待补拍列表
async function showPendingBlankList() {
    const container = document.getElementById('pending-blank-list');
    container.innerHTML = '';

    if (!_pendingBlankList.length) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:20px">暂无待补拍题目</div>';
        document.getElementById('pending-blank-modal').classList.add('active');
        return;
    }

    // 加载题目详情
    for (const questionId of _pendingBlankList) {
        try {
            const question = await dbQuestions.getItem(questionId);
            if (!question) {
                // 题目已被删除，从列表中移除
                _pendingBlankList = _pendingBlankList.filter(id => id !== questionId);
                continue;
            }
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #f0f0f0';

            const img = document.createElement('img');
            img.src = question.question_image_url;
            img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0';
            div.appendChild(img);

            const info = document.createElement('div');
            info.style.cssText = 'flex:1';
            const title = document.createElement('div');
            title.textContent = question.semantic_summary || '题目 ' + questionId.substring(0, 8);
            title.style.cssText = 'font-size:14px;color:#333;margin-bottom:4px';
            info.appendChild(title);

            const hint = document.createElement('div');
            hint.textContent = '此题暂无空白版，请在题目详情中补拍';
            hint.style.cssText = 'font-size:12px;color:#888';
            info.appendChild(hint);

            div.appendChild(info);

            const btn = document.createElement('button');
            btn.textContent = '❌';
            btn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;padding:4px';
            btn.onclick = (e) => {
                e.stopPropagation();
                removeFromPendingBlank(questionId);
            };
            div.appendChild(btn);

            container.appendChild(div);
        } catch (e) {
            console.warn('加载题目失败:', questionId, e);
        }
    }

    document.getElementById('pending-blank-modal').classList.add('active');
}

// 关闭待补拍列表弹窗
function closePendingBlankModal() {
    document.getElementById('pending-blank-modal').classList.remove('active');
}

// 从待补拍列表中移除
function removeFromPendingBlank(questionId) {
    _pendingBlankList = _pendingBlankList.filter(id => id !== questionId);
    localStorage.setItem('pendingBlankList', JSON.stringify(_pendingBlankList));
    showPendingBlankList(); // 刷新列表
    updatePendingBlankCount();
}

// 更新待补拍数量徽章
function updatePendingBlankCount() {
    const count = _pendingBlankList.length;
    const badge = document.getElementById('pending-blank-count');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

// ========== 原有函数 ==========

function showStatus(msg, type) {
    const c = document.getElementById("status-message"); c.replaceChildren();
    const d = document.createElement("div"); d.className = "status " + type; d.textContent = msg; c.appendChild(d);
    if (type === "success") setTimeout(() => c.replaceChildren(), 3000);
}

// ========== 自动备份到设备/iCloud ==========

const Filesystem = isNative ? window.Capacitor.Plugins.Filesystem : null;
const isAndroid = isNative && window.Capacitor.getPlatform() === 'android';
// Android + iOS: Documents 目录
//   Android: /data/data/com.questionbank.local/files/Documents/ (应用沙箱，卸载保留)
//   iOS: iCloud Drive 可访问
function getBackupPath() {
    const custom = localStorage.getItem('backupPath');
    return custom ? custom + '/question-bank-backup.json' : 'question-bank-backup.json';
}
function getBackupDir() { return 'DOCUMENTS'; }

function showBackupModal() {
    const toggle = document.getElementById("auto-backup-toggle");
    autoBackupEnabled = localStorage.getItem('autoBackup') === '1';
    toggle.checked = autoBackupEnabled;
    updateBackupStatus();
    const info = document.getElementById("backup-path-info");
    if (info) {
        const custom = localStorage.getItem('backupPath');
        info.innerHTML = custom ? '备份到 <b>' + custom + '/</b> 目录下' : '文件将保存在 <b>Documents/question-bank-backup.json</b>';
    }
    document.getElementById("backup-modal").classList.add("active");
}
function closeBackupModal() { document.getElementById("backup-modal").classList.remove("active"); }

function updateBackupStatus() {
    const el = document.getElementById("backup-status");
    const last = localStorage.getItem('lastBackupTime');
    el.textContent = last ? '上次备份: ' + new Date(last).toLocaleString() : '尚未备份';
}

function toggleAutoBackup(enabled) {
    autoBackupEnabled = enabled;
    localStorage.setItem('autoBackup', enabled ? '1' : '0');
    if (enabled) doAutoBackup();
}

async function doAutoBackup() {
    if (!autoBackupEnabled || !isNative || !Filesystem) return;
    try {
        const data = await buildBackupData();
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
        await Filesystem.writeFile({ path: getBackupPath(), data: content, directory: getBackupDir() });
        localStorage.setItem('lastBackupTime', new Date().toISOString());
    } catch (e) { console.error("自动备份失败:", e); }
}

async function buildBackupData() {
    const data = { questions: [], tags: [], question_tags: [], papers: [], paper_questions: [], similar_question_links: [] };
    await dbQuestions.iterate((v) => data.questions.push(v));
    await dbTags.iterate((v) => data.tags.push(v));
    await dbQuestionTags.iterate((v) => data.question_tags.push(v));
    await dbPapers.iterate((v) => data.papers.push(v));
    await dbPaperQuestions.iterate((v) => data.paper_questions.push(v));
    await dbSimilarQuestionLinks.iterate((v) => data.similar_question_links.push(v));
    return data;
}

async function saveBackupToDevice() {
    try {
        const data = await buildBackupData();
        if (isNative && Filesystem) {
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
            const backupDir = getBackupDir();
            const backupPath = getBackupPath();
            await Filesystem.writeFile({ path: backupPath, data: content, directory: backupDir });
            localStorage.setItem('lastBackupTime', new Date().toISOString());
            updateBackupStatus();
            showStatus("备份已保存", "success");
        } else {
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'question-bank-backup.json';
            a.click(); URL.revokeObjectURL(url);
            showStatus("备份已下载", "success");
        }
    } catch (e) { showStatus("备份失败: " + e.message, "error"); }
}

async function loadBackupFromDevice() {
    const existingQs = await dbGetAllQuestions();
    const existingCount = existingQs.length;

    if (existingCount > 0 && !confirm("当前已有 " + existingCount + " 道题目，加载备份将覆盖同名数据。\n\n确定要继续吗？")) return;

    try {
        if (isNative && Filesystem) {
            const backupDir = getBackupDir();
            const result = await Filesystem.readFile({ path: 'question-bank-backup.json', directory: backupDir });
            const json = decodeURIComponent(escape(atob(result.data)));
            const data = JSON.parse(json);
            const backupCount = data.questions?.length || 0;
            if (!confirm("备份包含 " + backupCount + " 道题目，确定导入？")) return;
            await importBackupData(data);
            await refreshAll();
            showStatus("备份恢复成功: " + backupCount + " 题", "success");
        } else {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0]; if (!file) return;
                const data = JSON.parse(await file.text());
                await importBackupData(data); await refreshAll();
                showStatus("备份恢复成功: " + (data.questions?.length || 0) + " 题", "success");
            };
            input.click();
        }
    } catch (e) { showStatus("恢复失败: " + e.message, "error"); }
}

async function importBackupData(data) {
    if (data.tags) for (const t of data.tags) await dbTags.setItem(t.id, t);
    if (data.questions) for (const q of data.questions) await dbQuestions.setItem(q.id, q);
    if (data.question_tags) for (const qt of data.question_tags) await dbQuestionTags.setItem(qt.question_id + "_" + qt.tag_id, qt);
    if (data.papers) for (const p of data.papers) await dbPapers.setItem(p.id, p);
    if (data.paper_questions) for (const pq of data.paper_questions) await dbPaperQuestions.setItem(pq.paper_id + "_" + pq.question_id, pq);
    if (data.similar_question_links) for (const link of data.similar_question_links) {
        const ids = [link.question_id, link.similar_question_id].sort();
        if (ids[0] && ids[1] && ids[0] !== ids[1]) await dbSimilarQuestionLinks.setItem(ids[0] + "_" + ids[1], { ...link, question_id: ids[0], similar_question_id: ids[1] });
    }
    _invalidateQuestionsCache();
    _invalidateTagIndex();
}

// 包装数据修改操作，自动触发备份
const _origCreateQ = dbCreateQuestion;
dbCreateQuestion = async function(...args) { const r = await _origCreateQ(...args); doAutoBackup(); return r; };
const _origSoftDel = dbSoftDeleteQuestion;
dbSoftDeleteQuestion = async function(...args) { const r = await _origSoftDel(...args); doAutoBackup(); return r; };
const _origRestore = dbRestoreQuestion;
dbRestoreQuestion = async function(...args) { const r = await _origRestore(...args); doAutoBackup(); return r; };
const _origPermDel = dbPermanentDeleteQuestion;
dbPermanentDeleteQuestion = async function(...args) { const r = await _origPermDel(...args); doAutoBackup(); return r; };
const _origCreateTag = dbCreateTag;
dbCreateTag = async function(...args) { const r = await _origCreateTag(...args); doAutoBackup(); return r; };
const _origDeleteTag = dbDeleteTag;
dbDeleteTag = async function(...args) { const r = await _origDeleteTag(...args); doAutoBackup(); return r; };
const _origAddTagToQuestion = dbAddTagToQuestion;
dbAddTagToQuestion = async function(...args) { const r = await _origAddTagToQuestion(...args); doAutoBackup(); return r; };
const _origRemoveTagFromQuestion = dbRemoveTagFromQuestion;
dbRemoveTagFromQuestion = async function(...args) { const r = await _origRemoveTagFromQuestion(...args); doAutoBackup(); return r; };
const _origAddSimilarQuestionLinks = dbAddSimilarQuestionLinks;
dbAddSimilarQuestionLinks = async function(...args) { const r = await _origAddSimilarQuestionLinks(...args); doAutoBackup(); return r; };
const _origRemoveSimilarQuestionLink = dbRemoveSimilarQuestionLink;
dbRemoveSimilarQuestionLink = async function(...args) { const r = await _origRemoveSimilarQuestionLink(...args); doAutoBackup(); return r; };
const _origCreatePaper = dbCreatePaper;
dbCreatePaper = async function(...args) { const r = await _origCreatePaper(...args); doAutoBackup(); return r; };
const _origDeletePaper = dbDeletePaper;
dbDeletePaper = async function(...args) { const r = await _origDeletePaper(...args); doAutoBackup(); return r; };
const _origCreateTopic = dbCreateTopic;
dbCreateTopic = async function(...args) { const r = await _origCreateTopic(...args); doAutoBackup(); return r; };
const _origDeleteTopic = dbDeleteTopic;
dbDeleteTopic = async function(...args) { const r = await _origDeleteTopic(...args); doAutoBackup(); return r; };
const _origUpdateTopicQuestionComment = dbUpdateTopicQuestionComment;
dbUpdateTopicQuestionComment = async function(...args) { const r = await _origUpdateTopicQuestionComment(...args); doAutoBackup(); return r; };
const _origAddQuestionNote = dbAddQuestionNote;
dbAddQuestionNote = async function(...args) { const r = await _origAddQuestionNote(...args); doAutoBackup(); return r; };
const _origUpdateQuestionNote = dbUpdateQuestionNote;
dbUpdateQuestionNote = async function(...args) { const r = await _origUpdateQuestionNote(...args); doAutoBackup(); return r; };
const _origDeleteQuestionNote = dbDeleteQuestionNote;
dbDeleteQuestionNote = async function(...args) { const r = await _origDeleteQuestionNote(...args); doAutoBackup(); return r; };

// 初始化时加载自动备份设置
autoBackupEnabled = localStorage.getItem('autoBackup') === '1';

// ========== 百度网盘 ==========

const BAIDU_APP_ID = '122687902';
const BAIDU_APP_KEY = 'DFMqpIgeUIcXZnDhJZOLeG5g6rqMdSFz';
const BAIDU_SECRET_KEY = 'XEkpYsamxI4kkEiNa20OJ3bFyd8DGRrB';
const BAIDU_REDIRECT = 'https://openapi.baidu.com/oauth/2.0/login_success';
const BAIDU_SCOPE = 'basic,netdisk';
const BAIDU_CLOUD_PATH = '/apps/本地题库/backup.json';
let autoBaiduEnabled = localStorage.getItem('autoBaidu') === '1';
const Browser = isNative ? window.Capacitor.Plugins.Browser : null;

function getBaiduToken() {
    const t = localStorage.getItem('baidu_token');
    return t ? JSON.parse(t) : null;
}
function setBaiduToken(token) { localStorage.setItem('baidu_token', JSON.stringify(token)); }

// 备份弹窗打开时刷新百度状态
function updateBaiduUI() {
    const token = getBaiduToken();
    const statusEl = document.getElementById('baidu-status');
    const actionsEl = document.getElementById('baidu-actions');
    const bindEl = document.getElementById('baidu-bind-area');
    const toggle = document.getElementById('auto-baidu-toggle');

    if (token && token.access_token) {
        const expiresAt = new Date(token.created_at + token.expires_in * 1000);
        const expired = Date.now() > expiresAt.getTime();
        statusEl.innerHTML = '已绑定' + (expired ? ' <span style="color:#ef4444">（token 已过期，上传时自动刷新）</span>' : ' <span style="color:#10b981">✓</span>');
        statusEl.style.color = '#333';
        actionsEl.classList.remove('hidden');
        bindEl.innerHTML = '';
        if (toggle) toggle.checked = autoBaiduEnabled;
    } else {
        statusEl.textContent = '未绑定';
        statusEl.style.color = '#888';
        actionsEl.classList.add('hidden');
        bindEl.innerHTML = '<button onclick="showBaiduAuthModal()" style="width:100%;background:#2563eb;padding:10px;font-size:14px">🔗 绑定百度网盘</button>';
    }
}

function showBaiduAuthModal() { document.getElementById('baidu-auth-modal').classList.add('active'); }
function closeBaiduAuthModal() { document.getElementById('baidu-auth-modal').classList.remove('active'); }

function openBaiduAuth() {
    const url = 'https://openapi.baidu.com/oauth/2.0/authorize?' +
        'client_id=' + BAIDU_APP_KEY +
        '&response_type=code' +
        '&redirect_uri=' + encodeURIComponent(BAIDU_REDIRECT) +
        '&scope=' + BAIDU_SCOPE +
        '&display=page';
    if (isNative && Browser) { Browser.open({ url }); }
    else { window.open(url, '_blank'); }
}

async function exchangeBaiduToken() {
    const code = document.getElementById('baidu-auth-code').value.trim();
    if (!code) { showStatus("请粘贴授权码", "error"); return; }
    try {
        showStatus("正在绑定...", "success");
        const resp = await fetch('https://openapi.baidu.com/oauth/2.0/token?' +
            'grant_type=authorization_code' +
            '&code=' + code +
            '&client_id=' + BAIDU_APP_KEY +
            '&client_secret=' + BAIDU_SECRET_KEY +
            '&redirect_uri=' + encodeURIComponent(BAIDU_REDIRECT));
        const data = await resp.json();
        if (data.access_token) {
            data.created_at = Date.now();
            setBaiduToken(data);
            closeBaiduAuthModal();
            updateBaiduUI();
            showStatus("百度网盘绑定成功", "success");
        } else {
            showStatus("绑定失败: " + (data.error_description || data.error || '未知错误'), "error");
        }
    } catch (e) { showStatus("绑定失败: " + e.message, "error"); }
}

async function refreshBaiduToken() {
    const token = getBaiduToken();
    if (!token || !token.refresh_token) return null;
    try {
        const resp = await fetch('https://openapi.baidu.com/oauth/2.0/token?' +
            'grant_type=refresh_token' +
            '&refresh_token=' + token.refresh_token +
            '&client_id=' + BAIDU_APP_KEY +
            '&client_secret=' + BAIDU_SECRET_KEY);
        const data = await resp.json();
        if (data.access_token) {
            data.created_at = Date.now();
            if (!data.refresh_token) data.refresh_token = token.refresh_token;
            setBaiduToken(data);
            return data;
        }
    } catch (e) { console.error("刷新 token 失败:", e); }
    return null;
}

async function getValidBaiduToken() {
    let token = getBaiduToken();
    if (!token) { showStatus("请先绑定百度网盘", "error"); return null; }
    const expiresAt = token.created_at + token.expires_in * 1000;
    if (Date.now() > expiresAt - 60000) {
        token = await refreshBaiduToken();
        if (!token) { showStatus("token 已过期，请重新绑定", "error"); return null; }
    }
    return token;
}

async function uploadToBaidu() {
    const token = await getValidBaiduToken();
    if (!token) return;
    try {
        showStatus("正在上传到百度网盘...", "success");
        const data = await buildBackupData();
        const jsonStr = JSON.stringify(data);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', blob, 'backup.json');
        const resp = await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
            'method=upload&access_token=' + token.access_token +
            '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH) +
            '&ondup=overwrite', {
            method: 'POST',
            body: formData
        });
        const result = await resp.json();
        if (result.path) {
            localStorage.setItem('lastBaiduBackup', new Date().toISOString());
            showStatus("已上传到百度网盘", "success");
        } else {
            showStatus("上传失败: " + (result.error_msg || result.error || '未知错误'), "error");
        }
    } catch (e) { showStatus("上传失败: " + e.message, "error"); }
}

async function downloadFromBaidu() {
    const token = await getValidBaiduToken();
    if (!token) return;
    const existingQs = await dbGetAllQuestions();
    if (existingQs.length > 0 && !confirm("当前已有 " + existingQs.length + " 道题目，从百度网盘下载将覆盖同名数据。\n\n确定要继续吗？")) return;
    try {
        showStatus("正在从百度网盘下载...", "success");
        const resp = await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
            'method=download&access_token=' + token.access_token +
            '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH));
        if (!resp.ok) { showStatus("下载失败（文件可能不存在）", "error"); return; }
        const jsonStr = await resp.text();
        const data = JSON.parse(jsonStr);
        if (!confirm("备份包含 " + (data.questions?.length || 0) + " 道题目，确定导入？")) return;
        await importBackupData(data);
        await refreshAll();
        showStatus("从百度网盘恢复成功: " + (data.questions?.length || 0) + " 题", "success");
    } catch (e) { showStatus("下载失败: " + e.message, "error"); }
}

function unbindBaidu() {
    if (!confirm("确定解除百度网盘绑定？")) return;
    localStorage.removeItem('baidu_token');
    autoBaiduEnabled = false;
    localStorage.setItem('autoBaidu', '0');
    updateBaiduUI();
    showStatus("已解除绑定", "success");
}

function toggleAutoBaidu(enabled) {
    autoBaiduEnabled = enabled;
    localStorage.setItem('autoBaidu', enabled ? '1' : '0');
    if (enabled) doAutoBaiduBackup();
}

async function doAutoBaiduBackup() {
    if (!autoBaiduEnabled) return;
    const token = await getValidBaiduToken();
    if (!token) return;
    try {
        const data = await buildBackupData();
        const jsonStr = JSON.stringify(data);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', blob, 'backup.json');
        await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
            'method=upload&access_token=' + token.access_token +
            '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH) +
            '&ondup=overwrite', {
            method: 'POST',
            body: formData
        });
        localStorage.setItem('lastBaiduBackup', new Date().toISOString());
    } catch (e) { console.error("百度网盘自动备份失败:", e); }
}

// 包装数据修改操作，同时触发百度备份
const _origDoAutoBackup = doAutoBackup;
doAutoBackup = async function() {
    await _origDoAutoBackup();
    doAutoBaiduBackup();
};

// 备份弹窗打开时刷新 UI
const _origShowBackupModal = showBackupModal;
showBackupModal = function() {
    _origShowBackupModal();
    updateBaiduUI();
};

// ========== 登录/云端同步 ==========

let apiToken = localStorage.getItem('apiToken') || '';
let serverUrl = localStorage.getItem('serverUrl') || 'http://100.94.79.16:3001';
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let autoSyncEnabled = localStorage.getItem('autoSync') !== '0';

// 同步开关 - 每次操作自动同步到服务器
let syncEnabled = localStorage.getItem('syncEnabled') !== '0';
let syncInFlight = false;
let syncQueued = false;
let lastSyncError = null;
let serverConnected = null;
let syncTimer = null;
let syncPollTimer = null;
const SYNC_DEBOUNCE_MS = 800;
const SYNC_POLL_MS = 300000;
const SUPABASE_SYNC_MS = 300000;
let supabaseSyncTimer = null;

function apiHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiToken };
}

function setSyncStatus(text) {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = text;
}

window.showSyncStatus = function(text) {
    setSyncStatus(text);
    updateSyncBar();
};

async function checkServerConnection() {
    const el = document.getElementById('sync-bar-server');
    if (!el) return;
    if (!currentUser || !serverUrl) {
        el.textContent = '⚪ 未登录';
        serverConnected = null;
        return;
    }
    try {
        await apiCall('/api/recovery/status');
        el.textContent = '🟢 Mac mini';
        serverConnected = true;
    } catch (e) {
        el.textContent = '🔴 Mac mini';
        serverConnected = false;
    }
}

function updateSyncBar() {
    const stateEl = document.getElementById('sync-bar-state');
    const timeEl = document.getElementById('sync-bar-time');
    const btn = document.getElementById('sync-bar-btn');
    if (!stateEl) return;
    const canDoSync = canSync();
    btn.disabled = !canDoSync || syncInFlight;
    if (!currentUser) {
        stateEl.textContent = '同步: 未登录';
        timeEl.textContent = '';
        return;
    }
    if (syncInFlight) {
        stateEl.textContent = '🔄 同步中...';
        return;
    }
    if (lastSyncError) {
        stateEl.textContent = '🔴 同步失败';
        timeEl.textContent = lastSyncError;
        return;
    }
    const lastSync = localStorage.getItem('lastSyncTime');
    if (!lastSync) {
        stateEl.textContent = '⚪ 从未同步';
        timeEl.textContent = '';
        return;
    }
    const diffMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
    if (diffMin < 5) {
        stateEl.textContent = '🟢 同步: 最新';
    } else if (diffMin < 60) {
        stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin) + '分钟前';
    } else {
        stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin / 60) + '小时前';
    }
    timeEl.textContent = new Date(lastSync).toLocaleString();
}

async function handleSyncBarClick() {
    if (syncInFlight || !canSync()) return;
    const btn = document.getElementById('sync-bar-btn');
    btn.disabled = true;
    btn.textContent = '🔄 ...';
    lastSyncError = null;
    updateSyncBar();
    await runSync({ silent: false });
    btn.textContent = '🔄 同步';
    btn.disabled = false;
    updateSyncBar();
}

function canSync() {
    return !!(currentUser && syncEnabled && apiToken && serverUrl);
}

function getSyncCursor() {
    return localStorage.getItem('syncCursor') || '';
}

function setSyncCursor(value) {
    if (value) localStorage.setItem('syncCursor', value);
}

function clearSyncCursor() {
    localStorage.removeItem('syncCursor');
}

async function apiCall(path, method = 'GET', body = null) {
    if (!serverUrl) throw new Error('未配置服务器地址');
    const opts = { method, headers: apiHeaders() };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(serverUrl + path, opts);
    const raw = await resp.text();
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        const snippet = raw.substring(0, 100).replace(/\n/g, ' ');
        throw new Error(`服务器返回非JSON (${resp.status}): ${snippet}`);
    }
    if (!resp.ok) throw new Error(data.error || '请求失败');
    return data;
}

function updateLoginUI() {
    const btn = document.getElementById('login-btn');
    const status = document.getElementById('user-status');
    if (currentUser) {
        btn.textContent = '☁️ ' + (currentUser.nickname || currentUser.phone || '已登录');
        btn.onclick = () => showSyncModal();
        status.textContent = '已登录 · 云端同步可用';
    } else {
        btn.textContent = '👤 登录';
        btn.onclick = () => showLoginModal();
        status.textContent = '数据存储在本地，无需联网';
    }
}

function showLoginModal() {
    document.getElementById('server-url').value = serverUrl;
    document.getElementById('login-phone').value = localStorage.getItem('lastPhone') || '';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-modal').classList.add('active');
}
function closeLoginModal() { document.getElementById('login-modal').classList.remove('active'); }

function showSyncModal() {
    document.getElementById('sync-user-name').textContent = currentUser?.nickname || currentUser?.phone || '';
    document.getElementById('auto-sync-toggle').checked = autoSyncEnabled;
    document.getElementById('sync-toggle').checked = syncEnabled;
    document.getElementById('backup-server-url').value = serverUrl;
    const lastSync = localStorage.getItem('lastSyncTime');
    document.getElementById('sync-status').textContent = lastSync ? '上次同步: ' + new Date(lastSync).toLocaleString() : '尚未同步';
    document.getElementById('sync-modal').classList.add('active');
    checkRecoveryStatus();
}
function closeSyncModal() { document.getElementById('sync-modal').classList.remove('active'); }

function showSyncWarning(warnings) {
    const detailsEl = document.getElementById('sync-warning-details');
    detailsEl.innerHTML = warnings.map(w =>
        `<div style="margin-bottom:6px"><strong>${w.table}</strong>: ${w.before} → ${w.after} 条 (丢失 ${w.lost} 条)${w.detail ? '<br><span style="color:var(--text-tertiary)>' + w.detail + '</span>' : ''}</div>`
    ).join('');
    const msgEl = document.getElementById('sync-warning-message');
    const hasCritical = warnings.some(w => w.severity === 'critical');
    msgEl.textContent = hasCritical
        ? '同步过程中检测到严重数据丢失，部分题目可能未同步成功。'
        : '同步过程中检测到部分数据量减少，可能存在数据丢弃。';
    document.getElementById('sync-warning-modal').classList.add('active');
    const log = JSON.parse(localStorage.getItem('syncWarningLog') || '[]');
    log.push({ time: new Date().toISOString(), warnings });
    if (log.length > 50) log.splice(0, log.length - 50);
    localStorage.setItem('syncWarningLog', JSON.stringify(log));
}

function closeSyncWarning() {
    document.getElementById('sync-warning-modal').classList.remove('active');
}

function handleAuthError(e) {
    const msg = e.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION_REFUSED')) {
        showLoginError('服务器不可达，请确认：1) 服务端已启动 2) 地址正确');
    } else {
        showLoginError('连接失败: ' + msg);
    }
}

async function doLogin() {
    const url = document.getElementById('server-url').value.trim().replace(/\/$/, '');
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;
    if (!url || !phone || !password) { showLoginError('请填写完整信息'); return; }
    try {
        const resp = await fetch(url + '/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showLoginError(data.error || '服务器错误 (' + resp.status + ')');
            return;
        }
        const data = await resp.json();
        if (data.error) { showLoginError(data.error); return; }
        serverUrl = url; apiToken = data.token; currentUser = data;
        localStorage.setItem('serverUrl', url);
        localStorage.setItem('apiToken', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data));
        localStorage.setItem('lastPhone', phone);
        initRemoteSync(serverUrl, apiToken, syncEnabled);
        clearSyncCursor();
        closeLoginModal(); updateLoginUI();
        restartSyncPolling();
        if (autoSyncEnabled && syncEnabled) queueAutoSync(true);
        startSupabaseAutoSync();
        showStatus('登录成功', 'success');
    } catch (e) { handleAuthError(e); }
}

async function doRegister() {
    const url = document.getElementById('server-url').value.trim().replace(/\/$/, '');
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;
    if (!url || !phone || !password) { showLoginError('请填写完整信息'); return; }
    try {
        const resp = await fetch(url + '/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showLoginError(data.error || '服务器错误 (' + resp.status + ')');
            return;
        }
        const data = await resp.json();
        if (data.error) { showLoginError(data.error); return; }
        serverUrl = url; apiToken = data.token; currentUser = data;
        localStorage.setItem('serverUrl', url);
        localStorage.setItem('apiToken', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data));
        localStorage.setItem('lastPhone', phone);
        initRemoteSync(serverUrl, apiToken, syncEnabled);
        clearSyncCursor();
        closeLoginModal(); updateLoginUI();
        restartSyncPolling();
        if (autoSyncEnabled && syncEnabled) queueAutoSync(true);
        startSupabaseAutoSync();
        showStatus('注册成功', 'success');
    } catch (e) { handleAuthError(e); }
}

function showLoginError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg; el.style.display = 'block';
}

function doLogout() {
    if (!confirm('确定退出登录？本地数据不会删除。')) return;
    apiToken = ''; currentUser = null;
    localStorage.removeItem('apiToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('lastSyncTime');
    clearSyncCursor();
    stopSyncPolling();
    closeSyncModal(); updateLoginUI();
    showStatus('已退出登录', 'success');
}

async function checkRecoveryStatus() {
    const el = document.getElementById('recovery-status');
    if (!el) return;
    try {
        const resp = await apiCall('/api/recovery/status');
        el.textContent = resp.supabase_enabled ? '✅ Supabase 已连接' : '⚠️ Supabase 未配置';
        el.style.color = resp.supabase_enabled ? '#16a34a' : '#f59e0b';
    } catch (e) {
        el.textContent = '❌ 无法连接服务器';
        el.style.color = '#ef4444';
    }
}

async function fullSyncToCloud() {
    if (!confirm('将所有数据全量推送到 Supabase，用于容灾备份。\n\n确定继续？')) return;
    try {
        showStatus('正在同步到云端...', 'info');
        const resp = await apiCall('/api/recovery/sync-to-supabase', 'POST');
        if (resp.error) { showStatus('同步失败: ' + resp.error, 'error'); return; }
        showStatus(resp.message || '☁️ 云端同步已启动，后台执行中', 'success');
    } catch (e) {
        showStatus('同步失败: ' + e.message, 'error');
    }
}

async function silentSupabaseSync() {
    if (!currentUser || !apiToken || !serverUrl) return;
    try {
        await apiCall('/api/recovery/sync-to-supabase', 'POST');
    } catch (e) {
        console.warn('[Supabase自动同步] 失败:', e.message);
    }
}

function startSupabaseAutoSync() {
    if (supabaseSyncTimer) clearInterval(supabaseSyncTimer);
    silentSupabaseSync();
    supabaseSyncTimer = setInterval(silentSupabaseSync, SUPABASE_SYNC_MS);
}

function switchToBackupServer() {
    const url = document.getElementById('backup-server-url').value.trim().replace(/\/$/, '');
    if (!url) { showStatus('请输入备用服务器地址', 'error'); return; }
    if (!confirm('即将切换到备用服务器：' + url + '\n\n切换后将从备用服务器同步数据。\n确定继续？')) return;
    serverUrl = url;
    localStorage.setItem('serverUrl', url);
    initRemoteSync(serverUrl, apiToken, syncEnabled);
    restartSyncPolling();
    showStatus('已切换到备用服务器', 'success');
    document.getElementById('server-url').value = url;
}

async function syncFromPrimaryServer() {
    if (!confirm('从主服务器拉取最新数据到本地备用服务器。\n\n确定继续？')) return;
    try {
        showStatus('正在从主服务器拉取数据...', 'info');
        const resp = await apiCall('/api/recovery/sync-from-primary', 'POST');
        if (resp.error) { showStatus('同步失败: ' + resp.error, 'error'); return; }
        showStatus(resp.message || '📥 主服务器数据拉取已启动', 'success');
    } catch (e) {
        showStatus('同步失败: ' + e.message, 'error');
    }
}

async function updateServerSyncStatus() {
    const el = document.getElementById('server-sync-status');
    if (!el) return;
    try {
        const resp = await apiCall('/api/recovery/server-sync-status', 'GET');
        if (!resp.server_sync_enabled) {
            el.textContent = '未配置（需设置 PRIMARY_SERVER_URL）';
            el.style.color = '#888';
        } else if (resp.sync_in_progress) {
            el.textContent = '正在同步中...';
            el.style.color = '#2563eb';
        } else if (resp.last_result && !resp.last_result.error) {
            el.textContent = '✅ 上次同步: ' + (resp.last_sync_at || '--');
            el.style.color = '#16a34a';
        } else {
            el.textContent = resp.last_result?.error ? '❌ ' + resp.last_result.error : '待同步';
            el.style.color = '#f59e0b';
        }
    } catch (e) {
        el.textContent = '❌ 无法获取状态';
        el.style.color = '#ef4444';
    }
}

function stopSyncPolling() {
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }
    if (syncPollTimer) {
        clearInterval(syncPollTimer);
        syncPollTimer = null;
    }
}

function restartSyncPolling() {
    stopSyncPolling();
    if (!autoSyncEnabled || !canSync()) return;
    syncPollTimer = setInterval(() => { runSync({ silent: true }); }, SYNC_POLL_MS);
}

function stopFloatingPolling() {
    if (floatingPollTimer) {
        clearInterval(floatingPollTimer);
        floatingPollTimer = null;
    }
}

function restartFloatingPolling() {
    stopFloatingPolling();
    floatingPollTimer = setInterval(pollFloatingEvents, 500);
}

function stopAllPolling() {
    stopSyncPolling();
    stopFloatingPolling();
}

function restartAllPolling() {
    restartSyncPolling();
    restartFloatingPolling();
}

function queueAutoSync(immediate = false) {
    if (!autoSyncEnabled || !canSync()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { runSync({ silent: true }); }, immediate ? 0 : SYNC_DEBOUNCE_MS);
}

async function runSync({ forceFullPull = false, skipPush = false, silent = false } = {}) {
    if (!currentUser) {
        if (!silent) showStatus('请先登录', 'error');
        return false;
    }
    if (!syncEnabled) {
        if (!silent) showStatus('请先开启实时同步', 'error');
        return false;
    }
    if (syncInFlight) {
        syncQueued = true;
        return false;
    }

    syncInFlight = true;
    try {
        setSyncStatus(skipPush ? '正在下载...' : '正在同步...');

        if (!skipPush) {
            const payload = await dbBuildSyncPayload();
            const pushResp = await apiCall('/api/sync/push', 'POST', payload);
            await dbFinalizeSuccessfulSync(pushResp.applied || {});
        }

        const pullResp = await apiCall('/api/sync/pull');
        await dbApplyRemoteSnapshot(pullResp);
        cloudProviders = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
        currentProviderId = localStorage.getItem('current_provider_id') || '';
        await refreshAll();

        const syncTime = pullResp.now || new Date().toISOString();
        localStorage.setItem('lastSyncTime', syncTime);
        setSyncCursor(syncTime);
        setSyncStatus('上次同步: ' + new Date(syncTime).toLocaleString());

        if (!silent) showStatus(skipPush ? '下载完成' : '同步完成', 'success');
        lastSyncError = null;
        return true;
    } catch (e) {
        setSyncStatus((skipPush ? '下载' : '同步') + '失败: ' + e.message);
        if (!silent) showStatus((skipPush ? '下载' : '同步') + '失败: ' + e.message, 'error');
        lastSyncError = e.message;
        return false;
    } finally {
        syncInFlight = false;
        updateSyncBar();
        if (syncQueued && canSync()) {
            syncQueued = false;
            setTimeout(() => { runSync({ silent: true }); }, 0);
        } else {
            syncQueued = false;
        }
    }
}

// 同步：本地 → 云端 + 云端 → 本地
async function doSync() {
    return runSync({ silent: false });
}

// 强制从云端拉取最新数据
async function doSyncDown() {
    if (!currentUser) { showStatus('请先登录', 'error'); return false; }
    if (!confirm('将以服务器上的数据为准，重建当前手机上的本地缓存。\n\n如果这台手机有还没同步到服务器的数据，请先不要继续。\n\n确定继续吗？')) return false;
    try {
        setSyncStatus('正在从云端重建数据...');
        const pullResp = await apiCall('/api/sync/pull');
        await dbReplaceWithRemoteSnapshot(pullResp);
        await refreshAll();
        const syncTime = pullResp.now || new Date().toISOString();
        localStorage.setItem('lastSyncTime', syncTime);
        setSyncCursor(syncTime);
        setSyncStatus('上次同步: ' + new Date(syncTime).toLocaleString());
        showStatus('已按服务器数据重建本地缓存', 'success');
        return true;
    } catch (e) {
        setSyncStatus('下载失败: ' + e.message);
        showStatus('下载失败: ' + e.message, 'error');
        return false;
    }
}

function toggleAutoSync(enabled) {
    autoSyncEnabled = enabled;
    localStorage.setItem('autoSync', enabled ? '1' : '0');
    restartSyncPolling();
    if (enabled) queueAutoSync(true);
}

function toggleSync(enabled) {
    syncEnabled = enabled;
    localStorage.setItem('syncEnabled', enabled ? '1' : '0');
    initRemoteSync(serverUrl, apiToken, syncEnabled);
    restartSyncPolling();
    if (enabled) queueAutoSync(true);
    showStatus(enabled ? '实时同步已开启' : '实时同步已关闭', 'success');
}

// 包装数据操作，自动同步
const _origDoAutoBackup2 = doAutoBackup;
doAutoBackup = async function() {
    await _origDoAutoBackup2();
    queueAutoSync();
};

// 初始化登录状态
updateLoginUI();

// ========== APP 更新 ==========
let _updateInfo = null;

document.getElementById('current-version-display').textContent = APP_VERSION_NAME;

async function manualCheckUpdate() {
    const btn = document.getElementById('check-update-btn');
    const status = document.getElementById('check-update-status');
    btn.disabled = true;
    btn.textContent = '检查中...';
    status.textContent = '';
    status.style.color = '#888';
    if (!serverUrl) {
        status.textContent = '⚠️ 未配置服务器地址，请先登录';
        status.style.color = '#f59e0b';
        btn.disabled = false;
        btn.textContent = '检查更新';
        return;
    }
    try {
        const resp = await fetch(serverUrl + '/api/version/latest?current_code=' + APP_VERSION_CODE);
        if (!resp.ok) throw new Error('服务器响应异常 ' + resp.status);
        const data = await resp.json();
        if (data.has_update) {
            status.textContent = '🎉 发现新版本 ' + data.version_name;
            status.style.color = '#10b981';
            _updateInfo = data;
            document.getElementById('update-version-name').textContent = data.version_name;
            document.getElementById('update-release-notes').textContent = data.release_notes || '优化体验，修复问题';
            document.getElementById('update-progress').style.display = 'none';
            document.getElementById('update-btn').disabled = false;
            document.getElementById('update-btn').textContent = '下载更新';
            document.getElementById('update-modal').classList.add('active');
        } else {
            status.textContent = '✅ 已是最新版本';
            status.style.color = '#10b981';
        }
    } catch (e) {
        status.textContent = '❌ 连接失败: ' + e.message;
        status.style.color = '#ef4444';
    }
    btn.disabled = false;
    btn.textContent = '检查更新';
}

async function checkAppUpdate() {
    if (!serverUrl) return;
    try {
        const resp = await fetch(serverUrl + '/api/version/latest?current_code=' + APP_VERSION_CODE);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.has_update) return;
        const skipped = localStorage.getItem('skip_version_code');
        if (skipped && parseInt(skipped) >= data.version_code) return;
        _updateInfo = data;
        document.getElementById('update-version-name').textContent = data.version_name;
        document.getElementById('update-release-notes').textContent = data.release_notes || '优化体验，修复问题';
        document.getElementById('update-progress').style.display = 'none';
        document.getElementById('update-btn').disabled = false;
        document.getElementById('update-btn').textContent = '下载更新';
        document.getElementById('update-modal').classList.add('active');
    } catch (e) {}
}

function dismissUpdate() {
    document.getElementById('update-modal').classList.remove('active');
    if (_updateInfo) localStorage.setItem('skip_version_code', _updateInfo.version_code);
}

async function downloadAndInstall() {
    if (!_updateInfo || !serverUrl) return;
    const btn = document.getElementById('update-btn');
    const progressWrap = document.getElementById('update-progress');
    const progressBar = document.getElementById('update-progress-bar');
    const progressText = document.getElementById('update-progress-text');
    btn.disabled = true;
    btn.textContent = '打开下载...';
    progressWrap.style.display = 'none';
    try {
        const dlUrl = serverUrl + _updateInfo.download_url;
        window.open(dlUrl, '_system');
        btn.textContent = '已跳转浏览器';
        showStatus('正在浏览器中下载，请安装后重启APP', 'success');
    } catch (e) {
        showStatus('跳转失败: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = '重试下载';
    }
}

// 监听 AI 分析完成事件
window.addEventListener('question-ai-ready', async (event) => {
    const { questionId } = event.detail;
    console.log('AI 分析完成，刷新题目:', questionId);

    // 重新加载所有题目并渲染 (如果想更精细，可以只更新对应的 DOM)
    allQuestions = await dbGetAllQuestions();
    renderQuestions();
});

// ========== AI教学内容生产流水线 ==========
// Prompt 常量、callCloudAIStream、safeParseJSON 已提取到 ai.js

// ========== 统一 Markdown 渲染（含 KaTeX + 手绘占位） ==========

var currentDrawNode = null;

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(mdText, containerEl, options) {
    options = options || {};
    var drawings = options.drawings || {};
    var readOnly = options.readOnly || false;
    var node = options.node || null;
    if (node) currentDrawNode = node;

    try {
        var html = marked.parse(mdText || '');

        html = html.replace(/\[DRAW:id=([^:\]]+):([^\]]+)\]/g, function(m, id, desc) {
            return _buildDrawHTML(id, desc.trim(), drawings, readOnly);
        });
        html = html.replace(/\[绘图占位[：:]([^\]]+)\]/g, function(m, desc) {
            var id = 'draw_' + Math.random().toString(36).substr(2, 6);
            return _buildDrawHTML(id, desc.trim(), drawings, readOnly);
        });

        containerEl.innerHTML = html;

        if (typeof renderMathInElement === 'function') {
            renderMathInElement(containerEl, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false,
                errorColor: '#cc0000',
                strict: false
            });
        }

        containerEl.querySelectorAll('.draw-init-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var wrap = btn.closest('.draw-placeholder').querySelector('.draw-canvas-wrap');
                var id = wrap.getAttribute('data-draw-id');
                var desc = wrap.getAttribute('data-draw-desc');
                initDrawCanvas(wrap, id, desc);
            });
        });
        containerEl.querySelectorAll('.draw-saved-img').forEach(function(img) {
            img.addEventListener('click', function() {
                if (readOnly) return;
                var id = img.getAttribute('data-draw-id');
                var desc = img.getAttribute('data-draw-desc');
                var wrap = img.closest('.draw-placeholder').querySelector('.draw-canvas-wrap');
                if (!wrap) {
                    var ph = img.closest('.draw-placeholder');
                    wrap = document.createElement('div');
                    wrap.className = 'draw-canvas-wrap';
                    wrap.setAttribute('data-draw-id', id);
                    wrap.setAttribute('data-draw-desc', desc);
                    ph.appendChild(wrap);
                }
                initDrawCanvas(wrap, id, desc, img.src);
            });
        });

    } catch (e) {
        console.error('renderMarkdown 失败:', e);
        containerEl.textContent = mdText || '';
    }
}

function _buildDrawHTML(id, desc, drawings, readOnly) {
    var d = drawings[id];
    if (d && d.data) {
        return '<div class="draw-placeholder" data-draw-id="' + id + '">' +
            '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + escapeHtml(desc) + '</span></div>' +
            '<img class="draw-saved-img" src="' + d.data + '" data-draw-id="' + id + '" data-draw-desc="' + escapeHtml(desc) + '" />' +
            '</div>';
    }
    return '<div class="draw-placeholder" data-draw-id="' + id + '">' +
        '<div class="draw-placeholder-header"><span class="draw-placeholder-desc">🎨 ' + escapeHtml(desc) + '</span>' +
        (readOnly ? '' : '<div class="draw-toolbar"><button class="draw-init-btn">✏️ 手绘</button></div>') +
        '</div>' +
        '<div class="draw-canvas-wrap" data-draw-id="' + id + '" data-draw-desc="' + escapeHtml(desc) + '"></div>' +
        '</div>';
}

var drawState = null;

function initDrawCanvas(wrapEl, drawId, desc, existingImgSrc) {
    wrapEl.innerHTML = '';
    var w = wrapEl.offsetWidth || wrapEl.parentElement.offsetWidth - 4 || 300;
    var h = 220;
    var canvas = document.createElement('canvas');
    canvas.width = Math.min(w, 1200);
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    wrapEl.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (existingImgSrc) {
        var img = new Image();
        img.onload = function() { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
        img.src = existingImgSrc;
    }

    var toolbar = document.createElement('div');
    toolbar.className = 'draw-toolbar';
    toolbar.style.padding = '6px 8px';
    toolbar.innerHTML =
        '<button data-c="#000" class="active">⚫</button>' +
        '<button data-c="#E63946">🔴</button>' +
        '<button data-c="#2563EB">🔵</button>' +
        '<button data-c="#16A34A">🟢</button>' +
        '<span style="width:8px"></span>' +
        '<button data-w="2">细</button>' +
        '<button data-w="4" class="active">中</button>' +
        '<button data-w="6">粗</button>' +
        '<span style="width:8px"></span>' +
        '<button data-mode="erase">橡皮</button>' +
        '<button data-act="undo">撤销</button>' +
        '<button data-act="clear">清空</button>' +
        '<span style="flex:1"></span>' +
        '<button data-act="save" style="background:var(--primary);color:#fff">保存</button>' +
        '<button data-act="cancel" style="background:var(--danger);color:#fff">取消</button>';
    wrapEl.insertBefore(toolbar, canvas);

    drawState = {
        canvas: canvas, ctx: ctx, drawId: drawId, desc: desc,
        color: '#000', width: 4, mode: 'draw',
        paths: [], currentPath: null, drawing: false,
        lastX: 0, lastY: 0
    };

    toolbar.querySelectorAll('button[data-c]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            drawState.color = btn.getAttribute('data-c');
            drawState.mode = 'draw';
            toolbar.querySelectorAll('button[data-c],button[data-mode]').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
        });
    });
    toolbar.querySelectorAll('button[data-w]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            drawState.width = parseInt(btn.getAttribute('data-w'));
            toolbar.querySelectorAll('button[data-w]').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
        });
    });
    toolbar.querySelector('button[data-mode="erase"]').addEventListener('click', function() {
        drawState.mode = drawState.mode === 'erase' ? 'draw' : 'erase';
        toolbar.querySelectorAll('button[data-c],button[data-mode]').forEach(function(b) { b.classList.remove('active'); });
        if (drawState.mode === 'erase') btn.classList.add('active');
        else toolbar.querySelector('button[data-c="#000"]').classList.add('active');
    });
    toolbar.querySelector('button[data-act="undo"]').addEventListener('click', function() {
        if (drawState.paths.length > 0) {
            drawState.paths.pop();
            redrawCanvas();
        }
    });
    toolbar.querySelector('button[data-act="clear"]').addEventListener('click', function() {
        drawState.paths = [];
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
    toolbar.querySelector('button[data-act="save"]').addEventListener('click', function() {
        saveDrawing(drawId, desc);
    });
    toolbar.querySelector('button[data-act="cancel"]').addEventListener('click', function() {
        cancelDraw(wrapEl, drawId, desc);
    });

    function getPos(e) {
        var rect = canvas.getBoundingClientRect();
        var sx = canvas.width / rect.width;
        var sy = canvas.height / rect.height;
        var cx, cy;
        if (e.touches && e.touches[0]) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
    }

    function startDraw(e) {
        e.preventDefault();
        drawState.drawing = true;
        var p = getPos(e);
        drawState.lastX = p.x; drawState.lastY = p.y;
        drawState.currentPath = { color: drawState.color, width: drawState.width, mode: drawState.mode, points: [{x: p.x, y: p.y}] };
    }
    function moveDraw(e) {
        if (!drawState.drawing) return;
        e.preventDefault();
        var p = getPos(e);
        var ctx2 = drawState.ctx;
        ctx2.beginPath();
        ctx2.moveTo(drawState.lastX, drawState.lastY);
        ctx2.lineTo(p.x, p.y);
        if (drawState.mode === 'erase') {
            ctx2.strokeStyle = '#fff';
            ctx2.lineWidth = drawState.width * 3;
        } else {
            ctx2.strokeStyle = drawState.color;
            ctx2.lineWidth = drawState.width;
        }
        ctx2.lineCap = 'round';
        ctx2.lineJoin = 'round';
        ctx2.stroke();
        drawState.lastX = p.x; drawState.lastY = p.y;
        drawState.currentPath.points.push({x: p.x, y: p.y});
    }
    function endDraw(e) {
        if (!drawState.drawing) return;
        e.preventDefault();
        drawState.drawing = false;
        if (drawState.currentPath && drawState.currentPath.points.length > 0) {
            drawState.paths.push(drawState.currentPath);
        }
        drawState.currentPath = null;
    }

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointerleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, {passive: false});
    canvas.addEventListener('touchmove', moveDraw, {passive: false});
    canvas.addEventListener('touchend', endDraw, {passive: false});

    function redrawCanvas() {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (var i = 0; i < drawState.paths.length; i++) {
            var path = drawState.paths[i];
            ctx.beginPath();
            ctx.strokeStyle = path.mode === 'erase' ? '#fff' : path.color;
            ctx.lineWidth = path.mode === 'erase' ? path.width * 3 : path.width;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            for (var j = 0; j < path.points.length; j++) {
                var pt = path.points[j];
                if (j === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
        }
    }
}

async function saveDrawing(drawId, desc) {
    if (!drawState || !currentDrawNode) return;
    var canvas = drawState.canvas;
    try {
        var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const ver = await getCurrentVersion(currentDrawNode);
        if (!ver) return;
        if (!ver.drawings) ver.drawings = {};
        ver.drawings[drawId] = {
            data: dataUrl, desc: desc,
            width: canvas.width, height: canvas.height
        };
        await dbUpdateVersion(ver.id, { drawings: ver.drawings });
        var contentEl = document.getElementById('verify-content');
        var editPreviewEl = document.getElementById('verify-edit-preview');
        var projContentEl = document.getElementById('projection-content');
        if (contentEl && contentEl.style.display !== 'none') {
            renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: currentDrawNode });
        }
        if (editPreviewEl && editPreviewEl.style.display !== 'none') {
            renderMarkdown(document.getElementById('verify-edit-textarea').value, editPreviewEl, { drawings: ver.drawings || {}, node: currentDrawNode });
        }
        if (projContentEl && document.getElementById('projection-overlay').classList.contains('active')) {
            renderMarkdown(ver.content_markdown, projContentEl, { drawings: ver.drawings || {}, node: currentDrawNode, readOnly: true });
        }
        showStatus('手绘图已保存', 'success');
    } catch (e) {
        console.error('saveDrawing failed:', e);
        showStatus('手绘图保存失败: ' + e.message, 'error');
    }
}

function cancelDraw(wrapEl, drawId, desc) {
    if (!currentDrawNode) return;
    var drawings = (currentDrawNode.drawings || {});
    var existing = drawings[drawId];
    if (existing && existing.data) {
        wrapEl.innerHTML = '<img class="draw-saved-img" src="' + existing.data + '" data-draw-id="' + drawId + '" data-draw-desc="' + escapeHtml(desc) + '" />';
        wrapEl.querySelector('img').addEventListener('click', function() {
            initDrawCanvas(wrapEl, drawId, desc, this.src);
        });
    } else {
        wrapEl.innerHTML = '';
    }
    drawState = null;
}

// ========== 教学模块 UI ==========

let allTeachingNodes = [];
let currentVerifyNodeId = null;
let projectionNodeList = [];
let projectionIndex = 0;

async function loadTeachingView() {
    const migrated = await migrateTeachingNodesToVersions();
    if (migrated > 0) console.log(`[Teaching] 迁移了 ${migrated} 个节点到多版本模式`);
    allTeachingNodes = await dbGetAllTeachingNodes();
    // 断点续传：将上次中断的 GENERATING 状态重置为 PENDING
    let resetCount = 0;
    for (const node of allTeachingNodes) {
        const ver = await getCurrentVersion(node);
        if (ver && ver.status === 'GENERATING') {
            await dbUpdateVersion(ver.id, { status: 'PENDING', error_msg: null });
            resetCount++;
        }
    }
    if (resetCount > 0) {
        showStatus(`已恢复 ${resetCount} 个中断的生成任务`, 'info');
    }
    renderTeachingStats();
    renderTeachingNodeList();
    updateSelectedCount();
    const hasNodes = allTeachingNodes.length > 0;
    document.getElementById('teaching-queue-card').style.display = hasNodes ? 'block' : 'none';
    document.getElementById('teaching-project-entry').style.display = hasNodes ? 'block' : 'none';
}

async function getCurrentVersion(node) {
    if (!node.current_version_id) return null;
    return await dbGetVersion(node.current_version_id);
}

async function getNodeVersions(node) {
    return await dbGetVersionsByNode(node.id);
}

async function renderTeachingStats() {
    const counts = { PENDING: 0, GENERATING: 0, GENERATED: 0, VERIFIED: 0, ERROR: 0 };
    for (const n of allTeachingNodes) {
        const ver = await getCurrentVersion(n);
        if (ver && counts[ver.status] !== undefined) counts[ver.status]++;
    }
    document.getElementById('stat-pending').textContent = counts.PENDING;
    document.getElementById('stat-generating').textContent = counts.GENERATING;
    document.getElementById('stat-generated').textContent = counts.GENERATED;
    document.getElementById('stat-verified').textContent = counts.VERIFIED;
    document.getElementById('stat-error').textContent = counts.ERROR;
}

async function renderTeachingNodeList() {
    const container = document.getElementById('teaching-node-list');
    if (allTeachingNodes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:20px">暂无知识点，请先拆解章节</p>';
        return;
    }
    const nodeStatuses = {};
    const nodeVersions = {};
    for (const node of allTeachingNodes) {
        const versions = await getNodeVersions(node);
        nodeVersions[node.id] = versions;
        const curVer = versions.find(v => v.is_current) || versions[versions.length - 1];
        nodeStatuses[node.id] = curVer ? curVer.status : 'PENDING';
    }
    // Group by chapter
    const chapterGroups = {};
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
        const statusOrder = { GENERATING: 0, PENDING: 1, ERROR: 2, GENERATED: 3, VERIFIED: 4 };
        nodes.sort((a, b) => (statusOrder[nodeStatuses[a.id]] ?? 9) - (statusOrder[nodeStatuses[b.id]] ?? 9));
        const counts = {};
        nodes.forEach(n => { const s = nodeStatuses[n.id]; counts[s] = (counts[s] || 0) + 1; });
        const summaryParts = [];
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
            const curVer = versions.find(v => v.is_current) || versions[versions.length - 1];
            const statusText = { PENDING: '待生成', GENERATING: '生成中', GENERATED: '待校验', VERIFIED: '已完成', ERROR: '错误' }[status] || status;
            const verCount = versions.length;
            const verLabel = verCount > 1 ? `v${curVer?.version_num || 1}/${verCount}` : `v${curVer?.version_num || 1}`;
            const showCheckbox = status === 'PENDING' || status === 'ERROR';
            const checkbox = showCheckbox ? `<input type="checkbox" class="node-select-cb" data-node-id="${node.id}" onchange="updateSelectedCount()" style="width:18px;height:18px;margin-right:6px;flex-shrink:0" />` : '<div style="width:24px;flex-shrink:0"></div>';
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

async function showNodeDiagram(nodeId) {
    const node = await dbGetTeachingNode(nodeId);
    if (!node || !node.diagram) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:90vw;max-height:80vh;overflow:auto;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    box.innerHTML = '<div style="font-size:14px;font-weight:700;margin-bottom:12px;color:#1f2937">' + node.name + ' - 示意图</div>' +
        '<div style="min-width:200px;min-height:150px;display:flex;align-items:center;justify-content:center">' +
        (node.diagram.startsWith('<svg') ? node.diagram : '<img src="' + node.diagram + '" style="max-width:100%;max-height:60vh" />') +
        '</div>' +
        '<div style="margin-top:12px;font-size:11px;color:#9ca3af">点击空白处关闭 · 手绘功能在校验弹窗中使用</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

async function atomizeChapter() {
    const chapter = document.getElementById('teaching-chapter-input').value.trim();
    if (!chapter) {
        showStatus('请输入章节名称', 'error');
        return;
    }
    const provider = getCurrentProvider();
    if (!provider) {
        showStatus('请先添加并选择一个模型服务商', 'error');
        return;
    }

    const mode = document.getElementById('atomize-mode-select').value;
    const btn = document.getElementById('atomize-btn');
    btn.disabled = true;
    btn.textContent = mode === 'multimodal' ? '图文拆解中...' : '拆解中...';

    try {
        let parsed = null;

        if (mode === 'multimodal') {
            let retryCount = 0;
            const maxRetries = 2;
            while (retryCount < maxRetries && !parsed) {
                const isRetry = retryCount > 0;
                const promptText = isRetry
                    ? `上一次返回的内容无法解析为合法JSON。请重新拆解章节【${chapter}】，只输出纯JSON数组（含 diagram 字段），不要任何markdown标记或解释文字。`
                    : `请拆解章节：【${chapter}】`;
                btn.textContent = isRetry ? `JSON解析失败，重试(${retryCount}/${maxRetries})...` : '图文拆解中...';
                const result = await callCloudAIMultimodal(promptText, {
                    systemPrompt: KNOWLEDGE_ATOMIZER_PROMPT_MULTIMODAL,
                    temperature: isRetry ? 0.3 : 0.5
                });
                const textToParse = result.text || '';
                parsed = safeParseJSON(textToParse);
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
                resultText = await callCloudAIStream(
                    promptText,
                    (chunk, full) => { btn.textContent = (isRetry ? `重试(${retryCount}/${maxRetries}) ` : '拆解中... ') + full.length + '字'; },
                    { systemPrompt: KNOWLEDGE_ATOMIZER_PROMPT, temperature: isRetry ? 0.3 : 0.5 }
                );
                parsed = safeParseJSON(resultText);
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
            const node = await dbCreateTeachingNode({
                chapter,
                subject: '物理',
                name: item.name,
                difficulty: item.difficulty || '基础',
                key_concept: item.key_concept || '',
                diagram
            });
            await dbCreateVersion(node.id, { version_num: 1, status: 'PENDING', is_current: true });
            created++;
        }

        const diagramInfo = withDiagram > 0 ? `，其中 ${withDiagram} 个带示意图` : '';
        showStatus(`已拆解出 ${created} 个知识点${diagramInfo}`, 'success');
        await loadTeachingView();
    } catch (e) {
        showStatus('拆解失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 拆解';
    }
}

// ========== 任务队列引擎 ==========

class TeachingTaskQueue {
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
        document.getElementById('batch-start-btn').style.display = 'none';
        document.getElementById('batch-pause-btn').style.display = 'inline-block';
        document.getElementById('teaching-progress-wrap').style.display = 'block';
        this._scheduleNext();
    }

    pause() {
        this.isRunning = false;
        document.getElementById('batch-start-btn').style.display = 'inline-block';
        document.getElementById('batch-start-btn').textContent = '▶ 继续';
        document.getElementById('batch-pause-btn').style.display = 'none';
    }

    async _scheduleNext() {
        if (!this.isRunning) return;
        if (this.activeCount >= this.maxConcurrency) return;
        let nextNode = null;
        for (const n of allTeachingNodes) {
            if (this.selectedIds.length > 0 && !this.selectedIds.includes(n.id)) continue;
            const ver = await getCurrentVersion(n);
            if (ver && ver.status === 'PENDING') {
                nextNode = n;
                break;
            }
        }
        if (!nextNode) {
            if (this.activeCount === 0) {
                this.isRunning = false;
                document.getElementById('batch-start-btn').style.display = 'inline-block';
                document.getElementById('batch-start-btn').textContent = '▶ 生成选中';
                document.getElementById('batch-pause-btn').style.display = 'none';
                if (this.totalProcessed > 0) {
                    showStatus(`批量生成完成，共处理 ${this.totalProcessed} 个知识点`, 'success');
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

    async _processNode(node) {
        const ver = await getCurrentVersion(node);
        if (!ver) return;
        await dbUpdateVersion(ver.id, { status: 'GENERATING', error_msg: null });
        await renderTeachingStats();
        await renderTeachingNodeList();

        let retryCount = 0;
        const maxRetries = 3;
        let lastError = null;
        let fullText = '';

        while (retryCount < maxRetries) {
            try {
                fullText = '';
                const provider = getCurrentProvider();
                const result = await callCloudAIStream(
                    `请生成关于【${node.name}】的教学内容。${node.key_concept ? '核心概念：' + node.key_concept : ''}`,
                    (chunk, full) => {
                        fullText = full;
                        this._updateNodeProgress(node.id, full);
                    },
                    { systemPrompt: TEACHING_GENERATOR_PROMPT, temperature: 0.7 }
                );

                if (!result || result.trim().length < 50) {
                    throw new Error('生成内容过短');
                }

                await dbUpdateVersion(ver.id, {
                    status: 'GENERATED',
                    content_markdown: result,
                    content_json: null,
                    error_msg: null,
                    retry_count: retryCount,
                    model_name: provider ? provider.model : ''
                });
                this.totalProcessed++;
                await this._updateProgress();
                await renderTeachingStats();
                await renderTeachingNodeList();
                return;
            } catch (e) {
                lastError = e;
                retryCount++;
                if (retryCount < maxRetries) {
                    await dbUpdateVersion(ver.id, { retry_count: retryCount });
                    console.warn(`[TeachingQueue] 节点 ${node.name} 第${retryCount}次重试:`, e.message);
                }
            }
        }

        await dbUpdateVersion(ver.id, {
            status: 'ERROR',
            error_msg: lastError ? lastError.message.substring(0, 100) : '未知错误',
            retry_count: retryCount
        });
        this.totalProcessed++;
        await this._updateProgress();
        await renderTeachingStats();
        await renderTeachingNodeList();
    }

    _updateNodeProgress(nodeId, fullText) {
        const card = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (card) {
            const meta = card.querySelector('.teaching-node-meta');
            if (meta) meta.textContent = `生成中... ${fullText.length}字`;
        }
    }

    async _updateProgress() {
        const total = this.selectedIds.length > 0 ? this.selectedIds.length : allTeachingNodes.length;
        let done = 0;
        for (const n of allTeachingNodes) {
            if (this.selectedIds.length > 0 && !this.selectedIds.includes(n.id)) continue;
            const ver = await getCurrentVersion(n);
            if (ver && (ver.status === 'GENERATED' || ver.status === 'VERIFIED' || ver.status === 'ERROR')) done++;
        }
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        document.getElementById('teaching-progress-bar').style.width = pct + '%';
    }
}

let teachingQueue = null;

function updateSelectedCount() {
    const checked = document.querySelectorAll('.node-select-cb:checked');
    document.getElementById('selected-count').textContent = checked.length;
}

function selectAllPending() {
    const checkboxes = document.querySelectorAll('.node-select-cb');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateSelectedCount();
}

async function startSelectedGeneration() {
    const checked = document.querySelectorAll('.node-select-cb:checked');
    if (checked.length === 0) {
        showStatus('请先勾选要生成的知识点', 'error');
        return;
    }
    const selectedIds = Array.from(checked).map(cb => cb.getAttribute('data-node-id'));
    if (!teachingQueue) {
        teachingQueue = new TeachingTaskQueue(2);
    }
    teachingQueue.selectedIds = selectedIds;
    teachingQueue.totalToProcess = selectedIds.length;
    teachingQueue.totalProcessed = 0;
    teachingQueue.start();
}

async function startAllGeneration() {
    let pendingCount = 0;
    for (const n of allTeachingNodes) {
        const ver = await getCurrentVersion(n);
        if (ver && ver.status === 'PENDING') pendingCount++;
    }
    if (pendingCount === 0) {
        showStatus('没有待生成的知识点', 'error');
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

function pauseBatchGeneration() {
    if (teachingQueue) teachingQueue.pause();
}

async function regenerateNode(nodeId) {
    const node = await dbGetTeachingNode(nodeId);
    if (!node) return;
    const provider = getCurrentProvider();
    const ver = await getCurrentVersion(node);
    if (ver && ver.status === 'ERROR') {
        await dbUpdateVersion(ver.id, {
            status: 'PENDING',
            error_msg: null,
            model_name: provider ? provider.model : ver.model_name
        });
    } else {
        await dbCreateVersion(nodeId, {
            status: 'PENDING',
            is_current: true,
            model_name: provider ? provider.model : ''
        });
    }
    await renderTeachingStats();
    await renderTeachingNodeList();
    if (teachingQueue && teachingQueue.isRunning) {
        teachingQueue._scheduleNext();
    }
}

async function addNewVersion(nodeId) {
    const provider = getCurrentProvider();
    if (!provider) {
        showStatus('请先添加并选择一个模型服务商', 'error');
        return;
    }
    const newVer = await dbCreateVersion(nodeId, {
        status: 'PENDING',
        is_current: true,
        model_name: provider.model
    });
    showStatus(`已创建新版本 v${newVer.version_num}`, 'success');
    await renderTeachingStats();
    await renderTeachingNodeList();
}

async function showVersionSwitcher(nodeId) {
    const versions = await getNodeVersions(await dbGetTeachingNode(nodeId));
    if (versions.length <= 1) return;
    const node = await dbGetTeachingNode(nodeId);
    const curVer = versions.find(v => v.is_current);
    let msg = `当前版本: v${curVer?.version_num || 1}\n\n所有版本:\n`;
    versions.forEach((v, i) => {
        const statusText = { PENDING: '待生成', GENERATING: '生成中', GENERATED: '待校验', VERIFIED: '已完成', ERROR: '错误' }[v.status] || v.status;
        msg += `${i + 1}. v${v.version_num} - ${statusText}${v.model_name ? ' (' + v.model_name + ')' : ''}${v.is_current ? ' [当前]' : ''}\n`;
    });
    msg += '\n输入版本号切换:';
    const choice = prompt(msg, curVer?.version_num || 1);
    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < versions.length) {
            await dbSetCurrentVersion(nodeId, versions[idx].id);
            showStatus(`已切换到 v${versions[idx].version_num}`, 'success');
            await renderTeachingStats();
            await renderTeachingNodeList();
        }
    }
}

async function retryAllErrors() {
    for (const node of allTeachingNodes) {
        const ver = await getCurrentVersion(node);
        if (ver && ver.status === 'ERROR') {
            await dbUpdateVersion(ver.id, { status: 'PENDING', error_msg: null });
        }
    }
    await renderTeachingStats();
    await renderTeachingNodeList();
    if (teachingQueue && teachingQueue.isRunning) {
        teachingQueue._scheduleNext();
    }
}

async function deleteTeachingNode(nodeId) {
    await dbDeleteTeachingNode(nodeId);
    allTeachingNodes = allTeachingNodes.filter(n => n.id !== nodeId);
    renderTeachingStats();
    renderTeachingNodeList();
    if (allTeachingNodes.length === 0) {
        document.getElementById('teaching-queue-card').style.display = 'none';
        document.getElementById('teaching-project-entry').style.display = 'none';
    }
}

// ========== 校验界面 ==========

async function getVerifyNodeList() {
    const result = [];
    for (const n of allTeachingNodes) {
        const ver = await getCurrentVersion(n);
        if (ver && (ver.status === 'GENERATED' || ver.status === 'VERIFIED')) result.push(n);
    }
    return result;
}

async function openVerifyModal(nodeId) {
    const node = allTeachingNodes.find(n => n.id === nodeId);
    if (!node) return;
    currentVerifyNodeId = nodeId;
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex(n => n.id === nodeId);
    document.getElementById('verify-title').textContent = node.name;
    document.getElementById('verify-prev-btn').disabled = idx <= 0;
    document.getElementById('verify-next-btn').disabled = idx >= verifyList.length - 1;
    const ver = await getCurrentVersion(node);
    const contentEl = document.getElementById('verify-content');
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    isWysiwygEditing = false;
    if (ver && ver.content_markdown) {
        renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: node });
    } else {
        contentEl.innerHTML = '<p style="color:var(--text-tertiary)">暂无内容</p>';
    }
    contentEl.style.display = 'block';
    document.getElementById('verify-edit-toolbar').style.display = 'none';
    document.getElementById('verify-actions').style.display = 'flex';
    document.getElementById('teaching-verify-modal').classList.add('active');
    loadLinkedQuestions(nodeId);
}

async function verifyPrev() {
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex(n => n.id === currentVerifyNodeId);
    if (idx > 0) {
        await openVerifyModal(verifyList[idx - 1].id);
    }
}

async function verifyNext() {
    const verifyList = await getVerifyNodeList();
    const idx = verifyList.findIndex(n => n.id === currentVerifyNodeId);
    if (idx >= 0 && idx < verifyList.length - 1) {
        await openVerifyModal(verifyList[idx + 1].id);
    }
}

var isWysiwygEditing = false;
var wysiwygOriginalHtml = '';

function toggleVerifyEdit() {
    const contentEl = document.getElementById('verify-content');
    const toolbar = document.getElementById('verify-edit-toolbar');
    const actionsEl = document.getElementById('verify-actions');
    if (isWysiwygEditing) {
        cancelWysiwygEdit();
        return;
    }
    wysiwygOriginalHtml = contentEl.innerHTML;
    isWysiwygEditing = true;
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

function handleKatexEdit(e) {
    e.stopPropagation();
    e.preventDefault();
    var katexEl = e.target.closest('.katex');
    if (!katexEl) return;
    var annotation = katexEl.querySelector('annotation');
    var latex = annotation ? annotation.textContent : '';
    if (!latex) {
        var mathEl = katexEl.closest('.katex-display');
        if (mathEl) latex = mathEl.getAttribute('data-latex') || '';
    }
    var input = document.createElement('input');
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
            input.value = input.getAttribute('data-original-latex');
            finishKatexEdit(input);
        }
    });
    input.addEventListener('blur', function() { finishKatexEdit(input); });
}

function finishKatexEdit(input) {
    var latex = input.value.trim();
    var isDisplay = input.parentElement && input.parentElement.classList.contains('katex-display');
    var span = document.createElement('span');
    span.className = 'katex';
    span.setAttribute('title', '点击编辑公式');
    span.addEventListener('click', handleKatexEdit);
    try {
        if (typeof katex !== 'undefined') {
            katex.render(latex, span, { throwOnError: false, displayMode: isDisplay });
        } else {
            span.textContent = latex;
        }
    } catch (err) {
        span.textContent = latex;
    }
    if (isDisplay) {
        var wrapper = document.createElement('div');
        wrapper.className = 'katex-display';
        wrapper.setAttribute('data-latex', latex);
        wrapper.appendChild(span);
        input.replaceWith(wrapper);
    } else {
        input.replaceWith(span);
    }
}

function htmlToMarkdown(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    function processNode(node) {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        var tag = node.tagName.toLowerCase();
        var children = Array.from(node.childNodes).map(processNode).join('');
        if (tag === 'katex' || (node.classList && node.classList.contains('katex'))) {
            var ann = node.querySelector('annotation');
            var latex = ann ? ann.textContent : node.textContent;
            var parent = node.closest('.katex-display');
            return parent ? '$$' + latex + '$$' : '$' + latex + '$';
        }
        if (tag === 'annotation') return '';
        var kd = node.querySelector('.katex');
        if (kd && tag === 'div' && node.classList.contains('katex-display')) {
            var ann2 = kd.querySelector('annotation');
            var latex2 = ann2 ? ann2.textContent : (node.getAttribute('data-latex') || kd.textContent);
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
            case 'blockquote': return children.trim().split('\n').map(function(l){return '> '+l}).join('\n') + '\n\n';
            case 'ul': return '\n' + children + '\n';
            case 'ol': return '\n' + children + '\n';
            case 'li': return '- ' + children.trim() + '\n';
            case 'a': var href = node.getAttribute('href') || ''; return '[' + children + '](' + href + ')';
            case 'img': var src = node.getAttribute('src') || ''; var alt = node.getAttribute('alt') || ''; return '![' + alt + '](' + src + ')';
            case 'table': return '\n' + processTable(node) + '\n\n';
            case 'hr': return '\n---\n\n';
            case 'div':
                if (node.classList && node.classList.contains('draw-placeholder')) {
                    var drawId = node.getAttribute('data-draw-id') || 'unknown';
                    var descEl = node.querySelector('.draw-placeholder-desc');
                    var desc = descEl ? descEl.textContent.replace('🎨 ', '') : '';
                    return '\n[DRAW:id=' + drawId + ':' + desc + ']\n';
                }
                return children;
            default: return children;
        }
    }
    function processTable(table) {
        var rows = table.querySelectorAll('tr');
        if (!rows.length) return '';
        var result = [];
        rows.forEach(function(row, i) {
            var cells = Array.from(row.querySelectorAll('th,td')).map(function(c){return c.textContent.trim()});
            result.push('| ' + cells.join(' | ') + ' |');
            if (i === 0) result.push('| ' + cells.map(function(){return '---'}).join(' | ') + ' |');
        });
        return result.join('\n');
    }
    var md = Array.from(div.childNodes).map(processNode).join('');
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
}

async function saveWysiwygEdit() {
    const contentEl = document.getElementById('verify-content');
    const node = allTeachingNodes.find(n => n.id === currentVerifyNodeId);
    if (!node) return;
    const ver = await getCurrentVersion(node);
    if (!ver) return;
    const md = htmlToMarkdown(contentEl.innerHTML);
    await dbUpdateVersion(ver.id, { content_markdown: md, status: 'GENERATED' });
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    document.getElementById('verify-edit-toolbar').style.display = 'none';
    document.getElementById('verify-actions').style.display = 'flex';
    isWysiwygEditing = false;
    await renderTeachingStats();
    await renderTeachingNodeList();
    await openVerifyModal(node.id);
    showStatus('内容已保存', 'success');
}

function cancelWysiwygEdit() {
    const contentEl = document.getElementById('verify-content');
    contentEl.innerHTML = wysiwygOriginalHtml;
    contentEl.contentEditable = 'false';
    contentEl.classList.remove('wysiwyg-editing');
    document.getElementById('verify-edit-toolbar').style.display = 'none';
    document.getElementById('verify-actions').style.display = 'flex';
    isWysiwygEditing = false;
}

function closeVerifyModal() {
    document.getElementById('teaching-verify-modal').classList.remove('active');
    currentVerifyNodeId = null;
}

async function verifyApprove() {
    if (!currentVerifyNodeId) return;
    const ver = await getCurrentVersion(await dbGetTeachingNode(currentVerifyNodeId));
    if (ver) {
        await dbUpdateVersion(ver.id, { status: 'VERIFIED' });
    }
    await renderTeachingStats();
    await renderTeachingNodeList();
    closeVerifyModal();
    showStatus('已通过校验', 'success');
}

async function verifyRegenerate() {
    if (!currentVerifyNodeId) return;
    const nodeId = currentVerifyNodeId;
    closeVerifyModal();
    await regenerateNode(nodeId);
}

// ========== 知识点关联题库 ==========

async function loadLinkedQuestions(nodeId) {
    const linked = await dbGetNodeQuestions(nodeId);
    const container = document.getElementById('verify-linked-questions');
    if (!linked.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.style.display = 'block';
    container.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px">已关联题目：</div>' +
        linked.map(nq => {
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

async function unlinkQuestionFromNode(linkId, questionId) {
    if (!currentVerifyNodeId) return;
    const links = await dbGetNodeQuestions(currentVerifyNodeId);
    const link = links.find(l => l.id === linkId);
    if (link) {
        await dbUnlinkQuestionFromNode(currentVerifyNodeId, questionId);
        await loadLinkedQuestions(currentVerifyNodeId);
        showStatus('已移除关联', 'info');
    }
}

function openNodeQuestionPicker() {
    if (!currentVerifyNodeId) return;
    const container = document.getElementById('node-question-picker-list');
    container.innerHTML = '';
    if (!allQuestions || !allQuestions.length) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px">题库为空，请先添加题目</div>';
    } else {
        allQuestions.forEach(q => {
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
            info.textContent = q.semantic_summary || q.user_comment || (q.question_tags && q.question_tags.length ? q.question_tags.map(qt => qt.tags?.name).filter(Boolean).join('、') : '') || '题目 ' + q.id.substring(0, 8);
            label.append(cb, img, info);
            container.appendChild(label);
        });
    }
    document.getElementById('node-question-picker-modal').classList.add('active');
}

function closeNodeQuestionPicker() {
    document.getElementById('node-question-picker-modal').classList.remove('active');
}

async function confirmNodeQuestionLinks() {
    if (!currentVerifyNodeId) return;
    const selected = Array.from(document.querySelectorAll('input[name="node_questions"]:checked')).map(cb => cb.value);
    const module = document.getElementById('nq-module-select').value;
    const existing = await dbGetNodeQuestions(currentVerifyNodeId);
    const existingIds = new Set(existing.map(nq => nq.question_id));
    let added = 0;
    for (const qId of selected) {
        if (!existingIds.has(qId)) {
            const maxOrder = existing.reduce((max, nq) => nq.module === module ? Math.max(max, nq.order || 0) : max, 0);
            await dbLinkQuestionToNode(currentVerifyNodeId, qId, module, maxOrder + 1);
            added++;
        }
    }
    closeNodeQuestionPicker();
    await loadLinkedQuestions(currentVerifyNodeId);
    if (added > 0) showStatus(`已关联 ${added} 道题目到「${module}」`, 'success');
    else showStatus('没有新增关联', 'info');
}

// ========== 投屏模式 ==========

async function enterProjectionMode() {
    projectionNodeList = [];
    for (const n of allTeachingNodes) {
        const ver = await getCurrentVersion(n);
        if (ver && ver.status === 'VERIFIED') projectionNodeList.push(n);
    }
    if (projectionNodeList.length === 0) {
        showStatus('没有已校验的教学内容', 'error');
        return;
    }
    projectionIndex = 0;
    await renderProjection();
    document.getElementById('projection-overlay').classList.add('active');
}

function exitProjectionMode() {
    document.getElementById('projection-overlay').classList.remove('active');
}

async function renderProjection() {
    if (projectionNodeList.length === 0) return;
    const node = projectionNodeList[projectionIndex];
    const ver = await getCurrentVersion(node);
    const contentEl = document.getElementById('projection-content');
    if (ver && ver.content_markdown) {
        renderMarkdown(ver.content_markdown, contentEl, { drawings: ver.drawings || {}, node: node, readOnly: true });
    }
    document.getElementById('proj-nav-info').textContent = `${projectionIndex + 1} / ${projectionNodeList.length}`;
    document.getElementById('proj-prev-btn').disabled = projectionIndex === 0;
    document.getElementById('proj-next-btn').disabled = projectionIndex === projectionNodeList.length - 1;
}

function projectionPrev() {
    if (projectionIndex > 0) {
        projectionIndex--;
        renderProjection();
    }
}

function projectionNext() {
    if (projectionIndex < projectionNodeList.length - 1) {
        projectionIndex++;
        renderProjection();
    }
}

// 投屏左右滑动
document.addEventListener('keydown', (e) => {
    if (!document.getElementById('projection-overlay').classList.contains('active')) return;
    if (e.key === 'ArrowLeft') projectionPrev();
    if (e.key === 'ArrowRight') projectionNext();
    if (e.key === 'Escape') exitProjectionMode();
});

let touchStartX = 0;
document.getElementById('projection-overlay').addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
});
document.getElementById('projection-overlay').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
        if (dx > 0) projectionPrev(); else projectionNext();
    }
});

// ========== 标签页长按拖拽排序 ==========

(function initTabReorder() {
    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;
    let longPressTimer = null;
    let dragTab = null;
    let isDragging = false;
    let startX = 0;
    let tabOrder = JSON.parse(localStorage.getItem('tabOrder') || 'null');

    // 恢复保存的顺序
    if (tabOrder && tabOrder.length > 0) {
        const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
        const tabMap = {};
        tabs.forEach(t => { tabMap[t.textContent.trim()] = t; });
        tabOrder.forEach(name => {
            if (tabMap[name]) tabsContainer.appendChild(tabMap[name]);
        });
    }

    function saveTabOrder() {
        const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
        const order = tabs.map(t => t.textContent.trim());
        localStorage.setItem('tabOrder', JSON.stringify(order));
    }

    function getTabIndex(tab) {
        return Array.from(tabsContainer.children).indexOf(tab);
    }

    function swapTabs(tab1, tab2) {
        const parent = tabsContainer;
        const idx1 = getTabIndex(tab1);
        const idx2 = getTabIndex(tab2);
        if (idx1 < idx2) {
            parent.insertBefore(tab2, tab1);
        } else {
            parent.insertBefore(tab1, tab2);
        }
    }

    tabsContainer.addEventListener('touchstart', function(e) {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        startX = e.touches[0].clientX;
        longPressTimer = setTimeout(() => {
            isDragging = true;
            dragTab = tab;
            tab.classList.add('tab-dragging');
            navigator.vibrate && navigator.vibrate(50);
        }, 500);
    }, { passive: true });

    tabsContainer.addEventListener('touchmove', function(e) {
        if (!isDragging || !dragTab) return;
        e.preventDefault();
        const touch = e.touches[0];
        const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
        for (const tab of tabs) {
            if (tab === dragTab) continue;
            const rect = tab.getBoundingClientRect();
            if (touch.clientX >= rect.left && touch.clientX <= rect.right) {
                tab.classList.add('tab-drag-over');
                swapTabs(dragTab, tab);
                break;
            } else {
                tab.classList.remove('tab-drag-over');
            }
        }
    }, { passive: false });

    tabsContainer.addEventListener('touchend', function(e) {
        clearTimeout(longPressTimer);
        if (!isDragging || !dragTab) return;
        dragTab.classList.remove('tab-dragging');
        Array.from(tabsContainer.querySelectorAll('.tab')).forEach(t => t.classList.remove('tab-drag-over'));
        saveTabOrder();
        isDragging = false;
        dragTab = null;
    });

    tabsContainer.addEventListener('touchcancel', function() {
        clearTimeout(longPressTimer);
        if (dragTab) dragTab.classList.remove('tab-dragging');
        Array.from(tabsContainer.querySelectorAll('.tab')).forEach(t => t.classList.remove('tab-drag-over'));
        isDragging = false;
        dragTab = null;
    });
})();

// ========== 艾宾浩斯复习提醒 ==========

async function checkPendingReviews() {
    const pending = await dbGetPendingReviews();
    if (pending.length === 0) return;
    showReviewReminder(pending);
}

function showReviewReminder(questions) {
    const existing = document.getElementById('review-reminder-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'review-reminder-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'z-index:9998';
    modal.innerHTML = `<div class="modal-content" style="max-width:500px;max-height:80vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="margin:0;font-size:17px;font-weight:700;color:var(--accent)">📝 今日复习提醒</h2>
            <span style="cursor:pointer;font-size:24px;color:#999" onclick="document.getElementById('review-reminder-modal').remove()">×</span>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">以下 ${questions.length} 道题目需要复习（艾宾浩斯遗忘曲线）：</p>
        <div id="review-reminder-list" style="display:flex;flex-direction:column;gap:8px"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
            <button onclick="document.getElementById('review-reminder-modal').remove()" class="secondary" style="flex:1">关闭</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    const list = document.getElementById('review-reminder-list');
    questions.forEach(q => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border-light);border-radius:var(--radius-md)';
        const thumb = q.question_image_url
            ? `<img src="${q.question_image_url}" style="width:50px;height:50px;object-fit:contain;border-radius:4px;background:var(--surface-dim)">`
            : '<div style="width:50px;height:50px;background:var(--surface-dim);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:20px">📝</div>';
        const summary = q.semantic_summary || q.user_comment || '题目 ' + q.id.substring(0, 8);
        const intervalIdx = q.review_interval_index || 0;
        const intervals = [1,2,4,7,15,30];
        const nextDays = intervals[Math.min(intervalIdx + 1, intervals.length - 1)];
        item.innerHTML = `${thumb}
            <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${summary}</div>
                <div style="font-size:11px;color:var(--text-tertiary)">第${q.review_count + 1}次复习 · 下次间隔${nextDays}天</div>
            </div>
            <button onclick="markReviewed('${q.id}', this)" style="font-size:12px;padding:6px 12px;background:var(--primary);flex-shrink:0">已复习</button>`;
        list.appendChild(item);
    });
}

async function markReviewed(questionId, btn) {
    await dbCompleteReview(questionId);
    btn.textContent = '✓ 已完成';
    btn.disabled = true;
    btn.style.background = 'var(--success, #10b981)';
    btn.style.color = '#fff';
    showStatus('已标记为复习完成', 'success');
}

async function toggleReviewForQuestion(questionId) {
    const q = await dbGetQuestion(questionId);
    if (!q) return;
    if (q.review_enabled) {
        await dbDisableReview(questionId);
        showStatus('已关闭复习提醒', 'info');
    } else {
        await dbEnableReview(questionId);
        showStatus('已开启复习提醒，明天开始第一次复习', 'success');
    }
    if (typeof showQuestionDetail === 'function') {
        showQuestionDetail(questionId);
    }
}

// App启动时检查复习提醒
(async function() {
    try { await checkPendingReviews(); } catch(e) { console.warn('复习提醒检查失败:', e); }
})();

