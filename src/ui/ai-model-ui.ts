/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== AI 模型管理交互 ==========

export async function updateAIStatusUI() {
    const Gemma4 = w.Capacitor?.Plugins?.Gemma4;
    console.log("updateAIStatusUI: Gemma4 plugin =", Gemma4);
    if (!Gemma4) {
        console.log("updateAIStatusUI: Gemma4 plugin not found!");
        return;
    }
    w.initProviderList(); // 初始化服务商列表
    const status = await Gemma4.checkModelStatus();
    console.log("updateAIStatusUI: status =", JSON.stringify(status));
    const label = document.getElementById("ai-status-label")!;
    const desc = document.getElementById("ai-status-desc")!;
    const loadBtn = document.getElementById("ai-load-btn") as HTMLButtonElement;
    const batchBtn = document.getElementById("ai-batch-btn")!;

    if (status.ready) {
        label.textContent = "已就绪";
        label.style.background = "var(--mint)";
        desc.textContent = "Gemma 4 引擎已就绪";
        loadBtn.textContent = "✅ 模型已加载";
        loadBtn.style.display = "none";
        loadBtn.disabled = true;
        batchBtn.style.display = "";
    } else {
        label.textContent = "未就绪";
        label.style.background = "var(--danger)";
        desc.textContent = "请将 gemma-4-E2B-it-Q3_K_S.gguf 放入手机的 Download 目录，然后点击\"加载模型\"。";
        loadBtn.textContent = "加载模型";
        loadBtn.style.display = "";
        loadBtn.disabled = false;
        batchBtn.style.display = "none";
    }
}

export async function handleLoadModel() {
    const Gemma4 = w.Capacitor?.Plugins?.Gemma4;
    if (!Gemma4) { w.showStatus("请在原生 App 中使用此功能", "error"); return; }

    const btn = document.getElementById("ai-load-btn") as HTMLButtonElement;
    const desc = document.getElementById("ai-status-desc")!;
    btn.disabled = true;
    btn.textContent = "正在加载...";
    desc.textContent = "正在扫描 Download 目录并加载模型，请稍候（首次加载约需 10-30 秒）...";

    const result = await Gemma4.discoverModel();
    btn.disabled = false;

    if (result.found && result.ready) {
        w.showStatus("模型加载成功", "success");
        updateAIStatusUI();
    } else if (result.found && !result.ready) {
        w.showStatus("加载失败: " + (result.error || "未知错误"), "error");
        btn.textContent = "重试加载";
        desc.textContent = "错误详情: " + (result.error || "无");
    } else {
        w.showStatus("未在 Download 目录找到模型文件", "error");
        btn.textContent = "加载模型";
        desc.textContent = "请确认 gemma-4-E2B-it-Q3_K_S.gguf 已放入手机的 Download 目录。";
    }
}

// ========== 云端 API 配置 ==========

export async function pasteTo(inputId: string) {
    try {
        const res = await w.Capacitor.Plugins.Clipboard.read();
        (document.getElementById(inputId) as HTMLInputElement).value = (res && res.value) || res || '';
    } catch (e: any) {
        w.showStatus("粘贴失败: " + e.message, "error");
    }
}
