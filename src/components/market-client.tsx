"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketTable } from "@/components/market-table";
import { UI_TEXT } from "@/constants/ui-text";
import type { SymbolItem } from "@/types/vnstock";

interface MarketClientProps {
  initialSymbols: SymbolItem[];
}

type SortBy = "symbol-asc" | "symbol-desc";

export function MarketClient({ initialSymbols }: MarketClientProps) {
  const [inputValue, setInputValue] = useState("");
  const [keyword, setKeyword] = useState("");
  const [exchange, setExchange] = useState("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("symbol-asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(inputValue);
      setPage(1);
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  const exchanges = useMemo(() => {
    const values = new Set(
      initialSymbols.map((item) => item.exchange).filter((value): value is string => Boolean(value)),
    );
    return ["ALL", ...Array.from(values).sort()];
  }, [initialSymbols]);

  const filteredSymbols = useMemo(() => {
    const normalizedKeyword = keyword.trim().toUpperCase();

    const filtered = initialSymbols.filter((item) => {
      const matchKeyword =
        normalizedKeyword.length === 0 ||
        item.symbol.toUpperCase().includes(normalizedKeyword) ||
        item.industry?.toUpperCase().includes(normalizedKeyword);

      const matchExchange = exchange === "ALL" || item.exchange === exchange;
      return matchKeyword && matchExchange;
    });

    filtered.sort((a, b) => {
      if (sortBy === "symbol-desc") {
        return b.symbol.localeCompare(a.symbol);
      }
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [exchange, initialSymbols, keyword, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredSymbols.length / pageSize));
  const pagedSymbols = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredSymbols.slice(start, start + pageSize);
  }, [filteredSymbols, page, totalPages]);

  const from = filteredSymbols.length === 0 ? 0 : (Math.min(page, totalPages) - 1) * pageSize + 1;
  const to = Math.min(Math.min(page, totalPages) * pageSize, filteredSymbols.length);

  return (
    <section className="space-y-4">
      <div className="glass-panel grid gap-3 rounded-xl p-4 sm:grid-cols-3">
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={UI_TEXT.market.searchPlaceholder}
          className="h-10 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 placeholder:text-slate-400 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
        />
        <select
          value={exchange}
          onChange={(event) => {
            setExchange(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
        >
          {exchanges.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(event) => {
            setSortBy(event.target.value as SortBy);
            setPage(1);
          }}
          className="h-10 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
        >
          <option value="symbol-asc">{UI_TEXT.market.sortAz}</option>
          <option value="symbol-desc">{UI_TEXT.market.sortZa}</option>
        </select>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-300">
        <p>{UI_TEXT.market.result(filteredSymbols.length)}</p>
        <p>{UI_TEXT.market.showing(from, to)}</p>
      </div>
      {inputValue !== keyword ? <p className="text-xs text-cyan-200">{UI_TEXT.market.searching}</p> : null}
      <MarketTable symbols={pagedSymbols} />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          disabled={page <= 1}
          className="rounded-md border border-slate-500/45 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {UI_TEXT.market.prev}
        </button>
        <span className="text-xs text-slate-200">{UI_TEXT.market.page(Math.min(page, totalPages), totalPages)}</span>
        <button
          type="button"
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={page >= totalPages}
          className="rounded-md border border-slate-500/45 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {UI_TEXT.market.next}
        </button>
      </div>
    </section>
  );
}
