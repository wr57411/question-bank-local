import './styles/main.css';

import * as data from './data';
import * as services from './services';
import * as ui from './ui';
import { initApp } from './init-app';
import { initAnchoredModals } from './ui/modal-anchor';

const w = window as unknown as Record<string, unknown>;

function assignToWindow(exports: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(exports)) {
    w[key] = value;
  }
}

function assignIfMissing(exports: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof w[key] === 'undefined') {
      w[key] = value;
    }
  }
}

declare const __TEST_PHONE__: string;
declare const __TEST_PASSWORD__: string;

function setupAutoLogin(): void {
  if (!import.meta.env.DEV) return;
  const phone = __TEST_PHONE__;
  const password = __TEST_PASSWORD__;
  if (!phone || !password) return;

  document.addEventListener('DOMContentLoaded', () => {
    function attemptLogin(retries: number): void {
      if (localStorage.getItem('apiToken')) return;
      const serverInput = document.getElementById('server-url') as HTMLInputElement | null;
      const phoneInput = document.getElementById('login-phone') as HTMLInputElement | null;
      const passInput = document.getElementById('login-password') as HTMLInputElement | null;
      const doLoginFn = w['doLogin'] as (() => Promise<void>) | undefined;
      if (!doLoginFn || !serverInput || !phoneInput || !passInput) {
        if (retries > 0) setTimeout(() => attemptLogin(retries - 1), 200);
        return;
      }
      serverInput.value = window.location.origin;
      phoneInput.value = phone;
      passInput.value = password;
      doLoginFn();
    }
    attemptLogin(10);
  });
}

setupAutoLogin();

// Initialize shared state on window (app.js uses `let` which doesn't create window properties)
const sharedDefaults: Record<string, unknown> = {
  currentQuestionId: null,
  allTags: [],
  allQuestions: [],
  trashedQuestions: [],
  activeFilterTags: [],
  selectedQuestions: new Set(),
  questionBasket: new Set(),
  detailIndex: -1,
  filteredList: [],
  croppedImages: { question: null, answer: null, blank: null },
  originalImages: { question: null, answer: null },
  newTagContext: null,
  currentPaperId: null,
  extraNoteVersions: [],
  extraNoteVersionCounter: 0,
  exportMode: 'single',
  exportSpacing: 'none',
  suggestedCropRects: { question: null, answer: null, blank: null },
  isFormDirty: false,
};
for (const [key, value] of Object.entries(sharedDefaults)) {
  if (typeof w[key] === 'undefined') {
    w[key] = value;
  }
}

// Native platform flags computed from window.Capacitor (classic-script top-level
// `const` in public/app.js never became window properties, so recompute here).
const cap = (window as any).Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const isIOS = isNative && cap.getPlatform && cap.getPlatform() === 'ios';
const Camera = isNative ? (cap?.Plugins?.Camera ?? null) : null;
const MediaPlugin = isNative ? (cap?.Plugins?.MediaGallery ?? cap?.Plugins?.Media ?? null) : null;

assignIfMissing({
  isNative,
  isIOS,
  Camera,
  MediaPlugin,
});

