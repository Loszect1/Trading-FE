"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  fetchDnseAccountBalance,
  fetchDnseDefaults,
  fetchDnseSubAccounts,
  isAppError,
  pickSubAccountNumbers,
} from "@/services/dnse.api";
import {
  deleteCurrentDemoSession,
  fetchDemoOverview,
  createNewDemoSession,
  fetchDemoAccount,
  fetchDemoSessions,
  transferDemoStrategyCash,
  type DemoSessionOverviewData,
} from "@/services/auto-trading.api";
import {
  fetchRealRecommendationsLatest,
  fetchShortTermLiquidityEligibleCache,
  fetchMailSignalEntryRunsRecent,
  fetchMailSignalsLatest,
  postRealRecommendationActionBuy,
  postRealRecommendationsScan,
  fetchSchedulerDemoSession,
  fetchShortTermAsyncJob,
  parseShortTermRunExchangeScope,
  fetchSchedulerStatus,
  fetchShortTermRuns,
  postShortTermRunCycle,
  postMailSignalEntryRunOnce,
  setSchedulerDemoSession,
  SHORT_TERM_RUN_LOG_SCOPE_ORDER,
  shortTermRunLogScopeBucket,
  toggleScheduler,
  toggleRealScanOnlyScheduler,
  type ShortTermAutomationRunRow,
  type ShortTermAsyncJobStatus,
  type ShortTermExchangeScope,
  type MailSignalsData,
  type MailSignalEntryRunData,
  type ShortTermRunLogScopeBucket,
  type RealRecommendationRow,
  type LiquidityEligibleCacheRow,
} from "@/services/automation.api";
import { getSymbolDailyQuoteSnapshot } from "@/services/vnstock.api";
import {
  cancelExecutionOrder,
  getCoreOrders,
  getOrderEvents,
  placeExecutionOrder,
  reconcileExecutionOrder,
  type CoreOrderEventRow,
  type CoreOrderRow,
} from "@/services/trading-core.api";

type AccountTab = "real" | "demo";

type RealAutomationMode = "SCAN_ONLY" | "AUTO_TRADING";

const DEMO_INITIAL_CASH_VND = 100_000_000;
const AUTO_TRADING_BACKEND_LOGS_PER_SCOPE = 5;
const DNSE_DEPOSIT_QR_URL = (process.env.NEXT_PUBLIC_DNSE_DEPOSIT_QR_URL ?? "/QR_Code.png").trim();

const REAL_AUTOMATION_MODE_STORAGE_KEY = "real_automation_mode";
const REAL_SCAN_ONLY_SCHEDULE_ENABLED_STORAGE_KEY = "real_scan_only_schedule_enabled";

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

interface DnseHoldingSummaryRow {
  symbol: string;
  quantity: number;
  averagePrice: number | null;
  marketPrice: number | null;
}

const STATUS_COLOR_CLASS = {
  order: {
    FILLED: "text-emerald-300",
    REJECTED: "text-rose-300",
    CANCELLED: "text-rose-300",
    ACK: "text-cyan-300",
    SENT: "text-amber-300",
    NEW: "text-slate-300",
    DEFAULT: "text-slate-300",
  },
  automationRun: {
    COMPLETED: "text-emerald-300",
    DEFAULT: "text-rose-300",
  },
} as const;

function statusClass(status: string): string {
  const s = String(status || "").toUpperCase() as keyof typeof STATUS_COLOR_CLASS.order;
  return STATUS_COLOR_CLASS.order[s] ?? STATUS_COLOR_CLASS.order.DEFAULT;
}

function automationRunStatusClass(status: string): string {
  const s = String(status || "").toUpperCase() as keyof typeof STATUS_COLOR_CLASS.automationRun;
  return STATUS_COLOR_CLASS.automationRun[s] ?? STATUS_COLOR_CLASS.automationRun.DEFAULT;
}

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}

function normalizeVnStockPrice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    return n;
  }
  return n < 1000 ? n * 1000 : n;
}

