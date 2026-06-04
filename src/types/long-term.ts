export interface MacroRegimeResponse {
  regime: string;
  regime_score: number;
  as_of: string;
  components: Record<string, number>;
  drivers: Array<Record<string, unknown>>;
  warnings: string[];
  source_coverage: Record<string, unknown>;
  data_gaps: string[];
  disclaimer?: string;
}

export interface MacroGptSectorImplication {
  sector: string;
  impact: string;
  reason: string;
}

export interface MacroGptAnalysisDetail {
  executive_summary: string;
  macro_regime_view: string;
  economics_view: string;
  news_pressure: string;
  global_context: string;
  market_implications: string;
  bullish_drivers: string[];
  bearish_drivers: string[];
  sector_implications: MacroGptSectorImplication[];
  risk_watchlist: string[];
  data_gaps: string[];
  confidence: number;
  disclaimer: string;
}

export interface MacroGptAnalysisResponse {
  success: boolean;
  analysis_source: string;
  model: string;
  generated_at: string;
  language: "en" | "vi" | string;
  cached?: boolean;
  cache_expires_at?: string;
  cache_ttl_seconds?: number;
  analysis: MacroGptAnalysisDetail;
  context_summary: Record<string, unknown>;
}

export interface LongTermSectorContext {
  exchange?: string | null;
  sector?: string | null;
  market_cap?: number | null;
  issue_share?: number | null;
  latest_close?: number | null;
}

export interface LongTermNewsContext {
  sample_count?: number;
  positive_weighted_impact?: number;
  negative_weighted_impact?: number;
  scoring_rule?: string;
}

export interface LongTermAnalysisResult {
  id?: string;
  symbol: string;
  mode?: "AUTO" | "MANUAL" | string;
  run_id?: string | null;
  rank?: number | null;
  exchange?: string | null;
  sector?: string | null;
  market_cap?: number | null;
  final_score: number;
  rating: string;
  score_components: Record<string, number | string>;
  risk_penalty: number;
  macro_context: Record<string, unknown>;
  sector_context: LongTermSectorContext;
  news_context: LongTermNewsContext;
  ai_thesis?: string;
  catalysts?: string[];
  risks?: string[];
  data_gaps: string[];
  disclaimer: string;
  created_at?: string;
}

export interface LongTermRankingsData {
  items: LongTermAnalysisResult[];
  count: number;
  limit: number;
  run_id?: string | null;
}

export interface LongTermRankingsResponse {
  success: boolean;
  data: LongTermRankingsData;
}

export interface LongTermScanResponse {
  success: boolean;
  run_id: string;
  run_status: string;
  universe_size: number;
  scored_count: number;
  rankings: LongTermAnalysisResult[];
  macro_context: Record<string, unknown>;
}