assignIfMissing({
  // data layer
  dbGetAllQuestions: data.dbGetAllQuestions,
  dbGetTrashedQuestions: data.dbGetTrashedQuestions,
  dbSoftDeleteQuestion: data.dbSoftDeleteQuestion,
  dbRestoreQuestion: data.dbRestoreQuestion,
  dbPermanentDeleteQuestion: data.dbPermanentDeleteQuestion,
  dbAddTagToQuestion: data.dbAddTagToQuestion,
  dbRemoveTagFromQuestion: data.dbRemoveTagFromQuestion,
  dbUpdateQuestionVersions: data.dbUpdateQuestionVersions,
  dbUpdateQuestionBookInfo: data.dbUpdateQuestionBookInfo,
  dbGetAllTags: data.dbGetAllTags,
  dbCreateTag: data.dbCreateTag,
  dbDeleteTag: data.dbDeleteTag,
  dbGetAllPapers: data.dbGetAllPapers,
  dbDeletePaper: data.dbDeletePaper,
  dbGetPaperQuestions: data.dbGetPaperQuestions,
  dbCreatePaperFromExport: data.dbCreatePaperFromExport,
  dbEnsurePaperPdfLocal: data.dbEnsurePaperPdfLocal,
  dbGetQuestionNotes: data.dbGetQuestionNotes,
  dbAddQuestionNote: data.dbAddQuestionNote,
  generateId: data.generateId,
  smartBackup: data.smartBackup,
  exportFullBackup: data.exportFullBackup,
  importBackupData: data.importBackupData,
  getChangelogCount: data.getChangelogCount,
  // services
  callCloudAI: services.callCloudAI,
  callCloudAIStream: services.callCloudAIStream,
  callCloudAIMultimodal: services.callCloudAIMultimodal,
  safeParseJSON: services.safeParseJSON,
  setProviderGetter: services.setProviderGetter,
  KNOWLEDGE_ATOMIZER_PROMPT: services.KNOWLEDGE_ATOMIZER_PROMPT,
  KNOWLEDGE_ATOMIZER_PROMPT_MULTIMODAL: services.KNOWLEDGE_ATOMIZER_PROMPT_MULTIMODAL,
  compressImage: services.compressImage,
  mergeImagesVertically: services.mergeImagesVertically,
  dataURLtoBlob: services.dataURLtoBlob,
  getAppVersions: services.getAppVersions,
  getCurrentVersion: services.getCurrentVersion,
  getCurrentVersionId: services.getCurrentVersionId,
  applyVersionTheme: services.applyVersionTheme,
  findSimilarTags: services.findSimilarTags,
  tagSimilarity: services.tagSimilarity,
  checkForUpdate: services.checkForUpdate,
  APP_VERSION_CODE: services.APP_VERSION_CODE,
  APP_VERSION_NAME: services.APP_VERSION_NAME,
  // ui
  showStatus: ui.showStatus,
  closeErrorModal: ui.closeErrorModal,
  escapeHtml: ui.escapeHtml,
  showTab: ui.showTab,
  renderMarkdown: ui.renderMarkdown,
  doSmartBackup: ui.doSmartBackup,
  doFullBackup: ui.doFullBackup,
  restoreFromBackup: ui.restoreFromBackup,
  updateBackupStatusUI: ui.updateBackupStatusUI,
  // sync apply（同步核心，勿删）
  dbReplaceWithRemoteSnapshot: data.dbReplaceWithRemoteSnapshot,
  // Batch 3: core state functions (assignIfMissing to keep app.js lexical bindings in sync)
  loadQuestions: ui.loadQuestions,
  filterQuestions: ui.filterQuestions,
  getFilteredQuestions: ui.getFilteredQuestions,
  renderQuestions: ui.renderQuestions,
  loadTags: ui.loadTags,
  renderTags: ui.renderTags,
  updateTagSelects: ui.updateTagSelects,
  renderFilterTags: ui.renderFilterTags,
  // Batch 4: core state functions (called by app.js refreshAll internally)
  loadPapers: ui.loadPapers,
});

