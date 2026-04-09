"use client";

import { useEffect, useRef, useState } from "react";
import { PriceChart } from "@/components/price-chart";
import { FinancialRatioCharts } from "@/components/financial-ratio-charts";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import {
  getCompanyNews,
  getCompanyOverview,
  getFinancialRatioSummary,
  getPriceHistory,
} from "@/services/vnstock.api";
import type {
  CandlePoint,
  CompanyNewsItem,
  CompanyOverview,
  FinancialRatioPoint,
} from "@/types/vnstock";

type Interval = "1D" | "1W" | "1M" | "1Y";

const intervals: Interval[] = ["1D", "1W", "1M", "1Y"];

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
  const loadSourceRef = useRef<"init" | "user" | "auto">("init");
  const didSkipInitialFetchRef = useRef(false);

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div />
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
        <h2 className="text-lg font-semibold text-slate-100">Financial Ratio Summary</h2>
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
                      Read more
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
