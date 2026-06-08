"use client";

import { BarChart3, CheckCircle, Database, FileText, Info, Play, RefreshCw, Search, SlidersHorizontal, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LongTermAnalysisPanel } from "@/components/long-term-analysis-panel";
import { useToast } from "@/components/toast-provider";
import {
  AI_MEMORY_WORKFLOW_TYPES,
  contributeToGptMemory,
  fetchAiMemoryDetail,
  fetchAiMemoryEvents,
  reviewAiMemoryEvent,
  type AiDecisionEventRow,
  type AiDecisionReuseStatus,
  type AiMemoryEvidenceSourceRow,
  type AiMemoryWorkflowType,
  type MemoryContributionResponse,
} from "@/services/automation.api";
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

const MEMORY_CATEGORY_LABELS: Record<AiMemoryWorkflowType, string> = {
  MACRO_STRATEGY_MEMORY: "Macro strategy",
  RISK_MANAGEMENT_MEMORY: "Risk management",
  TECHNICAL_PATTERN_MEMORY: "Technical pattern",
  MARKET_STRUCTURE_MEMORY: "Market structure",
  FUNDAMENTAL_THESIS_MEMORY: "Fundamental thesis",
  OTHER_STRATEGY_CONTEXT: "Other context",
};

type GapFilter = "all" | "complete" | "has_gaps";
type MemoryCategoryFilter = "ALL" | AiMemoryWorkflowType;

interface MemoryReviewDraft {
  workflowType: AiMemoryWorkflowType;
  title: string;
  summary: string;
  allocationJson: string;
  rulesText: string;
  metricsText: string;
  triggersText: string;
  assumptionsText: string;
  scopeText: string;
  guardrailStatus: string;
  guardrailReason: string;
  reviewNotes: string;
}

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

function normalizeMemoryWorkflowType(value: unknown): AiMemoryWorkflowType {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return AI_MEMORY_WORKFLOW_TYPES.includes(text as AiMemoryWorkflowType) ? (text as AiMemoryWorkflowType) : "OTHER_STRATEGY_CONTEXT";
}

function categoryLabel(value: unknown): string {
  return MEMORY_CATEGORY_LABELS[normalizeMemoryWorkflowType(value)];
}

function listToText(value: unknown): string {
  return asStringList(value).join("\n");
}

