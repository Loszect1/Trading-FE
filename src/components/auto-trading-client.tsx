"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
  isDnseSessionExpiredError,
  pickSubAccountNumbers,
} from "@/services/dnse.api";
import {
  deleteCurrentDemoSession,
  depositDemoCash,
  fetchDemoOverview,
  createNewDemoSession,
  fetchDemoAccount,
  fetchDemoSessions,
  type DemoAccountData,
  type DemoSessionOverviewData,
  type DemoTradeSide,
} from "@/services/auto-trading.api";
import {
  fetchRealRecommendationsLatest,
  fetchRealRecommendationsRecent,
  fetchRealScanOnlySchedulerStatus,
  fetchShortTermLiquidityEligibleCache,
  fetchMailSignalEntryRunsRecent,
  fetchMailSignalsLatest,
  postMailSignalsRunOnce,
  postDemoPortfolioReviewRunOnce,
  postShortTermPostCloseRefreshRunOnce,
  postRealRecommendationActionBuy,
  postRealRecommendationsScan,
  fetchSchedulerDemoSession,
  parseShortTermRunExchangeScope,
  fetchSchedulerStatus,
  fetchShortTermRuns,
  setSchedulerDemoSession,
  SHORT_TERM_RUN_LOG_SCOPE_ORDER,
  shortTermRunLogScopeBucket,
  toggleScheduler,
  toggleRealScanOnlyScheduler,
  type ShortTermAutomationRunRow,
  type ShortTermExchangeScope,
  type MailSignalsData,
  type MailSignalEntryRunData,
  type ShortTermRunLogScopeBucket,
  type RealRecommendationRow,
  type RealRecommendationsRecentRow,
  type RealWatchCandidateRow,
  type LiquidityEligibleCacheRow,
  type ShortTermScanDiagnostics,
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
import type { SchedulerStatus } from "@/types/operational";

type AccountTab = "real" | "demo";

type RealAutomationMode = "SCAN_ONLY" | "AUTO_TRADING";
type RealLogsTab = "SCAN_ONLY" | "AUTO_TRADING";
type DemoOrdersTab = "buy" | "sell";

const DEMO_INITIAL_CASH_VND = 100_000_000;
const AUTO_TRADING_BACKEND_LOGS_PER_SCOPE = 5;
const DNSE_DEPOSIT_QR_URL = (process.env.NEXT_PUBLIC_DNSE_DEPOSIT_QR_URL ?? "/QR_Code.png").trim();

const REAL_AUTOMATION_MODE_STORAGE_KEY = "real_automation_mode";
const REAL_SCAN_ONLY_SCHEDULE_ENABLED_STORAGE_KEY = "real_scan_only_schedule_enabled";
const DEMO_ORDER_TABS: DemoOrdersTab[] = ["buy", "sell"];
const DEMO_ORDER_TAB_SIDE: Record<DemoOrdersTab, DemoTradeSide> = {
  buy: "BUY",
  sell: "SELL",
};

function emptyDemoOrdersBySide(): Record<DemoOrdersTab, DemoOrderItem[]> {
  return { buy: [], sell: [] };
}

function emptyDemoHistoryCounts(): Record<DemoOrdersTab, number> {
  return { buy: 0, sell: 0 };
}

function formatShortTermScanDiagnostics(d: ShortTermScanDiagnostics | null | undefined): string {
  if (!d || typeof d !== "object") {
    return "";
  }
  const parts: string[] = [];
  const add = (label: string, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) {
      return;
    }
    parts.push(`${label}=${value}`);
  };
  add("insuff_data", d.skipped_insufficient_data);
  add("low_liq", d.skipped_low_liquidity);
  add("no_spike", d.skipped_no_volume_spike);
  add("entry_gate", d.skipped_entry_gate);
  add("cooldown", d.skipped_experience_cooldown);
  add("dyn_buy_floor", d.skipped_dynamic_buy_floor);
  add("db_cache", d.price_history_cache_hits);
  add("vnstock_calls", d.price_history_vnstock_calls);
  add("price_missing", d.price_history_missing);
  if (typeof d.dynamic_buy_composite_floor === "number" && Number.isFinite(d.dynamic_buy_composite_floor)) {
    parts.push(`composite_buy_floor=${d.dynamic_buy_composite_floor}`);
  }
  add("buy_signals_db", d.buy_signals_written);
  return parts.join(" | ");
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

function mapDemoOrderHistory(account: DemoAccountData): DemoOrderItem[] {
  return account.trade_history.map((item) => ({
    id: item.trade_id,
    createdAt: item.created_at,
    symbol: item.symbol,
    side: item.side === "BUY" ? "buy" : "sell",
    quantity: item.quantity,
    price: item.price,
    notional: item.notional,
  }));
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

interface RealActionBuyModalState {
  row: RealRecommendationRow;
  priceInput: string;
  quantityInput: string;
  error: string;
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

function parseNumericInput(value: string): number {
  const normalized = value.replace(/[,\s]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

function maxBoardLotQuantity(availableCash: number, price: number): number {
  if (!Number.isFinite(availableCash) || !Number.isFinite(price) || availableCash <= 0 || price <= 0) {
    return 0;
  }
  return Math.floor(availableCash / price / 100) * 100;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("vi-VN", { hour12: false });
}

function isWithinFreshWindow(iso: string | null, freshMinutes: number): boolean {
  if (!iso) {
    return false;
  }
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }
  const windowMs = Math.max(1, Math.trunc(freshMinutes)) * 60_000;
  return Date.now() - ts <= windowMs;
}

const DEMO_SESSION_STORAGE_KEY = "auto_trading_demo_session_id";

function getStoredDemoSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const existing = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
  return existing?.trim() ?? "";
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
  const depositKeys = [
    "initialBalance",
    "initial_balance",
    "depositedAmount",
    "deposited_amount",
    "depositAmount",
    "deposit_amount",
    "totalDeposit",
    "total_deposit",
    "netDeposit",
    "net_deposit",
    "principal",
    "principalAmount",
    "principal_amount",
  ];
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

function RealMetricCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  tone?: "cyan" | "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    emerald: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    amber: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    rose: "border-rose-300/25 bg-rose-300/10 text-rose-100",
    slate: "border-white/10 bg-black/20 text-slate-100",
  }[tone];

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <p className="text-[11px] uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

function formatConfidencePercent(value: number | null | undefined): string {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) {
    return "-";
  }
  const pct = raw <= 1 ? raw * 100 : raw;
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

function RealSectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {meta ? <p className="mt-1 text-xs text-slate-500">{meta}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

function RealStatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
        active
          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
          : "border-white/10 bg-black/20 text-slate-400"
      }`}
    >
      {label}: {active ? "ON" : "OFF"}
    </span>
  );
}

function LiquidityCachePanel({
  rows,
  total,
  error,
  busy,
  onRunNow,
  compact = false,
}: {
  rows: LiquidityEligibleCacheRow[];
  total: number;
  error: string;
  busy: boolean;
  onRunNow: () => void;
  compact?: boolean;
}) {
  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Liquidity Cache</h3>
          <p className="mt-1 text-xs text-slate-500">eligible_spike=true + eligible_liquidity=true</p>
        </div>
        <button
          type="button"
          onClick={onRunNow}
          disabled={busy}
          className="rounded-md border border-cyan-300/40 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
        >
          {busy ? "Running..." : "Run now"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-[10rem_1fr]">
        <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-cyan-100/75">Qualified symbols</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-100">{total}</p>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4 text-xs text-slate-500">
            Chua co ma dat du ca 2 dieu kien trong Redis cache.
          </div>
        ) : (
          <div className={`overflow-y-auto overflow-x-auto rounded-md border border-white/10 ${compact ? "max-h-56" : "max-h-80"}`}>
            <table className="w-full min-w-[640px] text-left text-xs text-slate-200">
              <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2.5 pr-4 pl-3 whitespace-nowrap">Symbol</th>
                  <th className="py-2.5 pr-4 whitespace-nowrap">Exchange</th>
                  <th className="py-2.5 pr-4 whitespace-nowrap">Spike</th>
                  <th className="py-2.5 pr-4 whitespace-nowrap">Baseline vol</th>
                  <th className="py-2.5 pr-3 whitespace-nowrap">Latest vol</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.redis_key} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-3 pl-3 font-mono text-cyan-200">{row.symbol}</td>
                    <td className="py-2 pr-3 text-slate-300">{row.exchange}</td>
                    <td className="py-2 pr-3 text-emerald-300">{Number(row.spike_ratio || 0).toFixed(2)}x</td>
                    <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.baseline_vol || 0))}</td>
                    <td className="py-2 pr-3 text-slate-100">{formatVnd(Number(row.latest_vol || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function MailSignalsPanel({
  mailSignals,
  pickCount,
  error,
  busy,
  onRunNow,
  compact = false,
}: {
  mailSignals: MailSignalsData | null;
  pickCount: number;
  error: string;
  busy: boolean;
  onRunNow: () => void;
  compact?: boolean;
}) {
  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Mail Signals</h3>
          <p className="mt-1 text-xs text-slate-500">{pickCount} picks from latest parsed mail cache</p>
        </div>
        <button
          type="button"
          onClick={onRunNow}
          disabled={busy}
          className="rounded-md border border-cyan-300/40 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
        >
          {busy ? "Running..." : "Run now"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      {!mailSignals ? (
        <p className="mt-3 text-xs text-slate-500">Chua co du lieu mail signal.</p>
      ) : (
        <div className="mt-3 space-y-3 text-xs text-slate-300">
          <div className="rounded-md border border-white/10 bg-black/20 p-2 text-[11px] text-slate-400">
            <p>
              source={mailSignals.redis_key || "-"} | parsed_picks={pickCount} | mail_count=
              {Number(mailSignals.mail_count || 0)} | generated_at=
              {mailSignals.generated_at ? formatDateTime(mailSignals.generated_at) : "-"}
            </p>
            {mailSignals.latest_empty_redis_key ? (
              <p className="mt-1 text-amber-300">
                Today cache empty: {mailSignals.latest_empty_redis_key}
                {mailSignals.latest_empty_note ? ` (${mailSignals.latest_empty_note})` : ""}
              </p>
            ) : null}
          </div>
          {mailSignals.items.length === 0 ? (
            <p className="text-slate-500">
              {mailSignals.note === "no_today_mail"
                ? "Khong tim thay mail signal trong ngay hien tai."
                : "Khong co ma mua hop le tu mail gan nhat."}
            </p>
          ) : (
            <div className={`overflow-x-auto ${compact ? "max-h-56 overflow-y-auto" : ""}`}>
              <table className="w-full min-w-[700px] text-left text-xs text-slate-200">
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
                      <td className="py-2 pr-3 text-amber-300">{formatConfidencePercent(item.confidence)}</td>
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
  );
}

export function AutoTradingClient() {
  const { showToast } = useToast();
  const realScanOnlySchedulerToggleBusyRef = useRef(false);
  const lastRealScanOnlyScheduleEnabledRef = useRef<boolean | null>(null);
  const [accountTab, setAccountTab] = useState<AccountTab>("real");
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [realScanOnlySchedulerStatus, setRealScanOnlySchedulerStatus] = useState<
    (SchedulerStatus & { mode?: string }) | null
  >(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [schedulerError, setSchedulerError] = useState("");

  const [realAutomationMode, setRealAutomationMode] = useState<RealAutomationMode>("SCAN_ONLY");
  const [realScanOnlyScheduleEnabled, setRealScanOnlyScheduleEnabled] = useState(false);
  const [automationRuns, setAutomationRuns] = useState<ShortTermAutomationRunRow[]>([]);
  const [automationRunsError, setAutomationRunsError] = useState("");
  const [mailSignals, setMailSignals] = useState<MailSignalsData | null>(null);
  const [mailSignalsError, setMailSignalsError] = useState("");
  const [mailSignalsRunOnceBusy, setMailSignalsRunOnceBusy] = useState(false);
  const [mailSignalEntryRuns, setMailSignalEntryRuns] = useState<MailSignalEntryRunData[]>([]);
  const [mailSignalEntryRunError, setMailSignalEntryRunError] = useState("");
  const [liquidityEligibleRows, setLiquidityEligibleRows] = useState<LiquidityEligibleCacheRow[]>([]);
  const [liquidityEligibleError, setLiquidityEligibleError] = useState("");
  const [liquidityEligibleTotal, setLiquidityEligibleTotal] = useState(0);
  const [liquidityRefreshBusy, setLiquidityRefreshBusy] = useState(false);
  const [automationLogScopeFilter, setAutomationLogScopeFilter] = useState<"ANY" | ShortTermExchangeScope>("ANY");
  const [realRecommendations, setRealRecommendations] = useState<RealRecommendationRow[]>([]);
  const [realRejectedRecommendations, setRealRejectedRecommendations] = useState<RealRecommendationRow[]>([]);
  const [realWatchCandidates, setRealWatchCandidates] = useState<RealWatchCandidateRow[]>([]);
  const [realRecommendationsGeneratedAt, setRealRecommendationsGeneratedAt] = useState<string | null>(null);
  const [realRecommendationsScannedCount, setRealRecommendationsScannedCount] = useState<number | null>(null);
  const [realRecommendationsScanDiagnostics, setRealRecommendationsScanDiagnostics] = useState<ShortTermScanDiagnostics | null>(
    null,
  );
  const [realRecommendationsFreshMinutes, setRealRecommendationsFreshMinutes] = useState(30);
  const [realMailSignalRecommendations, setRealMailSignalRecommendations] = useState<RealRecommendationRow[]>([]);
  const [realRecommendationsRecentLogs, setRealRecommendationsRecentLogs] = useState<RealRecommendationsRecentRow[]>([]);
  const [realRecommendationsBusy, setRealRecommendationsBusy] = useState(false);
  const [realRecommendationsError, setRealRecommendationsError] = useState("");
  const [realRecommendationBuyBusySymbol, setRealRecommendationBuyBusySymbol] = useState("");
  const [realActionBuyModal, setRealActionBuyModal] = useState<RealActionBuyModalState | null>(null);
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
  const [realLogsTab, setRealLogsTab] = useState<RealLogsTab>("SCAN_ONLY");

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
  const [, setDemoPositions] = useState<DemoPosition[]>([]);
  const [, setDemoUnrealizedPnl] = useState(0);
  const [demoOrdersTab, setDemoOrdersTab] = useState<DemoOrdersTab>("buy");
  const [demoOrdersBySide, setDemoOrdersBySide] = useState<Record<DemoOrdersTab, DemoOrderItem[]>>(
    emptyDemoOrdersBySide,
  );
  const [historyOffsetBySide, setHistoryOffsetBySide] = useState<Record<DemoOrdersTab, number>>(
    emptyDemoHistoryCounts,
  );
  const [historyLimit] = useState(30);
  const [historyTotalBySide, setHistoryTotalBySide] = useState<Record<DemoOrdersTab, number>>(
    emptyDemoHistoryCounts,
  );
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [demoSessionBusy, setDemoSessionBusy] = useState(false);
  const [, setDemoLog] = useState<string[]>([]);
  const [demoOverview, setDemoOverview] = useState<DemoSessionOverviewData | null>(null);
  const [demoOverviewError, setDemoOverviewError] = useState("");
  const [demoPortfolioReviewBusy, setDemoPortfolioReviewBusy] = useState(false);
  const [demoPortfolioReviewMessage, setDemoPortfolioReviewMessage] = useState("");
  const [demoDepositAmount, setDemoDepositAmount] = useState("");
  const [demoDepositBusy, setDemoDepositBusy] = useState(false);
  const [holdingLastPriceBySymbol, setHoldingLastPriceBySymbol] = useState<Record<string, number>>({});
  const [demoPortfolioSnapshot, setDemoPortfolioSnapshot] = useState<DemoPortfolioSnapshot>({
    totalAssets: DEMO_INITIAL_CASH_VND,
    cashAvailable: DEMO_INITIAL_CASH_VND,
    stockValue: 0,
  });

  const schedulerAccountMode: "REAL" | "DEMO" = accountTab === "real" ? "REAL" : "DEMO";
  const realScanOnlyScheduleActive = Boolean(realScanOnlySchedulerStatus?.enabled ?? realScanOnlyScheduleEnabled);
  const realScanOnlyWorkerRunning = Boolean(realScanOnlySchedulerStatus?.running);

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
      const rawSid = run.detail?.demo_session_id;
      const runSid =
        rawSid === null || rawSid === undefined ? "" : String(rawSid).trim();
      if (!runSid) {
        return true;
      }
      return runSid === demoSessionId;
    });
    return [
      {
        sessionId: demoSessionId || null,
        groups: buildGroupsForRuns(selectedSessionRows),
      },
    ].filter((block) => block.sessionId && block.groups.length > 0);
  }, [automationLogScopeFilter, automationRuns, demoSessionId, schedulerAccountMode]);

  const demoAutomationLogRows = useMemo(() => {
    return automationRunLogGroups.flatMap((sessionBlock) =>
      sessionBlock.groups.flatMap((group) =>
        group.runs.map((run) => ({
          run,
          scope: group.bucket,
          sessionId: sessionBlock.sessionId,
        })),
      ),
    );
  }, [automationRunLogGroups]);

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
  const demoOverviewInitialBalance = Number(demoOverview?.initial_balance ?? DEMO_INITIAL_CASH_VND);
  const demoOverviewTotalAssets = Number(demoOverview?.total_assets ?? demoPortfolioSnapshot.totalAssets ?? demoCash);
  const demoOverviewCashAvailable = Number(demoOverview?.cash_balance ?? demoPortfolioSnapshot.cashAvailable ?? demoCash);
  const demoOverviewStockValue = Number(demoOverview?.stock_value ?? demoPortfolioSnapshot.stockValue ?? 0);
  const demoOverviewPnl = demoOverviewTotalAssets - demoOverviewInitialBalance;
  const realRecommendationsFresh = useMemo(
    () => isWithinFreshWindow(realRecommendationsGeneratedAt, realRecommendationsFreshMinutes),
    [realRecommendationsFreshMinutes, realRecommendationsGeneratedAt],
  );
  const visibleRealRecommendations = useMemo(
    () => (realRecommendationsFresh ? realRecommendations : []),
    [realRecommendations, realRecommendationsFresh],
  );
  const visibleRealRejectedRecommendations = useMemo(
    () => (realRecommendationsFresh ? realRejectedRecommendations : []),
    [realRejectedRecommendations, realRecommendationsFresh],
  );
  const visibleRealWatchCandidates = useMemo(
    () => (realRecommendationsFresh ? realWatchCandidates : []),
    [realRecommendationsFresh, realWatchCandidates],
  );
  const realRejectedTopReasons = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of visibleRealRejectedRecommendations) {
      const reason = String(row.risk_reason || "unknown");
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [visibleRealRejectedRecommendations]);
  const mailSignalPickCount = useMemo(() => Number(mailSignals?.items?.length ?? 0), [mailSignals]);
  const mailSignalsGeneratedAt = mailSignals?.generated_at ?? null;
  const mailSignalsSourceLabel = mailSignals?.source
    ? `${mailSignals.source}${mailSignalsGeneratedAt ? ` | ${formatDateTime(mailSignalsGeneratedAt)}` : ""}`
    : "No mail cache";
  const visibleRealMailSignalRecommendations = useMemo(
    () => (realRecommendationsFresh ? realMailSignalRecommendations : []),
    [realMailSignalRecommendations, realRecommendationsFresh],
  );
  const realActionBuyAvailableCash = Number(dnseAccountSummary?.tradableCash ?? 0);
  const realActionBuyOrderPrice = useMemo(() => {
    if (!realActionBuyModal) {
      return Number.NaN;
    }
    return normalizeVnStockPrice(parseNumericInput(realActionBuyModal.priceInput));
  }, [realActionBuyModal]);
  const realActionBuyQuantity = useMemo(() => {
    if (!realActionBuyModal) {
      return Number.NaN;
    }
    return Math.trunc(parseNumericInput(realActionBuyModal.quantityInput));
  }, [realActionBuyModal]);
  const realActionBuyMaxQuantity = useMemo(
    () => maxBoardLotQuantity(realActionBuyAvailableCash, realActionBuyOrderPrice),
    [realActionBuyAvailableCash, realActionBuyOrderPrice],
  );
  const realActionBuyNotional =
    Number.isFinite(realActionBuyOrderPrice) && Number.isFinite(realActionBuyQuantity)
      ? realActionBuyOrderPrice * realActionBuyQuantity
      : 0;
  const dnsePortfolioMarketValue = useMemo(() => {
    return (dnseAccountSummary?.holdings ?? []).reduce((total, row) => {
      const price = Number(row.marketPrice ?? row.averagePrice ?? 0);
      const quantity = Number(row.quantity ?? 0);
      if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) {
        return total;
      }
      return total + price * quantity;
    }, 0);
  }, [dnseAccountSummary?.holdings]);

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
    async (sessionId: string, options?: { append?: boolean; offset?: number; tab?: DemoOrdersTab }) => {
      try {
        const offset = options?.offset ?? 0;
        const applyAccountSnapshot = (account: DemoAccountData) => {
          setDemoCash(account.cash_balance);
          setDemoPositions(account.positions);
          setDemoUnrealizedPnl(account.unrealized_pnl);
        };
        if (options?.append) {
          const tab = options.tab ?? "buy";
          const account = await fetchDemoAccount(sessionId, {
            historyLimit,
            historyOffset: offset,
            historySide: DEMO_ORDER_TAB_SIDE[tab],
          });
          applyAccountSnapshot(account);
          const mappedFromDemoTrades = mapDemoOrderHistory(account);
          setHistoryTotalBySide((prev) => ({ ...prev, [tab]: account.trade_history_total }));
          setDemoOrdersBySide((prev) => {
            const existingIds = new Set(prev[tab].map((item) => item.id));
            const merged = [...prev[tab]];
            for (const row of mappedFromDemoTrades) {
              if (!existingIds.has(row.id)) {
                merged.push(row);
              }
            }
            return { ...prev, [tab]: merged };
          });
          return;
        }

        const [buyAccount, sellAccount] = await Promise.all(
          DEMO_ORDER_TABS.map((tab) =>
            fetchDemoAccount(sessionId, {
              historyLimit,
              historyOffset: offset,
              historySide: DEMO_ORDER_TAB_SIDE[tab],
            }),
          ),
        );
        applyAccountSnapshot(buyAccount);
        setHistoryOffsetBySide({ buy: offset, sell: offset });
        setHistoryTotalBySide({
          buy: buyAccount.trade_history_total,
          sell: sellAccount.trade_history_total,
        });
        setDemoOrdersBySide({
          buy: mapDemoOrderHistory(buyAccount),
          sell: mapDemoOrderHistory(sellAccount),
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

  const handleDepositDemoCash = useCallback(async () => {
    const amount = Math.trunc(Number(demoDepositAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setDemoOverviewError("So tien nap them phai > 0.");
      return;
    }
    if (!demoSessionId.trim()) {
      setDemoOverviewError("Chua co demo session de nap tien.");
      return;
    }
    setDemoDepositBusy(true);
    try {
      await depositDemoCash(demoSessionId, amount);
      setDemoDepositAmount("");
      setDemoOverviewError("");
      pushDemoLog(`Da nap them ${formatVnd(amount)} VND vao demo session.`);
      showToast(`Da nap them ${formatVnd(amount)} VND vao tai khoan demo.`, "success");
      await Promise.all([
        refreshDemoOverview(demoSessionId),
        refreshDemoAccount(demoSessionId, { offset: 0 }),
      ]);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Nap tien demo that bai.";
      setDemoOverviewError(message);
      pushDemoLog(message);
      showToast(message, "error");
    } finally {
      setDemoDepositBusy(false);
    }
  }, [demoDepositAmount, demoSessionId, pushDemoLog, refreshDemoAccount, refreshDemoOverview, showToast]);

  const handleManualDemoPortfolioReview = useCallback(async () => {
    const sessionId = demoSessionId.trim();
    if (!sessionId) {
      setDemoOverviewError("Chua co demo session de overview.");
      return;
    }
    setDemoPortfolioReviewBusy(true);
    setDemoPortfolioReviewMessage("");
    try {
      const result = await postDemoPortfolioReviewRunOnce(sessionId);
      const applied = Number(result.applied_count || 0);
      const skipped = Number(result.skipped_count || 0);
      const status = String(result.run_status || "-");
      const message = `Manual overview ${status}: apply ${applied}, skip ${skipped}.`;
      setDemoPortfolioReviewMessage(message);
      setDemoOverviewError("");
      pushDemoLog(message);
      showToast(message, applied > 0 ? "success" : "info");
      await refreshDemoOverview(sessionId);
    } catch (error) {
      const message = isAppError(error) ? error.message : "Manual overview demo portfolio that bai.";
      setDemoPortfolioReviewMessage("");
      setDemoOverviewError(message);
      pushDemoLog(message);
      showToast(message, "error");
    } finally {
      setDemoPortfolioReviewBusy(false);
    }
  }, [demoSessionId, pushDemoLog, refreshDemoOverview, showToast]);

  const loadSchedulerStatus = useCallback(async () => {
    try {
      const status = await fetchSchedulerStatus(schedulerAccountMode);
      setSchedulerStatus(status);
      if (schedulerAccountMode === "REAL") {
        const scanOnlyStatus = await fetchRealScanOnlySchedulerStatus();
        setRealScanOnlySchedulerStatus(scanOnlyStatus);
        const scanOnlyEnabled = Boolean(scanOnlyStatus.enabled);
        setRealScanOnlyScheduleEnabled(scanOnlyEnabled);
        lastRealScanOnlyScheduleEnabledRef.current = scanOnlyEnabled;
        if (scanOnlyEnabled) {
          setRealAutomationMode("SCAN_ONLY");
        } else if (status.enabled) {
          setRealAutomationMode("AUTO_TRADING");
        }
      } else {
        setRealScanOnlySchedulerStatus(null);
      }
      setSchedulerError("");
    } catch (error) {
      setSchedulerStatus(null);
      setRealScanOnlySchedulerStatus(null);
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
      const [response, recent] = await Promise.all([fetchRealRecommendationsLatest(), fetchRealRecommendationsRecent(10)]);
      setRealRecommendations(response.recommendations ?? []);
      setRealRejectedRecommendations(response.rejected_recommendations ?? []);
      setRealWatchCandidates(response.watch_candidates ?? []);
      setRealMailSignalRecommendations(response.mail_signal_recommendations ?? []);
      setRealRecommendationsGeneratedAt(response.generated_at ?? null);
      const scanned = Number(response.scanned ?? 0);
      setRealRecommendationsScannedCount(Number.isFinite(scanned) ? scanned : null);
      setRealRecommendationsScanDiagnostics(response.scan_diagnostics ?? null);
      setRealRecommendationsRecentLogs(recent);
      setRealRecommendationsError("");
    } catch (error) {
      setRealRecommendations([]);
      setRealRejectedRecommendations([]);
      setRealWatchCandidates([]);
      setRealMailSignalRecommendations([]);
      setRealRecommendationsGeneratedAt(null);
      setRealRecommendationsScannedCount(null);
      setRealRecommendationsScanDiagnostics(null);
      setRealRecommendationsRecentLogs([]);
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
        real_account_available_cash_vnd: Number(dnseAccountSummary?.tradableCash ?? 0) || undefined,
      });
      setRealRecommendations(response.recommendations ?? []);
      setRealRejectedRecommendations(response.rejected_recommendations ?? []);
      setRealWatchCandidates(response.watch_candidates ?? []);
      setRealMailSignalRecommendations(response.mail_signal_recommendations ?? []);
      setRealRecommendationsGeneratedAt(response.generated_at ?? null);
      const scanned = Number(response.scanned ?? 0);
      setRealRecommendationsScannedCount(Number.isFinite(scanned) ? scanned : null);
      setRealRecommendationsScanDiagnostics(response.scan_diagnostics ?? null);
      const recent = await fetchRealRecommendationsRecent(10);
      setRealRecommendationsRecentLogs(recent);
      setRealRecommendationsError("");
      showToast(
        `Da luu short-term=${Number(response.short_term_count ?? response.count ?? 0)}, watch=${Number(response.watch_count ?? 0)}, mail=${Number(response.mail_signal_count ?? 0)}.`,
        "success",
      );
    } catch (error) {
      const message = isAppError(error) ? error.message : "Scan recommendations REAL that bai.";
      setRealRecommendationsError(message);
      showToast(message, "error");
    } finally {
      setRealRecommendationsBusy(false);
    }
  }, [dnseAccountSummary?.tradableCash, showToast]);

  const handleActionBuyRealRecommendation = useCallback(
    (row: RealRecommendationRow) => {
      const availableCash = realActionBuyAvailableCash;
      if (!Number.isFinite(availableCash) || availableCash <= 0) {
        const message = "Khong tim thay available cash REAL. Vui long tai lai thong tin tai khoan DNSE.";
        setRealRecommendationsError(message);
        showToast(message, "error");
        return;
      }
      const defaultPrice = normalizeVnStockPrice(Number(row.entry || 0));
      const cashMaxQuantity = maxBoardLotQuantity(availableCash, defaultPrice);
      const suggestedQuantity = Math.floor(Number(row.suggested_quantity || 0) / 100) * 100;
      const defaultQuantity =
        suggestedQuantity >= 100 && cashMaxQuantity >= 100 ? Math.min(suggestedQuantity, cashMaxQuantity) : 0;
      setRealActionBuyModal({
        row,
        priceInput: defaultPrice > 0 ? String(defaultPrice) : "",
        quantityInput: defaultQuantity >= 100 ? String(defaultQuantity) : "",
        error: "",
      });
    },
    [realActionBuyAvailableCash, showToast],
  );

  const handleSubmitRealActionBuy = useCallback(async () => {
    if (!realActionBuyModal) {
      return;
    }
    const row = realActionBuyModal.row;
    const availableCash = realActionBuyAvailableCash;
    const orderPrice = normalizeVnStockPrice(parseNumericInput(realActionBuyModal.priceInput));
    const quantityRaw = parseNumericInput(realActionBuyModal.quantityInput);
    const quantity = Math.trunc(quantityRaw);
    const maxQuantity = maxBoardLotQuantity(availableCash, orderPrice);
    const fail = (message: string) => {
      setRealActionBuyModal((current) => (current ? { ...current, error: message } : current));
      showToast(message, "error");
    };
    if (!Number.isFinite(availableCash) || availableCash <= 0) {
      fail("Khong tim thay available cash REAL. Vui long tai lai thong tin tai khoan DNSE.");
      return;
    }
    if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
      fail("Nhap gia mua hop le.");
      return;
    }
    if (!Number.isFinite(quantityRaw) || !Number.isInteger(quantityRaw) || quantity < 100 || quantity % 100 !== 0) {
      fail("So luong mua phai la boi so 100 va toi thieu 100 cp.");
      return;
    }
    if (quantity > maxQuantity) {
      fail(`So luong vuot max theo tien kha dung (${formatVnd(maxQuantity)} cp).`);
      return;
    }
    setRealRecommendationBuyBusySymbol(row.symbol);
    try {
      const response = await postRealRecommendationActionBuy({
        ...row,
        available_cash_vnd: availableCash,
        order_price: orderPrice,
        quantity,
      });
      const success = Boolean((response as { success?: boolean }).success);
      if (!success) {
        const reason = String(((response as { data?: { reason?: string } }).data?.reason ?? "action_buy_rejected"));
        throw new Error(reason);
      }
      setRealActionBuyModal(null);
      showToast(`Da gui lenh BUY ${row.symbol} (${formatVnd(quantity)} cp @ ${formatPrice(orderPrice)}).`, "success");
      await loadRealPendingOrders();
    } catch (error) {
      const message = isAppError(error) ? error.message : `Action Buy that bai cho ${row.symbol}.`;
      setRealActionBuyModal((current) => (current ? { ...current, error: message } : current));
      setRealRecommendationsError(message);
      showToast(message, "error");
    } finally {
      setRealRecommendationBuyBusySymbol("");
    }
    },
    [loadRealPendingOrders, realActionBuyAvailableCash, realActionBuyModal, showToast],
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
        setHistoryOffsetBySide(emptyDemoHistoryCounts());
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

  useEffect(() => {
    if (accountTab !== "real" || realAutomationMode !== "SCAN_ONLY" || !realScanOnlyScheduleActive) {
      return;
    }
    const pollSeconds = Math.min(60, Math.max(15, Number(realScanOnlySchedulerStatus?.poll_seconds ?? 30)));
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadSchedulerStatus();
      void loadRealRecommendations();
    };
    const id = window.setInterval(tick, pollSeconds * 1000);
    return () => window.clearInterval(id);
  }, [
    accountTab,
    loadRealRecommendations,
    loadSchedulerStatus,
    realAutomationMode,
    realScanOnlyScheduleActive,
    realScanOnlySchedulerStatus?.poll_seconds,
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
      if (!hasDnseSession()) {
        return;
      }
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

  const handleProbeAccount = useCallback(async () => {
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
      const depositedInfo = extractDnseDepositedAmountFromRows([...accRows, ...balanceRows]);
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
      const message = isAppError(error) ? error.message : UI_TEXT.autoTrading.accountProbeFailed;
      if (isDnseSessionExpiredError(error)) {
        setSessionActive(false);
        showToast(message, "error");
      }
      setAccountProbeMessage(message);
    } finally {
      setAccountProbeBusy(false);
    }
  }, [credsPayload, showToast]);

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

  const activeDemoOrders = demoOrdersBySide[demoOrdersTab];
  const activeHistoryOffset = historyOffsetBySide[demoOrdersTab] ?? 0;
  const activeHistoryTotal = historyTotalBySide[demoOrdersTab] ?? 0;

  const handleLoadMoreHistory = async () => {
    const tab = demoOrdersTab;
    const nextOffset = activeHistoryOffset + historyLimit;
    setHistoryLoadingMore(true);
    try {
      await refreshDemoAccount(demoSessionId, { append: true, offset: nextOffset, tab });
      setHistoryOffsetBySide((prev) => ({ ...prev, [tab]: nextOffset }));
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const canLoadMoreHistory = activeDemoOrders.length < activeHistoryTotal;
  const handleNewDemoSession = async () => {
    setDemoSessionBusy(true);
    try {
      const newSessionId = await createNewDemoSession();
      window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, newSessionId);
      setDemoSessionId(newSessionId);
      await setSchedulerDemoSession(newSessionId);
      setHistoryOffsetBySide(emptyDemoHistoryCounts());
      setHistoryTotalBySide(emptyDemoHistoryCounts());
      setDemoOrdersBySide(emptyDemoOrdersBySide());
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
      setHistoryOffsetBySide(emptyDemoHistoryCounts());
      setHistoryTotalBySide(emptyDemoHistoryCounts());
      setDemoOrdersBySide(emptyDemoOrdersBySide());
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

  const handleToggleScheduler = useCallback(async () => {
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
  }, [loadAutomationRuns, schedulerAccountMode, schedulerStatus]);

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
            const updated = await toggleRealScanOnlyScheduler(desiredScanOnlyEnabled);
            setRealScanOnlySchedulerStatus(updated);
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
        const updated = await toggleRealScanOnlyScheduler(false);
        setRealScanOnlySchedulerStatus(updated);
        lastRealScanOnlyScheduleEnabledRef.current = false;
      } catch (error) {
        setSchedulerError(isAppError(error) ? error.message : "Khong toggle duoc schedule SCAN_ONLY OFF tren BE.");
        } finally {
          realScanOnlySchedulerToggleBusyRef.current = false;
        }
      }

      // Production scheduler is controlled by the Auto trading button only.
      // Do not reuse the scan-only toggle state here; Scan only must never
      // turn on REAL auto order execution.
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

  const handleRunMailSignalsNow = async () => {
    if (mailSignalsRunOnceBusy) {
      return;
    }
    setMailSignalsRunOnceBusy(true);
    try {
      const row = await postMailSignalsRunOnce();
      setMailSignals(row);
      setMailSignalsError("");
      showToast("Da chay mail signals manual thanh cong.", "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : "Chay mail signals manual that bai.";
      setMailSignalsError(message);
      showToast(message, "error");
    } finally {
      setMailSignalsRunOnceBusy(false);
    }
  };

  const handleRunPostCloseRefreshNow = async () => {
    if (liquidityRefreshBusy) {
      return;
    }
    setLiquidityRefreshBusy(true);
    try {
      await postShortTermPostCloseRefreshRunOnce();
      await loadLiquidityEligibleRows();
      setLiquidityEligibleError("");
      showToast("Da chay post-close refresh thanh cong.", "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : "Chay post-close refresh that bai.";
      setLiquidityEligibleError(message);
      showToast(message, "error");
    } finally {
      setLiquidityRefreshBusy(false);
    }
  };

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

  const realActionBuyBusy = Boolean(realActionBuyModal && realRecommendationBuyBusySymbol === realActionBuyModal.row.symbol);
  const realActionBuySubmitDisabled =
    !realActionBuyModal ||
    realActionBuyBusy ||
    !Number.isFinite(realActionBuyOrderPrice) ||
    realActionBuyOrderPrice <= 0 ||
    !Number.isFinite(realActionBuyQuantity) ||
    realActionBuyQuantity < 100 ||
    realActionBuyQuantity % 100 !== 0 ||
    realActionBuyQuantity > realActionBuyMaxQuantity;

  return (
    <div className="flex flex-col gap-8">
      {realActionBuyModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm disabled:cursor-wait"
            onClick={() => setRealActionBuyModal(null)}
            disabled={realActionBuyBusy}
            aria-label="Dong Action Buy"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="real-action-buy-title"
            className="relative z-[101] w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#080c14] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h2 id="real-action-buy-title" className="text-base font-semibold text-slate-100">
                  Action Buy {realActionBuyModal.row.symbol}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  TP {formatPrice(realActionBuyModal.row.take_profit)} | SL {formatPrice(realActionBuyModal.row.stop_loss)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRealActionBuyModal(null)}
                disabled={realActionBuyBusy}
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                Dong
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <p className="text-slate-500">Available</p>
                  <p className="mt-1 font-mono text-sm text-emerald-200">{formatVnd(realActionBuyAvailableCash)} VND</p>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <p className="text-slate-500">Max amount</p>
                  <p className="mt-1 font-mono text-sm text-cyan-200">{formatVnd(realActionBuyMaxQuantity)} cp</p>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <p className="text-slate-500">Notional</p>
                  <p className="mt-1 font-mono text-sm text-slate-100">{formatVnd(Math.max(0, realActionBuyNotional))} VND</p>
                </div>
              </div>
              <label className="block text-xs font-semibold text-slate-300">
                Price
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={realActionBuyModal.priceInput}
                  onChange={(e) =>
                    setRealActionBuyModal((current) =>
                      current ? { ...current, priceInput: e.target.value, error: "" } : current,
                    )
                  }
                  className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="27500"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-300">
                Amount
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={realActionBuyModal.quantityInput}
                    onChange={(e) =>
                      setRealActionBuyModal((current) =>
                        current ? { ...current, quantityInput: e.target.value, error: "" } : current,
                      )
                    }
                    className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                    placeholder="100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRealActionBuyModal((current) =>
                        current ? { ...current, quantityInput: String(realActionBuyMaxQuantity), error: "" } : current,
                      )
                    }
                    disabled={realActionBuyMaxQuantity < 100 || realActionBuyBusy}
                    className="shrink-0 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                  >
                    Max
                  </button>
                </div>
              </label>
              {realActionBuyModal.error ? <p className="text-xs text-rose-300">{realActionBuyModal.error}</p> : null}
              <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setRealActionBuyModal(null)}
                  disabled={realActionBuyBusy}
                  className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
                >
                  Huy
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmitRealActionBuy()}
                  disabled={realActionBuySubmitDisabled}
                  className="rounded-md border border-emerald-300/40 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/20 disabled:opacity-50"
                >
                  {realActionBuyBusy ? "Dang mua..." : "Buy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
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
        !sessionActive ? (
          <section className="glass-panel mx-auto w-full max-w-3xl rounded-xl p-5">
            <RealSectionHeader
              title={UI_TEXT.autoTrading.dnseTitle}
              meta={UI_TEXT.dnse.sessionNone}
            />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-slate-100">{UI_TEXT.dnse.credentialsSection}</p>
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    id="at-dnse-user"
                    className="h-10 rounded-md border border-white/15 bg-black/30 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={UI_TEXT.dnse.usernamePlaceholder}
                  />
                  <input
                    className="h-10 rounded-md border border-white/15 bg-black/30 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={UI_TEXT.dnse.passwordPlaceholder}
                  />
                  <button
                    type="button"
                    onClick={() => void handleDnseLogin()}
                    disabled={sessionBusy}
                    className="mt-1 h-10 rounded-md bg-cyan-300/20 px-3 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/30 disabled:opacity-50"
                  >
                    {sessionBusy ? UI_TEXT.dnse.sessionLoggingIn : UI_TEXT.dnse.sessionLogin}
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-slate-100">{UI_TEXT.autoTrading.tokenPasteLabel}</p>
                <textarea
                  id="at-dnse-token"
                  className="mt-3 min-h-[116px] w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={UI_TEXT.autoTrading.tokenPastePlaceholder}
                />
                <button
                  type="button"
                  onClick={handleApplyToken}
                  className="mt-2 h-9 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                >
                  {UI_TEXT.autoTrading.tokenApply}
                </button>
              </div>
            </div>
          </section>
        ) : (
        <div className="flex flex-col gap-5">
          <section className="glass-panel rounded-xl p-5">
            <RealSectionHeader
              title="REAL Control Center"
              meta={`Session ${sessionActive ? "ACTIVE" : "NONE"}${realRecommendationsGeneratedAt ? ` | Scan ${formatDateTime(realRecommendationsGeneratedAt)}` : ""}`}
              action={
                <>
                  <RealStatusPill
                    label="Scan schedule"
                    active={realScanOnlyScheduleActive}
                  />
                  <RealStatusPill label="Auto trading" active={Boolean(schedulerStatus?.enabled)} />
                  <button
                    type="button"
                    onClick={handleDnseLogout}
                    className="h-8 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.06]"
                  >
                    {UI_TEXT.dnse.sessionLogout}
                  </button>
                </>
              }
            />
            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRealAutomationMode("SCAN_ONLY")}
                  className={`h-9 rounded-md border px-3 text-xs font-semibold transition ${
                    realAutomationMode === "SCAN_ONLY"
                      ? "border-cyan-300/60 bg-cyan-300/[0.16] text-cyan-50"
                      : "border-white/10 bg-black/20 text-slate-400 hover:border-cyan-300/25 hover:text-cyan-100"
                  }`}
                  disabled={schedulerBusy}
                >
                  Scan only
                </button>
                <button
                  type="button"
                  onClick={() => setRealAutomationMode("AUTO_TRADING")}
                  className={`h-9 rounded-md border px-3 text-xs font-semibold transition ${
                    realAutomationMode === "AUTO_TRADING"
                      ? "border-cyan-300/60 bg-cyan-300/[0.16] text-cyan-50"
                      : "border-white/10 bg-black/20 text-slate-400 hover:border-cyan-300/25 hover:text-cyan-100"
                  }`}
                  disabled={schedulerBusy}
                >
                  Auto trading
                </button>
                {realAutomationMode === "SCAN_ONLY" ? (
                  <button
                    type="button"
                    onClick={() => setRealScanOnlyScheduleEnabled((v) => !v)}
                    disabled={schedulerBusy}
                    className="h-9 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"
                  >
                    {realScanOnlyScheduleEnabled ? "Tat scan" : "Bat scan"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleToggleScheduler()}
                    disabled={schedulerBusy || !schedulerStatus}
                    className="h-9 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"
                  >
                    {schedulerBusy ? "Dang toggle..." : schedulerStatus?.enabled ? "Tat Auto" : "Bat Auto"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <button
                  type="button"
                  onClick={() => void handleProbeAccount()}
                  disabled={accountProbeBusy}
                  className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {accountProbeBusy ? UI_TEXT.dnse.loadingAccountInfo : UI_TEXT.dnse.loadAccountInfo}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePollRealPendingOrders()}
                  disabled={realPendingOrdersBusy}
                  className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {realPendingOrdersBusy ? "Dang poll..." : "Poll DNSE"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleScanRealRecommendations()}
                  disabled={realRecommendationsBusy}
                  className="h-9 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"
                >
                  {realRecommendationsBusy ? "Dang scan..." : "Scan recommendations"}
                </button>
              </div>
            </div>
            {accountProbeMessage ? <p className="mt-3 text-xs text-slate-400">{accountProbeMessage}</p> : null}
            {schedulerError ? <p className="mt-3 text-xs text-rose-300">{schedulerError}</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              <RealMetricCard label="Mode" value={realAutomationMode === "SCAN_ONLY" ? "Scan only" : "Auto trading"} tone="cyan" />
              <RealMetricCard
                label="Scan schedule"
                value={realScanOnlyWorkerRunning ? "RUNNING" : realScanOnlyScheduleActive ? "ON" : "OFF"}
                tone={realScanOnlyScheduleActive ? "emerald" : "slate"}
              />
              <RealMetricCard label="Auto scheduler" value={schedulerStatus?.enabled ? "ON" : "OFF"} tone={schedulerStatus?.enabled ? "emerald" : "slate"} />
              <RealMetricCard label="Pending orders" value={realPendingOrders.length} tone={realPendingOrders.length > 0 ? "amber" : "slate"} />
              <RealMetricCard label="Short-term BUY" value={visibleRealRecommendations.length} tone="cyan" />
              <RealMetricCard label="Watch" value={visibleRealWatchCandidates.length} tone="amber" />
              <RealMetricCard label="Mail / Liquidity" value={`${mailSignalPickCount} / ${liquidityEligibleTotal}`} tone="slate" />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Signal source: Mail cache {mailSignalsSourceLabel}; liquidity pool tu Redis post-close refresh.
            </p>
          </section>
          <section className="glass-panel rounded-xl p-5">
            <RealSectionHeader
              title="DNSE Account Snapshot"
              meta="Cash, buying power, and current positions from DNSE balance response"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-emerald-300/35 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                    REAL
                  </span>
                  <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
                    Session active
                  </span>
                </div>
              }
            />
            {dnseAccountSummary ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 xl:grid-cols-[1fr_13rem]">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Account holder</p>
                        <p className="mt-1 text-lg font-semibold text-slate-100">{dnseAccountSummary.accountName || "-"}</p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Sub-account</p>
                        <div className="mt-1 flex flex-wrap gap-1.5 sm:justify-end">
                          {dnseAccountSummary.subAccounts.length > 0 ? (
                            dnseAccountSummary.subAccounts.map((subAccount) => (
                              <span
                                key={subAccount}
                                className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-emerald-200"
                              >
                                {subAccount}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400">
                              Not reported
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-amber-100/75">Available funds</p>
                        <p className="mt-1 text-base font-semibold text-amber-100">
                          {dnseAccountSummary.tradableCash != null ? `${formatVnd(dnseAccountSummary.tradableCash)} VND` : "-"}
                        </p>
                        <p
                          className={`mt-2 text-[11px] ${
                            dnseAccountSummary.depositedAmount != null &&
                            dnseAccountSummary.cashCurrent != null &&
                            dnseAccountSummary.cashCurrent < dnseAccountSummary.depositedAmount
                              ? "text-rose-200"
                              : "text-amber-100/75"
                          }`}
                        >
                          Cash balance: {dnseAccountSummary.cashCurrent != null ? `${formatVnd(dnseAccountSummary.cashCurrent)} VND` : "-"}
                        </p>
                        {dnseAccountSummary.depositedAmount != null &&
                        dnseAccountSummary.cashCurrent != null &&
                        dnseAccountSummary.depositedAmount > 0 ? (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {(() => {
                              const pct =
                                ((dnseAccountSummary.cashCurrent - dnseAccountSummary.depositedAmount) /
                                  dnseAccountSummary.depositedAmount) *
                                100;
                              const sign = pct > 0 ? "+" : "";
                              return `${sign}${pct.toFixed(2)}% vs deposited`;
                            })()}
                          </p>
                        ) : null}
                      </div>
                      {dnseAccountSummary.depositedAmount != null ? (
                        <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-cyan-100/75">Deposited capital</p>
                          <p className="mt-1 text-base font-semibold text-cyan-100">
                            {formatVnd(dnseAccountSummary.depositedAmount)} VND
                          </p>
                        </div>
                      ) : null}
                      <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Portfolio value</p>
                        <p className="mt-1 text-base font-semibold text-slate-100">
                          {dnsePortfolioMarketValue > 0 ? `${formatVnd(dnsePortfolioMarketValue)} VND` : "-"}
                        </p>
                      </div>
                    </div>
                    {dnseAccountSummary.depositedAmount == null ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        DNSE response did not include a deposited-capital field; only cash, buying power, and positions are shown.
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white p-3 text-slate-900">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">Deposit QR</p>
                        <p className="text-[11px] text-slate-500">DNSE funding</p>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">QR</span>
                    </div>
                    {DNSE_DEPOSIT_QR_URL ? (
                      <Image
                        src={DNSE_DEPOSIT_QR_URL}
                        alt="DNSE deposit QR"
                        width={184}
                        height={184}
                        className="h-44 w-full rounded-md object-contain"
                      />
                    ) : (
                      <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-slate-300 text-[11px] text-slate-500">
                        QR not configured
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">Portfolio positions</p>
                      <p className="mt-1 text-[11px] text-slate-500">Holdings returned from DNSE balance snapshot.</p>
                    </div>
                    <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                      {dnseAccountSummary.holdings.length} symbols
                    </span>
                  </div>
                  {dnseAccountSummary.holdings.length === 0 ? (
                    <div className="mt-3 rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm font-semibold text-slate-200">No stock positions returned by DNSE</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Portfolio is empty, or DNSE did not include holdings in the current account response.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 max-h-56 overflow-y-auto overflow-x-auto">
                      <table className="w-full min-w-[680px] text-left text-[11px] text-slate-200">
                        <thead className="border-b border-white/10 text-slate-500">
                          <tr>
                            <th className="py-1.5 pr-3">Symbol</th>
                            <th className="py-1.5 pr-3">Qty</th>
                            <th className="py-1.5 pr-3">Avg price</th>
                            <th className="py-1.5 pr-3">Market</th>
                            <th className="py-1.5 pr-3">Est. value</th>
                            <th className="py-1.5">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dnseAccountSummary.holdings.map((row) => {
                            const markPrice = Number(row.marketPrice ?? row.averagePrice ?? 0);
                            const estValue =
                              Number.isFinite(markPrice) && markPrice > 0 && row.quantity > 0 ? markPrice * row.quantity : null;
                            return (
                              <tr key={row.symbol} className="border-b border-white/5">
                                <td className="py-1.5 pr-3 font-mono text-cyan-100">{row.symbol}</td>
                                <td className="py-1.5 pr-3">{row.quantity}</td>
                                <td className="py-1.5 pr-3">{row.averagePrice != null ? formatPrice(row.averagePrice) : "-"}</td>
                                <td className="py-1.5 pr-3">{row.marketPrice != null ? formatPrice(row.marketPrice) : "-"}</td>
                                <td className="py-1.5 pr-3">{estValue != null ? `${formatVnd(estValue)} VND` : "-"}</td>
                                <td className="py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void handleSellRealHolding(row)}
                                    disabled={realHoldingSellBusySymbol === row.symbol}
                                    className="rounded-md border border-amber-300/40 px-2 py-1 text-[11px] font-semibold text-amber-100 disabled:opacity-50"
                                  >
                                    {realHoldingSellBusySymbol === row.symbol ? "Selling..." : "Sell"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-slate-200">Account snapshot not loaded</p>
                <p className="mt-1 text-[11px] text-slate-500">Refresh the DNSE session to view cash, buying power, and positions.</p>
              </div>
            )}
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
            <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 bg-[#0b1220]/95 px-1 pb-2 backdrop-blur">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">REAL Recommendations (scan-only)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Scan xong se chi luu khuyen nghi vao Redis, khong tu dong dat lenh mua.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  Fresh window (minutes)
                  <select
                    className="rounded-md border border-white/15 bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-100"
                    value={realRecommendationsFreshMinutes}
                    onChange={(e) => setRealRecommendationsFreshMinutes(Number(e.target.value) || 30)}
                  >
                    <option value={15}>15</option>
                    <option value={30}>30</option>
                    <option value={60}>60</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleScanRealRecommendations()}
                  disabled={realRecommendationsBusy || !sessionActive}
                  className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                >
                  {realRecommendationsBusy ? "Dang scan recommendations..." : "Scan recommendations"}
                </button>
              </div>
            </div>
            {realRecommendationsError ? <p className="mt-2 text-xs text-rose-300">{realRecommendationsError}</p> : null}
            {realRecommendationsGeneratedAt ? (
              <p className="mt-2 text-[11px] text-slate-500">Generated: {formatDateTime(realRecommendationsGeneratedAt)}</p>
            ) : null}
            {!realRecommendationsFresh && realRecommendationsGeneratedAt ? (
              <p className="mt-2 text-xs text-amber-300">
                Recommendation da qua fresh window {realRecommendationsFreshMinutes} phut. Vui long scan lai truoc khi Action Buy.
              </p>
            ) : null}
            {visibleRealRecommendations.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Chua co khuyen nghi BUY trong Redis. Xem rejected/reason ben duoi de biet bi chan o scan hay risk.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-xs text-slate-200">
                  <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Entry</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Take profit</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Stop loss</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">R/R</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Risk</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Confidence</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Reason</th>
                      <th className="py-2.5 whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRealRecommendations.map((item, idx) => (
                      <tr key={`${item.symbol}-${idx}`} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 font-mono text-cyan-200">{item.symbol}</td>
                        <td className="py-2 pr-3 text-slate-100">{formatPrice(item.entry)}</td>
                        <td className="py-2 pr-3 text-emerald-300">{formatPrice(item.take_profit)}</td>
                        <td className="py-2 pr-3 text-rose-300">{formatPrice(item.stop_loss)}</td>
                        <td className="py-2 pr-3 text-slate-100">
                          {item.reward_risk == null ? "-" : Number(item.reward_risk || 0).toFixed(2)}
                        </td>
                        <td
                          className={`py-2 pr-3 ${
                            String(item.risk_status || "").toUpperCase() === "REJECTED"
                              ? "text-rose-300"
                              : "text-emerald-300"
                          }`}
                        >
                          {String(item.risk_status || "-")}
                          {item.risk_reason && item.risk_reason !== "ok" ? `:${item.risk_reason}` : ""}
                        </td>
                            <td className="py-2 pr-3 text-amber-300">{formatConfidencePercent(item.confidence)}</td>
                        <td className="py-2 pr-3 text-slate-300">{item.reason || "-"}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => void handleActionBuyRealRecommendation(item)}
                            disabled={
                              !sessionActive ||
                              String(item.risk_status || "").toUpperCase() === "REJECTED" ||
                              realRecommendationBuyBusySymbol === item.symbol ||
                              !Number.isFinite(realActionBuyAvailableCash) ||
                              realActionBuyAvailableCash <= 0
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
            <div className="mt-3 rounded-md border border-amber-300/15 bg-amber-300/[0.04] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-amber-100">Watch candidates</p>
                <p className="text-[11px] text-amber-200/70">{visibleRealWatchCandidates.length} scan rows</p>
              </div>
              {visibleRealWatchCandidates.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-500">Chua co ma theo doi tu scan gate.</p>
              ) : (
                <div className="mt-2 max-h-44 overflow-y-auto text-[11px] font-mono text-slate-300">
                  {visibleRealWatchCandidates.slice(0, 20).map((row, idx) => (
                    <p key={`watch-${row.symbol}-${idx}`} className="border-b border-white/5 py-1">
                      <span className="text-amber-200">{row.symbol}</span>
                      {row.exchange ? <span className="text-slate-500">:{row.exchange}</span> : null} | scan:
                      {String(row.scan_reason || "-")} | rr=
                      {row.reward_risk == null ? "-" : Number(row.reward_risk || 0).toFixed(2)} | rsi=
                      {row.rsi14 == null ? "-" : Number(row.rsi14 || 0).toFixed(1)} | {row.reason || "-"}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-300">Rejected recommendations</p>
                <p className="text-[11px] text-slate-500">
                  risk={visibleRealRejectedRecommendations.length} | scan_gate=
                  {Number(realRecommendationsScanDiagnostics?.rejected_candidates?.length ?? 0)}
                </p>
              </div>
              {realRejectedTopReasons.length > 0 ? (
                <p className="mt-2 text-[11px] text-amber-200">
                  Top reasons: {realRejectedTopReasons.map(([reason, count]) => `${reason}:${count}`).join(" | ")}
                </p>
              ) : null}
              {visibleRealRejectedRecommendations.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-500">Chua co rejected risk rows.</p>
              ) : (
                <div className="mt-2 max-h-44 overflow-y-auto text-[11px] font-mono text-slate-300">
                  {visibleRealRejectedRecommendations.slice(0, 20).map((row, idx) => (
                    <p key={`risk-rej-${row.symbol}-${idx}`} className="border-b border-white/5 py-1">
                      <span className="text-cyan-200">{row.symbol}</span> | {String(row.risk_reason || "-")} | setup=
                      {String(row.setup_type || "-")} | rr={row.reward_risk == null ? "-" : Number(row.reward_risk || 0).toFixed(2)} |
                      qty={Number(row.suggested_quantity || 0)}
                    </p>
                  ))}
                </div>
              )}
              {realRecommendationsScanDiagnostics?.rejected_candidates?.length ? (
                <div className="mt-2 max-h-36 overflow-y-auto text-[11px] font-mono text-slate-400">
                  {realRecommendationsScanDiagnostics.rejected_candidates.slice(0, 20).map((row, idx) => (
                    <p key={`scan-rej-${idx}`} className="border-b border-white/5 py-1">
                      <span className="text-slate-200">{String(row.symbol || "-")}</span> | scan:{String(row.reason || "-")}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <LiquidityCachePanel
              rows={liquidityEligibleRows}
              total={liquidityEligibleTotal}
              error={liquidityEligibleError}
              busy={liquidityRefreshBusy}
              onRunNow={() => void handleRunPostCloseRefreshNow()}
              compact
            />
            <MailSignalsPanel
              mailSignals={mailSignals}
              pickCount={mailSignalPickCount}
              error={mailSignalsError}
              busy={mailSignalsRunOnceBusy}
              onRunNow={() => void handleRunMailSignalsNow()}
              compact
            />
          </div>

          <section className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-200">Real Logs</h3>
            <p className="mt-1 text-xs text-slate-500">Tach rieng log REAL theo 2 nhom: Scan only va Auto trading.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRealLogsTab("SCAN_ONLY")}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  realLogsTab === "SCAN_ONLY"
                    ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50"
                    : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
                }`}
              >
                Scan only
              </button>
              <button
                type="button"
                onClick={() => setRealLogsTab("AUTO_TRADING")}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  realLogsTab === "AUTO_TRADING"
                    ? "border-cyan-300/70 bg-cyan-300/25 text-cyan-50"
                    : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
                }`}
              >
                Auto trading
              </button>
            </div>
            {realLogsTab === "SCAN_ONLY" ? (
              <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-[11px] font-mono text-slate-300">
                <p>
                  generated_at:{" "}
                  <span className="text-cyan-200">
                    {realRecommendationsGeneratedAt ? formatDateTime(realRecommendationsGeneratedAt) : "-"}
                  </span>
                </p>
                <p className="mt-1 text-slate-400">
                  schedule=
                  {realScanOnlyScheduleActive ? "ON" : "OFF"} | worker=
                  {realScanOnlyWorkerRunning ? "RUNNING" : "STOPPED"} | on_grid=
                  {realScanOnlySchedulerStatus?.on_grid ? "YES" : "NO"} | next=
                  {realScanOnlySchedulerStatus?.next_grid_run_at
                    ? formatDateTime(realScanOnlySchedulerStatus.next_grid_run_at)
                    : "-"}
                </p>
                <p className="mt-1 text-slate-400">
                  last_scan_symbols={realRecommendationsScannedCount ?? "-"} | short_term_buy={visibleRealRecommendations.length} |
                  watch={visibleRealWatchCandidates.length} | mail_signal_buy={visibleRealMailSignalRecommendations.length}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Pool ma dat chuan liquidity (tham khao bang tren, khong phai so ma scan): {liquidityEligibleTotal}
                </p>
                {formatShortTermScanDiagnostics(realRecommendationsScanDiagnostics) ? (
                  <p className="mt-1 text-[10px] text-slate-400">
                    {formatShortTermScanDiagnostics(realRecommendationsScanDiagnostics)}
                  </p>
                ) : null}
                <div className="mt-2 rounded-md border border-white/10 bg-black/30 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Scan-only logs gan nhat (10)</p>
                  {realRecommendationsRecentLogs.length === 0 ? (
                    <p className="mt-1 text-[10px] text-slate-500">Chua co log scan-only.</p>
                  ) : (
                    <div className="mt-1 max-h-32 space-y-1 overflow-y-auto text-[10px] text-slate-300">
                      {realRecommendationsRecentLogs.slice(0, 10).map((row, idx) => (
                        <p key={`${row.redis_key}-${idx}`}>
                          <span
                            className={
                              isWithinFreshWindow(row.generated_at ?? null, realRecommendationsFreshMinutes)
                                ? "text-emerald-300"
                                : "text-rose-300"
                            }
                          >
                            {isWithinFreshWindow(row.generated_at ?? null, realRecommendationsFreshMinutes) ? "FRESH" : "STALE"}
                          </span>{" "}
                          |
                          <span className="text-cyan-200">{row.generated_at ? formatDateTime(row.generated_at) : "-"}</span> | scanned=
                          {Number(row.scanned || 0)} | short_term={Number(row.short_term_count ?? row.count ?? 0)} | mail=
                          {Number(row.mail_signal_count ?? 0)} | watch={Number(row.watch_count ?? 0)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-300">Short-term automation logs (REAL)</p>
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
                    <p className="mt-2 text-[11px] text-slate-500">Chua co log auto-trading REAL.</p>
                  ) : (
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto text-[11px] font-mono text-slate-300">
                      {realShortTermRuns.map((run) => (
                        <div key={run.id} className="border-b border-white/5 pb-2">
                          <p>
                            <span className="text-cyan-200">{formatDateTime(run.started_at)}</span> |{" "}
                            <span className={automationRunStatusClass(run.run_status)}>{run.run_status}</span>
                          </p>
                          <p className="text-slate-400">
                            scan={run.scanned} | candidate={run.buy_candidates} | risk_rej={run.risk_rejected} | exec=
                            {run.executed} | exec_rej={run.execution_rejected} | err={run.errors}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 p-3">
                  <p className="text-xs font-semibold text-slate-300">Mail entry logs (REAL)</p>
                  {realMailSignalRunLogs.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500">Chua co log mail entry REAL.</p>
                  ) : (
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto text-[11px] font-mono text-slate-300">
                      {realMailSignalRunLogs.map((run, idx) => (
                        <div key={`${run.redis_key}-${idx}`} className="border-b border-white/5 pb-2">
                          <p>
                            <span className="text-cyan-200">{formatDateTime(run.ran_at)}</span> |{" "}
                            <span className="text-violet-300">scanned={run.scanned}</span> |{" "}
                            <span className="text-emerald-300">executed={run.executed.length}</span> |{" "}
                            <span className="text-rose-300">skipped={run.skipped.length}</span>
                          </p>
                          <p className="text-slate-500">source={run.source_key || "-"}</p>
                          {run.skipped.length > 0 ? (
                            <p className="text-amber-300">
                              skipped:{" "}
                              {run.skipped
                                .slice(0, 4)
                                .map((row) => `${String(row.symbol || "-")}:${String(row.reason || "-")}`)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

        </div>
        )
      ) : (
        <div className="flex flex-col gap-8">
          <section className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">Tong tai san demo (VND)</h2>
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
              {formatVnd(demoOverviewTotalAssets)} VND
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Tong tai san = tien mat kha dung + gia tri co phieu. Moi phien moi khoi tao 100.000.000 VND.
            </p>
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleDepositDemoCash();
              }}
            >
              <label className="flex min-w-64 flex-col gap-1 text-xs text-slate-400">
                Nap them tien demo
                <input
                  type="number"
                  min={0}
                  step="1000000"
                  className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={demoDepositAmount}
                  onChange={(e) => setDemoDepositAmount(e.target.value)}
                  disabled={demoDepositBusy || demoSessionBusy || !demoSessionId.trim()}
                  placeholder="Vi du: 50000000"
                />
              </label>
              <button
                type="submit"
                disabled={demoDepositBusy || demoSessionBusy || !demoSessionId.trim()}
                className="rounded-md border border-emerald-300/40 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-50"
              >
                {demoDepositBusy ? "Dang nap..." : "Nap tien"}
              </button>
            </form>
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
                  setHistoryOffsetBySide(emptyDemoHistoryCounts());
                  setHistoryTotalBySide(emptyDemoHistoryCounts());
                  setDemoOrdersBySide(emptyDemoOrdersBySide());
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
              <p>Cash snapshot tu /demo/account: {formatVnd(demoCash)} VND</p>
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-200">Demo DB Overview</p>
              {demoOverviewError ? <p className="mt-2 text-rose-300">{demoOverviewError}</p> : null}
              {demoOverview ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-md border border-slate-300/20 bg-slate-300/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-200/80">Da nap</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {formatVnd(demoOverviewInitialBalance)} VND
                    </p>
                  </div>
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-cyan-100/80">Tong tai san</p>
                    <p className="mt-1 text-lg font-semibold text-cyan-100">
                      {formatVnd(demoOverviewTotalAssets)} VND
                    </p>
                  </div>
                  <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-100/80">Tien mat kha dung</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-50">
                      {formatVnd(demoOverviewCashAvailable)} VND
                    </p>
                  </div>
                  <div className="rounded-md border border-violet-300/25 bg-violet-300/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-violet-100/80">Gia tri co phieu</p>
                    <p className="mt-1 text-lg font-semibold text-violet-50">
                      {formatVnd(demoOverviewStockValue)} VND
                    </p>
                  </div>
                  <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-amber-100/80">Lai/lo tam tinh</p>
                    <p className={`mt-1 text-lg font-semibold ${demoOverviewPnl >= 0 ? "text-emerald-100" : "text-rose-100"}`}>
                      {demoOverviewPnl >= 0 ? "+" : ""}
                      {formatVnd(demoOverviewPnl)} VND
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200">Danh muc demo session hien tai</h3>
              <button
                type="button"
                onClick={() => void handleManualDemoPortfolioReview()}
                disabled={demoPortfolioReviewBusy || !demoSessionId.trim()}
                className="h-8 rounded-md border border-cyan-300/40 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"
              >
                {demoPortfolioReviewBusy ? "Dang overview..." : "Manual overview"}
              </button>
            </div>
            {demoPortfolioReviewMessage ? (
              <p className="mt-2 text-[11px] text-emerald-300">{demoPortfolioReviewMessage}</p>
            ) : null}
            {!demoOverview || demoOverview.holdings.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Khong co ma dang nam giu trong demo session nay.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs text-slate-200">
                  <thead className="border-b border-white/10 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Symbol</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">So luong</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Duoc ban (T+2)</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Cho T+2</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Ngay duoc ban gan nhat</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Gia mua</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">TP</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">SL</th>
                      <th className="py-2.5 pr-4 whitespace-nowrap">Gia hien tai</th>
                      <th className="py-2.5 whitespace-nowrap">% Lai/Lo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoOverview.holdings.map((holding) => {
                      const symbol = String(holding.symbol || "").toUpperCase();
                      const avg = normalizeVnStockPrice(Number(holding.average_buy_price || 0));
                      const tp = normalizeVnStockPrice(Number(holding.take_profit_price ?? 0));
                      const sl = normalizeVnStockPrice(Number(holding.stoploss_price ?? 0));
                      const last = normalizeVnStockPrice(Number(holdingLastPriceBySymbol[symbol] ?? 0));
                      const hasMark = Number.isFinite(last) && last > 0;
                      const pnlPct = hasMark && avg > 0 ? (last / avg - 1) * 100 : null;
                      const pnlClass =
                        pnlPct == null ? "text-slate-400" : pnlPct > 0 ? "text-emerald-300" : pnlPct < 0 ? "text-rose-300" : "text-slate-300";
                      return (
                        <tr key={`${holding.symbol}-${holding.opened_at}`} className="border-b border-white/5">
                          <td className="py-2 pr-3 font-mono text-cyan-200">{symbol}</td>
                          <td className="py-2 pr-3">{Number(holding.quantity || 0)}</td>
                          <td className="py-2 pr-3 text-emerald-300">{Number(holding.settled_quantity || 0)}</td>
                          <td className="py-2 pr-3 text-amber-300">{Number(holding.pending_settlement_quantity || 0)}</td>
                          <td className="py-2 pr-3">
                            {holding.next_settle_date ? formatDateTime(String(holding.next_settle_date)) : "-"}
                          </td>
                          <td className="py-2 pr-3">{formatPrice(avg)}</td>
                          <td className="py-2 pr-3">{tp > 0 ? formatPrice(tp) : "-"}</td>
                          <td className="py-2 pr-3">{sl > 0 ? formatPrice(sl) : "-"}</td>
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

          {schedulerError ? <p className="text-xs text-rose-300">{schedulerError}</p> : null}
          <div className="grid gap-5 xl:grid-cols-2">
            <LiquidityCachePanel
              rows={liquidityEligibleRows}
              total={liquidityEligibleTotal}
              error={liquidityEligibleError}
              busy={liquidityRefreshBusy}
              onRunNow={() => void handleRunPostCloseRefreshNow()}
              compact
            />
            <MailSignalsPanel
              mailSignals={mailSignals}
              pickCount={mailSignalPickCount}
              error={mailSignalsError}
              busy={mailSignalsRunOnceBusy}
              onRunNow={() => void handleRunMailSignalsNow()}
              compact
            />
          </div>

          <div>
            <section className="glass-panel rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-200">{UI_TEXT.autoTrading.demoOrdersTitle}</h3>
              <div className="mt-3 flex w-fit rounded-md border border-white/10 bg-black/20 p-1">
                {DEMO_ORDER_TABS.map((tab) => {
                  const active = demoOrdersTab === tab;
                  const label = tab === "buy" ? "Buy" : "Sell";
                  return (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDemoOrdersTab(tab)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-cyan-300/20 text-cyan-50"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}
                    >
                      {label}
                      <span className="ml-2 font-mono text-[10px] text-slate-400">{historyTotalBySide[tab] ?? 0}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Hien thi {activeDemoOrders.length} / {activeHistoryTotal} lenh {demoOrdersTab === "buy" ? "Buy" : "Sell"}
              </p>
              {activeDemoOrders.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">{UI_TEXT.autoTrading.demoOrdersEmpty}</p>
              ) : (
                <div className="mt-3 max-h-64 overflow-y-auto text-xs text-slate-400">
                  {activeDemoOrders.map((o) => (
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Demo Logs</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Session {demoSessionId || "-"} | auto {demoAutomationLogRows.length} | mail {mailSignalEntryRuns.length}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-400" htmlFor="at-log-scope-filter">
                Scope
                <select
                  id="at-log-scope-filter"
                  className="rounded-md border border-white/15 bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-100"
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
            </div>
            {automationRunsError ? <p className="mt-3 text-[11px] text-rose-300">{automationRunsError}</p> : null}
            {mailSignalEntryRunError ? <p className="mt-2 text-[11px] text-rose-300">{mailSignalEntryRunError}</p> : null}
            <div className="mt-3 overflow-hidden rounded-md border border-white/10">
              <div className="grid grid-cols-[6.5rem_5rem_1fr_6rem] border-b border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500 md:grid-cols-[8.5rem_5rem_1fr_6rem]">
                <span>Time</span>
                <span>Type</span>
                <span>Result</span>
                <span className="text-right">Status</span>
              </div>
              <div className="max-h-72 overflow-y-auto text-[11px] font-mono text-slate-300">
                {demoAutomationLogRows.length === 0 && mailSignalEntryRuns.length === 0 ? (
                  <p className="px-3 py-3 text-slate-500">Chua co log demo.</p>
                ) : null}
                {demoAutomationLogRows.map(({ run, scope }) => (
                  <div
                    key={`demo-auto-${run.id}`}
                    className="grid grid-cols-[6.5rem_5rem_1fr_6rem] items-center gap-2 border-b border-white/5 px-3 py-2 md:grid-cols-[8.5rem_5rem_1fr_6rem]"
                  >
                    <span className="truncate text-cyan-200">{formatDateTime(run.started_at)}</span>
                    <span className="text-slate-400">AUTO</span>
                    <span className="truncate">
                      {scope} | scan {run.scanned} | buy {run.buy_candidates} | risk {run.risk_rejected} | exec {run.executed}
                      {run.execution_rejected || run.errors ? ` | rej ${run.execution_rejected} | err ${run.errors}` : ""}
                    </span>
                    <span className={`text-right ${automationRunStatusClass(run.run_status)}`}>{run.run_status}</span>
                  </div>
                ))}
                {mailSignalEntryRuns.map((run, runIdx) => (
                  <div
                    key={`demo-mail-${run.redis_key}-${runIdx}`}
                    className="grid grid-cols-[6.5rem_5rem_1fr_6rem] items-center gap-2 border-b border-white/5 px-3 py-2 md:grid-cols-[8.5rem_5rem_1fr_6rem]"
                  >
                    <span className="truncate text-cyan-200">{formatDateTime(run.ran_at)}</span>
                    <span className="text-violet-300">MAIL</span>
                    <span className="truncate">
                      scan {run.scanned} | exec {run.executed.length} | skip {run.skipped.length}
                      {run.skipped.length > 0
                        ? ` | ${run.skipped
                            .slice(0, 3)
                            .map((row) => `${String(row.symbol || "-")}:${String(row.reason || "-")}`)
                            .join(", ")}`
                        : ""}
                    </span>
                    <span className={`text-right ${run.success ? "text-emerald-300" : "text-rose-300"}`}>
                      {run.success ? "OK" : "FAIL"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
