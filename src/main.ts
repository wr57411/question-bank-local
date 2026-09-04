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
const FloatingWindow = isNative ? (cap?.Plugins?.FloatingWindow ?? null) : null;

assignIfMissing({
  isNative,
  isIOS,
  Camera,
  MediaPlugin,
  FloatingWindow,
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
  dbCreatePaper: data.dbCreatePaper,
  dbDeletePaper: data.dbDeletePaper,
  dbGetAllTopics: data.dbGetAllTopics,
  dbCreateTopic: data.dbCreateTopic,
  dbDeleteTopic: data.dbDeleteTopic,
  dbGetAllTeachingNodes: data.dbGetAllTeachingNodes,
  dbCreateTeachingNode: data.dbCreateTeachingNode,
  dbUpdateTeachingNode: data.dbUpdateTeachingNode,
  dbDeleteTeachingNode: data.dbDeleteTeachingNode,
  dbGetQuestionNotes: data.dbGetQuestionNotes,
  dbAddQuestionNote: data.dbAddQuestionNote,
  dbGetPendingPhotos: data.dbGetPendingPhotos,
  dbGetAllSimilarLinks: data.dbGetAllSimilarLinks,
  dbAddSimilarQuestionLinks: data.dbAddSimilarQuestionLinks,
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
  TEACHING_GENERATOR_PROMPT: services.TEACHING_GENERATOR_PROMPT,
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
  // pdf library
  renderPdfLibrary: ui.renderPdfLibrary,
  switchPdfView: ui.switchPdfView,
  togglePdfNode: ui.togglePdfNode,
  handlePdfUpload: ui.handlePdfUpload,
  doConfirmUpload: ui.doConfirmUpload,
  closePdfUploadConfirm: ui.closePdfUploadConfirm,
  showPdfActions: ui.showPdfActions,
  closePdfActionModal: ui.closePdfActionModal,
  showMovePdfModal: ui.showMovePdfModal,
  confirmMovePdf: ui.confirmMovePdf,
  startPdfPreview: ui.startPdfPreview,
  closePdfPreview: ui.closePdfPreview,
  doDownloadPdf: ui.doDownloadPdf,
  doDeletePdf: ui.doDeletePdf,
  showPdfCategoryMenu: ui.showPdfCategoryMenu,
  addPdfSubCategory: ui.addPdfSubCategory,
  renamePdfCategory: ui.renamePdfCategory,
  deletePdfCategory: ui.deletePdfCategory,
  closePdfManageModal: ui.closePdfManageModal,
  showAddTopicModal: ui.showAddTopicModal,
  confirmAddTopic: ui.confirmAddTopic,
  showPdfTopicMenu: ui.showPdfTopicMenu,
  renamePdfTopic: ui.renamePdfTopic,
  deletePdfTopic: ui.deletePdfTopic,
  // wiki
  showWikiTab: ui.showWikiTab,
  renderWikiPanel: ui.renderWikiPanel,
  renderWikiForQuestion: ui.renderWikiForQuestion,
  compileWikiKnowledge: services.compileWikiKnowledge,
  createWikiPageFromDraft: services.createWikiPageFromDraft,
  buildWikiSystemPrompt: services.buildWikiSystemPrompt,
  validatePage: services.validatePage,
  wikiSmartUpsertPage: data.wikiSmartUpsertPage,
  wikiGetIndex: data.wikiGetIndex,
  wikiGetLog: data.wikiGetLog,
  runDiagnostic: services.runDiagnostic,
  DIAGNOSTIC_QUESTIONS: services.DIAGNOSTIC_QUESTIONS,
  wikiFlushPendingJobs: ui.wikiFlushPendingJobs,
  wikiPutLink: data.wikiPutLink,
  wikiCreatePendingJob: data.wikiCreatePendingJob,
  wikiMarkJobCompleted: data.wikiMarkJobCompleted,
  wikiMarkJobFailed: data.wikiMarkJobFailed,
  wikiGetPendingJobs: data.wikiGetPendingJobs,
  wikiGetLinks: data.wikiGetLinks,
  wikiGetAllPages: data.wikiGetAllPages,
  wikiGetPage: data.wikiGetPage,
  wikiLint: data.wikiLint,
  wikiLogAppend: data.wikiLogAppend,
  dbWikiGetAllPages: data.wikiGetAllPages,
  dbWikiGetPage: data.wikiGetPage,
  dbWikiLint: data.wikiLint,
  dbWikiSmartUpsertPage: data.wikiSmartUpsertPage,
  dbWikiLogAppend: data.wikiLogAppend,
  dbWikiGetIndex: data.wikiGetIndex,
  dbWikiGetLog: data.wikiGetLog,
  // wiki mvp
  showWikiTabMvp: ui.showWikiTabMvp,
  renderWikiMvpPanel: ui.renderWikiMvpPanel,
  wikiMvpSyncModelInput: ui.wikiMvpSyncModelInput,
  wikiMvpRenderQuestions: ui.wikiMvpRenderQuestions,
  wikiMvpImgError: ui.wikiMvpImgError,
  wikiMvpToggleQuestion: ui.wikiMvpToggleQuestion,
  wikiMvpSelectAll: ui.wikiMvpSelectAll,
  wikiMvpClearAll: ui.wikiMvpClearAll,
  wikiMvpRunExtract: ui.wikiMvpRunExtract,
  wikiMvpToggleConcept: ui.wikiMvpToggleConcept,
  wikiMvpJumpToConcept: ui.wikiMvpJumpToConcept,
  wikiMvpLoadSession: ui.wikiMvpLoadSession,
  wikiMvpDeleteSession: ui.wikiMvpDeleteSession,
  wikiMvpChangeMode: ui.wikiMvpChangeMode,
  wikiMvpSyncOcrInput: ui.wikiMvpSyncOcrInput,
  wikiMvpTestOcrConnection: ui.wikiMvpTestOcrConnection,
  wikiMvpSyncBaseUrl: ui.wikiMvpSyncBaseUrl,
  wikiMvpSavePrompt: ui.wikiMvpSavePrompt,
  wikiMvpResetPrompt: ui.wikiMvpResetPrompt,
  // pdf cloud services
  uploadPdfToServer: services.uploadPdfToServer,
  fetchPdfPages: services.fetchPdfPages,
  downloadPdfToLocal: services.downloadPdfToLocal,
  deleteRemotePdf: services.deleteRemotePdf,
  updateRemotePdfMeta: services.updateRemotePdfMeta,
  setPdfTagsRemote: services.setPdfTagsRemote,
  // pdf data
  dbGetAllPdfDocs: data.dbGetAllPdfDocs,
  dbAddPdfDoc: data.dbAddPdfDoc,
  dbDeletePdfDoc: data.dbDeletePdfDoc,
  dbUpdatePdfDoc: data.dbUpdatePdfDoc,
  dbSetPdfDocTags: data.dbSetPdfDocTags,
  dbGetAllPdfCategories: data.dbGetAllPdfCategories,
  dbCreatePdfCategory: data.dbCreatePdfCategory,
  dbUpdatePdfCategory: data.dbUpdatePdfCategory,
  dbDeletePdfCategory: data.dbDeletePdfCategory,
  ensureTextbookStructure: data.ensureTextbookStructure,
  dbReplaceWithRemoteSnapshot: data.dbReplaceWithRemoteSnapshot,
  // Batch 3: core state functions (assignIfMissing to keep app.js lexical bindings in sync)
  loadQuestions: ui.loadQuestions,
  loadBookFilter: ui.loadBookFilter,
  filterQuestions: ui.filterQuestions,
  getFilteredQuestions: ui.getFilteredQuestions,
  renderQuestions: ui.renderQuestions,
  loadTags: ui.loadTags,
  renderTags: ui.renderTags,
  updateTagSelects: ui.updateTagSelects,
  renderFilterTags: ui.renderFilterTags,
  // Batch 4: core state functions (called by app.js refreshAll internally)
  loadPapers: ui.loadPapers,
  loadTopics: ui.loadTopics,
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
  // Batch 2: pending-link
  getPendingLinkList: ui.getPendingLinkList,
  savePendingLinkList: ui.savePendingLinkList,
  togglePendingLink: ui.togglePendingLink,
  isPendingLink: ui.isPendingLink,
  updatePendingLinkBadge: ui.updatePendingLinkBadge,
  updatePendingPhotosBadge: ui.updatePendingPhotosBadge,
  importPendingPhotosFromNative: ui.importPendingPhotosFromNative,
  togglePendingLinkInDetail: ui.togglePendingLinkInDetail,
  updatePendingLinkBtnStyle: ui.updatePendingLinkBtnStyle,
  renderPendingLinkList: ui.renderPendingLinkList,
  removeFromPendingLink: ui.removeFromPendingLink,
  // Batch 2: blank-question
  showPendingBlankList: ui.showPendingBlankList,
  closePendingBlankModal: ui.closePendingBlankModal,
  removeFromPendingBlank: ui.removeFromPendingBlank,
  updatePendingBlankCount: ui.updatePendingBlankCount,
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
  switchAddMode: ui.switchAddMode,
  addBatchRow: ui.addBatchRow,
  removeBatchRow: ui.removeBatchRow,
  getBatchEntries: ui.getBatchEntries,
  initQuestionForm: ui.initQuestionForm,
  filterByBook: ui.filterByBook,
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
  saveBookInfo: ui.saveBookInfo,
  updateDetailBasketBtn: ui.updateDetailBasketBtn,
  toggleBasketInDetail: ui.toggleBasketInDetail,
  navigateDetail: ui.navigateDetail,
  closeModal: ui.closeQuestionModal,
  renderSimilarQuestions: ui.renderSimilarQuestions,
  getQuestionFeatureText: ui.getQuestionFeatureText,
  getTextSignalSet: ui.getTextSignalSet,
  scoreTextSimilarity: ui.scoreTextSimilarity,
  buildSimilarCandidates: ui.buildSimilarCandidates,
  openSimilarModal: ui.openSimilarModal,
  closeSimilarModal: ui.closeSimilarModal,
  renderSimilarCandidates: ui.renderSimilarCandidates,
  loadPendingLinkCandidates: ui.loadPendingLinkCandidates,
  parseSimilarAIResult: ui.parseSimilarAIResult,
  recommendSimilarWithAI: ui.recommendSimilarWithAI,
  confirmSimilarLinks: ui.confirmSimilarLinks,
  // Batch 4: paper-manage (leaf functions)
  initPaperForm: ui.initPaperForm,
  showPaperDetail: ui.showPaperDetail,
  closePaperModal: ui.closePaperModal,
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
  startAIPaperGeneration: ui.startAIPaperGeneration,
  renderAIRecommendations: ui.renderAIRecommendations,
  closeAIRecommendModal: ui.closeAIRecommendModal,
  createPaperFromAI: ui.createPaperFromAI,
  // Batch 4: topic-manage (leaf functions)
  renderTopicQuestionPicker: ui.renderTopicQuestionPicker,
  getSelectedTopicQuestions: ui.getSelectedTopicQuestions,
  initTopicForm: ui.initTopicForm,
  showTopicDetail: ui.showTopicDetail,
  closeTopicDetailModal: ui.closeTopicDetailModal,
  exportTopicPDF: ui.exportTopicPDF,
  exportTopicPDFForId: ui.exportTopicPDFForId,
  deleteTopic: ui.deleteTopic,
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
  // Batch 5: floating-window
  toggleFloatingWindow: ui.toggleFloatingWindow,
  pickFromFloating: ui.pickFromFloating,
  showFloatingImageList: ui.showFloatingImageList,
  importFloatingImage: ui.importFloatingImage,
  deleteFloatingImage: ui.deleteFloatingImage,
  clearFloatingImages: ui.clearFloatingImages,
  closeFloatingModal: ui.closeFloatingModal,
  pollFloatingEvents: ui.pollFloatingEvents,
  confirmFloatingSave: ui.confirmFloatingSave,
  cancelFloatingSave: ui.cancelFloatingSave,
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
  // Batch 5: pending-photos-ui
  showPendingPhotosTab: ui.showPendingPhotosTab,
  loadPendingPhotos: ui.loadPendingPhotos,
  openProcessPhotoModal: ui.openProcessPhotoModal,
  openBatchProcessModal: ui.openBatchProcessModal,
  confirmProcessPhoto: ui.confirmProcessPhoto,
  closeProcessPhotoModal: ui.closeProcessPhotoModal,
  deletePendingPhoto: ui.deletePendingPhoto,
  deletePendingPhotoById: ui.deletePendingPhotoById,
  closePendingPhotosModal: ui.closePendingPhotosModal,
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
  stopAllPolling: () => { ui.stopSyncPolling(); ui.stopFloatingPolling(); },
  restartAllPolling: () => { ui.restartSyncPolling(); ui.restartFloatingPolling(); },
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
  // Batch 7: teaching-ui
  loadTeachingView: ui.loadTeachingView, getCurrentVersion: ui.getCurrentVersion,
  getNodeVersions: ui.getNodeVersions, renderTeachingStats: ui.renderTeachingStats,
  renderTeachingNodeList: ui.renderTeachingNodeList,
  showNodeDiagram: ui.showNodeDiagram, atomizeChapter: ui.atomizeChapter,
  // Batch 7: teaching-queue
  updateTeachingSelectedCount: ui.updateTeachingSelectedCount,
  selectAllPending: ui.selectAllPending, startSelectedGeneration: ui.startSelectedGeneration,
  startAllGeneration: ui.startAllGeneration, pauseBatchGeneration: ui.pauseBatchGeneration,
  regenerateNode: ui.regenerateNode, addNewVersion: ui.addNewVersion,
  showVersionSwitcher: ui.showVersionSwitcher, retryAllErrors: ui.retryAllErrors,
  deleteTeachingNode: ui.deleteTeachingNode,
  // Batch 7: teaching-verify
  getVerifyNodeList: ui.getVerifyNodeList, openVerifyModal: ui.openVerifyModal,
  verifyPrev: ui.verifyPrev, verifyNext: ui.verifyNext,
  toggleVerifyEdit: ui.toggleVerifyEdit, handleKatexEdit: ui.handleKatexEdit,
  finishKatexEdit: ui.finishKatexEdit, htmlToMarkdown: ui.htmlToMarkdown,
  saveWysiwygEdit: ui.saveWysiwygEdit, cancelWysiwygEdit: ui.cancelWysiwygEdit,
  closeVerifyModal: ui.closeVerifyModal, verifyApprove: ui.verifyApprove,
  verifyRegenerate: ui.verifyRegenerate, loadLinkedQuestions: ui.loadLinkedQuestions,
  unlinkQuestionFromNode: ui.unlinkQuestionFromNode,
  openNodeQuestionPicker: ui.openNodeQuestionPicker,
  closeNodeQuestionPicker: ui.closeNodeQuestionPicker,
  confirmNodeQuestionLinks: ui.confirmNodeQuestionLinks,
  // Batch 7: projection
  enterProjectionMode: ui.enterProjectionMode, exitProjectionMode: ui.exitProjectionMode,
  renderProjection: ui.renderProjection, projectionPrev: ui.projectionPrev,
  projectionNext: ui.projectionNext,
  // Batch 7: drawing canvas + backup helpers + floating polling
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
  stopFloatingPolling: ui.stopFloatingPolling, restartFloatingPolling: ui.restartFloatingPolling,
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

// Batch 2: expose native import alias
w['importPendingPhotos'] = ui.importPendingPhotosFromNative;

// Batch 2: init review check on startup
ui.initReviewCheck();

// Batch 3: init detail swipe gesture
ui.initDetailSwipe();

// Batch 5: init floating window poll
ui.initFloatingPoll();

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
    Promise.resolve(ui.wikiFlushPendingJobs?.()).catch(() => {});
    Promise.resolve(ui.retryPendingFeedback()).catch(() => {});
  });
}
