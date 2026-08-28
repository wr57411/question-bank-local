export interface BackupManifest {
  format: 'incremental_v1';
  snapshot_id: string;
  base_snapshot_id: string | null;
  timestamp: string;
  is_full: boolean;
  changes: ChangeRecord[];
}

export interface ChangeRecord {
  store: string;
  key: string;
  action: 'put' | 'delete';
  value?: unknown;
  timestamp: string;
}

export interface FullBackupData {
  questions: unknown[];
  tags: unknown[];
  question_tags: unknown[];
  papers: unknown[];
  paper_questions: unknown[];
  similar_question_links: unknown[];
  topics?: unknown[];
  topic_questions?: unknown[];
  question_notes?: unknown[];
  pending_photos?: unknown[];
  teaching_nodes?: unknown[];
  teaching_versions?: unknown[];
  node_questions?: unknown[];
  pending_link_list?: unknown[];
}
