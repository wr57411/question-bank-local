export interface FeedbackMetadata {
  platform: string;
  ua: string;
  version_code: number;
  version_name: string;
  page: string;
  client_time: string;
}

export interface QueuedFeedback {
  id: string;
  title: string;
  description: string;
  metadata: FeedbackMetadata | null;
  screenshot: string | null;
  created_at: number;
  attempts: number;
  last_error?: string;
}

export interface IssueSubmitResult {
  success: boolean;
  issue_number?: number;
  issue_url?: string;
  image_url?: string;
}
