import { httpClient, normalizeError } from "@/services/http-client";
import type { AccountMode, MonitoringRuntimeLogRow, MonitoringSummary, RiskEventRow } from "@/types/operational";

export async function fetchMonitoringSummary(accountMode: AccountMode): Promise<MonitoringSummary> {
  try {
    const response = await httpClient.get<{ success: boolean; data: MonitoringSummary }>(
      `/monitoring/summary?account_mode=${encodeURIComponent(accountMode)}`,
    );
    if (!response.data.data) {
      throw new Error("Monitoring summary response missing data");
    }
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function listRiskEvents(accountMode: AccountMode, limit = 100): Promise<RiskEventRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: RiskEventRow[] }>(
      `/risk/events?account_mode=${encodeURIComponent(accountMode)}&limit=${encodeURIComponent(limit)}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function listRuntimeLogs(accountMode: AccountMode, limit = 150): Promise<MonitoringRuntimeLogRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: MonitoringRuntimeLogRow[] }>(
      `/monitoring/runtime-logs?account_mode=${encodeURIComponent(accountMode)}&limit=${encodeURIComponent(limit)}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}
