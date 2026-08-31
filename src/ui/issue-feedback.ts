/* eslint-disable @typescript-eslint/no-explicit-any */
import { compressImage } from '../services/image';
import { submitFeedback, queueFeedback, flushFeedbackQueue, normalizeFeedbackTitle } from '../services/issue-feedback';
import { openModal, closeModal } from './common';

const w = window as any;

let lastPromptAt = 0;
let promptTimer: ReturnType<typeof setTimeout> | null = null;
let feedbackScreenshot: string | null = null;
let feedbackPage = '';

function getScreenshotListener(): any {
  const cap = w.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  return isNative && cap?.Plugins?.ScreenshotListener ? cap.Plugins.ScreenshotListener : null;
}

function handleScreenshotTaken(): void {
  const now = Date.now();
  if (now - lastPromptAt < 10000) return;
  lastPromptAt = now;
  showFeedbackPromptBar();
}

let listenerInitialized = false;

export function initIssueFeedbackListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;
  const ScreenshotListener = getScreenshotListener();
  if (ScreenshotListener) {
    try {
      ScreenshotListener.addListener('screenshotTaken', handleScreenshotTaken);
      if (typeof ScreenshotListener.check === 'function') {
        ScreenshotListener.check()
          .then((r: any) => { if (r && r.granted === false) console.warn('[Feedback] 截图监听缺少媒体权限，功能不可用'); })
          .catch(() => {});
      }
    } catch (e) {
      console.warn('ScreenshotListener 初始化失败:', e);
    }
  }
  window.addEventListener('appScreenshotTaken', handleScreenshotTaken);
}

export function showFeedbackPromptBar(): void {
  const proj = document.getElementById('projection-overlay');
  if (proj?.classList.contains('active')) return;
  const bar = document.getElementById('feedback-prompt-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  if (promptTimer) clearTimeout(promptTimer);
  promptTimer = setTimeout(() => { bar.style.display = 'none'; }, 15000);
}

export function dismissFeedbackPrompt(): void {
  const bar = document.getElementById('feedback-prompt-bar');
  if (bar) bar.style.display = 'none';
  if (promptTimer) { clearTimeout(promptTimer); promptTimer = null; }
}

export function openFeedbackPromptFeedback(): void {
  dismissFeedbackPrompt();
  openIssueFeedbackModal(true);
}

export function openIssueFeedbackModal(fromScreenshot: boolean): void {
  const activeTab = document.querySelector('.tab-btn.active, .nav-tab.active');
  feedbackPage = activeTab ? (activeTab.textContent || '').trim() : '';
  (document.getElementById('feedback-title') as HTMLInputElement).value = '';
  (document.getElementById('feedback-description') as HTMLTextAreaElement).value = '';
  const status = document.getElementById('feedback-status')!;
  status.textContent = fromScreenshot ? '检测到你刚截了图，可添加截图作为附件' : '';
  status.style.color = 'var(--text-secondary)';
  setFeedbackScreenshot(null);
  openModal('issue-feedback-modal');
  setTimeout(() => (document.getElementById('feedback-title') as HTMLInputElement).focus(), 100);
}

export function closeIssueFeedbackModal(): void {
  closeModal('issue-feedback-modal');
}

function setFeedbackScreenshot(dataUrl: string | null): void {
  feedbackScreenshot = dataUrl;
  const preview = document.getElementById('feedback-shot-preview') as HTMLImageElement;
  const removeBtn = document.getElementById('feedback-shot-remove') as HTMLElement;
  const addBtn = document.getElementById('feedback-shot-btn') as HTMLElement;
  if (dataUrl) {
    preview.src = dataUrl;
    preview.style.display = 'inline-block';
    removeBtn.style.display = 'inline-block';
    addBtn.textContent = '更换截图';
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
    addBtn.textContent = '＋ 添加截图';
  }
}

export function addFeedbackScreenshot(): void {
  const cap = w.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Camera = isNative ? cap?.Plugins?.Camera : null;
  if (isNative && Camera) {
    Camera.getPhoto({ quality: 80, allowEditing: false, resultType: 'dataUrl', source: 'PHOTOS' })
      .then(async (photo: any) => {
        const compressed = await compressImage(photo.dataUrl, 1080, 0.8).catch(() => photo.dataUrl);
        setFeedbackScreenshot(compressed);
      })
      .catch((e: any) => {
        if (e && e.message !== 'User cancelled photos app') w.showStatus('选择截图失败: ' + e.message, 'error');
      });
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (!input.files || !input.files[0]) return;
      const reader = new FileReader();
      reader.onload = async (ev: any) => {
        const compressed = await compressImage(ev.target.result, 1080, 0.8).catch(() => ev.target.result);
        setFeedbackScreenshot(compressed);
      };
      reader.readAsDataURL(input.files[0]);
    };
    input.click();
  }
}

export function removeFeedbackScreenshot(): void {
  setFeedbackScreenshot(null);
}

export async function submitIssueFeedback(): Promise<void> {
  const titleEl = document.getElementById('feedback-title') as HTMLInputElement;
  const descEl = document.getElementById('feedback-description') as HTMLTextAreaElement;
  const status = document.getElementById('feedback-status')!;
  const btn = document.getElementById('feedback-submit-btn') as HTMLButtonElement;
  const title = titleEl.value.trim();
  if (!title) {
    status.textContent = '请填写标题';
    status.style.color = 'var(--danger)';
    return;
  }
  btn.disabled = true;
  btn.textContent = '提交中...';
  status.textContent = '';
  const input = { title: normalizeFeedbackTitle(title), description: descEl.value, screenshot: feedbackScreenshot, page: feedbackPage };
  try {
    await submitFeedback(input);
    w.showStatus('反馈已提交，感谢！', 'success');
    setFeedbackScreenshot(null);
    closeIssueFeedbackModal();
  } catch (e: any) {
    const errStatus = typeof e.status === 'number' ? e.status : 0;
    const permanent = errStatus >= 400 && errStatus < 500 && errStatus !== 401 && errStatus !== 403 && errStatus !== 429;
    if (permanent) {
      status.textContent = '提交失败: ' + (e.message || '未知错误');
      status.style.color = 'var(--danger)';
    } else {
      try {
        await queueFeedback(input, e.message || String(e));
        status.textContent = '提交失败，已保存草稿（' + (e.message || '未知错误') + '），网络恢复后自动重试';
        status.style.color = 'var(--warning)';
      } catch (qErr: any) {
        status.textContent = '提交失败: ' + (e.message || '未知错误');
        status.style.color = 'var(--danger)';
      }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '提交反馈';
  }
}

export async function retryPendingFeedback(): Promise<void> {
  const result = await flushFeedbackQueue().catch(() => null);
  if (result && result.flushed > 0) w.showStatus('已重试提交 ' + result.flushed + ' 条反馈', 'success');
}
