"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import type { SymbolItem } from "@/types/vnstock";

interface WatchlistClientProps {
  symbols: SymbolItem[];
}

export function WatchlistClient({ symbols }: WatchlistClientProps) {
  const { showToast } = useToast();
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const raw = window.localStorage.getItem("vnstock.watchlist");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return [];
    }
    return [];
  });

  const rows = useMemo(() => {
    const set = new Set(watchlist);
    return symbols.filter((item) => set.has(item.symbol));
  }, [symbols, watchlist]);

  function removeSymbol(symbol: string) {
    setWatchlist((prev) => {
      const next = prev.filter((item) => item !== symbol);
      window.localStorage.setItem("vnstock.watchlist", JSON.stringify(next));
      showToast(TOAST_MESSAGES.watchlistRemoved(symbol), "success");
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <p className="glass-panel rounded-xl p-4 text-sm text-slate-300">
        {UI_TEXT.watchlist.empty}
      </p>
    );
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-xl">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="bg-white/[0.03] text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">{UI_TEXT.watchlist.table.symbol}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.watchlist.table.exchange}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.watchlist.table.industry}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.watchlist.table.action}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.symbol} className="border-t border-white/10">
              <td className="px-4 py-3 font-semibold text-slate-100">{item.symbol}</td>
              <td className="px-4 py-3 text-slate-300">{item.exchange ?? "-"}</td>
              <td className="px-4 py-3 text-slate-300">{item.industry ?? "-"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/symbol/${item.symbol}`}
                    className="rounded-md border border-white/20 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    {UI_TEXT.watchlist.table.view}
                  </Link>
                  <Link
                    href={`/trade?symbol=${encodeURIComponent(item.symbol)}&dnse=1`}
                    className="rounded-md border border-emerald-300/45 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                  >
                    {UI_TEXT.watchlist.table.dnseTrade}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeSymbol(item.symbol)}
                    className="rounded-md border border-red-300/35 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-400/10"
                  >
                    {UI_TEXT.watchlist.table.remove}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
