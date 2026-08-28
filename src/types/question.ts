export interface Question {
  id: string;
  question_image_url: string | null;
  answer_image_url: string | null;
  question_image_blank_url: string | null;
  layout_type: number;
  versions: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  purged_at?: string | null;
  semantic_summary: string;
  ai_metadata: Record<string, unknown>;
  user_comment?: string;
  book_name: string;
  page_number: string;
  question_number: string;
  question_tags?: TagSummary[];
  review_enabled?: boolean;
  next_review_at?: string;
  review_interval_days?: number;
}

export interface TagSummary {
  id: string;
  name: string;
  color: string;
}

export interface QuestionTag {
  question_id: string;
  tag_id: string;
}

export interface BookInfo {
  book_name: string;
  page_number: string;
  question_number: string;
}

export interface QuestionNote {
  id: string;
  question_id: string;
  image_url: string | null;
  label: string;
  text_note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PendingPhoto {
  id: string;
  image_url: string;
  group_id: string;
  processed: boolean;
  question_id: string | null;
  created_at: string;
}

export interface SimilarQuestionLink {
  question_id: string;
  similar_question_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
