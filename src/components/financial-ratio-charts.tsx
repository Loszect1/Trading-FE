"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialRatioPoint } from "@/types/vnstock";

interface FinancialRatioChartsProps {
  points: FinancialRatioPoint[];
}

type MetricConfig = {
  key: string;
  label: string;
  color: string;
  valueFormatter?: (value: number) => string;
};

const METRICS: MetricConfig[] = [
  {
    key: "Chỉ tiêu định giá,P/E",
    label: "P/E",
    color: "#38bdf8",
  },
  {
    key: "Chỉ tiêu định giá,P/B",
    label: "P/B",
    color: "#22d3ee",
  },
  {
    key: "Chỉ tiêu khả năng sinh lợi,ROE (%)",
    label: "ROE (%)",
    color: "#34d399",
    valueFormatter: (value) => `${value.toFixed(2)}%`,
  },
  {
    key: "Chỉ tiêu khả năng sinh lợi,ROA (%)",
    label: "ROA (%)",
    color: "#a78bfa",
    valueFormatter: (value) => `${value.toFixed(2)}%`,
  },
  {
    key: "Chỉ tiêu cơ cấu nguồn vốn,Debt/Equity",
    label: "Debt/Equity",
    color: "#f59e0b",
  },
  {
    key: "Chỉ tiêu thanh khoản,Current Ratio",
    label: "Current Ratio",
    color: "#f97316",
  },
];

function toQuarterLabel(point: FinancialRatioPoint): string {
  const year = Number(point["Meta,yearReport"] ?? 0);
  const quarter = Number(point["Meta,lengthReport"] ?? 0);
  if (year > 0 && quarter > 0) {
    return `Q${quarter}/${year}`;
  }
  return `${point["Meta,yearReport"] ?? ""}`;
}

export function FinancialRatioCharts({ points }: FinancialRatioChartsProps) {
  if (points.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-400">No financial ratio summary data.</p>
    );
  }

  const sortedPoints = [...points].sort((a, b) => {
    const yearA = Number(a["Meta,yearReport"] ?? 0);
    const yearB = Number(b["Meta,yearReport"] ?? 0);
    const quarterA = Number(a["Meta,lengthReport"] ?? 0);
    const quarterB = Number(b["Meta,lengthReport"] ?? 0);
    if (yearA !== yearB) return yearA - yearB;
    return quarterA - quarterB;
  });

  const chartData = sortedPoints.map((point) => ({
    quarter: toQuarterLabel(point),
    ...point,
  }));

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {METRICS.map((metric) => (
        <div
          key={metric.key}
          className="rounded-lg border border-white/10 bg-slate-950/45 p-3"
        >
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-200">
            {metric.label}
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis
                  dataKey="quarter"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={12}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(8, 13, 23, 0.96)",
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    borderRadius: "10px",
                    color: "#e6edf7",
                  }}
                  formatter={(value: unknown) => {
                    const num = Number(value ?? 0);
                    if (Number.isNaN(num)) return ["-", metric.label];
                    return [metric.valueFormatter ? metric.valueFormatter(num) : num.toFixed(2), metric.label];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={metric.key}
                  stroke={metric.color}
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
