"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PriceChart } from "@/components/price-chart";
import { FinancialRatioCharts } from "@/components/financial-ratio-charts";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import {
  analyzeSymbolWithAi,
  analyzeSymbolWithAiShortTechnical,
  getCompanyNews,
  getCompanyOverview,
  getFinancialRatioSummary,
  getPriceHistory,
} from "@/services/vnstock.api";
import type {
  AiDataCompleteness,
  AiStructuredAnalysis,
  CandlePoint,
  CompanyNewsItem,
  CompanyOverview,
  FinancialRatioPoint,
} from "@/types/vnstock";

type Interval = "1D" | "1W" | "1M" | "1Y";

const intervals: Interval[] = ["1D", "1W", "1M", "1Y"];

function normalizeHeading(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

function parseShortAnalysisSections(raw: string): {
  buyPoint: string;
  conditions: string;
  sellPoint: string;
  stopLoss: string;
} {
  const lines = raw.split("\n");
  const sections: Record<string, string[]> = {
    buy: [],
    conditions: [],
    sell: [],
    stop: [],
  };
  let current: "buy" | "conditions" | "sell" | "stop" | null = null;

  for (const line of lines) {
    const normalized = normalizeHeading(
      line
        .replace(/^#+\s*/, "")
        .replace(/^[0-9]+[\).\-\s]*/, "")
        .replace(/\*\*/g, "")
        .replace(/:/g, ""),
    );
    if (normalized.includes("diem mua")) {
      current = "buy";
      continue;
    }
    if (normalized.includes("dieu kien")) {
      current = "conditions";
      continue;
    }
    if (normalized.includes("diem ban")) {
      current = "sell";
      continue;
    }
    if (
      normalized.includes("stop loss") ||
      normalized.includes("stoploss") ||
      normalized.includes("cat lo") ||
      normalized.includes("diem cat lo")
    ) {
      current = "stop";
      continue;
    }
    if (current) {
      sections[current].push(line);
    }
  }

  const clean = (items: string[]) =>
    items
      .join("\n")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\n{3,}/g, "\n\n");

  return {
    buyPoint: clean(sections.buy),
    conditions: clean(sections.conditions),
    sellPoint: clean(sections.sell),
    stopLoss: clean(sections.stop),
  };
}

interface FullAiPanelProps {
  aiAnalysis: string;
  aiStructured: AiStructuredAnalysis | null;
  aiCompleteness: AiDataCompleteness | null;
  showRawAiAnalysis: boolean;
  onToggleRaw: () => void;
}

