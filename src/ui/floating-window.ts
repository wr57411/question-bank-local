/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 悬浮窗截图 ==========

let floatingActive = false;
let floatingPollTimer: ReturnType<typeof setInterval> | null = null;

function getFloatingWindow(): any {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  return isNative ? (cap?.Plugins?.FloatingWindow ?? null) : null;
}

export async function toggleFloatingWindow(): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  console.log("[Floating] toggleFloatingWindow called! isNative=" + w.isNative + " FloatingWindow=" + !!FloatingWindow + " floatingActive=" + floatingActive);
  if (!w.isNative || !FloatingWindow) {
    w.showStatus("悬浮窗仅在 Android 设备上可用", "error");
    return;
  }
  const btn = document.getElementById('floating-toggle-btn')!;
  if (floatingActive) {
    await FloatingWindow.stop();
    floatingActive = false;
    btn.textContent = '   悬浮窗';
    btn.style.background = 'var(--sky)';
    w.showStatus("悬浮窗已关闭", "success");
  } else {
    try {
      await FloatingWindow.start();
      floatingActive = true;
      btn.textContent = '⏹ 关闭';
      btn.style.background = 'var(--danger)';
      w.showStatus("悬浮窗已启动，切换到其他 App 即可截图", "success");
    } catch (e: any) {
      console.log("[Floating] start error: " + e.message);
      w.showStatus("启动失败: " + e.message, "error");
    }
  }
}

export async function pickFromFloating(target: string): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  console.log("[Floating] pickFromFloating called, target=" + target + " isNative=" + w.isNative + " floatingActive=" + floatingActive);
  if (!w.isNative || !FloatingWindow) {
    console.log("[Floating] not native or no FloatingWindow");
    w.showStatus("悬浮窗仅在 Android 设备上可用", "error");
    return;
  }
  if (!floatingActive) {
    console.log("[Floating] floating not active");
    w.showStatus("请先启动悬浮窗", "error");
    return;
  }
  try {
    const result = await FloatingWindow.getImages();
    console.log("[Floating] getImages result:", JSON.stringify(result));
    if (!result || !result.images || result.images.length === 0) {
      console.log("[Floating] no images, showing error");
      w.showStatus("悬浮窗中暂无截图，请先截图", "error");
      return;
    }
    console.log("[Floating] showing image list, count=" + result.images.length);
    showFloatingImageList(result.images, target);
  } catch (e: any) {
    console.log("[Floating] getImages error:", e.message);
    w.showStatus("获取截图列表失败: " + e.message, "error");
  }
}

export function showFloatingImageList(images: any[], target: string): void {
  console.log("[Floating] showFloatingImageList images=" + images.length + " target=" + target);
  const container = document.getElementById('floating-image-list');
  if (!container) {
    console.log("[Floating] ERROR: floating-image-list element not found!");
    return;
  }
  container.innerHTML = '';
  (container as any).dataset.target = target;

  if (images.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:20px">暂无截图</div>';
  } else {
    images.forEach((img: any) => {
      const typeLabels: Record<string, string> = { question: '📖 题目', answer: '📝 答案', blank: '📄 空白题' };
      const typeColors: Record<string, string> = { question: 'var(--mint)', answer: 'var(--accent)', blank: 'var(--warning)' };
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;gap:10px;padding:10px;border:1px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;align-items:center';
      card.innerHTML = `
                <img src="${img.thumbPath || img.webPath}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border-light)" />
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

  document.getElementById('floating-modal')!.classList.add('active');
  console.log("[Floating] modal activated");
}

export async function importFloatingImage(index: number, target: string): Promise<void> {
  const FloatingWindow = getFloatingWindow();
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
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        w.originalImages[target] = dataUrl;
        w.croppedImages[target] = dataUrl;
        w.suggestedCropRects[target] = null;
        w.handleCameraResult(target, dataUrl);
        w.showStatus("已导入到" + (target === 'question' ? '题目' : target === 'answer' ? '答案' : '空白题') + "图片", "success");
      };
      img.src = result.webPath;
    }
    closeFloatingModal();
  } catch (e: any) {
    w.showStatus("导入失败: " + e.message, "error");
  }
}

export async function deleteFloatingImage(index: number): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  if (!FloatingWindow) return;
  try {
    await FloatingWindow.removeImage({ index });
    // Refresh list
    const result = await FloatingWindow.getImages();
    const target = (document.getElementById('floating-image-list') as any)?.dataset?.target || 'question';
    showFloatingImageList(result.images || [], target);
  } catch (e: any) {
    w.showStatus("删除失败: " + e.message, "error");
  }
}

export async function clearFloatingImages(): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  if (!FloatingWindow) return;
  try {
    await FloatingWindow.clearImages();
    closeFloatingModal();
    w.showStatus("已清空全部截图", "success");
  } catch (e: any) {
    w.showStatus("清空失败: " + e.message, "error");
  }
}

export function closeFloatingModal(): void {
  document.getElementById('floating-modal')!.classList.remove('active');
}

// ========== 悬浮窗截屏保存 ==========

// Intercept capture events from native
export async function pollFloatingEvents(): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  if (!floatingActive || !FloatingWindow) return;
  try {
    const event = await FloatingWindow.pollEvent();
    console.log("[Floating] pollEvent result:", JSON.stringify(event));
    if (event && event.event === 'imageCaptured') {
      // Show save dialog
      const lastNum = (await FloatingWindow.getLastQuestionNum()).questionNum;
      (document.getElementById('floating-save-qnum') as HTMLInputElement).value = lastNum;
      document.getElementById('floating-save-modal')!.classList.add('active');
    } else if (event && event.event === 'previewClicked') {
      // Open floating image list preview
      pickFromFloating('question');
    }
  } catch (e) { console.error("[Floating] pollFloatingEvents error:", e); }
}

export function initFloatingPoll(): void {
  floatingPollTimer = setInterval(pollFloatingEvents, 500);
}

export async function confirmFloatingSave(type: string): Promise<void> {
  const FloatingWindow = getFloatingWindow();
  const qnum = parseInt((document.getElementById('floating-save-qnum') as HTMLInputElement).value) || 1;
  document.getElementById('floating-save-modal')!.classList.remove('active');

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
    w.showStatus("跨页拍摄：请翻到下半部分，再点悬浮窗截图", "success");
    // TODO: handle cross-page flow with floating window
    return;
  }

  w.showStatus(`已保存到第${qnum}题${type === 'question' ? '题目' : type === 'answer' ? '答案' : '空白题'}`, "success");
}

export function cancelFloatingSave(): void {
  const FloatingWindow = getFloatingWindow();
  document.getElementById('floating-save-modal')!.classList.remove('active');
  // Remove the last captured image since user cancelled
  if (FloatingWindow) {
    FloatingWindow.getImages().then((result: any) => {
      if (result && result.images && result.images.length > 0) {
        const last = result.images[result.images.length - 1];
        FloatingWindow.removeImage({ index: last.index });
      }
    });
  }
}

export function stopFloatingPolling(): void {
  if (floatingPollTimer) { clearInterval(floatingPollTimer); floatingPollTimer = null; }
}

export function restartFloatingPolling(): void {
  stopFloatingPolling();
  floatingPollTimer = setInterval(pollFloatingEvents, 500);
}
