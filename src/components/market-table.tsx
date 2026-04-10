"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import type { SymbolItem } from "@/types/vnstock";

interface MarketTableProps {
  symbols: SymbolItem[];
}

export function MarketTable({ symbols }: MarketTableProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const raw = window.localStorage.getItem("vnstock.watchlist");
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return [];
    }
    return [];
  });

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);

  function toggleWatchlist(symbol: string) {
    setWatchlist((prev) => {
      const exists = prev.includes(symbol);
      const next = exists ? prev.filter((item) => item !== symbol) : [...prev, symbol];
      window.localStorage.setItem("vnstock.watchlist", JSON.stringify(next));
      showToast(
        exists ? TOAST_MESSAGES.watchlistRemoved(symbol) : TOAST_MESSAGES.watchlistSaved(symbol),
        "success",
      );
      return next;
    });
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-xl">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-white/[0.03] text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">{UI_TEXT.market.table.watch}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.market.table.symbol}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.market.table.exchange}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.market.table.industry}</th>
            <th className="px-4 py-3 font-medium">{UI_TEXT.market.table.action}</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((item) => (
            <tr
              key={`${item.symbol}-${item.exchange}`}
              className="cursor-pointer border-t border-white/10 hover:bg-cyan-300/5"
              onClick={() => router.push(`/symbol/${encodeURIComponent(item.symbol)}`)}
            >
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleWatchlist(item.symbol);
                  }}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    watchlistSet.has(item.symbol)
                      ? "bg-cyan-300/25 text-cyan-100"
                      : "border border-white/20 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {watchlistSet.has(item.symbol) ? UI_TEXT.market.table.saved : UI_TEXT.market.table.save}
                </button>
              </td>
              <td className="px-4 py-3 font-semibold text-slate-100">{item.symbol}</td>
              <td className="px-4 py-3 text-slate-300">{item.exchange ?? "-"}</td>
              <td className="px-4 py-3 text-slate-300">{item.industry ?? "-"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/trade?symbol=${encodeURIComponent(item.symbol)}&dnse=1`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-md border border-emerald-300/45 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
                  >
                    {UI_TEXT.market.table.dnseTrade}
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
