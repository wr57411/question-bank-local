/* eslint-disable @typescript-eslint/no-explicit-any */
import * as data from './data';
import * as services from './services';
import * as ui from './ui';

const w = window as any;

async function _migrateQuestionNotes(): Promise<void> {
  try {
    const questions: any[] = [];
    await data.dbQuestions.iterate((q: any) => { if (q && !q.deleted_at) questions.push(q); });
    for (const q of questions) {
      if (q.semantic_summary === 'AI 正在分析中...') {
        await data.dbQuestions.setItem(q.id, { ...q, semantic_summary: '' });
      }
      const notes = await data.dbGetQuestionNotes(q.id);
      if (notes.length === 0 && q.question_image_url) {
        await data.dbAddQuestionNote(q.id, q.question_image_url, '笔记 v1', '');
      }
    }
  } catch (e) { console.error('迁移失败:', e); }
}

export async function refreshAll(): Promise<void> {
  await _migrateQuestionNotes();
  await Promise.all([
    ui.loadTags(),
    w.isFormDirty ? Promise.resolve() : ui.loadQuestions(),
    ui.loadPapers(),
    ui.loadTopics(),
    ui.loadBookFilter(),
  ]);
  if (!w.isFormDirty) {
    const lastBookName = localStorage.getItem('lastBookName');
    const bookInput = document.getElementById('book-name') as HTMLInputElement | null;
    if (lastBookName && bookInput) bookInput.value = lastBookName;
  }
}

export function initApp(): void {
  // Register refreshAll on window for cross-module access
  w.refreshAll = refreshAll;

  services.applyVersionTheme(services.getCurrentVersionId());
  ui.renderVersionCheckboxes();
  ui.renderVersionSwitcher();
  ui.updateExportImgModeBtn();
  ui.initRemoteSync(w.serverUrl, w.apiToken, w.syncEnabled);
  data.setOnSyncDataWarning(ui.showSyncWarning);
  const syncToggle = document.getElementById('sync-toggle') as HTMLInputElement | null;
  if (syncToggle) syncToggle.checked = w.syncEnabled;

  refreshAll().then(() => {
    ui.updatePendingLinkBadge();
    ui.updatePendingPhotosBadge();
  });

  ui.restartSyncPolling();
  if (w.currentUser && w.autoSyncEnabled && w.syncEnabled) ui.queueAutoSync(true);
  if (w.currentUser && w.apiToken) ui.startSupabaseAutoSync();
  ui.checkServerConnection();
  ui.updateSyncBar();
  setInterval(() => ui.checkServerConnection(), 60000);
  ui.checkAppUpdate();
  ui.applyPlatformUI();
  if (w.isNative && w.MediaPlugin) {
    ui.loadGalleryThumbnails('question');
    ui.loadGalleryThumbnails('answer');
  }

  // Form initializers
  ui.initTagForm();
  ui.initQuestionForm();
  ui.initPaperForm();
  ui.initTopicForm();
}
