import { API_NO_TIMEOUT_MS, httpClient, normalizeError } from "@/services/http-client";
import type { SchedulerStateRow, SchedulerStatus } from "@/types/operational";

export type ShortTermExchangeScope = "ALL" | "HOSE" | "HNX" | "UPCOM";

/** Display / grouping order for short-term run logs (ALL = full-universe cycles). */
export const SHORT_TERM_RUN_LOG_SCOPE_ORDER: readonly ShortTermExchangeScope[] = ["ALL", "HOSE", "HNX", "UPCOM"];

export type ShortTermRunLogScopeBucket = ShortTermExchangeScope | "OTHER";

export interface ShortTermAutomationRunRow {
  id: string;
  started_at: string;
  finished_at: string;
  run_status: string;
  scanned: number;
  buy_candidates: number;
  risk_rejected: number;
  executed: number;
  execution_rejected: number;
  errors: number;
  detail: Record<string, unknown>;
}

/**
 * Reads `exchange_scope` from a run row's `detail` (BE short-term automation).
 * Returns null when missing or not one of the known scopes.
 */
export function parseShortTermRunExchangeScope(detail: Record<string, unknown> | undefined): ShortTermExchangeScope | null {
  if (!detail) {
    return null;
  }
  const raw = detail.exchange_scope;
  if (typeof raw !== "string") {
    return null;
  }
  const upper = raw.trim().toUpperCase();
  if (upper === "ALL" || upper === "HOSE" || upper === "HNX" || upper === "UPCOM") {
    return upper;
  }
  return null;
}

export function shortTermRunLogScopeBucket(detail: Record<string, unknown> | undefined): ShortTermRunLogScopeBucket {
  return parseShortTermRunExchangeScope(detail) ?? "OTHER";
}

export interface ShortTermCycleRunRequest {
  exchange_scope?: ShortTermExchangeScope;
  account_mode?: "REAL" | "DEMO";
  limit_symbols?: number;
  enforce_vn_scan_schedule?: boolean;
  async_for_heavy?: boolean;
  demo_session_id?: string;
  real_account_available_cash_vnd?: number;
}

export interface ShortTermCycleRunResponse {
  success: boolean;
  run_id?: string | null;
  run_status: string;
  scanned: number;
  buy_candidates: number;
  risk_rejected: number;
  executed: number;
  execution_rejected: number;
  errors: number;
  detail: Record<string, unknown>;
}

export interface ShortTermAsyncJobStatus {
  job_id: string;
  status: "QUEUED" | "RUNNING" | "FINISHED" | "FAILED";
  started_at: string;
  finished_at: string | null;
  result: ShortTermCycleRunResponse | null;
  error: string | null;
  exchange_scope: string;
  account_mode: string;
  limit_symbols: number;
}

export interface MailSignalPick {
  symbol: string;
  entry: number;
  take_profit: number;
  stop_loss: number;
  confidence: number;
  reason: string;
}

export interface MailSignalsData {
  redis_key?: string;
  success: boolean;
  query: string;
  mail_count: number;
  items: MailSignalPick[];
  generated_at: string;
  source?: string;
  source_message_ids?: string[];
  note?: string;
  latest_empty_redis_key?: string;
  latest_empty_note?: string;
  latest_empty_generated_at?: string;
}

export interface MailSignalEntryRunData {
  redis_key: string;
  success: boolean;
  source_key: string;
  account_mode: string;
  demo_session_id?: string | null;
  scanned: number;
  executed: Array<{
    symbol: string;
    order_id?: string | null;
    status?: string | null;
    quantity?: number;
  }>;
  skipped: Array<Record<string, unknown>>;
  ran_at: string;
  error?: string | null;
  effective_nav_vnd?: number;
}

export interface MailSignalEntryRunsResponse {
  data: MailSignalEntryRunData[];
  limit: number;
}

export interface MailSignalEntryRunOnceRequest {
  account_mode?: "REAL" | "DEMO";
  demo_session_id?: string;
  real_account_available_cash_vnd?: number;
}

