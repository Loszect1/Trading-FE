export type AccountMode = "REAL" | "DEMO";

export type SignalStrategyType = "SHORT_TERM" | "LONG_TERM" | "TECHNICAL";

export interface SignalRow {
  id: string;
  strategy_type: SignalStrategyType;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  entry_price: number | null;
  take_profit_price: number | null;
  stoploss_price: number | null;
  confidence: number;
  reason: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface MonitoringPortfolioSlice {
  account_mode: AccountMode;
  total_symbols: number;
  total_qty: number;
  total_available_qty: number;
  total_pending_settlement_qty: number;
}

export type MonitoringValuationMethod =
  | "MARK_TO_MARKET_DAILY_CLOSE"
  | "MARK_TO_MARKET_DAILY_CLOSE_PARTIAL_FALLBACK"
  | "COST_BASIS_ONLY";

export interface MonitoringKillSwitchState {
  account_mode: AccountMode;
  active: boolean;
  reason: string | null;
  updated_at?: string;
}

export interface MonitoringOperationalHealth {
  bot_status: string;
  kill_switch: MonitoringKillSwitchState | Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface MonitoringTradingKpis {
  valuation_method: MonitoringValuationMethod | string;
  valuation_notes: string;
  exposure_cost_basis_vnd: number;
  exposure_market_vnd: number;
  unrealized_pnl_vnd: number;
  mark_price_field: string;
  symbols_with_mark: string[];
  symbols_mark_failed: Record<string, string>;
  symbols_truncated_from_mtm_fetch: string[];
  mtm_fetch_cap: number;
  experience_closed_trades: number;
  experience_win_rate_pct: number | null;
  experience_realized_pnl_sum_vnd: number;
  experience_win_loss_decided?: number;
  experience_breakevens?: number;
  experience_query_error?: string;
  win_rate_scope_notes: string;
  realized_pnl_scope_notes: string;
  drawdown_scope_notes: string;
  drawdown_proxy_pct: number;
  kpis_error?: string;
}

export interface ClaudeRuntimeMetrics {
  cache_hit: number;
  cache_miss: number;
  request_success: number;
  request_failure: number;
  cooldown_trigger: number;
  cooldown_reject: number;
  failure_count: number;
  cooldown_remaining_seconds: number;
}

export interface MonitoringAiRuntime {
  claude_signal_scoring: ClaudeRuntimeMetrics;
  claude_experience: ClaudeRuntimeMetrics;
}

export interface MonitoringAlertLogRow {
  id: string;
  account_mode: string | null;
  rule_id: string;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MonitoringRuntimeLogRow {
  id: string;
  account_mode: string | null;
  source: string;
  level: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MonitoringSummary {
  account_mode: AccountMode;
  portfolio: MonitoringPortfolioSlice;
  orders_by_status: Record<string, number>;
  risk_events_last_7_days: number;
  generated_at: string;
  operational_health?: MonitoringOperationalHealth;
  kpis?: MonitoringTradingKpis;
  ai_runtime?: MonitoringAiRuntime;
  recent_alerts?: MonitoringAlertLogRow[];
}

export interface RiskEventRow {
  id: string;
  account_mode: string;
  symbol: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CorePositionRow {
  symbol: string;
  total_qty: number;
  available_qty: number;
  pending_settlement_qty: number;
  avg_price: number;
}

export interface CoreSettlementRow {
  symbol: string;
  buy_trade_date: string;
  settle_date: string;
  qty: number;
  available_qty: number;
  pending_settlement_qty: number;
  avg_price: number;
}

export interface SchedulerStatus {
  account_mode: AccountMode;
  enabled: boolean;
  running: boolean;
  poll_seconds: number;
  interval_minutes: number;
  timezone: string;
  on_grid?: boolean;
  now_local?: string;
  next_grid_run_at?: string | null;
  active_demo_session_id?: string | null;
}

export interface SchedulerStateRow {
  account_mode: AccountMode;
  enabled: boolean;
  updated_at: string;
}
