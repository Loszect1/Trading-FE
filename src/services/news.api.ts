import { getWithRetryCache } from "@/services/http-client";
import type { NewsCategoryParam, NewsListResponse } from "@/types/news";

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
    timeoutMs: 90000,
    retries: 1,
    retryDelayMs: 800,
    cacheTtlMs: forceRefresh ? 0 : 60_000,
    skipCache: forceRefresh,
  });
}
