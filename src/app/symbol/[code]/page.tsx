import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SymbolDetailClient } from "@/components/symbol-detail-client";
import { UI_TEXT } from "@/constants/ui-text";
import { getCompanyOverview, getPriceHistory } from "@/services/vnstock.api";
import type { AppError } from "@/types/api";

interface SymbolDetailPageProps {
  params: Promise<{ code: string }>;
}

export const revalidate = 0;

async function loadSymbolData(symbol: string) {
  const [overviewResult, chartResult] = await Promise.allSettled([
    getCompanyOverview(symbol),
    getPriceHistory(symbol, "1D"),
  ]);

  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const chartData = chartResult.status === "fulfilled" ? chartResult.value : [];

  let errorMessage = "";
  if (overviewResult.status === "rejected" && chartResult.status === "rejected") {
    const overviewError = overviewResult.reason as AppError;
    errorMessage = overviewError?.message || UI_TEXT.symbol.loadFailed;
  }

  return { overview, chartData, errorMessage };
}

export default async function SymbolDetailPage({ params }: SymbolDetailPageProps) {
  const resolvedParams = await params;
  const symbol = resolvedParams.code.toUpperCase();
  const { overview, chartData, errorMessage } = await loadSymbolData(symbol);

  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <section className="glass-panel rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs tracking-[0.14em] text-cyan-200/80">{UI_TEXT.symbol.overviewBadge}</p>
              <h1 className="mt-2 font-mono text-3xl font-semibold text-slate-100">{symbol}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/trade?symbol=${encodeURIComponent(symbol)}&dnse=1`}
                className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/25"
              >
                {UI_TEXT.symbol.dnseTrade}
              </Link>
            </div>
          </div>
        </section>
        {errorMessage ? (
          <p className="rounded-xl border border-red-300/35 bg-red-500/12 p-4 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : (
          <SymbolDetailClient
            symbol={symbol}
            initialOverview={overview}
            initialChartData={chartData}
          />
        )}
      </main>
    </div>
  );
}
