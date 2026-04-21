import { httpClient, normalizeError } from "@/services/http-client";
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
  source_message_ids: string[];
}

export interface MailSignalEntryRunData {
  redis_key: string;
  success: boolean;
  source_key: string;
  account_mode: string;
  scanned: number;
  executed: Array<{
    symbol: string;
    order_id?: string | null;
    status?: string | null;
    quantity?: number;
  }>;
  skipped: Array<Record<string, unknown>>;
  ran_at: string;
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
    const response = await httpClient.post<ShortTermCycleRunResponse>("/automation/short-term/run-cycle", body);
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
