import { API_REQUEST_TIMEOUT_MS, getWithRetryCache, postWithRetryCache } from "@/services/http-client";
import type {
  MorningBriefResponse,
  NewsBySymbolResponse,
  NewsCategoryParam,
  NewsMailArticlesResponse,
  NewsMailRefreshResponse,
  NewsListResponse,
  NewsMailTodayResponse,
  NewsMailTopImpactResponse,
  WatchlistAlertsResponse,
} from "@/types/news";

const DEFAULT_PER_FEED = 5;
const DEFAULT_LIMIT = 120;

function buildNewsQuery(category: NewsCategoryParam): string {
  const params = new URLSearchParams({
    category,
    per_feed_limit: String(DEFAULT_PER_FEED),
    limit: String(DEFAULT_LIMIT),
    use_firecrawl: "true",
    use_firecrawl_rss_fallback: "true",
  });
  return `/news?${params.toString()}`;
}

export async function fetchAggregatedNews(
  category: NewsCategoryParam,
  options?: { forceRefresh?: boolean },
): Promise<NewsListResponse> {
  const path = buildNewsQuery(category);
  const forceRefresh = options?.forceRefresh ?? false;
  const queryPath = forceRefresh ? `${path}&force_refresh=true` : path;

  return getWithRetryCache<NewsListResponse>(queryPath, {
    timeoutMs: API_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: forceRefresh ? 0 : 60_000,
    skipCache: forceRefresh,
  });
}

interface MailNewsFetchOptions {
  forceRefresh?: boolean;
}

function mailCacheOptions(options?: MailNewsFetchOptions): {
  cacheTtlMs: number;
  skipCache: boolean;
} {
  const forceRefresh = options?.forceRefresh ?? false;
  return {
    cacheTtlMs: forceRefresh ? 0 : 60_000,
    skipCache: forceRefresh,
  };
}

export async function fetchMailNewsToday(
  options?: MailNewsFetchOptions,
): Promise<NewsMailTodayResponse> {
  const cache = mailCacheOptions(options);
  return getWithRetryCache<NewsMailTodayResponse>("/news/today?limit=120", {
    timeoutMs: API_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: cache.cacheTtlMs,
    skipCache: cache.skipCache,
  });
}

export async function fetchMailNewsArticles(
  params: {
    limit: number;
    offset: number;
    category?: string;
    symbol?: string;
  },
  options?: MailNewsFetchOptions,
): Promise<NewsMailArticlesResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(Math.max(0, params.offset)),
  });
  const category = params.category?.trim();
  const symbol = params.symbol?.trim().toUpperCase();
  if (category && category !== "all") {
    query.set("category", category);
  }
  if (symbol) {
    query.set("symbol", symbol);
  }
  const cache = mailCacheOptions(options);
  return getWithRetryCache<NewsMailArticlesResponse>(`/news/mail/articles?${query.toString()}`, {
    timeoutMs: API_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: cache.cacheTtlMs,
    skipCache: cache.skipCache,
  });
}

export async function refreshMailNewsFromGmail(): Promise<NewsMailRefreshResponse> {
  return postWithRetryCache<NewsMailRefreshResponse>(
    "/news/mail/refresh",
    {
      max_results: 5,
      article_fetch_limit: 100,
    },
    {
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      retries: 0,
      cacheTtlMs: 0,
      skipCache: true,
    },
  );
}

export async function fetchMailNewsTopImpact(
  limit = 20,
  options?: MailNewsFetchOptions,
): Promise<NewsMailTopImpactResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const cache = mailCacheOptions(options);
  return getWithRetryCache<NewsMailTopImpactResponse>(`/news/top-impact?${params.toString()}`, {
    timeoutMs: API_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: cache.cacheTtlMs,
    skipCache: cache.skipCache,
  });
}

export async function fetchNewsBySymbol(symbol: string, limit = 50): Promise<NewsBySymbolResponse> {
  const normalized = symbol.trim().toUpperCase();
  const params = new URLSearchParams({ limit: String(limit) });
  return getWithRetryCache<NewsBySymbolResponse>(
    `/news/by-symbol/${encodeURIComponent(normalized)}?${params.toString()}`,
    {
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 800,
      cacheTtlMs: 60_000,
      skipCache: normalized.length === 0,
    },
  );
}

export async function fetchMorningBrief(
  options?: MailNewsFetchOptions,
): Promise<MorningBriefResponse> {
  const cache = mailCacheOptions(options);
  return getWithRetryCache<MorningBriefResponse>("/market/morning-brief?limit=12", {
    timeoutMs: API_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: cache.cacheTtlMs,
    skipCache: cache.skipCache,
  });
}

export async function fetchWatchlistAlerts(
  symbols: string[],
  options?: MailNewsFetchOptions,
): Promise<WatchlistAlertsResponse> {
  const normalized = Array.from(
    new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean)),
  );
  const params = new URLSearchParams({
    symbols: normalized.join(","),
    limit: "80",
  });
  return getWithRetryCache<WatchlistAlertsResponse>(
    `/watchlist/local/alerts?${params.toString()}`,
    {
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 800,
      cacheTtlMs: options?.forceRefresh ? 0 : 60_000,
      skipCache: normalized.length === 0 || (options?.forceRefresh ?? false),
    },
  );
}
