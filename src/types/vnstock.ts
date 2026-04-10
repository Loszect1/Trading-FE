export interface SymbolItem {
  symbol: string;
  exchange?: string;
  industry?: string;
}

export interface CompanyOverview {
  symbol: string;
  id?: string;
  company_name?: string;
  exchange?: string;
  industry?: string;
  market_cap?: number;
  issue_share?: number;
  financial_ratio_issue_share?: number;
  charter_capital?: number;
  icb_name2?: string;
  icb_name3?: string;
  icb_name4?: string;
  company_profile?: string;
  history?: string;
}

export interface CandlePoint {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface TradeStats {
  symbol: string;
  total_volume?: number;
  total_value?: number;
  buy_volume?: number;
  sell_volume?: number;
}

export interface TradeMetricRow {
  label: string;
  value: number;
}

export interface CompanyNewsItem {
  title: string;
  published_at?: string;
  source?: string;
  url?: string;
  summary?: string;
}

export type FinancialRatioPoint = Record<string, string | number | null | undefined>;

export interface AiRiskItem {
  risk: string;
  probability: "Low" | "Medium" | "High" | string;
  impact: "Low" | "Medium" | "High" | string;
  monitoring: string;
}

export interface AiWatchlistPlan {
  bull?: string;
  base?: string;
  bear?: string;
}

export interface AiStructuredAnalysis {
  executive_summary?: string;
  market_analysis?: string;
  fundamentals_analysis?: string;
  news_analysis?: string;
  social_sentiment_analysis?: string;
  risk_matrix?: AiRiskItem[];
  trading_watchlist_plan?: AiWatchlistPlan;
  bias?: "Bullish" | "Neutral" | "Bearish" | string;
  confidence?: number;
  data_gaps?: string[];
}

export interface AiDataCompleteness {
  market?: number;
  fundamentals?: number;
  news?: number;
  social_sentiment?: number;
  overall?: number;
}

export interface AiAnalyzeSymbolResult {
  analysis: string;
  structured: AiStructuredAnalysis | null;
  dataCompleteness: AiDataCompleteness | null;
}

export interface MarketScannerItem {
  symbol: string;
  exchange: string;
  turnover_window: number;
  avg_volume_window: number;
  latest_volume?: number;
  baseline_avg_volume?: number;
  volume_spike_ratio?: number;
  spike_score?: number;
  close_latest: number;
}

export interface MarketScannerResult {
  scanned_days: number;
  as_of: string;
  by_exchange: Record<string, MarketScannerItem[]>;
  ai_risk_by_exchange?: Record<string, Record<string, "Low" | "Medium" | "High" | string>>;
  ai_reasoning_by_exchange?: Record<string, string>;
}
