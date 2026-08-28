export interface PdfCategory {
  id: string;
  parent_id?: string;
  name: string;
  level: number;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface PdfBook {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface PdfChapter {
  id: string;
  book_id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface PdfTopic {
  id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface PdfDoc {
  id: string;
  filename: string;
  page_count: number;
  file_size: number;
  server_path: string;
  chapter_id?: string;
  topic_id?: string;
  category_id?: string;
  local_cache_path?: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
  tag_ids?: string[];
}

export interface PdfDocTag {
  pdf_id: string;
  tag_id: string;
}
