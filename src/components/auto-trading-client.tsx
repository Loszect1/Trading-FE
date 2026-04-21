"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import { hasDnseSession, setDnseSession } from "@/lib/dnse-session";
import {
  dnseAuthLogin,
  dnseAuthLogout,
  extractDnseRecords,
  fetchDnseAccount,
  fetchDnseDefaults,
  fetchDnseSubAccounts,
  isAppError,
  pickSubAccountNumbers,
} from "@/services/dnse.api";
import {
  fetchDemoOverview,
  createNewDemoSession,
  fetchDemoAccount,
  fetchDemoSessions,
  type DemoSessionOverviewData,
} from "@/services/auto-trading.api";
import {
  fetchMailSignalEntryRunLatest,
  fetchMailSignalsToday,
  fetchSchedulerDemoSession,
  fetchShortTermAsyncJob,
  fetchSchedulerStateRows,
  parseShortTermRunExchangeScope,
  fetchSchedulerStatus,
  fetchShortTermRuns,
  postShortTermRunCycle,
  setSchedulerDemoSession,
  SHORT_TERM_RUN_LOG_SCOPE_ORDER,
  shortTermRunLogScopeBucket,
  toggleScheduler,
  type ShortTermAutomationRunRow,
  type ShortTermAsyncJobStatus,
  type ShortTermExchangeScope,
  type MailSignalsTodayData,
  type MailSignalEntryRunData,
  type ShortTermRunLogScopeBucket,
} from "@/services/automation.api";
import {
  getCoreOrders,
  getCorePositions,
  getOrderEvents,
  placeExecutionOrder,
  processExecutionOrder,
} from "@/services/trading-core.api";
import { getAllSymbols, getCompanyOverview, getSymbolDailyQuoteSnapshot } from "@/services/vnstock.api";
import type { CompanyOverview, SymbolItem } from "@/types/vnstock";

type AccountTab = "real" | "demo";

const DEMO_INITIAL_CASH_VND = 100_000_000;
const AUTO_TRADING_BACKEND_LOGS_PER_SCOPE = 5;

interface SymbolSearchRow extends SymbolItem {
  lastPrice?: number;
  changePercent?: number;
  quoteError?: boolean;
}

interface DemoPosition {
  symbol: string;
  quantity: number;
  average_cost: number;
  opened_at: string;
}

interface DemoOrderItem {
  id: string;
  createdAt: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  notional: number;
}

interface DemoPortfolioSnapshot {
  totalAssets: number;
  cashAvailable: number;
  stockValue: number;
}

type OrderStatus = "NEW" | "SENT" | "ACK" | "FILLED" | "REJECTED" | "CANCELLED";

function statusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "FILLED") return "text-emerald-300";
  if (s === "REJECTED" || s === "CANCELLED") return "text-rose-300";
  if (s === "ACK") return "text-cyan-300";
  if (s === "SENT") return "text-amber-300";
  if (s === "NEW") return "text-slate-300";
  return "text-slate-300";
}

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) {
    return "-";
  }
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

function formatPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) {
    return "-";
  }
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("vi-VN", { hour12: false });
}

function newDemoTradeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DEMO_SESSION_STORAGE_KEY = "auto_trading_demo_session_id";

function getOrCreateDemoSessionId(): string {
  if (typeof window === "undefined") {
    return "default";
  }
  const existing = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
  if (existing && existing.trim()) {
    return existing.trim();
  }
  const created = newDemoTradeId();
  window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, created);
  return created;
}

async function attachQuotesForSymbols(symbols: SymbolItem[], signal: AbortSignal): Promise<SymbolSearchRow[]> {
  const out: SymbolSearchRow[] = [];
  const batchSize = 6;
  for (let i = 0; i < symbols.length; i += batchSize) {
    if (signal.aborted) {
      break;
    }
    const chunk = symbols.slice(i, i + batchSize);
    const snaps = await Promise.all(chunk.map((item) => getSymbolDailyQuoteSnapshot(item.symbol)));
    if (signal.aborted) {
      break;
    }
    for (let j = 0; j < chunk.length; j += 1) {
      const item = chunk[j];
      const snap = snaps[j];
      out.push({
        ...item,
        lastPrice: snap?.lastPrice,
        changePercent: snap?.changePercent,
        quoteError: snap === null,
      });
    }
  }
  return out;
}

function asyncJobStatusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "FINISHED") return "text-emerald-300";
  if (normalized === "FAILED") return "text-rose-300";
  if (normalized === "RUNNING") return "text-amber-200";
  return "text-slate-300";
}

function formatElapsedSeconds(startedAt: string, finishedAt?: string | null): string {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) {
    return "-";
  }
  const endMs = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(endMs) || endMs < startMs) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

const OVERVIEW_DONUT_COLORS = ["#34d399", "#60a5fa"];
const HOLDINGS_BAR_COLOR = "#a78bfa";

