"use client";

import type { LongTermAnalysisResult } from "@/types/long-term";

function formatNumber(value: unknown, digits = 0): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(number);
}

function formatCompact(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(number);
}

function scoreClass(score: number): string {
  if (score >= 80) {
    return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  }
  if (score >= 65) {
    return "border-cyan-300/35 bg-cyan-400/10 text-cyan-100";
  }
  if (score >= 50) {
    return "border-amber-300/35 bg-amber-400/10 text-amber-100";
  }
  return "border-rose-300/35 bg-rose-400/10 text-rose-100";
}

const RATING_LABELS_VI: Record<string, string> = {
  "Long-term compounder candidate": "Ứng viên tích lũy dài hạn",
  "Watchlist candidate": "Ứng viên theo dõi",
  "Neutral / wait for better valuation": "Trung lập / chờ định giá tốt hơn",
  "High risk / avoid unless special situation": "Rủi ro cao / chỉ xem xét nếu có tình huống đặc biệt",
  Avoid: "Tránh",
};

const REGIME_LABELS_VI: Record<string, string> = {
  Expansion: "Mở rộng",
  Recovery: "Phục hồi",
  Stress: "Căng thẳng",
  Overheated: "Quá nóng",
};

function translateRating(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return RATING_LABELS_VI[text] ?? text;
}

function translateRegime(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return REGIME_LABELS_VI[text] ?? (text || "-");
}

function translateDisclaimer(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "Research context only. This is not financial advice or an execution signal.") {
    return "Chỉ dùng làm bối cảnh nghiên cứu. Đây không phải là tư vấn tài chính hoặc tín hiệu đặt lệnh.";
  }
  return text;
}

function MacroLine({ result }: { result: LongTermAnalysisResult }) {
  const macro = result.macro_context ?? {};
  const regime = translateRegime(macro.regime);
  const score = typeof macro.regime_score === "number" ? macro.regime_score : Number(macro.regime_score ?? NaN);
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-200">
      <p className="text-xs font-semibold text-cyan-200">Bối cảnh vĩ mô</p>
      <p className="mt-1">
        {regime} {Number.isFinite(score) ? `(${formatNumber(score, 1)})` : ""}
      </p>
    </div>
  );
}

export function LongTermAnalysisPanel({ result }: { result: LongTermAnalysisResult }) {
  const components = result.score_components ?? {};
  const componentRows = [
    ["Chất lượng doanh nghiệp", components.business_quality, 20],
    ["Tăng trưởng", components.growth, 20],
    ["Định giá", components.valuation, 20],
    ["Sức khỏe tài chính", components.financial_strength, 15],
    ["Động lực hỗ trợ", components.catalyst, 15],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div className={`rounded-lg border p-4 ${scoreClass(result.final_score)}`}>
          <p className="text-xs font-semibold uppercase">Điểm</p>
          <p className="mt-2 text-4xl font-semibold">{formatNumber(result.final_score, 1)}</p>
          <p className="mt-1 text-xs">Điểm trừ rủi ro {formatNumber(result.risk_penalty, 1)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white/[0.08] px-2 py-1 text-xs font-semibold text-slate-200">
              {result.symbol}
            </span>
            {result.rank ? (
              <span className="rounded-md bg-cyan-300/12 px-2 py-1 text-xs font-semibold text-cyan-100">
                Hạng #{result.rank}
              </span>
            ) : null}
            {result.sector_context?.exchange ? (
              <span className="rounded-md bg-white/[0.08] px-2 py-1 text-xs text-slate-300">
                {result.sector_context.exchange}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-lg font-semibold text-slate-100">{translateRating(result.rating)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {result.ai_thesis?.trim() || "Chỉ có điểm định lượng. Chưa có diễn giải AI cho mã này."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MacroLine result={result} />
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-200">
          <p className="text-xs font-semibold text-cyan-200">Ngành</p>
          <p className="mt-1">{result.sector_context?.sector || result.sector || "-"}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-200">
          <p className="text-xs font-semibold text-cyan-200">Vốn hóa</p>
          <p className="mt-1">{formatCompact(result.sector_context?.market_cap ?? result.market_cap)}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-5">
        {componentRows.map(([label, value, max]) => {
          const number = typeof value === "number" ? value : Number(value ?? 0);
          const pct = Number.isFinite(number) ? Math.max(0, Math.min(100, (number / Number(max)) * 100)) : 0;
          return (
            <div key={String(label)} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold text-slate-400">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">
                {formatNumber(number, 1)}
                <span className="text-xs text-slate-500">/{max}</span>
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-white/10">
                <div className="h-1.5 rounded-full bg-cyan-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/[0.06] p-3">
          <p className="text-xs font-semibold text-emerald-200">Động lực hỗ trợ</p>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-emerald-50">
            {(result.catalysts?.length ? result.catalysts : ["Chưa có chi tiết động lực hỗ trợ."]).map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-rose-300/20 bg-rose-400/[0.06] p-3">
          <p className="text-xs font-semibold text-rose-200">Rủi ro</p>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-rose-50">
            {(result.risks?.length ? result.risks : ["Chưa có chi tiết rủi ro."]).map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-300">
          <p className="text-xs font-semibold text-cyan-200">Bối cảnh tin tức</p>
          <p className="mt-2">Số mẫu: {formatNumber(result.news_context?.sample_count ?? 0)}</p>
          <p>Tác động tích cực: {formatNumber(result.news_context?.positive_weighted_impact ?? 0, 1)}</p>
          <p>Tác động tiêu cực: {formatNumber(result.news_context?.negative_weighted_impact ?? 0, 1)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-300">
          <p className="text-xs font-semibold text-cyan-200">Thiếu dữ liệu</p>
          <p className="mt-2">
            {result.data_gaps?.length ? result.data_gaps.slice(0, 8).join(", ") : "Không ghi nhận thiếu dữ liệu lớn."}
          </p>
        </div>
      </div>

      <p className="rounded-lg border border-amber-300/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-100">
        {translateDisclaimer(result.disclaimer)}
      </p>
    </div>
  );
}
