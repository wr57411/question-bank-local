/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ========== 相机/相册 ==========

export function _handleImageReady(target: string, dataUrl: string): void {
  w.originalImages[target] = dataUrl;
  const skipCheck = document.getElementById('skip-crop-check') as HTMLInputElement | null;
  if (skipCheck && skipCheck.checked) {
    w.croppedImages[target] = dataUrl;
    w.suggestedCropRects[target] = null;
    (document.getElementById(target + '-preview') as HTMLImageElement).src = dataUrl;
    document.getElementById(target + '-preview-wrap')!.style.display = 'inline-block';
    document.getElementById(target + '-preview-label')!.classList.remove('hidden');
    if (target === 'question') {
      const copyBtn = document.getElementById('copy-q-to-a-btn');
      if (copyBtn) copyBtn.style.display = '';
    }
  } else {
    w.croppedImages[target] = dataUrl;
    w.suggestedCropRects[target] = null;
    w.startCrop(target, null);
  }
}

export async function takePhoto(target: string): Promise<void> {
  if (w.isNative && w.Camera) {
    try {
      const photo = await w.Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
      _handleImageReady(target, photo.dataUrl);
    } catch (e: any) { if (e.message !== 'User cancelled photos app') w.showStatus("拍照失败: " + e.message, "error"); }
  } else {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = (e: any) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev: any) => { _handleImageReady(target, ev.target.result); };
        reader.readAsDataURL(e.target.files[0]);
      }
    };
    input.click();
  }
}

export async function pickFromGallery(target: string): Promise<void> {
  if (w.isNative && w.Camera) {
    try {
      const photo = await w.Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' });
      _handleImageReady(target, photo.dataUrl);
    } catch (e: any) { if (e.message !== 'User cancelled photos app') w.showStatus("选择图片失败: " + e.message, "error"); }
  } else {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e: any) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev: any) => { _handleImageReady(target, ev.target.result); };
        reader.readAsDataURL(e.target.files[0]);
      }
    };
    input.click();
  }
}

export function handleCameraResult(target: string, dataUrl: string): void {
  (document.getElementById(target + "-preview") as HTMLImageElement).src = dataUrl;
  document.getElementById(target + "-preview-wrap")!.style.display = "inline-block";
  document.getElementById(target + "-preview-label")!.classList.remove("hidden");
  w.originalImages[target] = dataUrl; w.croppedImages[target] = dataUrl;
  if (target === 'question') {
    w.isFormDirty = true;
    const copyBtn = document.getElementById("copy-q-to-a-btn");
    if (copyBtn) copyBtn.style.display = "";
  }
}

export function handleFileSelect(e: any, target: string): void {
  if (e.target.files && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = (ev: any) => { handleCameraResult(target, ev.target.result); w.croppedImages[target] = e.target.files[0]; };
    reader.readAsDataURL(e.target.files[0]);
  }
}

export function copyQuestionToAnswer(): void {
  if (!w.croppedImages.question) { w.showStatus("请先选择题目图片", "error"); return; }
  handleCameraResult('answer', w.croppedImages.question);
  w.showStatus("已复制题目图片到答案", "success");
}

export function removeImage(target: string): void {
  w.croppedImages[target] = null; w.originalImages[target] = null;
  w.suggestedCropRects[target] = null;
  document.getElementById(target + "-preview-wrap")!.style.display = "none";
  document.getElementById(target + "-preview-label")!.classList.add("hidden");
  if (target === 'question') {
    const copyBtn = document.getElementById("copy-q-to-a-btn");
    if (copyBtn) copyBtn.style.display = "none";
  }
  if (target === 'question') w.isFormDirty = false;
}

