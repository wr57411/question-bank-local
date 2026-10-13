export * from './question';
export * from './tag';
export * from './group';
export * from './paper';
export * from './sync';
export * from './backup';
export * from './pdf';

export interface QuestionEmbedding {
  question_id: string;
  dim: number;
  vector: string;
}