function textToList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAllocationJson(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function createMemoryReviewDraft(row: AiDecisionEventRow | null): MemoryReviewDraft {
  const recommendation = asRecord(row?.llm_recommendation);
  const finalDecision = asRecord(row?.final_system_decision);
  const guardrail = asRecord(row?.guardrail_result);
  return {
    workflowType: normalizeMemoryWorkflowType(row?.workflow_type),
    title: asText(recommendation.title, ""),
    summary: asText(recommendation.summary, ""),
    allocationJson: JSON.stringify(asRecord(recommendation.allocation), null, 2),
    rulesText: listToText(recommendation.rules),
    metricsText: listToText(recommendation.monitoring_metrics),
    triggersText: listToText(recommendation.invalidation_triggers),
    assumptionsText: listToText(recommendation.assumptions),
    scopeText: listToText(finalDecision.scope) || "macro_gpt_analysis\nlong_term_research",
    guardrailStatus: asText(guardrail.status, "APPROVED_FOR_CONTEXT_ONLY"),
    guardrailReason: asText(guardrail.reason, "Approved memory is context only, not an execution signal."),
    reviewNotes: row?.review_notes || "",
  };
}

function memoryReviewPayload(draft: MemoryReviewDraft, reuseStatus: AiDecisionReuseStatus) {
  return {
    reuse_status: reuseStatus,
    workflow_type: draft.workflowType,
    llm_recommendation: {
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      allocation: parseAllocationJson(draft.allocationJson),
      rules: textToList(draft.rulesText),
      monitoring_metrics: textToList(draft.metricsText),
      invalidation_triggers: textToList(draft.triggersText),
      assumptions: textToList(draft.assumptionsText),
    },
    final_system_decision: {
      scope: textToList(draft.scopeText),
      automatic_execution: false,
      deterministic_scoring_change: false,
    },
    guardrail_result: {
      status: draft.guardrailStatus.trim() || "APPROVED_FOR_CONTEXT_ONLY",
      reason: draft.guardrailReason.trim() || "Approved memory is context only, not an execution signal.",
    },
    review_notes: draft.reviewNotes.trim() || null,
  };
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
  const grouped = rows.reduce<Record<string, AiDecisionEventRow[]>>((acc, row) => {
    const key = normalizeMemoryWorkflowType(row.workflow_type);
    acc[key] = [...(acc[key] ?? []), row];
    return acc;
  }, {});

  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Approved GPT Memory</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-100">Approved long-term context by category</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
            Approved rows are injected into macro and long-term GPT prompts as context only.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-300">
          <Database className="h-4 w-4 text-cyan-200" aria-hidden="true" />
          {rows.length} approved
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-cyan-100">Loading approved memory...</p>
      ) : error ? (
        <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100">
          {error}
        </p>
      ) : rows.length ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {AI_MEMORY_WORKFLOW_TYPES.filter((category) => grouped[category]?.length).map((category) => (
            <div key={category} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-cyan-100">{MEMORY_CATEGORY_LABELS[category]}</p>
                <span className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
                  {grouped[category].length}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {grouped[category].slice(0, 4).map((memory) => {
                  const recommendation = asRecord(memory.llm_recommendation);
                  const finalDecision = asRecord(memory.final_system_decision);
                  const guardrail = asRecord(memory.guardrail_result);
                  const rules = asStringList(recommendation.rules);
                  const triggers = asStringList(recommendation.invalidation_triggers);
                  const scope = asStringList(finalDecision.scope);
                  return (
                    <div key={memory.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-100">{asText(recommendation.title, categoryLabel(memory.workflow_type))}</p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">{asText(recommendation.summary)}</p>
                        </div>
                        <span className="shrink-0 text-xs text-cyan-200">{Math.round(Number(memory.confidence ?? 0)) || "-"}%</span>
                      </div>
                      {rules.length ? (
                        <p className="mt-2 text-xs leading-5 text-emerald-100">Rules: {rules.slice(0, 3).join(" | ")}</p>
                      ) : null}
                      {triggers.length ? (
                        <p className="mt-1 text-xs leading-5 text-rose-100">Invalidation: {triggers.slice(0, 2).join(" | ")}</p>
                      ) : null}
                      <p className="mt-2 text-[10px] leading-4 text-slate-500">
                        {(scope.length ? scope.join(" | ") : "macro_gpt_analysis | long_term_research")} |{" "}
                        {asText(guardrail.status, "CONTEXT_ONLY")} | {new Date(memory.updated_at || memory.created_at).toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-400">No approved long-term memory found.</p>
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

  // Memory contribution (input before Approved GPT Memory)
  // No category picker — GPT will analyze the content and automatically choose the best bucket
  // (MACRO_STRATEGY_MEMORY, RISK_MANAGEMENT_MEMORY, TECHNICAL_PATTERN_MEMORY, etc.)
  const [contribText, setContribText] = useState("");
  const [contribFiles, setContribFiles] = useState<File[]>([]);
  const [contribNotes, setContribNotes] = useState("");
  const [contribLoading, setContribLoading] = useState(false);
  const [contribResult, setContribResult] = useState<MemoryContributionResponse["data"] | null>(null);
  const [contribError, setContribError] = useState("");

  const [memoryCandidates, setMemoryCandidates] = useState<AiDecisionEventRow[]>([]);
  const [memoryCandidatesLoading, setMemoryCandidatesLoading] = useState(false);
  const [memoryStatusFilter, setMemoryStatusFilter] = useState<AiDecisionReuseStatus>("NEW");
  const [memoryCategoryFilter, setMemoryCategoryFilter] = useState<MemoryCategoryFilter>("ALL");
  const [selectedMemory, setSelectedMemory] = useState<AiDecisionEventRow | null>(null);
  const [memoryEvidence, setMemoryEvidence] = useState<AiMemoryEvidenceSourceRow[]>([]);
  const [memoryDetailLoading, setMemoryDetailLoading] = useState(false);
  const [memoryReviewLoading, setMemoryReviewLoading] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<MemoryReviewDraft>(() => createMemoryReviewDraft(null));

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

  const loadMacroGpt = useCallback(async (forceRefresh = false) => {
    setMacroGptLoading(true);
    setMacroGptError("");
    try {
      const result = await fetchMacroGptAnalysis({
        newsLimit: 40,
        observationLimit: 80,
        language: "vi",
        forceRefresh,
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
      const rows = await fetchAiMemoryEvents({
        limit: 40,
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

  const loadMemoryCandidates = useCallback(async () => {
    setMemoryCandidatesLoading(true);
    try {
      const rows = await fetchAiMemoryEvents({
        limit: 40,
        reuseStatus: memoryStatusFilter,
        workflowType: memoryCategoryFilter === "ALL" ? undefined : memoryCategoryFilter,
      });
      setMemoryCandidates(rows);
    } catch {
      setMemoryCandidates([]);
    } finally {
      setMemoryCandidatesLoading(false);
    }
  }, [memoryCategoryFilter, memoryStatusFilter]);

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
        loadMemoryCandidates(),
      ]);
      setMacro(macroResult);
      setRankings(rankingsResult.data.items ?? []);
      setLatestRunId(rankingsResult.data.items?.[0]?.run_id ?? rankingsResult.data.run_id ?? null);
      setLoading(false);
      await loadMacroGpt(forceRefresh);
    } catch (error) {
      const message = (error as AppError).message || "Failed to load long-term research.";
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadMacroGpt, loadStrategyMemory, loadMemoryCandidates, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // --- Memory contribution handlers (text + files -> GPT deep analysis + propose -> NEW record) ---
  const handleContribute = async () => {
    if (!contribText.trim() && contribFiles.length === 0) {
      setContribError("Please provide text or attach at least one file.");
      return;
    }
    setContribLoading(true);
    setContribError("");
    setContribResult(null);

    try {
      const form = new FormData();
      form.append("user_text", contribText.trim());
      // Do not send a user-chosen category — GPT will analyze the content and decide the best one.
      if (contribNotes.trim()) form.append("notes", contribNotes.trim());
      contribFiles.forEach((f) => form.append("files", f));

      const res = await contributeToGptMemory(form);
      setContribResult(res.data as MemoryContributionResponse["data"]);
      showToast("Analysis complete. Review the report and proposal.", "success");

      // Refresh candidates so the new NEW row appears for approval
      await loadMemoryCandidates();
    } catch (error) {
      const message = (error as AppError).message || "Contribution analysis failed.";
      setContribError(message);
      showToast(message, "error");
    } finally {
      setContribLoading(false);
    }
  };

  const openMemoryReview = async (row: AiDecisionEventRow) => {
    setSelectedMemory(row);
    setReviewDraft(createMemoryReviewDraft(row));
    setMemoryEvidence(row.evidence_sources ?? []);
    setMemoryDetailLoading(true);
    try {
      const detail = await fetchAiMemoryDetail(row.id);
      setSelectedMemory(detail);
      setReviewDraft(createMemoryReviewDraft(detail));
      setMemoryEvidence(detail.evidence_sources ?? []);
    } catch (error) {
      const message = (error as AppError).message || "Failed to load memory detail.";
      showToast(message, "error");
    } finally {
      setMemoryDetailLoading(false);
    }
  };

  const handleOpenContributionReview = async () => {
    const row = contribResult?.recorded_event;
    if (!row) return;
    await openMemoryReview(row);
  };

  const handleSaveAsCandidate = async () => {
    // Already recorded as NEW by the backend. Just clear the local preview.
    showToast("Saved as NEW candidate for later review.", "success");
    setContribResult(null);
    await loadMemoryCandidates();
  };

  const handleCandidateStatus = async (row: AiDecisionEventRow, status: "APPROVED" | "REJECTED" | "EXPIRED") => {
    try {
      await reviewAiMemoryEvent(row.id, memoryReviewPayload(createMemoryReviewDraft(row), status));
      showToast(status === "APPROVED" ? "Approved into global memory." : status === "REJECTED" ? "Rejected." : "Expired.", "success");
      await Promise.all([loadStrategyMemory(), loadMemoryCandidates(), status === "APPROVED" ? loadMacroGpt(true) : Promise.resolve()]);
    } catch (error) {
      const message = (error as AppError).message || "Failed to update status.";
      showToast(message, "error");
    }
  };

  const handleReviewSubmit = async (status: AiDecisionReuseStatus) => {
    if (!selectedMemory) return;
    setMemoryReviewLoading(true);
    try {
      const result = await reviewAiMemoryEvent(selectedMemory.id, memoryReviewPayload(reviewDraft, status));
      setSelectedMemory(result.data);
      setReviewDraft(createMemoryReviewDraft(result.data));
      if (contribResult?.recorded_event?.id === selectedMemory.id && status === "APPROVED") {
        setContribResult(null);
        setContribText("");
        setContribFiles([]);
        setContribNotes("");
      }
      showToast(status === "APPROVED" ? "Approved. Memory is live for GPT context." : `Status updated to ${status}.`, "success");
      await Promise.all([loadStrategyMemory(), loadMemoryCandidates(), status === "APPROVED" ? loadMacroGpt(true) : Promise.resolve()]);
    } catch (error) {
      const message = (error as AppError).message || "Failed to review memory.";
      showToast(message, "error");
    } finally {
      setMemoryReviewLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    setContribFiles((prev) => [...prev, ...list].slice(0, 6)); // cap at 6
  };

  const removeFile = (idx: number) => {
    setContribFiles((prev) => prev.filter((_, i) => i !== idx));
  };

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

      {/* === Contribute to Approved GPT Memory (placed immediately before the Approved panel) === */}
      <section className="glass-panel rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Enhance Long-term Memory</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-100">Contribute knowledge for GPT curation</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Add text, screenshots, research notes, or files. Send to GPT in the BE container — it will deeply research, fact-check (true / wrong / missing / gaps), and <strong>automatically categorize</strong> the information into the best strategy memory bucket (MACRO_STRATEGY_MEMORY, RISK_MANAGEMENT_MEMORY, TECHNICAL_PATTERN_MEMORY, etc.). No need to pick a category.
            </p>
          </div>
          <FileText className="h-5 w-5 text-emerald-200" aria-hidden="true" />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Information / claim / excerpt / chart description</label>
            <textarea
              value={contribText}
              onChange={(e) => setContribText(e.target.value)}
              placeholder="E.g. Vietnam FDI disbursement in 2026 is tracking 12% above plan in key industrial parks; credit growth in green sectors accelerating..."
              className="mt-1 h-28 w-full resize-y rounded-md border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-100 outline-none focus:border-emerald-300/60"
            />
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Notes / source (optional)</label>
              <input
                value={contribNotes}
                onChange={(e) => setContribNotes(e.target.value)}
                placeholder="Source, date, context, or any extra details..."
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Attach files (images, .pdf, .txt, .md...)</label>
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
                  <Upload className="h-3.5 w-3.5" />
                  Choose files
                  <input type="file" multiple onChange={handleFileSelect} className="hidden" />
                </label>
                <span className="text-[11px] text-slate-500">{contribFiles.length} file(s)</span>
              </div>
              {contribFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {contribFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                      {f.name.length > 22 ? f.name.slice(0, 20) + "…" : f.name}
                      <button type="button" onClick={() => removeFile(i)} className="text-rose-300/80 hover:text-rose-300">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void handleContribute()}
            disabled={contribLoading || (!contribText.trim() && contribFiles.length === 0)}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-400/10 px-4 py-1.5 text-sm font-semibold text-emerald-100 disabled:opacity-60"
          >
            {contribLoading ? "Analyzing with GPT..." : "Analyze & Propose Memory"}
          </button>
          <button
            onClick={() => { setContribText(""); setContribFiles([]); setContribNotes(""); setContribResult(null); setContribError(""); }}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        </div>

        {contribError && (
          <p className="mt-2 rounded border border-rose-300/20 bg-rose-400/5 p-2 text-sm text-rose-200">{contribError}</p>
        )}

        {contribResult && (
          <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/[0.04] p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-emerald-100">GPT Analysis &amp; Proposed Memory</p>
              <span className="text-xs text-emerald-200/70">Confidence: {Math.round(contribResult.confidence || 0)} • Categorized by GPT as: <strong>{contribResult.workflow_type_used}</strong></span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-emerald-200/80">Fact-check</p>
                <ul className="mt-1 space-y-1 text-emerald-50/90">
                  {(contribResult.analysis_report?.verified_facts || []).slice(0, 4).map((s: string, i: number) => <li key={i}>✓ {s}</li>)}
                  {(contribResult.analysis_report?.contradictions_or_issues || []).slice(0, 3).map((s: string, i: number) => <li key={i} className="text-rose-200">✗ {s}</li>)}
                  {(contribResult.analysis_report?.gaps_or_missing || []).slice(0, 3).map((s: string, i: number) => <li key={i} className="text-amber-200">? {s}</li>)}
                </ul>
                {contribResult.analysis_report?.overall_assessment && (
                  <p className="mt-2 text-xs text-slate-300">{contribResult.analysis_report.overall_assessment}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-emerald-200/80">Proposed {contribResult.workflow_type_used}</p>
                <p className="mt-1 font-semibold text-slate-100">{asText(contribResult.proposed_llm_recommendation?.title, "Untitled memory")}</p>
                <p className="mt-1 text-slate-300">{asText(contribResult.proposed_llm_recommendation?.summary)}</p>
                {((contribResult.proposed_llm_recommendation?.rules as string[] | undefined) || []).length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-xs text-slate-300">
                    {((contribResult.proposed_llm_recommendation?.rules as string[] | undefined) || []).slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void handleOpenContributionReview()} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/50 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                <CheckCircle className="h-3.5 w-3.5" /> Open Review Editor
              </button>
              <button onClick={() => void handleSaveAsCandidate()} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200">
                Save as NEW candidate
              </button>
              <button onClick={() => setContribResult(null)} className="text-xs text-slate-400 hover:text-slate-200">Dismiss</button>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">Recorded as NEW (id: {contribResult.recorded_event?.id}). Only APPROVED entries are loaded into global strategy memory for prompts.</p>
          </div>
        )}
      </section>

      {/* Memory curation surface */}
      <section className="glass-panel rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Memory Candidates ({memoryStatusFilter})</p>
            <p className="text-sm text-slate-400">Review extracted evidence and edit proposed memory before it becomes approved GPT context.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={memoryStatusFilter}
              onChange={(e) => setMemoryStatusFilter(e.target.value as AiDecisionReuseStatus)}
              className="h-8 rounded-md border border-white/10 bg-slate-950/70 px-2 text-xs text-slate-100"
            >
              {(["NEW", "APPROVED", "REJECTED", "EXPIRED"] as AiDecisionReuseStatus[]).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={memoryCategoryFilter}
              onChange={(e) => setMemoryCategoryFilter(e.target.value as MemoryCategoryFilter)}
              className="h-8 rounded-md border border-white/10 bg-slate-950/70 px-2 text-xs text-slate-100"
            >
              <option value="ALL">All categories</option>
              {AI_MEMORY_WORKFLOW_TYPES.map((category) => (
                <option key={category} value={category}>{MEMORY_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
            <button onClick={() => void loadMemoryCandidates()} className="text-xs text-slate-400 hover:text-slate-200">Refresh</button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <div className="space-y-2">
            {memoryCandidatesLoading ? (
              <p className="text-sm text-slate-400">Loading candidates...</p>
            ) : memoryCandidates.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/35 p-3 text-sm text-slate-500">No memory rows match this filter.</p>
            ) : (
              memoryCandidates.map((c) => {
                const rec = asRecord(c.llm_recommendation);
                const selectedRow = selectedMemory?.id === c.id;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openMemoryReview(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void openMemoryReview(c);
                      }
                    }}
                    className={`block w-full rounded border p-3 text-left text-sm transition ${
                      selectedRow ? "border-amber-300/50 bg-amber-400/10" : "border-white/10 bg-slate-950/40 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100">{asText(rec.title, categoryLabel(c.workflow_type))}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{asText(rec.summary)}</div>
                      </div>
                      <span className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">
                        {c.evidence_count ?? 0} src
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <span>{categoryLabel(c.workflow_type)}</span>
                      <span>{Math.round(Number(c.confidence ?? 0)) || "-"}%</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    {memoryStatusFilter === "NEW" ? (
                      <div className="mt-2 flex gap-1.5">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCandidateStatus(c, "APPROVED");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void handleCandidateStatus(c, "APPROVED");
                            }
                          }}
                          className="rounded border border-emerald-300/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-400/10"
                        >
                          Quick approve
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCandidateStatus(c, "REJECTED");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void handleCandidateStatus(c, "REJECTED");
                            }
                          }}
                          className="rounded border border-rose-300/40 px-2 py-0.5 text-xs text-rose-200 hover:bg-rose-400/10"
                        >
                          Reject
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
            {!selectedMemory ? (
              <p className="text-sm text-slate-400">Select a memory row to inspect evidence and edit the approved context.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Review editor</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedMemory.id} | {selectedMemory.reuse_status} | {memoryDetailLoading ? "Loading detail..." : `${memoryEvidence.length} evidence source(s)`}
                    </p>
                  </div>
                  <button onClick={() => setSelectedMemory(null)} className="text-xs text-slate-400 hover:text-slate-100">Close</button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Category
                    <select
                      value={reviewDraft.workflowType}
                      onChange={(e) => setReviewDraft((prev) => ({ ...prev, workflowType: e.target.value as AiMemoryWorkflowType }))}
                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-2 text-sm normal-case tracking-normal text-slate-100"
                    >
                      {AI_MEMORY_WORKFLOW_TYPES.map((category) => (
                        <option key={category} value={category}>{MEMORY_CATEGORY_LABELS[category]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Scope
                    <textarea
                      value={reviewDraft.scopeText}
                      onChange={(e) => setReviewDraft((prev) => ({ ...prev, scopeText: e.target.value }))}
                      rows={2}
                      className="mt-1 w-full resize-y rounded-md border border-white/10 bg-slate-950/70 p-2 text-sm normal-case tracking-normal text-slate-100"
                    />
                  </label>
                </div>

                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Title
                  <input
                    value={reviewDraft.title}
                    onChange={(e) => setReviewDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Summary
                  <textarea
                    value={reviewDraft.summary}
                    onChange={(e) => setReviewDraft((prev) => ({ ...prev, summary: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full resize-y rounded-md border border-white/10 bg-slate-950/70 p-3 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ["Rules", "rulesText"],
                    ["Monitoring metrics", "metricsText"],
                    ["Invalidation triggers", "triggersText"],
                    ["Assumptions", "assumptionsText"],
                  ].map(([label, key]) => (
                    <label key={key} className="text-xs uppercase tracking-wide text-slate-400">
                      {label}
                      <textarea
                        value={reviewDraft[key as keyof MemoryReviewDraft] as string}
                        onChange={(e) => setReviewDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-md border border-white/10 bg-slate-950/70 p-2 text-sm normal-case tracking-normal text-slate-100"
                      />
                    </label>
                  ))}
                </div>

                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Allocation JSON
                  <textarea
                    value={reviewDraft.allocationJson}
                    onChange={(e) => setReviewDraft((prev) => ({ ...prev, allocationJson: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full resize-y rounded-md border border-white/10 bg-slate-950/70 p-2 font-mono text-xs normal-case tracking-normal text-slate-100"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Guardrail status
                    <input
                      value={reviewDraft.guardrailStatus}
                      onChange={(e) => setReviewDraft((prev) => ({ ...prev, guardrailStatus: e.target.value }))}
                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm normal-case tracking-normal text-slate-100"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Review notes
                    <input
                      value={reviewDraft.reviewNotes}
                      onChange={(e) => setReviewDraft((prev) => ({ ...prev, reviewNotes: e.target.value }))}
                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm normal-case tracking-normal text-slate-100"
                    />
                  </label>
                </div>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Guardrail reason
                  <textarea
                    value={reviewDraft.guardrailReason}
                    onChange={(e) => setReviewDraft((prev) => ({ ...prev, guardrailReason: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full resize-y rounded-md border border-white/10 bg-slate-950/70 p-2 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Extracted evidence</p>
                  {memoryEvidence.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No extracted evidence stored for this candidate.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {memoryEvidence.slice(0, 4).map((source) => (
                        <div key={source.id} className="rounded border border-white/10 bg-white/[0.03] p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-slate-200">{source.filename}</span>
                            <span className="text-slate-500">{source.extraction_method} | {compactNumber(source.file_size_bytes)}B</span>
                          </div>
                          {source.warnings?.length ? (
                            <p className="mt-1 text-[10px] text-amber-200">{source.warnings.map(String).join(" | ")}</p>
                          ) : null}
                          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-400">{source.excerpt || source.extracted_text || "-"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={memoryReviewLoading}
                    onClick={() => void handleReviewSubmit("APPROVED")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/50 bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Approve edited memory
                  </button>
                  <button
                    disabled={memoryReviewLoading}
                    onClick={() => void handleReviewSubmit("NEW")}
                    className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-60"
                  >
                    Save edits as NEW
                  </button>
                  <button
                    disabled={memoryReviewLoading}
                    onClick={() => void handleReviewSubmit("REJECTED")}
                    className="rounded-md border border-rose-300/40 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-100 disabled:opacity-60"
                  >
                    Reject
                  </button>
                  <button
                    disabled={memoryReviewLoading}
                    onClick={() => void handleReviewSubmit("EXPIRED")}
                    className="rounded-md border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-60"
                  >
                    Expire
                  </button>
                </div>
              </div>
            )}
          </div>
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
