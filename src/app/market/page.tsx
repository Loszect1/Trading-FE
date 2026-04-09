import { MarketClient } from "@/components/market-client";
import { SiteNav } from "@/components/site-nav";
import { UI_TEXT } from "@/constants/ui-text";
import { getAllSymbols } from "@/services/vnstock.api";
import type { AppError } from "@/types/api";
import type { SymbolItem } from "@/types/vnstock";

export const revalidate = 0;

async function loadMarketData(): Promise<{ symbols: SymbolItem[]; errorMessage: string }> {
  try {
    const symbols = await getAllSymbols();
    const dedupedSymbols = Array.from(
      new Map(
        symbols
          .filter((item) => item.symbol && item.symbol.trim().length > 0)
          .map((item) => [item.symbol.toUpperCase(), { ...item, symbol: item.symbol.toUpperCase() }]),
      ).values(),
    );

    return {
      symbols: dedupedSymbols,
      errorMessage: "",
    };
  } catch (error) {
    return {
      symbols: [],
      errorMessage: (error as AppError).message || UI_TEXT.market.loadFailed,
    };
  }
}

export default async function MarketPage() {
  const { symbols, errorMessage } = await loadMarketData();

  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-100">{UI_TEXT.market.title}</h1>
        <p className="mt-2 font-mono text-sm text-slate-400">{UI_TEXT.market.source}</p>
        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : (
          <div className="mt-6">
            <MarketClient initialSymbols={symbols} />
          </div>
        )}
      </main>
    </div>
  );
}
