export interface WikiConceptLink {
  target: string;
  relation: string;
}

export interface WikiConcept {
  title: string;
  category: string;
  definition: string;
  explanation: string;
  exam_point: string;
  pitfalls: string[];
  analogy: string;
  quotes: string[];
  links: WikiConceptLink[];
}

export interface WikiMvpSession {
  id: string;
  created_at: string;
  model: string;
  question_ids: string[];
  question_count: number;
  concepts: WikiConcept[];
  raw_response: string;
  error?: string;
}

export interface WikiExtractResult {
  concepts: WikiConcept[];
  raw_response: string;
  model_used: string;
  elapsed_ms: number;
}
