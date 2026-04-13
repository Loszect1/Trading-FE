export const TOAST_MESSAGES = {
  watchlistSaved: (symbol: string) => `Đã lưu ${symbol} vào danh sách theo dõi`,
  watchlistRemoved: (symbol: string) => `Đã xóa ${symbol} khỏi danh sách theo dõi`,
  symbolChartUpdated: (symbol: string, interval: string, range: string) =>
    `Đã cập nhật biểu đồ ${symbol} · ${range} · ${interval}`,
  symbolLoadFailed: (symbol: string) => `Không tải được dữ liệu ${symbol}`,
  tradeUpdated: (symbol: string) => `Đã cập nhật dữ liệu giao dịch ${symbol}`,
  tradeLoadFailed: (symbol: string) => `Không tải dữ liệu giao dịch ${symbol}`,
  dnseOtpSent: "Đã gửi yêu cầu OTP email DNSE",
  dnseOrderPlaced: (symbol: string) => `Đã gửi lệnh DNSE cho ${symbol}`,
  dnseAccountLoaded: "Đã tải tài khoản và sub-account DNSE",
  dnseAccountLoadFailed: "Không tải được thông tin tài khoản DNSE",
  dnseSessionSaved: "Đã lưu phiên DNSE (đăng nhập thành công)",
  dnseSessionCleared: "Đã xóa phiên DNSE",
  dnseLoginFailed: "Đăng nhập DNSE thất bại",
} as const;