function formatPrice(n: number): string {
  const normalized = normalizeVnStockPrice(n);
  if (!Number.isFinite(normalized)) {
    return "-";
  }
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(normalized);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("vi-VN", { hour12: false });
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

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const DEMO_SESSION_STORAGE_KEY = "auto_trading_demo_session_id";

function getStoredDemoSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const existing = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
  return existing?.trim() ?? "";
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

function parseNumberCandidate(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractDnseCashFromRows(rows: Record<string, unknown>[]): number | null {
  const cashKeys = [
    "cash",
    "cashBalance",
    "cash_balance",
    "availableCash",
    "available_cash",
    "buyingPower",
    "buying_power",
    "netCash",
    "net_cash",
  ];
  for (const row of rows) {
    for (const key of cashKeys) {
      const n = parseNumberCandidate(row[key]);
      if (n != null && n >= 0) {
        return n;
      }
    }
  }
  return null;
}

function extractDnseTradableCashFromRows(rows: Record<string, unknown>[]): number | null {
  const tradableKeys = [
    "buyingPower",
    "buying_power",
    "availableTradingCash",
    "available_trading_cash",
    "availableToTrade",
    "available_to_trade",
    "cashAvailableForTrading",
    "cash_available_for_trading",
  ];
  for (const row of rows) {
    for (const key of tradableKeys) {
      const n = parseNumberCandidate(row[key]);
      if (n != null && n >= 0) {
        return n;
      }
    }
  }
  return null;
}

function extractRealSchedulerCashFromRows(rows: Record<string, unknown>[]): number | null {
  // Production rule: REAL auto scheduler uses broker-reported available cash first, then purchasing power.
  const preferredKeys = ["availableCash", "purchasingPower"];
  for (const row of rows) {
    for (const key of preferredKeys) {
      const n = parseNumberCandidate(row[key]);
      if (n != null && n >= 0) {
        return n;
      }
    }
  }
  return null;
}

function extractDnseAccountNameFromRows(rows: Record<string, unknown>[]): string | null {
  const nameKeys = [
    "customerName",
    "customer_name",
    "fullName",
    "full_name",
    "accountName",
    "account_name",
    "investorName",
    "investor_name",
    "name",
  ];
  for (const row of rows) {
    for (const key of nameKeys) {
      const raw = row[key];
      if (typeof raw === "string" && raw.trim()) {
        return raw.trim();
      }
    }
  }
  return null;
}

function extractDnseDepositedAmountFromRows(rows: Record<string, unknown>[]): { value: number; sourceKey: string } | null {
  const depositKeys = ["initialBalance", "initial_balance"];
  for (const row of rows) {
    for (const key of depositKeys) {
      const n = parseNumberCandidate(row[key]);
      if (n != null && n >= 0) {
        return { value: n, sourceKey: key };
      }
    }
  }
  return null;
}

function extractDnseHoldingsFromRows(rows: Record<string, unknown>[]): DnseHoldingSummaryRow[] {
  const out: DnseHoldingSummaryRow[] = [];
  for (const row of rows) {
    const symbolRaw = row.symbol ?? row.stockSymbol ?? row.stock_code ?? row.ticker;
    const symbol = String(symbolRaw ?? "").trim().toUpperCase();
    if (!symbol) {
      continue;
    }
    const qty =
      parseNumberCandidate(row.quantity) ??
      parseNumberCandidate(row.qty) ??
      parseNumberCandidate(row.totalQuantity) ??
      parseNumberCandidate(row.total_quantity) ??
      0;
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    const avgRaw =
      parseNumberCandidate(row.avgPrice) ??
      parseNumberCandidate(row.avg_price) ??
      parseNumberCandidate(row.averagePrice) ??
      parseNumberCandidate(row.average_price) ??
      null;
    const marketRaw =
      parseNumberCandidate(row.marketPrice) ??
      parseNumberCandidate(row.market_price) ??
      parseNumberCandidate(row.lastPrice) ??
      parseNumberCandidate(row.last_price) ??
      null;
    const avg = avgRaw != null ? normalizeVnStockPrice(avgRaw) : null;
    const market = marketRaw != null ? normalizeVnStockPrice(marketRaw) : null;
    out.push({
      symbol,
      quantity: Math.trunc(qty),
      averagePrice: avg,
      marketPrice: market,
    });
  }
  return out;
}

const OVERVIEW_DONUT_COLORS = ["#34d399", "#60a5fa"];
const HOLDINGS_BAR_COLOR = "#a78bfa";

export function AutoTradingClient() {
  const { showToast } = useToast();
  const realScanOnlySchedulerToggleBusyRef = useRef(false);
  const lastRealScanOnlyScheduleEnabledRef = useRef<boolean | null>(null);
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

  const [realAutomationMode, setRealAutomationMode] = useState<RealAutomationMode>("SCAN_ONLY");
  const [realScanOnlyScheduleEnabled, setRealScanOnlyScheduleEnabled] = useState(false);
  const [automationRuns, setAutomationRuns] = useState<ShortTermAutomationRunRow[]>([]);
  const [automationRunsError, setAutomationRunsError] = useState("");
  const [mailSignals, setMailSignals] = useState<MailSignalsData | null>(null);
  const [mailSignalsError, setMailSignalsError] = useState("");
  const [mailSignalEntryRuns, setMailSignalEntryRuns] = useState<MailSignalEntryRunData[]>([]);
  const [mailSignalEntryRunError, setMailSignalEntryRunError] = useState("");
  const [liquidityEligibleRows, setLiquidityEligibleRows] = useState<LiquidityEligibleCacheRow[]>([]);
  const [liquidityEligibleError, setLiquidityEligibleError] = useState("");
  const [liquidityEligibleTotal, setLiquidityEligibleTotal] = useState(0);
  const [automationLogScopeFilter, setAutomationLogScopeFilter] = useState<"ANY" | ShortTermExchangeScope>("ANY");
  const [manualCycleExchangeScope, setManualCycleExchangeScope] = useState<ShortTermExchangeScope>("ALL");
  const [manualCycleBusy, setManualCycleBusy] = useState(false);
  const [manualCycleError, setManualCycleError] = useState("");
  const [manualCycleAsyncJobId, setManualCycleAsyncJobId] = useState<string | null>(null);
  const [manualCycleAsyncStatus, setManualCycleAsyncStatus] = useState<ShortTermAsyncJobStatus | null>(null);
  const [manualCycleAsyncNotified, setManualCycleAsyncNotified] = useState(false);
  const [realRecommendations, setRealRecommendations] = useState<RealRecommendationRow[]>([]);
  const [realRecommendationsGeneratedAt, setRealRecommendationsGeneratedAt] = useState<string | null>(null);
  const [realRecommendationsBusy, setRealRecommendationsBusy] = useState(false);
  const [realRecommendationsError, setRealRecommendationsError] = useState("");
  const [realRecommendationBuyBusySymbol, setRealRecommendationBuyBusySymbol] = useState("");
  const [realPendingOrders, setRealPendingOrders] = useState<CoreOrderRow[]>([]);
  const [realPendingOrdersBusy, setRealPendingOrdersBusy] = useState(false);
  const [realPendingOrdersError, setRealPendingOrdersError] = useState("");
  const [realPendingCancelBusyOrderId, setRealPendingCancelBusyOrderId] = useState("");
  const [realPendingDetailOrderId, setRealPendingDetailOrderId] = useState("");
  const [realPendingDetailEvents, setRealPendingDetailEvents] = useState<CoreOrderEventRow[]>([]);
  const [realPendingDetailBusy, setRealPendingDetailBusy] = useState(false);
  const [realPendingDetailError, setRealPendingDetailError] = useState("");
  const [realHoldingSellBusySymbol, setRealHoldingSellBusySymbol] = useState("");
  const [realShortTermLogScopeFilter, setRealShortTermLogScopeFilter] = useState<"ANY" | ShortTermExchangeScope>("ANY");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [accountProbeBusy, setAccountProbeBusy] = useState(false);
  const [accountProbeMessage, setAccountProbeMessage] = useState("");
  const [dnseAccountSummary, setDnseAccountSummary] = useState<{
    accountRows: number;
    subAccountRows: number;
    subAccounts: string[];
    accountName: string | null;
    depositedAmount: number | null;
    cashCurrent: number | null;
    tradableCash: number | null;
    holdings: DnseHoldingSummaryRow[];
  } | null>(null);

  const [demoSessionId, setDemoSessionId] = useState("default");
  const [demoSessions, setDemoSessions] = useState<Array<{ session_id: string; created_at: string }>>([]);
  const [demoSessionsLoading, setDemoSessionsLoading] = useState(false);
  const [demoCash, setDemoCash] = useState(DEMO_INITIAL_CASH_VND);
  const [demoPositions, setDemoPositions] = useState<DemoPosition[]>([]);
  const [demoUnrealizedPnl, setDemoUnrealizedPnl] = useState(0);
  const [demoOrders, setDemoOrders] = useState<DemoOrderItem[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLimit] = useState(30);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [demoSessionBusy, setDemoSessionBusy] = useState(false);
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [demoOverview, setDemoOverview] = useState<DemoSessionOverviewData | null>(null);
  const [demoOverviewError, setDemoOverviewError] = useState("");
  const [strategyCashTransferTarget, setStrategyCashTransferTarget] = useState<"SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED">(
    "SHORT_TERM",
  );
  const [strategyCashWithdrawSource, setStrategyCashWithdrawSource] = useState<"SHORT_TERM" | "MAIL_SIGNAL">("SHORT_TERM");
  const [strategyCashTransferAmount, setStrategyCashTransferAmount] = useState("");
  const [strategyCashWithdrawAmount, setStrategyCashWithdrawAmount] = useState("");
  const [strategyCashTransferBusy, setStrategyCashTransferBusy] = useState(false);
  const [holdingLastPriceBySymbol, setHoldingLastPriceBySymbol] = useState<Record<string, number>>({});
  const [demoPortfolioSnapshot, setDemoPortfolioSnapshot] = useState<DemoPortfolioSnapshot>({
    totalAssets: DEMO_INITIAL_CASH_VND,
    cashAvailable: DEMO_INITIAL_CASH_VND,
    stockValue: 0,
  });

  const schedulerAccountMode: "REAL" | "DEMO" = accountTab === "real" ? "REAL" : "DEMO";

  const automationRunLogGroups = useMemo(() => {
    const runsByMode = automationRuns.filter((run) => {
      const mode = String((run.detail?.account_mode as string | undefined) || "").trim().toUpperCase();
      return mode === schedulerAccountMode;
    });
    const scopedRuns = runsByMode.filter((run) => {
      if (automationLogScopeFilter === "ANY") {
        return true;
      }
      return parseShortTermRunExchangeScope(run.detail) === automationLogScopeFilter;
    });
    const orderedBuckets: ShortTermRunLogScopeBucket[] = [...SHORT_TERM_RUN_LOG_SCOPE_ORDER, "OTHER"];
    const buildGroupsForRuns = (runs: ShortTermAutomationRunRow[]) => {
      const buckets = new Map<ShortTermRunLogScopeBucket, ShortTermAutomationRunRow[]>();
      for (const bucket of orderedBuckets) {
        buckets.set(bucket, []);
      }
      for (const run of runs) {
        const bucket = shortTermRunLogScopeBucket(run.detail);
        buckets.get(bucket)?.push(run);
      }
      return orderedBuckets
        .map((bucket) => ({
          bucket,
          runs: (buckets.get(bucket) ?? []).slice(0, AUTO_TRADING_BACKEND_LOGS_PER_SCOPE),
        }))
        .filter((g) => g.runs.length > 0);
    };
    if (schedulerAccountMode !== "DEMO") {
      return [
        {
          sessionId: null as string | null,
          groups: buildGroupsForRuns(scopedRuns),
        },
      ].filter((block) => block.groups.length > 0);
    }
    const selectedSessionRows = scopedRuns.filter((run) => {
      const runSid = String((run.detail?.demo_session_id as string | undefined) || "").trim();
      return runSid === demoSessionId;
    });
    return [
      {
        sessionId: demoSessionId || null,
        groups: buildGroupsForRuns(selectedSessionRows),
      },
    ].filter((block) => block.sessionId && block.groups.length > 0);
  }, [automationLogScopeFilter, automationRuns, demoSessionId, schedulerAccountMode]);

  const scannerHealth = useMemo(() => {
    const scopedRuns = automationRuns
      .filter((run) => {
        const mode = String((run.detail?.account_mode as string | undefined) || "").trim().toUpperCase();
        return mode === schedulerAccountMode;
      })
      .filter((run) => {
        if (schedulerAccountMode !== "DEMO") {
          return true;
        }
        const sid = String((run.detail?.demo_session_id as string | undefined) || "").trim();
        return sid.length > 0 && sid === demoSessionId;
      })
      .slice(0, 10);
    if (scopedRuns.length === 0) {
      return null;
    }
    let totalScanned = 0;
    let totalBuy = 0;
    let totalExec = 0;
    let totalErrors = 0;
    let totalEntryGateSkip = 0;
    let totalCooldownSkip = 0;
    let totalDynamicFloorSkip = 0;
    let totalThresholdSourceClaude = 0;
    let totalThresholdSourceHeuristic = 0;
    let totalPlannedSpent = 0;
    let totalActualSpent = 0;
    let dynamicFloorSum = 0;
    let dynamicFloorCount = 0;
    for (const run of scopedRuns) {
      totalScanned += Number(run.scanned || 0);
      totalBuy += Number(run.buy_candidates || 0);
      totalExec += Number(run.executed || 0);
      totalErrors += Number(run.errors || 0);
      const detail = run.detail ?? {};
      const entryGate = asFiniteNumber(detail.skipped_entry_gate);
      const cooldown = asFiniteNumber(detail.skipped_experience_cooldown);
      const dynSkip = asFiniteNumber(detail.skipped_dynamic_buy_floor);
      const dynFloor = asFiniteNumber(detail.dynamic_buy_composite_floor);
      const sourceClaude = asFiniteNumber(detail.experience_threshold_source_claude);
      const sourceHeuristic = asFiniteNumber(detail.experience_threshold_source_heuristic);
      const decisionMeta = (detail.buy_decision_meta ?? {}) as Record<string, unknown>;
      const plannedSpent = asFiniteNumber(decisionMeta.planned_spent);
      const actualSpent = asFiniteNumber(decisionMeta.actual_spent);
      totalEntryGateSkip += entryGate ?? 0;
      totalCooldownSkip += cooldown ?? 0;
      totalDynamicFloorSkip += dynSkip ?? 0;
      totalThresholdSourceClaude += sourceClaude ?? 0;
      totalThresholdSourceHeuristic += sourceHeuristic ?? 0;
      totalPlannedSpent += plannedSpent ?? 0;
      totalActualSpent += actualSpent ?? 0;
      if (dynFloor != null) {
        dynamicFloorSum += dynFloor;
        dynamicFloorCount += 1;
      }
    }
    const n = scopedRuns.length;
    return {
      sampleSize: n,
      avgScanned: totalScanned / n,
      avgBuy: totalBuy / n,
      avgExecuted: totalExec / n,
      avgErrors: totalErrors / n,
      totalEntryGateSkip,
      totalCooldownSkip,
      totalDynamicFloorSkip,
      totalThresholdSourceClaude,
      totalThresholdSourceHeuristic,
      totalPlannedSpent,
      totalActualSpent,
      avgDynamicFloor: dynamicFloorCount > 0 ? dynamicFloorSum / dynamicFloorCount : null,
    };
  }, [automationRuns, demoSessionId, schedulerAccountMode]);

  const scannerHealthFlags = useMemo(() => {
    if (!scannerHealth) {
      return null;
    }
    const isErrHigh = scannerHealth.avgErrors > 0.5;
    const isCooldownSpike = scannerHealth.totalCooldownSkip >= 5;
    const isEntryGateTooTight = scannerHealth.totalEntryGateSkip >= 20;
    const isDynamicFloorHigh = (scannerHealth.avgDynamicFloor ?? 0) >= 62;
    const hasWarning = isErrHigh || isCooldownSpike || isEntryGateTooTight || isDynamicFloorHigh;
    return {
      hasWarning,
      isErrHigh,
      isCooldownSpike,
      isEntryGateTooTight,
      isDynamicFloorHigh,
    };
  }, [scannerHealth]);

  const realShortTermRuns = useMemo(() => {
    const rows = automationRuns
      .filter((run) => {
        const mode = String((run.detail?.account_mode as string | undefined) || "").trim().toUpperCase();
        return mode === "REAL";
      })
      .filter((run) => {
        if (realShortTermLogScopeFilter === "ANY") {
          return true;
        }
        return parseShortTermRunExchangeScope(run.detail) === realShortTermLogScopeFilter;
      });
    return rows.slice(0, 10);
  }, [automationRuns, realShortTermLogScopeFilter]);

  const realMailSignalRunLogs = useMemo(() => {
    return mailSignalEntryRuns
      .filter((run) => String(run.account_mode || "").trim().toUpperCase() === "REAL")
      .slice(0, 10);
  }, [mailSignalEntryRuns]);

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
        value: Number(h.position_value || 0),
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

    // Restore REAL automation configuration from localStorage.
    try {
      const modeRaw = window.localStorage.getItem(REAL_AUTOMATION_MODE_STORAGE_KEY) ?? "";
      const mode = modeRaw.trim().toUpperCase();
      if (mode === "SCAN_ONLY" || mode === "AUTO_TRADING") {
        setRealAutomationMode(mode);
      }

      const scanEnabledRaw = window.localStorage.getItem(REAL_SCAN_ONLY_SCHEDULE_ENABLED_STORAGE_KEY);
      if (scanEnabledRaw === "1" || scanEnabledRaw === "true") {
        setRealScanOnlyScheduleEnabled(true);
      } else if (scanEnabledRaw === "0" || scanEnabledRaw === "false") {
        setRealScanOnlyScheduleEnabled(false);
      }
    } catch {
      // Ignore storage failures; UI still works with defaults.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(REAL_AUTOMATION_MODE_STORAGE_KEY, realAutomationMode);
    } catch {
      // ignore
    }
  }, [realAutomationMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        REAL_SCAN_ONLY_SCHEDULE_ENABLED_STORAGE_KEY,
        realScanOnlyScheduleEnabled ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [realScanOnlyScheduleEnabled]);

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
        setDemoUnrealizedPnl(account.unrealized_pnl);
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
        const stockValue = Number(overview.stock_value || 0);
        const totalAssets = Number(overview.total_assets || 0);
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

  const handleTransferUnallocatedCash = useCallback(async () => {
    const amount = Number(strategyCashTransferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDemoOverviewError("So tien chuyen phai > 0.");
      return;
    }
    setStrategyCashTransferBusy(true);
    try {
      await transferDemoStrategyCash(demoSessionId, {
        from_strategy: "UNALLOCATED",
        to_strategy: strategyCashTransferTarget,
        amount_vnd: amount,
      });
      if (strategyCashTransferTarget === "UNALLOCATED") {
        pushDemoLog(`Da nap them ${formatVnd(amount)} VND tu ben ngoai vao UNALLOCATED.`);
      } else {
        pushDemoLog(`Da chuyen ${formatVnd(amount)} VND tu UNALLOCATED sang ${strategyCashTransferTarget}.`);
      }
      setStrategyCashTransferAmount("");
      await refreshDemoOverview(demoSessionId);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Chuyen tien strategy that bai.";
      setDemoOverviewError(message);
      pushDemoLog(message);
    } finally {
      setStrategyCashTransferBusy(false);
    }
  }, [demoSessionId, pushDemoLog, refreshDemoOverview, strategyCashTransferAmount, strategyCashTransferTarget]);

  const handleWithdrawToUnallocated = useCallback(async () => {
    const amount = Number(strategyCashWithdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDemoOverviewError("So tien rut phai > 0.");
      return;
    }
    setStrategyCashTransferBusy(true);
    try {
      await transferDemoStrategyCash(demoSessionId, {
        from_strategy: strategyCashWithdrawSource,
        to_strategy: "UNALLOCATED",
        amount_vnd: amount,
      });
      pushDemoLog(`Da rut ${formatVnd(amount)} VND tu ${strategyCashWithdrawSource} ve UNALLOCATED.`);
      setStrategyCashWithdrawAmount("");
      await refreshDemoOverview(demoSessionId);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Rut tien ve UNALLOCATED that bai.";
      setDemoOverviewError(message);
      pushDemoLog(message);
    } finally {
      setStrategyCashTransferBusy(false);
    }
  }, [demoSessionId, pushDemoLog, refreshDemoOverview, strategyCashWithdrawAmount, strategyCashWithdrawSource]);

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

  const loadMailSignals = useCallback(async () => {
    try {
      const row = await fetchMailSignalsLatest();
      setMailSignals(row);
      setMailSignalsError("");
    } catch (error) {
      setMailSignals(null);
      setMailSignalsError(isAppError(error) ? error.message : "Khong tai duoc mail signals moi nhat.");
    }
  }, []);

  const loadMailSignalEntryRuns = useCallback(async () => {
    try {
      const response = await fetchMailSignalEntryRunsRecent(10, {
        demoSessionId: schedulerAccountMode === "DEMO" ? demoSessionId : null,
      });
      setMailSignalEntryRuns(response.data);
      setMailSignalEntryRunError("");
    } catch (error) {
      setMailSignalEntryRuns([]);
      setMailSignalEntryRunError(isAppError(error) ? error.message : "Khong tai duoc 10 entry scheduler log gan nhat.");
    }
  }, [demoSessionId, schedulerAccountMode]);

  const loadLiquidityEligibleRows = useCallback(async () => {
    try {
      const response = await fetchShortTermLiquidityEligibleCache("ALL", 600);
      setLiquidityEligibleRows(response.data);
      setLiquidityEligibleTotal(Number(response.meta?.total_matched ?? response.data.length));
      setLiquidityEligibleError("");
    } catch (error) {
      setLiquidityEligibleRows([]);
      setLiquidityEligibleTotal(0);
      setLiquidityEligibleError(isAppError(error) ? error.message : "Khong tai duoc liquidity cache rows.");
    }
  }, []);

  const loadRealRecommendations = useCallback(async () => {
    try {
      const response = await fetchRealRecommendationsLatest();
      setRealRecommendations(response.recommendations ?? []);
      setRealRecommendationsGeneratedAt(response.generated_at ?? null);
      setRealRecommendationsError("");
    } catch (error) {
      setRealRecommendations([]);
      setRealRecommendationsGeneratedAt(null);
      setRealRecommendationsError(isAppError(error) ? error.message : "Khong tai duoc danh sach khuyen nghi REAL.");
    }
  }, []);

  const loadRealPendingOrders = useCallback(async () => {
    setRealPendingOrdersBusy(true);
    try {
      const rows = await getCoreOrders("REAL", 120);
      const pending = rows.filter((row) => {
        const status = String(row.status || "").trim().toUpperCase();
        return status === "NEW" || status === "SENT" || status === "ACK" || status === "PARTIAL";
      });
      setRealPendingOrders(pending);
      setRealPendingOrdersError("");
    } catch (error) {
      setRealPendingOrders([]);
      setRealPendingOrdersError(isAppError(error) ? error.message : "Khong tai duoc lenh REAL dang pending.");
    } finally {
      setRealPendingOrdersBusy(false);
    }
  }, []);

  const handlePollRealPendingOrders = useCallback(async () => {
    setRealPendingOrdersBusy(true);
    try {
      const rows = await getCoreOrders("REAL", 120);
      const pendingIds = rows
        .filter((row) => {
          const status = String(row.status || "").trim().toUpperCase();
          return status === "NEW" || status === "SENT" || status === "ACK" || status === "PARTIAL";
        })
        .map((row) => row.id);
      for (const orderId of pendingIds.slice(0, 30)) {
        try {
          await reconcileExecutionOrder(orderId);
        } catch {
          // Keep polling resilient per order.
        }
      }
      await loadRealPendingOrders();
    } catch (error) {
      setRealPendingOrdersError(isAppError(error) ? error.message : "Poll lenh REAL pending that bai.");
    } finally {
      setRealPendingOrdersBusy(false);
    }
  }, [loadRealPendingOrders]);

  const handleCancelRealPendingOrder = useCallback(
    async (orderId: string) => {
      const trimmed = String(orderId || "").trim();
      if (!trimmed) {
        return;
      }
      const confirmed = window.confirm(`Xac nhan huy lenh ${trimmed}?`);
      if (!confirmed) {
        return;
      }
      setRealPendingCancelBusyOrderId(trimmed);
      try {
        const response = await cancelExecutionOrder(trimmed);
        const success = Boolean((response as { success?: boolean }).success);
        if (!success) {
          throw new Error(String(((response as { data?: { reason?: string } }).data?.reason ?? "cancel_failed")));
        }
        showToast(`Da huy lenh ${trimmed}.`, "success");
        await loadRealPendingOrders();
      } catch (error) {
        const message = isAppError(error) ? error.message : `Huy lenh that bai: ${trimmed}`;
        setRealPendingOrdersError(message);
        showToast(message, "error");
      } finally {
        setRealPendingCancelBusyOrderId("");
      }
    },
    [loadRealPendingOrders, showToast],
  );

  const handleShowRealPendingOrderDetail = useCallback(async (order: CoreOrderRow) => {
    const orderId = String(order.id || "").trim();
    if (!orderId) {
      return;
    }
    setRealPendingDetailOrderId(orderId);
    setRealPendingDetailBusy(true);
    setRealPendingDetailError("");
    try {
      const events = await getOrderEvents(orderId);
      setRealPendingDetailEvents(events);
    } catch (error) {
      setRealPendingDetailEvents([]);
      setRealPendingDetailError(isAppError(error) ? error.message : `Khong tai duoc detail cho lenh ${orderId}.`);
    } finally {
      setRealPendingDetailBusy(false);
    }
  }, []);

  const handleSellRealHolding = useCallback(
    async (row: DnseHoldingSummaryRow) => {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      const quantity = Math.trunc(Number(row.quantity || 0));
      const market = row.marketPrice != null ? normalizeVnStockPrice(Number(row.marketPrice)) : 0;
      const average = row.averagePrice != null ? normalizeVnStockPrice(Number(row.averagePrice)) : 0;
      const price = market > 0 ? market : average;
      const confirmed = window.confirm(
        `Xac nhan dat lenh BAN?\nSymbol: ${symbol}\nSo luong: ${quantity}\nGia dat: ${formatPrice(price)}`,
      );
      if (!confirmed) {
        return;
      }
      if (!symbol || quantity <= 0 || price <= 0) {
        const message = "Khong du du lieu de dat lenh BAN (symbol/quantity/price).";
        showToast(message, "error");
        return;
      }
      setRealHoldingSellBusySymbol(symbol);
      try {
        const response = await placeExecutionOrder({
          account_mode: "REAL",
          symbol,
          side: "SELL",
          quantity,
          price,
          auto_process: true,
          metadata: {
            source: "real_holdings_action_sell",
            market_price_snapshot: market > 0 ? market : null,
            average_price_snapshot: average > 0 ? average : null,
          },
        });
        const success = Boolean((response as { success?: boolean }).success);
        if (!success) {
          const reason = String(((response as { data?: { reason?: string } }).data?.reason ?? "sell_order_rejected"));
          throw new Error(reason);
        }
        showToast(`Da gui lenh BAN ${symbol} (${quantity} cp).`, "success");
        await loadRealPendingOrders();
      } catch (error) {
        const message = isAppError(error) ? error.message : `Dat lenh BAN that bai cho ${symbol}.`;
        showToast(message, "error");
      } finally {
        setRealHoldingSellBusySymbol("");
      }
    },
    [loadRealPendingOrders, showToast],
  );

  const handleScanRealRecommendations = useCallback(async () => {
    setRealRecommendationsBusy(true);
    try {
      const response = await postRealRecommendationsScan({
        exchange_scope: "ALL",
        limit_symbols: 0,
      });
      setRealRecommendations(response.recommendations ?? []);
      setRealRecommendationsGeneratedAt(response.generated_at ?? null);
      setRealRecommendationsError("");
      showToast(`Da luu ${Number(response.count || 0)} khuyen nghi BUY vao Redis.`, "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : "Scan recommendations REAL that bai.";
      setRealRecommendationsError(message);
      showToast(message, "error");
    } finally {
      setRealRecommendationsBusy(false);
    }
  }, [showToast]);

  const handleActionBuyRealRecommendation = useCallback(
    async (row: RealRecommendationRow) => {
      const confirmed = window.confirm(
        `Xac nhan Action Buy?\nSymbol: ${row.symbol}\nEntry: ${formatPrice(row.entry)}\nTP: ${formatPrice(row.take_profit)}\nSL: ${formatPrice(row.stop_loss)}`,
      );
      if (!confirmed) {
        return;
      }
      const availableCash = Number(dnseAccountSummary?.tradableCash ?? 0);
      if (!Number.isFinite(availableCash) || availableCash <= 0) {
        const message = "Khong tim thay available cash REAL. Vui long tai lai thong tin tai khoan DNSE.";
        setRealRecommendationsError(message);
        showToast(message, "error");
        return;
      }
      setRealRecommendationBuyBusySymbol(row.symbol);
      try {
        const response = await postRealRecommendationActionBuy({
          ...row,
          available_cash_vnd: availableCash,
        });
        const success = Boolean((response as { success?: boolean }).success);
        if (!success) {
          const reason = String(((response as { data?: { reason?: string } }).data?.reason ?? "action_buy_rejected"));
          throw new Error(reason);
        }
        showToast(`Da gui lenh BUY cho ${row.symbol}.`, "success");
        await loadRealPendingOrders();
      } catch (error) {
        const message = isAppError(error) ? error.message : `Action Buy that bai cho ${row.symbol}.`;
        setRealRecommendationsError(message);
        showToast(message, "error");
      } finally {
        setRealRecommendationBuyBusySymbol("");
      }
    },
    [dnseAccountSummary?.tradableCash, loadRealPendingOrders, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sessionList, schedulerActive] = await Promise.all([
          fetchDemoSessions(100, 0),
          fetchSchedulerDemoSession().catch(() => null),
        ]);
        if (cancelled) {
          return;
        }
        const items = sessionList.items ?? [];
        setDemoSessions(items.map((item) => ({ session_id: item.session_id, created_at: item.created_at })));

        const storedSessionId = getStoredDemoSessionId();
        const schedulerSessionId = (schedulerActive ?? "").trim();
        const existingIds = new Set(items.map((item) => item.session_id));
        let resolvedSessionId = "";
        if (storedSessionId && existingIds.has(storedSessionId)) {
          resolvedSessionId = storedSessionId;
        } else if (schedulerSessionId && existingIds.has(schedulerSessionId)) {
          resolvedSessionId = schedulerSessionId;
        } else if (items.length > 0) {
          resolvedSessionId = items[0].session_id;
        } else {
          resolvedSessionId = await createNewDemoSession();
        }
        if (cancelled) {
          return;
        }
        window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, resolvedSessionId);
        setDemoSessionId(resolvedSessionId);
        await setSchedulerDemoSession(resolvedSessionId);
        if (cancelled) {
          return;
        }
        setHistoryOffset(0);
        await refreshDemoAccount(resolvedSessionId, { offset: 0 });
        await refreshDemoOverview(resolvedSessionId);
        await refreshDemoSessions();
      } catch {
        // Keep UI resilient during initial demo session bootstrap.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDemoAccount, refreshDemoOverview, refreshDemoSessions]);

  useEffect(() => {
    void loadSchedulerStatus();
    void loadAutomationRuns();
    void loadMailSignals();
    void loadMailSignalEntryRuns();
    void loadLiquidityEligibleRows();
    void loadRealRecommendations();
    void loadRealPendingOrders();
  }, [
    loadAutomationRuns,
    loadLiquidityEligibleRows,
    loadMailSignalEntryRuns,
    loadMailSignals,
    loadRealPendingOrders,
    loadRealRecommendations,
    loadSchedulerStatus,
  ]);

  useEffect(() => {
    // Match BE scan cadence: `interval_minutes` === `short_term_scan_interval_minutes` (not scheduler poll loop).
    const intervalMinutes = Math.min(120, Math.max(1, schedulerStatus?.interval_minutes ?? 15));
    const intervalMs = intervalMinutes * 60 * 1000;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadSchedulerStatus();
      void loadAutomationRuns();
      void loadMailSignals();
      void loadMailSignalEntryRuns();
      void loadLiquidityEligibleRows();
      void loadRealRecommendations();
      void loadRealPendingOrders();
    };

    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [
    loadAutomationRuns,
    loadLiquidityEligibleRows,
    loadMailSignalEntryRuns,
    loadMailSignals,
    loadRealPendingOrders,
    loadRealRecommendations,
    loadSchedulerStatus,
    schedulerAccountMode,
    schedulerStatus?.interval_minutes,
  ]);

  // FE no longer performs the scan-only schedule.
  // Backend scheduler (REAL mode) is responsible for calling /automation/real/recommendations/scan
  // on the VN trading grid every interval.

  const handleDnseLogin = async () => {
    setSessionBusy(true);
    try {
      await dnseAuthLogin(username.trim(), password);
      setPassword("");
      setSessionActive(true);
      await handleProbeAccount();
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
    setDnseAccountSummary(null);
    setAccountProbeMessage("");
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
      const preferredSubAccount = nums[0];
      const balanceRows = preferredSubAccount
        ? extractDnseRecords(await fetchDnseAccountBalance({ ...creds, sub_account: preferredSubAccount }))
        : [];
      const holdings = extractDnseHoldingsFromRows(balanceRows);
      const cashCurrent = extractDnseCashFromRows(balanceRows) ?? extractDnseCashFromRows(accRows);
      const tradableCash = extractDnseTradableCashFromRows(balanceRows) ?? extractDnseTradableCashFromRows(accRows);
      const accountName = extractDnseAccountNameFromRows(accRows);
      const depositedInfo = extractDnseDepositedAmountFromRows(accRows);
      setDnseAccountSummary({
        accountRows: accRows.length,
        subAccountRows: subRows.length,
        subAccounts: nums,
        accountName,
        depositedAmount: depositedInfo?.value ?? null,
        cashCurrent,
        tradableCash: tradableCash ?? cashCurrent,
        holdings,
      });
      setAccountProbeMessage(
        UI_TEXT.autoTrading.accountProbeOk(accRows.length, subRows.length, nums.length),
      );
    } catch (error) {
      setDnseAccountSummary(null);
      setAccountProbeMessage(isAppError(error) ? error.message : UI_TEXT.autoTrading.accountProbeFailed);
    } finally {
      setAccountProbeBusy(false);
    }
  };

  useEffect(() => {
    if (accountTab !== "real") {
      return;
    }
    if (!hasDnseSession()) {
      return;
    }
    if (accountProbeBusy) {
      return;
    }
    if (dnseAccountSummary) {
      return;
    }
    void handleProbeAccount();
  }, [accountTab, accountProbeBusy, dnseAccountSummary, handleProbeAccount]);

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

  const handleDeleteCurrentDemoSession = async () => {
    if (demoSessionBusy) {
      return;
    }
    if (!demoSessionId.trim()) {
      pushDemoLog("Khong co demo session hien tai de xoa.");
      return;
    }
    const confirmed = window.confirm(UI_TEXT.autoTrading.demoDeleteSessionConfirm(demoSessionId));
    if (!confirmed) {
      return;
    }
    setDemoSessionBusy(true);
    try {
      const deletedSessionId = await deleteCurrentDemoSession(demoSessionId);
      const sessionList = await fetchDemoSessions(100, 0);
      const remainingSessions = (sessionList.items ?? []).filter((item) => item.session_id !== deletedSessionId);
      let nextSessionId = remainingSessions[0]?.session_id?.trim() ?? "";
      if (!nextSessionId) {
        nextSessionId = await createNewDemoSession();
      }
      window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, nextSessionId);
      setDemoSessionId(nextSessionId);
      await setSchedulerDemoSession(nextSessionId || null);
      setHistoryOffset(0);
      setDemoOrders([]);
      setDemoLog([]);
      setDemoPositions([]);
      setDemoUnrealizedPnl(0);
      setDemoCash(DEMO_INITIAL_CASH_VND);
      setDemoOverview(null);
      setDemoOverviewError("");
      setDemoPortfolioSnapshot({
        totalAssets: DEMO_INITIAL_CASH_VND,
        cashAvailable: DEMO_INITIAL_CASH_VND,
        stockValue: 0,
      });
      await refreshDemoSessions();
      await refreshDemoAccount(nextSessionId, { offset: 0 });
      await refreshDemoOverview(nextSessionId);
      pushDemoLog(UI_TEXT.autoTrading.demoDeleteSessionSuccess(deletedSessionId, nextSessionId));
    } catch (error) {
      const message = isAppError(error) ? error.message : "Xoa phien demo hien tai that bai.";
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
      await loadAutomationRuns();
    } catch (error) {
      setSchedulerError(isAppError(error) ? error.message : "Khong toggle duoc auto trading.");
    } finally {
      setSchedulerBusy(false);
    }
  };

  // Keep backend scheduler aligned with REAL mode selection.
  // - SCAN_ONLY: production scheduler must be disabled; scan-only scheduler follows master toggle.
  // - AUTO_TRADING: scan-only scheduler must be disabled; production scheduler follows master toggle.
  useEffect(() => {
    if (!schedulerStatus) {
      return;
    }
    if (schedulerBusy) {
      return;
    }
    // This sync effect is meant to control REAL backend scheduler behavior.
    // When user is on the Demo tab, schedulerAccountMode becomes "DEMO" and calling
    // handleToggleScheduler() would incorrectly toggle DEMO auto scheduling.
    if (accountTab !== "real") {
      return;
    }

    const sync = async () => {
      if (realAutomationMode === "SCAN_ONLY") {
        // Disable production scheduler for REAL.
        if (schedulerStatus.enabled) {
          await handleToggleScheduler();
        }

        // Enable/disable scan-only scheduler.
        const desiredScanOnlyEnabled = realScanOnlyScheduleEnabled;
        if (
          lastRealScanOnlyScheduleEnabledRef.current !== desiredScanOnlyEnabled &&
          !realScanOnlySchedulerToggleBusyRef.current
        ) {
          realScanOnlySchedulerToggleBusyRef.current = true;
          try {
            setSchedulerError("");
            await toggleRealScanOnlyScheduler(desiredScanOnlyEnabled);
            lastRealScanOnlyScheduleEnabledRef.current = desiredScanOnlyEnabled;
          } catch (error) {
            setSchedulerError(isAppError(error) ? error.message : "Khong toggle duoc schedule SCAN_ONLY tren BE.");
          } finally {
            realScanOnlySchedulerToggleBusyRef.current = false;
          }
        }
        return;
      }

      // AUTO_TRADING: disable scan-only scheduler.
      const desiredScanOnlyEnabled = false;
      if (
        lastRealScanOnlyScheduleEnabledRef.current !== desiredScanOnlyEnabled &&
        !realScanOnlySchedulerToggleBusyRef.current
      ) {
        realScanOnlySchedulerToggleBusyRef.current = true;
        try {
          setSchedulerError("");
          await toggleRealScanOnlyScheduler(false);
          lastRealScanOnlyScheduleEnabledRef.current = false;
        } catch (error) {
          setSchedulerError(isAppError(error) ? error.message : "Khong toggle duoc schedule SCAN_ONLY OFF tren BE.");
        } finally {
          realScanOnlySchedulerToggleBusyRef.current = false;
        }
      }

      // Production scheduler follows master toggle.
      const desiredBackendEnabled = realScanOnlyScheduleEnabled;
      if (schedulerStatus.enabled !== desiredBackendEnabled) {
        await handleToggleScheduler();
      }
    };

    void sync();
  }, [
    accountTab,
    schedulerStatus,
    schedulerBusy,
    realAutomationMode,
    realScanOnlyScheduleEnabled,
    handleToggleScheduler,
  ]);

  const handleManualShortTermCycle = async () => {
    setManualCycleBusy(true);
    setManualCycleError("");
    try {
      if (schedulerAccountMode === "REAL") {
        await postRealRecommendationsScan({
          exchange_scope: manualCycleExchangeScope,
        });
        setManualCycleAsyncJobId(null);
        setManualCycleAsyncStatus(null);
        setManualCycleAsyncNotified(false);
        await Promise.all([loadRealRecommendations(), loadAutomationRuns()]);
        showToast("REAL manual cycle da chuyen sang scan-only recommendations.", "success");
        return;
      }
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
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
            accountTab === "real"
              ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
              : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {UI_TEXT.autoTrading.tabReal}
        </button>
        <button
          type="button"
          onClick={() => setAccountTab("demo")}
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
            accountTab === "demo"
              ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
              : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {UI_TEXT.autoTrading.tabDemo}
        </button>
        {accountTab === "demo" ? (
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
        ) : null}
      </div>
      {accountTab === "real" ? (
        <div className="flex flex-col gap-10">
          <section className="glass-panel rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.autoTrading.dnseTitle}</h2>
            <p className="mt-2 text-xs text-slate-400">{UI_TEXT.autoTrading.dnseHint}</p>
            <p className="mt-3 text-xs text-slate-500">
              {sessionActive ? UI_TEXT.dnse.sessionActive : UI_TEXT.dnse.sessionNone}
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRealAutomationMode("SCAN_ONLY")}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    realAutomationMode === "SCAN_ONLY"
                      ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
                      : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-slate-200"
                  }`}
                  disabled={schedulerBusy}
                >
                  Scan only
                </button>
                <button
                  type="button"
                  onClick={() => setRealAutomationMode("AUTO_TRADING")}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    realAutomationMode === "AUTO_TRADING"
                      ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
                      : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-slate-200"
                  }`}
                  disabled={schedulerBusy}
                >
                  Auto trading
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {realAutomationMode === "SCAN_ONLY" ? (
                  <>
                    <span className="text-xs text-slate-400">
                      Scan-only schedule: {realScanOnlyScheduleEnabled ? "ON" : "OFF"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRealScanOnlyScheduleEnabled((v) => !v)}
                      disabled={schedulerBusy}
                      className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                    >
                      {realScanOnlyScheduleEnabled ? "Tat scan" : "Bat scan"}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">
                      Auto REAL backend: {schedulerStatus?.enabled ? "ON" : "OFF"} /{" "}
                      {schedulerStatus?.running ? "RUNNING" : "STOPPED"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRealScanOnlyScheduleEnabled((v) => !v)}
                      disabled={schedulerBusy}
                      className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                    >
                      {realScanOnlyScheduleEnabled ? "Tat Auto" : "Bat Auto"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {!sessionActive ? (
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
            ) : (
              <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={handleDnseLogout}
                  className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
                >
                  {UI_TEXT.dnse.sessionLogout}
                </button>
                <div className="w-full max-w-[220px] rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
                  <p className="text-xs font-semibold text-cyan-100">QR nap tien DNSE</p>
                  {DNSE_DEPOSIT_QR_URL ? (
                    <div className="mt-2 flex justify-center">
                      <img
                        src={DNSE_DEPOSIT_QR_URL}
                        alt="DNSE deposit QR"
                        className="h-40 w-40 rounded-md border border-white/10 bg-white p-1 object-contain"
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Chua cau hinh QR. Them `NEXT_PUBLIC_DNSE_DEPOSIT_QR_URL`.
                    </p>
                  )}
                </div>
              </div>
            )}
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
              {sessionActive && dnseAccountSummary ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-md border border-white/10 bg-black/20 p-2">
                    <p className="text-[11px] text-slate-500">Chu tai khoan</p>
                    <p className="font-semibold text-cyan-100">{dnseAccountSummary.accountName || "-"}</p>
                  </div>
                  <div className="grid gap-2 text-xs text-slate-300 md:grid-cols-4">
                    <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 p-2">
                      <p className="text-[11px] text-emerald-200/80">Cash hien tai</p>
                      <p
                        className={`font-semibold ${
                          dnseAccountSummary.depositedAmount != null &&
                          dnseAccountSummary.cashCurrent != null &&
                          dnseAccountSummary.cashCurrent < dnseAccountSummary.depositedAmount
                            ? "text-rose-200"
                            : "text-emerald-100"
                        }`}
                      >
                        {(() => {
                          if (dnseAccountSummary.cashCurrent == null) {
                            return "-";
                          }
                          const cashText = `${formatVnd(dnseAccountSummary.cashCurrent)} VND`;
                          if (dnseAccountSummary.depositedAmount == null || dnseAccountSummary.depositedAmount <= 0) {
                            return cashText;
                          }
                          const diff = dnseAccountSummary.cashCurrent - dnseAccountSummary.depositedAmount;
                          const pct = (diff / dnseAccountSummary.depositedAmount) * 100;
                          const sign = pct > 0 ? "+" : "";
                          return `${cashText} (${sign}${pct.toFixed(2)}%)`;
                        })()}
                      </p>
                    </div>
                    <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-2">
                      <p className="text-[11px] text-cyan-200/80">So tien nap vao</p>
                      <p className="font-semibold text-cyan-100">
                        {dnseAccountSummary.depositedAmount != null
                          ? `${formatVnd(dnseAccountSummary.depositedAmount)} VND`
                          : "Khong co du lieu initialBalance"}
                      </p>
                    </div>
                    <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-2">
                      <p className="text-[11px] text-amber-100/80">Cash kha dung de trading</p>
                      <p className="font-semibold text-amber-200">
                        {dnseAccountSummary.tradableCash != null
                          ? `${formatVnd(dnseAccountSummary.tradableCash)} VND`
                          : "-"}
                      </p>
                    </div>
                    <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-2">
                      <p className="text-[11px] text-cyan-200/80">Ma dang nam giu</p>
                      <p className="font-semibold text-cyan-100">{dnseAccountSummary.holdings.length}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/20 p-2">
                    <p className="text-[11px] text-slate-500">Sub-accounts</p>
                    <p className="font-mono text-[11px] text-emerald-200">
                      {dnseAccountSummary.subAccounts.length > 0 ? dnseAccountSummary.subAccounts.join(", ") : "-"}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/20 p-2">
                    <p className="mb-2 text-[11px] text-slate-400">Danh muc dang nam giu</p>
                    {dnseAccountSummary.holdings.length === 0 ? (
                      <p className="text-[11px] text-slate-500">Khong co vi the co phieu hoac DNSE khong tra ve du lieu holdings.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto overflow-x-auto">
                        <table className="w-full min-w-[520px] text-left text-[11px] text-slate-200">
                          <thead className="border-b border-white/10 text-slate-500">
                            <tr>
                              <th className="py-1.5 pr-3">Symbol</th>
                              <th className="py-1.5 pr-3">Qty</th>
                              <th className="py-1.5 pr-3">Avg</th>
                              <th className="py-1.5">Market</th>
                              <th className="py-1.5">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dnseAccountSummary.holdings.map((row) => (
                              <tr key={row.symbol} className="border-b border-white/5">
                                <td className="py-1.5 pr-3 font-mono text-cyan-100">{row.symbol}</td>
                                <td className="py-1.5 pr-3">{row.quantity}</td>
                                <td className="py-1.5 pr-3">{row.averagePrice != null ? formatPrice(row.averagePrice) : "-"}</td>
                                <td className="py-1.5 pr-3">{row.marketPrice != null ? formatPrice(row.marketPrice) : "-"}</td>
                                <td className="py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void handleSellRealHolding(row)}
                                    disabled={realHoldingSellBusySymbol === row.symbol}
                                    className="rounded-md border border-amber-300/40 px-2 py-1 text-[11px] font-semibold text-amber-100 disabled:opacity-50"
                                  >
                                    {realHoldingSellBusySymbol === row.symbol ? "Dang ban..." : "Ban"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-200">Lenh REAL dang dat nhung chua khop</p>
                <button
                  type="button"
                  onClick={() => void handlePollRealPendingOrders()}
                  disabled={realPendingOrdersBusy}
                  className="rounded-md border border-cyan-300/40 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
                >
                  {realPendingOrdersBusy ? "Dang poll..." : "Poll DNSE"}
                </button>
              </div>
              {realPendingOrdersError ? <p className="mt-2 text-[11px] text-rose-300">{realPendingOrdersError}</p> : null}
              {realPendingOrders.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-500">Khong co lenh pending (NEW/SENT/ACK/PARTIAL).</p>
              ) : (
                <div className="mt-2 max-h-52 overflow-y-auto overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-[11px] text-slate-200">
                    <thead className="border-b border-white/10 text-slate-500">
                      <tr>
                        <th className="py-1.5 pr-3">Time</th>
                        <th className="py-1.5 pr-3">Symbol</th>
                        <th className="py-1.5 pr-3">Side</th>
                        <th className="py-1.5 pr-3">Qty</th>
                        <th className="py-1.5 pr-3">Price</th>
                        <th className="py-1.5 pr-3">Status</th>
                        <th className="py-1.5 pr-3">Broker ID</th>
                        <th className="py-1.5">Reason</th>
                        <th className="py-1.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realPendingOrders.map((order) => (
                        <tr key={order.id} className="border-b border-white/5">
                          <td className="py-1.5 pr-3 text-slate-400">{formatDateTime(order.created_at)}</td>
                          <td className="py-1.5 pr-3 font-mono text-cyan-100">{order.symbol}</td>
                          <td className="py-1.5 pr-3">{order.side}</td>
                          <td className="py-1.5 pr-3">{order.quantity}</td>
                          <td className="py-1.5 pr-3">{formatPrice(order.price)}</td>
                          <td className={`py-1.5 pr-3 ${statusClass(order.status)}`}>{order.status}</td>
                          <td className="py-1.5 pr-3 font-mono text-slate-400">{order.broker_order_id || "-"}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{order.reason || "-"}</td>
                          <td className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleShowRealPendingOrderDetail(order)}
                                disabled={realPendingDetailBusy && realPendingDetailOrderId === order.id}
                                className="rounded-md border border-cyan-300/40 px-2 py-1 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
                              >
                                {realPendingDetailBusy && realPendingDetailOrderId === order.id ? "Dang tai..." : "Detail"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCancelRealPendingOrder(order.id)}
                                disabled={realPendingCancelBusyOrderId === order.id}
                                className="rounded-md border border-rose-300/40 px-2 py-1 text-[11px] font-semibold text-rose-200 disabled:opacity-50"
                              >
                                {realPendingCancelBusyOrderId === order.id ? "Dang huy..." : "Huy lenh"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {realPendingDetailOrderId ? (
                <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-cyan-100">
                      Detail lenh dang dat: <span className="font-mono">{realPendingDetailOrderId}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setRealPendingDetailOrderId("");
                        setRealPendingDetailEvents([]);
                        setRealPendingDetailError("");
                      }}
                      className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-slate-300"
                    >
                      Dong
                    </button>
                  </div>
                  {realPendingDetailError ? <p className="mt-2 text-[11px] text-rose-300">{realPendingDetailError}</p> : null}
                  {realPendingDetailBusy ? (
                    <p className="mt-2 text-[11px] text-slate-400">Dang tai timeline events...</p>
                  ) : realPendingDetailEvents.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500">Chua co event cho lenh nay.</p>
                  ) : (
                    <div className="mt-2 max-h-44 overflow-y-auto text-[11px] font-mono text-slate-300">
                      {realPendingDetailEvents.map((event) => (
                        <div key={event.id} className="border-b border-white/5 py-1.5">
                          <p>
                            <span className="text-cyan-200">{formatDateTime(event.created_at)}</span> |{" "}
                            <span className={statusClass(event.status)}>{event.status}</span>
                          </p>
                          <p className="text-slate-400">{event.message || "-"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">REAL Recommendations (scan-only)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Scan xong se chi luu khuyen nghi vao Redis, khong tu dong dat lenh mua.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleScanRealRecommendations()}
                disabled={realRecommendationsBusy || !sessionActive}
                className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
              >
                {realRecommendationsBusy ? "Dang scan recommendations..." : "Scan recommendations"}
              </button>
            </div>
            {realRecommendationsError ? <p className="mt-2 text-xs text-rose-300">{realRecommendationsError}</p> : null}
            {realRecommendationsGeneratedAt ? (
              <p className="mt-2 text-[11px] text-slate-500">Generated: {formatDateTime(realRecommendationsGeneratedAt)}</p>
            ) : null}
            {realRecommendations.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Chua co khuyen nghi BUY trong Redis.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-xs text-slate-200">
                  <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Entry</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Take profit</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Stop loss</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Confidence</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Reason</th>
                      <th className="py-2.5 whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realRecommendations.map((item, idx) => (
                      <tr key={`${item.symbol}-${idx}`} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 font-mono text-cyan-200">{item.symbol}</td>
                        <td className="py-2 pr-3 text-slate-100">{formatPrice(item.entry)}</td>
                        <td className="py-2 pr-3 text-emerald-300">{formatPrice(item.take_profit)}</td>
                        <td className="py-2 pr-3 text-rose-300">{formatPrice(item.stop_loss)}</td>
                        <td className="py-2 pr-3 text-amber-300">{Number(item.confidence || 0).toFixed(1)}%</td>
                        <td className="py-2 pr-3 text-slate-300">{item.reason || "-"}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => void handleActionBuyRealRecommendation(item)}
                            disabled={
                              !sessionActive ||
                              realRecommendationBuyBusySymbol === item.symbol ||
                              !Number.isFinite(Number(dnseAccountSummary?.tradableCash ?? 0))
                            }
                            className="rounded-md border border-emerald-300/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
                          >
                            {realRecommendationBuyBusySymbol === item.symbol ? "Dang mua..." : "Action Buy"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">
              Liquidity Cache Picks (eligible_spike=true + eligible_liquidity=true)
            </h3>
            {liquidityEligibleError ? <p className="mt-2 text-xs text-rose-300">{liquidityEligibleError}</p> : null}
            {liquidityEligibleRows.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Chua co ma dat du ca 2 dieu kien trong Redis cache.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p className="text-slate-400">
                  Tong so ma dat chuan: <span className="font-semibold text-cyan-200">{liquidityEligibleTotal}</span>
                </p>
                <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-md border border-white/10">
                  <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
                    <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Exchange</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Spike ratio</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Baseline vol</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Latest vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquidityEligibleRows.map((row) => (
                        <tr key={row.redis_key} className="border-b border-white/5 align-top">
                          <td className="py-2 pr-3 font-mono text-cyan-200">{row.symbol}</td>
                          <td className="py-2 pr-3 text-slate-300">{row.exchange}</td>
                          <td className="py-2 pr-3 text-emerald-300">{Number(row.spike_ratio || 0).toFixed(2)}x</td>
                          <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.baseline_vol || 0))}</td>
                          <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.latest_vol || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Mail Signals</h3>
            {mailSignalsError ? <p className="mt-2 text-xs text-rose-300">{mailSignalsError}</p> : null}
            {!mailSignals ? (
              <p className="mt-3 text-xs text-slate-500">Chua co du lieu mail signal.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                {mailSignals.items.length === 0 ? (
                  <p className="text-slate-500">Khong co ma mua hop le tu mail gan nhat.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
                      <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Entry</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Take profit</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Stop loss</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Confidence</th>
                          <th className="py-2.5 whitespace-nowrap">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mailSignals.items.map((item, idx) => (
                          <tr key={`${item.symbol}-${idx}`} className="border-b border-white/5 align-top">
                            <td className="py-2 pr-3 font-mono text-cyan-200">{item.symbol}</td>
                            <td className="py-2 pr-3 text-slate-100">{formatPrice(item.entry)}</td>
                            <td className="py-2 pr-3 text-emerald-300">{formatPrice(item.take_profit)}</td>
                            <td className="py-2 pr-3 text-rose-300">{formatPrice(item.stop_loss)}</td>
                            <td className="py-2 pr-3 text-amber-300">{(Number(item.confidence || 0) * 100).toFixed(0)}%</td>
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
            <h3 className="text-sm font-semibold text-slate-200">Real Scan Logs (Short-term + Mail Signals)</h3>
            <p className="mt-1 text-xs text-slate-500">
              REAL mode scan/recommend-only. Chi hien thi log account_mode REAL, 10 ban ghi gan nhat moi loai.
            </p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-300">Short-term scan logs (REAL)</p>
                  <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                    Exchange scope
                    <select
                      className="rounded-md border border-white/15 bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-100"
                      value={realShortTermLogScopeFilter}
                      onChange={(e) => setRealShortTermLogScopeFilter(e.target.value as "ANY" | ShortTermExchangeScope)}
                    >
                      <option value="ANY">ANY</option>
                      <option value="ALL">ALL</option>
                      <option value="HOSE">HOSE</option>
                      <option value="HNX">HNX</option>
                      <option value="UPCOM">UPCOM</option>
                    </select>
                  </label>
                </div>
                {realShortTermRuns.length === 0 ? (
                  <p className="mt-2 text-[11px] text-slate-500">Chua co log short-term REAL.</p>
                ) : (
                  <div className="mt-2 max-h-72 space-y-2 overflow-y-auto text-[11px] font-mono text-slate-300">
                    {realShortTermRuns.map((run) => (
                      <div key={run.id} className="border-b border-white/5 pb-2">
                        <p>
                          <span className="text-cyan-200">{formatDateTime(run.started_at)}</span> |{" "}
                          <span className={automationRunStatusClass(run.run_status)}>{run.run_status}</span>
                        </p>
                        <p className="text-slate-400">scan={run.scanned} | recommend={run.buy_candidates} | err={run.errors}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-white/10 bg-black/20 p-3">
                <p className="text-xs font-semibold text-slate-300">Mail signals logs (REAL)</p>
                {realMailSignalRunLogs.length === 0 ? (
                  <p className="mt-2 text-[11px] text-slate-500">Chua co log mail signals REAL.</p>
                ) : (
                  <div className="mt-2 max-h-72 space-y-2 overflow-y-auto text-[11px] font-mono text-slate-300">
                    {realMailSignalRunLogs.map((run, idx) => (
                      <div key={`${run.redis_key}-${idx}`} className="border-b border-white/5 pb-2">
                        <p>
                          <span className="text-cyan-200">{formatDateTime(run.ran_at)}</span> |{" "}
                          <span className="text-violet-300">scanned={run.scanned}</span> |{" "}
                          <span className="text-emerald-300">recommend={run.executed.length}</span> |{" "}
                          <span className="text-rose-300">skipped={run.skipped.length}</span>
                        </p>
                        <p className="text-slate-500">source={run.source_key || "-"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.autoTrading.demoBalanceTitle}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleNewDemoSession()}
                  disabled={demoSessionBusy}
                  className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                >
                  {demoSessionBusy ? UI_TEXT.autoTrading.demoNewSessionCreating : UI_TEXT.autoTrading.demoNewSession}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteCurrentDemoSession()}
                  disabled={demoSessionBusy || !demoSessionId.trim()}
                  className="rounded-md border border-rose-300/40 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50"
                >
                  {demoSessionBusy ? UI_TEXT.autoTrading.demoDeleteSessionDeleting : UI_TEXT.autoTrading.demoDeleteSession}
                </button>
              </div>
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
                  if (!nextId.trim()) {
                    return;
                  }
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
                {!demoSessionId ? (
                  <option value="">{UI_TEXT.autoTrading.demoSessionListEmpty}</option>
                ) : null}
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
            <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
              <p>Session: {demoSessionId}</p>
              <p>Updated account snapshot: {formatVnd(demoCash)} VND</p>
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-200">Demo DB Overview</p>
              {demoOverviewError ? <p className="mt-2 text-rose-300">{demoOverviewError}</p> : null}
              {demoOverview ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-300/20 bg-slate-300/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-200/80">So tien nap vao</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {formatVnd(Number(demoOverview.initial_balance || 0))} VND
                    </p>
                  </div>
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-cyan-100/80">Tong tien hien tai</p>
                    <p className="mt-1 text-lg font-semibold text-cyan-100">
                      {formatVnd(Number(demoOverview.total_assets || 0))} VND
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
                      {formatVnd(Number(demoOverview.stock_value || 0))} VND
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Demo Charts</h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-300">Ty trong tai san</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={overviewDonutData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2}>
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
                    <div className="flex h-full items-center justify-center text-xs text-slate-500">Khong co du lieu holdings.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={overviewHoldingsBarData}>
                        <XAxis dataKey="symbol" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => formatVnd(normalizeVnStockPrice(Number(v || 0)))}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "rgba(8, 13, 23, 0.96)",
                            border: "1px solid rgba(148, 163, 184, 0.35)",
                            borderRadius: "10px",
                            color: "#e6edf7",
                          }}
                          formatter={(value) => [`${formatVnd(normalizeVnStockPrice(Number(value || 0)))} VND`, "Gia tri"]}
                        />
                        <Bar dataKey="value" fill={HOLDINGS_BAR_COLOR} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Danh muc demo session hien tai</h3>
            {!demoOverview || demoOverview.holdings.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Khong co ma dang nam giu trong demo session nay.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs text-slate-200">
                  <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">So luong</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Gia mua</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Gia hien tai</th>
                      <th className="py-2.5 whitespace-nowrap">% Lai/Lo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoOverview.holdings.map((holding) => {
                      const symbol = String(holding.symbol || "").toUpperCase();
                      const avg = normalizeVnStockPrice(Number(holding.average_buy_price || 0));
                      const last = normalizeVnStockPrice(Number(holdingLastPriceBySymbol[symbol] ?? 0));
                      const hasMark = Number.isFinite(last) && last > 0;
                      const pnlPct = hasMark && avg > 0 ? (last / avg - 1) * 100 : null;
                      const pnlClass =
                        pnlPct == null ? "text-slate-400" : pnlPct > 0 ? "text-emerald-300" : pnlPct < 0 ? "text-rose-300" : "text-slate-300";
                      return (
                        <tr key={`${holding.symbol}-${holding.opened_at}`} className="border-b border-white/5">
                          <td className="py-2 pr-3 font-mono text-cyan-200">{symbol}</td>
                          <td className="py-2 pr-3">{Number(holding.quantity || 0)}</td>
                          <td className="py-2 pr-3">{formatPrice(avg)}</td>
                          <td className="py-2 pr-3">{hasMark ? formatPrice(last) : "-"}</td>
                          <td className={`py-2 ${pnlClass}`}>{pnlPct == null ? "-" : `${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Strategy Cash Operations</h3>
            <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3 text-xs text-slate-300">
              <p className="mb-2 text-xs font-semibold text-slate-300">Transfer and allocate strategy cash</p>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  To strategy
                  <select
                    className="rounded-md border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-slate-100"
                    value={strategyCashTransferTarget}
                    onChange={(e) =>
                      setStrategyCashTransferTarget(e.target.value as "SHORT_TERM" | "MAIL_SIGNAL" | "UNALLOCATED")
                    }
                    disabled={strategyCashTransferBusy}
                  >
                    <option value="SHORT_TERM">SHORT_TERM</option>
                    <option value="MAIL_SIGNAL">MAIL_SIGNAL</option>
                    <option value="UNALLOCATED">UNALLOCATED (Nap tu ben ngoai)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  Amount (VND)
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    className="w-48 rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-slate-100"
                    value={strategyCashTransferAmount}
                    onChange={(e) => setStrategyCashTransferAmount(e.target.value)}
                    disabled={strategyCashTransferBusy}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleTransferUnallocatedCash()}
                  disabled={strategyCashTransferBusy}
                  className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                >
                  {strategyCashTransferBusy ? "Dang chuyen..." : "Them tien tu UNALLOCATED"}
                </button>
              </div>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  From strategy
                  <select
                    className="rounded-md border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-slate-100"
                    value={strategyCashWithdrawSource}
                    onChange={(e) => setStrategyCashWithdrawSource(e.target.value as "SHORT_TERM" | "MAIL_SIGNAL")}
                    disabled={strategyCashTransferBusy}
                  >
                    <option value="SHORT_TERM">SHORT_TERM</option>
                    <option value="MAIL_SIGNAL">MAIL_SIGNAL</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  Withdraw amount (VND)
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    className="w-48 rounded-md border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-slate-100"
                    value={strategyCashWithdrawAmount}
                    onChange={(e) => setStrategyCashWithdrawAmount(e.target.value)}
                    disabled={strategyCashTransferBusy}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleWithdrawToUnallocated()}
                  disabled={strategyCashTransferBusy}
                  className="rounded-md border border-amber-300/40 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-50"
                >
                  {strategyCashTransferBusy ? "Dang rut..." : "Rut ve UNALLOCATED"}
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(demoOverview?.strategy_cash_overview || []).map((row) => (
                  <div key={row.strategy_code} className="rounded-md border border-white/10 bg-black/20 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{row.strategy_code}</p>
                    <p className="mt-1 text-sm font-semibold text-cyan-100">{formatVnd(Number(row.cash_value || 0))} VND</p>
                    <p className="text-[11px] text-slate-500">Alloc: {(Number(row.allocation_pct || 0) * 100).toFixed(1)}%</p>
                    <p className="text-[11px] text-amber-300">Used: {formatVnd(Number(row.used_cash_value || 0))} VND</p>
                    <p className="text-[11px] text-emerald-300">
                      Remaining: {formatVnd(Number(row.remaining_cash_value || 0))} VND
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {schedulerError ? <p className="text-xs text-rose-300">{schedulerError}</p> : null}
          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">
              Liquidity Cache Picks (eligible_spike=true + eligible_liquidity=true)
            </h3>
            {liquidityEligibleError ? <p className="mt-2 text-xs text-rose-300">{liquidityEligibleError}</p> : null}
            {liquidityEligibleRows.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Chua co ma dat du ca 2 dieu kien trong Redis cache.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p className="text-slate-400">
                  Tong so ma dat chuan: <span className="font-semibold text-cyan-200">{liquidityEligibleTotal}</span>
                </p>
                <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-md border border-white/10">
                  <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
                    <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Exchange</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Spike ratio</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Baseline vol</th>
                        <th className="py-2.5 pr-4 whitespace-nowrap">Latest vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquidityEligibleRows.map((row) => (
                        <tr key={row.redis_key} className="border-b border-white/5 align-top">
                          <td className="py-2 pr-3 font-mono text-cyan-200">{row.symbol}</td>
                          <td className="py-2 pr-3 text-slate-300">{row.exchange}</td>
                          <td className="py-2 pr-3 text-emerald-300">{Number(row.spike_ratio || 0).toFixed(2)}x</td>
                          <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.baseline_vol || 0))}</td>
                          <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.latest_vol || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
            {scannerHealth ? (
              <div
                className={`mb-3 grid gap-2 rounded-md p-3 text-[11px] text-slate-300 md:grid-cols-4 ${
                  scannerHealthFlags?.hasWarning
                    ? "border border-rose-300/30 bg-rose-300/10"
                    : "border border-cyan-300/20 bg-cyan-300/5"
                }`}
              >
                <p className={`font-semibold ${scannerHealthFlags?.hasWarning ? "text-rose-200" : "text-cyan-200"}`}>
                  Scanner Health (last {scannerHealth.sampleSize} runs)
                </p>
                <p>
                  avg scan: <span className="text-violet-300">{scannerHealth.avgScanned.toFixed(1)}</span> | avg buy:{" "}
                  <span className="text-amber-300">{scannerHealth.avgBuy.toFixed(1)}</span>
                </p>
                <p>
                  avg exec: <span className="text-emerald-300">{scannerHealth.avgExecuted.toFixed(1)}</span> | avg err:{" "}
                  <span className={scannerHealthFlags?.isErrHigh ? "text-rose-300" : "text-slate-300"}>
                    {scannerHealth.avgErrors.toFixed(2)}
                  </span>
                </p>
                <p>
                  entry_gate_skip:{" "}
                  <span className={scannerHealthFlags?.isEntryGateTooTight ? "text-rose-300" : "text-slate-300"}>
                    {scannerHealth.totalEntryGateSkip}
                  </span>{" "}
                  | cooldown_skip:{" "}
                  <span className={scannerHealthFlags?.isCooldownSpike ? "text-rose-300" : "text-slate-300"}>
                    {scannerHealth.totalCooldownSkip}
                  </span>{" "}
                  | dynamic_floor_skip: {scannerHealth.totalDynamicFloorSkip} | dynamic_floor:{" "}
                  <span className={scannerHealthFlags?.isDynamicFloorHigh ? "text-rose-300" : "text-slate-300"}>
                    {scannerHealth.avgDynamicFloor != null ? scannerHealth.avgDynamicFloor.toFixed(1) : "-"}
                  </span>
                </p>
                <p>
                  threshold_source: claude{" "}
                  <span className="text-cyan-200">{scannerHealth.totalThresholdSourceClaude}</span> | heuristic{" "}
                  <span className="text-slate-300">{scannerHealth.totalThresholdSourceHeuristic}</span>
                </p>
                <p>
                  spend plan/actual:{" "}
                  <span className="text-violet-300">{scannerHealth.totalPlannedSpent.toLocaleString("vi-VN")}</span> /{" "}
                  <span className="text-emerald-300">{scannerHealth.totalActualSpent.toLocaleString("vi-VN")}</span> | gap{" "}
                  <span className="text-amber-300">
                    {(scannerHealth.totalPlannedSpent - scannerHealth.totalActualSpent).toLocaleString("vi-VN")}
                  </span>
                </p>
                {scannerHealthFlags?.hasWarning ? (
                  <p className="md:col-span-4 text-rose-200">
                    Warning: scanner quality guard is tight. Check latest runs for error spike, cooldown spike, or overly strict filters.
                  </p>
                ) : null}
              </div>
            ) : null}
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
                {automationRunLogGroups.map((sessionBlock, sessionIdx) => (
                  <div key={sessionBlock.sessionId ?? "ACCOUNT_MODE_SCOPE"}>
                    {sessionBlock.sessionId ? (
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-wide text-cyan-300 ${
                          sessionIdx > 0 ? "border-t border-white/10 pt-3" : ""
                        }`}
                      >
                        DEMO_SESSION_ID: {sessionBlock.sessionId}
                      </p>
                    ) : null}
                    <div className="mt-1 space-y-3">
                      {sessionBlock.groups.map((group, idx) => (
                        <div key={`${sessionBlock.sessionId ?? "ACCOUNT_MODE_SCOPE"}-${group.bucket}`}>
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
                              <div key={run.id} className="font-mono">
                                <p>
                                  <span className="text-cyan-200">{formatDateTime(run.started_at)}</span> |{" "}
                                  <span className={automationRunStatusClass(run.run_status)}>{run.run_status}</span> | scan{" "}
                                  <span className="text-violet-300">{run.scanned}</span> | buy{" "}
                                  <span className="text-amber-300">{run.buy_candidates}</span> | exec{" "}
                                  <span className="text-emerald-300">{run.executed}</span> | err{" "}
                                  <span className={run.errors > 0 ? "text-rose-300" : "text-slate-400"}>{run.errors}</span>
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {(() => {
                                    const detail = run.detail ?? {};
                                    const skippedEntryGate = asFiniteNumber(detail.skipped_entry_gate);
                                    const skippedCooldown = asFiniteNumber(detail.skipped_experience_cooldown);
                                    const skippedDynamicFloor = asFiniteNumber(detail.skipped_dynamic_buy_floor);
                                    const dynamicFloor = asFiniteNumber(detail.dynamic_buy_composite_floor);
                                    const thresholdSourceClaude = asFiniteNumber(detail.experience_threshold_source_claude);
                                    const thresholdSourceHeuristic = asFiniteNumber(detail.experience_threshold_source_heuristic);
                                    const decisionMeta = (detail.buy_decision_meta ?? {}) as Record<string, unknown>;
                                    const decisionSource = typeof decisionMeta.source === "string" ? decisionMeta.source : "-";
                                    const plannedSpent = asFiniteNumber(decisionMeta.planned_spent);
                                    const actualSpent = asFiniteNumber(decisionMeta.actual_spent);
                                    const executionGap = asFiniteNumber(decisionMeta.execution_spent_gap);
                                    return [
                                      `entry_gate_skip=${skippedEntryGate ?? 0}`,
                                      `cooldown_skip=${skippedCooldown ?? 0}`,
                                      `dynamic_floor_skip=${skippedDynamicFloor ?? 0}`,
                                      `dynamic_floor=${dynamicFloor != null ? dynamicFloor.toFixed(1) : "-"}`,
                                      `threshold_source=claude:${thresholdSourceClaude ?? 0}/heuristic:${thresholdSourceHeuristic ?? 0}`,
                                      `spent(plan/actual/gap)=${plannedSpent ?? 0}/${actualSpent ?? 0}/${executionGap ?? 0}`,
                                      `decision=${decisionSource}`,
                                    ].join(" | ");
                                  })()}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Mail Signals</h3>
            {mailSignalsError ? <p className="mt-2 text-xs text-rose-300">{mailSignalsError}</p> : null}
            {!mailSignals ? (
              <p className="mt-3 text-xs text-slate-500">Chua co du lieu mail signal.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                {mailSignals.items.length === 0 ? (
                  <p className="text-slate-500">Khong co ma mua hop le tu mail gan nhat.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
                      <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Entry</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Take profit</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Stop loss</th>
                          <th className="py-2.5 pr-4 whitespace-nowrap">Confidence</th>
                          <th className="py-2.5 whitespace-nowrap">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mailSignals.items.map((item, idx) => (
                          <tr key={`${item.symbol}-${idx}`} className="border-b border-white/5 align-top">
                            <td className="py-2 pr-3 font-mono text-cyan-200">{item.symbol}</td>
                            <td className="py-2 pr-3 text-slate-100">{formatPrice(item.entry)}</td>
                            <td className="py-2 pr-3 text-emerald-300">{formatPrice(item.take_profit)}</td>
                            <td className="py-2 pr-3 text-rose-300">{formatPrice(item.stop_loss)}</td>
                            <td className="py-2 pr-3 text-amber-300">{(Number(item.confidence || 0) * 100).toFixed(0)}%</td>
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
            <h3 className="text-sm font-semibold text-slate-200">Mail Entry Scheduler Log (10 gan nhat)</h3>
            {mailSignalEntryRunError ? <p className="mt-2 text-xs text-rose-300">{mailSignalEntryRunError}</p> : null}
            {mailSignalEntryRuns.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Chua co log entry scheduler.</p>
            ) : (
              <div className="mt-3 space-y-4 text-xs text-slate-300">
                {mailSignalEntryRuns.map((run, runIdx) => (
                  <div key={`${run.redis_key}-${runIdx}`} className="rounded-md border border-white/10 bg-black/20 p-3">
                    <p>
                      Ran at: <span className="text-cyan-200">{formatDateTime(run.ran_at)}</span> | Scanned:{" "}
                      <span className="text-violet-300">{run.scanned}</span> | Executed:{" "}
                      <span className="text-emerald-300">{run.executed.length}</span> | Skipped:{" "}
                      <span className="text-rose-300">{run.skipped.length}</span>
                    </p>
                    {run.executed.length === 0 ? (
                      <p className="mt-2 text-slate-500">Khong co lenh duoc ban trong lan chay nay.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
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
                            {run.executed.map((row, idx) => (
                              <tr key={`${row.symbol}-${idx}`} className="border-b border-white/5">
                                <td className="py-2 pr-3 font-mono text-cyan-200">{row.symbol}</td>
                                <td className="py-2 pr-3">{Number(row.quantity || 0)}</td>
                                <td className={`py-2 pr-3 ${statusClass(String(row.status || "-"))}`}>{row.status || "-"}</td>
                                <td className="py-2 pr-3 font-mono">{row.order_id || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div>
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
        </div>
      )}
    </div>
  );
}
