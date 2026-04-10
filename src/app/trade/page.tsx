import { TradeClient } from "@/components/trade-client";
import { SiteNav } from "@/components/site-nav";
import { UI_TEXT } from "@/constants/ui-text";
import {
  getAllSymbols,
  getForeignTrade,
  getPropTrade,
  getSideStats,
  getTradingStats,
} from "@/services/vnstock.api";
import type { AppError } from "@/types/api";
import type { SymbolItem, TradeMetricRow, TradeStats } from "@/types/vnstock";

export const revalidate = 0;

const defaultSymbol = "VNINDEX";

interface TradePageData {
  stats: TradeStats | null;
  sideStats: TradeMetricRow[];
  foreignTrade: TradeMetricRow[];
  propTrade: TradeMetricRow[];
  errorMessage: string;
}

async function loadTradingData(symbol: string): Promise<TradePageData> {
  try {
    const [stats, sideStats, foreignTrade, propTrade] = await Promise.all([
      getTradingStats(symbol),
      getSideStats(symbol),
      getForeignTrade(symbol),
      getPropTrade(symbol),
    ]);
    return { stats, sideStats, foreignTrade, propTrade, errorMessage: "" };
  } catch (error) {
    return {
      stats: null,
      sideStats: [],
      foreignTrade: [],
      propTrade: [],
      errorMessage: (error as AppError).message || UI_TEXT.trade.loadFailed,
    };
  }
}

interface TradePageProps {
  searchParams?: Promise<{ symbol?: string }>;
}

export default async function TradePage({ searchParams }: TradePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedSymbol = resolvedSearchParams?.symbol?.toUpperCase().trim();

  let symbols: SymbolItem[] = [];
  try {
    symbols = await getAllSymbols();
  } catch {
    symbols = [{ symbol: defaultSymbol }];
  }

  const normalizedSymbols = symbols.map((item) => item.symbol?.toUpperCase()).filter(Boolean);
  const initialSymbol =
    requestedSymbol && normalizedSymbols.includes(requestedSymbol)
      ? requestedSymbol
      : defaultSymbol;

  const { stats, sideStats, foreignTrade, propTrade, errorMessage } =
    await loadTradingData(initialSymbol);

  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-100">{UI_TEXT.trade.title}</h1>
        <p className="mt-2 font-mono text-sm text-slate-400">
          {UI_TEXT.trade.sourcePrefix} (symbol: {initialSymbol})
        </p>
        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : (
          <TradeClient
            symbols={symbols}
            initialSymbol={initialSymbol}
            initialStats={stats}
            initialSideStats={sideStats}
            initialForeignTrade={foreignTrade}
            initialPropTrade={propTrade}
          />
        )}
      </main>
    </div>
  );
}
