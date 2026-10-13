export type ExprNode =
  | { op: 'and' | 'or'; children: ExprNode[] }
  | { tag: string };

export interface Group {
  id: string;
  kind: 'chapter' | 'topic';
  name: string;
  expr: ExprNode;
  member_tag_id: string | null;
  order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
