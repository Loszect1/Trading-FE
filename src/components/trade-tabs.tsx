"use client";

import { useMemo, useState } from "react";
import { UI_TEXT } from "@/constants/ui-text";
import { formatNumber } from "@/lib/format";
import type { TradeMetricRow, TradeStats } from "@/types/vnstock";

type TabValue = "overview" | "side-stats" | "foreign-trade" | "prop-trade";

interface TradeTabsProps {
  stats: TradeStats | null;
  sideStats: TradeMetricRow[];
  foreignTrade: TradeMetricRow[];
  propTrade: TradeMetricRow[];
}

export function TradeTabs({ stats, sideStats, foreignTrade, propTrade }: TradeTabsProps) {
  const [activeTab, setActiveTab] = useState<TabValue>("overview");

  const tabs: { key: TabValue; label: string }[] = [
    { key: "overview", label: UI_TEXT.trade.tabs.overview },
    { key: "side-stats", label: UI_TEXT.trade.tabs.sideStats },
    { key: "foreign-trade", label: UI_TEXT.trade.tabs.foreignTrade },
    { key: "prop-trade", label: UI_TEXT.trade.tabs.propTrade },
  ];

  const activeRows = useMemo(() => {
    if (activeTab === "side-stats") return sideStats;
    if (activeTab === "foreign-trade") return foreignTrade;
    if (activeTab === "prop-trade") return propTrade;
    return [];
  }, [activeTab, foreignTrade, propTrade, sideStats]);

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              activeTab === tab.key
                ? "bg-cyan-300/25 text-cyan-100"
                : "border border-white/20 bg-slate-950/35 text-slate-200 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-slate-400">{UI_TEXT.trade.tabs.totalVolume}</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{formatNumber(stats?.total_volume)}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-slate-400">{UI_TEXT.trade.tabs.totalValue}</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{formatNumber(stats?.total_value)}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-slate-400">{UI_TEXT.trade.tabs.buyVolume}</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{formatNumber(stats?.buy_volume)}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-slate-400">{UI_TEXT.trade.tabs.sellVolume}</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{formatNumber(stats?.sell_volume)}</p>
          </div>
        </section>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-xl">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">{UI_TEXT.trade.tabs.metric}</th>
                <th className="px-4 py-3 font-medium">{UI_TEXT.trade.tabs.value}</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-400" colSpan={2}>
                    {UI_TEXT.trade.tabs.noData}
                  </td>
                </tr>
              ) : (
                activeRows.map((row) => (
                  <tr key={row.label} className="border-t border-white/10">
                    <td className="px-4 py-3 text-slate-300">{row.label}</td>
                    <td className="px-4 py-3 font-medium text-slate-100">{formatNumber(row.value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
