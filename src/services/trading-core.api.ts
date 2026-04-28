import { httpClient, normalizeError } from "@/services/http-client";
import type { CorePositionRow, CoreSettlementRow } from "@/types/operational";

export interface ExecutionPlaceBody {
  account_mode: "REAL" | "DEMO";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  risk_per_trade?: number;
  nav?: number;
  stoploss_price?: number;
  idempotency_key?: string;
  auto_process?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CoreOrderRow {
  id: string;
  account_mode: "REAL" | "DEMO";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  status: string;
  reason?: string | null;
  idempotency_key?: string | null;
  broker_order_id?: string | null;
  order_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface CoreOrderEventRow {
  id: string;
  order_id: string;
  status: string;
  message?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface CorePortfolioSummary {
  account_mode: "REAL" | "DEMO";
  total_symbols: number;
  total_qty: number;
  total_available_qty: number;
  total_pending_settlement_qty: number;
}

export async function placeExecutionOrder(body: ExecutionPlaceBody): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>("/execution/place", body);
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCoreOrders(accountMode: "REAL" | "DEMO", limit = 50): Promise<CoreOrderRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: CoreOrderRow[] }>(
      `/orders?account_mode=${encodeURIComponent(accountMode)}&limit=${encodeURIComponent(limit)}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCorePositions(accountMode: "REAL" | "DEMO"): Promise<CorePositionRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: CorePositionRow[] }>(
      `/positions?account_mode=${encodeURIComponent(accountMode)}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCorePortfolioSummary(accountMode: "REAL" | "DEMO"): Promise<CorePortfolioSummary> {
  try {
    const response = await httpClient.get<{ success: boolean; data: CorePortfolioSummary }>(
      `/portfolio/summary?account_mode=${encodeURIComponent(accountMode)}`,
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getCoreSettlementRows(
  accountMode: "REAL" | "DEMO",
  symbol?: string,
): Promise<CoreSettlementRow[]> {
  try {
    const params = new URLSearchParams({ account_mode: accountMode });
    if (symbol?.trim()) {
      params.set("symbol", symbol.trim().toUpperCase());
    }
    const response = await httpClient.get<{ success: boolean; data: CoreSettlementRow[] }>(
      `/positions/settlement?${params.toString()}`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function processExecutionOrder(orderId: string): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>(`/execution/process/${encodeURIComponent(orderId)}`);
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getOrderEvents(orderId: string): Promise<CoreOrderEventRow[]> {
  try {
    const response = await httpClient.get<{ success: boolean; data: CoreOrderEventRow[] }>(
      `/orders/${encodeURIComponent(orderId)}/events`,
    );
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function reconcileExecutionOrder(orderId: string): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>(`/execution/reconcile/${encodeURIComponent(orderId)}`);
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function cancelExecutionOrder(orderId: string, reason = "manual_cancel_from_auto_trading_real"): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>("/execution/cancel", {
      order_id: orderId,
      reason,
    });
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}
