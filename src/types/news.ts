export type NewsCategoryParam = "all" | "domestic" | "world" | "social";

export interface NewsFeedItem {
  title: string;
  link: string;
  summary?: string;
  published_at?: string;
  source_id?: string;
  source_name?: string;
  category?: string;
  item_origin?: string;
}

export interface NewsListResponse {
  category?: string;
  per_feed_limit?: number;
  limit?: number;
  use_firecrawl?: boolean;
  use_firecrawl_rss_fallback?: boolean;
  count?: number;
  items?: NewsFeedItem[];
  fetched_at?: string;
  feed_errors?: Record<string, unknown>;
}
