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
});
