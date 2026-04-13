"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import { UI_TEXT } from "@/constants/ui-text";
import { candlePointsToLwRows } from "@/lib/chart-time";
import {
  bollingerBands,
  macd,
  rsi,
  sma,
} from "@/lib/technical-indicators";
import type { CandlePoint } from "@/types/vnstock";

interface PriceChartProps {
  data: CandlePoint[];
}

type IndicatorKey = "sma20" | "sma50" | "bollinger" | "rsi" | "macd";

function linePointsFromNullable(
  times: string[],
  values: (number | null)[],
): { time: string; value: number }[] {
  const out: { time: string; value: number }[] = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v !== null) {
      out.push({ time: times[i]!, value: v });
    }
  }
  return out;
}

export function PriceChart({ data }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>({
    sma20: true,
    sma50: true,
    bollinger: false,
    rsi: false,
    macd: false,
  });

  const rows = useMemo(() => candlePointsToLwRows(data), [data]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || rows.length === 0) {
      return;
    }

    const times = rows.map((r) => r.time);
    const closes = rows.map((r) => r.close);

    const candleData = rows.map((r) => ({
      time: r.time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));

    const volumeData = rows.map((r) => ({
      time: r.time,
      value: r.volume,
      color:
        r.close >= r.open ? "rgba(74,222,128,0.45)" : "rgba(251,113,133,0.45)",
    }));

    const sma20Full = sma(closes, 20);
    const sma50Full = sma(closes, 50);
    const bbFull = bollingerBands(closes, 20, 2);
    const rsiFull = rsi(closes, 14);
    const macdFull = macd(closes, 12, 26, 9);

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.1)" },
        horzLines: { color: "rgba(148,163,184,0.1)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(34,211,238,0.35)", labelBackgroundColor: "#0f172a" },
        horzLine: { color: "rgba(34,211,238,0.35)", labelBackgroundColor: "#0f172a" },
      },
      rightPriceScale: {
        borderVisible: true,
        borderColor: "rgba(148,163,184,0.25)",
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.25)",
        rightOffset: 6,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      localization: {
        locale: "vi-VN",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#4ade80",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#4ade80",
      wickDownColor: "#fb7185",
    });

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.06, bottom: 0.2 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    if (indicators.sma20) {
      const s = chart.addSeries(LineSeries, {
        color: "#fbbf24",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(linePointsFromNullable(times, sma20Full));
    }

    if (indicators.sma50) {
      const s = chart.addSeries(LineSeries, {
        color: "#a78bfa",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(linePointsFromNullable(times, sma50Full));
    }

    if (indicators.bollinger) {
      const upper = chart.addSeries(LineSeries, {
        color: "rgba(34,211,238,0.65)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const lower = chart.addSeries(LineSeries, {
        color: "rgba(34,211,238,0.65)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      upper.setData(linePointsFromNullable(times, bbFull.upper));
      lower.setData(linePointsFromNullable(times, bbFull.lower));
    }

    if (indicators.macd) {
      chart.addPane();
      const macdPane = chart.panes().length - 1;
      const histData = rows.map((r, i) => {
        const h = macdFull.histogram[i];
        if (h === null) {
          return null;
        }
        return {
          time: r.time,
          value: h,
          color: h >= 0 ? "rgba(74,222,128,0.65)" : "rgba(251,113,133,0.65)",
        };
      });
      const histClean = histData.filter((x): x is NonNullable<typeof x> => x !== null);
      const hist = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
          priceLineVisible: false,
          lastValueVisible: false,
        },
        macdPane,
      );
      hist.setData(histClean);

      const macdLine = chart.addSeries(
        LineSeries,
        {
          color: "#38bdf8",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        macdPane,
      );
      macdLine.setData(linePointsFromNullable(times, macdFull.line));

      const signalLine = chart.addSeries(
        LineSeries,
        {
          color: "#f472b6",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        macdPane,
      );
      signalLine.setData(linePointsFromNullable(times, macdFull.signal));
    }

    if (indicators.rsi) {
      chart.addPane();
      const rsiPane = chart.panes().length - 1;
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: "#e879f9",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
          }),
        },
        rsiPane,
      );
      rsiSeries.setData(linePointsFromNullable(times, rsiFull));
      rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(74,222,128,0.35)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "70",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(251,113,133,0.35)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "30",
      });
    }

    const panes = chart.panes();
    panes[0]?.setStretchFactor(5);
    let idx = 1;
    if (indicators.macd) {
      panes[idx]?.setStretchFactor(1.1);
      idx += 1;
    }
    if (indicators.rsi) {
      panes[idx]?.setStretchFactor(0.9);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [
    rows,
    indicators.sma20,
    indicators.sma50,
    indicators.bollinger,
    indicators.rsi,
    indicators.macd,
  ]);

  function toggleIndicator(key: IndicatorKey) {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (data.length === 0) {
    return (
      <div className="glass-panel rounded-xl border-dashed p-6 text-sm text-slate-400">
        {UI_TEXT.chart.noData}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass-panel rounded-xl border-dashed p-6 text-sm text-slate-400">
        {UI_TEXT.chart.noData}
      </div>
    );
  }

  const first = rows[0]!;
  const latest = rows[rows.length - 1]!;
  const trendUp = latest.close >= first.close;

  const indicatorBtn = (key: IndicatorKey, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => toggleIndicator(key)}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
        indicators[key]
          ? "bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/40"
          : "border border-white/15 bg-slate-950/50 text-slate-400 hover:border-white/25 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-slate-950/80 via-slate-950/60 to-slate-950/90 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)] sm:p-5">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {UI_TEXT.symbol.chartIndicators}
          </span>
          {indicatorBtn("sma20", UI_TEXT.symbol.indicatorSma20)}
          {indicatorBtn("sma50", UI_TEXT.symbol.indicatorSma50)}
          {indicatorBtn("bollinger", UI_TEXT.symbol.indicatorBollinger)}
          {indicatorBtn("rsi", UI_TEXT.symbol.indicatorRsi)}
          {indicatorBtn("macd", UI_TEXT.symbol.indicatorMacd)}
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <p className="text-[10px] text-slate-500">{UI_TEXT.chart.tradingViewHint}</p>
          <p
            className={`text-xs font-semibold tabular-nums ${trendUp ? "text-emerald-300" : "text-rose-300"}`}
          >
            {trendUp ? UI_TEXT.chart.uptrend : UI_TEXT.chart.downtrend}
            <span className="ml-2 font-normal text-slate-500">
              {first.close.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} →{" "}
              {latest.close.toLocaleString("vi-VN", { maximumFractionDigits: 0 })}
            </span>
          </p>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        {indicators.sma20 ? (
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded-full bg-amber-400" />
            {UI_TEXT.chart.legendSma20}
          </span>
        ) : null}
        {indicators.sma50 ? (
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded-full bg-violet-400" />
            {UI_TEXT.chart.legendSma50}
          </span>
        ) : null}
        {indicators.bollinger ? (
          <span>
            {UI_TEXT.chart.legendBbUpper} / {UI_TEXT.chart.legendBbLower}
          </span>
        ) : null}
      </div>

      <div
        ref={containerRef}
        className="relative w-full min-h-[440px] h-[min(72vh,620px)] rounded-xl border border-white/10 bg-slate-950/40"
        role="presentation"
      />

      <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-500">
        {UI_TEXT.chart.tradingViewControls}
      </p>
    </div>
  );
}
