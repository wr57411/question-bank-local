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
  similar_question_links: unknown[];
  topics: unknown[];
  topic_questions: unknown[];
  question_notes: unknown[];
  teaching_nodes: unknown[];
  teaching_versions: unknown[];
  node_questions: unknown[];
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
