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

export interface NewsMailRun {
  id: string;
  run_date: string;
  source_query: string;
  status: string;
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
  article_count?: number;
  fetched_count?: number;
  failed_count?: number;
}

export interface NewsMailImpact {
  impact_id?: string;
  id?: string;
  article_id?: string;
  symbol: string;
  company_name?: string | null;
  known_symbol?: boolean;
  relevance_score?: number;
  sentiment_label?: "positive" | "negative" | "neutral" | "mixed" | string;
  sentiment_score?: number;
  impact_score?: number;
  impact_horizon?: string | null;
  confidence?: number;
  rationale?: string | null;
  title?: string | null;
  codex_summary?: string | null;
  article_excerpt?: string | null;
  url?: string | null;
  source_host?: string | null;
  category?: string | null;
  category_slug?: string | null;
  run_date?: string;
  article_title?: string | null;
}

export interface NewsMailArticle {
  article_id: string;
  run_id?: string;
  run_date?: string;
  run_status?: string;
  section_index?: number;
  section_title?: string | null;
  url: string;
  source_host?: string | null;
  category?: string | null;
  category_slug?: string | null;
  fetch_status?: string;
  fetch_error?: string | null;
  title?: string | null;
  article_excerpt?: string | null;
  codex_summary?: string | null;
  key_points?: string[];
  sector_tags?: string[];
  market_tags?: string[];
  data_gaps?: string[];
  updated_at?: string;
  impacts?: NewsMailImpact[];
}

export interface NewsMailArticlesResponse {
  items: NewsMailArticle[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
  category?: string;
  symbol?: string | null;
  has_previous?: boolean;
  has_next?: boolean;
}

export interface NewsMailRefreshResponse {
  success: boolean;
  run: NewsMailRun;
  articles: NewsMailArticle[];
  new_article_count: number;
  duplicate_skipped_count: number;
  empty_skipped_count?: number;
  links_scanned?: number;
  workflow?: {
    analysis_source?: string;
    analysis_status?: string;
    analysis_article_count?: number;
    analysis_batch_count?: number;
    updated_articles?: number;
    written_impacts?: number;
  };
}

export interface NewsMailTodayResponse {
  run: NewsMailRun | null;
  articles: NewsMailArticle[];
  count: number;
}

export interface NewsMailTopImpactResponse {
  items: NewsMailImpact[];
  count: number;
  sentiment?: string | null;
}

export interface NewsBySymbolResponse {
  symbol: string;
  items: NewsMailImpact[];
  count: number;
}

export interface MorningBriefResponse {
  run: NewsMailRun | null;
  article_count: number;
  impact_count: number;
  top_impacts: NewsMailImpact[];
  positive_count: number;
  negative_count: number;
  brief?: {
    positive?: NewsMailImpact[];
    negative?: NewsMailImpact[];
    watch?: NewsMailImpact[];
  };
}

export interface WatchlistAlertsResponse {
  watchlist_id: string;
  symbols: string[];
  items: NewsMailImpact[];
  count: number;
}