function FullAiPanel({
  aiAnalysis,
  aiStructured,
  aiCompleteness,
  showRawAiAnalysis,
  onToggleRaw,
}: FullAiPanelProps) {
  if (!aiAnalysis.trim()) {
    return <p className="text-sm text-slate-400">{UI_TEXT.symbol.aiEmpty}</p>;
  }
  return (
    <div className="space-y-4">
      {aiCompleteness ? (
        <div className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/45 p-3 text-xs text-slate-300 sm:grid-cols-5">
          <p>
            {UI_TEXT.symbol.completeness.overall}: {aiCompleteness.overall ?? "-"}
          </p>
          <p>
            {UI_TEXT.symbol.completeness.market}: {aiCompleteness.market ?? "-"}
          </p>
          <p>
            {UI_TEXT.symbol.completeness.fundamentals}: {aiCompleteness.fundamentals ?? "-"}
          </p>
          <p>
            {UI_TEXT.symbol.completeness.news}: {aiCompleteness.news ?? "-"}
          </p>
          <p>
            {UI_TEXT.symbol.completeness.social}: {aiCompleteness.social_sentiment ?? "-"}
          </p>
        </div>
      ) : null}

      {aiStructured ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-3">
              <p className="text-xs text-emerald-200">{UI_TEXT.symbol.bias}</p>
              <p className="text-sm font-semibold text-emerald-100">{aiStructured.bias ?? "-"}</p>
            </div>
            <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3">
              <p className="text-xs text-cyan-200">{UI_TEXT.symbol.confidence}</p>
              <p className="text-sm font-semibold text-cyan-100">
                {typeof aiStructured.confidence === "number" ? `${aiStructured.confidence}/10` : "-"}
              </p>
            </div>
          </div>

          {aiStructured.executive_summary ? (
            <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-200">
                {UI_TEXT.symbol.executiveSummary}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {aiStructured.executive_summary}
              </p>
            </article>
          ) : null}
          {aiStructured.market_analysis ? (
            <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-200">
                {UI_TEXT.symbol.marketAnalysis}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {aiStructured.market_analysis}
              </p>
            </article>
          ) : null}
          {aiStructured.fundamentals_analysis ? (
            <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-200">
                {UI_TEXT.symbol.fundamentalsAnalysis}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {aiStructured.fundamentals_analysis}
              </p>
            </article>
          ) : null}
          {aiStructured.news_analysis ? (
            <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-200">
                {UI_TEXT.symbol.newsAnalysis}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {aiStructured.news_analysis}
              </p>
            </article>
          ) : null}
          {aiStructured.social_sentiment_analysis ? (
            <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold tracking-wide text-cyan-200">
                {UI_TEXT.symbol.socialSentimentAnalysis}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {aiStructured.social_sentiment_analysis}
              </p>
            </article>
          ) : null}

          {aiStructured.risk_matrix && aiStructured.risk_matrix.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-white/[0.03] text-slate-300">
                  <tr>
                    <th className="px-3 py-2">{UI_TEXT.symbol.riskMatrix.risk}</th>
                    <th className="px-3 py-2">{UI_TEXT.symbol.riskMatrix.probability}</th>
                    <th className="px-3 py-2">{UI_TEXT.symbol.riskMatrix.impact}</th>
                    <th className="px-3 py-2">{UI_TEXT.symbol.riskMatrix.monitoring}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiStructured.risk_matrix.map((item, idx) => (
                    <tr key={`${item.risk}-${idx}`} className="border-t border-white/10 text-slate-200">
                      <td className="px-3 py-2">{item.risk}</td>
                      <td className="px-3 py-2">{item.probability}</td>
                      <td className="px-3 py-2">{item.impact}</td>
                      <td className="px-3 py-2">{item.monitoring}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {aiStructured.trading_watchlist_plan ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                <p className="text-xs font-semibold">{UI_TEXT.symbol.scenarioBull}</p>
                <p className="mt-1 whitespace-pre-wrap">{aiStructured.trading_watchlist_plan.bull ?? "-"}</p>
              </div>
              <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">
                <p className="text-xs font-semibold">{UI_TEXT.symbol.scenarioBase}</p>
                <p className="mt-1 whitespace-pre-wrap">{aiStructured.trading_watchlist_plan.base ?? "-"}</p>
              </div>
              <div className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
                <p className="text-xs font-semibold">{UI_TEXT.symbol.scenarioBear}</p>
                <p className="mt-1 whitespace-pre-wrap">{aiStructured.trading_watchlist_plan.bear ?? "-"}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onToggleRaw}
          className="rounded-md border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
        >
          {showRawAiAnalysis ? UI_TEXT.symbol.rawHide : UI_TEXT.symbol.rawShow}
        </button>
        {showRawAiAnalysis ? (
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
            {aiAnalysis}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function ShortAiPanel({ shortAiAnalysis }: { shortAiAnalysis: string }) {
  if (!shortAiAnalysis.trim()) {
    return <p className="text-sm text-slate-400">{UI_TEXT.symbol.shortEmpty}</p>;
  }
  const parsed = parseShortAnalysisSections(shortAiAnalysis);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <article className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-3">
        <p className="text-xs font-semibold tracking-wide text-emerald-200">{UI_TEXT.symbol.shortBuy}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-100">{parsed.buyPoint || "-"}</p>
      </article>
      <article className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3">
        <p className="text-xs font-semibold tracking-wide text-cyan-200">{UI_TEXT.symbol.shortCondition}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-100">{parsed.conditions || "-"}</p>
      </article>
      <article className="rounded-lg border border-purple-300/30 bg-purple-400/10 p-3">
        <p className="text-xs font-semibold tracking-wide text-purple-200">{UI_TEXT.symbol.shortSell}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-purple-100">{parsed.sellPoint || "-"}</p>
      </article>
      <article className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3">
        <p className="text-xs font-semibold tracking-wide text-rose-200">{UI_TEXT.symbol.shortStop}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-100">{parsed.stopLoss || "-"}</p>
      </article>
    </div>
  );
}

interface AiResultModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function AiResultModal({ open, title, onClose, children }: AiResultModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
        aria-label={UI_TEXT.symbol.modalClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-ai-modal-title"
        className="relative z-[101] flex max-h-[min(90vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#080c14] shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 id="symbol-ai-modal-title" className="text-lg font-semibold text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
          >
            {UI_TEXT.symbol.modalClose}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function isVietnamMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((item) => item.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((item) => item.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((item) => item.type === "minute")?.value ?? "0");

  const isWorkingDay = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  if (!isWorkingDay) {
    return false;
  }

  const currentMinutes = hour * 60 + minute;
  const morningStart = 9 * 60;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;

  const inMorningSession = currentMinutes >= morningStart && currentMinutes <= morningEnd;
  const inAfternoonSession = currentMinutes >= afternoonStart && currentMinutes <= afternoonEnd;

  return inMorningSession || inAfternoonSession;
}

interface SymbolDetailClientProps {
  symbol: string;
  initialOverview: CompanyOverview | null;
  initialChartData: CandlePoint[];
}

export function SymbolDetailClient({
  symbol,
  initialOverview,
  initialChartData,
}: SymbolDetailClientProps) {
  const { showToast } = useToast();
  const [overview, setOverview] = useState<CompanyOverview | null>(initialOverview);
  const [chartData, setChartData] = useState<CandlePoint[]>(initialChartData);
  const [news, setNews] = useState<CompanyNewsItem[]>([]);
  const [ratioSummary, setRatioSummary] = useState<FinancialRatioPoint[]>([]);
  const [interval, setInterval] = useState<Interval>("1D");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [shortAiLoading, setShortAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [shortAiAnalysis, setShortAiAnalysis] = useState("");
  const [aiStructured, setAiStructured] = useState<AiStructuredAnalysis | null>(null);
  const [aiCompleteness, setAiCompleteness] = useState<AiDataCompleteness | null>(null);
  const [showRawAiAnalysis, setShowRawAiAnalysis] = useState(false);
  const [aiInterval, setAiInterval] = useState<Interval>("1D");
  const [aiLookbackDays, setAiLookbackDays] = useState(90);
  const loadSourceRef = useRef<"init" | "user" | "auto">("init");
  const didSkipInitialFetchRef = useRef(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [shortModalOpen, setShortModalOpen] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    async function loadOverviewAndNews() {
      const [overviewResult, newsResult, ratioResult] = await Promise.allSettled([
        getCompanyOverview(symbol),
        getCompanyNews(symbol),
        getFinancialRatioSummary(symbol),
      ]);

      if (isCancelled) {
        return;
      }

      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      } else {
        setOverview(null);
      }

      if (newsResult.status === "fulfilled") {
        setNews(newsResult.value);
      } else {
        setNews([]);
      }

      if (ratioResult.status === "fulfilled") setRatioSummary(ratioResult.value);
      else setRatioSummary([]);
    }

    void loadOverviewAndNews();
    return () => {
      isCancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let isCancelled = false;
    async function loadChartByInterval(
      showLoading = true,
      source: "init" | "user" | "auto" = "init",
    ) {
      try {
        if (source === "auto" && !isVietnamMarketOpen(new Date())) {
          return;
        }

        if (showLoading) {
          setLoading(true);
        }
        setErrorMessage("");

        const chartResult = await Promise.allSettled([getPriceHistory(symbol, interval)]);

        if (!isCancelled) {
          const nextChartData =
            chartResult[0].status === "fulfilled" ? chartResult[0].value : [];
          setChartData(nextChartData);

          if (chartResult[0].status === "rejected") {
            throw new Error(UI_TEXT.symbol.loadFailed);
          }

          if (source === "user") {
            showToast(TOAST_MESSAGES.symbolChartUpdated(symbol, interval), "success");
          }
        }
      } catch (error) {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : UI_TEXT.symbol.loadFailed;
          setErrorMessage(message);
          if (source !== "auto") {
            showToast(TOAST_MESSAGES.symbolLoadFailed(symbol), "error");
          }
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    if (loadSourceRef.current === "init" && !didSkipInitialFetchRef.current) {
      didSkipInitialFetchRef.current = true;
      if (initialChartData.length === 0) {
        void loadChartByInterval(true, "init");
      }
    } else {
      void loadChartByInterval(true, loadSourceRef.current);
    }
    loadSourceRef.current = "init";
    const timer = window.setInterval(() => {
      if (!isVietnamMarketOpen(new Date())) {
        return;
      }
      void loadChartByInterval(false, "auto");
    }, 30000);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, [initialChartData.length, interval, showToast, symbol]);

  return (
    <>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">{UI_TEXT.symbol.priceChart}</h2>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={aiInterval}
              onChange={(event) => setAiInterval(event.target.value as Interval)}
              className="h-8 rounded-md border border-slate-500/40 bg-slate-950/75 px-2 text-xs text-slate-100 outline-none transition focus:border-purple-300/70 focus:ring-2 focus:ring-purple-400/25"
            >
              {intervals.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={aiLookbackDays}
              min={7}
              max={365}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isNaN(parsed)) {
                  setAiLookbackDays(90);
                  return;
                }
                setAiLookbackDays(Math.max(7, Math.min(365, parsed)));
              }}
              className="h-8 w-24 rounded-md border border-slate-500/40 bg-slate-950/75 px-2 text-xs text-slate-100 outline-none transition focus:border-purple-300/70 focus:ring-2 focus:ring-purple-400/25"
            />
            <button
              type="button"
              onClick={async () => {
                setAiLoading(true);
                try {
                  const result = await analyzeSymbolWithAi(symbol, aiInterval, aiLookbackDays);
                  setAiAnalysis(result.analysis);
                  setAiStructured(result.structured);
                  setAiCompleteness(result.dataCompleteness);
                  setShowRawAiAnalysis(false);
                  setAiModalOpen(true);
                } catch (error) {
                  const message = error instanceof Error ? error.message : UI_TEXT.symbol.loadFailed;
                  showToast(message, "error");
                } finally {
                  setAiLoading(false);
                }
              }}
              disabled={aiLoading}
              className="h-9 rounded-md border border-purple-200/60 bg-gradient-to-r from-purple-500/80 to-fuchsia-500/80 px-4 py-1.5 text-xs font-bold tracking-wide text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_25px_rgba(168,85,247,0.35)] ring-1 ring-purple-300/40 transition hover:-translate-y-0.5 hover:from-purple-400 hover:to-fuchsia-400 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_14px_30px_rgba(192,132,252,0.45)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {aiLoading ? UI_TEXT.symbol.aiLoading : UI_TEXT.symbol.aiAnalyze}
            </button>
            <button
              type="button"
              onClick={async () => {
                setShortAiLoading(true);
                try {
                  const result = await analyzeSymbolWithAiShortTechnical(symbol, aiInterval, aiLookbackDays);
                  setShortAiAnalysis(result);
                  setShortModalOpen(true);
                } catch (error) {
                  const message = error instanceof Error ? error.message : UI_TEXT.symbol.loadFailed;
                  showToast(message, "error");
                } finally {
                  setShortAiLoading(false);
                }
              }}
              disabled={shortAiLoading}
              className="h-9 rounded-md border border-cyan-300/50 bg-cyan-400/15 px-4 py-1.5 text-xs font-bold tracking-wide text-cyan-100 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {shortAiLoading ? UI_TEXT.symbol.shortAiLoading : UI_TEXT.symbol.shortAiAnalyze}
            </button>
          </div>
          <div className="flex gap-2">
            {intervals.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  loadSourceRef.current = "user";
                  setInterval(item);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  interval === item
                    ? "bg-cyan-300/25 text-cyan-100"
                    : "border border-white/20 bg-slate-950/35 text-slate-200 hover:bg-white/10"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mb-3 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : null}
        {errorMessage ? (
          <p className="mb-3 rounded-xl border border-red-300/35 bg-red-500/12 p-3 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}
        <PriceChart data={chartData} />
      </section>

      <AiResultModal
        open={aiModalOpen}
        title={`${symbol} · ${UI_TEXT.symbol.aiTitle}`}
        onClose={() => setAiModalOpen(false)}
      >
        <FullAiPanel
          aiAnalysis={aiAnalysis}
          aiStructured={aiStructured}
          aiCompleteness={aiCompleteness}
          showRawAiAnalysis={showRawAiAnalysis}
          onToggleRaw={() => setShowRawAiAnalysis((prev) => !prev)}
        />
      </AiResultModal>

      <AiResultModal
        open={shortModalOpen}
        title={`${symbol} · ${UI_TEXT.symbol.shortTitle}`}
        onClose={() => setShortModalOpen(false)}
      >
        <ShortAiPanel shortAiAnalysis={shortAiAnalysis} />
      </AiResultModal>

      <section className="glass-panel rounded-xl p-6">
        <p className="text-sm text-slate-300">{symbol}</p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.industry}: {overview?.industry ?? "-"}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.issueShare}: {formatNumber(overview?.issue_share)}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.financialIssueShare}: {formatNumber(overview?.financial_ratio_issue_share)}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.charterCapital}: {formatNumber(overview?.charter_capital)}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.icbLevel2}: {overview?.icb_name2 ?? "-"}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.icbLevel3}: {overview?.icb_name3 ?? "-"}</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-slate-200">{UI_TEXT.symbol.icbLevel4}: {overview?.icb_name4 ?? "-"}</div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
            <p className="text-xs font-semibold tracking-wide text-cyan-200">{UI_TEXT.symbol.companyProfile}</p>
            <p className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {overview?.company_profile ?? "-"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
            <p className="text-xs font-semibold tracking-wide text-cyan-200">{UI_TEXT.symbol.history}</p>
            <p className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {overview?.history ?? "-"}
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.symbol.financialRatioSummary}</h2>
        <FinancialRatioCharts points={ratioSummary} />
      </section>

      <section className="glass-panel rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-100">{UI_TEXT.symbol.news}</h2>
        {news.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">{UI_TEXT.symbol.noNews}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {news.map((item, index) => {
              const meta = [item.source, item.published_at].filter(Boolean).join(" - ");
              const key = `${item.title}-${index}`;
              const body = (
                <>
                  <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                  {meta ? (
                    <p className="mt-1 text-xs text-slate-400">{meta}</p>
                  ) : null}
                  {item.summary ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">{item.summary}</p>
                  ) : null}
                  {item.url ? (
                    <span className="mt-2 inline-block text-xs font-semibold text-cyan-200 group-hover:text-cyan-100">
                      {UI_TEXT.symbol.readMore}
                    </span>
                  ) : null}
                </>
              );
              if (item.url) {
                return (
                  <a
                    key={key}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block rounded-lg border border-white/10 bg-slate-950/45 p-3 outline-none transition hover:border-cyan-300/35 hover:bg-slate-900/50 focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                  >
                    {body}
                  </a>
                );
              }
              return (
                <article
                  key={key}
                  className="rounded-lg border border-white/10 bg-slate-950/45 p-3"
                >
                  {body}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
