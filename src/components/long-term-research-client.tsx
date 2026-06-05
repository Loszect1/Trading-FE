"use client";

import { BarChart3, Database, Info, Play, RefreshCw, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LongTermAnalysisPanel } from "@/components/long-term-analysis-panel";
import { useToast } from "@/components/toast-provider";
import { fetchAiDecisionEvents, type AiDecisionEventRow } from "@/services/automation.api";
import {
  analyzeLongTermSymbol,
  fetchLongTermRankings,
  fetchMacroGptAnalysis,
  fetchMacroRegime,
  runLongTermScan,
} from "@/services/long-term.api";
import type { AppError } from "@/types/api";
import type { LongTermAnalysisResult, MacroGptAnalysisResponse, MacroRegimeResponse } from "@/types/long-term";

const RATING_FILTERS = [
  "All ratings",
  "Long-term compounder candidate",
  "Watchlist candidate",
  "Neutral / wait for better valuation",
  "High risk / avoid unless special situation",
  "Avoid",
] as const;

type GapFilter = "all" | "complete" | "has_gaps";

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

function compactNumber(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(number);
}

function scoreBadgeClass(score: number): string {
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

function asText(value: unknown, fallback = "-"): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function MacroStrategyMemoryPanel({
  rows,
  loading,
  error,
}: {
  rows: AiDecisionEventRow[];
  loading: boolean;
  error: string;
}) {
  const memory = rows[0];
  const recommendation = asRecord(memory?.llm_recommendation);
  const finalDecision = asRecord(memory?.final_system_decision);
  const guardrail = asRecord(memory?.guardrail_result);
  const allocation = asRecord(recommendation.allocation);
  const allocationRows = Object.entries(allocation).filter(([, value]) => value !== null && value !== undefined && String(value).trim());
  const rules = asStringList(recommendation.rules);
  const metrics = asStringList(recommendation.monitoring_metrics);
  const triggers = asStringList(recommendation.invalidation_triggers);
  const assumptions = asStringList(recommendation.assumptions);
  const scope = asStringList(finalDecision.scope);

  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Approved GPT Memory</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-100">
            {asText(recommendation.title, "Macro strategy memory")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
            {asText(recommendation.summary, "No approved macro strategy memory is loaded yet.")}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-300">
          <Database className="h-4 w-4 text-cyan-200" aria-hidden="true" />
          {memory ? memory.reuse_status : "No row"}
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-cyan-100">Loading approved memory...</p>
      ) : error ? (
        <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100">
          {error}
        </p>
      ) : memory ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 lg:grid-cols-5">
            {allocationRows.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs text-slate-400">{key.replace(/_/g, " ")}</p>
                <p className="mt-1 text-lg font-semibold text-slate-100">{String(value)}%</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/[0.06] p-3">
              <p className="text-xs font-semibold text-emerald-200">Rules</p>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-50">
                {(rules.length ? rules : ["No rules saved."]).slice(0, 8).map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-rose-300/20 bg-rose-400/[0.06] p-3">
              <p className="text-xs font-semibold text-rose-200">Invalidation Triggers</p>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-rose-50">
                {(triggers.length ? triggers : ["No triggers saved."]).slice(0, 8).map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold text-cyan-200">Monthly Metrics</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{metrics.length ? metrics.join(" | ") : "-"}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold text-cyan-200">Scope & Guardrail</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {(scope.length ? scope.join(" | ") : "macro_gpt_analysis | long_term_research")} |{" "}
                {asText(guardrail.status, "CONTEXT_ONLY")}
              </p>
            </div>
          </div>

          {assumptions.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-sm leading-6 text-cyan-50">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{assumptions.join(" | ")}</p>
            </div>
          ) : null}

          <p className="text-xs leading-5 text-slate-500">
            Source: /automation/ai-decisions?workflow_type=MACRO_STRATEGY_MEMORY | {memory.source_id} |{" "}
            {new Date(memory.created_at).toLocaleString()}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-400">No approved macro strategy memory found.</p>
      )}
    </section>
  );
}

