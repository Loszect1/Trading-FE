import type { CandlePoint } from "@/types/vnstock";

/**
 * Normalize candle `time` to YYYY-MM-DD for TradingView Lightweight Charts.
 */
export function parseChartDay(raw: string): string | null {
  const t = String(raw).trim();
  if (!t) {
    return null;
  }
  const iso = t.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso;
  }
  const slash = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    const d = slash[1]!.padStart(2, "0");
    const mo = slash[2]!.padStart(2, "0");
    const y = slash[3]!;
    return `${y}-${mo}-${d}`;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export interface LwOhlcvRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Sort, dedupe by day (last wins), return rows aligned for indicators.
 */
export function candlePointsToLwRows(points: CandlePoint[]): LwOhlcvRow[] {
  const parsed = points
    .map((p) => {
      const time = parseChartDay(p.time);
      if (!time) {
        return null;
      }
      const open = p.open ?? p.close;
      const close = p.close;
      const high = p.high ?? Math.max(open, close);
      const low = p.low ?? Math.min(open, close);
      return {
        time,
        open,
        high,
        low,
        close,
        volume: p.volume ?? 0,
      };
    })
    .filter((row): row is LwOhlcvRow => row !== null);

  const byDay = new Map<string, LwOhlcvRow>();
  for (const row of parsed) {
    byDay.set(row.time, row);
  }
  return [...byDay.keys()].sort().map((time) => byDay.get(time)!);
}
