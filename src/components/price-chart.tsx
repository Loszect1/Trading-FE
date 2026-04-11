"use client";

import { useMemo, useState } from "react";
import { UI_TEXT } from "@/constants/ui-text";
import type { CandlePoint } from "@/types/vnstock";

interface PriceChartProps {
  data: CandlePoint[];
}

export function PriceChart({ data }: PriceChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (data.length === 0) {
      return null;
    }

    const width = 980;
    const height = 360;
    const margin = { top: 18, right: 18, bottom: 28, left: 56 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const volumePanelHeight = Math.max(64, Math.round(plotHeight * 0.22));
    const pricePanelHeight = plotHeight - volumePanelHeight - 10;
    const volumeTop = margin.top + pricePanelHeight + 10;

    const minLow = Math.min(...data.map((d) => d.low ?? d.close));
    const maxHigh = Math.max(...data.map((d) => d.high ?? d.close));
    const pricePadding = (maxHigh - minLow) * 0.08 || 1;
    const minPrice = minLow - pricePadding;
    const maxPrice = maxHigh + pricePadding;
    const priceRange = maxPrice - minPrice || 1;

    const xStep = plotWidth / data.length;
    const candleWidth = Math.max(4, Math.min(11, xStep * 0.56));

    const yScale = (value: number) =>
      margin.top + ((maxPrice - value) / priceRange) * pricePanelHeight;

    const maxVolume = Math.max(...data.map((d) => d.volume ?? 0), 1);
    const volumeScale = (value: number) =>
      volumeTop + (1 - value / maxVolume) * volumePanelHeight;

    const candles = data.map((item, index) => {
      const centerX = margin.left + xStep * index + xStep / 2;
      const openPrice = item.open ?? item.close;
      const closePrice = item.close;
      const highPrice = item.high ?? Math.max(openPrice, closePrice);
      const lowPrice = item.low ?? Math.min(openPrice, closePrice);
      const volume = item.volume ?? 0;

      const openY = yScale(openPrice);
      const closeY = yScale(item.close);
      const highY = yScale(highPrice);
      const lowY = yScale(lowPrice);
      const isUp = closePrice >= openPrice;
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

      return {
        index,
        item: {
          ...item,
          open: openPrice,
          high: highPrice,
          low: lowPrice,
          close: closePrice,
          volume,
        },
        centerX,
        openY,
        closeY,
        highY,
        lowY,
        isUp,
        bodyTop,
        bodyHeight,
        volumeY: volumeScale(volume),
      };
    });

    const yTicks = 5;
    const tickValues = Array.from({ length: yTicks + 1 }).map((_, i) => {
      const ratio = i / yTicks;
      const value = maxPrice - ratio * (maxPrice - minPrice);
      return { value, y: yScale(value) };
    });

    return {
      width,
      height,
      margin,
      candleWidth,
      candles,
      tickValues,
      volumeTop,
      volumePanelHeight,
      maxVolume,
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="glass-panel rounded-xl border-dashed p-6 text-sm text-slate-400">
        {UI_TEXT.chart.noData}
      </div>
    );
  }

  const latest = data[data.length - 1]!;
  const first = data[0]!;
  const trendUp = latest.close >= first.close;
  const activeCandle = chart && activeIndex !== null ? chart.candles[activeIndex] : null;

  return (
    <div className="glass-panel h-[340px] rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-end">
        <p className={`text-xs font-semibold ${trendUp ? "text-emerald-300" : "text-rose-300"}`}>
          {trendUp ? UI_TEXT.chart.uptrend : UI_TEXT.chart.downtrend}
        </p>
      </div>
      <div className="relative h-[280px] w-full">
        <svg viewBox={`0 0 ${chart!.width} ${chart!.height}`} className="h-full w-full">
          {chart!.tickValues.map((tick) => (
            <g key={tick.value}>
              <line
                x1={chart!.margin.left}
                x2={chart!.width - chart!.margin.right}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(148,163,184,0.16)"
                strokeDasharray="3 4"
              />
              <text
                x={chart!.margin.left - 10}
                y={tick.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#a8b3c5"
              >
                {tick.value.toFixed(2)}
              </text>
            </g>
          ))}

          {chart!.candles.map((candle) => (
            <g
              key={`${candle.item.time}-${candle.index}`}
              onMouseEnter={() => setActiveIndex(candle.index)}
              onMouseLeave={() => setActiveIndex(null)}
              className="cursor-crosshair"
            >
              <line
                x1={candle.centerX}
                x2={candle.centerX}
                y1={candle.highY}
                y2={candle.lowY}
                stroke={candle.isUp ? "#34d399" : "#fb7185"}
                strokeWidth="1.4"
              />
              <rect
                x={candle.centerX - chart!.candleWidth / 2}
                y={candle.bodyTop}
                width={chart!.candleWidth}
                height={candle.bodyHeight}
                fill={candle.isUp ? "rgba(16,185,129,0.85)" : "rgba(244,63,94,0.85)"}
                stroke={candle.isUp ? "#34d399" : "#fb7185"}
                strokeWidth="1"
                rx="1"
              />
            </g>
          ))}

          <line
            x1={chart!.margin.left}
            x2={chart!.width - chart!.margin.right}
            y1={chart!.volumeTop}
            y2={chart!.volumeTop}
            stroke="rgba(148,163,184,0.2)"
          />

          {chart!.candles.map((candle) => (
            <rect
              key={`vol-${candle.item.time}-${candle.index}`}
              x={candle.centerX - chart!.candleWidth / 2}
              y={candle.volumeY}
              width={chart!.candleWidth}
              height={Math.max(1, chart!.volumeTop + chart!.volumePanelHeight - candle.volumeY)}
              fill={candle.isUp ? "rgba(16,185,129,0.6)" : "rgba(244,63,94,0.6)"}
              rx="1"
            />
          ))}

          <text
            x={chart!.margin.left - 10}
            y={chart!.volumeTop + 12}
            textAnchor="end"
            fontSize="10"
            fill="#94a3b8"
          >
            {UI_TEXT.chart.volumeAxis}
          </text>
          <text
            x={chart!.margin.left - 10}
            y={chart!.volumeTop + chart!.volumePanelHeight}
            textAnchor="end"
            fontSize="10"
            fill="#94a3b8"
          >
            0
          </text>
        </svg>

        {activeCandle ? (
          <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-slate-400/35 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-xl">
            <p className="mb-1 font-semibold text-slate-200">{String(activeCandle.item.time).slice(0, 10)}</p>
            <p>
              {UI_TEXT.chart.open}: {activeCandle.item.open}
            </p>
            <p>
              {UI_TEXT.chart.high}: {activeCandle.item.high}
            </p>
            <p>
              {UI_TEXT.chart.low}: {activeCandle.item.low}
            </p>
            <p>
              {UI_TEXT.chart.close}: {activeCandle.item.close}
            </p>
            <p>
              {UI_TEXT.chart.volume}: {activeCandle.item.volume.toLocaleString("vi-VN")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
