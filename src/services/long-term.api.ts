import { API_REQUEST_TIMEOUT_MS, getWithRetryCache, httpClient, normalizeError, postWithRetryCache } from "@/services/http-client";
import type {
  LongTermAnalysisResult,
  LongTermRankingsResponse,
  LongTermScanResponse,
  MacroGptAnalysisResponse,
  MacroRegimeResponse,
} from "@/types/long-term";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function msUntilNextVietnamMidnight(): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const vietnamOffsetMs = 7 * 60 * 60 * 1000;
  const vietnamNowMs = Date.now() + vietnamOffsetMs;
  const nextVietnamMidnightMs = Math.floor(vietnamNowMs / msPerDay) * msPerDay + msPerDay;
  return Math.max(1000, nextVietnamMidnightMs - vietnamNowMs);
}

function longTermAnalysisCacheKey(symbol: string): string {
  return `long-term-analysis:v3:${symbol}`;
}

function readLongTermAnalysisCache(symbol: string): LongTermAnalysisResult | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(longTermAnalysisCacheKey(symbol));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { expiresAt?: unknown; data?: unknown };
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    if (expiresAt <= Date.now()) {
      window.localStorage.removeItem(longTermAnalysisCacheKey(symbol));
      return null;
    }
    const data = parsed.data as LongTermAnalysisResult | undefined;
    if (data?.symbol === symbol) {
      return data;
    }
  } catch {
    window.localStorage.removeItem(longTermAnalysisCacheKey(symbol));
  }
  return null;
}

function writeLongTermAnalysisCache(symbol: string, data: LongTermAnalysisResult): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      longTermAnalysisCacheKey(symbol),
      JSON.stringify({
        expiresAt: Date.now() + ONE_DAY_MS,
        data,
      }),
    );
  } catch {
    // Ignore storage failures; the in-memory request cache still handles the current session.
  }
}

export async function fetchMacroRegime(options?: { forceRefresh?: boolean }): Promise<MacroRegimeResponse> {
  const forceRefresh = options?.forceRefresh ?? false;
  try {
    return await getWithRetryCache<MacroRegimeResponse>("/market/macro-regime", {
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 800,
      cacheTtlMs: forceRefresh ? 0 : 60_000,
      skipCache: forceRefresh,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchMacroGptAnalysis(options?: {
  newsLimit?: number;
  observationLimit?: number;
  language?: "en" | "vi";
  forceRefresh?: boolean;
}): Promise<MacroGptAnalysisResponse> {
  const forceRefresh = options?.forceRefresh ?? false;
  try {
    return await postWithRetryCache<MacroGptAnalysisResponse>(
      "/macro/gpt-analysis",
      {
        news_limit: options?.newsLimit ?? 40,
        observation_limit: options?.observationLimit ?? 80,
        language: options?.language ?? "vi",
        force_refresh: forceRefresh,
      },
      {
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        retries: 0,
        cacheTtlMs: forceRefresh ? 0 : msUntilNextVietnamMidnight(),
        skipCache: forceRefresh,
      },
    );
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchLongTermRankings(params?: {
  runId?: string;
  limit?: number;
  rating?: string;
  sector?: string;
  forceRefresh?: boolean;
}): Promise<LongTermRankingsResponse> {
  const query = new URLSearchParams({
    limit: String(params?.limit ?? 100),
  });
  if (params?.runId) {
    query.set("run_id", params.runId);
  }
  if (params?.rating) {
    query.set("rating", params.rating);
  }
  if (params?.sector) {
    query.set("sector", params.sector);
  }
  try {
    return await getWithRetryCache<LongTermRankingsResponse>(`/strategy/long-term/rankings?${query.toString()}`, {
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 800,
      cacheTtlMs: params?.forceRefresh ? 0 : 60_000,
      skipCache: params?.forceRefresh ?? false,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function runLongTermScan(options?: {
  universeSize?: number;
  candidateLimit?: number;
}): Promise<LongTermScanResponse> {
  try {
    return await postWithRetryCache<LongTermScanResponse>(
      "/strategy/long-term/scans",
      {
        universe_size: options?.universeSize ?? 100,
        candidate_limit: options?.candidateLimit ?? 400,
      },
      {
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        retries: 0,
        cacheTtlMs: 0,
        skipCache: true,
      },
    );
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function analyzeLongTermSymbol(symbol: string): Promise<LongTermAnalysisResult> {
  const normalized = symbol.trim().toUpperCase();
  const cached = readLongTermAnalysisCache(normalized);
  if (cached) {
    return cached;
  }
  try {
    const data = await postWithRetryCache<LongTermAnalysisResult>(
      `/stocks/${encodeURIComponent(normalized)}/long-term-analysis`,
      {},
      {
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        retries: 0,
        cacheTtlMs: ONE_DAY_MS,
      },
    );
    writeLongTermAnalysisCache(normalized, data);
    return data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchLongTermScore(symbol: string): Promise<LongTermAnalysisResult> {
  const normalized = symbol.trim().toUpperCase();
  try {
    const response = await httpClient.get<LongTermAnalysisResult>(
      `/stocks/${encodeURIComponent(normalized)}/long-term-score`,
      { timeout: API_REQUEST_TIMEOUT_MS },
    );
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}
