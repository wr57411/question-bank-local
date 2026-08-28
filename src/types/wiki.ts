export type WikiPageType = 'concept' | 'method' | 'model' | 'fallacy';

export type ReviewStatus = 'auto' | 'human_verified' | 'rejected' | 'needs_merge';

export interface WikiPage {
  id: string;
  type: WikiPageType;
  title: string;
  canonical_title: string;
  aliases: string[];
  summary: string;
  content: string;
  latex_formulas: string[];
  key_conditions: string[];
  common_mistakes: string[];
  related_page_ids: string[];
  source_ids: string[];
  source_snippets: string[];
  confidence: number;
  review_status: ReviewStatus;
  generated_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface CompileJob {
  id: string;
  source_type: 'question_image' | 'pdf_page' | 'manual';
  source_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempt_count: number;
  error_message: string | null;
  result_page_ids: string[];
  created_at: string;
  completed_at: string | null;
}

export interface WikiLink {
  id: string;
  source_page_id: string;
  target_page_id: string;
  relation: 'prerequisite' | 'related' | 'contradicts' | 'extends';
  description: string;
  created_at: string;
  deleted_at: string | null;
}
