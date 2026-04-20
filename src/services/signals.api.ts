import { httpClient, normalizeError } from "@/services/http-client";
import type { SignalRow, SignalStrategyType } from "@/types/operational";

export interface ListSignalsParams {
  strategyType?: SignalStrategyType;
  symbol?: string;
  limit?: number;
}

export async function listSignals(params?: ListSignalsParams): Promise<SignalRow[]> {
  try {
    const search = new URLSearchParams();
    if (params?.strategyType) {
      search.set("strategy_type", params.strategyType);
    }
    if (params?.symbol?.trim()) {
      search.set("symbol", params.symbol.trim());
    }
    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }
    const query = search.toString();
    const path = query ? `/signals?${query}` : "/signals";
    const response = await httpClient.get<{ success: boolean; data: SignalRow[] }>(path);
    return response.data.data ?? [];
  } catch (error) {
    throw normalizeError(error);
  }
}
