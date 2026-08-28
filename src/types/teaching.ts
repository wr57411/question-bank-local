export interface TeachingNode {
  id: string;
  chapter: string;
  subject: string;
  name: string;
  difficulty: '基础' | '进阶' | '挑战';
  key_concept: string;
  diagram: string;
  status?: 'pending' | 'generating' | 'done' | 'error' | 'approved';
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeachingVersion {
  id: string;
  node_id: string;
  version_number: number;
  content: string;
  is_current: boolean;
  created_at: string;
  updated_at?: string;
}

export interface NodeQuestion {
  id: string;
  node_id: string;
  question_id: string;
  module?: string;
  order_num?: number;
  created_at?: string;
}
