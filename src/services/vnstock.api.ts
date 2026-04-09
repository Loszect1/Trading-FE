import { normalizeError, postWithRetryCache } from "@/services/http-client";
import type {
  CandlePoint,
  CompanyNewsItem,
  CompanyOverview,
  FinancialRatioPoint,
  SymbolItem,
  TradeMetricRow,
  TradeStats,
} from "@/types/vnstock";

function pickArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  return [];
}

function pickObject<T>(value: unknown): T | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return null;
}

export async function getAllSymbols(): Promise<SymbolItem[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/listing/all-symbols",
      {},
      { cacheTtlMs: 30000, retries: 1 },
    );
    const raw = response?.data ?? response;
    const list = pickArray<Record<string, unknown>>(raw);

    return list.map((item) => ({
      symbol: String(item.symbol ?? item.code ?? ""),
      exchange: typeof item.exchange === "string" ? item.exchange : undefined,
      industry: typeof item.industry === "string" ? item.industry : undefined,
    }));
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCompanyOverview(symbol: string): Promise<CompanyOverview | null> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/company/overview",
      { symbol },
      { cacheTtlMs: 15000, retries: 1 },
    );
    const raw = response?.data ?? response;
    const itemFromArray = Array.isArray(raw) ? (raw[0] as Record<string, unknown> | undefined) : undefined;
    const item = itemFromArray ?? pickObject<Record<string, unknown>>(raw);
    if (!item) {
      return null;
    }

    return {
      symbol: String(item.symbol ?? symbol),
      id: typeof item.id === "string" ? item.id : undefined,
      company_name:
        typeof item.company_name === "string"
          ? item.company_name
          : typeof item.companyName === "string"
            ? item.companyName
            : undefined,
      exchange:
        typeof item.exchange === "string"
          ? item.exchange
          : typeof item.comGroupCode === "string"
            ? item.comGroupCode
            : undefined,
      industry:
        typeof item.industry === "string"
          ? item.industry
          : typeof item.icb_name4 === "string"
            ? item.icb_name4
            : undefined,
      market_cap:
        typeof item.market_cap === "number"
          ? item.market_cap
          : typeof item.marketCap === "number"
            ? item.marketCap
            : undefined,
      issue_share:
        typeof item.issue_share === "number"
          ? item.issue_share
          : typeof item.issueShare === "number"
            ? item.issueShare
            : undefined,
      financial_ratio_issue_share:
        typeof item.financial_ratio_issue_share === "number"
          ? item.financial_ratio_issue_share
          : undefined,
      charter_capital:
        typeof item.charter_capital === "number"
          ? item.charter_capital
          : typeof item.charterCapital === "number"
            ? item.charterCapital
            : undefined,
      icb_name2: typeof item.icb_name2 === "string" ? item.icb_name2 : undefined,
      icb_name3: typeof item.icb_name3 === "string" ? item.icb_name3 : undefined,
      icb_name4: typeof item.icb_name4 === "string" ? item.icb_name4 : undefined,
      company_profile:
        typeof item.company_profile === "string" ? item.company_profile : undefined,
      history: typeof item.history === "string" ? item.history : undefined,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getPriceHistory(symbol: string, interval = "1D"): Promise<CandlePoint[]> {
  const formatYmd = (date: Date): string => date.toISOString().slice(0, 10);
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 90);

  const payload = {
    symbol,
    show_log: false,
    method_kwargs: {
      interval,
      start: formatYmd(startDate),
      end: formatYmd(endDate),
    },
  };

  const mapHistoryRows = (raw: unknown): CandlePoint[] => {
    const list = pickArray<Record<string, unknown>>(raw);
    return list
      .map((item) => {
        const close = Number(item.close ?? item.price ?? item.avgPrice ?? 0);
        return {
          time: String(item.time ?? item.date ?? item.tradingDate ?? ""),
          open: Number(item.open ?? 0),
          high: Number(item.high ?? 0),
          low: Number(item.low ?? 0),
          close: Number.isNaN(close) ? 0 : close,
          volume: Number(item.volume ?? item.matchVolume ?? 0),
        };
      })
      .filter((item) => item.time.length > 0);
  };

  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/quote/history",
      payload,
      { cacheTtlMs: 10000, retries: 1 },
    );
    const raw = response?.data ?? response;
    return mapHistoryRows(raw);
  } catch (error) {
    throw normalizeError(error);
  }
}

