import { getWithRetryCache, normalizeError, postWithRetryCache } from "@/services/http-client";
import type {
  AiAnalyzeSymbolResult,
  AiDataCompleteness,
  AiStructuredAnalysis,
  CandlePoint,
  ChartHistoryRange,
  CompanyNewsItem,
  CompanyOverview,
  FinancialRatioPeriod,
  FinancialRatioPoint,
  MarketScannerItem,
  MarketScannerResult,
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

/** Bảng listing từ BE: `{ success, data: [...] }` hoặc mảng trực tiếp. */
function extractListingTableRows(response: unknown): Record<string, unknown>[] {
  if (!response || typeof response !== "object") {
    return [];
  }
  const record = response as Record<string, unknown>;
  const payload = record.data !== undefined ? record.data : response;
  return pickArray<Record<string, unknown>>(payload);
}

function resolveExchangeField(item: Record<string, unknown>): string | undefined {
  const candidates = [item.exchange, item.board, item.com_group_code, item.comGroupCode];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().toUpperCase();
    }
  }
  return undefined;
}

function resolveIndustryField(item: Record<string, unknown>): string | undefined {
  const candidates = [
    item.industry_name,
    item.industryName,
    item.icb_name4,
    item.icbName4,
    item.industry,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function isLikelyStockListingRow(item: Record<string, unknown>): boolean {
  const typeValue = item.type;
  if (typeValue === undefined || typeValue === null) {
    return true;
  }
  const normalized = String(typeValue).trim().toUpperCase();
  if (normalized.length === 0) {
    return true;
  }
  return normalized === "STOCK";
}

/**
 * Danh sách mã có sàn + ngành: KBS `all_symbols` không trả exchange/industry,
 * nên gọi `symbols-by-exchange` và `symbols-by-industries` rồi ghép theo mã.
 */
export async function getAllSymbols(options?: { forceRefresh?: boolean }): Promise<SymbolItem[]> {
  const forceRefresh = options?.forceRefresh ?? false;
  const listingPayload = {
    source: "KBS",
    random_agent: false,
    show_log: false,
    force_refresh: forceRefresh,
  };
  const cacheOpts = {
    cacheTtlMs: 300_000,
    retries: 2,
    retryDelayMs: 800,
    timeoutMs: 60_000,
    skipCache: forceRefresh,
  };

  const [exchangeResult, industryResult] = await Promise.allSettled([
    postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/listing/symbols-by-exchange",
      { ...listingPayload, method_kwargs: {} },
      cacheOpts,
    ),
    postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/listing/symbols-by-industries",
      { ...listingPayload, method_kwargs: { lang: "vi" } },
      cacheOpts,
    ),
  ]);

  if (exchangeResult.status === "rejected") {
    throw normalizeError(exchangeResult.reason);
  }

  const exchangeRows = extractListingTableRows(exchangeResult.value);
  const industryBySymbol = new Map<string, string>();
  if (industryResult.status === "fulfilled") {
    const industryRows = extractListingTableRows(industryResult.value);
    for (const row of industryRows) {
      const symbol = String(row.symbol ?? row.code ?? "")
        .trim()
        .toUpperCase();
      if (!symbol) {
        continue;
      }
      const industry = resolveIndustryField(row);
      if (industry && !industryBySymbol.has(symbol)) {
        industryBySymbol.set(symbol, industry);
      }
    }
  }

  const merged: SymbolItem[] = [];
  const seen = new Set<string>();

  for (const item of exchangeRows) {
    if (!isLikelyStockListingRow(item)) {
      continue;
    }
    const symbol = String(item.symbol ?? item.code ?? "")
      .trim()
      .toUpperCase();
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    merged.push({
      symbol,
      exchange: resolveExchangeField(item),
      industry: industryBySymbol.get(symbol),
    });
  }

  merged.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return merged;
}

function parseSymbolsGroupPayload(payload: unknown): string[] {
  const out: string[] = [];
  if (payload == null) {
    return out;
  }

  if (Array.isArray(payload)) {
    for (const element of payload) {
      if (typeof element === "string" && element.trim().length > 0) {
        out.push(element.trim().toUpperCase());
      } else if (element && typeof element === "object" && !Array.isArray(element)) {
        const record = element as Record<string, unknown>;
        const sym = record.symbol ?? record.code;
        if (typeof sym === "string" && sym.trim().length > 0) {
          out.push(sym.trim().toUpperCase());
        }
      }
    }
    return out;
  }

  if (typeof payload === "object" && !Array.isArray(payload)) {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim().length > 0) {
        out.push(value.trim().toUpperCase());
      }
    }
  }

  return out;
}

/** Danh sách mã theo nhóm KBS (VN30, HOSE, HNX, UPCOM, …). */
export async function getSymbolsByGroup(group: string): Promise<string[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/listing/symbols-by-group",
      { method_kwargs: { group } },
      { cacheTtlMs: 86_400_000, retries: 2, retryDelayMs: 800, timeoutMs: 20_000 },
    );
    const payload = response?.data ?? response;
    return parseSymbolsGroupPayload(payload);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCompanyOverview(symbol: string): Promise<CompanyOverview | null> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/company/overview",
      { symbol },
      { cacheTtlMs: 15000, retries: 3, retryDelayMs: 800 },
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

