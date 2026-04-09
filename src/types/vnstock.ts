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
