export interface Tag {
  id: string;
  name: string;
  color: string;
  category_id: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null;
}

export interface TagCategory {
  id: string;
  name: string;
  order: number;
  is_system?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
