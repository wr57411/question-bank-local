export interface SyncConfig {
  serverUrl: string;
  apiToken: string;
  enabled: boolean;
}

export interface SyncPayload {
  questions: unknown[];
  tags: unknown[];
  question_tags: unknown[];
  papers: unknown[];
  paper_questions: unknown[];
  question_notes: unknown[];
}

export interface DataFingerprint {
  questionCount: number;
  tagCount: number;
  paperCount: number;
  topicCount: number;
  questionTagCount: number;
  versionsPresent: number;
}

export interface SyncWarning {
  type: string;
  message: string;
}