export interface RealRecommendationRow {
  symbol: string;
  entry: number;
  take_profit: number;
  stop_loss: number;
  confidence: number;
  reason: string;
  reward_risk?: number | null;
  risk_status?: "BUYABLE" | "PREFLIGHT_OK" | "REJECTED" | "UNKNOWN" | string;
  risk_reason?: string;
  suggested_quantity?: number;
  suggested_notional?: number;
  setup_type?: string | null;
  setup?: Record<string, unknown>;
  freshness?: Record<string, unknown>;
  relative_strength?: Record<string, unknown>;
  sector_breadth?: Record<string, unknown>;
  settlement_pressure?: Record<string, unknown>;
  account_preflight?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RealWatchCandidateRow {
  symbol: string;
  exchange?: string;
  watch_status?: "WATCH" | string;
  scan_reason?: string;
  reason?: string;
  entry?: number;
  take_profit?: number;
  stop_loss?: number;
  reward_risk?: number | null;
  setup_type?: string | null;
  momentum_5d_pct?: number;
  rsi14?: number;
  distance_from_ema20_pct?: number;
  spike_ratio?: number;
  composite?: number;
  floor?: number;
  daily_return_pct?: number;
  detail?: Record<string, unknown>;
}

export interface ShortTermScanDiagnostics {
  skipped_insufficient_data?: number;
  skipped_low_liquidity?: number;
  skipped_no_volume_spike?: number;
  skipped_entry_gate?: number;
  skipped_experience_cooldown?: number;
  skipped_dynamic_buy_floor?: number;
  skipped_stale_data?: number;
  price_history_cache_hits?: number;
  price_history_vnstock_calls?: number;
  price_history_missing?: number;
  dynamic_buy_composite_floor?: number;
  buy_signals_written?: number;
  rejected_candidates?: Array<Record<string, unknown>>;
}

export interface RealRecommendationsData {
  generated_at?: string | null;
  exchange_scope?: ShortTermExchangeScope | string;
  limit_symbols?: number;
  scanned: number;
  recommendations: RealRecommendationRow[];
  count: number;
  short_term_recommendations?: RealRecommendationRow[];
  short_term_count?: number;
  all_short_term_recommendations?: RealRecommendationRow[];
  rejected_recommendations?: RealRecommendationRow[];
  rejected_count?: number;
  watch_candidates?: RealWatchCandidateRow[];
  watch_count?: number;
  mail_signal_recommendations?: RealRecommendationRow[];
  mail_signal_count?: number;
  scan_diagnostics?: ShortTermScanDiagnostics | null;
}

export interface RealRecommendationsRecentRow extends RealRecommendationsData {
  redis_key: string;
}

export interface RealRecommendationScanRequest {
  exchange_scope?: ShortTermExchangeScope;
  limit_symbols?: number;
  real_account_available_cash_vnd?: number;
}

export interface RealRecommendationActionBuyRequest extends RealRecommendationRow {
  available_cash_vnd: number;
  order_price?: number;
  quantity?: number;
}

export interface LiquidityEligibleCacheRow {
  symbol: string;
  exchange: "HOSE" | "HNX" | "UPCOM" | string;
  baseline_vol: number;
  latest_vol: number;
  spike_ratio: number;
  eligible_liquidity: boolean;
  eligible_spike: boolean;
  regular_liquidity?: boolean | null;
  liquidity_detail?: Record<string, unknown>;
  redis_key: string;
}

export interface LiquidityEligibleCacheResponse {
  data: LiquidityEligibleCacheRow[];
  meta: {
    exchange_scope: ShortTermExchangeScope;
    limit: number;
    total_matched: number;
    returned: number;
  };
}

export interface DemoPortfolioReviewRunData {
  success: boolean;
  run_id?: string;
  run_status: string;
  session_id?: string | null;
  holdings_count: number;
  applied_count: number;
  skipped_count: number;
  detail?: Record<string, unknown>;
  error?: string | null;
}

export async function fetchSchedulerStatus(accountMode: "REAL" | "DEMO"): Promise<SchedulerStatus> {
  try {
    const response = await httpClient.get<SchedulerStatus>(
      `/automation/scheduler/status?account_mode=${encodeURIComponent(accountMode)}`,
    );
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function toggleScheduler(accountMode: "REAL" | "DEMO", enabled: boolean): Promise<SchedulerStatus> {
  try {
    const response = await httpClient.post<SchedulerStatus>("/automation/scheduler/toggle", {
      account_mode: accountMode,
      enabled,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function toggleRealScanOnlyScheduler(enabled: boolean): Promise<SchedulerStatus & { mode?: string }> {
  try {
    const response = await httpClient.post<SchedulerStatus & { mode?: string }>("/automation/scheduler/real-scan-only/toggle", {
      enabled,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchRealScanOnlySchedulerStatus(): Promise<SchedulerStatus & { mode?: string }> {
  try {
    const response = await httpClient.get<SchedulerStatus & { mode?: string }>("/automation/scheduler/real-scan-only/status");
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchSchedulerStateRows(): Promise<SchedulerStateRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: SchedulerStateRow[] }>("/automation/scheduler/state");
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function setSchedulerDemoSession(demoSessionId: string | null): Promise<string | null> {
  try {
    const response = await httpClient.post<{ success: boolean; data: { active_demo_session_id: string | null } }>(
      "/automation/scheduler/demo-session",
      { demo_session_id: demoSessionId },
    );
    return response.data.data?.active_demo_session_id ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchSchedulerDemoSession(): Promise<string | null> {
  try {
    const response = await httpClient.get<{ success: boolean; data: { active_demo_session_id: string | null } }>(
      "/automation/scheduler/demo-session",
    );
    return response.data.data?.active_demo_session_id ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchShortTermRuns(
  accountMode: "REAL" | "DEMO",
  limit = 10,
): Promise<ShortTermAutomationRunRow[]> {
  try {
    const response = await httpClient.get<{
      success: boolean;
      data: ShortTermAutomationRunRow[];
    }>(`/automation/short-term/runs?limit=${encodeURIComponent(limit)}&account_mode=${encodeURIComponent(accountMode)}`);
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postShortTermRunCycle(body: ShortTermCycleRunRequest): Promise<ShortTermCycleRunResponse> {
  try {
    const response = await httpClient.post<ShortTermCycleRunResponse>("/automation/short-term/run-cycle", body, {
      timeout: API_NO_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchShortTermAsyncJob(jobId: string): Promise<ShortTermAsyncJobStatus> {
  try {
    const response = await httpClient.get<{ success: boolean; data: ShortTermAsyncJobStatus }>(
      `/automation/short-term/async-job/${encodeURIComponent(jobId)}`,
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchMailSignalsLatest(): Promise<MailSignalsData | null> {
  try {
    const response = await httpClient.get<{ success: boolean; data: MailSignalsData | null }>(
      "/automation/mail-signals/latest",
    );
    return response.data.data ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postMailSignalsRunOnce(): Promise<MailSignalsData | null> {
  try {
    const response = await httpClient.post<{ success: boolean; data: MailSignalsData | null }>(
      "/automation/mail-signals/run-once",
      {},
      { timeout: API_NO_TIMEOUT_MS },
    );
    return response.data.data ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchMailSignalEntryRunLatest(): Promise<MailSignalEntryRunData | null> {
  try {
    const response = await httpClient.get<{ success: boolean; data: MailSignalEntryRunData | null }>(
      "/automation/mail-signals/entry-run/latest",
    );
    return response.data.data ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchMailSignalEntryRunsRecent(
  limit = 10,
  options?: { demoSessionId?: string | null },
): Promise<MailSignalEntryRunsResponse> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    const demoSessionId = options?.demoSessionId?.trim();
    if (demoSessionId) {
      params.set("demo_session_id", demoSessionId);
    }
    const response = await httpClient.get<{ success: boolean; data: MailSignalEntryRunData[]; limit: number }>(
      `/automation/mail-signals/entry-run/recent?${params.toString()}`,
    );
    return {
      data: response.data.data ?? [],
      limit: Number(response.data.limit ?? limit),
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postMailSignalEntryRunOnce(
  body: MailSignalEntryRunOnceRequest,
): Promise<MailSignalEntryRunData | null> {
  try {
    const response = await httpClient.post<{ success: boolean; data: MailSignalEntryRunData | null }>(
      "/automation/mail-signals/entry-run-once",
      body,
      { timeout: API_NO_TIMEOUT_MS },
    );
    return response.data.data ?? null;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchShortTermLiquidityEligibleCache(
  exchangeScope: ShortTermExchangeScope = "ALL",
  limit = 300,
): Promise<LiquidityEligibleCacheResponse> {
  try {
    const response = await httpClient.get<{
      success: boolean;
      data: LiquidityEligibleCacheRow[];
      meta: LiquidityEligibleCacheResponse["meta"];
    }>(
      `/automation/short-term/cache-eligible?exchange_scope=${encodeURIComponent(exchangeScope)}&limit=${encodeURIComponent(limit)}&latest_only=false`,
    );
    return {
      data: response.data.data ?? [],
      meta: response.data.meta,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postShortTermPostCloseRefreshRunOnce(): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<{ success: boolean; data: Record<string, unknown> }>(
      "/automation/short-term/post-close-refresh/run-once",
      {},
      { timeout: API_NO_TIMEOUT_MS },
    );
    return response.data.data ?? {};
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postDemoPortfolioReviewRunOnce(demoSessionId?: string): Promise<DemoPortfolioReviewRunData> {
  try {
    const body = demoSessionId?.trim() ? { demo_session_id: demoSessionId.trim() } : {};
    const response = await httpClient.post<{ success: boolean; data: DemoPortfolioReviewRunData }>(
      "/automation/demo-portfolio-review/run-once",
      body,
      { timeout: API_NO_TIMEOUT_MS },
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postRealRecommendationsScan(body: RealRecommendationScanRequest): Promise<RealRecommendationsData> {
  try {
    const response = await httpClient.post<{ success: boolean; data: RealRecommendationsData }>(
      "/automation/real/recommendations/scan",
      body,
      { timeout: API_NO_TIMEOUT_MS },
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchRealRecommendationsLatest(): Promise<RealRecommendationsData> {
  try {
    const response = await httpClient.get<{ success: boolean; data: RealRecommendationsData }>(
      "/automation/real/recommendations/latest",
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchRealRecommendationsRecent(limit = 10): Promise<RealRecommendationsRecentRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: RealRecommendationsRecentRow[] }>(
      `/automation/real/recommendations/recent?limit=${encodeURIComponent(String(limit))}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function postRealRecommendationActionBuy(body: RealRecommendationActionBuyRequest): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>("/automation/real/recommendations/action-buy", body, {
      timeout: API_NO_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}