assignToWindow({
  generatePDF: data.generatePDF,
  renderVersionSwitcher: ui.renderVersionSwitcher,
  renameCurrentVersion: ui.renameCurrentVersion,
  setAppVersion: ui.setAppVersion,
  renderVersionFilterTags: ui.renderVersionFilterTags,
  renderVersionCheckboxes: ui.renderVersionCheckboxes,
  getSelectedVersions: ui.getSelectedVersions,
  resetVersionCheckboxes: ui.resetVersionCheckboxes,
  showAddVersionModal: ui.showAddVersionModal,
  showEditVersionModal: ui.showEditVersionModal,
  closeVersionModal: ui.closeVersionModal,
  saveVersion: ui.saveVersion,
  deleteVersion: ui.deleteVersion,
  closeVersionDeleteModal: ui.closeVersionDeleteModal,
  confirmDeleteVersion: ui.confirmDeleteVersion,
  showSystemPasswordModal: ui.showSystemPasswordModal,
  closeSystemPasswordModal: ui.closeSystemPasswordModal,
  saveSystemPassword: ui.saveSystemPassword,
  hideEl: ui.hideEl,
  applyPlatformUI: ui.applyPlatformUI,
  selectLayout: ui.selectLayout,
  initAppUpdateUI: ui.initAppUpdateUI,
  manualCheckUpdate: ui.manualCheckUpdate,
  checkAppUpdate: ui.checkAppUpdate,
  dismissUpdate: ui.dismissUpdate,
  downloadAndInstall: ui.downloadAndInstall,
  initTabReorder: ui.initTabReorder,
  // Batch 2: review
  dbEnableReview: data.dbEnableReview,
  dbDisableReview: data.dbDisableReview,
  dbCompleteReview: data.dbCompleteReview,
  dbGetPendingReviews: data.dbGetPendingReviews,
  checkPendingReviews: ui.checkPendingReviews,
  showReviewReminder: ui.showReviewReminder,
  markReviewed: ui.markReviewed,
  toggleReviewForQuestion: ui.toggleReviewForQuestion,
  // Batch 2: basket
  toggleBasket: ui.toggleBasket,
  updateBasketBadge: ui.updateBasketBadge,
  openBasketModal: ui.openBasketModal,
  closeBasketModal: ui.closeBasketModal,
  exportFromBasket: ui.exportFromBasket,
  // Batch 2: test-god-mode
  runFullAIAutomation: ui.runFullAIAutomation,
  handleImport: ui.handleImport,
  // Batch 2: tag-suggest
  markWrapperDone: ui.markWrapperDone,
  createGeneratedTagButton: ui.createGeneratedTagButton,
  generateFormTagsFromComment: ui.generateFormTagsFromComment,
  addFormTagByName: ui.addFormTagByName,
  removeTagFromQuestion: ui.removeTagFromQuestion,
  saveUserComment: ui.saveUserComment,
  analyzeSingleQuestion: ui.analyzeSingleQuestion,
  handleBatchAnalyze: ui.handleBatchAnalyze,
  // Batch 3: tag-manage (leaf functions only)
  onFormTagSearch: ui.onFormTagSearch,
  onFormTagKeydown: ui.onFormTagKeydown,
  addFormTag: ui.addFormTag,
  removeFormTag: ui.removeFormTag,
  createTagFromSearch: ui.createTagFromSearch,
  renderFormSelectedTags: ui.renderFormSelectedTags,
  toggleFilterTags: ui.toggleFilterTags,
  deleteTag: ui.deleteTag,
  initTagForm: ui.initTagForm,
  showNewTagModal: ui.showNewTagModal,
  closeNewTagModal: ui.closeNewTagModal,
  submitNewTag: ui.submitNewTag,
  clearFormGeneratedTags: ui.clearFormGeneratedTags,
  _startFormTagPoll: ui._startFormTagPoll,
  _stopFormTagPoll: ui._stopFormTagPoll,
  // Batch 3: question-core (leaf functions only - core state fns stay in assignIfMissing)
  initQuestionForm: ui.initQuestionForm,
  fuzzyMatchTags: ui.fuzzyMatchTags,
  showTagSuggestions: ui.showTagSuggestions,
  toggleInlineTagAdd: ui.toggleInlineTagAdd,
  startInlinePoll: ui.startInlinePoll,
  stopInlinePoll: ui.stopInlinePoll,
  onInlineTagSearch: ui.onInlineTagSearch,
  onInlineTagKeydown: ui.onInlineTagKeydown,
  showAddedTag: ui.showAddedTag,
  toggleQuestionSelect: ui.toggleQuestionSelect,
  updateSelectedCount: ui.updateSelectedCount,
  deleteQuestion: ui.deleteQuestion,
  loadTrashed: ui.loadTrashed,
  // Batch 3: note-version
  loadNoteVersionsForDetail: ui.loadNoteVersionsForDetail,
  displayCurrentNoteVersion: ui.displayCurrentNoteVersion,
  saveTextNote: ui.saveTextNote,
  switchNoteVersion: ui.switchNoteVersion,
  showAddNoteVersionModal: ui.showAddNoteVersionModal,
  closeAddNoteVersionModal: ui.closeAddNoteVersionModal,
  takePhotoForNoteVersion: ui.takePhotoForNoteVersion,
  pickFromGalleryForNoteVersion: ui.pickFromGalleryForNoteVersion,
  removeNoteVersionImage: ui.removeNoteVersionImage,
  confirmAddNoteVersion: ui.confirmAddNoteVersion,
  addExtraNoteVersion: ui.addExtraNoteVersion,
  removeExtraNoteVersion: ui.removeExtraNoteVersion,
  removeExtraImage: ui.removeExtraImage,
  takePhotoForExtra: ui.takePhotoForExtra,
  pickFromGalleryForExtra: ui.pickFromGalleryForExtra,
  // Batch 3: question-detail
  showQuestionDetail: ui.showQuestionDetail,
  renderDetailContent: ui.renderDetailContent,
  toggleQuestionVersion: ui.toggleQuestionVersion,
  updateDetailBasketBtn: ui.updateDetailBasketBtn,
  toggleBasketInDetail: ui.toggleBasketInDetail,
  navigateDetail: ui.navigateDetail,
  closeModal: ui.closeQuestionModal,
  // Batch 4: paper-manage (leaf functions)
  showPaperDetail: ui.showPaperDetail,
  closePaperModal: ui.closePaperModal,
  openPaperPdf: ui.openPaperPdf,
  exportPaperAsPDF: ui.exportPaperAsPDF,
  exportPaperAsImages: ui.exportPaperAsImages,
  getExportImgMode: ui.getExportImgMode,
  setExportImgMode: ui.setExportImgMode,
  updateExportImgModeBtn: ui.updateExportImgModeBtn,
  toggleExportImgMode: ui.toggleExportImgMode,
  _doExportImagesModalConfirm: ui._doExportImagesModalConfirm,
  closeExportImagesModal: ui.closeExportImagesModal,
  exportImagesToFolder: ui.exportImagesToFolder,
  doExportImagesFromBasket: ui.doExportImagesFromBasket,
  _runExportImagesFromBasket: ui._runExportImagesFromBasket,
  doExportImages: ui.doExportImages,
  // Batch 4: export-pdf-ui
  exportSelectedOrAll: ui.exportSelectedOrAll,
  showExportModal: ui.showExportModal,
  loadExportFolders: ui.loadExportFolders,
  confirmNewExportFolder: ui.confirmNewExportFolder,
  getExportFolder: ui.getExportFolder,
  getExportFileName: ui.getExportFileName,
  previewExportPDF: ui.previewExportPDF,
  closeExportModal: ui.closeExportModal,
  selectExportMode: ui.selectExportMode,
  selectSpacing: ui.selectSpacing,
  doExportPDF: ui.doExportPDF,
  // Batch 5: camera
  _handleImageReady: ui._handleImageReady,
  takePhoto: ui.takePhoto,
  pickFromGallery: ui.pickFromGallery,
  handleCameraResult: ui.handleCameraResult,
  handleFileSelect: ui.handleFileSelect,
  copyQuestionToAnswer: ui.copyQuestionToAnswer,
  removeImage: ui.removeImage,
  loadGalleryThumbnails: ui.loadGalleryThumbnails,
  galleryThumbClick: ui.galleryThumbClick,
  crossPageShoot: ui.crossPageShoot,
  captureAndCropOne: ui.captureAndCropOne,
  captureOneImage: ui.captureOneImage,
  // Batch 5: crop
  clampValue: ui.clampValue,
  smoothSeries: ui.smoothSeries,
  getOtsuThreshold: ui.getOtsuThreshold,
  collectRanges: ui.collectRanges,
  expandRect: ui.expandRect,
  detectCenterQuestionRect: ui.detectCenterQuestionRect,
  getDefaultCropRect: ui.getDefaultCropRect,
  destroyCropInteractionLayer: ui.destroyCropInteractionLayer,
  queueCropInteractionSync: ui.queueCropInteractionSync,
  syncCropInteractionLayer: ui.syncCropInteractionLayer,
  initCropInteractionLayer: ui.initCropInteractionLayer,
  onCropGestureStart: ui.onCropGestureStart,
  updateCropGesture: ui.updateCropGesture,
  endCropGesture: ui.endCropGesture,
  createCropperWithRect: ui.createCropperWithRect,
  isValidCropRect: ui.isValidCropRect,
  openCropModal: ui.openCropModal,
  startCrop: ui.startCrop,
  confirmCrop: ui.confirmCrop,
  cancelCrop: ui.cancelCrop,
  rotateCrop: ui.rotateCrop,
  // Batch 6: sync-ui
  apiHeaders: ui.apiHeaders,
  setSyncStatus: ui.setSyncStatus,
  showSyncStatus: ui.showSyncStatus,
  checkServerConnection: ui.checkServerConnection,
  updateSyncBar: ui.updateSyncBar,
  handleSyncBarClick: ui.handleSyncBarClick,
  canSync: ui.canSync,
  getSyncCursor: ui.getSyncCursor,
  setSyncCursor: ui.setSyncCursor,
  clearSyncCursor: ui.clearSyncCursor,
  apiCall: ui.apiCall,
  updateLoginUI: ui.updateLoginUI,
  showLoginModal: ui.showLoginModal,
  closeLoginModal: ui.closeLoginModal,
  showSyncModal: ui.showSyncModal,
  closeSyncModal: ui.closeSyncModal,
  showSyncWarning: ui.showSyncWarning,
  closeSyncWarning: ui.closeSyncWarning,
  handleAuthError: ui.handleAuthError,
  doLogin: ui.doLogin,
  doRegister: ui.doRegister,
  showLoginError: ui.showLoginError,
  doLogout: ui.doLogout,
  checkRecoveryStatus: ui.checkRecoveryStatus,
  fullSyncToCloud: ui.fullSyncToCloud,
  silentSupabaseSync: ui.silentSupabaseSync,
  startSupabaseAutoSync: ui.startSupabaseAutoSync,
  switchToBackupServer: ui.switchToBackupServer,
  syncFromPrimaryServer: ui.syncFromPrimaryServer,
  updateServerSyncStatus: ui.updateServerSyncStatus,
  stopSyncPolling: ui.stopSyncPolling,
  restartSyncPolling: ui.restartSyncPolling,
  // Task: compose existing polling globals (removed app.js no longer provides these)
  stopAllPolling: () => { ui.stopSyncPolling(); },
  restartAllPolling: () => { ui.restartSyncPolling(); },
  queueAutoSync: ui.queueAutoSync,
  runSync: ui.runSync,
  doSync: ui.doSync,
  doSyncDown: ui.doSyncDown,
  toggleAutoSync: ui.toggleAutoSync,
  toggleSync: ui.toggleSync,
  initRemoteSync: ui.initRemoteSync,
  // Batch 6: baidu-netdisk
  getBaiduToken: ui.getBaiduToken,
  setBaiduToken: ui.setBaiduToken,
  updateBaiduUI: ui.updateBaiduUI,
  showBaiduAuthModal: ui.showBaiduAuthModal,
  closeBaiduAuthModal: ui.closeBaiduAuthModal,
  openBaiduAuth: ui.openBaiduAuth,
  exchangeBaiduToken: ui.exchangeBaiduToken,
  refreshBaiduToken: ui.refreshBaiduToken,
  getValidBaiduToken: ui.getValidBaiduToken,
  uploadToBaidu: ui.uploadToBaidu,
  downloadFromBaidu: ui.downloadFromBaidu,
  unbindBaidu: ui.unbindBaidu,
  toggleAutoBaidu: ui.toggleAutoBaidu,
  doAutoBaiduBackup: ui.doAutoBaiduBackup,
  // Batch 7: ai-model-ui
  updateAIStatusUI: ui.updateAIStatusUI, handleLoadModel: ui.handleLoadModel, pasteTo: ui.pasteTo,
  // Batch 7: provider-manage
  migrateOldConfig: ui.migrateOldConfig, renderProviderList: ui.renderProviderList,
  deleteProviderById: ui.deleteProviderById, copyProvider: ui.copyProvider,
  selectProvider: ui.selectProvider, showAddProviderModal: ui.showAddProviderModal,
  editProvider: ui.editProvider, closeProviderModal: ui.closeProviderModal,
  saveProvider: ui.saveProvider, deleteProvider: ui.deleteProvider,
  getCurrentProvider: ui.getCurrentProvider, initProviderList: ui.initProviderList,
  generateTagsFromComment: ui.generateTagsFromComment,
  addGeneratedTag: ui.addGeneratedTag, clearGeneratedTags: ui.clearGeneratedTags,
  // Batch 7: projection
  enterProjectionMode: ui.enterProjectionMode, exitProjectionMode: ui.exitProjectionMode,
  renderProjection: ui.renderProjection, projectionPrev: ui.projectionPrev,
  projectionNext: ui.projectionNext,
  // Batch 7: drawing canvas + backup helpers
  _buildDrawHTML: ui._buildDrawHTML, initDrawCanvas: ui.initDrawCanvas,
  saveDrawing: ui.saveDrawing, cancelDraw: ui.cancelDraw,
  getBackupPath: ui.getBackupPath, getBackupDir: ui.getBackupDir,
  // Task 7c: backup modal helpers (ported from app.js)
  showBackupModal: ui.showBackupModal,
  closeBackupModal: ui.closeBackupModal,
  saveBackupToDevice: ui.saveBackupToDevice,
  loadBackupFromDevice: ui.loadBackupFromDevice,
  toggleAutoBackup: ui.toggleAutoBackup,
  doAutoBackup: ui.doAutoBackup,
  buildBackupData: ui.buildBackupData,
  // Batch 8: issue-feedback
  initIssueFeedbackListener: ui.initIssueFeedbackListener,
  showFeedbackPromptBar: ui.showFeedbackPromptBar,
  dismissFeedbackPrompt: ui.dismissFeedbackPrompt,
  openFeedbackPromptFeedback: ui.openFeedbackPromptFeedback,
  openIssueFeedbackModal: ui.openIssueFeedbackModal,
  closeIssueFeedbackModal: ui.closeIssueFeedbackModal,
  addFeedbackScreenshot: ui.addFeedbackScreenshot,
  removeFeedbackScreenshot: ui.removeFeedbackScreenshot,
  submitIssueFeedback: ui.submitIssueFeedback,
  retryPendingFeedback: ui.retryPendingFeedback,
  // Batch 9: quick import
  toggleQuickImportMode: ui.toggleQuickImportMode,
  confirmQuickImport: ui.confirmQuickImport,
  swapQuickPair: ui.swapQuickPair,
  openComboPanel: ui.openComboPanel,
  closeComboPanel: ui.closeComboPanel,
  createComboFromPanel: ui.createComboFromPanel,
  toggleQuickLayout: ui.toggleQuickLayout,
  // 快速导入文字笔记（设计：docs/plans/2026-08-30-quick-import-text-note.md）
  toggleQuickNote: ui.toggleQuickNote,
  onQuickNoteInput: ui.onQuickNoteInput,
  // 快速导入常见标签（设计：docs/plans/2026-09-03-quick-import-favorite-tags.md）
  toggleQuickFavPanel: ui.toggleQuickFavPanel,
  renderQuickFavCandidates: ui.renderQuickFavCandidates,
  renderQuickFavTags: ui.renderQuickFavTags,
  renderQuickFavSortList: ui.renderQuickFavSortList,
  renderQuickFavSyncState: ui.renderQuickFavSyncState,
  setQuickFavOn: services.setQuickFavOn,
});

// Batch 2: init review check on startup
ui.initReviewCheck();

// Batch 3: init detail swipe gesture
ui.initDetailSwipe();

// Batch 6: init sync/login UI
ui.initSyncUI();

// Batch 7: init projection events + provider list
ui.initProjectionEvents();
ui.initProviderList();

// Batch 8: init issue feedback listener
ui.initIssueFeedbackListener();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAnchoredModals();
    initApp();
  });
} else {
  initAnchoredModals();
  initApp();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    Promise.resolve(ui.retryPendingFeedback()).catch(() => {});
  });
}
