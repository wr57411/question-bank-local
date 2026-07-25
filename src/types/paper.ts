export interface Paper {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PaperQuestion {
  paper_id: string;
  question_id: string;
  order_num?: number;
}
