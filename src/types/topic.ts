export interface Topic {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  question_count?: number;
}

export interface TopicQuestion {
  id?: string;
  topic_id: string;
  question_id: string;
  order_num: number;
  teacher_comment: string;
}
