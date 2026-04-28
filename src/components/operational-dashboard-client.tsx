"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_TEXT } from "@/constants/ui-text";
import { formatNumber } from "@/lib/format";
import { hasDnseSession } from "@/lib/dnse-session";
import { fetchDemoAccount, fetchDemoSessions, type DemoAccountData } from "@/services/auto-trading.api";
import { fetchSchedulerStatus, toggleScheduler } from "@/services/automation.api";
import { fetchMonitoringSummary, listRiskEvents, listRuntimeLogs } from "@/services/monitoring.api";
import { extractDnseRecords, fetchDnseAccount, fetchDnseAccountBalance, fetchDnseSubAccounts, isAppError, pickSubAccountNumbers } from "@/services/dnse.api";
import { listSignals } from "@/services/signals.api";
import {
  getCoreOrders,
  getCorePositions,
  getCoreSettlementRows,
  type CoreOrderRow,
} from "@/services/trading-core.api";
import type {
  AccountMode,
  ClaudeRuntimeMetrics,
  CorePositionRow,
  CoreSettlementRow,
  MonitoringAlertLogRow,
  MonitoringAiRuntime,
  MonitoringRuntimeLogRow,
  MonitoringSummary,
  MonitoringTradingKpis,
  RiskEventRow,
  SignalRow,
} from "@/types/operational";

function mapDemoTradeHistoryToCoreOrders(account: DemoAccountData): CoreOrderRow[] {
  return account.trade_history.map((t) => ({
    id: t.trade_id,
    account_mode: "DEMO",
    symbol: t.symbol,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    status: "FILLED",
    reason: null,
    created_at: t.created_at,
    updated_at: t.created_at,
  }));
}

function mapDemoPositionsToCorePositions(account: DemoAccountData): CorePositionRow[] {
  return account.positions.map((p) => ({
    symbol: p.symbol,
    total_qty: p.quantity,
    available_qty: p.quantity,
    pending_settlement_qty: 0,
    avg_price: p.average_cost,
  }));
}

function mapDemoTradeHistoryToSignals(account: DemoAccountData): SignalRow[] {
  return account.trade_history.map((trade) => ({
    id: `demo-signal-${trade.trade_id}`,
    strategy_type: "SHORT_TERM",
    symbol: trade.symbol,
    action: trade.side,
    entry_price: trade.price,
    take_profit_price: null,
    stoploss_price: null,
    confidence: 100,
    reason: "Demo session trade history",
    metadata: {
      source: "demo_session_history",
      session_id: account.session_id,
      trade_id: trade.trade_id,
    },
    status: "FILLED",
    created_at: trade.created_at,
  }));
}

function mapDemoTradeHistoryToRiskEvents(account: DemoAccountData): RiskEventRow[] {
  return account.trade_history.map((trade) => ({
    id: `demo-risk-${trade.trade_id}`,
    account_mode: "DEMO",
    symbol: trade.symbol,
    event_type: "DEMO_TRADE_EXECUTED",
    payload: {
      source: "demo_session_history",
      session_id: account.session_id,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      notional: trade.notional,
      realized_pnl_on_trade: trade.realized_pnl_on_trade,
    },
    created_at: trade.created_at,
  }));
}

function buildDemoSessionSummary(account: DemoAccountData): MonitoringSummary {
  const totalQty = account.positions.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
  const now = new Date();
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recentTradeCount = account.trade_history.filter((t) => {
    const ts = new Date(t.created_at).getTime();
    return Number.isFinite(ts) && ts >= sevenDaysAgo;
  }).length;
  return {
    account_mode: "DEMO",
    portfolio: {
      account_mode: "DEMO",
      total_symbols: account.positions.length,
      total_qty: totalQty,
      total_available_qty: totalQty,
      total_pending_settlement_qty: 0,
    },
    orders_by_status: {
      FILLED: account.trade_history.length,
    },
    risk_events_last_7_days: recentTradeCount,
    generated_at: new Date().toISOString(),
  };
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("vi-VN", { hour12: false });
}

function formatDisplayValue(value: unknown): string {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? formatNumber(value) : String(value);
  }
  if (typeof value === "string") {
    return value.trim() || "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return formatJson(value);
}

function pickRecordValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      return value;
    }
  }
  return null;
}

function getVnHourMinute(now: Date): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hourText = parts.find((part) => part.type === "hour")?.value ?? "0";
  const minuteText = parts.find((part) => part.type === "minute")?.value ?? "0";
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10),
  };
}

function isInVnTradingSession(now: Date): boolean {
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
  });
  const weekday = dayFormatter.format(now);
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  const { hour, minute } = getVnHourMinute(now);
  const totalMinutes = hour * 60 + minute;
  const morningStart = 9 * 60;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 14 * 60 + 45;
  const inMorning = totalMinutes >= morningStart && totalMinutes <= morningEnd;
  const inAfternoon = totalMinutes >= afternoonStart && totalMinutes <= afternoonEnd;
  return inMorning || inAfternoon;
}

function killSwitchActiveFlag(kill: unknown): boolean {
  if (!kill || typeof kill !== "object" || !("active" in kill)) {
    return false;
  }
  return Boolean((kill as { active?: boolean }).active);
}

