"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketTable } from "@/components/market-table";
import { useToast } from "@/components/toast-provider";
import { UI_TEXT } from "@/constants/ui-text";
import { getAllSymbols, getMarketScannerTop, getSymbolsByGroup } from "@/services/vnstock.api";
import { isAppError } from "@/services/dnse.api";
import type { MarketScannerResult, SymbolItem } from "@/types/vnstock";

interface MarketClientProps {
  initialSymbols: SymbolItem[];
}

type SortBy = "symbol-asc" | "symbol-desc";

const BOARD_FILTERS = ["ALL", "VN30", "HOSE", "HNX", "UPCOM"] as const;
type BoardFilter = (typeof BOARD_FILTERS)[number];

function dedupeSymbolItems(items: SymbolItem[]): SymbolItem[] {
  return Array.from(
    new Map(
      items
        .filter((item) => item.symbol && item.symbol.trim().length > 0)
        .map((item) => [item.symbol.toUpperCase(), { ...item, symbol: item.symbol.toUpperCase() }]),
    ).values(),
  );
}

export function MarketClient({ initialSymbols }: MarketClientProps) {
  const { showToast } = useToast();
  const [symbols, setSymbols] = useState<SymbolItem[]>(() => dedupeSymbolItems(initialSymbols));
  const [listRefreshing, setListRefreshing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [keyword, setKeyword] = useState("");
  const [exchange, setExchange] = useState<BoardFilter>("VN30");
  const [vn30SymbolSet, setVn30SymbolSet] = useState<Set<string>>(() => new Set());
  const [vn30LoadState, setVn30LoadState] = useState<"loading" | "ready" | "error">("loading");
  const [sortBy, setSortBy] = useState<SortBy>("symbol-asc");
  const [page, setPage] = useState(1);
  const [scanner, setScanner] = useState<MarketScannerResult | null>(null);
  const [scannerLoading, setScannerLoading] = useState(true);
  const [scannerDays, setScannerDays] = useState(90);
  const [scannerMode, setScannerMode] = useState<"normal" | "ai">("normal");
  const pageSize = 50;

  function getRiskClassName(riskLevel: string): string {
    const normalized = riskLevel.trim().toLowerCase();
    if (normalized === "low") {
      return "text-emerald-200";
    }
    if (normalized === "high") {
      return "text-rose-300";
    }
    if (normalized === "medium") {
      return "text-amber-200";
    }
    return "text-slate-300";
  }

  async function loadScanner(forceRefresh = false, useAi = false) {
    setScannerLoading(true);
    setScannerMode(useAi ? "ai" : "normal");
    try {
      const result = await getMarketScannerTop(scannerDays, 5, forceRefresh, useAi);
      setScanner(result);
    } catch {
      setScanner(null);
    } finally {
      setScannerLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadInitialScanner() {
      setScannerLoading(true);
      try {
        const result = await getMarketScannerTop(scannerDays, 5, false, false);
        if (!cancelled) setScanner(result);
      } catch {
        if (!cancelled) setScanner(null);
      } finally {
        if (!cancelled) setScannerLoading(false);
      }
    }
    void loadInitialScanner();
    return () => {
      cancelled = true;
    };
  }, [scannerDays]);

  useEffect(() => {
    setSymbols(dedupeSymbolItems(initialSymbols));
  }, [initialSymbols]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(inputValue);
      setPage(1);
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  useEffect(() => {
    let cancelled = false;
    async function loadVn30Symbols() {
      setVn30LoadState("loading");
      try {
        const symbols = await getSymbolsByGroup("VN30");
        if (!cancelled) {
          setVn30SymbolSet(new Set(symbols));
          setVn30LoadState("ready");
        }
      } catch {
        if (!cancelled) {
          setVn30SymbolSet(new Set());
          setVn30LoadState("error");
        }
      }
    }
    void loadVn30Symbols();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSymbols = useMemo(() => {
    const normalizedKeyword = keyword.trim().toUpperCase();

    const filtered = symbols.filter((item) => {
      const matchKeyword =
        normalizedKeyword.length === 0 ||
        item.symbol.toUpperCase().includes(normalizedKeyword) ||
        item.industry?.toUpperCase().includes(normalizedKeyword);

      let matchBoard = true;
      if (exchange === "ALL") {
        matchBoard = true;
      } else if (exchange === "VN30") {
        matchBoard = vn30SymbolSet.has(item.symbol.toUpperCase());
      } else {
        const itemExchange = item.exchange?.toUpperCase() ?? "";
        matchBoard = itemExchange === exchange;
      }
      return matchKeyword && matchBoard;
    });

    filtered.sort((a, b) => {
      if (sortBy === "symbol-desc") {
        return b.symbol.localeCompare(a.symbol);
      }
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [exchange, symbols, keyword, sortBy, vn30SymbolSet]);

  async function refreshSymbolListFromServer() {
    setListRefreshing(true);
    try {
      const next = await getAllSymbols({ forceRefresh: true });
      setSymbols(dedupeSymbolItems(next));
      setPage(1);
    } catch (error) {
      const message = isAppError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : UI_TEXT.market.refreshFromServerFailed;
      showToast(message, "error");
    } finally {
      setListRefreshing(false);
    }
  }

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
      <div className="glass-panel rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">{UI_TEXT.market.scanner.title}</h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="scanner-days" className="text-xs text-slate-300">
                {UI_TEXT.market.scanner.daysLabel}
              </label>
              <input
                id="scanner-days"
                type="number"
                min={2}
                max={365}
                value={scannerDays}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  if (rawValue.trim().length === 0) {
                    return;
                  }
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (Number.isNaN(parsed)) {
                    return;
                  }
                  setScannerDays(Math.max(2, Math.min(365, parsed)));
                }}
                className="h-7 w-16 rounded-md border border-slate-500/40 bg-slate-950/75 px-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
              />
            </div>
            {scanner?.as_of ? (
              <p className="text-xs text-slate-400">
                {UI_TEXT.market.scanner.asOfPrefix} {scanner.as_of}
              </p>
            ) : null}
            <p className="text-xs text-slate-400">
              {UI_TEXT.market.scanner.modeLabel}{" "}
              {scannerMode === "ai" ? UI_TEXT.market.scanner.modeAi : UI_TEXT.market.scanner.modeNormal}
            </p>
            <button
              type="button"
              onClick={() => void loadScanner(true, false)}
              disabled={scannerLoading}
              className="rounded-md border border-cyan-300/45 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scannerLoading ? UI_TEXT.market.scanner.scanning : UI_TEXT.market.scanner.scanNow}
            </button>
            <button
              type="button"
              onClick={() => void loadScanner(true, true)}
              disabled={scannerLoading}
              className="rounded-md border border-purple-300/45 bg-purple-300/10 px-3 py-1 text-xs font-semibold text-purple-100 transition hover:bg-purple-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scannerLoading ? UI_TEXT.market.scanner.scanning : UI_TEXT.market.scanner.scanWithAi}
            </button>
          </div>
        </div>
        {scannerLoading ? (
          <p className="text-xs text-slate-400">{UI_TEXT.market.scanner.scanningMarket}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {(["HOSE", "HNX", "UPCOM"] as const).map((exchange) => (
              <div key={exchange} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold tracking-wide text-cyan-200">{exchange}</p>
                {scanner?.by_exchange?.[exchange]?.length ? (
                  <div className="mt-2 space-y-2">
                    {scanner.by_exchange[exchange].map((item, index) => (
                      <div key={`${exchange}-${item.symbol}`} className="text-xs text-slate-200">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{index + 1}.</p>
                          <Link
                            href={`/symbol/${encodeURIComponent(item.symbol)}`}
                            className="rounded-md border border-cyan-300/35 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
                          >
                            {item.symbol}
                          </Link>
                        </div>
                        {scanner?.ai_risk_by_exchange?.[exchange]?.[item.symbol] ? (
                          <p
                            className={`text-[11px] ${getRiskClassName(
                              scanner.ai_risk_by_exchange[exchange][item.symbol],
                            )}`}
                          >
                            {UI_TEXT.market.scanner.riskPrefix} {scanner.ai_risk_by_exchange[exchange][item.symbol]}
                          </p>
                        ) : null}
                        <p className="text-slate-400">
                          {UI_TEXT.market.scanner.spikeLine(
                            (item.volume_spike_ratio ?? 0).toFixed(2),
                            (item.latest_volume ?? 0).toLocaleString("vi-VN"),
                            (item.baseline_avg_volume ?? 0).toLocaleString("vi-VN"),
                          )}
                        </p>
                      </div>
                    ))}
                    {scanner?.ai_reasoning_by_exchange?.[exchange] ? (
                      <p className="pt-1 text-[11px] text-slate-400">
                        {UI_TEXT.market.scanner.aiNotePrefix} {scanner.ai_reasoning_by_exchange[exchange]}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">{UI_TEXT.market.scanner.noData}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end">
        <button
          type="button"
          onClick={() => void refreshSymbolListFromServer()}
          disabled={listRefreshing}
          className="rounded-md border border-cyan-300/45 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {listRefreshing ? UI_TEXT.market.refreshFromServerLoading : UI_TEXT.market.refreshFromServer}
        </button>
      </div>
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
            setExchange(event.target.value as BoardFilter);
            setPage(1);
          }}
          className="h-10 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
        >
          {BOARD_FILTERS.map((item) => (
            <option key={item} value={item}>
              {item === "ALL" ? UI_TEXT.market.exchangeAll : item}
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
      {exchange === "VN30" && vn30LoadState === "loading" ? (
        <p className="text-xs text-slate-400">{UI_TEXT.market.vn30ListLoading}</p>
      ) : null}
      {exchange === "VN30" && vn30LoadState === "error" ? (
        <p className="text-xs text-amber-200/90">{UI_TEXT.market.vn30ListError}</p>
      ) : null}
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
