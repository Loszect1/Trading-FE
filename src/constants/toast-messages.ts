export const TOAST_MESSAGES = {
  watchlistSaved: (symbol: string) => `Saved ${symbol} to watchlist`,
  watchlistRemoved: (symbol: string) => `Removed ${symbol} from watchlist`,
  symbolChartUpdated: (symbol: string, interval: string) =>
    `Updated ${symbol} chart (${interval})`,
  symbolLoadFailed: (symbol: string) => `Failed to load ${symbol} data`,
  tradeUpdated: (symbol: string) => `Updated trade data for ${symbol}`,
  tradeLoadFailed: (symbol: string) => `Failed to load trade data for ${symbol}`,
  dnseOtpSent: "DNSE email OTP request sent",
  dnseOrderPlaced: (symbol: string) => `DNSE order submitted for ${symbol}`,
  dnseAccountLoaded: "DNSE account and sub-accounts loaded",
  dnseAccountLoadFailed: "Failed to load DNSE account info",
  dnseSessionSaved: "DNSE session saved (login OK)",
  dnseSessionCleared: "DNSE session cleared",
  dnseLoginFailed: "DNSE login failed",
} as const;
