import { httpClient, normalizeError } from "@/services/http-client";
import type { AccountMode, MonitoringRuntimeLogRow, MonitoringSummary, RiskEventRow } from "@/types/operational";
import { getDnseAccessToken } from "@/lib/dnse-session";

export async function fetchMonitoringSummary(
  accountMode: AccountMode,
  options?: { subAccount?: string | null },
): Promise<MonitoringSummary> {
  try {
    const params = new URLSearchParams({ account_mode: accountMode });
    const subAccount = options?.subAccount?.trim();
    if (subAccount) {
      params.set("sub_account", subAccount);
    }
    const headers: Record<string, string> = {};
    if (accountMode === "REAL") {
      const token = getDnseAccessToken()?.trim();
      if (token) {
        headers["X-Dnse-Access-Token"] = token;
      }
    }
    const response = await httpClient.get<{ success: boolean; data: MonitoringSummary }>(
      `/monitoring/summary?${params.toString()}`,
      { headers },
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
