/**
 * Classic technical indicators on close-price series (aligned 1:1 with input length).
 */

export function sma(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: series.length }, () => null);
  if (period <= 0 || series.length < period) {
    return out;
  }
  for (let i = period - 1; i < series.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += series[i - j]!;
    }
    out[i] = sum / period;
  }
  return out;
}

export function ema(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: series.length }, () => null);
  if (period <= 0 || series.length < period) {
    return out;
  }
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev += series[i]!;
  }
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < series.length; i++) {
    prev = (series[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

export function bollingerBands(
  series: number[],
  period: number,
  multiplier: number,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(series, period);
  const upper: (number | null)[] = Array.from({ length: series.length }, () => null);
  const lower: (number | null)[] = Array.from({ length: series.length }, () => null);
  for (let i = period - 1; i < series.length; i++) {
    const m = mid[i];
    if (m === null) {
      continue;
    }
    let variance = 0;
    for (let j = 0; j < period; j++) {
      const d = series[i - j]! - m;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + multiplier * sd;
    lower[i] = m - multiplier * sd;
  }
  return { mid, upper, lower };
}

export function rsi(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: series.length }, () => null);
  if (period <= 0 || series.length <= period) {
    return out;
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = series[i]! - series[i - 1]!;
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss -= change;
    }
  }
  avgGain /= period;
  avgLoss /= period;
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < series.length; i++) {
    const change = series[i]! - series[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export interface MacdResult {
  line: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  series: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MacdResult {
  const line: (number | null)[] = Array.from({ length: series.length }, () => null);
  const signal: (number | null)[] = Array.from({ length: series.length }, () => null);
  const histogram: (number | null)[] = Array.from({ length: series.length }, () => null);
  const fast = ema(series, fastPeriod);
  const slow = ema(series, slowPeriod);
  for (let i = 0; i < series.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f !== null && s !== null) {
      line[i] = f - s;
    }
  }
  const dense: number[] = [];
  const indexMap: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const v = line[i];
    if (v !== null) {
      dense.push(v);
      indexMap.push(i);
    }
  }
  if (dense.length >= signalPeriod) {
    const sigDense = ema(dense, signalPeriod);
    for (let j = signalPeriod - 1; j < dense.length; j++) {
      const sv = sigDense[j];
      if (sv !== null) {
        signal[indexMap[j]!] = sv;
      }
    }
  }
  for (let i = 0; i < series.length; i++) {
    const l = line[i];
    const sig = signal[i];
    if (l !== null && sig !== null) {
      histogram[i] = l - sig;
    }
  }
  return { line, signal, histogram };
}

export function polylineFromSeries(
  values: (number | null)[],
  xForIndex: (i: number) => number,
  yScale: (v: number) => number,
): string {
  const parts: string[] = [];
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      started = false;
      continue;
    }
    const x = xForIndex(i);
    const y = yScale(v);
    if (!started) {
      parts.push(`M ${x} ${y}`);
      started = true;
    } else {
      parts.push(`L ${x} ${y}`);
    }
  }
  return parts.join(" ");
}