function pickNewsUrl(item: Record<string, unknown>, depth = 0): string | undefined {
  const candidates = [
    item.news_source_link,
    item.newsSourceLink,
    item.url,
    item.link,
    item.href,
    item.newsUrl,
    item.news_url,
    item.articleUrl,
    item.article_url,
    item.postUrl,
    item.post_url,
    item.detailUrl,
    item.detail_url,
    item.sourceUrl,
    item.source_url,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (depth === 0) {
    const detail = item.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      return pickNewsUrl(detail as Record<string, unknown>, 1);
    }
  }
  return undefined;
}

function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return `https://${trimmed}`;
}

function pickNewsPublishedAt(item: Record<string, unknown>): string | undefined {
  const stringCandidates = [
    item.published_at,
    item.publishDate,
    item.publish_date,
    item.date,
    item.created_at,
    item.updated_at,
  ];
  for (const value of stringCandidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  const ts = item.public_date ?? item.publicDate ?? item.publishTime ?? item.publish_time;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    }
  }
  return undefined;
}

export async function getCompanyNews(symbol: string): Promise<CompanyNewsItem[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/company/news",
      { symbol },
      { cacheTtlMs: 15000, retries: 1 },
    );
    const raw = response?.data ?? response;
    const list = pickArray<Record<string, unknown>>(raw);

    return list
      .map((item) => {
        const rawUrl = pickNewsUrl(item);
        const url = rawUrl ? normalizeExternalUrl(rawUrl) : undefined;
        return {
          title: String(item.title ?? item.headline ?? item.news_title ?? "").trim(),
          published_at: pickNewsPublishedAt(item),
          source:
            typeof item.source === "string"
              ? item.source
              : typeof item.publisher === "string"
                ? item.publisher
                : typeof item.news_source === "string"
                  ? item.news_source
                  : undefined,
          url,
          summary:
            typeof item.summary === "string"
              ? item.summary
              : typeof item.content === "string"
                ? item.content
                : typeof item.news_short_content === "string"
                  ? item.news_short_content
                  : typeof item.newsShortContent === "string"
                    ? item.newsShortContent
                    : undefined,
        };
      })
      .filter((item) => item.title.length > 0)
      .slice(0, 20);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getFinancialRatioSummary(symbol: string): Promise<FinancialRatioPoint[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/financial/ratio",
      { symbol, source: "VCI", period: "quarter", get_all: true, method_kwargs: {} },
      { cacheTtlMs: 15000, retries: 1 },
    );

    const raw = response?.data ?? response;
    if (Array.isArray(raw)) {
      return raw as FinancialRatioPoint[];
    }

    const item = pickObject<Record<string, unknown>>(raw);
    return item ? [item as FinancialRatioPoint] : [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getTradingStats(symbol: string): Promise<TradeStats | null> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/trading/trading-stats",
      { symbol },
      { cacheTtlMs: 8000, retries: 1 },
    );
    const raw = response?.data ?? response;
    const item = pickObject<Record<string, unknown>>(raw);
    if (!item) {
      return null;
    }

    return {
      symbol: String(item.symbol ?? symbol),
      total_volume: Number(item.total_volume ?? 0),
      total_value: Number(item.total_value ?? 0),
      buy_volume: Number(item.buy_volume ?? 0),
      sell_volume: Number(item.sell_volume ?? 0),
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

function toMetricRows(raw: unknown): TradeMetricRow[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          label: String(row.label ?? row.name ?? row.side ?? ""),
          value: Number(row.value ?? row.volume ?? row.total ?? 0),
        };
      })
      .filter((item) => item.label.length > 0);
  }

  const obj = pickObject<Record<string, unknown>>(raw);
  if (!obj) {
    return [];
  }

  return Object.entries(obj)
    .map(([key, value]) => ({
      label: key,
      value: Number(value ?? 0),
    }))
    .filter((item) => !Number.isNaN(item.value));
}

export async function getSideStats(symbol: string): Promise<TradeMetricRow[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/trading/side-stats",
      { symbol },
      { cacheTtlMs: 8000, retries: 1 },
    );
    const raw = response?.data ?? response;
    return toMetricRows(raw);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getForeignTrade(symbol: string): Promise<TradeMetricRow[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/trading/foreign-trade",
      { symbol },
      { cacheTtlMs: 8000, retries: 1 },
    );
    const raw = response?.data ?? response;
    return toMetricRows(raw);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getPropTrade(symbol: string): Promise<TradeMetricRow[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/trading/prop-trade",
      { symbol },
      { cacheTtlMs: 8000, retries: 1 },
    );
    const raw = response?.data ?? response;
    return toMetricRows(raw);
  } catch (error) {
    throw normalizeError(error);
  }
}