export function AutoTradingClient() {
  const { showToast } = useToast();
  const [accountTab, setAccountTab] = useState<AccountTab>("real");
  const [schedulerStatus, setSchedulerStatus] = useState<{
    account_mode: "REAL" | "DEMO";
    enabled: boolean;
    running: boolean;
    poll_seconds: number;
    interval_minutes: number;
    timezone: string;
  } | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [schedulerError, setSchedulerError] = useState("");
  const [schedulerStateRows, setSchedulerStateRows] = useState<
    Array<{ account_mode: "REAL" | "DEMO"; enabled: boolean; updated_at: string }>
  >([]);
  const [automationRuns, setAutomationRuns] = useState<ShortTermAutomationRunRow[]>([]);
  const [automationRunsError, setAutomationRunsError] = useState("");
  const [mailSignalsToday, setMailSignalsToday] = useState<MailSignalsTodayData | null>(null);
  const [mailSignalsError, setMailSignalsError] = useState("");
  const [mailSignalEntryRun, setMailSignalEntryRun] = useState<MailSignalEntryRunData | null>(null);
  const [mailSignalEntryRunError, setMailSignalEntryRunError] = useState("");
  const [automationLogScopeFilter, setAutomationLogScopeFilter] = useState<"ANY" | ShortTermExchangeScope>("ANY");
  const [manualCycleExchangeScope, setManualCycleExchangeScope] = useState<ShortTermExchangeScope>("ALL");
  const [manualCycleBusy, setManualCycleBusy] = useState(false);
  const [manualCycleError, setManualCycleError] = useState("");
  const [manualCycleAsyncJobId, setManualCycleAsyncJobId] = useState<string | null>(null);
  const [manualCycleAsyncStatus, setManualCycleAsyncStatus] = useState<ShortTermAsyncJobStatus | null>(null);
  const [manualCycleAsyncNotified, setManualCycleAsyncNotified] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [accountProbeBusy, setAccountProbeBusy] = useState(false);
  const [accountProbeMessage, setAccountProbeMessage] = useState("");

  const [allSymbols, setAllSymbols] = useState<SymbolItem[]>([]);
  const [symbolsLoadState, setSymbolsLoadState] = useState<"idle" | "loading" | "error" | "ready">("loading");
  const [symbolsError, setSymbolsError] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [debouncedTicker, setDebouncedTicker] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchRows, setSearchRows] = useState<SymbolSearchRow[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [realOrderSymbol, setRealOrderSymbol] = useState("");
  const [realOrderSide, setRealOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [realOrderQty, setRealOrderQty] = useState("100");
  const [realOrderPrice, setRealOrderPrice] = useState("");
  const [realOrderBusy, setRealOrderBusy] = useState(false);
  const [realOrderMessage, setRealOrderMessage] = useState("");
  const [realStatusFilter, setRealStatusFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [realAutoProcess, setRealAutoProcess] = useState(true);
  const [realOrderIdempotencyKey, setRealOrderIdempotencyKey] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderEvents, setSelectedOrderEvents] = useState<
    Array<{ id: string; status: string; message?: string | null; created_at: string }>
  >([]);
  const [orderEventsBusy, setOrderEventsBusy] = useState(false);
  const [realOrders, setRealOrders] = useState<
    Array<{
      id: string;
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      price: number;
      status: string;
      reason?: string | null;
      created_at: string;
    }>
  >([]);

  const [demoSessionId, setDemoSessionId] = useState("default");
  const [demoSessions, setDemoSessions] = useState<Array<{ session_id: string; created_at: string }>>([]);
  const [demoSessionsLoading, setDemoSessionsLoading] = useState(false);
  const [demoCash, setDemoCash] = useState(DEMO_INITIAL_CASH_VND);
  const [demoPositions, setDemoPositions] = useState<DemoPosition[]>([]);
  const [demoRealizedPnl, setDemoRealizedPnl] = useState(0);
  const [demoUnrealizedPnl, setDemoUnrealizedPnl] = useState(0);
  const [demoEquity, setDemoEquity] = useState(DEMO_INITIAL_CASH_VND);
  const [demoOrders, setDemoOrders] = useState<DemoOrderItem[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLimit] = useState(30);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [demoSessionBusy, setDemoSessionBusy] = useState(false);
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [demoOverview, setDemoOverview] = useState<DemoSessionOverviewData | null>(null);
  const [demoOverviewError, setDemoOverviewError] = useState("");
  const [holdingLastPriceBySymbol, setHoldingLastPriceBySymbol] = useState<Record<string, number>>({});
  const [demoPortfolioSnapshot, setDemoPortfolioSnapshot] = useState<DemoPortfolioSnapshot>({
    totalAssets: DEMO_INITIAL_CASH_VND,
    cashAvailable: DEMO_INITIAL_CASH_VND,
    stockValue: 0,
  });

  const schedulerAccountMode: "REAL" | "DEMO" = accountTab === "real" ? "REAL" : "DEMO";

  const automationRunLogGroups = useMemo(() => {
    const runsBySession = automationRuns.filter((run) => {
      if (schedulerAccountMode !== "DEMO") {
        return true;
      }
      const sid = String((run.detail?.demo_session_id as string | undefined) || "").trim();
      return sid.length > 0 && sid === demoSessionId;
    });
    const scopedRuns = runsBySession.filter((run) => {
      if (automationLogScopeFilter === "ANY") {
        return true;
      }
      return parseShortTermRunExchangeScope(run.detail) === automationLogScopeFilter;
    });
    const buckets = new Map<ShortTermRunLogScopeBucket, ShortTermAutomationRunRow[]>();
    for (const bucket of [...SHORT_TERM_RUN_LOG_SCOPE_ORDER, "OTHER" as const]) {
      buckets.set(bucket, []);
    }
    for (const run of scopedRuns) {
      const bucket = shortTermRunLogScopeBucket(run.detail);
      buckets.get(bucket)?.push(run);
    }
    const orderedBuckets: ShortTermRunLogScopeBucket[] = [...SHORT_TERM_RUN_LOG_SCOPE_ORDER, "OTHER"];
    return orderedBuckets
      .map((bucket) => ({
        bucket,
        runs: (buckets.get(bucket) ?? []).slice(0, AUTO_TRADING_BACKEND_LOGS_PER_SCOPE),
      }))
      .filter((g) => g.runs.length > 0);
  }, [automationLogScopeFilter, automationRuns, demoSessionId, schedulerAccountMode]);

  const overviewDonutData = useMemo(
    () => [
      { name: "Tien mat", value: Math.max(0, Number(demoPortfolioSnapshot.cashAvailable || 0)) },
      { name: "Co phieu", value: Math.max(0, Number(demoPortfolioSnapshot.stockValue || 0)) },
    ],
    [demoPortfolioSnapshot.cashAvailable, demoPortfolioSnapshot.stockValue],
  );

  const overviewHoldingsBarData = useMemo(() => {
    if (!demoOverview?.holdings?.length) {
      return [];
    }
    return [...demoOverview.holdings]
      .map((h) => ({
        symbol: String(h.symbol || "").toUpperCase(),
        value: Number(h.quantity || 0) * Number(h.average_buy_price || 0),
      }))
      .filter((row) => row.symbol && Number.isFinite(row.value) && row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [demoOverview]);

  const credsPayload = useCallback(() => {
    const u = username.trim();
    const p = password;
    return {
      ...(u ? { username: u } : {}),
      ...(p ? { password: p } : {}),
    };
  }, [username, password]);

  useEffect(() => {
    setSessionActive(hasDnseSession());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSymbolsLoadState("loading");
    setSymbolsError("");
    void (async () => {
      try {
        const list = await getAllSymbols();
        if (!cancelled) {
          setAllSymbols(list);
          setSymbolsLoadState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setSymbolsLoadState("error");
          setSymbolsError(isAppError(error) ? error.message : UI_TEXT.autoTrading.symbolsLoadFailed);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedTicker(tickerInput.trim().toUpperCase()), 350);
    return () => window.clearTimeout(t);
  }, [tickerInput]);

  useEffect(() => {
    if (symbolsLoadState !== "ready") {
      setSearchRows([]);
      setSearchMessage("");
      setSearchBusy(false);
      return;
    }
    const q = debouncedTicker;
    if (!q) {
      setSearchRows([]);
      setSearchMessage(UI_TEXT.autoTrading.searchHintEmpty);
      setSearchBusy(false);
      return;
    }

    const controller = new AbortController();
    const matches = allSymbols
      .filter((s) => s.symbol.includes(q))
      .slice(0, 24);

    if (matches.length === 0) {
      setSearchRows([]);
      setSearchMessage(UI_TEXT.autoTrading.searchNoResults);
      setSearchBusy(false);
      return;
    }

    setSearchBusy(true);
    setSearchMessage(UI_TEXT.autoTrading.searchLoadingQuotes);
    void (async () => {
      try {
        const rows = await attachQuotesForSymbols(matches, controller.signal);
        if (!controller.signal.aborted) {
          setSearchRows(rows);
          setSearchMessage(UI_TEXT.autoTrading.searchResultsCount(rows.length));
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchRows(matches.map((m) => ({ ...m, quoteError: true })));
          setSearchMessage(UI_TEXT.autoTrading.searchQuotePartialFail);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchBusy(false);
        }
      }
    })();

    return () => controller.abort();
  }, [allSymbols, debouncedTicker, symbolsLoadState]);

  useEffect(() => {
    if (!selectedSymbol) {
      setOverview(null);
      setOverviewError("");
      return;
    }
    let cancelled = false;
    setOverviewBusy(true);
    setOverviewError("");
    void (async () => {
      try {
        const data = await getCompanyOverview(selectedSymbol);
        if (!cancelled) {
          setOverview(data);
          if (!data) {
            setOverviewError(UI_TEXT.autoTrading.overviewEmpty);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(isAppError(error) ? error.message : UI_TEXT.autoTrading.overviewFailed);
        }
      } finally {
        if (!cancelled) {
          setOverviewBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const refreshRealOrders = useCallback(async () => {
    try {
      const rows = await getCoreOrders("REAL", 20);
      setRealOrders(rows);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Khong tai duoc danh sach lenh Real.";
      setRealOrderMessage(message);
    }
  }, []);

  const loadOrderEvents = useCallback(async (orderId: string) => {
    setOrderEventsBusy(true);
    try {
      const rows = await getOrderEvents(orderId);
      setSelectedOrderEvents(
        rows.map((row) => ({
          id: row.id,
          status: row.status,
          message: row.message,
          created_at: row.created_at,
        })),
      );
    } catch (error) {
      const message = isAppError(error) ? error.message : "Khong tai duoc order events.";
      setRealOrderMessage(message);
    } finally {
      setOrderEventsBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshRealOrders();
  }, [refreshRealOrders]);

  const pushDemoLog = useCallback((line: string) => {
    setDemoLog((prev) => [...prev.slice(-80), `${new Date().toISOString()} ${line}`]);
  }, []);

  const refreshDemoAccount = useCallback(
    async (sessionId: string, options?: { append?: boolean; offset?: number }) => {
      try {
        const offset = options?.offset ?? 0;
        const account = await fetchDemoAccount(sessionId, {
          historyLimit,
          historyOffset: offset,
        });
        setDemoCash(account.cash_balance);
        setDemoPositions(account.positions);
        setDemoRealizedPnl(account.realized_pnl);
        setDemoUnrealizedPnl(account.unrealized_pnl);
        setDemoEquity(account.equity_approx_vnd);
        setHistoryTotal(account.trade_history_total);
        setDemoOrders((prev) => {
          const mapped: DemoOrderItem[] = account.trade_history.map((item) => ({
            id: item.trade_id,
            createdAt: item.created_at,
            symbol: item.symbol,
            side: item.side === "BUY" ? "buy" : "sell",
            quantity: item.quantity,
            price: item.price,
            notional: item.notional,
          }));
          if (options?.append) {
            const existingIds = new Set(prev.map((item) => item.id));
            const merged = [...prev];
            for (const row of mapped) {
              if (!existingIds.has(row.id)) {
                merged.push(row);
              }
            }
            return merged;
          }
          return mapped;
        });
      } catch (error) {
        const message = isAppError(error) ? error.message : "Khong tai duoc demo account.";
        pushDemoLog(`Tai demo account that bai: ${message}`);
      }
    },
    [historyLimit, pushDemoLog],
  );

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
    } catch (error) {
      const message = isAppError(error) ? error.message : "Khong tai duoc danh sach demo sessions.";
      pushDemoLog(message);
    } finally {
      setDemoSessionsLoading(false);
    }
  }, [pushDemoLog]);

  const refreshDemoOverview = useCallback(
    async (sessionId: string) => {
      try {
        const overview = await fetchDemoOverview(sessionId);
        const stockValue = (overview.holdings || []).reduce(
          (sum, h) => sum + Number(h.quantity || 0) * Number(h.average_buy_price || 0),
          0,
        );
        const totalAssets = Number(overview.cash_balance || 0) + stockValue;
        setDemoOverview(overview);
        setDemoPortfolioSnapshot({
          totalAssets,
          cashAvailable: Number(overview.cash_balance || 0),
          stockValue,
        });
        setDemoOverviewError("");
      } catch (error) {
        setDemoOverview(null);
        setDemoPortfolioSnapshot({
          totalAssets: DEMO_INITIAL_CASH_VND,
          cashAvailable: DEMO_INITIAL_CASH_VND,
          stockValue: 0,
        });
        const message = isAppError(error) ? error.message : "Khong tai duoc core demo overview.";
        setDemoOverviewError(message);
        pushDemoLog(message);
      }
    },
    [pushDemoLog],
  );

  const loadSchedulerStatus = useCallback(async () => {
    try {
      const status = await fetchSchedulerStatus(schedulerAccountMode);
      setSchedulerStatus(status);
      setSchedulerError("");
    } catch (error) {
      setSchedulerStatus(null);
      setSchedulerError(isAppError(error) ? error.message : "Khong tai duoc trang thai auto trading.");
    }
  }, [schedulerAccountMode]);

  const loadSchedulerStateRows = useCallback(async () => {
    try {
      const rows = await fetchSchedulerStateRows();
      setSchedulerStateRows(rows);
    } catch {
      // Keep scheduler status UX stable even if admin DB-state endpoint fails.
    }
  }, []);

  const loadAutomationRuns = useCallback(async () => {
    try {
      const rows = await fetchShortTermRuns(schedulerAccountMode, 50);
      setAutomationRuns(rows);
      setAutomationRunsError("");
    } catch (error) {
      setAutomationRuns([]);
      setAutomationRunsError(isAppError(error) ? error.message : "Khong tai duoc backend automation logs.");
    }
  }, [schedulerAccountMode]);

  const loadMailSignalsToday = useCallback(async () => {
    try {
      const row = await fetchMailSignalsToday();
      setMailSignalsToday(row);
      setMailSignalsError("");
    } catch (error) {
      setMailSignalsToday(null);
      setMailSignalsError(isAppError(error) ? error.message : "Khong tai duoc mail signals hom nay.");
    }
  }, []);

  const loadMailSignalEntryRun = useCallback(async () => {
    try {
      const row = await fetchMailSignalEntryRunLatest();
      setMailSignalEntryRun(row);
      setMailSignalEntryRunError("");
    } catch (error) {
      setMailSignalEntryRun(null);
      setMailSignalEntryRunError(isAppError(error) ? error.message : "Khong tai duoc entry scheduler log moi nhat.");
    }
  }, []);

  useEffect(() => {
    const sessionId = getOrCreateDemoSessionId();
    setDemoSessionId(sessionId);
    void setSchedulerDemoSession(sessionId);
    setHistoryOffset(0);
    void refreshDemoAccount(sessionId, { offset: 0 });
    void refreshDemoOverview(sessionId);
    void refreshDemoSessions();
  }, [refreshDemoAccount, refreshDemoOverview, refreshDemoSessions]);

  useEffect(() => {
    void (async () => {
      try {
        const active = await fetchSchedulerDemoSession();
        if (active && active.trim()) {
          window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, active.trim());
          setDemoSessionId(active.trim());
          setHistoryOffset(0);
          void refreshDemoAccount(active.trim(), { offset: 0 });
          void refreshDemoOverview(active.trim());
        }
      } catch {
        // Keep UI resilient when scheduler demo-session endpoint is temporarily unavailable.
      }
    })();
  }, [refreshDemoAccount, refreshDemoOverview]);

  useEffect(() => {
    void loadSchedulerStatus();
    void loadSchedulerStateRows();
    void loadAutomationRuns();
    void loadMailSignalsToday();
    void loadMailSignalEntryRun();
  }, [loadAutomationRuns, loadMailSignalEntryRun, loadMailSignalsToday, loadSchedulerStateRows, loadSchedulerStatus]);

  useEffect(() => {
    // Match BE scan cadence: `interval_minutes` === `short_term_scan_interval_minutes` (not scheduler poll loop).
    const intervalMinutes = Math.min(120, Math.max(1, schedulerStatus?.interval_minutes ?? 15));
    const intervalMs = intervalMinutes * 60 * 1000;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadSchedulerStatus();
      void loadSchedulerStateRows();
      void loadAutomationRuns();
      void loadMailSignalsToday();
      void loadMailSignalEntryRun();
    };

    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [
    loadAutomationRuns,
    loadMailSignalEntryRun,
    loadMailSignalsToday,
    loadSchedulerStateRows,
    loadSchedulerStatus,
    schedulerAccountMode,
    schedulerStatus?.interval_minutes,
  ]);

  const handleDnseLogin = async () => {
    setSessionBusy(true);
    try {
      await dnseAuthLogin(username.trim(), password);
      setPassword("");
      setSessionActive(true);
      showToast(TOAST_MESSAGES.dnseSessionSaved, "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : TOAST_MESSAGES.dnseLoginFailed;
      showToast(message, "error");
    } finally {
      setSessionBusy(false);
    }
  };

  const handleApplyToken = () => {
    const t = tokenInput.trim();
    if (!t) {
      showToast(UI_TEXT.autoTrading.tokenMissing, "error");
      return;
    }
    setDnseSession(t);
    setTokenInput("");
    setSessionActive(true);
    showToast(TOAST_MESSAGES.dnseSessionSaved, "success");
  };

  const handleDnseLogout = () => {
    dnseAuthLogout();
    setSessionActive(false);
    showToast(TOAST_MESSAGES.dnseSessionCleared, "success");
  };

  const handleProbeAccount = async () => {
    setAccountProbeBusy(true);
    setAccountProbeMessage("");
    try {
      await fetchDnseDefaults();
      const creds = credsPayload();
      const [accRes, subRes] = await Promise.all([fetchDnseAccount(creds), fetchDnseSubAccounts(creds)]);
      const accRows = extractDnseRecords(accRes);
      const subRows = extractDnseRecords(subRes);
      const nums = pickSubAccountNumbers(subRows);
      setAccountProbeMessage(
        UI_TEXT.autoTrading.accountProbeOk(accRows.length, subRows.length, nums.length),
      );
    } catch (error) {
      setAccountProbeMessage(isAppError(error) ? error.message : UI_TEXT.autoTrading.accountProbeFailed);
    } finally {
      setAccountProbeBusy(false);
    }
  };

  const handlePlaceRealOrder = async (event: FormEvent) => {
    event.preventDefault();
    const symbol = realOrderSymbol.trim().toUpperCase();
    const quantity = Number(realOrderQty);
    const price = Number(realOrderPrice.replace(",", "."));
    if (!symbol || symbol.length > 20) {
      setRealOrderMessage("Ma khong hop le.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      setRealOrderMessage("Khoi luong phai la so nguyen duong.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setRealOrderMessage("Gia phai la so duong.");
      return;
    }
    setRealOrderBusy(true);
    setRealOrderMessage("");
    try {
      const response = await placeExecutionOrder({
        account_mode: "REAL",
        symbol,
        side: realOrderSide,
        quantity,
        price,
        risk_per_trade: 0.01,
        nav: 100_000_000,
        stoploss_price: realOrderSide === "BUY" ? price * 0.97 : undefined,
        metadata: {
          source: "fe_auto_trading_real",
        },
        auto_process: realAutoProcess,
        idempotency_key: realOrderIdempotencyKey.trim() || undefined,
      });
      const success = Boolean((response as { success?: boolean }).success);
      const data = (response as { data?: Record<string, unknown> }).data ?? {};
      const orderStatus = (data as { status?: string; order?: { status?: string } }).status
        ?? (data as { order?: { status?: string } }).order?.status
        ?? "NEW";
      if (!success) {
        setRealOrderMessage(`Lenh bi tu choi: ${String(data.reason ?? "unknown")}`);
      } else {
        setRealOrderMessage(`Dat lenh thanh cong: ${String(orderStatus)}`);
      }
      await refreshRealOrders();
    } catch (error) {
      const message = isAppError(error) ? error.message : "Dat lenh that bai.";
      setRealOrderMessage(message);
    } finally {
      setRealOrderBusy(false);
    }
  };

  const handleProcessSelectedOrder = async (orderId: string) => {
    try {
      const response = await processExecutionOrder(orderId);
      const success = Boolean((response as { success?: boolean }).success);
      if (!success) {
        setRealOrderMessage(`Process order that bai: ${String((response as { data?: { reason?: string } }).data?.reason ?? "unknown")}`);
      } else {
        setRealOrderMessage("Da process order.");
      }
      await refreshRealOrders();
      await loadOrderEvents(orderId);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Process order that bai.";
      setRealOrderMessage(message);
    }
  };

  const handleLoadMoreHistory = async () => {
    const nextOffset = historyOffset + historyLimit;
    setHistoryLoadingMore(true);
    try {
      await refreshDemoAccount(demoSessionId, { append: true, offset: nextOffset });
      setHistoryOffset(nextOffset);
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const canLoadMoreHistory = demoOrders.length < historyTotal;
  const filteredRealOrders = realOrders.filter((order) =>
    realStatusFilter === "ALL" ? true : order.status === realStatusFilter,
  );

  const handleNewDemoSession = async () => {
    setDemoSessionBusy(true);
    try {
      const newSessionId = await createNewDemoSession();
      window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, newSessionId);
      setDemoSessionId(newSessionId);
      await setSchedulerDemoSession(newSessionId);
      setHistoryOffset(0);
      setDemoOrders([]);
      setDemoLog([]);
      await refreshDemoAccount(newSessionId, { offset: 0 });
      await refreshDemoOverview(newSessionId);
      await refreshDemoSessions();
      pushDemoLog(UI_TEXT.autoTrading.demoNewSessionCreated);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Tao phien demo moi that bai.";
      pushDemoLog(message);
    } finally {
      setDemoSessionBusy(false);
    }
  };

  const handleToggleScheduler = async () => {
    if (!schedulerStatus) {
      return;
    }
    setSchedulerBusy(true);
    setSchedulerError("");
    try {
      const updated = await toggleScheduler(schedulerAccountMode, !schedulerStatus.enabled);
      setSchedulerStatus(updated);
      await loadSchedulerStateRows();
      await loadAutomationRuns();
    } catch (error) {
      setSchedulerError(isAppError(error) ? error.message : "Khong toggle duoc auto trading.");
    } finally {
      setSchedulerBusy(false);
    }
  };

  const handleManualShortTermCycle = async () => {
    setManualCycleBusy(true);
    setManualCycleError("");
    try {
      const response = await postShortTermRunCycle({
        exchange_scope: manualCycleExchangeScope,
        account_mode: schedulerAccountMode,
        async_for_heavy: true,
        demo_session_id: schedulerAccountMode === "DEMO" ? demoSessionId : undefined,
      });
      if ((response.run_status || "").toUpperCase() === "ACCEPTED" && response.run_id) {
        setManualCycleAsyncJobId(response.run_id);
        setManualCycleAsyncNotified(false);
        setManualCycleAsyncStatus({
          job_id: response.run_id,
          status: "QUEUED",
          started_at: new Date().toISOString(),
          finished_at: null,
          result: null,
          error: null,
          exchange_scope: String(response.detail?.exchange_scope ?? manualCycleExchangeScope),
          account_mode: schedulerAccountMode,
          limit_symbols: Number(response.detail?.limit_symbols ?? 0),
        });
      } else {
        setManualCycleAsyncJobId(null);
        setManualCycleAsyncStatus(null);
        setManualCycleAsyncNotified(false);
      }
      await loadAutomationRuns();
    } catch (error) {
      setManualCycleError(isAppError(error) ? error.message : "Short-term run cycle that bai.");
    } finally {
      setManualCycleBusy(false);
    }
  };

  useEffect(() => {
    if (!manualCycleAsyncJobId) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const row = await fetchShortTermAsyncJob(manualCycleAsyncJobId);
        if (cancelled) {
          return;
        }
        setManualCycleAsyncStatus(row);
        if (row.status === "FINISHED" || row.status === "FAILED") {
          if (!manualCycleAsyncNotified) {
            if (row.status === "FINISHED") {
              showToast(`Short-term async cycle hoàn tất: ${row.job_id}`, "success");
            } else {
              showToast(
                row.error
                  ? `Short-term async cycle thất bại: ${row.error}`
                  : `Short-term async cycle thất bại: ${row.job_id}`,
                "error",
              );
            }
            setManualCycleAsyncNotified(true);
          }
          await loadAutomationRuns();
          setManualCycleAsyncJobId(null);
        }
      } catch (error) {
        if (!cancelled) {
          setManualCycleError(isAppError(error) ? error.message : "Khong tai duoc trang thai async cycle.");
          setManualCycleAsyncJobId(null);
        }
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loadAutomationRuns, manualCycleAsyncJobId, manualCycleAsyncNotified, showToast]);

  useEffect(() => {
    const holdings = demoOverview?.holdings ?? [];
    if (holdings.length === 0) {
      setHoldingLastPriceBySymbol({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const uniqSymbols = Array.from(new Set(holdings.map((h) => String(h.symbol || "").trim().toUpperCase()).filter(Boolean)));
      const snaps = await Promise.all(uniqSymbols.map((symbol) => getSymbolDailyQuoteSnapshot(symbol)));
      if (cancelled) {
        return;
      }
      const next: Record<string, number> = {};
      for (let idx = 0; idx < uniqSymbols.length; idx += 1) {
        const symbol = uniqSymbols[idx];
        const snap = snaps[idx];
        const last = Number(snap?.lastPrice ?? 0);
        if (Number.isFinite(last) && last > 0) {
          next[symbol] = last;
        }
      }
      setHoldingLastPriceBySymbol(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [demoOverview]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setAccountTab("real")}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            accountTab === "real"
              ? "bg-cyan-300/20 text-cyan-50"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {UI_TEXT.autoTrading.tabReal}
        </button>
        <button
          type="button"
          onClick={() => setAccountTab("demo")}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            accountTab === "demo"
              ? "bg-cyan-300/20 text-cyan-50"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {UI_TEXT.autoTrading.tabDemo}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">
            Auto {schedulerAccountMode}: {schedulerStatus?.enabled ? "ON" : "OFF"} /{" "}
            {schedulerStatus?.running ? "RUNNING" : "STOPPED"}
          </span>
          <button
            type="button"
            onClick={() => void handleToggleScheduler()}
            disabled={schedulerBusy || !schedulerStatus}
            className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
          >
            {schedulerBusy ? "Dang toggle..." : schedulerStatus?.enabled ? "Tat Auto" : "Bat Auto"}
          </button>
        </div>
      </div>
      {accountTab === "real" ? (
        <div className="flex flex-col gap-10">
          <section className="glass-panel rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.autoTrading.dnseTitle}</h2>
            <p className="mt-2 text-xs text-slate-400">{UI_TEXT.autoTrading.dnseHint}</p>
            <p className="mt-3 text-xs text-slate-500">
              {sessionActive ? UI_TEXT.dnse.sessionActive : UI_TEXT.dnse.sessionNone}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-400" htmlFor="at-dnse-user">
                  {UI_TEXT.dnse.credentialsSection}
                </label>
                <input
                  id="at-dnse-user"
                  className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={UI_TEXT.dnse.usernamePlaceholder}
                />
                <input
                  className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={UI_TEXT.dnse.passwordPlaceholder}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleDnseLogin()}
                    disabled={sessionBusy}
                    className="rounded-md bg-cyan-300/20 px-3 py-2 text-xs font-semibold text-cyan-50 disabled:opacity-50"
                  >
                    {sessionBusy ? UI_TEXT.dnse.sessionLoggingIn : UI_TEXT.dnse.sessionLogin}
                  </button>
                  <button
                    type="button"
                    onClick={handleDnseLogout}
                    className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    {UI_TEXT.dnse.sessionLogout}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-400" htmlFor="at-dnse-token">
                  {UI_TEXT.autoTrading.tokenPasteLabel}
                </label>
                <textarea
                  id="at-dnse-token"
                  className="min-h-[88px] rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={UI_TEXT.autoTrading.tokenPastePlaceholder}
                />
                <button
                  type="button"
                  onClick={handleApplyToken}
                  className="self-start rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100"
                >
                  {UI_TEXT.autoTrading.tokenApply}
                </button>
              </div>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => void handleProbeAccount()}
                disabled={accountProbeBusy}
                className="rounded-md bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
              >
                {accountProbeBusy ? UI_TEXT.dnse.loadingAccountInfo : UI_TEXT.dnse.loadAccountInfo}
              </button>
              {accountProbeMessage ? (
                <p className="mt-2 text-xs text-slate-400">{accountProbeMessage}</p>
              ) : null}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.autoTrading.searchTitle}</h2>
            <p className="mt-2 text-xs text-slate-400">{UI_TEXT.autoTrading.searchDescription}</p>
            {symbolsLoadState === "error" ? (
              <p className="mt-4 text-sm text-rose-300">{symbolsError}</p>
            ) : null}
            {symbolsLoadState === "loading" ? (
              <p className="mt-4 text-sm text-slate-400">{UI_TEXT.autoTrading.symbolsLoading}</p>
            ) : null}
            <input
              className="mt-4 w-full max-w-md rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder={UI_TEXT.autoTrading.searchPlaceholder}
              disabled={symbolsLoadState !== "ready"}
            />
            <p className="mt-2 text-xs text-slate-500">
              {searchBusy ? UI_TEXT.autoTrading.searchLoadingQuotes : searchMessage}
            </p>
            {searchRows.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm text-slate-200">
                  <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">{UI_TEXT.market.table.symbol}</th>
                      <th className="py-2 pr-3">{UI_TEXT.market.table.exchange}</th>
                      <th className="py-2 pr-3">{UI_TEXT.autoTrading.colPrice}</th>
                      <th className="py-2 pr-3">{UI_TEXT.autoTrading.colChange}</th>
                      <th className="py-2">{UI_TEXT.market.table.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchRows.map((row) => (
                      <tr key={row.symbol} className="border-b border-white/5">
                        <td className="py-2 pr-3 font-mono font-medium">{row.symbol}</td>
                        <td className="py-2 pr-3 text-slate-400">{row.exchange ?? "-"}</td>
                        <td className="py-2 pr-3">
                          {row.quoteError || row.lastPrice === undefined ? (
                            <span className="text-slate-500">-</span>
                          ) : (
                            formatPrice(row.lastPrice)
                          )}
                        </td>
                        <td className="py-2 pr-3">{formatPct(row.changePercent)}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-200"
                              onClick={() => setSelectedSymbol(row.symbol)}
                            >
                              {UI_TEXT.autoTrading.viewOverview}
                            </button>
                            <Link
                              href={`/symbol/${encodeURIComponent(row.symbol)}`}
                              className="rounded-md border border-cyan-300/30 px-2 py-1 text-xs text-cyan-100"
                            >
                              {UI_TEXT.market.table.viewDetail}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {selectedSymbol ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {UI_TEXT.autoTrading.overviewTitle(selectedSymbol)}
                  </h3>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-300"
                    onClick={() => setSelectedSymbol(null)}
                  >
                    {UI_TEXT.autoTrading.clearSelection}
                  </button>
                </div>
                {overviewBusy ? (
                  <p className="mt-2 text-xs text-slate-400">{UI_TEXT.autoTrading.overviewLoading}</p>
                ) : null}
                {overviewError ? <p className="mt-2 text-xs text-rose-300">{overviewError}</p> : null}
                {overview ? (
                  <dl className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">{UI_TEXT.autoTrading.companyName}</dt>
                      <dd>{overview.company_name ?? UI_TEXT.symbol.fallbackCompanyName}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{UI_TEXT.symbol.exchange}</dt>
                      <dd>{overview.exchange ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{UI_TEXT.symbol.industry}</dt>
                      <dd>{overview.industry ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{UI_TEXT.symbol.marketCap}</dt>
                      <dd>
                        {overview.market_cap != null ? formatVnd(overview.market_cap) : "-"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-slate-100">Real execution (Risk + T+2 guard)</h2>
            <p className="mt-2 text-xs text-slate-400">
              Lenh se di qua `/execution/place`, BUY qua risk check va SELL qua settlement guard.
            </p>
            <form className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={handlePlaceRealOrder}>
              <input
                className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={realOrderSymbol}
                onChange={(e) => setRealOrderSymbol(e.target.value.toUpperCase())}
                placeholder="Ma"
              />
              <select
                className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={realOrderSide}
                onChange={(e) => setRealOrderSide(e.target.value as "BUY" | "SELL")}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <input
                className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={realOrderQty}
                onChange={(e) => setRealOrderQty(e.target.value)}
                placeholder="Khoi luong"
              />
              <input
                className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={realOrderPrice}
                onChange={(e) => setRealOrderPrice(e.target.value)}
                placeholder="Gia"
              />
              <input
                className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={realOrderIdempotencyKey}
                onChange={(e) => setRealOrderIdempotencyKey(e.target.value)}
                placeholder="Idempotency key (optional)"
              />
              <label className="flex items-center gap-2 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={realAutoProcess}
                  onChange={(e) => setRealAutoProcess(e.target.checked)}
                />
                Auto process
              </label>
              <div className="md:col-span-2 lg:col-span-4">
                <button
                  type="submit"
                  disabled={realOrderBusy}
                  className="rounded-md bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 disabled:opacity-50"
                >
                  {realOrderBusy ? "Dang gui lenh..." : "Dat lenh Real"}
                </button>
              </div>
            </form>
            {realOrderMessage ? <p className="mt-3 text-xs text-slate-300">{realOrderMessage}</p> : null}
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-slate-400">Filter status:</label>
              <select
                className="rounded border border-white/15 bg-black/30 px-2 py-1 text-xs text-slate-200"
                value={realStatusFilter}
                onChange={(e) => setRealStatusFilter(e.target.value as "ALL" | OrderStatus)}
              >
                <option value="ALL">ALL</option>
                <option value="NEW">NEW</option>
                <option value="SENT">SENT</option>
                <option value="ACK">ACK</option>
                <option value="FILLED">FILLED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>
            <div className="mt-4 max-h-56 overflow-y-auto rounded-md border border-white/10 p-3 text-xs text-slate-300">
              {filteredRealOrders.length === 0 ? (
                <p className="text-slate-500">Chua co lenh.</p>
              ) : (
                filteredRealOrders.map((order) => (
                  <div key={order.id} className="border-b border-white/5 py-2 font-mono">
                    <div>
                      {order.created_at} {order.side} {order.quantity} {order.symbol} @ {formatPrice(order.price)} |{" "}
                      <span className={statusClass(order.status)}>{order.status}</span>
                      {order.reason ? ` (${order.reason})` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-white/20 px-2 py-1 text-[10px]"
                        onClick={() => {
                          setSelectedOrderId(order.id);
                          void loadOrderEvents(order.id);
                        }}
                      >
                        Xem events
                      </button>
                      {["NEW", "SENT", "ACK"].includes(order.status) ? (
                        <button
                          type="button"
                          className="rounded border border-cyan-300/40 px-2 py-1 text-[10px] text-cyan-100"
                          onClick={() => void handleProcessSelectedOrder(order.id)}
                        >
                          Process
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            {selectedOrderId ? (
              <div className="mt-3 rounded-md border border-white/10 p-3 text-xs text-slate-300">
                <p className="font-semibold">Order events: {selectedOrderId}</p>
                {orderEventsBusy ? (
                  <p className="mt-2 text-slate-500">Dang tai events...</p>
                ) : selectedOrderEvents.length === 0 ? (
                  <p className="mt-2 text-slate-500">Chua co event.</p>
                ) : (
                  <div className="mt-2 space-y-1 font-mono">
                    {selectedOrderEvents.map((event) => (
                      <div key={event.id}>
                        {event.created_at} [{event.status}] {event.message ?? ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.autoTrading.demoBalanceTitle}</h2>
              <button
                type="button"
                onClick={() => void handleNewDemoSession()}
                disabled={demoSessionBusy}
                className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
              >
                {demoSessionBusy ? UI_TEXT.autoTrading.demoNewSessionCreating : UI_TEXT.autoTrading.demoNewSession}
              </button>
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-cyan-100">
              {formatVnd(demoCash)} VND
            </p>
            <p className="mt-1 text-xs text-slate-500">{UI_TEXT.autoTrading.demoBalanceHint}</p>
            <div className="mt-3 max-w-md">
              <label className="mb-1 block text-xs text-slate-400">{UI_TEXT.autoTrading.demoSessionListLabel}</label>
              <select
                value={demoSessionId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, nextId);
                  setDemoSessionId(nextId);
                  void setSchedulerDemoSession(nextId);
                  setHistoryOffset(0);
                  void refreshDemoAccount(nextId, { offset: 0 });
                  void refreshDemoOverview(nextId);
                }}
                disabled={demoSessionsLoading || demoSessionBusy}
                className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-xs text-slate-100"
              >
                {demoSessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.session_id} | {session.created_at}
                  </option>
                ))}
              </select>
              {demoSessionsLoading ? (
                <p className="mt-1 text-[11px] text-slate-500">{UI_TEXT.autoTrading.demoSessionListLoading}</p>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
              <p>Session: {demoSessionId}</p>
              <p>Realized PnL: {formatVnd(demoRealizedPnl)} VND</p>
              <p>Equity: {formatVnd(demoEquity)} VND</p>
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-200">Demo DB Overview</p>
              {demoOverviewError ? <p className="mt-2 text-rose-300">{demoOverviewError}</p> : null}
              {demoOverview ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-cyan-100/80">Tong tai san hien tai</p>
                      <p className="mt-1 text-lg font-semibold text-cyan-50">
                        {formatVnd(demoPortfolioSnapshot.totalAssets)} VND
                      </p>
                    </div>
                    <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-100/80">Tien mat con du</p>
                      <p className="mt-1 text-lg font-semibold text-emerald-50">
                        {formatVnd(demoPortfolioSnapshot.cashAvailable)} VND
                      </p>
                    </div>
                    <div className="rounded-md border border-violet-300/25 bg-violet-300/10 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-violet-100/80">Gia tri co phieu</p>
                      <p className="mt-1 text-lg font-semibold text-violet-50">
                        {formatVnd(demoPortfolioSnapshot.stockValue)} VND
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                  <p>
                    Active: {demoOverview.is_active ? "true" : "false"} | Trades: {demoOverview.trade_count} | Holdings:{" "}
                    {demoOverview.holdings_count}
                  </p>
                  <p>
                    Cash: {formatVnd(demoOverview.cash_balance)} VND | Realized: {formatVnd(demoOverview.realized_pnl)}{" "}
                    VND
                  </p>
                  <p>Updated: {formatDateTime(demoOverview.updated_at)}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-black/20 p-3">
                      <p className="mb-2 text-xs font-semibold text-slate-300">Ty trong tai san</p>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={overviewDonutData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={54}
                              outerRadius={82}
                              paddingAngle={2}
                            >
                              {overviewDonutData.map((entry, idx) => (
                                <Cell key={`${entry.name}-${idx}`} fill={OVERVIEW_DONUT_COLORS[idx % OVERVIEW_DONUT_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "rgba(8, 13, 23, 0.96)",
                                border: "1px solid rgba(148, 163, 184, 0.35)",
                                borderRadius: "10px",
                                color: "#e6edf7",
                              }}
                              formatter={(value) => [`${formatVnd(Number(value || 0))} VND`, "Gia tri"]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                        {overviewDonutData.map((item, idx) => (
                          <p key={item.name}>
                            <span style={{ color: OVERVIEW_DONUT_COLORS[idx % OVERVIEW_DONUT_COLORS.length] }}>●</span> {item.name}:{" "}
                            {formatVnd(item.value)} VND
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/20 p-3">
                      <p className="mb-2 text-xs font-semibold text-slate-300">Top holdings theo gia tri</p>
                      <div className="h-56">
                        {overviewHoldingsBarData.length === 0 ? (
                          <div className="flex h-full items-center justify-center text-xs text-slate-500">
                            Khong co du lieu holdings.
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={overviewHoldingsBarData}>
                              <XAxis
                                dataKey="symbol"
                                tick={{ fill: "#94a3b8", fontSize: 11 }}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                tick={{ fill: "#94a3b8", fontSize: 11 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v: number) => formatVnd(Number(v || 0))}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: "rgba(8, 13, 23, 0.96)",
                                  border: "1px solid rgba(148, 163, 184, 0.35)",
                                  borderRadius: "10px",
                                  color: "#e6edf7",
                                }}
                                formatter={(value) => [`${formatVnd(Number(value || 0))} VND`, "Gia tri"]}
                              />
                              <Bar dataKey="value" fill={HOLDINGS_BAR_COLOR} radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  </div>
                  {demoOverview.holdings.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {demoOverview.holdings.map((holding) => {
                        const symbol = String(holding.symbol || "").toUpperCase();
                        const last = Number(holdingLastPriceBySymbol[symbol] ?? 0);
                        const avg = Number(holding.average_buy_price || 0);
                        const hasMark = Number.isFinite(last) && last > 0;
                        const toneClass = hasMark
                          ? last > avg
                            ? "text-emerald-300"
                            : last < avg
                              ? "text-rose-300"
                              : "text-slate-300"
                          : "text-slate-300";
                        const pnlPct = hasMark && avg > 0 ? ((last / avg - 1) * 100).toFixed(2) : null;
                        return (
                          <li key={`${holding.symbol}-${holding.opened_at}`} className={`font-mono ${toneClass}`}>
                            {holding.symbol} | qty {holding.quantity} | avg {formatPrice(holding.average_buy_price)} |{" "}
                            mark {hasMark ? formatPrice(last) : "-"} {pnlPct ? `(${Number(pnlPct) > 0 ? "+" : ""}${pnlPct}%)` : ""}
                            {" | "}
                            {formatDateTime(holding.opened_at)}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-slate-500">Khong co ma dang nam giu.</p>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          {schedulerError ? <p className="text-xs text-rose-300">{schedulerError}</p> : null}
          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="font-semibold text-slate-200">Auto Trading Backend Logs ({schedulerAccountMode})</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-400" htmlFor="at-log-scope-filter">
                  Log scope
                  <select
                    id="at-log-scope-filter"
                    className="rounded-md border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-slate-100"
                    value={automationLogScopeFilter}
                    onChange={(e) => setAutomationLogScopeFilter(e.target.value as "ANY" | ShortTermExchangeScope)}
                  >
                    <option value="ANY">ANY</option>
                    <option value="ALL">ALL</option>
                    <option value="HOSE">HOSE</option>
                    <option value="HNX">HNX</option>
                    <option value="UPCOM">UPCOM</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-400" htmlFor="at-manual-exchange-scope">
                  Exchange scope
                  <select
                    id="at-manual-exchange-scope"
                    className="rounded-md border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-slate-100"
                    value={manualCycleExchangeScope}
                    onChange={(e) => setManualCycleExchangeScope(e.target.value as ShortTermExchangeScope)}
                    disabled={manualCycleBusy}
                  >
                    <option value="ALL">ALL</option>
                    <option value="HOSE">HOSE</option>
                    <option value="HNX">HNX</option>
                    <option value="UPCOM">UPCOM</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleManualShortTermCycle()}
                  disabled={manualCycleBusy}
                  className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                >
                  {manualCycleBusy ? "Dang chay cycle..." : "Run short-term cycle"}
                </button>
              </div>
            </div>
            {manualCycleError ? <p className="mt-2 text-rose-300">{manualCycleError}</p> : null}
            {manualCycleAsyncStatus ? (
              <p className={`mt-2 ${asyncJobStatusClass(manualCycleAsyncStatus.status)}`}>
                Async cycle {manualCycleAsyncStatus.job_id}: {manualCycleAsyncStatus.status}
                {" | elapsed "}
                {formatElapsedSeconds(manualCycleAsyncStatus.started_at, manualCycleAsyncStatus.finished_at)}
                {manualCycleAsyncStatus.error ? ` | ${manualCycleAsyncStatus.error}` : ""}
              </p>
            ) : null}
            {automationRunsError ? <p className="mt-2 text-rose-300">{automationRunsError}</p> : null}
            {automationRuns.length === 0 ? (
              <p className="mt-2 text-slate-500">Chua co run log.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {automationRunLogGroups.map((group, idx) => (
                  <div key={group.bucket}>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                        idx > 0 ? "border-t border-white/10 pt-2" : ""
                      }`}
                    >
                      {group.bucket === "OTHER" ? "Other / legacy" : group.bucket} · {group.runs.length} run
                      {group.runs.length === 1 ? "" : "s"}
                    </p>
                    <div className="mt-1 space-y-1">
                      {group.runs.map((run) => (
                        <p key={run.id} className="font-mono">
                          {formatDateTime(run.started_at)} | {run.run_status} | scan {run.scanned} | buy{" "}
                          {run.buy_candidates} | exec {run.executed} | err {run.errors}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Mail Signals Today (Claude)</h3>
            {mailSignalsError ? <p className="mt-2 text-xs text-rose-300">{mailSignalsError}</p> : null}
            {!mailSignalsToday ? (
              <p className="mt-3 text-xs text-slate-500">Chua co du lieu signal hom nay.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p>
                  Query: <span className="font-mono">{mailSignalsToday.query}</span> | Mail: {mailSignalsToday.mail_count} |
                  Generated: {formatDateTime(mailSignalsToday.generated_at)}
                </p>
                {mailSignalsToday.items.length === 0 ? (
                  <p className="text-slate-500">Khong co ma mua hop le tu mail hom nay.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
                      <thead className="border-b border-white/10 uppercase text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Symbol</th>
                          <th className="py-2 pr-3">Entry</th>
                          <th className="py-2 pr-3">Take profit</th>
                          <th className="py-2 pr-3">Stop loss</th>
                          <th className="py-2 pr-3">Confidence</th>
                          <th className="py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mailSignalsToday.items.map((item, idx) => (
                          <tr key={`${item.symbol}-${idx}`} className="border-b border-white/5 align-top">
                            <td className="py-2 pr-3 font-mono">{item.symbol}</td>
                            <td className="py-2 pr-3">{formatPrice(item.entry)}</td>
                            <td className="py-2 pr-3 text-emerald-300">{formatPrice(item.take_profit)}</td>
                            <td className="py-2 pr-3 text-rose-300">{formatPrice(item.stop_loss)}</td>
                            <td className="py-2 pr-3">{(Number(item.confidence || 0) * 100).toFixed(0)}%</td>
                            <td className="py-2">{item.reason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Mail Entry Scheduler Log (Latest)</h3>
            {mailSignalEntryRunError ? <p className="mt-2 text-xs text-rose-300">{mailSignalEntryRunError}</p> : null}
            {!mailSignalEntryRun ? (
              <p className="mt-3 text-xs text-slate-500">Chua co log entry scheduler.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p>
                  Redis key: <span className="font-mono">{mailSignalEntryRun.redis_key}</span> | Source:{" "}
                  <span className="font-mono">{mailSignalEntryRun.source_key}</span> | Account: {mailSignalEntryRun.account_mode}
                </p>
                <p>
                  Ran at: {formatDateTime(mailSignalEntryRun.ran_at)} | Scanned: {mailSignalEntryRun.scanned} | Executed:{" "}
                  {mailSignalEntryRun.executed.length} | Skipped: {mailSignalEntryRun.skipped.length}
                </p>
                {mailSignalEntryRun.executed.length === 0 ? (
                  <p className="text-slate-500">Chua co lenh nao duoc ban trong lan chay gan nhat.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-xs text-slate-200">
                      <thead className="border-b border-white/10 uppercase text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Symbol</th>
                          <th className="py-2 pr-3">Quantity</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Order ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mailSignalEntryRun.executed.map((row, idx) => (
                          <tr key={`${row.symbol}-${idx}`} className="border-b border-white/5">
                            <td className="py-2 pr-3 font-mono">{row.symbol}</td>
                            <td className="py-2 pr-3">{Number(row.quantity || 0)}</td>
                            <td className="py-2 pr-3">{row.status || "-"}</td>
                            <td className="py-2 pr-3 font-mono">{row.order_id || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass-panel rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-200">{UI_TEXT.autoTrading.demoPositionsTitle}</h3>
              {demoPositions.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">{UI_TEXT.autoTrading.demoPositionsEmpty}</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {demoPositions.map((pos) => (
                    <li
                      key={`${pos.symbol}-${pos.opened_at}`}
                      className="flex justify-between border-b border-white/5 py-1 font-mono text-xs"
                    >
                      <span>{pos.symbol}</span>
                      <span>
                        {pos.quantity} @ {formatPrice(pos.average_cost)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="glass-panel rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-200">{UI_TEXT.autoTrading.demoOrdersTitle}</h3>
              <p className="mt-1 text-xs text-slate-500">
                Hien thi {demoOrders.length} / {historyTotal} lenh
              </p>
              {demoOrders.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">{UI_TEXT.autoTrading.demoOrdersEmpty}</p>
              ) : (
                <div className="mt-3 max-h-64 overflow-y-auto text-xs text-slate-400">
                  {demoOrders.map((o) => (
                    <div key={o.id} className="border-b border-white/5 py-2 font-mono">
                      <div>
                        {o.createdAt} {o.side.toUpperCase()} {o.quantity} {o.symbol} @ {formatPrice(o.price)}
                      </div>
                      <div>{formatVnd(o.notional)} VND</div>
                    </div>
                  ))}
                </div>
              )}
              {canLoadMoreHistory ? (
                <button
                  type="button"
                  className="mt-3 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
                  onClick={() => void handleLoadMoreHistory()}
                  disabled={historyLoadingMore}
                >
                  {historyLoadingMore ? "Dang tai them..." : "Tai them lich su"}
                </button>
              ) : null}
            </section>
          </div>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">{UI_TEXT.autoTrading.demoLogTitle}</h3>
            <p className="mt-1 text-xs text-slate-500">Unrealized PnL: {formatVnd(demoUnrealizedPnl)} VND</p>
            <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-black/40 p-3 font-mono text-[11px] text-slate-400">
              {demoLog.length === 0 ? UI_TEXT.autoTrading.demoLogEmpty : demoLog.join("\n")}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
