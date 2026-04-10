"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TradeTabs } from "@/components/trade-tabs";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import { DnseTradePanel } from "@/components/dnse-trade-panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getForeignTrade,
  getPropTrade,
  getSideStats,
  getTradingStats,
} from "@/services/vnstock.api";
import type { SymbolItem, TradeMetricRow, TradeStats } from "@/types/vnstock";

interface TradeClientProps {
  symbols: SymbolItem[];
  initialSymbol: string;
  initialStats: TradeStats | null;
  initialSideStats: TradeMetricRow[];
  initialForeignTrade: TradeMetricRow[];
  initialPropTrade: TradeMetricRow[];
}

export function TradeClient({
  symbols,
  initialSymbol,
  initialStats,
  initialSideStats,
  initialForeignTrade,
  initialPropTrade,
}: TradeClientProps) {
  const { showToast } = useToast();
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
  const [stats, setStats] = useState(initialStats);
  const [sideStats, setSideStats] = useState(initialSideStats);
  const [foreignTrade, setForeignTrade] = useState(initialForeignTrade);
  const [propTrade, setPropTrade] = useState(initialPropTrade);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const loadSourceRef = useRef<"init" | "user" | "auto">("init");

  const symbolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          symbols
            .map((item) => item.symbol?.toUpperCase())
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    [symbols],
  );

  useEffect(() => {
    let isCancelled = false;

    async function loadTradeBySymbol(
      showLoading = true,
      source: "init" | "user" | "auto" = "init",
    ) {
      try {
        if (showLoading) {
          setLoading(true);
        }
        setErrorMessage("");
        const [nextStats, nextSide, nextForeign, nextProp] = await Promise.all([
          getTradingStats(selectedSymbol),
          getSideStats(selectedSymbol),
          getForeignTrade(selectedSymbol),
          getPropTrade(selectedSymbol),
        ]);

        if (!isCancelled) {
          setStats(nextStats);
          setSideStats(nextSide);
          setForeignTrade(nextForeign);
          setPropTrade(nextProp);
          if (source === "user") {
            showToast(TOAST_MESSAGES.tradeUpdated(selectedSymbol), "success");
          }
        }
      } catch (error) {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : UI_TEXT.trade.loadFailed;
          setErrorMessage(message);
          if (source !== "auto") {
            showToast(TOAST_MESSAGES.tradeLoadFailed(selectedSymbol), "error");
          }
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    void loadTradeBySymbol(true, loadSourceRef.current);
    loadSourceRef.current = "init";
    const timer = window.setInterval(() => {
      void loadTradeBySymbol(false, "auto");
    }, 30000);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSymbol, showToast]);

  return (
    <section className="mt-4 space-y-3">
      <div className="glass-panel rounded-xl p-4">
        <label htmlFor="trade-symbol" className="mb-2 block text-xs font-medium tracking-wide text-slate-300">
          {UI_TEXT.trade.symbol}
        </label>
        <select
          id="trade-symbol"
          value={selectedSymbol}
          onChange={(event) => {
            loadSourceRef.current = "user";
            setSelectedSymbol(event.target.value);
          }}
          className="h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50 sm:w-[280px]"
        >
          {symbolOptions.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </div>
      <DnseTradePanel symbol={selectedSymbol} />
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ) : null}
      {errorMessage ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : (
        <TradeTabs
          stats={stats}
          sideStats={sideStats}
          foreignTrade={foreignTrade}
          propTrade={propTrade}
        />
      )}
    </section>
  );
}
