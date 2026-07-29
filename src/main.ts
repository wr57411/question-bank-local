import './styles/main.css';

import * as data from './data';
import * as services from './services';
import * as ui from './ui';

const w = window as unknown as Record<string, unknown>;

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

assignIfMissing({
  // data layer
  dbGetAllQuestions: data.dbGetAllQuestions,
  dbGetTrashedQuestions: data.dbGetTrashedQuestions,
  dbCreateQuestion: data.dbCreateQuestion,
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
});
