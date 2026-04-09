import { SiteNav } from "@/components/site-nav";
import { WatchlistClient } from "@/components/watchlist-client";
import { UI_TEXT } from "@/constants/ui-text";
import { getAllSymbols } from "@/services/vnstock.api";
import type { SymbolItem } from "@/types/vnstock";

export const revalidate = 0;

export default async function WatchlistPage() {
  let symbols: SymbolItem[] = [];
  try {
    symbols = await getAllSymbols();
  } catch {
    symbols = [];
  }

  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-100">{UI_TEXT.watchlist.title}</h1>
        <p className="mt-2 text-sm text-slate-400">{UI_TEXT.watchlist.description}</p>
        <div className="mt-6">
          <WatchlistClient symbols={symbols} />
        </div>
      </main>
    </div>
  );
}