export async function loadGalleryThumbnails(target: string): Promise<void> {
  if (!w.isNative || !w.MediaPlugin) {
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
    const result = await w.MediaPlugin.getMedias({
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
  } catch (e: any) {
    console.error('[Gallery] load failed:', e);
    const msg = e.message || String(e);
    container.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);padding:8px">加载失败: ' + msg + '</span>';
  }
}

export async function galleryThumbClick(identifier: string, target: string): Promise<void> {
  if (!target) {
    let determinedTarget = 'question';
    if (w.croppedImages['question']) determinedTarget = 'answer';
    target = determinedTarget;
  }
  const label = target === 'question' ? '题目' : '答案';
  w.showStatus('正在加载' + label + '图片...', 'success');
  try {
    console.log('[Gallery] loading full image for identifier:', identifier, 'target:', target);
    let dataUrl: string | undefined;
    if (typeof w.MediaPlugin.getFullImage === 'function' && (identifier.startsWith('content://') || identifier.startsWith('file://') || (!identifier.startsWith('/') && !identifier.match(/^[A-Z]:\\/)))) {
      const result = await w.MediaPlugin.getFullImage({ identifier: identifier });
      const mime = result.mimeType || 'image/jpeg';
      dataUrl = 'data:' + mime + ';base64,' + result.data;
    } else if (w.Capacitor && w.Capacitor.getPlatform && w.Capacitor.getPlatform() === 'ios' && w.MediaPlugin.getMediaByIdentifier) {
      const pathResult = await w.MediaPlugin.getMediaByIdentifier({ identifier: identifier });
      const FS = w.Capacitor?.Plugins?.Filesystem;
      if (FS) {
        const fileResult = await FS.readFile({ path: pathResult.path });
        let data = fileResult.data;
        if (!data.startsWith('data:')) dataUrl = 'data:image/jpeg;base64,' + data;
        else dataUrl = data;
      } else {
        w.showStatus('文件系统不可用', 'error');
        return;
      }
    } else {
      const FS = w.Capacitor?.Plugins?.Filesystem;
      if (FS) {
        const fileResult = await FS.readFile({ path: identifier });
        let data = fileResult.data;
        if (!data.startsWith('data:')) dataUrl = 'data:image/jpeg;base64,' + data;
        else dataUrl = data;
      } else {
        w.showStatus('文件系统不可用', 'error');
        return;
      }
    }
    _handleImageReady(target, dataUrl!);
    w.showStatus('已导入' + label + '图片', 'success');
  } catch (e: any) {
    console.error('[Gallery] load full image failed:', e);
    w.showStatus('图片加载失败: ' + e.message, 'error');
  }
}

// ========== 跨页拍摄 ==========

export async function crossPageShoot(target: string): Promise<void> {
  w.showStatus("拍摄第 1 张（上半部分）", "success");
  const img1 = await captureAndCropOne('上半部分');
  if (!img1) return;

  w.showStatus("拍摄第 2 张（下半部分）", "success");
  const img2 = await captureAndCropOne('下半部分');
  if (!img2) { w.showStatus("已取消", "error"); return; }

  w.showStatus("正在合并...", "success");
  const combined = await w.mergeImagesVertically(img1, img2);
  handleCameraResult(target, combined);
  w.showStatus("跨页合并完成", "success");
}

export async function captureAndCropOne(label: string): Promise<string | null> {
  // 1. 拍照或选图
  let dataUrl: string | null = null;
  if (w.isNative && w.Camera) {
    try {
      const photo = await w.Camera.getPhoto({ quality: 90, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
      dataUrl = photo.dataUrl;
    } catch (e) { return null; }
  } else {
    dataUrl = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.onchange = (e: any) => {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev: any) => resolve(ev.target.result);
          reader.readAsDataURL(e.target.files[0]);
        } else resolve(null);
      };
      input.click();
    });
  }
  if (!dataUrl) return null;

  // 2. 打开裁剪弹窗，等待用户确认
  return new Promise((resolve) => {
    w.openCropModal(dataUrl, '_crossPageCrop', resolve);
  });
}

export async function captureOneImage(): Promise<string | null> {
  if (w.isNative && w.Camera) {
    try {
      const photo = await w.Camera.getPhoto({ quality: 90, allowEditing: false, resultType: 'dataUrl', source: 'CAMERA', direction: 'REAR' });
      return photo.dataUrl;
    } catch (e) { return null; }
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.onchange = (e: any) => {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev: any) => resolve(ev.target.result);
          reader.readAsDataURL(e.target.files[0]);
        } else resolve(null);
      };
      input.click();
    });
  }
}
