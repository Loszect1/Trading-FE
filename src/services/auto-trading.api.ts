import { httpClient, normalizeError } from "@/services/http-client";

export type DemoTradeSide = "BUY" | "SELL";
export type StrategyType = "SHORT_TERM" | "LONG_TERM" | "TECHNICAL";

export interface DemoTradeRequestBody {
  side: DemoTradeSide;
  symbol: string;
  quantity: number;
  price: number;
  strategy_type?: StrategyType;
  market_context?: Record<string, unknown>;
}

export interface DemoPositionSnapshot {
  symbol: string;
  quantity: number;
  average_cost: number;
  opened_at: string;
}

export interface DemoTradeHistoryItem {
  trade_id: string;
  created_at: string;
  side: DemoTradeSide;
  symbol: string;
  quantity: number;
  price: number;
  notional: number;
  realized_pnl_on_trade: number;
  cash_after: number;
}

export interface DemoAccountData {
  session_id: string;
  cash_balance: number;
  positions: DemoPositionSnapshot[];
  realized_pnl: number;
  unrealized_pnl: number;
  equity_approx_vnd: number;
  marks_used: Record<string, number>;
  trade_history: DemoTradeHistoryItem[];
  trade_history_total: number;
  trade_history_limit: number;
  trade_history_offset: number;
}

export interface DemoTradeData {
  trade_id: string;
  session_id: string;
  side: DemoTradeSide;
  symbol: string;
  quantity: number;
  price: number;
  cash_after: number;
  position: DemoPositionSnapshot | null;
  realized_pnl_on_trade: number;
  cumulative_realized_pnl: number;
  experience_analysis: {
    recorded: boolean;
    skipped_reason?: string | null;
    error_detail?: string | null;
  };
}

export interface DemoSessionItem {
  session_id: string;
  initial_balance: number;
  cash_balance: number;
  realized_pnl: number;
  created_at: string;
  updated_at: string;
}

export interface DemoSessionListData {
  items: DemoSessionItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DemoHoldingOverviewItem {
  symbol: string;
  quantity: number;
  average_buy_price: number;
  position_value: number;
  opened_at: string;
}

export interface DemoStrategyCashOverviewItem {
  strategy_code: "SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED";
  allocation_pct: number;
  cash_value: number;
  used_cash_value: number;
  remaining_cash_value: number;
}

export interface DemoSessionOverviewData {
  session_id: string;
  is_active: boolean;
  initial_balance: number;
  cash_balance: number;
  stock_value: number;
  total_assets: number;
  realized_pnl: number;
  trade_count: number;
  holdings_count: number;
  holdings: DemoHoldingOverviewItem[];
  strategy_cash_overview: DemoStrategyCashOverviewItem[];
  created_at: string;
  updated_at: string;
}

export interface DemoStrategyCashTransferBody {
  from_strategy?: "UNALLOCATED" | "SHORT_TERM" | "MAIL_SIGNAL";
  to_strategy: "SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED";
  amount_vnd: number;
}

export async function createNewDemoSession(): Promise<string> {
  try {
    const response = await httpClient.post<{ success: boolean; data: { session_id: string } }>(
      "/auto-trading/demo/new-session",
      {},
    );
    const sessionId = response.data.data?.session_id?.trim();
    if (!sessionId) {
      throw new Error("Demo new session response missing session_id");
    }
    return sessionId;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchDemoSessions(limit = 50, offset = 0): Promise<DemoSessionListData> {
  try {
    const response = await httpClient.get<{ success: boolean; data: DemoSessionListData }>(
      `/auto-trading/demo/sessions?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function deleteCurrentDemoSession(sessionId: string): Promise<string> {
  try {
    const response = await httpClient.delete<{ success: boolean; data: { deleted_session_id: string } }>(
      "/auto-trading/demo/session-current",
      {
        headers: {
          "X-Demo-Session-Id": sessionId,
        },
      },
    );
    const deletedSessionId = response.data.data?.deleted_session_id?.trim();
    if (!deletedSessionId) {
      throw new Error("Demo delete session response missing deleted_session_id");
    }
    return deletedSessionId;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchDemoAccount(
  sessionId: string,
  options?: { historyLimit?: number; historyOffset?: number },
): Promise<DemoAccountData> {
  try {
    const historyLimit = options?.historyLimit ?? 50;
    const historyOffset = options?.historyOffset ?? 0;
    const response = await httpClient.get<{ success: boolean; data: DemoAccountData }>(
      `/auto-trading/demo/account?history_limit=${encodeURIComponent(historyLimit)}&history_offset=${encodeURIComponent(historyOffset)}`,
      {
        headers: {
          "X-Demo-Session-Id": sessionId,
        },
      },
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function createDemoTrade(
  sessionId: string,
  body: DemoTradeRequestBody,
): Promise<DemoTradeData> {
  try {
    const response = await httpClient.post<{ success: boolean; data: DemoTradeData }>(
      "/auto-trading/demo/trades",
      body,
      {
        headers: {
          "X-Demo-Session-Id": sessionId,
        },
      },
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchDemoOverview(sessionId: string): Promise<DemoSessionOverviewData> {
  try {
    const response = await httpClient.get<{ success: boolean; data: DemoSessionOverviewData }>(
      "/auto-trading/demo/overview",
      {
        headers: {
          "X-Demo-Session-Id": sessionId,
        },
      },
    );
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function transferDemoStrategyCash(
  sessionId: string,
  body: DemoStrategyCashTransferBody,
): Promise<{ session_id: string; transferred_to: "SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED"; amount_vnd: number }> {
  try {
    const response = await httpClient.post<{
      success: boolean;
      data: { session_id: string; transferred_to: "SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED"; amount_vnd: number };
    }>("/auto-trading/demo/strategy-cash/transfer", body, {
      headers: {
        "X-Demo-Session-Id": sessionId,
      },
    });
    return response.data.data;
  } catch (error) {
    throw normalizeError(error);
  }
}