function renderKpiBlock(kpis: MonitoringTradingKpis): ReactNode {
  if (kpis.kpis_error) {
    return (
      <p className="text-sm text-rose-300" role="alert">
        {UI_TEXT.operations.summaryKpiError}: {kpis.kpis_error}
      </p>
    );
  }
  const winRateText =
    kpis.experience_win_rate_pct != null ? `${formatNumber(kpis.experience_win_rate_pct)}%` : "—";
  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm text-slate-300">
      <p className="font-medium text-slate-200">{UI_TEXT.operations.summaryKpiTitle}</p>
      <p>
        {UI_TEXT.operations.summaryValuationMethod}:{" "}
        <span className="font-mono text-xs text-slate-200">{kpis.valuation_method}</span>
      </p>
      <p className="text-xs text-slate-500">{UI_TEXT.operations.summaryValuationNotes}: {kpis.valuation_notes}</p>
      <p>
        {UI_TEXT.operations.summaryExposureCost}: {formatNumber(kpis.exposure_cost_basis_vnd)} VND |{" "}
        {UI_TEXT.operations.summaryExposureMarket}: {formatNumber(kpis.exposure_market_vnd)} VND
      </p>
      <p>
        {UI_TEXT.operations.summaryUnrealizedPnl}: {formatNumber(kpis.unrealized_pnl_vnd)} VND
      </p>
      <p>
        {UI_TEXT.operations.summaryWinRate}: {winRateText} ({UI_TEXT.operations.summaryKpiScope}:{" "}
        {kpis.win_rate_scope_notes})
      </p>
      <p>
        {UI_TEXT.operations.summaryRealizedPnlExp}: {formatNumber(kpis.experience_realized_pnl_sum_vnd)} VND —{" "}
        {kpis.realized_pnl_scope_notes}
      </p>
      <p>
        {UI_TEXT.operations.summaryDrawdown}: {formatNumber(kpis.drawdown_proxy_pct)}% — {kpis.drawdown_scope_notes}
      </p>
    </div>
  );
}

function renderClaudeRuntimeLine(
  label: string,
  metrics: ClaudeRuntimeMetrics | undefined,
): ReactNode {
  if (!metrics) {
    return (
      <p>
        {label}: —
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="font-medium text-slate-200">{label}</p>
      <p>
        {UI_TEXT.operations.summaryAiCache}: {formatNumber(metrics.cache_hit)} / {formatNumber(metrics.cache_miss)}
      </p>
      <p>
        {UI_TEXT.operations.summaryAiRequests}: {formatNumber(metrics.request_success)} /{" "}
        {formatNumber(metrics.request_failure)}
      </p>
      <p>
        {UI_TEXT.operations.summaryAiCooldown}: {formatNumber(metrics.cooldown_trigger)} /{" "}
        {formatNumber(metrics.cooldown_reject)} | {UI_TEXT.operations.summaryAiRemaining}:{" "}
        {formatNumber(metrics.cooldown_remaining_seconds)}
      </p>
    </div>
  );
}

function renderAiRuntimeBlock(aiRuntime: MonitoringAiRuntime | undefined): ReactNode {
  if (!aiRuntime) {
    return null;
  }
  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm text-slate-300">
      <p className="font-medium text-slate-200">{UI_TEXT.operations.summaryAiRuntimeTitle}</p>
      {renderClaudeRuntimeLine(UI_TEXT.operations.summaryAiRuntimeScoring, aiRuntime.claude_signal_scoring)}
      {renderClaudeRuntimeLine(UI_TEXT.operations.summaryAiRuntimeExperience, aiRuntime.claude_experience)}
    </div>
  );
}

function orderStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "FILLED") return "text-emerald-300";
  if (s === "REJECTED" || s === "CANCELLED") return "text-rose-300";
  if (s === "ACK") return "text-cyan-300";
  if (s === "SENT") return "text-amber-300";
  return "text-slate-300";
}

interface SectionCardProps {
  title: string;
  description?: string;
  error: string | null;
  emptyHint?: string;
  children: ReactNode;
}

const DEMO_SESSION_STORAGE_KEY = "auto_trading_demo_session_id";

function ensureDemoSessionIdInStorage(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const existing = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)?.trim() ?? "";
  if (existing) {
    return existing;
  }
  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, created);
  return created;
}