function MacroSummary({
  macro,
  macroGpt,
  macroGptLoading,
  macroGptError,
}: {
  macro: MacroRegimeResponse | null;
  macroGpt: MacroGptAnalysisResponse | null;
  macroGptLoading: boolean;
  macroGptError: string;
}) {
  if (!macro) {
    return (
      <section className="glass-panel rounded-xl p-5">
        <p className="text-sm text-slate-400">Chưa tải chế độ vĩ mô.</p>
      </section>
    );
  }
  const componentRows = Object.entries(macro.components ?? {});
  const macroGptAnalysis = macroGpt?.analysis;
  const bullishDrivers = asStringList(macroGptAnalysis?.bullish_drivers);
  const bearishDrivers = asStringList(macroGptAnalysis?.bearish_drivers);
  const riskWatchlist = asStringList(macroGptAnalysis?.risk_watchlist);
  const sectorImplications = Array.isArray(macroGptAnalysis?.sector_implications) ? macroGptAnalysis.sector_implications : [];
  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Chế độ vĩ mô</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">{macro.regime}</h2>
          <p className="mt-1 text-sm text-slate-400">Cập nhật {macro.as_of}</p>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${scoreBadgeClass(macro.regime_score)}`}>
          <p className="text-xs font-semibold uppercase">Điểm</p>
          <p className="mt-1 text-3xl font-semibold">{formatNumber(macro.regime_score, 1)}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {componentRows.map(([key, value]) => (
          <div key={key} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
            <p className="text-xs text-slate-400">{key.replace(/_/g, " ")}</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{formatNumber(value, 1)}</p>
          </div>
        ))}
      </div>
      {macro.warnings?.length ? (
        <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100">
          {macro.warnings.join(" ")}
        </div>
      ) : null}
      <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">GPT đọc vĩ mô</p>
            <p className="mt-1 text-xs text-slate-500">
              Chạy khi làm mới hoặc quét, dùng quan sát vĩ mô và áp lực tin tức gần đây.
            </p>
          </div>
          {macroGpt ? (
            <span className="rounded-md border border-white/10 bg-slate-950/45 px-2 py-1 text-xs text-slate-300">
              {macroGpt.model} | {new Date(macroGpt.generated_at).toLocaleString()} |{" "}
              {macroGpt.cached ? "cached" : "fresh"} until end of day
            </span>
          ) : null}
        </div>
        {macroGptLoading ? (
          <p className="mt-4 text-sm text-cyan-100">GPT đang phân tích vĩ mô, kinh tế, tin tức và dòng tiền...</p>
        ) : macroGptError ? (
          <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100">
            Không tải được bản đọc vĩ mô GPT: {macroGptError}
          </p>
        ) : macroGpt ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-slate-200">{asText(macroGptAnalysis?.executive_summary, "GPT chưa trả về tóm tắt.")}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold text-cyan-200">Kinh tế</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{asText(macroGptAnalysis?.economics_view)}</p>
              </article>
              <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold text-cyan-200">Áp lực tin tức</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{asText(macroGptAnalysis?.news_pressure)}</p>
              </article>
              <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold text-cyan-200">Bối cảnh toàn cầu</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{asText(macroGptAnalysis?.global_context)}</p>
              </article>
              <article className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold text-cyan-200">Hàm ý thị trường</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{asText(macroGptAnalysis?.market_implications)}</p>
              </article>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/[0.06] p-3">
                <p className="text-xs font-semibold text-emerald-200">Động lực tích cực</p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-50">
                  {(bullishDrivers.length ? bullishDrivers : ["Chưa có động lực tích cực."]).slice(0, 5).map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-rose-300/20 bg-rose-400/[0.06] p-3">
                <p className="text-xs font-semibold text-rose-200">Rủi ro cần theo dõi</p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-rose-50">
                  {[
                    ...(bearishDrivers.length ? bearishDrivers : ["Chưa có động lực tiêu cực."]),
                    ...riskWatchlist,
                  ].slice(0, 5).map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            {sectorImplications.length ? (
              <div className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <p className="text-xs font-semibold text-cyan-200">Hàm ý theo ngành</p>
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  {sectorImplications.slice(0, 6).map((item) => (
                    <div key={`${item.sector}-${item.impact}`} className="rounded-md border border-white/10 bg-white/[0.03] p-2">
                      <p className="text-sm font-semibold text-slate-100">{item.sector}</p>
                      <p className="mt-1 text-xs font-semibold text-cyan-100">{item.impact}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-slate-500">{asText(macroGptAnalysis?.disclaimer, "Chỉ dùng làm bối cảnh nghiên cứu. Không phải khuyến nghị đầu tư hoặc tín hiệu đặt lệnh.")}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">GPT chưa tạo bản đọc vĩ mô.</p>
        )}
      </div>
    </section>
  );
}

export function LongTermResearchClient() {
  const { showToast } = useToast();
  const [macro, setMacro] = useState<MacroRegimeResponse | null>(null);
  const [macroGpt, setMacroGpt] = useState<MacroGptAnalysisResponse | null>(null);
  const [macroGptLoading, setMacroGptLoading] = useState(false);
  const [macroGptError, setMacroGptError] = useState("");
  const [strategyMemory, setStrategyMemory] = useState<AiDecisionEventRow[]>([]);
  const [strategyMemoryLoading, setStrategyMemoryLoading] = useState(false);
  const [strategyMemoryError, setStrategyMemoryError] = useState("");
  const [rankings, setRankings] = useState<LongTermAnalysisResult[]>([]);
  const [selected, setSelected] = useState<LongTermAnalysisResult | null>(null);
  const [detailLoadingSymbol, setDetailLoadingSymbol] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState<(typeof RATING_FILTERS)[number]>("All ratings");
  const [gapFilter, setGapFilter] = useState<GapFilter>("all");
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);

  const loadMacroGpt = useCallback(async () => {
    setMacroGptLoading(true);
    setMacroGptError("");
    try {
      const result = await fetchMacroGptAnalysis({
        newsLimit: 40,
        observationLimit: 80,
        language: "vi",
        forceRefresh: false,
      });
      setMacroGpt(result);
    } catch (error) {
      const message = (error as AppError).message || "Phân tích vĩ mô GPT thất bại.";
      setMacroGptError(message);
    } finally {
      setMacroGptLoading(false);
    }
  }, []);

  const loadStrategyMemory = useCallback(async () => {
    setStrategyMemoryLoading(true);
    setStrategyMemoryError("");
    try {
      const rows = await fetchAiDecisionEvents({
        limit: 5,
        workflowType: "MACRO_STRATEGY_MEMORY",
        reuseStatus: "APPROVED",
      });
      setStrategyMemory(rows);
    } catch (error) {
      const message = (error as AppError).message || "Failed to load approved macro strategy memory.";
      setStrategyMemoryError(message);
    } finally {
      setStrategyMemoryLoading(false);
    }
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    setErrorMessage("");
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [macroResult, rankingsResult] = await Promise.all([
        fetchMacroRegime({ forceRefresh }),
        fetchLongTermRankings({ limit: 100, forceRefresh }),
        loadStrategyMemory(),
      ]);
      setMacro(macroResult);
      setRankings(rankingsResult.data.items ?? []);
      setLatestRunId(rankingsResult.data.items?.[0]?.run_id ?? rankingsResult.data.run_id ?? null);
      setLoading(false);
      await loadMacroGpt();
    } catch (error) {
      const message = (error as AppError).message || "Failed to load long-term research.";
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadMacroGpt, loadStrategyMemory, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    return rankings.filter((row) => {
      const sector = String(row.sector_context?.sector ?? row.sector ?? "").toLowerCase();
      const score = Number(row.final_score ?? 0);
      const gaps = row.data_gaps ?? [];
      if (sectorFilter.trim() && !sector.includes(sectorFilter.trim().toLowerCase())) {
        return false;
      }
      if (ratingFilter !== "All ratings" && row.rating !== ratingFilter) {
        return false;
      }
      if (gapFilter === "complete" && gaps.length > 0) {
        return false;
      }
      if (gapFilter === "has_gaps" && gaps.length === 0) {
        return false;
      }
      return score >= minScore && score <= maxScore;
    });
  }, [gapFilter, maxScore, minScore, rankings, ratingFilter, sectorFilter]);

  const handleRunScan = async () => {
    setScanRunning(true);
    setErrorMessage("");
    try {
      const result = await runLongTermScan({ universeSize: 100, candidateLimit: 400 });
      setRankings(result.rankings ?? []);
      setLatestRunId(result.run_id);
      try {
        const macroResult = await fetchMacroRegime({ forceRefresh: true });
        setMacro(macroResult);
      } catch {
        setMacro(null);
      }
      await loadMacroGpt();
      showToast(`Long-term scan completed: ${result.scored_count} symbols`, "success");
    } catch (error) {
      const message = (error as AppError).message || "Long-term scan failed.";
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      setScanRunning(false);
    }
  };

  const handleOpenDetail = async (row: LongTermAnalysisResult) => {
    if (detailLoadingSymbol) {
      return;
    }
    setDetailLoadingSymbol(row.symbol);
    try {
      const result = await analyzeLongTermSymbol(row.symbol);
      setSelected({
        ...result,
        rank: row.rank ?? result.rank,
        run_id: row.run_id ?? result.run_id,
      });
    } catch (error) {
      const message = (error as AppError).message || `Failed to load ${row.symbol} full long-term analysis.`;
      showToast(message, "error");
    } finally {
      setDetailLoadingSymbol((current) => (current === row.symbol ? null : current));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Long-term Research</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Macro regime, top HOSE market-cap scan, deterministic ranking, and explanatory thesis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing || loading || macroGptLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing || macroGptLoading ? "Refreshing" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void handleRunScan()}
            disabled={scanRunning || macroGptLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {scanRunning ? "Running" : "Run Scan"}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <p className="rounded-lg border border-rose-300/25 bg-rose-400/[0.08] p-3 text-sm text-rose-100">
          {errorMessage}
        </p>
      ) : null}

      <MacroSummary
        macro={macro}
        macroGpt={macroGpt}
        macroGptLoading={macroGptLoading}
        macroGptError={macroGptError}
      />

      <section className="glass-panel rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Auto Scan</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-100">HOSE Top 100 Rankings</h2>
            <p className="mt-1 text-sm text-slate-400">
              {latestRunId ? `Latest run ${latestRunId}` : "No persisted auto scan is available yet."}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-300">
            <BarChart3 className="h-4 w-4 text-cyan-200" aria-hidden="true" />
            {filtered.length}/{rankings.length} rows
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" aria-hidden="true" />
            <input
              value={sectorFilter}
              onChange={(event) => setSectorFilter(event.target.value)}
              placeholder="Filter sector"
              className="h-9 w-full rounded-md border border-slate-500/40 bg-slate-950/75 pl-9 pr-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
            />
          </label>
          <select
            value={ratingFilter}
            onChange={(event) => setRatingFilter(event.target.value as (typeof RATING_FILTERS)[number])}
            className="h-9 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
          >
            {RATING_FILTERS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={gapFilter}
            onChange={(event) => setGapFilter(event.target.value as GapFilter)}
            className="h-9 rounded-md border border-slate-500/40 bg-slate-950/75 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/25"
          >
            <option value="all">All data quality</option>
            <option value="complete">No data gaps</option>
            <option value="has_gaps">Has data gaps</option>
          </select>
          <div className="flex items-center gap-2 rounded-md border border-slate-500/40 bg-slate-950/75 px-3">
            <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <input
              type="number"
              value={minScore}
              min={0}
              max={100}
              onChange={(event) => setMinScore(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
              aria-label="Minimum score"
            />
            <span className="text-slate-500">to</span>
            <input
              type="number"
              value={maxScore}
              min={0}
              max={100}
              onChange={(event) => setMaxScore(Math.max(0, Math.min(100, Number(event.target.value) || 100)))}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
              aria-label="Maximum score"
            />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-3">Rank</th>
                <th className="px-3 py-3">Symbol</th>
                <th className="px-3 py-3">Score</th>
                <th className="px-3 py-3">Rating</th>
                <th className="px-3 py-3">Sector</th>
                <th className="px-3 py-3">Market Cap</th>
                <th className="px-3 py-3">Risk</th>
                <th className="px-3 py-3">Gaps</th>
                <th className="px-3 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-6 text-slate-400" colSpan={9}>
                    Loading rankings...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-slate-400" colSpan={9}>
                    No ranking rows match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={`${row.run_id}-${row.symbol}`} className="border-t border-white/10 text-slate-200">
                    <td className="px-3 py-3">{row.rank ?? "-"}</td>
                    <td className="px-3 py-3 font-semibold text-cyan-100">{row.symbol}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${scoreBadgeClass(row.final_score)}`}>
                        {formatNumber(row.final_score, 1)}
                      </span>
                    </td>
                    <td className="px-3 py-3">{row.rating}</td>
                    <td className="px-3 py-3">{row.sector_context?.sector || row.sector || "-"}</td>
                    <td className="px-3 py-3">{compactNumber(row.sector_context?.market_cap ?? row.market_cap)}</td>
                    <td className="px-3 py-3">{formatNumber(row.risk_penalty, 1)}</td>
                    <td className="px-3 py-3">{row.data_gaps?.length ?? 0}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => void handleOpenDetail(row)}
                        disabled={detailLoadingSymbol !== null}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Info className="h-4 w-4" aria-hidden="true" />
                        {detailLoadingSymbol === row.symbol ? "Loading" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <MacroStrategyMemoryPanel
        rows={strategyMemory}
        loading={strategyMemoryLoading}
        error={strategyMemoryError}
      />

      {selected ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setSelected(null)}
            aria-label="Close long-term detail"
          />
          <div className="relative z-[101] flex max-h-[min(90vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#080c14] shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-100">{selected.symbol} Chi tiết dài hạn</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 text-slate-200 transition hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <LongTermAnalysisPanel result={selected} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