function chartRangeToStartDate(endDate: Date, range: ChartHistoryRange): Date {
  const startDate = new Date(endDate);
  if (range === "3M") {
    startDate.setMonth(startDate.getMonth() - 3);
    return startDate;
  }
  if (range === "1Y") {
    startDate.setFullYear(startDate.getFullYear() - 1);
    return startDate;
  }
  startDate.setFullYear(startDate.getFullYear() - 25);
  return startDate;
}

export async function getPriceHistory(
  symbol: string,
  interval = "1D",
  range: ChartHistoryRange = "3M",
): Promise<CandlePoint[]> {
  const formatYmd = (date: Date): string => date.toISOString().slice(0, 10);
  const endDate = new Date();
  const startDate = chartRangeToStartDate(endDate, range);

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
      { cacheTtlMs: 10000, retries: 3, retryDelayMs: 800 },
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
      { cacheTtlMs: 15000, retries: 3, retryDelayMs: 800 },
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

export async function getFinancialRatioSummary(
  symbol: string,
  period: FinancialRatioPeriod = "year",
): Promise<FinancialRatioPoint[]> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/vnstock-api/financial/ratio",
      { symbol, source: "VCI", period, get_all: true, method_kwargs: {} },
      { cacheTtlMs: 15000, retries: 3, retryDelayMs: 800 },
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

export async function analyzeSymbolWithAi(
  symbol: string,
  interval = "1D",
  lookbackDays = 90,
): Promise<AiAnalyzeSymbolResult> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/ai/analyze-symbol",
      {
        symbol,
        interval,
        lookback_days: lookbackDays,
        source: "VCI",
        model: "claude-sonnet-4-6",
        max_tokens: 5000,
        temperature: 0.2,
      },
      { cacheTtlMs: 24 * 60 * 60 * 1000, retries: 0, timeoutMs: 600000 },
    );
    const raw = response?.data ?? response;
    const item = pickObject<Record<string, unknown>>(raw);
    const analysis = item?.analysis;
    const structuredRaw = item?.analysis_structured;
    const completenessRaw = item?.data_completeness;
    if (typeof analysis === "string" && analysis.trim().length > 0) {
      return {
        analysis: analysis.trim(),
        structured: pickObject<AiStructuredAnalysis>(structuredRaw),
        dataCompleteness: pickObject<AiDataCompleteness>(completenessRaw),
      };
    }
    throw new Error("AI returned empty analysis");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function analyzeSymbolWithAiShortTechnical(
  symbol: string,
  interval = "1D",
  lookbackDays = 90,
): Promise<string> {
  try {
    const response = await postWithRetryCache<Record<string, unknown>>(
      "/ai/analyze-symbol-short",
      {
        symbol,
        interval,
        lookback_days: lookbackDays,
        source: "VCI",
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        temperature: 0.2,
      },
      { cacheTtlMs: 24 * 60 * 60 * 1000, retries: 0, timeoutMs: 600000 },
    );
    const raw = response?.data ?? response;
    const item = pickObject<Record<string, unknown>>(raw);
    const analysis = item?.analysis;
    if (typeof analysis === "string" && analysis.trim().length > 0) {
      return analysis.trim();
    }
    throw new Error("AI returned empty short analysis");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getMarketScannerTop(
  days = 7,
  topN = 5,
  forceRefresh = false,
  useAi = false,
): Promise<MarketScannerResult> {
  try {
    const response = await getWithRetryCache<Record<string, unknown>>(
      `/market/scanner-top?days=${encodeURIComponent(days)}&top_n=${encodeURIComponent(topN)}&force_refresh=${forceRefresh ? "true" : "false"}&use_ai=${useAi ? "true" : "false"}&max_scan_per_exchange=20`,
      { cacheTtlMs: forceRefresh ? 0 : 24 * 60 * 60 * 1000, retries: 0, timeoutMs: 120000 },
    );
    const raw = response?.data ?? response;
    const item = pickObject<Record<string, unknown>>(raw);
    if (!item) {
      throw new Error("Invalid scanner response");
    }

    const byExchangeRaw = pickObject<Record<string, unknown>>(item.by_exchange) ?? {};
    const by_exchange: Record<string, MarketScannerItem[]> = {};
    for (const [exchange, value] of Object.entries(byExchangeRaw)) {
      const rows = pickArray<Record<string, unknown>>(value).map((row) => ({
        symbol: String(row.symbol ?? ""),
        exchange: String(row.exchange ?? exchange),
        turnover_window: Number(row.turnover_window ?? row.turnover_7d ?? 0),
        avg_volume_window: Number(row.avg_volume_window ?? row.avg_volume_7d ?? 0),
        latest_volume: Number(row.latest_volume ?? 0),
        baseline_avg_volume: Number(row.baseline_avg_volume ?? 0),
        volume_spike_ratio: Number(row.volume_spike_ratio ?? 0),
        spike_score: Number(row.spike_score ?? 0),
        close_latest: Number(row.close_latest ?? 0),
      }));
      by_exchange[exchange] = rows.filter((row) => row.symbol.length > 0);
    }

    return {
      scanned_days: Number(item.scanned_days ?? days),
      as_of: String(item.as_of ?? ""),
      by_exchange,
      ai_risk_by_exchange:
        pickObject<Record<string, Record<string, string>>>(item.ai_risk_by_exchange) ?? undefined,
      ai_reasoning_by_exchange:
        pickObject<Record<string, string>>(item.ai_reasoning_by_exchange) ?? undefined,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