function SectionCard({ title, description, error, emptyHint, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {!error && emptyHint ? <p className="mt-3 text-sm text-slate-500">{emptyHint}</p> : null}
      {!error && !emptyHint ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

export function OperationalDashboardClient() {
  const fetchGenerationRef = useRef(0);
  const schedulerFetchGenerationRef = useRef(0);
  const [accountMode, setAccountMode] = useState<AccountMode>("DEMO");
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [signalsError, setSignalsError] = useState<string | null>(null);

  const [orders, setOrders] = useState<CoreOrderRow[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [positions, setPositions] = useState<CorePositionRow[]>([]);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const [settlement, setSettlement] = useState<CoreSettlementRow[]>([]);
  const [settlementError, setSettlementError] = useState<string | null>(null);

  const [riskEvents, setRiskEvents] = useState<RiskEventRow[]>([]);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [alertLogs, setAlertLogs] = useState<MonitoringAlertLogRow[]>([]);
  const [alertLogsError, setAlertLogsError] = useState<string | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<MonitoringRuntimeLogRow[]>([]);
  const [runtimeLogsError, setRuntimeLogsError] = useState<string | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<{
    enabled: boolean;
    running: boolean;
    poll_seconds: number;
    interval_minutes: number;
    timezone: string;
  } | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [dnseAccountRows, setDnseAccountRows] = useState<Record<string, unknown>[]>([]);
  const [dnseSubAccountRows, setDnseSubAccountRows] = useState<Record<string, unknown>[]>([]);
  const [dnseBalanceRows, setDnseBalanceRows] = useState<Record<string, unknown>[]>([]);
  const [dnseSelectedSubAccount, setDnseSelectedSubAccount] = useState<string>("");
  const [dnseAccountError, setDnseAccountError] = useState<string | null>(null);
  const [demoAccount, setDemoAccount] = useState<DemoAccountData | null>(null);
  const [demoAccountError, setDemoAccountError] = useState<string | null>(null);
  const [demoSessionId, setDemoSessionId] = useState("");
  const [demoSessions, setDemoSessions] = useState<Array<{ session_id: string; created_at: string }>>([]);
  const [demoSessionsLoading, setDemoSessionsLoading] = useState(false);

  const loadRealAccountInfo = useCallback(async () => {
    if (!hasDnseSession()) {
      setDnseAccountRows([]);
      setDnseSubAccountRows([]);
      setDnseBalanceRows([]);
      setDnseSelectedSubAccount("");
      setDnseAccountError(UI_TEXT.operations.realAccountNeedSession);
      return;
    }

    const [accountResult, subAccountResult] = await Promise.allSettled([fetchDnseAccount({}), fetchDnseSubAccounts({})]);
    const errMsg = (error: unknown) => (isAppError(error) ? error.message : UI_TEXT.operations.loadFailed);

    if (accountResult.status === "rejected") {
      throw new Error(errMsg(accountResult.reason));
    }
    if (subAccountResult.status === "rejected") {
      throw new Error(errMsg(subAccountResult.reason));
    }

    const accountRows = extractDnseRecords(accountResult.value);
    const subRows = extractDnseRecords(subAccountResult.value);
    const subNumbers = pickSubAccountNumbers(subRows);
    const selectedSubAccount = subNumbers[0] ?? "";
    let balanceRows: Record<string, unknown>[] = [];

    if (selectedSubAccount) {
      const balanceResponse = await fetchDnseAccountBalance({ sub_account: selectedSubAccount });
      balanceRows = extractDnseRecords(balanceResponse);
    }

    setDnseAccountRows(accountRows);
    setDnseSubAccountRows(subRows);
    setDnseBalanceRows(balanceRows);
    setDnseSelectedSubAccount(selectedSubAccount);
    setDnseAccountError(null);
  }, []);

  const loadDemoAccountInfo = useCallback(async (): Promise<DemoAccountData | null> => {
    if (typeof window === "undefined") {
      setDemoAccount(null);
      setDemoAccountError(UI_TEXT.operations.demoAccountSessionMissing);
      return null;
    }
    const sessionId = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)?.trim() ?? "";
    if (!sessionId) {
      setDemoAccount(null);
      setDemoAccountError(UI_TEXT.operations.demoAccountSessionMissing);
      return null;
    }
    try {
      const account = await fetchDemoAccount(sessionId, { historyLimit: 100, historyOffset: 0 });
      setDemoAccount(account);
      setDemoAccountError(null);
      return account;
    } catch (error) {
      setDemoAccount(null);
      setDemoAccountError(isAppError(error) ? error.message : UI_TEXT.operations.loadFailed);
      return null;
    }
  }, []);

  const refreshDemoSessions = useCallback(async () => {
    setDemoSessionsLoading(true);
    try {
      const data = await fetchDemoSessions(100, 0);
      setDemoSessions(
        (data.items ?? []).map((item) => ({
          session_id: item.session_id,
          created_at: item.created_at,
        })),
      );
    } catch {
      setDemoSessions([]);
    } finally {
      setDemoSessionsLoading(false);
    }
  }, []);

  const demoSessionOptions = useMemo(() => {
    const base = new Map<string, { session_id: string; created_at: string }>();
    for (const s of demoSessions) {
      base.set(s.session_id, s);
    }
    if (demoSessionId && !base.has(demoSessionId)) {
      base.set(demoSessionId, { session_id: demoSessionId, created_at: "" });
    }
    return Array.from(base.values()).sort((a, b) => a.session_id.localeCompare(b.session_id));
  }, [demoSessions, demoSessionId]);

  const loadSchedulerStatus = useCallback(async () => {
    const generation = ++schedulerFetchGenerationRef.current;
    try {
      const status = await fetchSchedulerStatus(accountMode);
      if (generation !== schedulerFetchGenerationRef.current) {
        return;
      }
      setSchedulerStatus(status);
      setSchedulerError(null);
    } catch (error) {
      if (generation !== schedulerFetchGenerationRef.current) {
        return;
      }
      setSchedulerStatus(null);
      setSchedulerError(isAppError(error) ? error.message : UI_TEXT.operations.loadFailed);
    }
  }, [accountMode]);

  const loadAll = useCallback(async (mode: AccountMode) => {
    const generation = ++fetchGenerationRef.current;
    setLoading(true);
    setSummaryError(null);
    setSignalsError(null);
    setOrdersError(null);
    setPositionsError(null);
    setSettlementError(null);
    setRiskError(null);
    setAlertLogsError(null);
    setRuntimeLogsError(null);
    setSchedulerError(null);
    setDnseAccountError(null);
    setDemoAccountError(null);

    const errMsg = (e: unknown) => (isAppError(e) ? e.message : UI_TEXT.operations.loadFailed);

    if (mode === "REAL") {
      const settled = await Promise.allSettled([
        fetchMonitoringSummary(mode),
        listSignals({ limit: 100 }),
        getCoreOrders(mode, 100),
        getCorePositions(mode),
        getCoreSettlementRows(mode),
        listRiskEvents(mode, 100),
        fetchSchedulerStatus(mode),
      ]);

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      if (settled[0].status === "fulfilled") {
        setSummary(settled[0].value);
        setAlertLogs(settled[0].value.recent_alerts ?? []);
      } else {
        setSummary(null);
        setSummaryError(errMsg(settled[0].reason));
        setAlertLogs([]);
        setAlertLogsError(UI_TEXT.operations.backendLogsLoadFailed);
      }

      if (settled[1].status === "fulfilled") {
        setSignals(settled[1].value);
      } else {
        setSignals([]);
        setSignalsError(errMsg(settled[1].reason));
      }

      if (settled[2].status === "fulfilled") {
        setOrders(settled[2].value);
      } else {
        setOrders([]);
        setOrdersError(errMsg(settled[2].reason));
      }

      if (settled[3].status === "fulfilled") {
        setPositions(settled[3].value);
      } else {
        setPositions([]);
        setPositionsError(errMsg(settled[3].reason));
      }

      if (settled[4].status === "fulfilled") {
        setSettlement(settled[4].value);
      } else {
        setSettlement([]);
        setSettlementError(errMsg(settled[4].reason));
      }

      if (settled[5].status === "fulfilled") {
        setRiskEvents(settled[5].value);
      } else {
        setRiskEvents([]);
        setRiskError(errMsg(settled[5].reason));
      }

      if (settled[6].status === "fulfilled") {
        setSchedulerStatus(settled[6].value);
      } else {
        setSchedulerStatus(null);
        setSchedulerError(errMsg(settled[6].reason));
      }

      try {
        await loadRealAccountInfo();
      } catch (error) {
        setDnseAccountRows([]);
        setDnseSubAccountRows([]);
        setDnseBalanceRows([]);
        setDnseSelectedSubAccount("");
        setDnseAccountError(isAppError(error) ? error.message : UI_TEXT.operations.loadFailed);
      }
      setDemoAccount(null);
      setDemoAccountError(null);
      try {
        const rows = await listRuntimeLogs(mode, 150);
        if (generation === fetchGenerationRef.current) {
          setRuntimeLogs(rows);
          setRuntimeLogsError(null);
        }
      } catch {
        if (generation === fetchGenerationRef.current) {
          setRuntimeLogs([]);
          setRuntimeLogsError(UI_TEXT.operations.runtimeLogsLoadFailed);
        }
      }
    } else {
      const settled = await Promise.allSettled([fetchSchedulerStatus(mode), fetchMonitoringSummary(mode)]);

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      if (settled[0].status === "fulfilled") {
        setSchedulerStatus(settled[0].value);
      } else {
        setSchedulerStatus(null);
        setSchedulerError(errMsg(settled[0].reason));
      }
      if (settled[1].status === "fulfilled") {
        setAlertLogs(settled[1].value.recent_alerts ?? []);
      } else {
        setAlertLogs([]);
        setAlertLogsError(UI_TEXT.operations.backendLogsLoadFailed);
      }

      setDnseAccountRows([]);
      setDnseSubAccountRows([]);
      setDnseBalanceRows([]);
      setDnseSelectedSubAccount("");
      setDnseAccountError(null);

      const account = await loadDemoAccountInfo();
      if (generation !== fetchGenerationRef.current) {
        return;
      }

      if (account) {
        setSummary(buildDemoSessionSummary(account));
        setSummaryError(null);
        setSignals(mapDemoTradeHistoryToSignals(account));
        setSignalsError(null);
        setRiskEvents(mapDemoTradeHistoryToRiskEvents(account));
        setRiskError(null);
        setOrders(mapDemoTradeHistoryToCoreOrders(account));
        setPositions(mapDemoPositionsToCorePositions(account));
        setSettlement([]);
        setOrdersError(null);
        setPositionsError(null);
        setSettlementError(null);
      } else {
        setSummary(null);
        setSignals([]);
        setRiskEvents([]);
        setOrders([]);
        setPositions([]);
        setSettlement([]);
      }
      try {
        const rows = await listRuntimeLogs(mode, 150);
        if (generation === fetchGenerationRef.current) {
          setRuntimeLogs(rows);
          setRuntimeLogsError(null);
        }
      } catch {
        if (generation === fetchGenerationRef.current) {
          setRuntimeLogs([]);
          setRuntimeLogsError(UI_TEXT.operations.runtimeLogsLoadFailed);
        }
      }
    }

    setLoading(false);
  }, [loadDemoAccountInfo, loadRealAccountInfo]);

  const alertLogsByMode = useMemo(() => {
    return alertLogs.filter((row) => String(row.account_mode || "").toUpperCase() === accountMode);
  }, [accountMode, alertLogs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const sid = ensureDemoSessionIdInStorage();
    setDemoSessionId(sid);
  }, []);

  useEffect(() => {
    if (accountMode !== "DEMO") {
      return;
    }
    void refreshDemoSessions();
  }, [accountMode, refreshDemoSessions]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAll(accountMode));
  }, [accountMode, loadAll]);

  useEffect(() => {
    if (isInVnTradingSession(new Date())) {
      void loadSchedulerStatus();
    }

    const intervalId = window.setInterval(() => {
      if (!schedulerBusy && isInVnTradingSession(new Date())) {
        void loadSchedulerStatus();
      }
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
      schedulerFetchGenerationRef.current += 1;
    };
  }, [loadSchedulerStatus, schedulerBusy]);

  const handleToggleScheduler = useCallback(async () => {
    if (!schedulerStatus) {
      return;
    }
    setSchedulerBusy(true);
    setSchedulerError(null);
    try {
      const updated = await toggleScheduler(accountMode, !schedulerStatus.enabled);
      schedulerFetchGenerationRef.current += 1;
      setSchedulerStatus(updated);
    } catch (error) {
      setSchedulerError(isAppError(error) ? error.message : UI_TEXT.operations.loadFailed);
    } finally {
      setSchedulerBusy(false);
    }
  }, [accountMode, schedulerStatus]);

  const summaryBody =
    summary && !summaryError ? (
      <div className="space-y-2 text-sm text-slate-300">
        <p>
          {UI_TEXT.operations.summaryAccount}: {summary.account_mode} | {UI_TEXT.operations.summaryGenerated}:{" "}
          {formatDateTime(summary.generated_at)}
        </p>
        {summary.operational_health ? (
          <p>
            {UI_TEXT.operations.summaryBotStatus}:{" "}
            <span className="font-medium text-slate-100">{summary.operational_health.bot_status}</span> |{" "}
            {UI_TEXT.operations.summaryKillSwitch}:{" "}
            {killSwitchActiveFlag(summary.operational_health.kill_switch) ? "active" : "inactive"}
          </p>
        ) : null}
        <p>
          {UI_TEXT.operations.summarySymbols}: {formatNumber(summary.portfolio.total_symbols)} |{" "}
          {UI_TEXT.operations.summaryTotalQty}: {formatNumber(summary.portfolio.total_qty)} |{" "}
          {UI_TEXT.operations.summaryAvailable}: {formatNumber(summary.portfolio.total_available_qty)} |{" "}
          {UI_TEXT.operations.summaryPending}: {formatNumber(summary.portfolio.total_pending_settlement_qty)}
        </p>
        <p>
          {UI_TEXT.operations.summaryRisk7d}: {formatNumber(summary.risk_events_last_7_days)}
        </p>
        <div>
          <p className="font-medium text-slate-200">{UI_TEXT.operations.summaryOrdersByStatus}</p>
          <ul className="mt-1 list-inside list-disc text-slate-400">
            {Object.keys(summary.orders_by_status).length === 0 ? (
              <li>{UI_TEXT.operations.summaryNoOrders}</li>
            ) : (
              Object.entries(summary.orders_by_status).map(([status, count]) => (
                <li key={status}>
                  {status}: {formatNumber(count)}
                </li>
              ))
            )}
          </ul>
        </div>
        {summary.kpis ? renderKpiBlock(summary.kpis) : null}
        {renderAiRuntimeBlock(summary.ai_runtime)}
      </div>
    ) : null;

  const signalsTable =
    signals.length > 0 && !signalsError ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colTime}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colStrategy}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colAction}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colConfidence}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colStatus}</th>
              <th className="py-2 font-medium">{UI_TEXT.operations.colReason}</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((row) => (
              <tr key={row.id} className="border-b border-white/5">
                <td className="py-2 pr-3 align-top text-slate-400">{formatDateTime(row.created_at)}</td>
                <td className="py-2 pr-3 align-top">{row.strategy_type}</td>
                <td className="py-2 pr-3 align-top font-medium text-slate-100">{row.symbol}</td>
                <td className="py-2 pr-3 align-top">{row.action}</td>
                <td className="py-2 pr-3 align-top">{formatNumber(row.confidence)}</td>
                <td className="py-2 pr-3 align-top">{row.status}</td>
                <td className="py-2 align-top text-slate-400">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  const ordersTable =
    orders.length > 0 && !ordersError ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colTime}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSide}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colQty}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colPrice}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colStatus}</th>
              <th className="py-2 font-medium">{UI_TEXT.operations.colReason}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((row) => (
              <tr key={row.id} className="border-b border-white/5">
                <td className="py-2 pr-3 align-top text-slate-400">{formatDateTime(row.created_at)}</td>
                <td className="py-2 pr-3 align-top font-medium text-slate-100">{row.symbol}</td>
                <td className="py-2 pr-3 align-top">{row.side}</td>
                <td className="py-2 pr-3 align-top">{formatNumber(row.quantity)}</td>
                <td className="py-2 pr-3 align-top">{formatNumber(row.price)}</td>
                <td className={`py-2 pr-3 align-top font-medium ${orderStatusClass(row.status)}`}>{row.status}</td>
                <td className="py-2 align-top text-slate-400">{row.reason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  const positionsTable =
    positions.length > 0 && !positionsError ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colTotalQty}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colAvailableQty}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colPendingQty}</th>
              <th className="py-2 font-medium">{UI_TEXT.operations.colAvgPrice}</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((row) => (
              <tr key={row.symbol} className="border-b border-white/5">
                <td className="py-2 pr-3 font-medium text-slate-100">{row.symbol}</td>
                <td className="py-2 pr-3">{formatNumber(row.total_qty)}</td>
                <td className="py-2 pr-3">{formatNumber(row.available_qty)}</td>
                <td className="py-2 pr-3">{formatNumber(row.pending_settlement_qty)}</td>
                <td className="py-2">{formatNumber(row.avg_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  const settlementTable =
    settlement.length > 0 && !settlementError ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colBuyDate}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSettleDate}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colQty}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colAvailableQty}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colPendingQty}</th>
              <th className="py-2 font-medium">{UI_TEXT.operations.colAvgPrice}</th>
            </tr>
          </thead>
          <tbody>
            {settlement.map((row, index) => (
              <tr
                key={`settlement-${index}`}
                className="border-b border-white/5"
              >
                <td className="py-2 pr-3 font-medium text-slate-100">{row.symbol}</td>
                <td className="py-2 pr-3 text-slate-400">{row.buy_trade_date}</td>
                <td className="py-2 pr-3 text-slate-400">{row.settle_date}</td>
                <td className="py-2 pr-3">{formatNumber(row.qty)}</td>
                <td className="py-2 pr-3">{formatNumber(row.available_qty)}</td>
                <td className="py-2 pr-3">{formatNumber(row.pending_settlement_qty)}</td>
                <td className="py-2">{formatNumber(row.avg_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  const riskTable =
    riskEvents.length > 0 && !riskError ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colTime}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colEventType}</th>
              <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
              <th className="py-2 font-medium">{UI_TEXT.operations.colPayload}</th>
            </tr>
          </thead>
          <tbody>
            {riskEvents.map((row) => (
              <tr key={row.id} className="border-b border-white/5">
                <td className="py-2 pr-3 align-top text-slate-400">{formatDateTime(row.created_at)}</td>
                <td className="py-2 pr-3 align-top font-medium text-slate-100">{row.event_type}</td>
                <td className="py-2 pr-3 align-top">{row.symbol ?? "-"}</td>
                <td className="py-2 align-top break-all font-mono text-[11px] text-slate-500">
                  {formatJson(row.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  const realAccountBody =
    accountMode === "REAL" ? (
      <div className="space-y-3 text-sm text-slate-300">
        <p>
          {UI_TEXT.operations.realAccountSession}: {hasDnseSession() ? UI_TEXT.operations.realAccountSessionActive : UI_TEXT.operations.realAccountSessionMissing}
        </p>
        <p>
          {UI_TEXT.operations.realAccountSubAccount}: {dnseSelectedSubAccount || "-"}
        </p>
        <p>
          {UI_TEXT.operations.realAccountAccountRows}: {formatNumber(dnseAccountRows.length)} | {UI_TEXT.operations.realAccountSubRows}:{" "}
          {formatNumber(dnseSubAccountRows.length)} | {UI_TEXT.operations.realAccountBalanceRows}: {formatNumber(dnseBalanceRows.length)}
        </p>
        {dnseAccountRows[0] ? (
          <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {UI_TEXT.operations.realAccountProfileTitle}
            </p>
            <p>
              {UI_TEXT.operations.realAccountName}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(
                  pickRecordValue(dnseAccountRows[0], ["customerName", "fullName", "name", "accountName", "investorName"]),
                )}
              </span>
            </p>
            <p>
              {UI_TEXT.operations.realAccountNumber}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(pickRecordValue(dnseAccountRows[0], ["accountNo", "accountNumber", "account", "id"]))}
              </span>
            </p>
            <p>
              {UI_TEXT.operations.realAccountEmail}:{" "}
              <span className="text-slate-100">{formatDisplayValue(pickRecordValue(dnseAccountRows[0], ["email"]))}</span>
            </p>
            <p>
              {UI_TEXT.operations.realAccountPhone}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(pickRecordValue(dnseAccountRows[0], ["phone", "mobile", "phoneNumber"]))}
              </span>
            </p>
          </div>
        ) : null}
        {dnseBalanceRows[0] ? (
          <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {UI_TEXT.operations.realAccountBalanceTitle}
            </p>
            <p>
              {UI_TEXT.operations.realAccountCash}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(
                  pickRecordValue(dnseBalanceRows[0], [
                    "cashBalance",
                    "cash_balance",
                    "buyingPower",
                    "buying_power",
                    "balance",
                    "cash",
                  ]),
                )}
              </span>
            </p>
            <p>
              {UI_TEXT.operations.realAccountNetAsset}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(
                  pickRecordValue(dnseBalanceRows[0], ["netAssetValue", "net_asset_value", "totalAsset", "total_asset"]),
                )}
              </span>
            </p>
            <p>
              {UI_TEXT.operations.realAccountWithdrawable}:{" "}
              <span className="text-slate-100">
                {formatDisplayValue(
                  pickRecordValue(dnseBalanceRows[0], ["withdrawable", "withdrawableCash", "withdrawable_cash"]),
                )}
              </span>
            </p>
          </div>
        ) : null}
      </div>
    ) : null;

  const demoAccountBody =
    accountMode === "DEMO" ? (
      <div className="space-y-3 text-sm text-slate-300">
        <p>
          {UI_TEXT.operations.demoAccountSessionId}:{" "}
          <span className="font-mono text-xs text-slate-100">{demoAccount?.session_id ?? "-"}</span>
        </p>
        <p>
          {UI_TEXT.operations.demoAccountCash}:{" "}
          <span className="font-semibold text-emerald-300">{formatNumber(demoAccount?.cash_balance ?? 0)} VND</span>
        </p>
        <p>
          {UI_TEXT.operations.demoAccountRealizedPnl}: {formatNumber(demoAccount?.realized_pnl ?? 0)} VND |{" "}
          {UI_TEXT.operations.demoAccountUnrealizedPnl}: {formatNumber(demoAccount?.unrealized_pnl ?? 0)} VND
        </p>
        <p>
          {UI_TEXT.operations.demoAccountEquity}: {formatNumber(demoAccount?.equity_approx_vnd ?? 0)} VND
        </p>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {UI_TEXT.operations.demoAccountHoldingsTitle}
          </p>
          {demoAccount && demoAccount.positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-xs text-slate-300">
                <thead className="border-b border-white/10 text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colSymbol}</th>
                    <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colQty}</th>
                    <th className="py-2 pr-3 font-medium">{UI_TEXT.operations.colAvgPrice}</th>
                    <th className="py-2 font-medium">{UI_TEXT.operations.demoAccountOpenedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {demoAccount.positions.map((position) => (
                    <tr key={`${position.symbol}-${position.opened_at}`} className="border-b border-white/5">
                      <td className="py-2 pr-3 font-medium text-slate-100">{position.symbol}</td>
                      <td className="py-2 pr-3">{formatNumber(position.quantity)}</td>
                      <td className="py-2 pr-3">{formatNumber(position.average_cost)}</td>
                      <td className="py-2 text-slate-400">{formatDateTime(position.opened_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500">{UI_TEXT.operations.demoAccountNoHoldings}</p>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">{UI_TEXT.operations.accountMode}</span>
          {(["DEMO", "REAL"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAccountMode(mode)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                accountMode === mode
                  ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                  : "border-white/10 bg-transparent text-slate-300 hover:border-white/20"
              }`}
            >
              {mode === "DEMO" ? UI_TEXT.operations.tabDemo : UI_TEXT.operations.tabReal}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadAll(accountMode)}
          disabled={loading}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 disabled:opacity-50"
        >
          {loading ? UI_TEXT.operations.refreshing : UI_TEXT.operations.refresh}
        </button>
      </div>
      {accountMode === "DEMO" ? (
        <div className="flex max-w-xl flex-col gap-1 rounded-md border border-white/10 bg-black/20 p-3">
          <label className="text-xs text-slate-400" htmlFor="operations-demo-session">
            {UI_TEXT.operations.demoSessionDropdownLabel}
          </label>
          <select
            id="operations-demo-session"
            value={demoSessionId}
            onChange={(e) => {
              const next = e.target.value.trim();
              if (!next) {
                return;
              }
              window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, next);
              setDemoSessionId(next);
              void loadAll("DEMO");
              void refreshDemoSessions();
            }}
            disabled={loading || demoSessionsLoading}
            className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100"
          >
            {demoSessionOptions.length === 0 ? (
              <option value={demoSessionId}>{demoSessionId || "-"}</option>
            ) : (
              demoSessionOptions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id}
                  {s.created_at ? ` | ${formatDateTime(s.created_at)}` : ""}
                </option>
              ))
            )}
          </select>
          {demoSessionsLoading ? (
            <p className="text-[11px] text-slate-500">{UI_TEXT.operations.demoSessionListLoading}</p>
          ) : null}
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-400">{UI_TEXT.operations.globalLoading}</p> : null}

      {accountMode === "REAL" ? (
        <SectionCard
          title={UI_TEXT.operations.sectionRealAccount}
          description={UI_TEXT.operations.sectionRealAccountHint}
          error={dnseAccountError}
          emptyHint={!loading && !dnseAccountError && dnseAccountRows.length === 0 ? UI_TEXT.operations.realAccountEmpty : undefined}
        >
          {realAccountBody}
        </SectionCard>
      ) : (
        <SectionCard
          title={UI_TEXT.operations.sectionDemoAccount}
          description={`${UI_TEXT.operations.sectionDemoAccountHint} ${UI_TEXT.operations.sectionDemoAccountHintDemo}`}
          error={demoAccountError}
          emptyHint={!loading && !demoAccountError && !demoAccount ? UI_TEXT.operations.demoAccountEmpty : undefined}
        >
          {demoAccountBody}
        </SectionCard>
      )}

      <SectionCard
        title={UI_TEXT.operations.sectionScheduler}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionSchedulerHintDemo : UI_TEXT.operations.sectionSchedulerHint}
        error={schedulerError}
        emptyHint={!loading && !schedulerError && !schedulerStatus ? UI_TEXT.operations.emptyBlock : undefined}
      >
        {schedulerStatus ? (
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              {UI_TEXT.operations.schedulerEnabled}: {schedulerStatus.enabled ? "true" : "false"} |{" "}
              {UI_TEXT.operations.schedulerRunning}: {schedulerStatus.running ? "true" : "false"}
            </p>
            <p>
              {UI_TEXT.operations.schedulerPollSeconds}: {schedulerStatus.poll_seconds} |{" "}
              {UI_TEXT.operations.schedulerIntervalMinutes}: {schedulerStatus.interval_minutes} |{" "}
              {UI_TEXT.operations.schedulerTimezone}: {schedulerStatus.timezone}
            </p>
            <button
              type="button"
              disabled={schedulerBusy}
              onClick={() => void handleToggleScheduler()}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 disabled:opacity-50"
            >
              {schedulerBusy
                ? UI_TEXT.operations.schedulerToggling
                : schedulerStatus.enabled
                  ? UI_TEXT.operations.schedulerDisable
                  : UI_TEXT.operations.schedulerEnable}
            </button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionSummary}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionSummaryHintDemo : UI_TEXT.operations.sectionSummaryHint}
        error={summaryError}
        emptyHint={!loading && !summaryError && !summary ? UI_TEXT.operations.emptyBlock : undefined}
      >
        {summaryBody}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionRuntimeLogs}
        description={UI_TEXT.operations.sectionRuntimeLogsHint}
        error={runtimeLogsError}
        emptyHint={!loading && !runtimeLogsError && runtimeLogs.length === 0 ? UI_TEXT.operations.runtimeLogsEmpty : undefined}
      >
        {runtimeLogs.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-md border border-white/10 bg-black/25 p-3 font-mono text-xs text-slate-300">
            <div className="space-y-1.5">
              {runtimeLogs.map((row) => {
                const payloadText = formatJson(row.payload ?? {});
                return (
                  <p key={row.id} className="break-all">
                    <span className="text-cyan-200">{formatDateTime(row.created_at)}</span>
                    {" | "}
                    <span className="text-violet-300">{String(row.account_mode || "-")}</span>
                    {" | "}
                    <span className="text-amber-300">{row.level}</span>
                    {" | "}
                    <span className="text-slate-200">{row.source}</span>
                    {" | "}
                    {row.message}
                    {" | payload="}
                    <span className="text-slate-500">{payloadText}</span>
                  </p>
                );
              })}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionAlertLogs}
        description={UI_TEXT.operations.sectionAlertLogsHint}
        error={alertLogsError}
        emptyHint={!loading && !alertLogsError && alertLogsByMode.length === 0 ? UI_TEXT.operations.backendLogsEmpty : undefined}
      >
        {alertLogsByMode.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-md border border-white/10 bg-black/25 p-3 font-mono text-xs text-slate-300">
            <div className="space-y-1.5">
              {alertLogsByMode.map((row) => {
                const payloadText = formatJson(row.payload ?? {});
                return (
                  <p key={row.id} className="break-all">
                    <span className="text-cyan-200">{formatDateTime(row.created_at)}</span>
                    {" | "}
                    <span className="text-violet-300">{String(row.account_mode || "-")}</span>
                    {" | "}
                    <span className="text-amber-300">{row.severity}</span>
                    {" | "}
                    <span className="text-slate-200">{row.rule_id}</span>
                    {" | "}
                    {row.message}
                    {" | payload="}
                    <span className="text-slate-500">{payloadText}</span>
                  </p>
                );
              })}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionRisk}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionRiskHintDemo : UI_TEXT.operations.sectionRiskHint}
        error={riskError}
        emptyHint={!loading && !riskError && riskEvents.length === 0 ? UI_TEXT.operations.riskEmpty : undefined}
      >
        {riskTable}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionSignals}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionSignalsHintDemo : UI_TEXT.operations.sectionSignalsHint}
        error={signalsError}
        emptyHint={!loading && !signalsError && signals.length === 0 ? UI_TEXT.operations.signalsEmpty : undefined}
      >
        {signalsTable}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionOrders}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionOrdersHintDemo : UI_TEXT.operations.sectionOrdersHint}
        error={ordersError}
        emptyHint={!loading && !ordersError && orders.length === 0 ? UI_TEXT.operations.ordersEmpty : undefined}
      >
        {ordersTable}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionPositions}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionPositionsHintDemo : UI_TEXT.operations.sectionPositionsHint}
        error={positionsError}
        emptyHint={!loading && !positionsError && positions.length === 0 ? UI_TEXT.operations.positionsEmpty : undefined}
      >
        {positionsTable}
      </SectionCard>

      <SectionCard
        title={UI_TEXT.operations.sectionSettlement}
        description={accountMode === "DEMO" ? UI_TEXT.operations.sectionSettlementHintDemo : UI_TEXT.operations.sectionSettlementHint}
        error={settlementError}
        emptyHint={
          !loading && !settlementError && settlement.length === 0
            ? accountMode === "DEMO"
              ? UI_TEXT.operations.settlementEmptyDemo
              : UI_TEXT.operations.settlementEmpty
            : undefined
        }
      >
        {settlementTable}
      </SectionCard>
    </div>
  );
}
