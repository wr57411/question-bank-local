export interface SyncConfig {
  serverUrl: string;
  apiToken: string;
  enabled: boolean;
}

// 关联独立同步键：与题目/标签解耦，逐条时间戳合并。删除表达为软删（deleted_at 非空）。
export interface QuestionTagSync {
  question_id: string;
  tag_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface SyncPayload {
  questions: unknown[];
  tags: unknown[];
  question_tags: QuestionTagSync[];
  papers: unknown[];
  paper_questions: unknown[];
  question_notes: unknown[];
  // 2.13 配置通道：groups / tag_categories / app_settings 序列化进 user_settings
  settings?: Record<string, unknown>;
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
