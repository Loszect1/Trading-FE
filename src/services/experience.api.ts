import { httpClient, normalizeError } from "@/services/http-client";

export type ExperienceAccountMode = "REAL" | "DEMO";
export type ExperienceStrategyType = "SHORT_TERM" | "LONG_TERM" | "TECHNICAL";

export interface ExperienceAnalyzeRequestBody {
  trade_id: string;
  account_mode: ExperienceAccountMode;
  symbol: string;
  strategy_type: ExperienceStrategyType;
  entry_time?: string | null;
  exit_time?: string | null;
  pnl_value: number;
  pnl_percent: number;
  market_context: Record<string, unknown>;
  confidence_after_review?: number;
}

export async function postExperienceAnalyze(
  body: ExperienceAnalyzeRequestBody,
): Promise<Record<string, unknown>> {
  try {
    const response = await httpClient.post<Record<string, unknown>>("/experience/analyze", body);
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}
